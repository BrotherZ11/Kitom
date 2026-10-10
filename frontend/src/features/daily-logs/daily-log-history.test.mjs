// Pruebas de `daily-log-history.ts` (y del historial en form/query-keys/log-date) con el runner de
// Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTimeZone } from '../profile/timezone.ts';
import { setScale, summarizeDailyLog, toDailyLogFormValues, toSaveDailyLogArgs, toggleTag } from './daily-log-form.ts';
import { toDailyLogError } from './daily-log-errors.ts';
import {
  DAILY_LOG_COLUMNS,
  HISTORY_PAGE_SIZE,
  flattenHistory,
  parseLogDateParam,
  queryHistoryPage,
  replaceLogInHistory,
  resolveHistoryLogView,
  toHistoryPage,
} from './daily-log-history.ts';
import { formatLogDateLabel, todayLogDate } from './log-date.ts';
import { dailyLogKeys, dailyLogKeysAfterSave } from './query-keys.ts';

const PET = 'b0000000-0000-4000-8000-000000000001';
const OTHER_PET = 'b0000000-0000-4000-8000-000000000002';

function log(date, overrides = {}) {
  return {
    id: `id-${overrides.pet_id ?? PET}-${date}`,
    pet_id: PET,
    logged_by: 'a0000000-0000-4000-8000-000000000001',
    last_edited_by: null,
    log_date: date,
    energy_level: null,
    appetite_level: null,
    mood_level: 3,
    activity_level: null,
    sleep_quality: null,
    vocalization_level: null,
    social_interaction_level: null,
    unusual_behavior: false,
    unusual_behavior_notes: null,
    notes: null,
    tags: [],
    created_at: `${date}T10:00:00Z`,
    updated_at: `${date}T10:00:00Z`,
    ...overrides,
  };
}

