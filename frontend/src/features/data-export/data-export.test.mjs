import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildExportDocument, EXPORT_FORMAT, exportFileName, fetchAllPages } from './data-export.ts';

const ME = 'u-1';

function input(overrides = {}) {
  return {
    exportedAt: new Date('2026-10-30T10:00:00Z'),
    appVersion: '1.1.0',
    account: { id: ME, email: 'yo@example.test', createdAt: '2026-10-01T00:00:00Z' },
    profile: { full_name: 'Ana' },
    notificationPreferences: null,
    subscription: { plan: 'free' },
    pets: [
      { id: 'p-1', owner_id: ME, name: 'Lua' },
      { id: 'p-2', owner_id: 'u-2', name: 'Bruno' },
    ],
    dailyLogs: [
      { pet_id: 'p-1', log_date: '2026-10-29', mood_level: 4 },
      { pet_id: 'p-2', log_date: '2026-10-29', mood_level: 2 },
    ],
    reminders: [{ pet_id: 'p-1', title: 'Vacuna' }],
    aiAnalyses: [{ id: 'a-1', pet_id: 'p-1', status: 'completed' }],
    aiAnalysisSymptoms: [
      { analysis_id: 'a-1', symptom_id: 's-1' },
      { analysis_id: 'a-9', symptom_id: 's-2' },
    ],
    achievements: [{ pet_id: 'p-1', achievement_id: 'first_log' }],
    streaks: [{ pet_id: 'p-1', current_streak: 3 }],
    members: [{ pet_id: 'p-1', full_name: 'Luis', role: 'editor' }],
    ...overrides,
  };
}

describe('buildExportDocument', () => {
  it('cabecera con formato, versión, fecha y cuenta', () => {
    const doc = buildExportDocument(input());
    assert.equal(doc.format, EXPORT_FORMAT);
    assert.equal(doc.exported_at, '2026-10-30T10:00:00.000Z');
    assert.deepEqual(doc.account, { id: ME, email: 'yo@example.test', created_at: '2026-10-01T00:00:00Z' });
  });

  it('agrupa cada dato en su mascota, sin repetir pet_id, y marca el rol', () => {
    const [own, shared] = buildExportDocument(input()).pets;
    assert.equal(own.role, 'owner');
    assert.equal(shared.role, 'co_owner');
    assert.deepEqual(own.daily_logs, [{ log_date: '2026-10-29', mood_level: 4 }]);
    assert.deepEqual(shared.daily_logs, [{ log_date: '2026-10-29', mood_level: 2 }]);
    assert.deepEqual(own.reminders, [{ title: 'Vacuna' }]);
    assert.deepEqual(own.ai_analyses, [{ id: 'a-1', status: 'completed', symptom_ids: ['s-1'] }]);
    assert.deepEqual(own.streak, { current_streak: 3 });
    assert.equal(shared.streak, null);
    assert.deepEqual(own.members, [{ full_name: 'Luis', role: 'editor' }]);
  });
});

describe('exportFileName', () => {
  it('fecha local con ceros', () => {
    assert.equal(exportFileName(new Date(2026, 0, 5)), 'kitom-datos-2026-01-05.json');
  });
});

describe('fetchAllPages', () => {
  it('pide páginas hasta una incompleta', async () => {
    const calls = [];
    const rows = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return { data: from === 0 ? [1, 2] : [3], error: null };
    }, 2);
    assert.deepEqual(rows, [1, 2, 3]);
    assert.deepEqual(calls, [[0, 1], [2, 3]]);
  });

  it('un error corta y se propaga', async () => {
    await assert.rejects(fetchAllPages(async () => ({ data: null, error: new Error('rls') })), /rls/);
  });
});
