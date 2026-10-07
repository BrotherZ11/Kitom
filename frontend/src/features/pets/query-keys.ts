import type { Locale } from '@/i18n';

/**
 * Query keys de mascotas. Todas cuelgan de `['pets']` para poder invalidarlas juntas.
 * No incluyen el usuario: AuthProvider vacía la caché al cerrar sesión o cambiar de cuenta.
 */
export const petKeys = {
  all: ['pets'] as const,
  lists: () => [...petKeys.all, 'list'] as const,
  details: () => [...petKeys.all, 'detail'] as const,
  detail: (petId: string) => [...petKeys.details(), petId] as const,
  canEdit: (petId: string) => [...petKeys.detail(petId), 'can-edit'] as const,
  photo: (photoPath: string) => [...petKeys.all, 'photo', photoPath] as const,
};

export const speciesKeys = {
  all: ['species'] as const,
  list: (locale: Locale) => [...speciesKeys.all, locale] as const,
};

export const breedKeys = {
  all: ['breeds'] as const,
  /** Razas activas de una especie. */
  list: (speciesId: string, locale: Locale) => [...breedKeys.all, 'list', speciesId, locale] as const,
  /** Una raza concreta (activa o no), para mostrar la de una mascota existente. */
  detail: (breedId: string, locale: Locale) => [...breedKeys.all, 'detail', breedId, locale] as const,
};
