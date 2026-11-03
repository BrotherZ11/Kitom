/**
 * Espera entre reenvíos de emails de Auth (confirmación del registro, código de verificación). Módulo
 * puro (`npm test`); el temporizador visible es `use-resend-cooldown.ts`.
 *
 * Supabase Auth limita igualmente los envíos (por usuario, «max_frequency», y por proyecto, «email
 * sent» por hora): un `rate_limited` del servidor vuelve a empezar la espera. La espera de la app solo
 * evita pedir algo que el servidor va a rechazar y muestra cuánto falta.
 */

export const RESEND_COOLDOWN_MS = 60_000;

/** Segundos que faltan (redondeados hacia arriba) desde el último envío; 0 = se puede reenviar. */
export function cooldownRemainingSeconds(lastSentAt: number | null, now: number, cooldownMs = RESEND_COOLDOWN_MS): number {
  if (lastSentAt === null) return 0;
  const remaining = lastSentAt + cooldownMs - now;
  // Un reloj que retrocede no deja la espera sin fin: nunca más que la espera completa.
  return remaining <= 0 ? 0 : Math.ceil(Math.min(remaining, cooldownMs) / 1000);
}
