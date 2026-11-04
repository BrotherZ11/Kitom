import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

/**
 * Informes de errores de producción (Sentry). Solo se activa en builds de release con
 * `EXPO_PUBLIC_SENTRY_DSN` (el DSN es público por diseño: solo permite enviar eventos). Nunca se envían
 * datos personales: sin IP ni cabeceras (`sendDefaultPii: false`), sin usuario, sin cuerpos de
 * peticiones y sin el texto de las consultas ni de los registros (las migas de pan de red y consola se
 * reducen a método, estado y ruta sin parámetros). Política de privacidad: `docs/PRIVACY.md`.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export const isErrorReportingEnabled = Boolean(dsn) && !__DEV__;

/** Quita la query (tokens, emails, ids) de una URL. */
function stripQuery(url: unknown): string | undefined {
  return typeof url === 'string' ? url.split('?')[0] : undefined;
}

export function initErrorReporting(): void {
  if (!isErrorReportingEnabled) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      delete event.request;
      delete event.extra;
      if (event.contexts) {
        delete event.contexts.profile;
        // Identificador estable de la instalación: permitiría seguir a una persona entre informes.
        delete event.contexts.device?.id;
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // El texto de consola puede contener contenido del usuario: fuera.
      if (breadcrumb.category === 'console') return null;
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        const data = breadcrumb.data ?? {};
        breadcrumb.data = { method: data.method, status_code: data.status_code, url: stripQuery(data.url) };
      }
      if (breadcrumb.category === 'navigation') {
        breadcrumb.data = { from: stripQuery(breadcrumb.data?.from), to: stripQuery(breadcrumb.data?.to) };
      }
      return breadcrumb;
    },
  });
}

type RootComponent = ComponentType<Record<string, unknown>>;

/** Envuelve el componente raíz (captura errores de renderizado) solo si Sentry está activo. */
export function withErrorReporting(component: RootComponent): RootComponent {
  return isErrorReportingEnabled ? Sentry.wrap(component) : component;
}
