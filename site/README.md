# Kitom — páginas públicas (`site/`)

Sitio estático que exigen las tiendas: política de privacidad, términos y cómo eliminar la cuenta sin
la app. Sin cookies, sin analítica y sin recursos externos (las fuentes y los logos están en `assets/`).
Tema claro/oscuro según el sistema con los colores de `docs/design`. La única página con script es
`auth/callback.html` (abre la app desde un enlace de email; no enlazada desde el resto del sitio).

| Página | Español | Inglés |
|---|---|---|
| Inicio | `index.html` | `en/index.html` |
| Política de privacidad | `privacy.html` | `en/privacy.html` |
| Términos de uso | `terms.html` | `en/terms.html` |
| Eliminar la cuenta | `delete-account.html` | `en/delete-account.html` |
| Puente de los enlaces de email | `auth/callback.html` | la misma, según el idioma del navegador |

La app muestra sus propias copias de la política y los términos (`/legal/[doc]`). Se generan desde estas
páginas: después de cambiarlas, `npm run legal:build` en `frontend/` (una prueba falla si se olvida).

La URL base es `LEGAL_SITE_URL` de `frontend/src/lib/legal-links.ts` (`https://brotherz11.github.io/Kitom`).
Si cambian el usuario, el nombre del repositorio o el dominio, se cambia allí, en las fichas de las tiendas y
en las Redirect URLs de Supabase Auth (`docs/SETUP_GUIDE.md`). Todos los enlaces internos son relativos.

## Publicar con GitHub Pages

GitHub Pages solo sirve desde la raíz o `/docs` de una rama; `site/` se publica con el workflow
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) (`upload-pages-artifact` +
`deploy-pages`, versiones fijadas). Pasos, una sola vez:

1. Integrar en `main` la rama que trae `site/` y el workflow.
2. En GitHub: **Settings › Pages › Build and deployment › Source = «GitHub Actions»**.
3. Lanzar el workflow (pestaña **Actions › Pages › Run workflow**) o hacer un push a `main` que toque
   `site/`. Al terminar, la URL aparece en el resumen del job y en Settings › Pages.
4. Comprobar que abren `…/Kitom/privacy.html`, `…/terms.html` y `…/delete-account.html`.

Notas:

- **Repositorio privado:** GitHub Pages en un repositorio privado necesita un plan de pago (GitHub
  Pro, Team o Enterprise), y la web es pública igualmente. Con el plan gratuito, el repositorio tiene
  que ser público (o publicar `site/` desde otro repositorio público).
- `.nojekyll` evita el procesado de Jekyll si alguna vez se publica desde una rama.
- Cada cambio en `site/` que llegue a `main` se publica solo.

## Al cambiar un texto legal

- Cambiar a la vez la versión en español y en inglés (la española es la de referencia) y la fecha
  «En vigor desde».
- Si el cambio es importante, avisar en la app o por email antes de que se aplique (lo dicen las
  propias páginas).
- Mantener coherentes `docs/PRIVACY.md` (inventario técnico) y los textos de la app
  (`settings.legalScreen`, `settings.privacyScreen`, `consult.*`).
- Comentarios `<!-- CONFIRMAR -->` / `<!-- CONFIRM -->`: datos que debe confirmar el responsable
  (p. ej. la región de Supabase de producción).
