import { FunctionsHttpError } from '@supabase/supabase-js';

import {
  deletionErrorFromThrown,
  deletionRequestBody,
  readDeleteResponse,
  readPreviewResponse,
  type DeletionPlan,
  type DeletionPreview,
  type DeletionResult,
} from '@/features/account/account-deletion';
import { supabase } from '@/lib/supabase';

/**
 * Edge Function `delete-account` (con el JWT de la sesión, que añade el cliente). La función decide qué
 * es del usuario y qué pasa con cada mascota; aquí solo se lee su respuesta. Errores:
 * `AccountDeletionError` (`account-deletion.ts`).
 */
async function invokeDeleteAccount(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  try {
    const { data, error } = await supabase.functions.invoke<unknown>('delete-account', { body });
    if (!error) return { status: 200, body: data };
    // Respuesta no 2xx: el código está en el cuerpo JSON.
    if (error instanceof FunctionsHttpError && error.context instanceof Response) {
      const response = error.context;
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // Sin cuerpo JSON: solo cuenta el estado.
      }
      return { status: response.status, body: payload };
    }
    throw error;
  } catch (error) {
    throw deletionErrorFromThrown(error);
  }
}

/** Qué pasaría al borrar la cuenta ahora (no cambia nada). */
export async function fetchDeletionPreview(): Promise<DeletionPreview> {
  const response = await invokeDeleteAccount({ mode: 'preview' });
  return readPreviewResponse(response.status, response.body);
}

/** Borra la cuenta con el plan que el usuario ha visto y confirmado. */
export async function deleteAccount(plan: DeletionPlan): Promise<DeletionResult> {
  const response = await invokeDeleteAccount(deletionRequestBody(plan));
  return readDeleteResponse(response.status, response.body);
}
