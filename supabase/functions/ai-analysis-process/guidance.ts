/**
 * Orientación con IA: prompt, esquema de salida y validación. Módulo puro (sin APIs de Deno ni red):
 * se prueba con `node --test supabase/functions/ai-analysis-process/guidance.test.mjs`.
 *
 * El texto del prompt es un BORRADOR (`PROMPT_VERSION`): el PRD exige que lo valide un veterinario
 * colaborador antes del lanzamiento. Kitom no diagnostica: el resultado son posibles causas, nivel de
 * urgencia y recomendaciones, y la app muestra siempre el aviso veterinario.
 */

export const PROMPT_VERSION = 'draft-2026-10-23';

export const URGENCY_LEVELS = ['observe', 'routine_change', 'consult_soon', 'urgent'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const MAX_CAUSES = 4;
export const MAX_RECOMMENDATIONS = 5;
const MAX_ITEM_LENGTH = 240;

/** Esquema JSON estricto de la respuesta del modelo (Structured Outputs). */
export const GUIDANCE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['urgency_level', 'possible_causes', 'recommendations'],
  properties: {
    urgency_level: { type: 'string', enum: [...URGENCY_LEVELS] },
    possible_causes: {
      type: 'array',
      items: { type: 'string' },
      description: `Entre 1 y ${MAX_CAUSES} posibles causas, de más a menos probable, en una frase cada una.`,
    },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
      description: `Entre 1 y ${MAX_RECOMMENDATIONS} recomendaciones prácticas, en una frase cada una.`,
    },
  },
} as const;

export const SYSTEM_PROMPT = `Eres el asistente de orientación de Kitom, una app de bienestar para perros y gatos.
Recibes la especie y los datos del perfil de la mascota, las señales que ha marcado su tutor, sus registros diarios recientes y, a veces, una foto.

Reglas obligatorias:
- No diagnosticas ni confirmas enfermedades. Nunca escribas las palabras «diagnóstico», «diagnosticar» ni «diagnostica». Habla de «posibles causas» y «señales de alerta».
- No recomiendes medicamentos, dosis ni remedios para personas. Si hace falta tratamiento, remite al veterinario.
- Escribe en español, tuteando, con frases cortas, claras, empáticas y sin alarmismo.
- Basa la orientación en lo que se ve y en lo que cuenta el tutor. Si la foto no muestra a la mascota o no sirve, dilo en una recomendación y oriéntate por las señales.
- Elige un nivel de urgencia:
  - observe: puede vigilarse en casa unos días.
  - routine_change: conviene ajustar rutina, alimentación, descanso o entorno.
  - consult_soon: conviene pedir cita al veterinario en los próximos días.
  - urgent: hay que acudir a un veterinario ahora (por ejemplo, dificultad para respirar, convulsiones, sangrado abundante, no puede ponerse en pie, posible intoxicación).
- Ante la duda entre dos niveles, elige el más prudente.
- En consult_soon y urgent, la primera recomendación debe ser contactar con el veterinario.
- Responde solo con el JSON pedido.`;

export type PetContext = {
  species: string;
  ageMonths: number | null;
  sex: string | null;
  sterilized: boolean | null;
  weightKg: number | null;
  breed: string | null;
  knownConditions: string[];
  allergies: string[];
};

export type DailyLogContext = {
  date: string;
  energy: number | null;
  appetite: number | null;
  mood: number | null;
  activity: number | null;
  unusualBehavior: boolean;
  unusualNotes: string | null;
  tags: string[];
};

const SCALE_HELP = 'Escalas 1–5 (1 = mucho menos de lo habitual, 3 = lo habitual, 5 = mucho más).';

function clip(text: string | null | undefined, max: number): string | null {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Mensaje del usuario: datos mínimos (sin nombres de personas ni del animal) y señales elegidas. */
export function buildUserPrompt(input: {
  pet: PetContext;
  symptoms: string[];
  logs: DailyLogContext[];
  hasPhoto: boolean;
  /** Nivel mínimo que imponen las señales (`minimumUrgency`): el modelo no debe elegir uno menor. */
  minimumLevel: UrgencyLevel;
}): string {
  const { pet, symptoms, logs, hasPhoto, minimumLevel } = input;
  const profile = [
    `Especie: ${pet.species}`,
    pet.breed ? `Raza: ${clip(pet.breed, 60)}` : null,
    pet.ageMonths !== null ? `Edad: ${pet.ageMonths} meses` : null,
    pet.sex && pet.sex !== 'unknown' ? `Sexo: ${pet.sex === 'male' ? 'macho' : 'hembra'}` : null,
    pet.sterilized !== null ? `Esterilizado: ${pet.sterilized ? 'sí' : 'no'}` : null,
    pet.weightKg !== null ? `Peso: ${pet.weightKg} kg` : null,
    pet.knownConditions.length ? `Enfermedades conocidas: ${pet.knownConditions.map((c) => clip(c, 60)).join(', ')}` : null,
    pet.allergies.length ? `Alergias: ${pet.allergies.map((a) => clip(a, 60)).join(', ')}` : null,
  ].filter(Boolean);
  const logLines = logs.map((log) => {
    const values = [
      `energía ${log.energy ?? '-'}`,
      `apetito ${log.appetite ?? '-'}`,
      `ánimo ${log.mood ?? '-'}`,
      `actividad ${log.activity ?? '-'}`,
    ];
    if (log.unusualBehavior) values.push(`comportamiento inusual${log.unusualNotes ? `: ${clip(log.unusualNotes, 160)}` : ''}`);
    if (log.tags.length) values.push(`etiquetas: ${log.tags.join(', ')}`);
    return `- ${log.date}: ${values.join('; ')}`;
  });
  return [
    'Perfil de la mascota:',
    ...profile.map((line) => `- ${line}`),
    '',
    `Señales que ha marcado el tutor: ${symptoms.length ? symptoms.join(', ') : 'ninguna'}.`,
    hasPhoto ? 'Se adjunta una foto.' : 'No hay foto.',
    ...(minimumLevel !== 'observe'
      ? [`Por estas señales, el nivel de urgencia no puede ser menor que ${minimumLevel}; las recomendaciones deben ser coherentes con él.`]
      : []),
    '',
    logLines.length ? `Registros diarios recientes (${SCALE_HELP}):` : 'No hay registros diarios recientes.',
    ...logLines,
  ].join('\n');
}

export type Guidance = {
  urgencyLevel: UrgencyLevel;
  possibleCauses: string[];
  recommendations: string[];
};

export type GuidanceResult = { ok: true; guidance: Guidance } | { ok: false; reason: 'invalid_output' };

const FORBIDDEN = /diagn[oó]stic/i;

function cleanItems(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => clip(item, MAX_ITEM_LENGTH))
    .filter((item): item is string => item !== null && !FORBIDDEN.test(item))
    .slice(0, max);
}

