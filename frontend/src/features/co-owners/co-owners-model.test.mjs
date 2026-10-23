import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPlausibleEmail, normalizeEmail, toCoOwnerErrorCode, toInvitations, toMembers } from './co-owners-model.ts';

describe('toMembers', () => {
  it('aceptados primero, luego pendientes, por fecha; sin nombre vacío; descarta otros estados', () => {
    const members = toMembers([
      { invitation_id: 'p1', user_id: 'u1', full_name: 'Ana', role: 'viewer', status: 'pending', invited_at: '2026-10-01', accepted_at: null },
      { invitation_id: 'a2', user_id: 'u2', full_name: '  ', role: 'editor', status: 'accepted', invited_at: '2026-10-05', accepted_at: '2026-10-06' },
      { invitation_id: 'a1', user_id: 'u3', full_name: 'Luis', role: 'viewer', status: 'accepted', invited_at: '2026-09-01', accepted_at: '2026-09-02' },
      { invitation_id: 'r1', user_id: 'u4', full_name: 'X', role: 'viewer', status: 'revoked', invited_at: '2026-08-01', accepted_at: null },
    ]);
    assert.deepEqual(
      members.map((m) => [m.invitationId, m.status]),
      [
        ['a1', 'accepted'],
        ['a2', 'accepted'],
        ['p1', 'pending'],
      ]
    );
    assert.equal(members[1].fullName, null);
    assert.deepEqual(toMembers(null), []);
  });
});

describe('toInvitations', () => {
  it('pasa las filas a camelCase y limpia el nombre de quien invita', () => {
    assert.deepEqual(
      toInvitations([
        { invitation_id: 'i', pet_id: 'p', pet_name: 'Kika', role: 'editor', invited_by_name: null, invited_at: '2026-10-23' },
      ]),
      [{ invitationId: 'i', petId: 'p', petName: 'Kika', role: 'editor', invitedByName: null, invitedAt: '2026-10-23' }]
    );
  });
});

describe('email', () => {
  it('normaliza y hace una comprobación previa mínima', () => {
    assert.equal(normalizeEmail('  Ana@Ejemplo.COM '), 'ana@ejemplo.com');
    assert.equal(isPlausibleEmail('ana@ejemplo.com'), true);
    assert.equal(isPlausibleEmail('ana@ejemplo'), false);
    assert.equal(isPlausibleEmail(''), false);
    assert.equal(isPlausibleEmail(`${'a'.repeat(315)}@b.com`), false);
  });
});

describe('toCoOwnerErrorCode', () => {
  it('usa el hint de las RPC nuevas y el mensaje de las anteriores', () => {
    assert.equal(toCoOwnerErrorCode({ hint: 'invalid_email', message: 'Email no válido' }), 'invalid_email');
    assert.equal(toCoOwnerErrorCode({ hint: 'not_pet_owner', message: 'x' }), 'not_owner');
    assert.equal(toCoOwnerErrorCode({ message: 'Solo el propietario principal puede revocar el acceso' }), 'not_owner');
    assert.equal(toCoOwnerErrorCode({ hint: 'not_pet_member', message: 'x' }), 'not_member');
    assert.equal(toCoOwnerErrorCode({ message: 'Esta invitación ya no está pendiente (estado actual: revoked)' }), 'changed');
    assert.equal(toCoOwnerErrorCode({ message: 'Invitación no encontrada' }), 'changed');
    assert.equal(toCoOwnerErrorCode({ message: 'Solo se puede cambiar el rol de un miembro activo (estado: accepted)' }), 'changed');
    assert.equal(toCoOwnerErrorCode(new TypeError('Network request failed')), 'network');
    assert.equal(toCoOwnerErrorCode({ name: 'SessionUnavailableError' }), 'network');
    assert.equal(toCoOwnerErrorCode({ message: 'otro' }), 'unknown');
    assert.equal(toCoOwnerErrorCode(null), 'unknown');
  });
});
