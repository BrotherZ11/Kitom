import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/lib/legal-links';

/**
 * Abre una página pública (política de privacidad, términos) en el navegador integrado de la app.
 * Devuelve `false` si no se ha podido abrir, para que la pantalla lo diga.
 */
export async function openWebPage(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }
}

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
