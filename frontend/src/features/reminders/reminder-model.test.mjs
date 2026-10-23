import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  effectiveDueAt,
  groupReminders,
  isReminderFormDirty,
  localDateKey,
  localDateTime,
  nextOccurrence,
  nextPendingReminder,
  parseRecurrence,
  planCompletion,
  reminderDaysInRange,
  snoozeUntil,
  toRecurrenceRule,
  toReminderFormValues,
  toReminderWrite,
  validateReminderForm,
} from './reminder-model.ts';

// Fechas locales (independientes de la zona del proceso que ejecuta los tests).
const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

let seq = 0;
function reminder(overrides = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    pet_id: '11111111-1111-4111-8111-111111111111',
    type: 'vaccine',
    title: `R${seq}`,
    description: null,
    due_at: at(2026, 10, 16).toISOString(),
    snooze_until: null,
    recurrence_rule: null,
    status: 'pending',
    completed_at: null,
    attachment_path: null,
    created_by: null,
    created_at: at(2026, 10, 1).toISOString(),
    updated_at: at(2026, 10, 1).toISOString(),
    ...overrides,
  };
}

describe('parseRecurrence / toRecurrenceRule', () => {
  it('lee la frecuencia de la regla y escribe solo FREQ', () => {
    assert.equal(parseRecurrence('FREQ=YEARLY'), 'YEARLY');
    assert.equal(parseRecurrence('FREQ=WEEKLY;INTERVAL=2'), 'WEEKLY');
    assert.equal(parseRecurrence(null), 'NONE');
    assert.equal(parseRecurrence('RRULE:FREQ=DAILY'), 'NONE');
    assert.equal(toRecurrenceRule('MONTHLY'), 'FREQ=MONTHLY');
    assert.equal(toRecurrenceRule('NONE'), null);
  });
});

describe('nextOccurrence', () => {
  it('suma un día, una semana, un mes o un año a la misma hora local', () => {
    const from = at(2026, 10, 16, 21, 30);
    assert.equal(nextOccurrence(from, 'DAILY').getTime(), at(2026, 10, 17, 21, 30).getTime());
    assert.equal(nextOccurrence(from, 'WEEKLY').getTime(), at(2026, 10, 23, 21, 30).getTime());
    assert.equal(nextOccurrence(from, 'MONTHLY').getTime(), at(2026, 11, 16, 21, 30).getTime());
    assert.equal(nextOccurrence(from, 'YEARLY').getTime(), at(2027, 10, 16, 21, 30).getTime());
    assert.equal(nextOccurrence(from, 'NONE'), null);
  });

  it('un mensual del 31 pasa al último día del mes corto, y diciembre a enero', () => {
    assert.equal(nextOccurrence(at(2026, 1, 31), 'MONTHLY').getTime(), at(2026, 2, 28).getTime());
    assert.equal(nextOccurrence(at(2026, 12, 15), 'MONTHLY').getTime(), at(2027, 1, 15).getTime());
  });

  it('un anual del 29 de febrero pasa al 28', () => {
    assert.equal(nextOccurrence(at(2028, 2, 29), 'YEARLY').getTime(), at(2029, 2, 28).getTime());
  });
});

describe('effectiveDueAt', () => {
  it('usa el aplazamiento solo si es posterior a la fecha prevista', () => {
    const due = at(2026, 10, 16, 10);
    const later = at(2026, 10, 16, 11);
    assert.equal(effectiveDueAt({ due_at: due.toISOString(), snooze_until: later.toISOString() }).getTime(), later.getTime());
    assert.equal(
      effectiveDueAt({ due_at: due.toISOString(), snooze_until: at(2026, 10, 15).toISOString() }).getTime(),
      due.getTime()
    );
    assert.equal(effectiveDueAt({ due_at: due.toISOString(), snooze_until: null }).getTime(), due.getTime());
  });
});

