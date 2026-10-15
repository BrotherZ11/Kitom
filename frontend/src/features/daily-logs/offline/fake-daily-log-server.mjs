// Servidor falso de `daily_logs` para las pruebas del motor (`npm test`). Reproduce el contrato de
// `save_daily_log` (migración 20261010160332): permisos antes que conflictos, precondiciones
// excluyentes, `P0001` + `daily_log_conflict` con su `details`, normalización del contenido y
// `updated_at` con microsegundos sin ceros finales. No es una prueba: lo importan los `*.test.mjs`.
import { normalizeDailyLogContent } from './daily-log-content.ts';

const NETWORK_ERROR = { message: 'TypeError: Network request failed', details: '', hint: '', code: '' };
const conflict = (details) => ({ ok: false, status: 400, error: { code: 'P0001', hint: 'daily_log_conflict', details, message: '…' } });

export function createFakeServer() {
  const rows = new Map();
  const editors = new Map(); // petId → Set<userId>
  const readers = new Map(); // petId → Set<userId> (miembros que pueden leer: incluye viewers)
  const calls = [];
  let sequence = 0;
  let online = true;
  let dropNextResponse = false;
  let failNext = null;
  let holdNext = null;
  let beforeNextSave = null;
  const failByDate = new Map(); // logDate → resultado de fallo permanente

  const key = (petId, logDate) => `${petId}/${logDate}`;
  // Microsegundos, con los ceros finales que PostgREST omite: "…:26.89152+00:00".
  const nextVersion = () => {
    sequence += 1;
    const micros = String(100000 + sequence * 10).replace(/0+$/, '');
    return `2026-10-15T09:14:26.${micros}+00:00`;
  };
  const canEdit = (userId, petId) => editors.get(petId)?.has(userId) ?? false;
  const canRead = (userId, petId) => canEdit(userId, petId) || (readers.get(petId)?.has(userId) ?? false);

  function store(userId, args, existing) {
    const content = normalizeDailyLogContent({
      energy_level: args.p_energy_level,
      appetite_level: args.p_appetite_level,
      mood_level: args.p_mood_level,
      activity_level: args.p_activity_level,
      sleep_quality: args.p_sleep_quality,
      vocalization_level: args.p_vocalization_level,
      social_interaction_level: args.p_social_interaction_level,
      unusual_behavior: args.p_unusual_behavior ?? false,
      unusual_behavior_notes: args.p_unusual_behavior_notes,
      notes: args.p_notes,
      tags: args.p_tags ?? [],
    });
    const row = {
      id: existing?.id ?? `c0000000-0000-4000-8000-${String(rows.size + 1).padStart(12, '0')}`,
      pet_id: args.p_pet_id,
      log_date: args.p_log_date,
      logged_by: existing?.logged_by ?? userId,
      last_edited_by: existing ? userId : null,
      created_at: existing?.created_at ?? '2026-10-15T08:00:00.123456+00:00',
      ...content,
      updated_at: nextVersion(),
    };
    rows.set(key(args.p_pet_id, args.p_log_date), row);
    return row;
  }

  function save(userId, args) {
    if (beforeNextSave) {
      // Algo pasa entre la lectura del cliente y su envío (otro guardado, se cae la red…).
      const run = beforeNextSave;
      beforeNextSave = null;
      run();
    }
    if (!online) return { ok: false, error: NETWORK_ERROR, status: null };
    if (failNext) {
      const failure = failNext;
      failNext = null;
      return failure;
    }
    if (failByDate.has(args.p_log_date)) return failByDate.get(args.p_log_date);
    if (!canEdit(userId, args.p_pet_id)) {
      return { ok: false, status: 403, error: { code: '42501', message: 'No tienes acceso de edición sobre esta mascota' } };
    }
    if (args.p_expected_updated_at != null && args.p_expect_absent) {
      return { ok: false, status: 400, error: { code: '22023', message: '…' } };
    }
    const existing = rows.get(key(args.p_pet_id, args.p_log_date));
    if (args.p_expected_updated_at != null) {
      if (!existing) return conflict('row_missing');
      if (existing.updated_at !== args.p_expected_updated_at) return conflict('version_mismatch');
    } else if (args.p_expect_absent) {
      if (existing) return conflict('row_exists');
    }
    const row = store(userId, args, existing);
    if (dropNextResponse) {
      // Se guardó, pero la respuesta no llega.
      dropNextResponse = false;
      return { ok: false, error: NETWORK_ERROR, status: null };
    }
    return { ok: true, data: { ...row } };
  }

  return {
    rows,
    calls,
    allowEditor(petId, userId) {
      if (!editors.has(petId)) editors.set(petId, new Set());
      editors.get(petId).add(userId);
    },
    /** Pasa a solo lectura (viewer): sigue viendo los registros, pero ya no puede guardar. */
    revokeEditor(petId, userId) {
      editors.get(petId)?.delete(userId);
      if (!readers.has(petId)) readers.set(petId, new Set());
      readers.get(petId).add(userId);
    },
    /** Deja de ser miembro: RLS ya no le deja ver los registros (para él, como si no existieran). */
    removeMember(petId, userId) {
      editors.get(petId)?.delete(userId);
      readers.get(petId)?.delete(userId);
    },
    /** Todos los guardados de ese día fallan con `result` hasta llamar a la función devuelta. */
    failForDate(logDate, result) {
      failByDate.set(logDate, result);
      return () => failByDate.delete(logDate);
    },
    /** Se ejecuta justo antes de procesar el próximo guardado (simula una carrera). */
    beforeNextSave(run) {
      beforeNextSave = run;
    },
    setOnline(value) {
      online = value;
    },
    dropNextResponse() {
      dropNextResponse = true;
    },
    failNext(result) {
      failNext = result;
    },
    /** La próxima petición de guardado queda en espera hasta llamar a la función devuelta. */
    holdNextSave() {
      let release;
      holdNext = new Promise((resolve) => (release = resolve));
      return () => release();
    },
    /** Otro dispositivo u otra persona guarda directamente (siempre gana: sin precondición). */
    writeAsOther(userId, args) {
      return store(userId, args, rows.get(key(args.p_pet_id, args.p_log_date)));
    },
    row(petId, logDate) {
      return rows.get(key(petId, logDate)) ?? null;
    },
    remoteFor(userId) {
      return {
        async save(args) {
          calls.push({ type: 'save', userId, args });
          if (holdNext) {
            const wait = holdNext;
            holdNext = null;
            await wait;
          }
          return save(userId, args);
        },
        async fetch(petId, logDate) {
          calls.push({ type: 'fetch', userId, petId, logDate });
          if (!online) return { ok: false, error: NETWORK_ERROR, status: null };
          const row = rows.get(key(petId, logDate));
          // RLS: quien no es miembro no ve la fila.
          return { ok: true, data: row && canRead(userId, petId) ? { ...row } : null };
        },
      };
    },
  };
}
