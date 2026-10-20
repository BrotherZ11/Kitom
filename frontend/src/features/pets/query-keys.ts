import type { Locale } from '@/i18n';

/**
 * Query keys de mascotas. Todas cuelgan de `['pets']` para poder invalidarlas juntas, y las de la
 * lista y la ficha llevan el usuario (como Daily Logs): una respuesta tardía de una sesión anterior
 * nunca cae en las queries de la cuenta activa (además, AuthProvider vacía la caché al cerrar sesión o
 * cambiar de cuenta). La caché de TanStack Query no se persiste: la copia sin conexión es `LocalStore`
 * (`offline/pet-cache-repository.ts`), que se lee con las claves `local*`.
 * `photo` no lleva usuario: es la URL firmada de un path (la autoriza Storage al firmarla).
 */
export const petKeys = {
  all: ['pets'] as const,
  user: (userId: string) => [...petKeys.all, userId] as const,
  lists: (userId: string) => [...petKeys.user(userId), 'list'] as const,
  details: (userId: string) => [...petKeys.user(userId), 'detail'] as const,
  detail: (userId: string, petId: string) => [...petKeys.details(userId), petId] as const,
  canEdit: (userId: string, petId: string) => [...petKeys.detail(userId, petId), 'can-edit'] as const,
  streak: (userId: string, petId: string) => [...petKeys.detail(userId, petId), 'streak'] as const,
  /** Copias del dispositivo (lista y fichas). */
  local: (userId: string) => [...petKeys.user(userId), 'local'] as const,
  localList: (userId: string) => [...petKeys.local(userId), 'list'] as const,
  localDetail: (userId: string, petId: string) => [...petKeys.local(userId), 'detail', petId] as const,
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