/** Fechas consecutivas hacia atrás desde `start` (YYYY-MM-DD). */
function datesBack(start, count) {
  const base = new Date(`${start}T12:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => new Date(base - i * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Cliente falso de Supabase: aplica de verdad eq/lt/order/limit sobre filas en memoria y registra
 * las llamadas. Las filas se guardan desordenadas para comprobar que el orden lo pide la consulta.
 */
function fakeClient(rows, { error = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      calls.push(['from', table]);
      let result = [...rows];
      const builder = {
        select(columns) { calls.push(['select', columns]); return builder; },
        eq(column, value) { calls.push(['eq', column, value]); result = result.filter((r) => r[column] === value); return builder; },
        lt(column, value) { calls.push(['lt', column, value]); result = result.filter((r) => r[column] < value); return builder; },
        order(column, { ascending }) {
          calls.push(['order', column, ascending]);
          result.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
          return builder;
        },
        limit(count) { calls.push(['limit', count]); result = result.slice(0, count); return builder; },
        then(resolve) { resolve(error ? { data: null, error } : { data: result, error: null }); },
      };
      return builder;
    },
  };
  return client;
}

describe('consulta del historial', () => {
  it('filtra por pet_id, ordena por log_date DESC y pide una fila de más', async () => {
    const client = fakeClient([log('2026-10-01')]);
    await queryHistoryPage(client, PET, null);
    assert.deepEqual(client.calls, [
      ['from', 'daily_logs'],
      ['select', DAILY_LOG_COLUMNS],
      ['eq', 'pet_id', PET],
      ['order', 'log_date', false],
      ['limit', HISTORY_PAGE_SIZE + 1],
    ]);
  });

  it('con cursor pide solo fechas anteriores (exclusivo)', async () => {
    const client = fakeClient([]);
    await queryHistoryPage(client, PET, '2026-09-20');
    assert.deepEqual(client.calls[3], ['lt', 'log_date', '2026-09-20']);
  });

  it('ordenado por fecha descendente y solo de esa mascota', async () => {
    const rows = [log('2026-10-03'), log('2026-10-08'), log('2026-10-05'), log('2026-10-09', { pet_id: OTHER_PET })];
    const page = await queryHistoryPage(fakeClient(rows), PET, null);
    assert.deepEqual(page.logs.map((l) => l.log_date), ['2026-10-08', '2026-10-05', '2026-10-03']);
    assert.equal(page.nextCursor, null);
  });

  it('paginación hasta el final: 45 registros → 20 + 20 + 5, sin duplicados ni huecos', async () => {
    const dates = datesBack('2026-10-09', 45);
    const rows = [...dates].reverse().map((date) => log(date)); // desordenadas en origen
    const client = fakeClient(rows);
    const pages = [];
    let cursor = null;
    do {
      const page = await queryHistoryPage(client, PET, cursor);
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.deepEqual(pages.map((p) => p.logs.length), [20, 20, 5]);
    assert.deepEqual(flattenHistory(pages).map((l) => l.log_date), dates);
  });

  it('exactamente una página llena: no promete más', async () => {
    const rows = datesBack('2026-10-09', HISTORY_PAGE_SIZE).map((date) => log(date));
    const page = await queryHistoryPage(fakeClient(rows), PET, null);
    assert.equal(page.logs.length, HISTORY_PAGE_SIZE);
    assert.equal(page.nextCursor, null);
  });

  it('historial vacío', async () => {
    const page = await queryHistoryPage(fakeClient([]), PET, null);
    assert.deepEqual(page, { logs: [], nextCursor: null });
    assert.deepEqual(flattenHistory([page]), []);
  });

  it('un error de la consulta se propaga y se traduce para la UI', async () => {
    await assert.rejects(
      queryHistoryPage(fakeClient([], { error: { code: '42501', message: 'permission denied' } }), PET, null),
      (error) => toDailyLogError(error).code === 'not_allowed'
    );
    assert.equal(toDailyLogError(new TypeError('Network request failed')).code, 'network');
    assert.equal(toDailyLogError({ code: 'PGRST000', message: 'boom' }).code, 'unknown');
  });
});

describe('páginas y caché', () => {
  it('toHistoryPage usa la fila sobrante solo como señal de "hay más"', () => {
    const rows = datesBack('2026-10-09', 4).map((date) => log(date));
    assert.deepEqual(toHistoryPage(rows, 3).nextCursor, '2026-10-07');
    assert.equal(toHistoryPage(rows, 3).logs.length, 3);
    assert.equal(toHistoryPage(rows.slice(0, 3), 3).nextCursor, null);
  });

  it('flattenHistory quita duplicados entre páginas y ordena DESC', () => {
    const pages = [
      { logs: [log('2026-10-09'), log('2026-10-08')], nextCursor: '2026-10-08' },
      { logs: [log('2026-10-08'), log('2026-10-06')], nextCursor: null },
    ];
    assert.deepEqual(flattenHistory(pages).map((l) => l.log_date), ['2026-10-09', '2026-10-08', '2026-10-06']);
  });

  it('tras guardar, se sustituye el registro en las páginas cargadas', () => {
    const data = {
      pages: [{ logs: [log('2026-10-09'), log('2026-10-01')], nextCursor: null }],
      pageParams: [null],
    };
    const saved = log('2026-10-01', { mood_level: 5, notes: 'Editado' });
    const next = replaceLogInHistory(data, saved);
    assert.equal(next.pages[0].logs[1].mood_level, 5);
    assert.equal(next.pages[0].logs[0], data.pages[0].logs[0]);
    assert.deepEqual(next.pageParams, [null]);
    // Registro no cargado (o de otra mascota): no cambia nada
    assert.equal(replaceLogInHistory(data, log('2025-01-01')), data);
    assert.equal(replaceLogInHistory(data, log('2026-10-01', { pet_id: OTHER_PET })), data);
  });

  it('al guardar se invalidan el registro de ese día y el historial de esa mascota', () => {
    const keys = dailyLogKeysAfterSave(log('2026-09-15'));
    assert.deepEqual(keys.detail, ['daily-logs', 'detail', PET, '2026-09-15']);
    assert.deepEqual(keys.history, ['daily-logs', 'history', PET]);
    assert.deepEqual(dailyLogKeys.history(OTHER_PET), ['daily-logs', 'history', OTHER_PET]);
  });
});

describe('registro histórico', () => {
  it('cargar y editar conserva el log_date original aunque "hoy" sea otro', () => {
    const old = log('2026-09-15', { energy_level: 2, notes: 'Antes', tags: ['vet_visit'] });
    const today = todayLogDate(new Date('2026-10-09T10:00:00Z'), { profile: 'Europe/Madrid', device: null }, normalizeTimeZone);
    assert.equal(today, '2026-10-09');

    let values = toDailyLogFormValues(old);
    assert.equal(values.scales.energy, 2);
    values = toggleTag(setScale(values, 'energy', 4), 'home_change');
    const args = toSaveDailyLogArgs(old.pet_id, old.log_date, values);
    assert.equal(args.p_log_date, '2026-09-15');
    assert.notEqual(args.p_log_date, today);
    assert.equal(args.p_energy_level, 4);
    assert.equal(args.p_notes, 'Antes');
    assert.deepEqual(args.p_tags, ['vet_visit', 'home_change']);
  });

  it('vista: sin registro no hay nada que editar; viewer solo lectura; editor edita', () => {
    assert.equal(resolveHistoryLogView(null, true), 'missing');
    assert.equal(resolveHistoryLogView(null, false), 'missing');
    assert.equal(resolveHistoryLogView(log('2026-09-15'), false), 'read_only');
    assert.equal(resolveHistoryLogView(log('2026-09-15'), true), 'editable');
  });

  it('parámetro de fecha de la ruta', () => {
    assert.equal(parseLogDateParam('2026-09-15'), '2026-09-15');
    assert.equal(parseLogDateParam('2024-02-29'), '2024-02-29');
    for (const bad of ['2026-02-30', '2026-9-15', '15/09/2026', '', undefined, ['2026-09-15']]) {
      assert.equal(parseLogDateParam(bad), null, String(bad));
    }
  });

  it('la fecha mostrada es la guardada (con año), sin depender de la zona horaria', () => {
    const label = formatLogDateLabel('2025-12-31', 'es', { withYear: true });
    assert.match(label, /31 de diciembre de 2025/);
    assert.doesNotMatch(formatLogDateLabel('2025-12-31', 'es'), /2025/);
  });
});

describe('resumen del historial', () => {
  it('solo lo indicado, en el orden de pantalla y sin agregados', () => {
    const summary = summarizeDailyLog(
      toDailyLogFormValues(
        log('2026-10-01', {
          social_interaction_level: 1,
          energy_level: 5,
          mood_level: null,
          tags: ['new_pet'],
          unusual_behavior: true,
          notes: '  ',
        })
      )
    );
    assert.deepEqual(summary.scales, [
      { field: 'energy', value: 5 },
      { field: 'social', value: 1 },
    ]);
    assert.deepEqual(summary.tags, ['new_pet']);
    assert.equal(summary.unusualBehavior, true);
    assert.equal(summary.hasNotes, false);
    assert.deepEqual(Object.keys(summary).sort(), ['hasNotes', 'scales', 'tags', 'unusualBehavior']);
  });
});
