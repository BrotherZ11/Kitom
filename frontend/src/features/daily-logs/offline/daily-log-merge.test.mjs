// Pruebas de `daily-log-merge.ts` y `daily-log-content.ts` con el runner de Node (`npm test`).
// Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NOTES_MAX_LENGTH } from '../daily-log-form.ts';
import { normalizeDailyLogContent, sameDailyLogContent } from './daily-log-content.ts';
import {
  buildResolvedContent,
  combineNotes,
  compareDailyLogVersions,
  mergeDailyLogContent,
  mergeTags,
  resolveDailyLogConflicts,
  suggestCombinedText,
} from './daily-log-merge.ts';

function content(overrides = {}) {
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

const merge = (base, local, remote) => mergeDailyLogContent({ base, local, remote });
const units = (result) => result.conflicts.map((conflict) => conflict.unit);

describe('contenido canónico', () => {
  it('normaliza como la RPC: recorta notas, vacío = null, etiquetas sin duplicados y ordenadas', () => {
    const normalized = normalizeDailyLogContent(
      content({ notes: ' \t hola \r\n', unusual_behavior_notes: '  \n ', tags: ['vet_visit', 'new_pet', 'vet_visit'] })
    );
    assert.equal(normalized.notes, 'hola');
    assert.equal(normalized.unusual_behavior_notes, null);
    assert.deepEqual(normalized.tags, ['new_pet', 'vet_visit']);
  });

  it('dos contenidos que solo difieren en la forma son el mismo', () => {
    assert.equal(
      sameDailyLogContent(
        content({ notes: 'hola ', tags: ['new_pet', 'vet_visit'] }),
        content({ notes: 'hola', tags: ['vet_visit', 'new_pet', 'new_pet'] })
      ),
      true
    );
    assert.equal(sameDailyLogContent(content({ mood_level: 4 }), content()), false);
  });
});

describe('mergeDailyLogContent: campos modificados por un solo lado', () => {
  it('sin cambios remotos queda lo local', () => {
    const base = content();
    const local = content({ energy_level: 5, notes: 'paseo largo' });
    assert.deepEqual(merge(base, local, base), { status: 'merged', content: local, differsFromRemote: true });
  });

  it('sin cambios locales queda lo remoto y no hay nada que enviar', () => {
    const base = content();
    const remote = content({ appetite_level: 1, tags: ['vet_visit'] });
    assert.deepEqual(merge(base, base, remote), { status: 'merged', content: remote, differsFromRemote: false });
  });

  it('cambios en campos distintos se combinan', () => {
    const base = content();
    const local = content({ energy_level: 5, unusual_behavior: true, unusual_behavior_notes: 'cojea' });
    const remote = content({ sleep_quality: 2, notes: 'durmió mal' });
    assert.deepEqual(merge(base, local, remote), {
      status: 'merged',
      content: content({
        energy_level: 5,
        sleep_quality: 2,
        unusual_behavior: true,
        unusual_behavior_notes: 'cojea',
        notes: 'durmió mal',
      }),
      differsFromRemote: true,
    });
  });

  it('quitar un dato (dejarlo en null) también es un cambio que se respeta', () => {
    const base = content({ notes: 'nota antigua' });
    const result = merge(base, content({ notes: null, mood_level: null }), content({ notes: 'nota antigua', energy_level: 4 }));
    assert.equal(result.status, 'merged');
    assert.equal(result.content.notes, null);
    assert.equal(result.content.mood_level, null);
    assert.equal(result.content.energy_level, 4);
  });

  it('los dos lados hicieron el mismo cambio: no es conflicto', () => {
    const base = content();
    const same = content({ mood_level: 5, notes: 'feliz' });
    assert.deepEqual(merge(base, same, same), { status: 'merged', content: same, differsFromRemote: false });
  });

  it('lo local ya es lo que tiene el servidor (respuesta perdida): nada que enviar', () => {
    const base = content();
    const sent = content({ energy_level: 1, notes: 'apático' });
    const result = merge(base, sent, content({ energy_level: 1, notes: 'apático ' }));
    assert.equal(result.status, 'merged');
    assert.equal(result.differsFromRemote, false);
  });
});

describe('mergeDailyLogContent: los dos lados modifican el mismo campo', () => {
  it('es un conflicto: no gana ninguno y se informan las tres versiones', () => {
    const base = content();
    const result = merge(base, content({ energy_level: 5 }), content({ energy_level: 1 }));
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.conflicts, [
      { unit: 'energy_level', base: { energy_level: 3 }, local: { energy_level: 5 }, remote: { energy_level: 1 } },
    ]);
    assert.equal('energy_level' in result.merged, false);
  });

  it('el resto de campos se fusiona aunque uno esté en conflicto', () => {
    const base = content();
    const result = merge(
      base,
      content({ energy_level: 5, appetite_level: 4, tags: ['new_pet'] }),
      content({ energy_level: 1, sleep_quality: 2, tags: ['vet_visit'] })
    );
    assert.deepEqual(units(result), ['energy_level']);
    assert.equal(result.merged.appetite_level, 4);
    assert.equal(result.merged.sleep_quality, 2);
    assert.deepEqual(result.merged.tags, ['new_pet', 'vet_visit']);
  });

  it('uno lo borra y el otro lo cambia: conflicto', () => {
    const result = merge(content(), content({ mood_level: null }), content({ mood_level: 5 }));
    assert.deepEqual(units(result), ['mood_level']);
  });

  it('comportamiento inusual y su nota van juntos: no se mezcla el interruptor de uno con la nota del otro', () => {
    const base = content({ unusual_behavior: true, unusual_behavior_notes: 'cojea' });
    const result = merge(
      base,
      content({ unusual_behavior: true, unusual_behavior_notes: 'cojea de la pata izquierda' }),
      content({ unusual_behavior: false, unusual_behavior_notes: null })
    );
    assert.deepEqual(units(result), ['unusual_behavior']);
    assert.deepEqual(result.conflicts[0].local, {
      unusual_behavior: true,
      unusual_behavior_notes: 'cojea de la pata izquierda',
    });
    assert.deepEqual(result.conflicts[0].remote, { unusual_behavior: false, unusual_behavior_notes: null });
    assert.equal('unusual_behavior' in result.merged, false);
    assert.equal('unusual_behavior_notes' in result.merged, false);
  });

  it('sin base (creado sin conexión y ya existía): se compara con un registro vacío', () => {
    const result = merge(
      null,
      content({ energy_level: 5, mood_level: 3, notes: 'mía', tags: ['new_pet'] }),
      content({ energy_level: 1, mood_level: 3, appetite_level: 3, sleep_quality: 4, tags: ['vet_visit'] })
    );
    assert.deepEqual(units(result), ['energy_level']);
    assert.equal(result.merged.notes, 'mía');
    assert.equal(result.merged.sleep_quality, 4);
    assert.deepEqual(result.merged.tags, ['new_pet', 'vet_visit']);
  });
});

