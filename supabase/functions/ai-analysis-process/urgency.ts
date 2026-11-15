/**
 * Suelo de urgencia por reglas: señales (o combinaciones) que nunca deben quedarse por debajo de un
 * nivel aunque el modelo diga otra cosa, por especie. Módulo puro, sin imports de Deno: se prueba con
 * `node --test supabase/functions/ai-analysis-process/urgency.test.mjs`.
 *
 * BORRADOR (2026-11-13) a validar por el veterinario asesor, igual que el prompt. Las señales son las
 * de `supabase/seed.sql`; la app avisa al momento de las que aquí son `urgent`
 * (`frontend/src/features/ai-analysis/urgent-signs.ts`, comprobado por `urgency.test.mjs`).
 *
 * Criterios: lo que en cualquier especie es una urgencia (respirar mal, convulsiones, no tenerse en
 * pie, posible tóxico, encías pálidas); lo que lo es en una especie concreta (arcadas sin vómito y
 * abdomen hinchado en el perro; un gato que no consigue orinar; un conejo o una cobaya que no come o
 * no hace heces; el cólico y la laminitis del caballo; un ave en el suelo de la jaula; respirar con
 * la boca abierta en especies que respiran por la nariz), y combinaciones que piden cita pronto.
 */

export const URGENCY_LEVELS = ['observe', 'routine_change', 'consult_soon', 'urgent'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export type UrgencyRule = {
  /** Todas deben estar marcadas. */
  symptoms: readonly string[];
  level: UrgencyLevel;
  /** Solo en estas especies (`species.code`); sin lista, en todas. */
  species?: readonly string[];
};

const SMALL_HERBIVORES = ['rabbit', 'guinea_pig'] as const;
/** Respiran por la nariz: hacerlo con la boca abierta es una urgencia (el perro jadea con normalidad). */
const NOSE_BREATHERS = ['cat', 'rabbit', 'guinea_pig', 'hamster', 'bird_other'] as const;

const always = (symptoms: string[], level: UrgencyLevel): UrgencyRule => ({ symptoms, level });

export const URGENCY_RULES: readonly UrgencyRule[] = [
  // Urgentes en cualquier especie.
  always(['breathing_difficulty'], 'urgent'),
  always(['seizures'], 'urgent'),
  always(['cant_stand'], 'urgent'),
  always(['toxin_ingestion'], 'urgent'),
  always(['pale_gums'], 'urgent'),
  always(['fly_larvae'], 'urgent'),
  always(['colic_signs'], 'urgent'),
  always(['hoof_heat'], 'urgent'),
  always(['sitting_on_floor'], 'urgent'),
  // Urgentes en algunas especies; en las demás, cita pronto.
  { symptoms: ['unproductive_retching'], level: 'urgent', species: ['dog'] },
  { symptoms: ['bloated_abdomen'], level: 'urgent', species: ['dog', ...SMALL_HERBIVORES, 'horse'] },
  always(['bloated_abdomen'], 'consult_soon'),
  { symptoms: ['straining_to_urinate'], level: 'urgent', species: ['cat'] },
  always(['straining_to_urinate'], 'consult_soon'),
  { symptoms: ['not_eating'], level: 'urgent', species: SMALL_HERBIVORES },
  always(['not_eating'], 'consult_soon'),
  { symptoms: ['no_droppings'], level: 'urgent', species: [...SMALL_HERBIVORES, 'horse'] },
  always(['no_droppings'], 'consult_soon'),
  { symptoms: ['open_mouth_breathing'], level: 'urgent', species: NOSE_BREATHERS },
  always(['open_mouth_breathing'], 'consult_soon'),
  { symptoms: ['hind_limb_weakness'], level: 'urgent', species: ['dog', 'cat'] },
  always(['hind_limb_weakness'], 'consult_soon'),
  // Cita pronto en cualquier especie.
  ...[
    'blood_in_urine',
    'bleeding',
    'weight_loss',
    'pain_signs',
    'squinting',
    'sunken_eyes',
    'balance_loss',
    'head_tilt',
    'disorientation',
    'tail_bobbing',
    'fluffed_feathers',
    'teeth_grinding',
    'small_droppings',
    'regurgitation',
    'swollen_limbs',
    'mouth_changes',
    'sweating',
  ].map((code) => always([code], 'consult_soon')),
  // Cita pronto en algunas especies (en los animales pequeños y en las aves todo va más deprisa).
  { symptoms: ['appetite_loss'], level: 'consult_soon', species: [...SMALL_HERBIVORES, 'hamster', 'bird_other'] },
  { symptoms: ['dental_problems'], level: 'consult_soon', species: [...SMALL_HERBIVORES, 'hamster', 'horse'] },
  { symptoms: ['soiled_rear'], level: 'consult_soon', species: [...SMALL_HERBIVORES, 'hamster'] },
  { symptoms: ['lethargy'], level: 'consult_soon', species: ['hamster', 'bird_other'] },
  { symptoms: ['diarrhea'], level: 'consult_soon', species: [...SMALL_HERBIVORES, 'hamster'] },
  // Combinaciones.
  always(['lethargy', 'appetite_loss'], 'consult_soon'),
  always(['wound', 'lethargy'], 'consult_soon'),
  always(['vomiting', 'lethargy'], 'consult_soon'),
  always(['diarrhea', 'lethargy'], 'consult_soon'),
  always(['vomiting', 'diarrhea'], 'consult_soon'),
  always(['not_basking', 'lethargy'], 'consult_soon'),
  always(['excessive_thirst', 'urination_changes'], 'consult_soon'),
];

function rank(level: UrgencyLevel): number {
  return URGENCY_LEVELS.indexOf(level);
}

/** Nivel tras aplicar las reglas que cumplen las señales marcadas en esta especie. */
export function applyUrgencyFloor(
  level: UrgencyLevel,
  symptomCodes: readonly string[],
  speciesCode: string | null = null
): UrgencyLevel {
  let result = level;
  for (const rule of URGENCY_RULES) {
    if (rule.species && (speciesCode === null || !rule.species.includes(speciesCode))) continue;
    if (!rule.symptoms.every((code) => symptomCodes.includes(code))) continue;
    if (rank(rule.level) > rank(result)) result = rule.level;
  }
  return result;
}

/** Nivel mínimo que imponen las señales (se le indica al modelo en el prompt). */
export function minimumUrgency(symptomCodes: readonly string[], speciesCode: string | null = null): UrgencyLevel {
  return applyUrgencyFloor('observe', symptomCodes, speciesCode);
}

/** Señales que por sí solas son `urgent` en una especie (la app avisa al momento). */
export function urgentSignsFor(speciesCode: string): string[] {
  const codes = new Set<string>();
  for (const rule of URGENCY_RULES) {
    if (rule.level !== 'urgent' || rule.symptoms.length !== 1) continue;
    if (rule.species && !rule.species.includes(speciesCode)) continue;
    codes.add(rule.symptoms[0]);
  }
  return [...codes].sort();
}
