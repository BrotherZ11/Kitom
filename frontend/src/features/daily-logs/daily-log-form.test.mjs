// Pruebas de `daily-log-form.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DAILY_LOG_TAGS,
  SCALE_FIELDS,
  dailyLogEditorReducer,
  emptyDailyLogForm,
  initialDailyLogEditorState,
  setAllAsUsual,
  setScale,
  toDailyLogFormValues,
  toSaveDailyLogArgs,
  toggleTag,
  validateDailyLogForm,
} from './daily-log-form.ts';

const PET_ID = 'b0000000-0000-4000-8000-000000000001';
const LOG_DATE = '2026-10-09';

/** Fila de `daily_logs` tal como la devuelven la consulta y la RPC. */
function savedLog(overrides = {}) {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    pet_id: PET_ID,
    logged_by: 'a0000000-0000-4000-8000-000000000001',
    last_edited_by: null,
    log_date: LOG_DATE,
    energy_level: 4,
    appetite_level: null,
    mood_level: 2,
    activity_level: null,
    sleep_quality: 5,
    vocalization_level: null,
    social_interaction_level: null,
    unusual_behavior: true,
    unusual_behavior_notes: 'Ladra a la puerta',
    notes: 'Paseo largo',
    tags: ['vet_visit'],
    created_at: '2026-10-09T08:00:00Z',
    updated_at: '2026-10-09T08:00:00Z',
    ...overrides,
  };
}

const PROTECTED_KEYS = ['id', 'logged_by', 'last_edited_by', 'created_at', 'updated_at'];
const RPC_PARAMS = [
  'p_pet_id', 'p_log_date', 'p_energy_level', 'p_appetite_level', 'p_mood_level', 'p_activity_level',
  'p_sleep_quality', 'p_vocalization_level', 'p_social_interaction_level', 'p_unusual_behavior',
  'p_unusual_behavior_notes', 'p_notes', 'p_tags',
];

describe('formulario inicial', () => {
  it('sin registro: todo vacío y ninguna escala en 3', () => {
    const values = toDailyLogFormValues(null);
    assert.deepEqual(values, emptyDailyLogForm());
    for (const field of SCALE_FIELDS) assert.equal(values.scales[field], null);
    assert.equal(values.unusualBehavior, false);
    assert.deepEqual(values.tags, []);
  });

  it('un formulario vacío no se puede guardar', () => {
    assert.equal(validateDailyLogForm(emptyDailyLogForm()), 'empty');
  });

  it('carga un registro existente', () => {
    const values = toDailyLogFormValues(savedLog());
    assert.equal(values.scales.energy, 4);
    assert.equal(values.scales.appetite, null);
    assert.equal(values.scales.mood, 2);
    assert.equal(values.scales.sleep, 5);
    assert.equal(values.unusualBehavior, true);
    assert.equal(values.unusualBehaviorNotes, 'Ladra a la puerta');
    assert.equal(values.notes, 'Paseo largo');
    assert.deepEqual(values.tags, ['vet_visit']);
  });

  it('ignora valores fuera de rango y tags desconocidos de la fila', () => {
    const values = toDailyLogFormValues(savedLog({ energy_level: 9, tags: ['vet_visit', 'birthday'] }));
    assert.equal(values.scales.energy, null);
    assert.deepEqual(values.tags, ['vet_visit']);
  });
});

describe('Todo como siempre', () => {
  it('pone las 7 escalas en 3 y no toca lo opcional', () => {
    const before = { ...emptyDailyLogForm(), notes: 'algo', tags: ['new_pet'] };
    const after = setAllAsUsual(before);
    assert.equal(SCALE_FIELDS.length, 7);
    for (const field of SCALE_FIELDS) assert.equal(after.scales[field], 3);
    assert.equal(after.notes, 'algo');
    assert.deepEqual(after.tags, ['new_pet']);
    assert.equal(after.unusualBehavior, false);
  });

  it('no guarda: solo cambia el formulario (estado idle, sin saving)', () => {
    const state = initialDailyLogEditorState(null);
    const next = dailyLogEditorReducer(state, { type: 'edit', update: setAllAsUsual });
    assert.equal(next.status, 'idle');
    for (const field of SCALE_FIELDS) assert.equal(next.values.scales[field], 3);
  });
});

describe('tags', () => {
  it('solo del catálogo cerrado', () => {
    assert.deepEqual([...DAILY_LOG_TAGS], ['vet_visit', 'home_change', 'new_pet']);
    let values = emptyDailyLogForm();
    values = toggleTag(values, 'birthday');
    values = toggleTag(values, '');
    values = toggleTag(values, null);
    assert.deepEqual(values.tags, []);
  });

  it('añade y quita, en el orden del catálogo y sin duplicados', () => {
    let values = emptyDailyLogForm();
    values = toggleTag(values, 'new_pet');
    values = toggleTag(values, 'vet_visit');
    assert.deepEqual(values.tags, ['vet_visit', 'new_pet']);
    values = toggleTag(values, 'new_pet');
    assert.deepEqual(values.tags, ['vet_visit']);
  });
});