describe('mergeDailyLogContent: notas modificadas simultáneamente', () => {
  const base = content({ notes: 'Comió bien.' });
  const local = content({ notes: 'Comió bien. Por la tarde vomitó.' });
  const remote = content({ notes: 'Comió bien. Paseo corto.' });

  it('dos ediciones distintas son conflicto; nunca se concatenan ni se elige una sola', () => {
    const result = merge(base, local, remote);
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.conflicts, [
      { unit: 'notes', base: { notes: base.notes }, local: { notes: local.notes }, remote: { notes: remote.notes } },
    ]);
    assert.equal('notes' in result.merged, false);
  });

  it('también cuando una contiene a la otra: decide el usuario', () => {
    const result = merge(base, content({ notes: 'Comió bien. Paseo corto. Y jugó.' }), remote);
    assert.deepEqual(units(result), ['notes']);
  });

  it('la misma nota con espacios distintos no es conflicto', () => {
    const result = merge(base, content({ notes: '  Comió bien. Paseo corto.\n' }), remote);
    assert.equal(result.status, 'merged');
    assert.equal(result.differsFromRemote, false);
  });

  it('resolver: local, remoto o un texto revisado por el usuario (nunca una concatenación automática)', () => {
    const conflict = merge(base, local, remote);
    const resolve = (notes) => resolveDailyLogConflicts(conflict, { notes }, remote);
    assert.equal(resolve('local').content.notes, local.notes);
    assert.deepEqual(resolve('remote'), { status: 'merged', content: remote, differsFromRemote: false });
    // «Conservar ambas»: la propuesta se revisa y edita; se guarda lo que el usuario confirma.
    const suggestion = suggestCombinedText(local.notes, remote.notes);
    assert.equal(suggestion, 'Comió bien. Paseo corto.\n\nComió bien. Por la tarde vomitó.');
    const edited = resolve({ text: '  Comió bien. Paseo corto. Por la tarde vomitó.  ' });
    assert.equal(edited.content.notes, 'Comió bien. Paseo corto. Por la tarde vomitó.');
    assert.equal(edited.differsFromRemote, true);
    assert.equal(resolve({ text: '   ' }).content.notes, null);
  });

  it('sin elegir todas las unidades no hay resultado', () => {
    const conflict = merge(base, content({ notes: 'a', energy_level: 5 }), content({ notes: 'b', energy_level: 1 }));
    assert.deepEqual(resolveDailyLogConflicts(conflict, { notes: 'local' }, remote), {
      status: 'incomplete',
      missing: ['energy_level'],
    });
  });

  it('conservar ambas no recorta: si no cabe, hay que elegir o editar', () => {
    const long = (letter) => letter.repeat(NOTES_MAX_LENGTH - 10);
    const conflict = merge(base, content({ notes: long('a') }), content({ notes: long('b') }));
    const tooLong = suggestCombinedText(long('a'), long('b'));
    assert.ok(tooLong.length > NOTES_MAX_LENGTH);
    assert.deepEqual(resolveDailyLogConflicts(conflict, { notes: { text: tooLong } }, content({ notes: long('b') })), {
      status: 'invalid',
      unit: 'notes',
      reason: 'too_long',
    });
  });

  it('un nivel no se puede "combinar"', () => {
    const conflict = merge(content(), content({ energy_level: 5 }), content({ energy_level: 1 }));
    assert.deepEqual(resolveDailyLogConflicts(conflict, { energy_level: { text: '3' } }, content({ energy_level: 1 })), {
      status: 'invalid',
      unit: 'energy_level',
      reason: 'cannot_combine',
    });
  });

  it('comportamiento inusual y su nota se resuelven juntos; con texto revisado queda activado', () => {
    const start = content({ unusual_behavior: true, unusual_behavior_notes: 'cojea' });
    const theirs = content({ unusual_behavior: false, unusual_behavior_notes: null });
    const conflict = merge(start, content({ unusual_behavior: true, unusual_behavior_notes: 'cojea más' }), theirs);
    const edited = resolveDailyLogConflicts(conflict, { unusual_behavior: { text: 'cojea más de la pata izquierda' } }, theirs);
    assert.equal(edited.content.unusual_behavior, true);
    assert.equal(edited.content.unusual_behavior_notes, 'cojea más de la pata izquierda');
    const server = resolveDailyLogConflicts(conflict, { unusual_behavior: 'remote' }, theirs);
    assert.equal(server.content.unusual_behavior, false);
    assert.equal(server.content.unusual_behavior_notes, null);
  });
});

