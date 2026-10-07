import type { Breed } from '@/features/pets/types';

/** Máximo de resultados que se pintan a la vez (el catálogo de perro tiene ~155 razas). */
export const MAX_BREED_RESULTS = 25;

const ACCENTS: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ñ: 'n', ç: 'c',
};

/** Minúsculas y sin tildes ni signos, para que «bichon» encuentre «Bichón». */
export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[áàâäéèêëíìîïóòôöúùûüñç]/g, (char) => ACCENTS[char] ?? char)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Filtra por nombre y alias. Orden: el nombre empieza por la búsqueda, el nombre la contiene, un alias
 * la contiene; dentro de cada grupo se mantiene el orden alfabético de entrada.
 */
export function searchBreeds(breeds: Breed[], query: string): Breed[] {
  const needle = normalizeForSearch(query);
  if (needle === '') return breeds;

  const ranked: { breed: Breed; rank: number }[] = [];
  for (const breed of breeds) {
    const name = normalizeForSearch(breed.name);
    let rank = -1;
    if (name.startsWith(needle) || name.includes(` ${needle}`)) rank = 0;
    else if (name.includes(needle)) rank = 1;
    else if (breed.aliases.some((alias) => normalizeForSearch(alias).includes(needle))) rank = 2;
    if (rank >= 0) ranked.push({ breed, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((item) => item.breed);
}
