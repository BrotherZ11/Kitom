import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readRangeThroughRepository } from './daily-log-cache.ts';
import {
  contentFromRow,
  contentToSaveArgs,
  isEmptyDailyLogContent,
  normalizeDailyLogContent,
  parseDailyLogContent,
  parseDailyLogRow,
  sameDailyLogContent,
} from './daily-log-content.ts';
import { buildResolvedContent, mergeDailyLogContent } from './daily-log-merge.ts';

const base = {
  energy_level: 3,
  appetite_level: 3,
  mood_level: 3,
  activity_level: 3,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
};

const row = (extra = {}) => ({
  id: 'r1',
  pet_id: '11111111-1111-4111-8111-111111111111',
  logged_by: null,
  last_edited_by: null,
  log_date: '2026-11-11',
  created_at: '2026-11-11T08:00:00.000000+00:00',
  updated_at: '2026-11-11T08:00:00.000000+00:00',
  ...base,
  species_data: {},
  ...extra,
});

describe('species_data en el contenido del registro', () => {
  it('sin indicar (versión anterior): no se envía y la RPC conserva lo guardado', () => {
    const args = contentToSaveArgs('p', '2026-11-11', base);
    assert.equal('p_species_data' in args, false);
    const withData = contentToSaveArgs('p', '2026-11-11', { ...base, species_data: { water: 3 } });
    assert.deepEqual(withData.p_species_data, { water: 3 });
    // Vaciar es explícito.
    assert.deepEqual(contentToSaveArgs('p', '2026-11-11', { ...base, species_data: {} }).p_species_data, {});
  });

  it('una copia local guardada antes de la columna se lee como «sin indicar»', () => {
    const legacy = parseDailyLogContent(base);
    assert.ok(legacy);
    assert.equal('species_data' in legacy, false);
    const legacyRow = parseDailyLogRow({ ...row(), species_data: undefined });
    assert.ok(legacyRow);
    assert.equal('species_data' in legacyRow, false);
    assert.equal(parseDailyLogContent({ ...base, species_data: { nested: { a: 1 } } }), null);
  });

  it('sin indicar coincide con cualquier valor; con valores, se comparan campo a campo', () => {
    assert.ok(sameDailyLogContent(base, { ...base, species_data: { water: 2 } }));
    assert.ok(sameDailyLogContent({ ...base, species_data: { lives: ['b', 'a'] } }, { ...base, species_data: { lives: ['a', 'b'] } }));
    assert.ok(!sameDailyLogContent({ ...base, species_data: { water: 2 } }, { ...base, species_data: { water: 3 } }));
  });

  it('un registro solo con datos de especie no está vacío', () => {
    const empty = { ...base, energy_level: null, appetite_level: null, mood_level: null, activity_level: null };
    assert.ok(isEmptyDailyLogContent(empty));
    assert.ok(!isEmptyDailyLogContent({ ...empty, species_data: { vomit: false } }));
  });

  it('la fila del servidor siempre trae sus datos de especie', () => {
    assert.deepEqual(contentFromRow(row({ species_data: { stool: 'soft' } })).species_data, { stool: 'soft' });
    assert.deepEqual(normalizeDailyLogContent({ ...base, species_data: { b: 1, a: 2 } }).species_data, { a: 2, b: 1 });
  });
});

describe('fusión de los datos de especie', () => {
  it('cambios en campos distintos se combinan sin conflicto', () => {
    const result = mergeDailyLogContent({
      base: { ...base, species_data: { water: 3 } },
      local: { ...base, species_data: { water: 2 } },
      remote: { ...base, species_data: { water: 3, stool: 'soft' } },
    });
    assert.equal(result.status, 'merged');
    assert.deepEqual(result.content.species_data, { stool: 'soft', water: 2 });
  });

  it('el mismo campo cambiado a valores distintos es un conflicto; cada lado conserva lo que no chocaba', () => {
    const result = mergeDailyLogContent({
      base: { ...base, species_data: { water: 3 } },
      local: { ...base, species_data: { water: 2, vomit: true } },
      remote: { ...base, species_data: { water: 4, stool: 'soft' } },
    });
    assert.equal(result.status, 'conflict');
    const conflict = result.conflicts.find((item) => item.unit === 'species_data');
    assert.deepEqual(conflict.local.species_data, { stool: 'soft', vomit: true, water: 2 });
    assert.deepEqual(conflict.remote.species_data, { stool: 'soft', vomit: true, water: 4 });
    const resolved = buildResolvedContent(
      { base: { ...base, species_data: { water: 3 } }, local: { ...base, species_data: { water: 2, vomit: true } }, remote: { ...base, species_data: { water: 4, stool: 'soft' } } },
      'combine',
      { species_data: 'local' }
    );
    assert.equal(resolved.status, 'merged');
    assert.deepEqual(resolved.content.species_data, { stool: 'soft', vomit: true, water: 2 });
  });

  it('lo local sin indicar (versión anterior) acepta lo del servidor', () => {
    const result = mergeDailyLogContent({
      base: { ...base },
      local: { ...base, mood_level: 2 },
      remote: { ...base, species_data: { water: 4 } },
    });
    assert.equal(result.status, 'merged');
    assert.deepEqual(result.content.species_data, { water: 4 });
    assert.equal(result.content.mood_level, 2);
  });
});

describe('lectura de un rango a través del almacén local', () => {
  function fakeRepository(records) {
    const calls = [];
    return {
      calls,
      snapshotMark: () => 7,
      list: async (_petId, range) => records.filter((record) => record.logDate >= range.start && record.logDate <= range.end),
      refreshSnapshot: async (petId, logDate, value, since) => {
        calls.push({ logDate, value: value === null ? null : value.log_date, since });
        return value;
      },
    };
  }

  it('deja copia de cada fila y quita las confirmadas que ya no vienen; nunca toca lo pendiente', async () => {
    const repository = fakeRepository([
      { logDate: '2026-11-10', status: 'synced' },
      { logDate: '2026-11-09', status: 'pending' },
      { logDate: '2026-10-01', status: 'synced' },
    ]);
    const rows = await readRangeThroughRepository(repository, 'p', { start: '2026-11-01', end: '2026-11-11' }, async () => [
      row({ log_date: '2026-11-11' }),
    ]);
    assert.deepEqual(rows.map((item) => item.log_date), ['2026-11-11']);
    assert.deepEqual(repository.calls, [
      { logDate: '2026-11-11', value: '2026-11-11', since: 7 },
      // 2026-11-10 ya no existe en el servidor: se quita su copia (con la marca de lectura).
      { logDate: '2026-11-10', value: null, since: 7 },
    ]);
  });

  it('un error del servidor no toca nada', async () => {
    const repository = fakeRepository([{ logDate: '2026-11-10', status: 'synced' }]);
    await assert.rejects(
      readRangeThroughRepository(repository, 'p', { start: '2026-11-01', end: '2026-11-11' }, async () => {
        throw new Error('network');
      })
    );
    assert.equal(repository.calls.length, 0);
  });
});
