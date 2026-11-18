// Campos por especie contra el Supabase LOCAL: la copia de la app (`species-fields.ts`) coincide con el
// catálogo `public.species_fields` de la migración `20261111120000_species_fields.sql`, y la base de datos
// acepta lo que la app produce (ficha y registro diario) y rechaza lo que no. `npm run test:integration`;
// en `npm test` se omite. Nunca contra `kitom-dev`.
//
// Crea un usuario `it-…@kitom.test` (queda en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { contentToSaveArgs } from '../daily-logs/offline/daily-log-content.ts';
import { CORE_SCALES, SPECIES_CODES, SPECIES_DEFINITIONS } from './species-fields.ts';
import { grantPremium } from '../../../scripts/integration-premium.mjs';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };

/** Hoy en UTC (el perfil de prueba no tiene zona: el servidor usa UTC). */
const todayUtc = () => new Date().toISOString().slice(0, 10);

describe('campos por especie: app ↔ base de datos', { skip }, () => {
  let supabase;
  const species = {};
  const cleanup = [];

  before(async () => {
    supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
    const email = `it-species-${randomUUID()}@kitom.test`;
    const { data, error } = await supabase.auth.signUp({ email, password: `pw-${randomUUID()}` });
    if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
    await grantPremium(data.user.id);
    const { data: rows, error: speciesError } = await supabase.from('species').select('id, code, is_active, ai_guidance_enabled');
    if (speciesError) throw speciesError;
    for (const row of rows) species[row.code] = row;
  });

  after(async () => {
    for (const petId of cleanup) await supabase.from('pets').delete().eq('id', petId);
  });

  it('las 9 especies están activas y con orientación con IA (migración *_ai_guidance_v2)', () => {
    for (const code of SPECIES_CODES) {
      assert.equal(species[code]?.is_active, true, code);
      assert.equal(species[code]?.ai_guidance_enabled, true, code);
    }
  });

  it('el catálogo de la base de datos es exactamente el de la app', async () => {
    const { data, error } = await supabase
      .from('species_fields')
      .select('species_id, scope, code, kind, options, min_value, max_value, unit, position, is_primary, is_active')
      .order('position');
    if (error) throw error;
    const byId = new Map(Object.values(species).map((row) => [row.id, row.code]));
    for (const code of SPECIES_CODES) {
      const definition = SPECIES_DEFINITIONS[code];
      const rows = data.filter((row) => byId.get(row.species_id) === code && row.is_active);
      const core = Object.fromEntries(
        CORE_SCALES.map((scale) => {
          const row = rows.find((item) => item.kind === 'core' && item.code === scale);
          return [scale, row ? (row.is_primary ? 'primary' : 'optional') : 'hidden'];
        })
      );
      assert.deepEqual(core, definition.core, `${code}: escalas comunes`);
      for (const scope of ['profile', 'daily']) {
        const fromDb = rows
          .filter((row) => row.scope === scope && row.kind !== 'core')
          .map((row) => ({
            code: row.code,
            kind: row.kind,
            ...(row.options ? { options: row.options } : {}),
            ...(row.min_value !== null ? { min: Number(row.min_value) } : {}),
            ...(row.max_value !== null ? { max: Number(row.max_value) } : {}),
            ...(row.unit ? { unit: row.unit } : {}),
          }));
        const fromApp = definition[scope].map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) }));
        assert.deepEqual(fromDb, fromApp, `${code}/${scope}`);
      }
    }
  });

  it('la ficha acepta los datos válidos de su especie y rechaza los de otra (hint y campo)', async () => {
    const { data: pet, error } = await supabase
      .from('pets')
      .insert({
        owner_id: (await supabase.auth.getUser()).data.user.id,
        name: 'IT conejo',
        species_id: species.rabbit.id,
        species_data: { housing: 'pen', hours_out: 6, unlimited_hay: true },
      })
      .select('id, species_data')
      .single();
    if (error) throw error;
    cleanup.push(pet.id);
    assert.deepEqual(pet.species_data, { housing: 'pen', hours_out: 6, unlimited_hay: true });

    const wrong = await supabase.from('pets').update({ species_data: { walks_per_day: 2 } }).eq('id', pet.id).select('id');
    assert.equal(wrong.error?.hint, 'species_data_invalid');
    assert.equal(wrong.error?.details, 'walks_per_day');
  });

  it('el registro diario guarda lo que produce la app (save_daily_log con p_species_data)', async () => {
    const { data: pet, error } = await supabase
      .from('pets')
      .insert({ owner_id: (await supabase.auth.getUser()).data.user.id, name: 'IT gato', species_id: species.cat.id })
      .select('id')
      .single();
    if (error) throw error;
    cleanup.push(pet.id);

    const content = {
      energy_level: 3,
      appetite_level: 3,
      mood_level: 4,
      activity_level: 3,
      sleep_quality: null,
      vocalization_level: null,
      social_interaction_level: null,
      unusual_behavior: false,
      unusual_behavior_notes: null,
      notes: null,
      tags: [],
      species_data: { urination: 'usual', water: 3, hiding: false },
    };
    const saved = await supabase.rpc('save_daily_log', {
      ...contentToSaveArgs(pet.id, todayUtc(), content),
      p_expect_absent: true,
    });
    if (saved.error) throw saved.error;
    assert.deepEqual(saved.data.species_data, { hiding: false, urination: 'usual', water: 3 });

    // Sin indicar (contenido de una versión anterior): no se envía y se conserva lo guardado.
    const { species_data: _omit, ...legacy } = content;
    const args = contentToSaveArgs(pet.id, todayUtc(), { ...legacy, mood_level: 2 });
    assert.equal('p_species_data' in args, false);
    const kept = await supabase.rpc('save_daily_log', { ...args, p_expected_updated_at: saved.data.updated_at });
    if (kept.error) throw kept.error;
    assert.equal(kept.data.mood_level, 2);
    assert.deepEqual(kept.data.species_data, { hiding: false, urination: 'usual', water: 3 });
  });

  it('un reptil pide orientación con sus señales y contexto; una señal de otra especie se rechaza', async () => {
    const { data: pet, error } = await supabase
      .from('pets')
      .insert({ owner_id: (await supabase.auth.getUser()).data.user.id, name: 'IT gecko', species_id: species.reptile_other.id })
      .select('id')
      .single();
    if (error) throw error;
    cleanup.push(pet.id);
    // Sin aviso veterinario aceptado el servidor pararía antes: se acepta para llegar a la comprobación.
    const userId = (await supabase.auth.getUser()).data.user.id;
    const accepted = await supabase.from('profiles').update({ disclaimer_accepted_at: new Date().toISOString(), disclaimer_version: 'it' }).eq('id', userId);
    if (accepted.error) throw accepted.error;
    const { data: signs, error: signsError } = await supabase
      .from('symptoms_catalog')
      .select('id, code')
      .in('code', ['retained_shed', 'vomiting']);
    if (signsError) throw signsError;
    const sign = (code) => signs.find((row) => row.code === code).id;

    const rejected = await supabase.rpc('request_ai_analysis', { target_pet_id: pet.id, p_photo_path: null, symptom_ids: [sign('vomiting')] });
    assert.equal(rejected.error?.hint, 'ai_invalid_symptoms');

    const request = await supabase.rpc('request_ai_analysis', {
      target_pet_id: pet.id,
      p_photo_path: null,
      symptom_ids: [sign('retained_shed')],
      p_user_context: '  Le quedan restos de piel en los dedos.  ',
      p_symptom_onset: 'days_4_7',
      p_symptom_trend: 'same',
    });
    if (request.error) throw request.error;
    const { data: row, error: rowError } = await supabase
      .from('ai_analysis_requests')
      .select('user_context, symptom_onset, symptom_trend')
      .eq('id', request.data)
      .single();
    if (rowError) throw rowError;
    assert.deepEqual(row, { user_context: 'Le quedan restos de piel en los dedos.', symptom_onset: 'days_4_7', symptom_trend: 'same' });
  });
});
