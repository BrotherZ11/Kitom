import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { diffSchedule, fingerprint, planNotifications } from '../notifications/notification-plan.ts';
import { formatReminderTime } from './reminder-format.ts';
import {
  effectiveDueAt,
  groupReminders,
  planCompletion,
  remindersOfPets,
  toReminderFormValues,
  toReminderWrite,
} from './reminder-model.ts';

/**
 * Zona horaria de la agenda (decisión 2026-10-28): cada recordatorio es un instante; cada dispositivo lo
 * muestra y avisa en su hora local. Si en España suena a las 12:00, al co-tutor de Londres le suena a
 * las 11:00 (el mismo momento). Node aplica `process.env.TZ` en caliente: cada prueba elige la zona del
 * «dispositivo».
 */

const originalTz = process.env.TZ;
const inZone = (zone, fn) => {
  process.env.TZ = zone;
  return fn();
};

beforeEach(() => {
  process.env.TZ = 'Europe/Madrid';
});
afterEach(() => {
  process.env.TZ = originalTz;
});

const PET = '11111111-1111-4111-8111-111111111111';
const reminder = (overrides = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  pet_id: PET,
  type: 'medication',
  title: 'Pastilla',
  description: null,
  due_at: '2026-11-02T11:00:00.000Z',
  snooze_until: null,
  recurrence_rule: null,
  status: 'pending',
  completed_at: null,
  attachment_path: null,
  created_by: null,
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

describe('el mismo instante en cada dispositivo', () => {
  it('apuntado a las 12:00 en España se guarda como instante y en Londres se ve a las 11:00', () => {
    const write = inZone('Europe/Madrid', () =>
      toReminderWrite({ type: 'medication', title: 'Pastilla', date: '2026-11-02', hour: 12, minute: 0, recurrence: 'NONE', notes: '' })
    );
    assert.equal(write.due_at, '2026-11-02T11:00:00.000Z');
    const stored = reminder({ due_at: write.due_at });
    assert.equal(inZone('Europe/Madrid', () => formatReminderTime(effectiveDueAt(stored))), '12:00');
    assert.equal(inZone('Europe/London', () => formatReminderTime(effectiveDueAt(stored))), '11:00');
    assert.equal(inZone('America/New_York', () => formatReminderTime(effectiveDueAt(stored))), '06:00');
  });

  it('el formulario de edición abre con la hora local de quien lo abre', () => {
    const stored = reminder();
    assert.deepEqual(
      inZone('Europe/London', () => toReminderFormValues(stored, { now: new Date() })),
      { type: 'medication', title: 'Pastilla', date: '2026-11-02', hour: 11, minute: 0, recurrence: 'NONE', notes: '' }
    );
  });

  it('el aviso es el mismo instante en todas las zonas; solo cambia el texto con la hora local', () => {
    const plan = () =>
      planNotifications({
        now: new Date('2026-11-01T08:00:00.000Z'),
        daily: null,
        reminders: [{ id: 'r1', petId: PET, title: 'Pastilla', at: effectiveDueAt(reminder()), petName: 'Kika' }],
        reminderBody: (item) => `Medicación · ${formatReminderTime(item.at)}`,
        visiblePetIds: new Set([PET]),
      });
    const madrid = inZone('Europe/Madrid', plan);
    const london = inZone('Europe/London', plan);
    assert.equal(madrid[0].date.toISOString(), london[0].date.toISOString());
    assert.equal(madrid[0].body, 'Medicación · 12:00');
    assert.equal(london[0].body, 'Medicación · 11:00');
    // Al cambiar de país, la huella cambia y el aviso se reprograma con el texto nuevo (mismo id).
    const scheduled = madrid.map((p) => ({ id: p.id, fingerprint: fingerprint(p) }));
    const { cancel, schedule } = diffSchedule(scheduled, london);
    assert.deepEqual(cancel, ['reminder:r1']);
    assert.deepEqual(schedule.map((p) => p.id), ['reminder:r1']);
  });
});

describe('repeticiones y cambios de hora', () => {
  it('uno diario de las 12:00 sigue a las 12:00 en España al acabar el horario de verano', () => {
    // 24 oct 2026, 12:00 CEST = 10:00Z; el 25 de octubre se atrasa la hora.
    const daily = reminder({ due_at: '2026-10-24T10:00:00.000Z', recurrence_rule: 'FREQ=DAILY' });
    const plan = inZone('Europe/Madrid', () => planCompletion(daily, new Date('2026-10-24T12:00:00.000Z')));
    assert.equal(plan.kind, 'advance');
    assert.equal(plan.patch.due_at, '2026-10-25T11:00:00.000Z');
    assert.equal(inZone('Europe/Madrid', () => formatReminderTime(new Date(plan.patch.due_at))), '12:00');
  });

  it('si lo marca hecho el co-tutor de Londres, la próxima vez es la misma que desde España', () => {
    const daily = reminder({ due_at: '2026-10-24T10:00:00.000Z', recurrence_rule: 'FREQ=DAILY' });
    const now = new Date('2026-10-24T12:00:00.000Z');
    const fromMadrid = inZone('Europe/Madrid', () => planCompletion(daily, now));
    const fromLondon = inZone('Europe/London', () => planCompletion(daily, now));
    assert.equal(fromLondon.patch.due_at, fromMadrid.patch.due_at);
  });

  it('límite conocido: con zonas que cambian de hora en fechas distintas, el avance depende de quién lo marca', () => {
    // 31 oct 2026, 12:00 Madrid (CET) = 11:00Z = 07:00 Nueva York (aún EDT). Nueva York atrasa la hora el 1 nov.
    const daily = reminder({ due_at: '2026-10-31T11:00:00.000Z', recurrence_rule: 'FREQ=DAILY' });
    const now = new Date('2026-10-31T12:00:00.000Z');
    const fromMadrid = inZone('Europe/Madrid', () => planCompletion(daily, now));
    const fromNewYork = inZone('America/New_York', () => planCompletion(daily, now));
    assert.equal(fromMadrid.patch.due_at, '2026-11-01T11:00:00.000Z');
    // Desde Nueva York sigue a las 07:00 locales: en España pasaría a sonar a las 13:00.
    assert.equal(fromNewYork.patch.due_at, '2026-11-01T12:00:00.000Z');
  });
});

describe('cambios de día según la zona', () => {
  // 2 nov 2026, 23:30 en Londres = 00:30 del 3 nov en Madrid.
  const lateNight = reminder({ due_at: '2026-11-02T23:30:00.000Z' });
  const now = new Date('2026-11-02T20:00:00.000Z');

  it('en Londres es de hoy; en Madrid, de mañana', () => {
    const london = inZone('Europe/London', () => groupReminders([lateNight], now));
    const madrid = inZone('Europe/Madrid', () => groupReminders([lateNight], now));
    assert.equal(london.today.length, 1);
    assert.equal(madrid.upcoming.length, 1);
  });

  it('pasada la medianoche local, lo de ayer sin hacer pasa a pendiente de días anteriores', () => {
    const yesterday = reminder({ due_at: '2026-11-02T22:30:00.000Z' });
    const after = new Date('2026-11-02T23:15:00.000Z'); // 00:15 del 3 nov en Madrid; 23:15 del 2 en Londres
    assert.equal(inZone('Europe/Madrid', () => groupReminders([yesterday], after)).overdue.length, 1);
    assert.equal(inZone('Europe/London', () => groupReminders([yesterday], after)).today.length, 1);
  });
});

describe('remindersOfPets', () => {
  it('deja fuera los recordatorios de mascotas que no se ven (eliminándose en el dispositivo)', () => {
    const own = reminder();
    const deleting = reminder({ id: '00000000-0000-4000-8000-000000000002', pet_id: '22222222-2222-4222-8222-222222222222' });
    assert.deepEqual(remindersOfPets([own, deleting], new Set([PET])), [own]);
    assert.deepEqual(remindersOfPets([own, deleting], new Set()), []);
  });
});
