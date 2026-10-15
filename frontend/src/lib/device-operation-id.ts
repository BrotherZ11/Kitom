import * as Crypto from 'expo-crypto';

import { createOperationIdGenerator } from '@/lib/operation-id';

/**
 * Identificador de una operación local nueva. `expo-crypto` usa el generador seguro del sistema en
 * iOS y Android y `crypto.randomUUID()` en web (solo en contexto seguro: HTTPS o localhost; fuera
 * de él lanza `OperationIdError('unavailable')`). Todavía no lo usa ninguna pantalla (fase 1 del
 * modo offline).
 */
export const createOperationId = createOperationIdGenerator(() => Crypto.randomUUID());