describe('compareDailyLogVersions', () => {
  it('clasifica cada dato: igual, solo mío, solo del servidor, conflicto y etiquetas combinadas', () => {
    const base = content({ energy_level: 3, mood_level: 3, notes: 'base', tags: ['vet_visit'] });
    const mine = content({ energy_level: 5, mood_level: 3, notes: 'mía', tags: ['new_pet', 'vet_visit'] });
    const theirs = content({ energy_level: 3, mood_level: 1, notes: 'suya', tags: [] });
    const byUnit = Object.fromEntries(compareDailyLogVersions({ base, local: mine, remote: theirs }).map((item) => [item.unit, item]));
    assert.equal(byUnit.energy_level.change, 'local_only');
    assert.equal(byUnit.mood_level.change, 'remote_only');
    assert.equal(byUnit.notes.change, 'conflict');
    assert.equal(byUnit.appetite_level.change, 'same');
    assert.equal(byUnit.tags.change, 'merged');
    assert.deepEqual(byUnit.notes.local, { notes: 'mía' });
    assert.deepEqual(byUnit.notes.remote, { notes: 'suya' });
    assert.deepEqual(Object.keys(byUnit.unusual_behavior.local), ['unusual_behavior', 'unusual_behavior_notes']);
  });

  it('sin base (creación concurrente) todo lo distinto es conflicto', () => {
    const units = compareDailyLogVersions({ base: null, local: content({ energy_level: 5 }), remote: content({ energy_level: 1 }) });
    assert.equal(units.find((item) => item.unit === 'energy_level').change, 'conflict');
  });
});

describe('buildResolvedContent', () => {
  const base = content({ energy_level: 3, mood_level: 3, notes: 'base', tags: ['vet_visit'] });
  const mine = content({ energy_level: 5, mood_level: 3, notes: 'mía', tags: ['new_pet', 'vet_visit'] });
  const theirs = content({ energy_level: 3, mood_level: 1, notes: 'suya', tags: [] });
  const versions = { base, local: mine, remote: theirs };

  it('conservar mis cambios: mi versión completa', () => {
    assert.deepEqual(buildResolvedContent(versions, 'local'), { status: 'merged', content: mine, differsFromRemote: true });
  });

  it('conservar los del servidor: la versión remota completa (no hay nada que enviar)', () => {
    assert.deepEqual(buildResolvedContent(versions, 'remote'), { status: 'merged', content: theirs, differsFromRemote: false });
  });

  it('combinar: lo de un solo lado se conserva o acepta, etiquetas como conjunto y el conflicto exige decisión', () => {
    assert.deepEqual(buildResolvedContent(versions, 'combine'), { status: 'incomplete', missing: ['notes'] });
    const result = buildResolvedContent(versions, 'combine', { notes: 'remote' });
    assert.equal(result.status, 'merged');
    assert.equal(result.content.energy_level, 5); // solo mío
    assert.equal(result.content.mood_level, 1); // solo del servidor
    assert.equal(result.content.notes, 'suya'); // decisión explícita
    assert.deepEqual(result.content.tags, ['new_pet']); // yo añadí new_pet; el servidor quitó vet_visit
  });

  it('fila remota borrada: solo se puede volver a crear con mis datos, nunca combinar ni aceptar', () => {
    const deleted = { base, local: mine, remote: null };
    assert.deepEqual(buildResolvedContent(deleted, 'local'), { status: 'merged', content: mine, differsFromRemote: true });
    assert.deepEqual(buildResolvedContent(deleted, 'remote'), { status: 'unresolved', reason: 'remote_deleted' });
    assert.deepEqual(buildResolvedContent(deleted, 'combine'), { status: 'unresolved', reason: 'remote_deleted' });
  });
});

