# KITOM

App móvil (Android/iOS) de bienestar emocional y conductual para perros y gatos: registro diario,
historial con gráficos, agenda con avisos, consultas orientativas con IA (foto + síntomas; **Kitom no
diagnostica**), rachas y logros, y co-tutores por mascota. Funciona sin conexión para mascotas y
registros.

**Estado (2026-10-29):** MVP construido sobre `kitom-dev`; **no publicable todavía**. Estado
detallado y bloqueantes en [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md); plan en
[docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- `frontend/`: Expo SDK 57, React Native 0.86, React 19, TypeScript, Expo Router, TanStack Query,
  React Context, supabase-js. Módulo nativo propio `modules/kitom-exact-alarms` (Android).
- `supabase/`: Postgres 17 con RLS en todas las tablas, Auth, Storage, Edge Functions (Deno):
  `ai-analysis-process` (Gemini por defecto) y `pet-storage-cleanup`.
- `database/v2.2.1/`: SQL de diseño original (histórico, solo lectura).

Arquitectura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

Node 24+, npm, Docker (Supabase local), Android Studio o Xcode para builds nativas. Expo Go sirve para
casi todo salvo los avisos locales y las alarmas exactas, que necesitan una build nativa.

## Puesta en marcha

```bash
cd frontend
npm install
cp .env.example .env   # rellenar EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start
```

Contra el Supabase local (desde la raíz `npx supabase start`, luego en `frontend/`):
`npm run start:local`. Solo hay dos variables públicas; los secretos de las Edge Functions nunca van
en el repo (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §2).

## Comandos

| Acción | Comando |
|---|---|
| Arrancar | `npx expo start` (en `frontend/`) |
| Arrancar contra Supabase local | `npm run start:local` |
| Tipos / lint | `npx tsc --noEmit` · `npx expo lint` |
| Pruebas unitarias | `npm test` |
| Pruebas de integración (solo local) | `npm run test:integration` |
| Pruebas de base de datos (solo local) | `npx supabase test db` (raíz) y `supabase/tests/concurrency/*.sh` |
| Salud de dependencias | `npx expo-doctor` |
| Añadir dependencia | `npx expo install <paquete>` |
| Supabase CLI | `npx supabase …` (raíz) |

Detalle y resultados: [docs/TESTING.md](docs/TESTING.md).

## Compilación

Hoy solo hay APK de prueba local (`npx expo prebuild --platform android` + Gradle, firmada con la
clave de depuración). EAS, firma de release e iOS están por configurar:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Base de datos

El esquema desplegado son las migraciones de `supabase/migrations/`. Todo cambio va en una migración
nueva, en un PR `db/…` propio; `db push` lo ejecuta el responsable del proyecto. Reglas:
[supabase/CLAUDE.md](supabase/CLAUDE.md).

## Flujo Git

Ramas `feat/…`, `fix/…`, `chore/…`, `docs/…`, `db/…` · Conventional Commits · PR hacia `main`.

## Documentación

| Documento | Contenido |
|---|---|
| [PROJECT_STATUS](docs/PROJECT_STATUS.md) | estado, inventario de funcionalidades, bugs conocidos |
| [ROADMAP](docs/ROADMAP.md) | backlog P0–P3 hasta producción |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | visión general y mapa de módulos |
| [FRONTEND_ARCHITECTURE](docs/FRONTEND_ARCHITECTURE.md) | contrato pantalla ↔ datos, offline, sesión |
| [README (SQL)](docs/README.md) · [DATABASE](docs/DATABASE.md) | contrato de la base · estado desplegado y cobertura |
| [SECURITY_AUDIT](docs/SECURITY_AUDIT.md) · [PRIVACY](docs/PRIVACY.md) | hallazgos de seguridad · inventario de datos personales |
| [TESTING](docs/TESTING.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) | pruebas · entornos, compilación y publicación |
| [AUTH](docs/AUTH.md) · [SEED](docs/SEED.md) | autenticación y deep links · datos de referencia |
| [DECISIONS](docs/DECISIONS.md) · [CHANGELOG](docs/CHANGELOG.md) | decisiones técnicas · cambios |
| [PRD](docs/PRD.md) · [design/](docs/design/) | producto · diseño de pantallas y marca |
