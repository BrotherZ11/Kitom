// Fase 9 contra el Supabase LOCAL (catálogo de `supabase/seeds/breeds.sql`): lectura real del catálogo
// (`fetchBreedCatalog`, RLS y traducciones ES/EN), copia en el dispositivo, reinicio sin red y alta/
// edición sin conexión con una raza de esa copia, enviadas por el motor de Pets y comprobadas por la FK
// `pets_breed_species_fkey`. `npm run test:integration`; en `npm test` se omiten. Nunca contra `kitom-dev`.
//
// Crean un usuario `it-…@kitom.test` (queda en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createOwnerAccessToken } from '../../auth/owner-session.ts';
import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { fetchBreedCatalog } from '../api/breeds-remote.ts';
import { createPetWritesRemote } from '../api/pet-writes-remote.ts';
import { searchBreeds } from '../breed-search.ts';
import { toPetFields, toPetFormValues, validatePetForm } from '../pet-form.ts';
import { createBreedCatalogRepository } from './breed-catalog-repository.ts';
import { fetchBreedCatalogThroughCache } from './breed-catalog-queries.ts';
import { findBreed, selectableBreeds } from './breed-catalog-view.ts';
import { createPetCacheRepository } from './pet-cache-repository.ts';
import { createPetOperationRepository } from './pet-operation-repository.ts';
import { createPetSyncEngine } from './pet-sync-engine.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };

/** La app en un dispositivo: un cliente con red que se puede cortar, disco en memoria y motor de Pets. */
function app(user, disk = new Map()) {
  const net = { online: true };
  const requests = [];
  const fetch_ = async (input, init) => {
    if (!net.online) throw new TypeError('Network request failed');
    requests.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
    return fetch(input, init);
  };
  const supabase = createClient(URL_, ANON_KEY, { auth: authOptions, global: { fetch: fetch_ } });
  const storage = createMemoryStorage(disk);
  const engine = createPetSyncEngine({
    operations: createPetOperationRepository(createLocalStore(storage, user.userId)),
    cache: createPetCacheRepository(createLocalStore(storage, user.userId)),
    remote: createPetWritesRemote(supabase, {
      ownerUserId: user.userId,
      accessToken: createOwnerAccessToken(supabase.auth, user.userId),
      timeoutMs: 5_000,
    }),
    isOnline: () => net.online,
    now: Date.now,
    createOperationId: randomUUID,
    random: () => 0,
  });
  return {
    net,
    requests,
    disk,
    supabase,
    engine,
    catalog: createBreedCatalogRepository(createLocalStore(storage, user.userId)),
    async signIn() {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
      if (error) throw error;
      engine.start();
      engine.setSessionUserId(user.userId);
    },
    /** La query del catálogo con la sesión de este cliente (como `useBreedCatalog`). */
    loadCatalog(locale) {
      return fetchBreedCatalogThroughCache(
        {
          repository: this.catalog,
          fetchCatalog: () => fetchBreedCatalog(supabase, locale),
          serverCall: (call) => call(),
          isOwnerSession: () => true,
        },
        locale
      );
    },
  };
}

