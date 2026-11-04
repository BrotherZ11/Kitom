/**
 * Páginas públicas de Kitom (GitHub Pages del repositorio, carpeta `site/`) y contacto. La app enseña sus
 * propias copias de los textos legales (`/legal/[doc]`), pero las tiendas exigen URL accesibles sin la app:
 * `privacy.html`, `terms.html` y `delete-account.html`. Responsable: persona física (ver `docs/PRIVACY.md`).
 * Cambiar aquí si se mueve el dominio, y en Supabase Auth (`docs/SETUP_GUIDE.md`).
 */
export const LEGAL_SITE_URL = 'https://brotherz11.github.io/Kitom';

/** Página puente de los enlaces de email: `site/auth/callback.html` (ver `auth-callback-plan.ts`). */
export const EMAIL_LINK_BRIDGE_URL = `${LEGAL_SITE_URL}/auth/callback.html`;

export const SUPPORT_EMAIL = 'dzarzavillaborrego@gmail.com';