describe('combineNotes', () => {
  it('no duplica: iguales o una contenida en la otra, queda la más completa', () => {
    assert.deepEqual(combineNotes('hola', 'hola', 100), { ok: true, value: 'hola' });
    assert.deepEqual(combineNotes('hola y adiós', 'hola', 100), { ok: true, value: 'hola y adiós' });
    assert.deepEqual(combineNotes('hola', 'hola y adiós', 100), { ok: true, value: 'hola y adiós' });
    assert.deepEqual(combineNotes(null, 'solo remoto', 100), { ok: true, value: 'solo remoto' });
    assert.deepEqual(combineNotes('solo local', null, 100), { ok: true, value: 'solo local' });
    assert.deepEqual(combineNotes(null, null, 100), { ok: true, value: null });
  });

  it('distintas: primero la remota y debajo la local, si cabe', () => {
    assert.deepEqual(combineNotes('local', 'remota', 100), { ok: true, value: 'remota\n\nlocal' });
    assert.deepEqual(combineNotes('local', 'remota', 13), { ok: true, value: 'remota\n\nlocal' });
    assert.deepEqual(combineNotes('local', 'remota', 12), { ok: false, reason: 'too_long' });
  });
});

describe('etiquetas', () => {
  it('se fusionan como conjunto: lo que añade o quita cada lado', () => {
    assert.deepEqual(mergeTags([], ['new_pet'], ['vet_visit']), ['new_pet', 'vet_visit']);
    assert.deepEqual(mergeTags(['vet_visit'], [], ['vet_visit', 'new_pet']), ['new_pet']);
    assert.deepEqual(mergeTags(['vet_visit', 'new_pet'], ['new_pet'], ['vet_visit']), []);
    assert.deepEqual(mergeTags(['vet_visit'], ['vet_visit'], ['vet_visit']), ['vet_visit']);
  });

  it('etiquetas duplicadas no se repiten, vengan del lado que vengan', () => {
    assert.deepEqual(mergeTags([], ['new_pet', 'new_pet'], ['new_pet', 'vet_visit', 'vet_visit']), [
      'new_pet',
      'vet_visit',
    ]);
    const result = merge(
      content(),
      content({ tags: ['vet_visit', 'vet_visit', 'new_pet'] }),
      content({ tags: ['new_pet', 'home_change', 'home_change'] })
    );
    assert.equal(result.status, 'merged');
    assert.deepEqual(result.content.tags, ['home_change', 'new_pet', 'vet_visit']);
  });

  it('nunca producen conflicto, ni cuando los dos lados las cambian', () => {
    const base = content({ tags: ['vet_visit'] });
    const result = merge(base, content({ tags: ['new_pet'] }), content({ tags: ['vet_visit', 'home_change'] }));
    assert.deepEqual(result, {
      status: 'merged',
      content: content({ tags: ['home_change', 'new_pet'] }),
      differsFromRemote: true,
    });
  });

  it('una etiqueta remota que esta versión no conoce no se pierde', () => {
    const result = merge(content(), content({ tags: ['new_pet'] }), content({ tags: ['future_tag'] }));
    assert.deepEqual(result.content.tags, ['future_tag', 'new_pet']);
  });
});

describe('mergeDailyLogContent: casos sin estrategia definida', () => {
  it('la fila remota se borró: no se recrea sola', () => {
    assert.deepEqual(merge(content(), content({ energy_level: 5 }), null), {
      status: 'unresolved',
      reason: 'remote_deleted',
    });
  });

  it('una fusión que deja el registro vacío no se envía', () => {
    const base = content({ energy_level: 3, appetite_level: null, mood_level: 3 });
    const local = content({ energy_level: null, appetite_level: null, mood_level: 3 });
    const remote = content({ energy_level: 3, appetite_level: null, mood_level: null });
    assert.deepEqual(merge(base, local, remote), { status: 'unresolved', reason: 'empty_result' });
  });
});
