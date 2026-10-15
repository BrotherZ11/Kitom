// Ayudantes compartidos por las pruebas del motor de sincronización (`npm test`): constantes, contenido,
// un «dispositivo» (almacén + motor con reloj y temporizadores falsos) y el servidor falso con una
// mascota editable. No es una prueba: lo importan los `*.test.mjs`.
import { randomUUID } from 'node:crypto';

import { createLocalStore } from '../../../lib/local-store/local-store.ts';
import { createMemoryStorage } from '../../../lib/local-store/memory-storage.ts';
import { createOperationIdGenerator } from '../../../lib/operation-id.ts';
import { createDailyLogRepository } from './daily-log-repository.ts';
import { createDailyLogSyncEngine } from './daily-log-sync-engine.ts';
import { createFakeServer } from './fake-daily-log-server.mjs';

export const USER = 'a0000000-0000-4000-8000-000000000001';
export const OTHER_USER = 'a0000000-0000-4000-8000-000000000002';
export const PET = 'b0000000-0000-4000-8000-000000000001';
export const DATE = '2026-10-15';
export const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);

export function content(overrides = {}) {
  return {
    energy_level: 3,
    appetite_level: 3,
    mood_level: 3,
    activity_level: null,
    sleep_quality: null,
    vocalization_level: null,
    social_interaction_level: null,
    unusual_behavior: false,
    unusual_behavior_notes: null,
    notes: null,
    tags: [],
    ...overrides,
  };
}

export const argsFor = (overrides = {}) => {
  const c = content(overrides);
  return {
    p_pet_id: PET,
    p_log_date: DATE,
    p_energy_level: c.energy_level,
    p_appetite_level: c.appetite_level,
    p_mood_level: c.mood_level,
    p_activity_level: c.activity_level,
    p_sleep_quality: c.sleep_quality,
    p_vocalization_level: c.vocalization_level,
    p_social_interaction_level: c.social_interaction_level,
    p_unusual_behavior: c.unusual_behavior,
    p_unusual_behavior_notes: c.unusual_behavior_notes,
    p_notes: c.notes,
    p_tags: c.tags,
  };
};

/** Un dispositivo: almacén (sobre `disk`), motor y conectividad propios. */
export function device(
  server,
  { userId = USER, disk = new Map(), storage = createMemoryStorage(disk), online = true, session = userId } = {}
) {
  const net = { online };
  const clock = { now: T0 };
  const timers = [];
  const ids = { count: 0 };
  const generate = createOperationIdGenerator(randomUUID);
  const repository = createDailyLogRepository(createLocalStore(storage, userId));
  const engine = createDailyLogSyncEngine({
    repository,
    remote: server.remoteFor(userId),
    isOnline: () => net.online,
    now: () => clock.now,
    createOperationId: () => {
      ids.count += 1;
      return generate();
    },
    random: () => 0.5,
    setTimer: (callback, ms) => {
      const timer = { callback, at: clock.now + ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  engine.start();
  engine.setSessionUserId(session);
  return {
    disk,
    net,
    clock,
    timers,
    ids,
    repository,
    engine,
    read: () => repository.read(PET, DATE),
    /** Guardar como el formulario y esperar a la pasada de sincronización que dispara. */
    async save(overrides = {}, baseRow = null) {
      const saved = await engine.saveLocal({ petId: PET, logDate: DATE, content: content(overrides), baseRow });
      await engine.idle();
      return saved;
    },
    /** Avanza el reloj y ejecuta los temporizadores vencidos. */
    async advance(ms) {
      clock.now += ms;
      for (const timer of timers.filter((item) => item.at <= clock.now)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.callback();
      }
      await engine.requestSync();
    },
  };
}

export const saves = (server) => server.calls.filter((call) => call.type === 'save');
export const noTimers = { setTimer: () => null, clearTimer: () => {} };

export function serverWithPet() {
  const server = createFakeServer();
  server.allowEditor(PET, USER);
  return server;
}
