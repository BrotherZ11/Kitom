import { useEffect, useState } from 'react';

import { cooldownRemainingSeconds, RESEND_COOLDOWN_MS } from '@/features/auth/resend-cooldown';

/**
 * Espera visible entre reenvíos (`resend-cooldown.ts`). `start()` la empieza ahora (envío hecho o
 * rechazado por límite); `startedAt` permite empezarla ya al montar (p. ej. tras el registro, que acaba
 * de enviar el primer email). Se actualiza cada segundo solo mientras queda espera.
 */
export function useResendCooldown(startedAt: number | null = null, cooldownMs = RESEND_COOLDOWN_MS) {
  const [lastSentAt, setLastSentAt] = useState(startedAt);
  const [now, setNow] = useState(() => Date.now());
  const remaining = cooldownRemainingSeconds(lastSentAt, now, cooldownMs);
  const waiting = remaining > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const start = () => {
    const at = Date.now();
    setLastSentAt(at);
    setNow(at);
  };

  return { remaining, start };
}
