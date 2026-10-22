import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBadges, earnedCount, parseCriteria } from './achievements-model.ts';

const catalog = [
  { id: 'a2', code: 'streak_7', sortOrder: 2, criteria: { type: 'streak', days: 7 }, title: '7 días', description: null },
  { id: 'a1', code: 'first_log', sortOrder: 1, criteria: { type: 'count', metric: 'daily_logs', value: 1 }, title: 'Primero', description: 'd' },
  {
    id: 'a3',
    code: 'first_photo_scan',
    sortOrder: 3,
    criteria: { type: 'count', metric: 'ai_analysis_requests', value: 1 },
    title: null,
    description: null,
  },
  { id: 'a4', code: 'streak_30', sortOrder: 4, criteria: { type: 'streak', days: 30 }, title: '30', description: null },
];

describe('parseCriteria', () => {
  it('reconoce rachas y recuentos; lo demás es desconocido', () => {
    assert.deepEqual(parseCriteria({ type: 'streak', days: 7 }), { type: 'streak', days: 7 });
    assert.deepEqual(parseCriteria({ type: 'count', metric: 'daily_logs', value: 1 }), {
      type: 'count',
      metric: 'daily_logs',
      value: 1,
    });
    assert.deepEqual(parseCriteria({ type: 'streak', days: 0 }), { type: 'unknown' });
    assert.deepEqual(parseCriteria(null), { type: 'unknown' });
  });
});

describe('buildBadges', () => {
  it('ordena por el catálogo y marca lo conseguido, el progreso de las rachas y lo que llegará', () => {
    const badges = buildBadges(catalog, [{ achievementId: 'a1', earnedAt: '2026-10-10T10:00:00Z' }], {
      currentStreak: 4,
      loggedAny: true,
    });
    assert.deepEqual(
      badges.map((b) => [b.code, b.state, b.progress]),
      [
        ['first_log', 'earned', null],
        ['streak_7', 'progress', { count: 4, total: 7 }],
        ['first_photo_scan', 'soon', null],
        ['streak_30', 'progress', { count: 4, total: 30 }],
      ]
    );
    assert.equal(badges[0].earnedAt, '2026-10-10T10:00:00Z');
    assert.equal(earnedCount(badges), 1);
  });

  it('sin racha, las rachas están por conseguir; el progreso nunca pasa del total', () => {
    const none = buildBadges(catalog, [], { currentStreak: 0, loggedAny: false });
    assert.equal(none.find((b) => b.code === 'streak_7').state, 'locked');
    assert.equal(none.find((b) => b.code === 'first_log').state, 'locked');
    const long = buildBadges(catalog, [], { currentStreak: 12, loggedAny: true });
    assert.deepEqual(long.find((b) => b.code === 'streak_7').progress, { count: 7, total: 7 });
  });
});
