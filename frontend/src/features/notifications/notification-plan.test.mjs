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

  it('mezcla el diario y la agenda por fecha; ignora lo que ya pasó', () => {
    const planned = planNotifications({
      now,
      daily: { ...daily },
      reminders: [
        { id: 'r1', title: 'Vacuna', at: at(2026, 10, 16, 17), petName: 'Kika' },
        { id: 'r2', title: 'Pasado', at: at(2026, 10, 16, 9), petName: 'Kika' },
      ],
      reminderBody: body,
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
      title: 'x',
      at: at(2026, 10, 17 + i),
      petName: null,
    }));
    const planned = planNotifications({ now, daily: null, reminders, reminderBody: body });
    assert.equal(planned.length, MAX_SCHEDULED);
    assert.equal(planned[0].title, 'x');
    assert.ok(planned.every((p) => p.id.startsWith('reminder:')));
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