describe('Catálogo de razas sin conexión contra el Supabase local', { skip }, () => {
  let user;
  const species = {};
  const cleanup = [];

  before(async () => {
    const supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
    const email = `it-${randomUUID()}@kitom.test`;
    const password = `It-${randomUUID()}`;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
    user = { supabase, userId: data.user.id, email, password };
    const { data: rows } = await supabase.from('species').select('id, code').in('code', ['dog', 'cat']);
    for (const row of rows) species[row.code] = row.id;
    assert.ok(species.dog && species.cat, 'el seed de especies (dog, cat) está cargado');
  });

  after(async () => {
    for (const petId of cleanup) await user.supabase.from('pets').delete().eq('id', petId);
  });

  it('catálogo completo con RLS: perro y gato, nombres y alias por idioma; sin sesión es un error, no un vacío', async () => {
    const es = await fetchBreedCatalog(user.supabase, 'es');
    const en = await fetchBreedCatalog(user.supabase, 'en');
    assert.ok(selectableBreeds(es, species.dog).length > 50, 'el seed de razas está cargado');
    assert.ok(selectableBreeds(es, species.cat).length > 10);
    assert.deepEqual(new Set(es.map((item) => item.id)), new Set(en.map((item) => item.id)), 'mismas razas en los dos idiomas');

    const shepherdEs = es.find((item) => item.code === 'german_shepherd');
    const shepherdEn = findBreed({ state: 'ready', breeds: en }, shepherdEs.id);
    assert.equal(shepherdEs.name, 'Pastor alemán');
    assert.deepEqual(shepherdEs.aliases, ['Alsaciano']);
    assert.equal(shepherdEn.name, 'German Shepherd Dog');
    assert.deepEqual(shepherdEn.aliases, ['Alsatian', 'German Shepherd']);
    assert.equal(shepherdEs.speciesId, species.dog);
    assert.deepEqual(es.map((item) => item.name), [...es.map((item) => item.name)].sort((a, b) => a.localeCompare(b, 'es')));

    const anon = createClient(URL_, ANON_KEY, { auth: authOptions });
    await assert.rejects(fetchBreedCatalog(anon, 'es'), (error) => error?.code === '42501');
  });

  it('1/2/3/6. se guarda con conexión y, tras reiniciar sin red, se busca por nombre y alias en ES y EN', async () => {
    const device = app(user);
    await device.signIn();
    const shown = await device.loadCatalog('es');
    await device.loadCatalog('en');

    const reopened = app(user, device.disk);
    reopened.net.online = false;
    const es = await reopened.catalog.read('es');
    const en = await reopened.catalog.read('en');
    assert.equal(es.status, 'loaded');
    assert.deepEqual(es.breeds, shown);
    const dogs = selectableBreeds(es.breeds, species.dog);
    assert.equal(searchBreeds(dogs, 'ALSACIANO')[0].code, 'german_shepherd');
    assert.equal(searchBreeds(dogs, 'bichon')[0].name.startsWith('Bichón'), true);
    assert.equal(searchBreeds(selectableBreeds(en.breeds, species.dog), 'alsatian')[0].code, 'german_shepherd');
    assert.deepEqual(searchBreeds(dogs, 'persa'), [], 'los gatos no aparecen en perros');
    assert.deepEqual(reopened.requests, [], 'sin red no sale nada');
  });

  it('13. alta sin conexión con una raza del catálogo guardado: el motor la envía y la FK especie ↔ raza la acepta', async () => {
    const online = app(user);
    await online.signIn();
    await online.loadCatalog('es');

    const device = app(user, online.disk);
    await device.signIn();
    device.net.online = false;
    const { breeds } = await device.catalog.read('es');
    const persian = searchBreeds(selectableBreeds(breeds, species.cat), 'persa')[0];
    const values = { ...toPetFormValues(), name: 'IT raza', speciesId: species.cat, breedStatus: 'known', breedSource: 'catalog', breedId: persian.id };
    assert.deepEqual(validatePetForm(values, { breedSpeciesId: findBreed({ state: 'ready', breeds }, persian.id).speciesId }), {});
    const op = await device.engine.saveCreate(toPetFields(values));
    await device.engine.idle();

    device.net.online = true;
    await device.engine.requestSync();
    const { data: rows, error } = await user.supabase
      .from('pets')
      .select('id, species_id, breed_status, breed_id, breed')
      .eq('client_request_id', op.operationId);
    if (error) throw error;
    assert.equal(rows.length, 1);
    cleanup.push(rows[0].id);
    assert.deepEqual(
      [rows[0].species_id, rows[0].breed_status, rows[0].breed_id, rows[0].breed],
      [species.cat, 'known', persian.id, null]
    );

    // Una raza de otra especie la rechaza el servidor (14): por eso el formulario nunca la envía.
    const dog = selectableBreeds(breeds, species.dog)[0];
    const { error: fkError } = await user.supabase.from('pets').update({ breed_id: dog.id }).eq('id', rows[0].id);
    assert.equal(fkError?.code, '23503', 'pets_breed_species_fkey');
  });

  it('13b. edición sin conexión: de mestizo a una raza del catálogo guardado', async () => {
    const { data: base, error } = await user.supabase
      .from('pets')
      .insert({ owner_id: user.userId, name: 'IT mestizo', species_id: species.dog, breed_status: 'mixed' })
      .select('id, owner_id, name, species_id, sex, breed, breed_id, breed_status, birth_date, weight_kg, sterilized, known_conditions, allergies, temperament_notes, photo_path, is_active, created_at, updated_at')
      .single();
    if (error) throw error;
    cleanup.push(base.id);

    const device = app(user);
    await device.signIn();
    await device.loadCatalog('es');
    device.net.online = false;
    const { breeds } = await device.catalog.read('es');
    const labrador = searchBreeds(selectableBreeds(breeds, species.dog), 'labrador')[0];
    const values = { ...toPetFormValues(base), breedStatus: 'known', breedSource: 'catalog', breedId: labrador.id, breedText: '' };
    await device.engine.saveEdit(base.id, toPetFields(values), base);

    device.net.online = true;
    await device.engine.requestSync();
    const { data: row } = await user.supabase.from('pets').select('breed_status, breed_id, breed').eq('id', base.id).single();
    assert.deepEqual(row, { breed_status: 'known', breed_id: labrador.id, breed: null });
  });
});
