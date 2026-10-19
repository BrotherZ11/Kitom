import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACTIVE_PET_COLLECTION, resolveActivePet } from './active-pet.ts';

const a = { id: '11111111-1111-4111-8111-111111111111' };
const b = { id: '22222222-2222-4222-8222-222222222222' };

describe('resolveActivePet', () => {
  it('usa la guardada si sigue visible', () => {
    assert.equal(resolveActivePet([a, b], b.id), b);
  });

  it('si la guardada ya no está (o no hay), usa la primera', () => {
    assert.equal(resolveActivePet([a, b], '33333333-3333-4333-8333-333333333333'), a);
    assert.equal(resolveActivePet([a, b], null), a);
  });

  it('sin mascotas, null', () => {
    assert.equal(resolveActivePet([], a.id), null);
  });
});

describe('ACTIVE_PET_COLLECTION.parse', () => {
  it('acepta solo un UUID', () => {
    assert.deepEqual(ACTIVE_PET_COLLECTION.parse({ petId: a.id }), { petId: a.id });
    assert.equal(ACTIVE_PET_COLLECTION.parse({ petId: 'x' }), null);
    assert.equal(ACTIVE_PET_COLLECTION.parse(null), null);
  });
});
