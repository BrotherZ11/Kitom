// Pruebas de `daily-log-repository.ts` con el almacén en memoria (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { DailyLogRepositoryError, createDailyLogRepository } from './daily-log-repository.ts';
import { applyLocalEdit } from './local-daily-log.ts';

const USER = 'a0000000-0000-4000-8000-000000000001';
const PET = 'b0000000-0000-4000-8000-000000000001';
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';
const DATE = '2026-10-15';
const KEY = `kitom:v1:${USER}:daily-logs:${PET}:${DATE}`;

const content = (overrides = {}) => ({
  energy_level: 3,
  appetite_level: null,
  mood_level: null,
  activity_level: null,
  sleep_quality: null,
  vocalization_level: null,
  social_interaction_level: null,
  unusual_behavior: false,
  unusual_behavior_notes: null,
  notes: null,
  tags: [],
  ...overrides,
});

const row = (overrides = {}) => ({
  id: 'c0000000-0000-4000-8000-000000000001',
  pet_id: PET,
  logged_by: USER,
  last_edited_by: null,
  log_date: DATE,
  ...content(),
  created_at: '2026-10-15T08:00:00.123456+00:00',
  updated_at: '2026-10-15T09:00:00.5+00:00',
  ...overrides,
});

function setup(disk = new Map()) {
  return { disk, repository: createDailyLogRepository(createLocalStore(createMemoryStorage(disk), USER)) };
}

const edit = (current, overrides = {}, baseRow = null) =>
  applyLocalEdit(
    current,
    { userId: USER, petId: PET, logDate: DATE, content: content(overrides), baseRow },
    { now: 1, createOperationId: randomUUID }
  );

describe('createDailyLogRepository', () => {
  it('lee, escribe, lista y avisa de cada cambio', async () => {
    const { repository } = setup();
    const changes = [];
    const unsubscribe = repository.subscribe((change) => changes.push(change));

    assert.equal(await repository.read(PET, DATE), null);
    const saved = await repository.update(PET, DATE, (current) => edit(current, { notes: 'a' }));
    assert.deepEqual(await repository.read(PET, DATE), saved);
    await repository.update(OTHER_PET, DATE, (current) =>
      applyLocalEdit(
        current,
        { userId: USER, petId: OTHER_PET, logDate: DATE, content: content(), baseRow: null },
        { now: 1, createOperationId: randomUUID }
      )
    );
    assert.equal((await repository.list()).length, 2);
    assert.equal((await repository.list(PET)).length, 1);
    assert.deepEqual(changes.map((change) => change.petId), [PET, OTHER_PET]);

    unsubscribe();
    await repository.update(PET, DATE, () => null);
    assert.equal(changes.length, 2);
    assert.equal(await repository.read(PET, DATE), null);
  });

  it('devolver el mismo registro no escribe ni avisa', async () => {
    const { repository, disk } = setup();
    await repository.update(PET, DATE, (current) => edit(current));
    const before = disk.get(KEY);
    let changes = 0;
    repository.subscribe(() => (changes += 1));
    await repository.update(PET, DATE, (current) => current);
    assert.equal(changes, 0);
    assert.equal(disk.get(KEY), before);
  });

  it('las actualizaciones simultáneas se ejecutan de una en una (ninguna se pierde)', async () => {
    const { repository } = setup();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.update(PET, DATE, (current) => edit(current, { energy_level: (index % 5) + 1 }))
      )
    );
    assert.equal((await repository.read(PET, DATE)).pending.revision, 10);
  });

  it('un fallo dentro de una actualización no bloquea las siguientes', async () => {
    const { repository } = setup();
    await assert.rejects(
      repository.update(PET, DATE, () => {
        throw new Error('boom');
      })
    );
    await repository.update(PET, DATE, (current) => edit(current));
    assert.notEqual(await repository.read(PET, DATE), null);
  });
});

describe('copia local de la fila del servidor', () => {
  it('guarda la fila como sincronizada y la sustituye solo si cambia la versión', async () => {
    const { repository, disk } = setup();
    await repository.refreshSnapshot(PET, DATE, row());
    const local = await repository.read(PET, DATE);
    assert.equal(local.status, 'synced');
    assert.equal(local.baseVersion, '2026-10-15T09:00:00.5+00:00');

    const before = disk.get(KEY);
    await repository.refreshSnapshot(PET, DATE, row());
    assert.equal(disk.get(KEY), before);
    await repository.refreshSnapshot(PET, DATE, row({ notes: 'nuevo', updated_at: '2026-10-15T10:00:00.25+00:00' }));
    assert.equal((await repository.read(PET, DATE)).serverRow.notes, 'nuevo');
  });

  it('si el servidor ya no tiene la fila, la copia se borra', async () => {
    const { repository } = setup();
    await repository.refreshSnapshot(PET, DATE, row());
    await repository.refreshSnapshot(PET, DATE, null);
    assert.equal(await repository.read(PET, DATE), null);
  });

  it('nunca toca una operación pendiente ni su versión base', async () => {
    const { repository } = setup();
    const base = row();
    const pending = await repository.update(PET, DATE, (current) => edit(current, { notes: 'mío' }, base));
    await repository.refreshSnapshot(PET, DATE, row({ notes: 'del servidor', updated_at: '2026-10-15T11:00:00+00:00' }));
    await repository.refreshSnapshot(PET, DATE, null);
    assert.deepEqual(await repository.read(PET, DATE), pending);
  });
});

describe('datos ilegibles', () => {
  it('un registro corrupto cuenta como ausente y se puede sobrescribir', async () => {
    const { repository, disk } = setup(new Map([[`kitom:v1:${USER}:daily-logs:${PET}:${DATE}`, '{roto']]));
    assert.equal(await repository.read(PET, DATE), null);
    assert.deepEqual(await repository.list(), []);
    await repository.update(PET, DATE, (current) => edit(current));
    assert.equal((await repository.read(PET, DATE)).status, 'pending');
    assert.equal(disk.size, 1);
  });

  it('un registro de otra versión de la app no se sobrescribe', async () => {
    const raw = JSON.stringify({ v: 99, data: {} });
    const { repository, disk } = setup(new Map([[KEY, raw]]));
    assert.equal(await repository.read(PET, DATE), null);
    await assert.rejects(
      repository.update(PET, DATE, (current) => edit(current)),
      (error) => error instanceof DailyLogRepositoryError && error.code === 'unknown_version'
    );
    await assert.rejects(repository.refreshSnapshot(PET, DATE, row()), DailyLogRepositoryError);
    assert.equal(disk.get(KEY), raw);
  });
});