describe('payload de save_daily_log', () => {
  it('tiene exactamente los parámetros de la RPC y ningún campo protegido', () => {
    const args = toSaveDailyLogArgs(PET_ID, LOG_DATE, setAllAsUsual(emptyDailyLogForm()));
    assert.deepEqual(Object.keys(args).sort(), [...RPC_PARAMS].sort());
    for (const key of PROTECTED_KEYS) assert.equal(key in args, false, key);
    assert.equal(args.p_pet_id, PET_ID);
    assert.equal(args.p_log_date, LOG_DATE);
  });

  it('conserva los null: escalas sin indicar y notas vacías', () => {
    const values = setScale(emptyDailyLogForm(), 'mood', 4);
    const args = toSaveDailyLogArgs(PET_ID, LOG_DATE, { ...values, notes: '   ' });
    assert.equal(args.p_mood_level, 4);
    for (const key of ['p_energy_level', 'p_appetite_level', 'p_activity_level', 'p_sleep_quality',
      'p_vocalization_level', 'p_social_interaction_level', 'p_notes', 'p_unusual_behavior_notes']) {
      assert.equal(args[key], null, key);
    }
    assert.equal(args.p_unusual_behavior, false);
    assert.deepEqual(args.p_tags, []);
  });

  it('la nota de comportamiento inusual solo se envía con el interruptor activado', () => {
    const values = { ...setScale(emptyDailyLogForm(), 'mood', 3), unusualBehaviorNotes: 'texto' };
    assert.equal(toSaveDailyLogArgs(PET_ID, LOG_DATE, values).p_unusual_behavior_notes, null);
    const on = { ...values, unusualBehavior: true };
    assert.equal(toSaveDailyLogArgs(PET_ID, LOG_DATE, on).p_unusual_behavior_notes, 'texto');
  });

  it('editar un registro existente envía el registro completo con los cambios', () => {
    const edited = setScale(toDailyLogFormValues(savedLog()), 'energy', null);
    const args = toSaveDailyLogArgs(PET_ID, LOG_DATE, toggleTag(edited, 'home_change'));
    assert.equal(args.p_energy_level, null);
    assert.equal(args.p_mood_level, 2);
    assert.equal(args.p_sleep_quality, 5);
    assert.equal(args.p_notes, 'Paseo largo');
    assert.deepEqual(args.p_tags, ['vet_visit', 'home_change']);
  });
});

describe('validación', () => {
  it('cualquier dato significativo basta', () => {
    assert.equal(validateDailyLogForm(setScale(emptyDailyLogForm(), 'social', 1)), null);
    assert.equal(validateDailyLogForm({ ...emptyDailyLogForm(), unusualBehavior: true }), null);
    assert.equal(validateDailyLogForm({ ...emptyDailyLogForm(), notes: 'x' }), null);
    assert.equal(validateDailyLogForm({ ...emptyDailyLogForm(), tags: ['new_pet'] }), null);
  });

  it('límites de longitud', () => {
    assert.equal(validateDailyLogForm({ ...emptyDailyLogForm(), notes: 'a'.repeat(2001) }), 'notes_too_long');
    assert.equal(validateDailyLogForm({ ...emptyDailyLogForm(), notes: 'a'.repeat(2000) }), null);
    assert.equal(
      validateDailyLogForm({ ...emptyDailyLogForm(), unusualBehavior: true, unusualBehaviorNotes: 'a'.repeat(1001) }),
      'unusual_behavior_notes_too_long'
    );
  });
});

describe('estado del editor', () => {
  it('un error de la RPC conserva los datos introducidos', () => {
    let state = initialDailyLogEditorState(null);
    state = dailyLogEditorReducer(state, { type: 'edit', update: (v) => setScale(v, 'mood', 4) });
    state = dailyLogEditorReducer(state, { type: 'edit', update: (v) => ({ ...v, notes: 'Nota' }) });
    state = dailyLogEditorReducer(state, { type: 'saveStarted' });
    state = dailyLogEditorReducer(state, { type: 'saveFailed', error: 'network' });
    assert.equal(state.status, 'error');
    assert.equal(state.error, 'network');
    assert.equal(state.values.scales.mood, 4);
    assert.equal(state.values.notes, 'Nota');
  });

  it('mientras guarda no admite cambios', () => {
    let state = initialDailyLogEditorState(null);
    state = dailyLogEditorReducer(state, { type: 'edit', update: (v) => setScale(v, 'mood', 4) });
    state = dailyLogEditorReducer(state, { type: 'saveStarted' });
    const after = dailyLogEditorReducer(state, { type: 'edit', update: (v) => setScale(v, 'mood', 1) });
    assert.equal(after, state);
  });

  it('al guardar toma la fila del servidor y queda en "saved"; un cambio posterior quita el aviso', () => {
    let state = initialDailyLogEditorState(null);
    state = dailyLogEditorReducer(state, { type: 'saveStarted' });
    state = dailyLogEditorReducer(state, { type: 'saveSucceeded', log: savedLog({ notes: 'Recortada' }) });
    assert.equal(state.status, 'saved');
    assert.equal(state.values.notes, 'Recortada');
    state = dailyLogEditorReducer(state, { type: 'edit', update: (v) => setScale(v, 'energy', 5) });
    assert.equal(state.status, 'idle');
    assert.equal(state.error, null);
  });

  it('carga un registro existente para editarlo', () => {
    const state = initialDailyLogEditorState(savedLog());
    assert.equal(state.status, 'idle');
    assert.equal(state.values.scales.energy, 4);
  });
});
