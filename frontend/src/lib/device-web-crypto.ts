import * as Crypto from 'expo-crypto';

import { installWebCrypto } from '@/lib/web-crypto';

// Antes de crear cualquier cliente de Supabase (`lib/supabase.ts` lo importa primero): PKCE con
// verificador aleatorio seguro y challenge S256 también en Hermes.
installWebCrypto(globalThis as { crypto?: unknown }, {
  getRandomValues: (array) => Crypto.getRandomValues(array as unknown as Uint8Array) as unknown as typeof array,
  digestSha256: (data) => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>),
});
