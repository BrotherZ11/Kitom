import type { LocalCollection } from '@/lib/local-store/local-store';

/**
 * Mascota activa (la que se ve en Hoy, Historial, Agenda y Perfil). Módulo puro: se prueba con
 * `npm test`. Se guarda en el dispositivo por usuario (`LocalStore`); no hay columna en la BD.
 */

export type ActivePetPreference = { petId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVE_PET_COLLECTION: LocalCollection<ActivePetPreference> = {
  name: 'active-pet',
  version: 1,
  parse(data) {
    if (typeof data !== 'object' || data === null) return null;
    const petId = (data as { petId?: unknown }).petId;
    return typeof petId === 'string' && UUID.test(petId) ? { petId } : null;
  },
};

/** Clave del único elemento de la colección. */
export const ACTIVE_PET_ID = ['current'] as const;

/**
 * Mascota activa entre las visibles: la guardada si sigue visible (RLS puede haberla quitado) y, si
 * no, la primera de la lista. `null` sin mascotas.
 */
export function resolveActivePet<T extends { id: string }>(pets: readonly T[], storedId: string | null): T | null {
  return pets.find((pet) => pet.id === storedId) ?? pets[0] ?? null;
}
