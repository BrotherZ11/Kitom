// Pruebas de `timezone.ts` con el runner de Node (sin dependencias): `npm test`.
// Es .mjs para que Node importe el .ts directamente (type stripping) sin que tsc necesite
// @types/node; el módulo probado sí está tipado.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTimeZone, syncProfileTimeZone } from './timezone.ts';

const USER_ID = 'f0000000-0000-4000-8000-000000000001';

/** Simula `profiles.timezone` y la consulta `update … where timezone is null`. */
function fakeProfile(initial) {
  const state = { timezone: initial, saveCalls: 0 };
  const saveIfMissing = async (_userId, timeZone) => {
    state.saveCalls += 1;
    if (state.timezone !== null) return false;
    state.timezone = timeZone;
    return true;
  };
  return { state, saveIfMissing };
}

describe('normalizeTimeZone', () => {
  it('acepta identificadores IANA de zona', () => {
    for (const zone of ['Europe/Madrid', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'UTC']) {
      assert.equal(normalizeTimeZone(zone), zone);
    }
  });

  it('recorta espacios', () => {
    assert.equal(normalizeTimeZone('  Europe/Madrid '), 'Europe/Madrid');
  });

  it('rechaza offsets, abreviaturas, valores vacíos y zonas desconocidas', () => {
    for (const value of ['+01:00', 'GMT+1', 'CET', 'GMT', 'posix/Europe/Madrid', 'Etc/Unknown',
      'Mars/Olympus_Mons', '', '   ']) {
      assert.equal(normalizeTimeZone(value), null, value);
    }
  });

  it('rechaza valores que no son texto', () => {
    for (const value of [null, undefined, 1, {}, ['Europe/Madrid']]) {
      assert.equal(normalizeTimeZone(value), null);
    }
  });
});

describe('syncProfileTimeZone', () => {
  it('guarda la zona del dispositivo si el perfil no tiene', async () => {
    const profile = fakeProfile(null);
    const result = await syncProfileTimeZone(USER_ID, {
      detectTimeZone: () => 'Europe/Madrid',
      saveIfMissing: profile.saveIfMissing,
    });
    assert.equal(result, 'saved');
    assert.equal(profile.state.timezone, 'Europe/Madrid');
  });

  it('no sobrescribe una zona existente', async () => {
    const profile = fakeProfile('America/New_York');
    const result = await syncProfileTimeZone(USER_ID, {
      detectTimeZone: () => 'Europe/Madrid',
      saveIfMissing: profile.saveIfMissing,
    });
    assert.equal(result, 'already_set');
    assert.equal(profile.state.timezone, 'America/New_York');
  });

  it('repetir la inicialización es seguro', async () => {
    const profile = fakeProfile(null);
    const deps = { detectTimeZone: () => 'Europe/Madrid', saveIfMissing: profile.saveIfMissing };
    assert.equal(await syncProfileTimeZone(USER_ID, deps), 'saved');
    assert.equal(await syncProfileTimeZone(USER_ID, deps), 'already_set');
    assert.equal(profile.state.timezone, 'Europe/Madrid');
  });

  it('no guarda nada si la detección devuelve null o un valor inválido', async () => {
    for (const detected of [null, undefined, '+01:00', 'CET', '']) {
      const profile = fakeProfile(null);
      const result = await syncProfileTimeZone(USER_ID, {
        detectTimeZone: () => detected,
        saveIfMissing: profile.saveIfMissing,
      });
      assert.equal(result, 'no_device_timezone');
      assert.equal(profile.state.saveCalls, 0);
      assert.equal(profile.state.timezone, null);
    }
  });

  it('no lanza si la detección lanza', async () => {
    const profile = fakeProfile(null);
    const result = await syncProfileTimeZone(USER_ID, {
      detectTimeZone: () => {
        throw new Error('Intl no disponible');
      },
      saveIfMissing: profile.saveIfMissing,
    });
    assert.equal(result, 'no_device_timezone');
    assert.equal(profile.state.saveCalls, 0);
  });

  it('no lanza si falla el guardado', async () => {
    const result = await syncProfileTimeZone(USER_ID, {
      detectTimeZone: () => 'Europe/Madrid',
      saveIfMissing: async () => {
        throw new TypeError('Network request failed');
      },
    });
    assert.equal(result, 'failed');
  });
});
