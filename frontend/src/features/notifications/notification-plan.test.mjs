import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dailyLogDates,
  diffSchedule,
  fingerprint,
  formatTimeOfDay,
  MAX_SCHEDULED,
  parseTimeOfDay,
  planNotifications,
  reminderNotifyState,
  toTimeColumn,
} from './notification-plan.ts';

const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

describe('hora del día', () => {
  it('lee la columna time y la vuelve a escribir', () => {
    assert.deepEqual(parseTimeOfDay('20:00:00'), { hour: 20, minute: 0 });
    assert.deepEqual(parseTimeOfDay('7:05'), { hour: 7, minute: 5 });
    assert.equal(parseTimeOfDay('24:00'), null);
    assert.equal(parseTimeOfDay(null), null);
    assert.equal(toTimeColumn({ hour: 7, minute: 5 }), '07:05:00');
    assert.equal(formatTimeOfDay({ hour: 20, minute: 0 }), '20:00');
  });
});

describe('dailyLogDates', () => {
  const time = { hour: 20, minute: 0 };

  it('hoy (si aún no ha pasado la hora) y los días siguientes', () => {
    const dates = dailyLogDates(at(2026, 10, 16, 12), time, { loggedToday: false, days: 3 });
    assert.deepEqual(
      dates.map((d) => d.getTime()),
      [at(2026, 10, 16, 20), at(2026, 10, 17, 20), at(2026, 10, 18, 20)].map((d) => d.getTime())
    );
  });

  it('se salta hoy si ya está registrado o la hora ya pasó', () => {
    assert.equal(dailyLogDates(at(2026, 10, 16, 12), time, { loggedToday: true, days: 3 }).length, 2);
    assert.equal(dailyLogDates(at(2026, 10, 16, 21), time, { loggedToday: false, days: 3 })[0].getTime(), at(2026, 10, 17, 20).getTime());
  });
});

describe('planNotifications', () => {
  const now = at(2026, 10, 16, 12);
  const daily = { time: { hour: 20, minute: 0 }, loggedToday: false, title: 'Día', body: 'Registra', url: '/' };
  const body = (r) => `a las ${r.at.getHours()}`;
  const visiblePetIds = new Set(['p1']);

  it('mezcla el diario y la agenda por fecha; ignora lo que ya pasó', () => {
    const planned = planNotifications({
      now,
      daily: { ...daily },
      reminders: [
        { id: 'r1', petId: 'p1', title: 'Vacuna', at: at(2026, 10, 16, 17), petName: 'Kika' },
        { id: 'r2', petId: 'p1', title: 'Pasado', at: at(2026, 10, 16, 9), petName: 'Kika' },
      ],
      reminderBody: body,
      visiblePetIds,
    });
    assert.equal(planned[0].id, 'reminder:r1');
    assert.equal(planned[0].title, 'Kika · Vacuna');
    assert.equal(planned[0].url, '/reminders/r1');
    assert.equal(planned[0].body, 'a las 17');
    assert.equal(planned[1].id, 'daily-log:2026-10-16');
    assert.ok(!planned.some((p) => p.id === 'reminder:r2'));
  });

  it('sin diario (desactivado), solo la agenda; con tope', () => {
    const reminders = Array.from({ length: MAX_SCHEDULED + 5 }, (_, i) => ({
      id: `r${i}`,
      petId: 'p1',
      title: 'x',
      at: at(2026, 10, 17 + i),
      petName: null,
    }));
    const planned = planNotifications({ now, daily: null, reminders, reminderBody: body, visiblePetIds });
    assert.equal(planned.length, MAX_SCHEDULED);
    assert.equal(planned[0].title, 'x');
    assert.ok(planned.every((p) => p.id.startsWith('reminder:')));
  });

  it('no programa los recordatorios de una mascota que se está eliminando (o que ya no se ve)', () => {
    const planned = planNotifications({
      now,
      daily: null,
      reminders: [
        { id: 'r1', petId: 'p1', title: 'Vacuna', at: at(2026, 10, 17), petName: 'Kika' },
        // Mascota con eliminación guardada en el dispositivo: el servidor aún devuelve su recordatorio.
        { id: 'r2', petId: 'p-borrandose', title: 'Baño', at: at(2026, 10, 17, 11), petName: null },
      ],
      reminderBody: body,
      visiblePetIds,
    });
    assert.deepEqual(planned.map((p) => p.id), ['reminder:r1']);
  });
});

