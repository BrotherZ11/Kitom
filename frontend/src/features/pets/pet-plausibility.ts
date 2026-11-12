/**
 * Límites de lo que puede ser cierto por especie: detectan erratas (7000 kg en vez de 7) sin sustituir el
 * criterio de nadie. Son deliberadamente holgados, por encima de los récords conocidos, porque rechazar un
 * dato real es peor que dejar pasar uno raro. Solo los aplica el formulario: la base de datos únicamente
 * exige un peso positivo y una fecha no futura. Módulo puro (`npm test`).
 */
type PetLimits = { minWeightKg: number; maxWeightKg: number; maxAgeYears: number };

/** Por `species.code`. Una especie nueva o desconocida usa `FALLBACK_LIMITS`. */
const LIMITS_BY_SPECIES: Readonly<Record<string, PetLimits>> = {
  // Mínimos: por debajo de cualquier recién nacido de la especie (un hámster de 30 kg o un caballo de
  // 3 kg son erratas de unidad).
  dog: { minWeightKg: 0.05, maxWeightKg: 160, maxAgeYears: 35 },
  cat: { minWeightKg: 0.05, maxWeightKg: 25, maxAgeYears: 40 },
  rabbit: { minWeightKg: 0.03, maxWeightKg: 25, maxAgeYears: 20 },
  guinea_pig: { minWeightKg: 0.05, maxWeightKg: 4, maxAgeYears: 15 },
  hamster: { minWeightKg: 0.002, maxWeightKg: 1, maxAgeYears: 8 },
  horse: { minWeightKg: 15, maxWeightKg: 1600, maxAgeYears: 65 },
  bird_other: { minWeightKg: 0.001, maxWeightKg: 160, maxAgeYears: 120 },
  reptile_other: { minWeightKg: 0.001, maxWeightKg: 1000, maxAgeYears: 200 },
};

const FALLBACK_LIMITS: PetLimits = { minWeightKg: 0, maxWeightKg: 2000, maxAgeYears: 200 };

function limitsFor(speciesCode: string | undefined): PetLimits {
  return (speciesCode !== undefined && LIMITS_BY_SPECIES[speciesCode]) || FALLBACK_LIMITS;
}

export function isPlausibleWeight(weightKg: number, speciesCode: string | undefined): boolean {
  const limits = limitsFor(speciesCode);
  return weightKg >= limits.minWeightKg && weightKg <= limits.maxWeightKg;
}

/** `birthDate` y `today` en `AAAA-MM-DD`, ya validadas: el orden de texto es el de las fechas. */
export function isPlausibleBirthDate(birthDate: string, today: string, speciesCode: string | undefined): boolean {
  const oldestYear = Number(today.slice(0, 4)) - limitsFor(speciesCode).maxAgeYears;
  const oldest = `${String(oldestYear).padStart(4, '0')}${today.slice(4)}`;
  return birthDate >= oldest;
}