describe('groupReminders', () => {
  const now = at(2026, 10, 16, 12);

  it('separa vencidos, hoy, próximos y hechos', () => {
    const late = reminder({ due_at: at(2026, 10, 15, 9).toISOString() });
    const todayLater = reminder({ due_at: at(2026, 10, 16, 21).toISOString() });
    const todayEarlier = reminder({ due_at: at(2026, 10, 16, 8).toISOString() });
    const doneToday = reminder({ status: 'completed', completed_at: at(2026, 10, 16, 9).toISOString() });
    const next = reminder({ due_at: at(2026, 10, 18).toISOString() });
    const doneBefore = reminder({ status: 'completed', completed_at: at(2026, 10, 10).toISOString() });
    const groups = groupReminders([next, doneBefore, todayLater, late, doneToday, todayEarlier], now);
    assert.deepEqual(groups.overdue, [late]);
    assert.deepEqual(groups.today, [todayEarlier, todayLater, doneToday]);
    assert.deepEqual(groups.upcoming, [next]);
    assert.deepEqual(groups.done, [doneBefore]);
  });

  it('un vencido pospuesto a hoy sale en hoy', () => {
    const snoozed = reminder({
      due_at: at(2026, 10, 15).toISOString(),
      snooze_until: at(2026, 10, 16, 18).toISOString(),
    });
    assert.deepEqual(groupReminders([snoozed], now).today, [snoozed]);
  });
});

describe('nextPendingReminder', () => {
  it('el pendiente más próximo (los vencidos primero); null sin pendientes', () => {
    const a = reminder({ due_at: at(2026, 10, 20).toISOString() });
    const b = reminder({ due_at: at(2026, 10, 14).toISOString() });
    const c = reminder({ status: 'completed', due_at: at(2026, 10, 1).toISOString() });
    assert.equal(nextPendingReminder([a, b, c]), b);
    assert.equal(nextPendingReminder([c]), null);
  });
});

