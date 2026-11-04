import { Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/lib/legal-links';

/**
 * Abre la app de correo con un mensaje a soporte (`SUPPORT_EMAIL`). Devuelve `false` si no hay ninguna
 * (p. ej. un emulador sin cuenta de correo); la pantalla muestra entonces la dirección.
 */
export async function openSupportEmail(subject?: string): Promise<boolean> {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}${query}`);
    return true;
  } catch {
    return false;
  }
}
