/**
 * Identificadores de operación (UUID v4) para operaciones locales que se guardan en el dispositivo.
 * Módulo puro (sin imports): la fuente de azar se inyecta. La de la app es `expo-crypto`
 * (`device-operation-id.ts`), único punto que genera identificadores en producción.
 *
 * Un identificador se genera una vez, al crear la operación, y la acompaña mientras exista: los
 * reintentos y las ediciones siguientes lo conservan. Si la fuente falla o devuelve algo que no es
 * un UUID v4, se lanza un error: nunca se recurre a `Math.random`.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OperationIdErrorCode = 'unavailable' | 'invalid';

export class OperationIdError extends Error {
  readonly code: OperationIdErrorCode;

  constructor(code: OperationIdErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'OperationIdError';
    this.code = code;
  }
}

/** UUID v4 en minúsculas, la única forma válida de un identificador de operación. */
export function isOperationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

/**
 * Generador a partir de una fuente de UUID v4 criptográficamente segura (`randomUUID`).
 * `unavailable`: la fuente lanzó (p. ej. web fuera de un contexto seguro). `invalid`: devolvió otra cosa.
 */
export function createOperationIdGenerator(randomUUID: () => string): () => string {
  return () => {
    let value: unknown;
    try {
      value = randomUUID();
    } catch (error) {
      throw new OperationIdError('unavailable', error);
    }
    const id = typeof value === 'string' ? value.toLowerCase() : value;
    if (!isOperationId(id)) throw new OperationIdError('invalid');
    return id;
  };
}
