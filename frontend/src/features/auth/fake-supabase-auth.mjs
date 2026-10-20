// `supabase.auth` falso para las pruebas del arranque (`npm test`). Reproduce lo comprobado en
// @supabase/auth-js 2.117 (`__loadSession`, `_callRefreshToken`, `_signOut`):
// - Token vigente: la sesión guardada se entrega sin red.
// - Token caducado (o a menos de 90 s): se renueva. Sin red, error reintentable: la sesión SE QUEDA
//   guardada pero se entrega `null` (también en INITIAL_SESSION). Token de renovación rechazado: se
//   borra y se emite SIGNED_OUT.
// - Renovación correcta: se guarda la nueva y se emite TOKEN_REFRESHED.
// - `signOut` con error al leer la sesión (p. ej. renovación sin red): devuelve el error SIN borrarla.
// No es una prueba: lo importan los `*.test.mjs`.
import { Buffer } from 'node:buffer';

export const EXPIRY_MARGIN_MS = 90_000;
const RETRYABLE = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };

export const fakeJwt = (sub) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.firma`;

/** Almacenamiento de la sesión (como SecureStore/localStorage): `disk` sobrevive a los «reinicios». */
export function sessionStorageOn(disk) {
  return {
    async getItem(key) {
      return disk.get(key) ?? null;
    },
    async setItem(key, value) {
      disk.set(key, value);
    },
    async removeItem(key) {
      disk.delete(key);
    },
  };
}

export function makeSession(userId, { expiresAt, version = 1 } = {}) {
  return {
    access_token: fakeJwt(userId),
    refresh_token: `refresh-${userId}-${version}`,
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: userId, email: `${userId.slice(-4)}@kitom.test` },
  };
}

/**
 * `net.online`: hay red. `net.hang`: la red «cuelga» (las peticiones no terminan hasta `release()`).
 * `server.revoked`: tokens de renovación rechazados por el servidor. `server.keepRejected`: auth-js no
 * consigue borrar la sesión rechazada (p. ej. el almacenamiento falla): devuelve el error sin emitir nada.
 */
export function createFakeSupabaseAuth({ disk, key, clock, net = { online: true }, server = { revoked: new Set() } }) {
  const storage = sessionStorageOn(disk);
  const listeners = new Set();
  const calls = { refresh: 0, getSession: 0, signOut: 0 };
  let hung = [];

  const emit = (event, session) => {
    for (const listener of listeners) listener(event, session);
  };
  const stored = async () => {
    const raw = await storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  };

  const refresh = async (session) => {
    calls.refresh += 1;
    if (net.hang) await new Promise((resolve) => hung.push(resolve));
    if (!net.online) return { session: null, error: RETRYABLE };
    if (server.revoked.has(session.refresh_token)) {
      const error = { name: 'AuthApiError', code: 'refresh_token_not_found', status: 400 };
      if (server.keepRejected) return { session: null, error };
      await storage.removeItem(key);
      emit('SIGNED_OUT', null);
      return { session: null, error };
    }
    const version = Number(session.refresh_token.split('-').pop()) + 1;
    const next = makeSession(session.user.id, { expiresAt: Math.floor(clock.now / 1000) + 3600, version });
    await storage.setItem(key, JSON.stringify(next));
    emit('TOKEN_REFRESHED', next);
    return { session: next, error: null };
  };

  const load = async () => {
    const session = await stored();
    if (!session) return { session: null, error: null };
    if (session.expires_at * 1000 - clock.now >= EXPIRY_MARGIN_MS) return { session, error: null };
    const result = await refresh(session);
    // Renovación fallida con el token todavía vigente: se conserva la sesión.
    if (result.error && session.expires_at * 1000 > clock.now && (await stored())) return { session, error: null };
    return result;
  };

  return {
    storage,
    calls,
    net,
    /** La red deja de colgar: las peticiones retenidas terminan (con red o sin ella, según `net.online`). */
    release() {
      net.hang = false;
      const pending = hung;
      hung = [];
      for (const resolve of pending) resolve();
    },
    /** Inicio de sesión con contraseña (con red). */
    async signIn(userId) {
      const session = makeSession(userId, { expiresAt: Math.floor(clock.now / 1000) + 3600 });
      await storage.setItem(key, JSON.stringify(session));
      emit('SIGNED_IN', session);
      return session;
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      // Como supabase-js: INITIAL_SESSION a cada suscriptor, una vez cargada (y renovada) la sesión.
      void load().then(({ session }) => {
        if (listeners.has(callback)) callback('INITIAL_SESSION', session);
      });
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async getSession() {
      calls.getSession += 1;
      const { session, error } = await load();
      return { data: { session }, error };
    },
    async signOut() {
      calls.signOut += 1;
      const { error } = await load();
      if (error) return { error };
      await storage.removeItem(key);
      emit('SIGNED_OUT', null);
      return { error: null };
    },
  };
}
