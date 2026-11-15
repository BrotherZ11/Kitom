/**
 * Señales que por sí solas son una urgencia en cada especie: al marcar una, la pantalla de señales
 * avisa al momento de que no hay que esperar a la orientación. Copia de las reglas `urgent` de una
 * sola señal de la Edge Function (`supabase/functions/ai-analysis-process/urgency.ts`, que es la que
 * decide el nivel): `urgency.test.mjs` comprueba que coinciden. Módulo puro, sin imports.
 * BORRADOR a validar por el veterinario asesor, como las reglas.
 */

const EVERY_SPECIES = ['breathing_difficulty', 'cant_stand', 'colic_signs', 'fly_larvae', 'hoof_heat', 'pale_gums', 'seizures', 'sitting_on_floor', 'toxin_ingestion'];

const BY_SPECIES: Readonly<Record<string, readonly string[]>> = {
  dog: ['bloated_abdomen', 'hind_limb_weakness', 'unproductive_retching'],
  cat: ['hind_limb_weakness', 'open_mouth_breathing', 'straining_to_urinate'],
  rabbit: ['bloated_abdomen', 'no_droppings', 'not_eating', 'open_mouth_breathing'],
  guinea_pig: ['bloated_abdomen', 'no_droppings', 'not_eating', 'open_mouth_breathing'],
  hamster: ['open_mouth_breathing'],
  horse: ['bloated_abdomen', 'no_droppings'],
  bird_other: ['open_mouth_breathing'],
  reptile_other: [],
  other: [],
};

/** Códigos de las señales urgentes de una especie, ordenados. */
export function urgentSignsFor(speciesCode: string | null | undefined): string[] {
  return [...EVERY_SPECIES, ...(BY_SPECIES[speciesCode ?? 'other'] ?? [])].sort();
}

/** ¿Alguna de las señales marcadas (por código) es urgente en esta especie? */
export function hasUrgentSign(speciesCode: string | null | undefined, symptomCodes: readonly string[]): boolean {
  const urgent = urgentSignsFor(speciesCode);
  return symptomCodes.some((code) => urgent.includes(code));
}
