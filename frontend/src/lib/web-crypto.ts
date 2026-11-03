/**
 * Completa `globalThis.crypto` donde el motor no lo trae (Hermes en iOS/Android). supabase-js lo usa
 * para el PKCE de Auth: sin `getRandomValues` genera el verificador con `Math.random` (predecible) y
 * sin `subtle.digest` manda el challenge en `plain` en vez de `S256`. Módulo puro (la implementación
 * se inyecta: `device-web-crypto.ts` usa `expo-crypto`); solo añade lo que falta, nunca sustituye la
 * implementación nativa del navegador.
 */

export type CryptoImpl = {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
  digestSha256: (data: Uint8Array) => Promise<ArrayBuffer>;
};

type AlgorithmIdentifier = string | { name: string };

function algorithmName(algorithm: AlgorithmIdentifier): string {
  return (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function installWebCrypto(target: { crypto?: unknown }, impl: CryptoImpl): void {
  const current = (target.crypto ?? {}) as { getRandomValues?: unknown; subtle?: unknown };
  const next: Record<string, unknown> = { ...current };
  if (typeof current.getRandomValues !== 'function') next.getRandomValues = impl.getRandomValues;
  if (typeof current.subtle !== 'object' || current.subtle === null) {
    next.subtle = {
      digest(algorithm: AlgorithmIdentifier, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
        if (algorithmName(algorithm) !== 'SHA-256') {
          return Promise.reject(new Error(`digest: algoritmo no soportado (${algorithmName(algorithm)})`));
        }
        return impl.digestSha256(toBytes(data));
      },
    };
  }
  if (target.crypto === undefined) {
    target.crypto = next;
  } else {
    // Algunos motores exponen un `crypto` no extensible: solo se completa si se puede.
    for (const key of ['getRandomValues', 'subtle'] as const) {
      if (next[key] !== current[key]) {
        try {
          Object.defineProperty(target.crypto, key, { value: next[key], configurable: true });
        } catch {
          // Sin `crypto` completo, supabase-js sigue funcionando (con el PKCE débil de antes).
        }
      }
    }
  }
}
