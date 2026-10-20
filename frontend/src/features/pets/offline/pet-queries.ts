import type { PetReads } from '@/features/pets/api/pets-remote';
import type { Pet } from '@/features/pets/types';

import type { PetCacheRepository, ReadMark } from './pet-cache-repository.ts';

/**
 * Funciones de las queries de mascotas que pasan por la copia local. Módulo puro: todo se inyecta (se
 * prueba con el QueryClient de `@tanstack/query-core` y contra el Supabase local).
 *
 * Una respuesta solo se copia en el dispositivo si:
 * 1. Es correcta: un error (red, sesión sin comprobar, servidor) lanza antes de llegar al almacén, así
 *    que nunca se interpreta como «no hay mascotas».
 * 2. Salió con la sesión utilizable (`serverCall`: en `offline` ni se envía) y autorizada como el dueño
 *    del almacén (`PetReads`, con el token del dueño en la cabecera).
 * 3. Al terminar, la sesión sigue siendo la del dueño (`isOwnerSession`). Si no, se devuelve tal cual a
 *    su query (cuya clave lleva el usuario anterior: no la ve la cuenta nueva) y no se guarda.
 * El almacén ordena después las respuestas fuera de orden (`pet-cache-repository.ts`).
 */

export type PetQueryDeps = {
  repository: Pick<PetCacheRepository, 'beginRead' | 'applyList' | 'applyPet'>;
  reads: PetReads;
  serverCall: <T>(call: () => Promise<T>) => Promise<T>;
  isOwnerSession: () => boolean;
  /** Tras cambiar la copia local (solo con la sesión del dueño), p. ej. invalidar sus lecturas locales. */
  onStored?: () => void;
};

export async function fetchPetListThroughCache(deps: PetQueryDeps): Promise<Pet[]> {
  const mark = deps.repository.beginRead();
  const rows = await deps.serverCall(() => deps.reads.list());
  if (!deps.isOwnerSession()) return rows;
  const shown = await deps.repository.applyList(mark, rows);
  deps.onStored?.();
  return shown;
}

export async function fetchPetThroughCache(deps: PetQueryDeps, petId: string): Promise<Pet | null> {
  const mark = deps.repository.beginRead();
  const row = await deps.serverCall(() => deps.reads.detail(petId));
  if (!deps.isOwnerSession()) return row;
  const shown = await deps.repository.applyPet(mark, petId, row);
  deps.onStored?.();
  return shown;
}

/**
 * Fila devuelta por una escritura online (crear, editar, cambiar la foto; `null` = borrada). `mark`
 * se toma antes de enviar la escritura: una lectura iniciada antes no la deshace.
 */
export async function storePetWrite(
  deps: Pick<PetQueryDeps, 'repository' | 'isOwnerSession' | 'onStored'>,
  mark: ReadMark,
  petId: string,
  row: Pet | null
): Promise<Pet | null> {
  if (!deps.isOwnerSession()) return row;
  try {
    const shown = await deps.repository.applyPet(mark, petId, row);
    deps.onStored?.();
    return shown;
  } catch {
    return row;
  }
}