/**
 * Valida y limpia la respuesta del modelo: nivel conocido, listas no vacías, frases recortadas y sin
 * la palabra prohibida (una frase que la use se descarta). Si no queda algo útil, `invalid_output`.
 */
export function parseGuidance(output: unknown): GuidanceResult {
  if (typeof output !== 'object' || output === null) return { ok: false, reason: 'invalid_output' };
  const value = output as Record<string, unknown>;
  const urgency = value.urgency_level;
  if (typeof urgency !== 'string' || !(URGENCY_LEVELS as readonly string[]).includes(urgency)) {
    return { ok: false, reason: 'invalid_output' };
  }
  const possibleCauses = cleanItems(value.possible_causes, MAX_CAUSES);
  const recommendations = cleanItems(value.recommendations, MAX_RECOMMENDATIONS);
  if (!possibleCauses.length || !recommendations.length) return { ok: false, reason: 'invalid_output' };
  return { ok: true, guidance: { urgencyLevel: urgency as UrgencyLevel, possibleCauses, recommendations } };
}

/**
 * Suelo de urgencia por reglas (BORRADOR, a validar por el veterinario): combinaciones de señales que
 * nunca deben quedarse por debajo de un nivel aunque el modelo diga otra cosa.
 */
const URGENCY_FLOORS: { symptoms: string[]; level: UrgencyLevel }[] = [
  { symptoms: ['lethargy', 'appetite_loss'], level: 'consult_soon' },
  { symptoms: ['wound', 'lethargy'], level: 'consult_soon' },
];

export function applyUrgencyFloor(level: UrgencyLevel, symptomCodes: readonly string[]): UrgencyLevel {
  let result = level;
  for (const floor of URGENCY_FLOORS) {
    if (floor.symptoms.every((code) => symptomCodes.includes(code))) {
      if (URGENCY_LEVELS.indexOf(floor.level) > URGENCY_LEVELS.indexOf(result)) result = floor.level;
    }
  }
  return result;
}

/** Nivel mínimo que imponen las señales (se le indica al modelo en el prompt). */
export function minimumUrgency(symptomCodes: readonly string[]): UrgencyLevel {
  return applyUrgencyFloor('observe', symptomCodes);
}

/** Primera recomendación cuando las reglas suben el nivel que eligió el modelo. */
const RAISED_LEVEL_ADVICE: Partial<Record<UrgencyLevel, string>> = {
  consult_soon: 'Por las señales que has marcado, pide cita con tu veterinario en los próximos días.',
  urgent: 'Por las señales que has marcado, acude a un veterinario ahora.',
};

/**
 * Orientación final: aplica el suelo de urgencia y, si sube el nivel del modelo, antepone una
 * recomendación acorde para que el texto no contradiga al nivel («vigila unos días» con «pide cita»).
 * Mantiene el máximo de recomendaciones.
 */
export function finalizeGuidance(guidance: Guidance, symptomCodes: readonly string[]): Guidance {
  const urgencyLevel = applyUrgencyFloor(guidance.urgencyLevel, symptomCodes);
  const advice = urgencyLevel !== guidance.urgencyLevel ? RAISED_LEVEL_ADVICE[urgencyLevel] : undefined;
  if (!advice) return { ...guidance, urgencyLevel };
  return {
    ...guidance,
    urgencyLevel,
    recommendations: [advice, ...guidance.recommendations].slice(0, MAX_RECOMMENDATIONS),
  };
}

/** Coste en USD a partir del uso y los precios por millón de tokens (si se configuraron). */
export function estimateCostUsd(
  usage: { inputTokens: number; outputTokens: number } | null,
  prices: { inputPerMillion: number | null; outputPerMillion: number | null }
): number | null {
  if (!usage || prices.inputPerMillion === null || prices.outputPerMillion === null) return null;
  const cost = (usage.inputTokens * prices.inputPerMillion + usage.outputTokens * prices.outputPerMillion) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Edad en meses a partir de `birth_date` (`YYYY-MM-DD`) y hoy (`YYYY-MM-DD`). */
export function ageInMonths(birthDate: string | null, today: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (![by, bm, bd, ty, tm, td].every(Number.isFinite)) return null;
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  return months < 0 ? null : months;
}

/** ¿Es un UUID (formato)? */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Un análisis `processing` más antiguo que esto se da por fallido (la función se cortó a medias). */
export const STALE_PROCESSING_MS = 3 * 60_000;