describe('reminderDaysInRange', () => {
  const start = at(2026, 10, 1, 0);
  const end = at(2026, 11, 1, 0);

  it('un recordatorio sin repetición cae en su día', () => {
    assert.deepEqual(reminderDaysInRange(reminder({ due_at: at(2026, 10, 28).toISOString() }), start, end), ['2026-10-28']);
    assert.deepEqual(reminderDaysInRange(reminder({ due_at: at(2026, 11, 2).toISOString() }), start, end), []);
  });

  it('un semanal pendiente proyecta las siguientes semanas del mes', () => {
    const weekly = reminder({ due_at: at(2026, 10, 9).toISOString(), recurrence_rule: 'FREQ=WEEKLY' });
    assert.deepEqual(reminderDaysInRange(weekly, start, end), ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  });

  it('uno hecho solo cuenta el día en que se hizo', () => {
    const done = reminder({ status: 'completed', completed_at: at(2026, 10, 5).toISOString(), recurrence_rule: 'FREQ=DAILY' });
    assert.deepEqual(reminderDaysInRange(done, start, end), ['2026-10-05']);
  });
});

describe('snoozeUntil', () => {
  const now = at(2026, 10, 16, 12, 15);
  const r = { due_at: at(2026, 10, 16, 9, 30).toISOString() };

  it('una hora desde ahora; mañana o en una semana, a la hora prevista', () => {
    assert.equal(snoozeUntil('hour', r, now).getTime(), at(2026, 10, 16, 13, 15).getTime());
    assert.equal(snoozeUntil('tomorrow', r, now).getTime(), at(2026, 10, 17, 9, 30).getTime());
    assert.equal(snoozeUntil('week', r, now).getTime(), at(2026, 10, 23, 9, 30).getTime());
  });
});

describe('planCompletion', () => {
  const now = at(2026, 10, 16, 12);

  it('sin repetición: completed y deshacer vuelve a pending', () => {
    const plan = planCompletion({ due_at: at(2026, 10, 16).toISOString(), snooze_until: null, recurrence_rule: null }, now);
    assert.deepEqual(plan, { kind: 'complete', patch: { status: 'completed' }, undo: { status: 'pending' } });
  });

  it('con repetición: avanza a la próxima vez futura y deshacer restaura fecha y aplazamiento', () => {
    const due = at(2026, 10, 10, 9).toISOString();
    const snooze = at(2026, 10, 16, 18).toISOString();
    const plan = planCompletion({ due_at: due, snooze_until: snooze, recurrence_rule: 'FREQ=DAILY' }, now);
    assert.equal(plan.kind, 'advance');
    // Del 10 a las 9:00, saltando las que ya pasaron: el 17 a las 9:00.
    assert.equal(plan.next.getTime(), at(2026, 10, 17, 9).getTime());
    assert.deepEqual(plan.patch, { due_at: at(2026, 10, 17, 9).toISOString(), snooze_until: null });
    assert.deepEqual(plan.undo, { due_at: due, snooze_until: snooze });
  });
});

describe('formulario', () => {
  const now = at(2026, 10, 16, 12);

  it('localDateTime rechaza fechas imposibles', () => {
    assert.equal(localDateTime('2026-02-30', 10, 0), null);
    assert.equal(localDateTime('x', 10, 0), null);
    assert.equal(localDateTime('2026-10-28', 17, 30).getTime(), at(2026, 10, 28, 17, 30).getTime());
  });

  it('valores iniciales de uno nuevo: mañana a las 10:00, sin repetición', () => {
    const values = toReminderFormValues(null, { now, type: 'medication' });
    assert.deepEqual(values, {
      type: 'medication',
      title: '',
      date: '2026-10-17',
      hour: 10,
      minute: 0,
      recurrence: 'NONE',
      notes: '',
    });
  });

  it('valores de uno existente y vuelta a columnas', () => {
    const existing = reminder({
      due_at: at(2026, 10, 28, 17, 30).toISOString(),
      recurrence_rule: 'FREQ=YEARLY',
      description: 'Llevar la cartilla',
      title: 'Vacuna anual',
    });
    const values = toReminderFormValues(existing, { now });
    assert.equal(values.date, '2026-10-28');
    assert.equal(values.hour, 17);
    assert.equal(values.minute, 30);
    assert.equal(values.recurrence, 'YEARLY');
    assert.deepEqual(toReminderWrite({ ...values, title: '  Vacuna anual  ', notes: ' ' }), {
      type: 'vaccine',
      title: 'Vacuna anual',
      description: null,
      due_at: at(2026, 10, 28, 17, 30).toISOString(),
      recurrence_rule: 'FREQ=YEARLY',
    });
    assert.equal(isReminderFormDirty(values, values), false);
    assert.equal(isReminderFormDirty(values, { ...values, minute: 45 }), true);
  });

  it('valida título, notas y fecha (nuevo en el pasado no; editar sí)', () => {
    const base = toReminderFormValues(null, { now });
    assert.deepEqual(validateReminderForm({ ...base, title: 'Pastilla' }, { now, isNew: true }), {});
    assert.equal(validateReminderForm({ ...base, title: '  ' }, { now, isNew: true }).title, 'required');
    assert.equal(validateReminderForm({ ...base, title: 'x'.repeat(81) }, { now, isNew: true }).title, 'too_long');
    assert.equal(validateReminderForm({ ...base, title: 'x', notes: 'y'.repeat(501) }, { now, isNew: true }).notes, 'too_long');
    const past = { ...base, title: 'x', date: '2026-10-15' };
    assert.equal(validateReminderForm(past, { now, isNew: true }).date, 'past');
    assert.deepEqual(validateReminderForm(past, { now, isNew: false }), {});
  });

  it('localDateKey usa el día local', () => {
    assert.equal(localDateKey(at(2026, 1, 5, 23, 59)), '2026-01-05');
  });
});
