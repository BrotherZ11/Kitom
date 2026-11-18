// Kitom Premium contra el Supabase LOCAL, del lado de la app: una cuenta gratuita recibe su plan de
// `get_my_plan`, la tercera mascota se rechaza con `pet_limit_reached` (y el motor offline lo trata como
// definitivo, sin reintentos), invitar da `premium_required` y, con Premium, todo pasa.
// `npm run test:integration`; en `npm test` se omite. Nunca contra `kitom-dev`.
//
// Crea un usuario `it-…@kitom.test` (queda en el Auth local) y mascotas que se borran al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { toCoOwnerErrorCode } from '../co-owners/co-owners-model.ts';
import { classifySyncError } from '../daily-logs/offline/sync-errors.ts';
import { canCreateOwnedPet, historyStartDate, toPlan } from './plan-model.ts';
import { grantPremium } from '../../../scripts/integration-premium.mjs';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY ? 'sin Supabase local (npm run test:integration)' : !isLocal ? 'la URL no es local' : false;

const authOptions = { persistSession: false, autoRefreshToken: false };

describe('Kitom Premium: plan gratuito y Premium contra el Supabase local', { skip }, () => {
  let supabase;
  let userId;
  let dogId;
  const pets = [];

  const myPlan = async () => {
    const { data, error } = await supabase.rpc('get_my_plan');
    if (error) throw error;
    return toPlan(data[0]);
  };
  const createPet = (name) =>
    supabase
      .from('pets')
      .insert({ owner_id: userId, name, species_id: dogId, client_request_id: randomUUID() })
      .select('id')
      .single();

  before(async () => {
    supabase = createClient(URL_, ANON_KEY, { auth: authOptions });
    const { data, error } = await supabase.auth.signUp({ email: `it-plan-${randomUUID()}@kitom.test`, password: `pw-${randomUUID()}` });
    if (error || !data.session) throw error ?? new Error('El Auth local exige confirmar el email');
    userId = data.user.id;
    const species = await supabase.from('species').select('id').eq('code', 'dog').single();
    if (species.error) throw species.error;
    dogId = species.data.id;
  });

  after(async () => {
    for (const id of pets) await supabase.from('pets').delete().eq('id', id);
  });

  it('una cuenta nueva es gratuita, con sus límites', async () => {
    const plan = await myPlan();
    assert.equal(plan.isPremium, false);
    assert.equal(plan.maxOwnedPets, 2);
    assert.equal(plan.historyDays, 30);
    assert.equal(plan.aiMonthlyLimit, 3);
    assert.equal(plan.canInviteCoOwners, false);
    assert.equal(historyStartDate(plan, '2026-11-16'), '2026-10-18');
  });

  it('dos mascotas sí; la tercera, pet_limit_reached, definitiva para el motor', async () => {
    for (const name of ['Uno', 'Dos']) {
      const { data, error } = await createPet(name);
      assert.equal(error, null);
      pets.push(data.id);
    }
    const plan = await myPlan();
    assert.equal(plan.ownedPets, 2);
    assert.equal(canCreateOwnedPet(plan), false, 'la app ya no ofrece el formulario');

    const { error, status } = await createPet('Tres');
    assert.equal(error?.hint, 'pet_limit_reached');
    const info = classifySyncError(error, status);
    assert.deepEqual([info.kind, info.policy, info.reason], ['validation', 'give_up', 'pet_limit_reached']);
  });

  it('invitar sin Premium: premium_required (también a un email sin cuenta)', async () => {
    for (const email of ['nadie@example.test', 'otro@kitom.test']) {
      const { error } = await supabase.rpc('invite_pet_member_by_email', { target_pet_id: pets[0], invitee_email: email, initial_role: 'viewer' });
      assert.equal(toCoOwnerErrorCode(error), 'premium_required');
    }
  });

  it('con Premium: sin límites, la tercera mascota y la invitación pasan', async () => {
    await grantPremium(userId);
    const plan = await myPlan();
    assert.equal(plan.isPremium, true);
    assert.equal(plan.maxOwnedPets, null);
    assert.equal(historyStartDate(plan, '2026-11-16'), null);
    const { data, error } = await createPet('Tres');
    assert.equal(error, null);
    pets.push(data.id);
    const invite = await supabase.rpc('invite_pet_member_by_email', { target_pet_id: pets[0], invitee_email: 'nadie@example.test', initial_role: 'viewer' });
    assert.equal(invite.error, null);
  });
});