describe('ciclo de vida de los avisos de la agenda', () => {
  const now = at(2026, 10, 16, 12);
  const body = (r) => `a las ${r.at.getHours()}`;
  const plan = (reminders, visible = ['p1']) =>
    planNotifications({ now, daily: null, reminders, reminderBody: body, visiblePetIds: new Set(visible) });
  const vacuna = { id: 'r1', petId: 'p1', title: 'Vacuna', at: at(2026, 10, 17, 10), petName: 'Kika' };
  const bano = { id: 'r2', petId: 'p1', title: 'Baño', at: at(2026, 10, 18, 9), petName: 'Kika' };
  /** Lo que quedaría programado tras aplicar el plan (como `syncScheduledNotifications`). */
  const applied = (planned) => planned.map((p) => ({ id: p.id, fingerprint: fingerprint(p) }));

  it('al reiniciar la app (o volver a sincronizar) con los mismos datos no se duplica ni se reprograma nada', () => {
    const first = plan([vacuna, bano]);
    const again = plan([{ ...vacuna }, { ...bano }]);
    assert.deepEqual(diffSchedule(applied(first), again), { cancel: [], schedule: [] });
  });

  it('un identificador por recordatorio: cambiar la hora reemplaza el aviso (cancela y programa el mismo id)', () => {
    const before = applied(plan([vacuna]));
    const moved = plan([{ ...vacuna, at: at(2026, 10, 17, 18) }]);
    const { cancel, schedule } = diffSchedule(before, moved);
    assert.deepEqual(cancel, ['reminder:r1']);
    assert.deepEqual(schedule.map((p) => [p.id, p.date.getHours()]), [['reminder:r1', 18]]);
  });

  it('al borrarlo, marcarlo hecho o desactivarlo (deja de llegar del servidor) se cancela su aviso', () => {
    const before = applied(plan([vacuna, bano]));
    assert.deepEqual(diffSchedule(before, plan([bano])), { cancel: ['reminder:r1'], schedule: [] });
  });

  it('al guardar la eliminación de la mascota se cancelan sus avisos; al deshacerla vuelven', () => {
    const before = applied(plan([vacuna, bano]));
    const hidden = diffSchedule(before, plan([vacuna, bano], []));
    assert.deepEqual(hidden.cancel.sort(), ['reminder:r1', 'reminder:r2']);
    assert.deepEqual(hidden.schedule, []);
    const restored = diffSchedule([], plan([vacuna, bano]));
    assert.equal(restored.schedule.length, 2);
  });

  it('al cambiar de cuenta, el plan de la nueva cancela los avisos de la anterior', () => {
    const before = applied(plan([vacuna, bano]));
    const otherAccount = plan([{ id: 'r9', petId: 'p9', title: 'Cita', at: at(2026, 10, 19), petName: 'Rex' }], ['p9']);
    const { cancel, schedule } = diffSchedule([...before, { id: 'otra-app', fingerprint: null }], otherAccount);
    assert.deepEqual(cancel.sort(), ['reminder:r1', 'reminder:r2']);
    assert.deepEqual(schedule.map((p) => p.id), ['reminder:r9']);
  });
});

describe('diffSchedule', () => {
  const a = { id: 'reminder:a', date: at(2026, 10, 17), title: 'A', body: 'b', url: '/reminders/a' };
  const b = { id: 'daily-log:2026-10-17', date: at(2026, 10, 17, 20), title: 'D', body: 'b', url: '/' };

  it('deja lo que no cambia, reprograma lo cambiado y cancela lo que sobra', () => {
    const scheduled = [
      { id: 'reminder:a', fingerprint: fingerprint(a) },
      { id: 'daily-log:2026-10-17', fingerprint: 'antigua' },
      { id: 'reminder:gone', fingerprint: 'x' },
      { id: 'otra-app', fingerprint: null },
    ];
    const { cancel, schedule } = diffSchedule(scheduled, [a, b]);
    assert.deepEqual(cancel.sort(), ['daily-log:2026-10-17', 'reminder:gone']);
    assert.deepEqual(schedule, [b]);
  });

  it('si cambia el modo (p. ej. pasan a ser exactos), se reprograma todo', () => {
    const scheduled = [{ id: 'reminder:a', fingerprint: fingerprint(a, 'inexact') }];
    const { cancel, schedule } = diffSchedule(scheduled, [a], 'exact');
    assert.deepEqual(cancel, ['reminder:a']);
    assert.deepEqual(schedule, [a]);
    assert.deepEqual(diffSchedule(scheduled, [a], 'inexact'), { cancel: [], schedule: [] });
  });
});

describe('reminderNotifyState', () => {
  const now = at(2026, 10, 16, 12);
  const base = { unavailable: null, permission: 'granted', pending: true, at: at(2026, 10, 17), now, petDeleting: false };

  it('solo dice que avisará con permiso, en móvil y con la hora por delante', () => {
    assert.equal(reminderNotifyState(base), 'on');
    assert.equal(reminderNotifyState({ ...base, permission: 'denied' }), 'off');
    assert.equal(reminderNotifyState({ ...base, permission: 'undetermined' }), 'off');
    assert.equal(reminderNotifyState({ ...base, permission: null }), 'off');
  });

  it('en web o sin el módulo nativo no promete avisos', () => {
    assert.equal(reminderNotifyState({ ...base, unavailable: 'web', permission: 'unavailable' }), 'web');
    assert.equal(reminderNotifyState({ ...base, unavailable: 'unavailable', permission: 'unavailable' }), 'unavailable');
  });

  it('si la hora ya pasó, la mascota se está eliminando o ya está hecho, no hay aviso', () => {
    assert.equal(reminderNotifyState({ ...base, at: at(2026, 10, 16, 9) }), 'past');
    assert.equal(reminderNotifyState({ ...base, at: now }), 'past');
    assert.equal(reminderNotifyState({ ...base, petDeleting: true }), 'pet_deleting');
    assert.equal(reminderNotifyState({ ...base, pending: false }), 'none');
  });
});
