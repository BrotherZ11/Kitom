# KITOM

App móvil de bienestar emocional y conductual para perros y gatos. Expo (React Native) + Supabase.

## Estructura
- `frontend/` — app Expo (SDK 57, TypeScript, Expo Router)
- `supabase/` — configuración del CLI y migraciones (esquema desplegado)
- `database/v2.2.1/` — SQL de diseño original (referencia histórica)
- `docs/` — PRD, arquitectura SQL, arquitectura frontend, changelog

## Requisitos
Node 24+, npm, Docker (solo para Supabase local), Expo Go o development build.

## Puesta en marcha
1. `cd frontend && npm install`
2. Copiar `frontend/.env.example` a `frontend/.env` y rellenar URL y anon key de Supabase.
3. `npx expo start`

## Comandos
| Acción | Comando |
|---|---|
| Arrancar | `npx expo start` (desde `frontend/`) |
| Lint | `npx expo lint` |
| Typecheck | `npx tsc --noEmit` |
| Añadir dependencia | `npx expo install <paquete>` |
| Supabase CLI | `npx supabase …` (desde la raíz) |

## Base de datos
El esquema v2.2.1 está cerrado. Todo cambio va en una migración nueva en `supabase/migrations/`,
revisada en un PR propio. Nunca editar migraciones ya aplicadas. Ver `supabase/CLAUDE.md`.

Estado conocido:
- `organizations` / `organization_members` no están desplegados (fuera del MVP).
- Datos de referencia (especies, síntomas, logros): `supabase/seed.sql`, ver [docs/SEED.md](docs/SEED.md).
- Edge Functions y buckets de Storage en local: pendientes.

## Flujo Git
Ramas `feat/…`, `fix/…`, `chore/…`, `docs/…`, `db/…` · Conventional Commits · PR hacia `main`.

## Documentación
- [PRD](docs/PRD.md)
- [Arquitectura SQL](docs/README.md)
- [Arquitectura frontend](docs/FRONTEND_ARCHITECTURE.md)
- [Autenticación (Supabase Auth, deep links, Google)](docs/AUTH.md)
- [Changelog v2.2.1](docs/CHANGELOG_v2.2.1.md)
