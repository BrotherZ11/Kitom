import type { Breed } from '@/features/pets/types';

import type { BreedCatalogRepository } from './breed-catalog-repository.ts';

/**
 * Función de la query del catálogo de razas, que pasa por la copia del dispositivo. Módulo puro: todo
 * se inyecta (se prueba con el QueryClient de `@tanstack/query-core` y contra el Supabase local).
 *
 * El catálogo solo se copia si la respuesta es correcta (un error lanza antes de llegar al almacén:
 * nunca se interpreta como «no hay razas» ni borra la copia) y si, al terminar, la sesión sigue siendo
 * la del dueño de la copia (`isOwnerSession`). El catálogo es igual para todas las cuentas, pero la
 * copia vive en el almacén del usuario (`LocalStore`), como el resto de datos locales.
 */

export type BreedCatalogQueryDeps = {
  repository: Pick<BreedCatalogRepository, 'beginRead' | 'apply'>;
  fetchCatalog: (locale: string) => Promise<Breed[]>;
  serverCall: <T>(call: () => Promise<T>) => Promise<T>;
  isOwnerSession: () => boolean;
  /** Tras cambiar la copia (solo con la sesión del dueño), p. ej. invalidar su lectura local. */
  onStored?: () => void;
};

export async function fetchBreedCatalogThroughCache(deps: BreedCatalogQueryDeps, locale: string): Promise<Breed[]> {
  const mark = deps.repository.beginRead();
  const breeds = await deps.serverCall(() => deps.fetchCatalog(locale));
  if (!deps.isOwnerSession()) return breeds;
  const shown = await deps.repository.apply(mark, locale, breeds);
  deps.onStored?.();
  return shown;
}

/**
 * Reintentos de la query: uno para errores del servidor (como el resto de la app) y ninguno sin
 * conexión, donde reintentar solo repite una petición que no puede salir; al volver la red se pide sola.
 */
export function shouldRetryBreedCatalog(
  failureCount: number,
  error: unknown,
  isOfflineError: (error: unknown) => boolean
): boolean {
  return !isOfflineError(error) && failureCount < 1;
}
