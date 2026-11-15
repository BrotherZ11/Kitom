// Reglas de urgencia por especie (Node, sin Deno):
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/ai-analysis-process/urgency.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { urgentSignsFor as appUrgentSigns } from '../../../frontend/src/features/ai-analysis/urgent-signs.ts';
import { applyUrgencyFloor, minimumUrgency, URGENCY_RULES, urgentSignsFor } from './urgency.ts';

const SPECIES = ['dog', 'cat', 'rabbit', 'guinea_pig', 'hamster', 'horse', 'bird_other', 'reptile_other', 'other'];

/** Señales del seed (`code` → especies), leídas de las filas `('code', 'categoría', …, array[...])`. */
function seedSignals() {
  const sql = readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8');
  const rows = new Map();
  for (const match of sql.matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',.*array\[([^\]]*)\]\)/gm)) {
    rows.set(match[1], match[3].split(',').map((item) => item.trim().replace(/'/g, '')));
  }
  return rows;
}

describe('reglas de urgencia', () => {
  it('urgencias en cualquier especie', () => {
    for (const species of SPECIES) {
      assert.equal(minimumUrgency(['breathing_difficulty'], species), 'urgent', species);
      assert.equal(minimumUrgency(['seizures'], species), 'urgent', species);
    }
  });

  it('dependen de la especie: el gato que no orina, el conejo que no come', () => {
    assert.equal(minimumUrgency(['straining_to_urinate'], 'cat'), 'urgent');
    assert.equal(minimumUrgency(['straining_to_urinate'], 'dog'), 'consult_soon');
    assert.equal(minimumUrgency(['not_eating'], 'rabbit'), 'urgent');
    assert.equal(minimumUrgency(['not_eating'], 'dog'), 'consult_soon');
    assert.equal(minimumUrgency(['open_mouth_breathing'], 'cat'), 'urgent');
    assert.equal(minimumUrgency(['open_mouth_breathing'], 'reptile_other'), 'consult_soon');
    assert.equal(minimumUrgency(['appetite_loss'], 'hamster'), 'consult_soon');
    assert.equal(minimumUrgency(['appetite_loss'], 'dog'), 'observe');
  });

  it('sin especie solo valen las reglas generales', () => {
    assert.equal(minimumUrgency(['not_eating']), 'consult_soon');
    assert.equal(minimumUrgency(['lethargy', 'appetite_loss']), 'consult_soon');
    assert.equal(applyUrgencyFloor('urgent', ['limping'], 'dog'), 'urgent', 'nunca baja el nivel del modelo');
  });

  it('cada señal de una regla existe en el seed para las especies de la regla', () => {
    const signals = seedSignals();
    assert.ok(signals.size >= 70, `el seed tiene ${signals.size} señales`);
    for (const rule of URGENCY_RULES) {
      for (const code of rule.symptoms) {
        assert.ok(signals.has(code), `«${code}» no está en el seed`);
        for (const species of rule.species ?? []) {
          assert.ok(signals.get(code).includes(species), `«${code}» no está vinculada a ${species} en el seed`);
        }
      }
    }
  });

  it('la app avisa exactamente de las mismas señales urgentes', () => {
    for (const species of SPECIES) assert.deepEqual(appUrgentSigns(species), urgentSignsFor(species), species);
  });
});
