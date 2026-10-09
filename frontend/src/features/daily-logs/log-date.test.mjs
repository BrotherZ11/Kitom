// Pruebas de `log-date.ts` con el runner de Node (`npm test`). Ver frontend/CLAUDE.md.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTimeZone } from '../profile/timezone.ts';
import { formatLocalDate, formatLogDateLabel, resolveLogTimeZone, todayLogDate } from './log-date.ts';

describe('formatLocalDate', () => {
  it('Europe/Madrid en horario de verano (UTC+2): la medianoche local cambia el día', () => {
    assert.equal(formatLocalDate(new Date('2026-10-08T21:59:59Z'), 'Europe/Madrid'), '2026-10-08');
    assert.equal(formatLocalDate(new Date('2026-10-08T22:00:00Z'), 'Europe/Madrid'), '2026-10-09');
  });

  it('Europe/Madrid entre las 00:00 y las 02:00 no da el día UTC', () => {
    const instant = new Date('2026-10-08T23:30:00Z'); // 01:30 del 9 en Madrid
    assert.equal(instant.toISOString().slice(0, 10), '2026-10-08');
    assert.equal(formatLocalDate(instant, 'Europe/Madrid'), '2026-10-09');
  });

  it('Europe/Madrid en horario de invierno (UTC+1) y cambio de año', () => {
    assert.equal(formatLocalDate(new Date('2026-12-31T22:59:59Z'), 'Europe/Madrid'), '2026-12-31');
    assert.equal(formatLocalDate(new Date('2026-12-31T23:00:00Z'), 'Europe/Madrid'), '2027-01-01');
  });

  it('zonas al oeste de UTC van por detrás', () => {
    assert.equal(formatLocalDate(new Date('2026-10-09T03:00:00Z'), 'America/New_York'), '2026-10-08');
  });

  it('UTC y zona inválida (cae a UTC)', () => {
    const instant = new Date('2026-10-08T23:30:00Z');
    assert.equal(formatLocalDate(instant, 'UTC'), '2026-10-08');
    assert.equal(formatLocalDate(instant, 'Not/AZone'), '2026-10-08');
  });
});

describe('resolveLogTimeZone', () => {
  it('usa la zona del perfil si existe', () => {
    assert.equal(
      resolveLogTimeZone({ profile: 'Europe/Madrid', device: 'America/New_York' }, normalizeTimeZone),
      'Europe/Madrid'
    );
  });

  it('perfil null → zona del dispositivo', () => {
    assert.equal(
      resolveLogTimeZone({ profile: null, device: 'America/New_York' }, normalizeTimeZone),
      'America/New_York'
    );
  });

  it('perfil inválido → zona del dispositivo', () => {
    assert.equal(
      resolveLogTimeZone({ profile: '+01:00', device: 'Europe/Madrid' }, normalizeTimeZone),
      'Europe/Madrid'
    );
  });

  it('sin perfil ni dispositivo válidos → UTC', () => {
    assert.equal(resolveLogTimeZone({ profile: null, device: null }, normalizeTimeZone), 'UTC');
    assert.equal(resolveLogTimeZone({ profile: 'CET', device: undefined }, normalizeTimeZone), 'UTC');
  });
});

describe('todayLogDate', () => {
  const nearMidnight = new Date('2026-10-08T22:30:00Z'); // 00:30 del 9 en Madrid

  it('perfil en Madrid', () => {
    assert.equal(
      todayLogDate(nearMidnight, { profile: 'Europe/Madrid', device: 'UTC' }, normalizeTimeZone),
      '2026-10-09'
    );
  });

  it('perfil sin zona: usa el dispositivo en Madrid', () => {
    assert.equal(
      todayLogDate(nearMidnight, { profile: null, device: 'Europe/Madrid' }, normalizeTimeZone),
      '2026-10-09'
    );
  });

  it('sin ninguna zona válida: UTC', () => {
    assert.equal(todayLogDate(nearMidnight, { profile: null, device: null }, normalizeTimeZone), '2026-10-08');
  });
});

describe('formatLogDateLabel', () => {
  it('muestra exactamente el día de la fecha, sin desfase de zona', () => {
    assert.match(formatLogDateLabel('2026-10-09', 'es'), /9 de octubre/);
  });

  it('devuelve el texto tal cual si no es una fecha', () => {
    assert.equal(formatLogDateLabel('hoy', 'es'), 'hoy');
  });
});
