# Changelog

Cambios relevantes del proyecto, en orden cronológico inverso. El detalle de cada contrato o
decisión permanece en su documento de referencia.

## 2026-10-08

- Zona horaria del perfil: `profiles.timezone` admite `NULL` (= sin configurar) y la app la inicializa
  con la del dispositivo sin sobrescribir nunca un valor existente. Nueva migración
  `20261008155257_profile_timezone.sql` (validada en local; **pendiente de aplicar en `kitom-dev`**) y
  nueva feature `frontend/src/features/profile/`. Primeros tests unitarios del frontend (`npm test`,
  runner de Node sin dependencias). Contrato en `FRONTEND_ARCHITECTURE.md` §9; decisión en `DECISIONS.md`.
- Corrección: `frontend/src/types/database.types.ts` se había guardado en UTF-16 (ESLint fallaba con
  "File appears to be binary"); vuelve a UTF-8 con el mismo contenido.
- La migración `20261008150202_daily_logs_fixes.sql` consta aplicada en `kitom-dev`.

- Backend de registros diarios: nueva migración `20261008150202_daily_logs_fixes.sql`. Corrige dos
  bugs del diseño original: ninguna escritura en `daily_logs` funcionaba (`recompute_pet_streak`) y
  borrar una mascota con 2+ registros fallaba (FK de `pet_streaks`). Añade la RPC `save_daily_log`, la
  ventana de creación de 7 días, `log_date` inmutable, los CHECK de tags, notas y registro vacío, y
  endurece los grants. Validada en local desde `db reset` con 134 pruebas pgTAP
  (`supabase/tests/database/daily_logs.test.sql`); **pendiente de aplicar en `kitom-dev`**. Frontend
  pendiente. Contrato en `FRONTEND_ARCHITECTURE.md` §4 «DailyLogScreen»; decisión en `DECISIONS.md`.
- Documentación: las migraciones `20261007172110` y `20261007182429` constan aplicadas en `kitom-dev`.

## 2026-10-07

- Fotos de mascota: añadir desde galería o cámara, previsualizar, cambiar y eliminar desde la ficha,
  en el bucket privado `pet-photos` con URLs firmadas. Nuevas dependencias `expo-image-picker` y
  `expo-image-manipulator` (requieren nuevo development build). Nueva migración
  `20261007182429_grant_safe_pet_id_from_path.sql` (sin ella Storage rechaza todas las operaciones);
  **pendiente de aplicar en `kitom-dev`**. Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets: fotos»;
  decisión en `DECISIONS.md`.
- Corrección: crear una mascota fallaba con `42501` (RLS) por el `RETURNING` del insert. Nueva
  migración `20261007172110_pets_select_policy_owner.sql`; pendiente de aplicar en `kitom-dev`.
- Pets usa el catálogo de razas: selección de estado (con raza / mestizo / desconocida), buscador por
  especie con alias y opción de raza no catalogada; la raza es opcional y puede quedar sin contestar.
  Tipos regenerados desde `kitom-dev`, mensajes de error de raza propios e idioma `en` añadido al
  i18n (activo sigue siendo `es`). Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets».
- Nueva migración de razas (`breeds`, `breed_status`, `pets.breed_id`/`breed_status`, FK compuesta
  especie↔raza) y seed `supabase/seeds/breeds.sql` con 198 razas (155 de perro, 43 de gato) en es/en.
  Validados en local; pendientes de aplicar en `kitom-dev`. Decisión en `DECISIONS.md`, catálogo en
  `SEED.md`.
- Nuevo seed de datos de referencia `supabase/seed.sql` (especies, síntomas, compatibilidad
  síntoma–especie, logros y traducciones es/en), idempotente y aditivo. Validado en local; pendiente
  de ejecutar en `kitom-dev`. Detalle en `SEED.md`.
- Primera funcionalidad de producto: gestión de mascotas (lista, alta, detalle, edición y borrado)
  sobre el esquema existente, con acceso decidido por RLS y preparada para mascotas compartidas.
  Contrato en `FRONTEND_ARCHITECTURE.md` §4 «Pets»; decisión en `DECISIONS.md`.
- Nuevo `docs/DECISIONS.md` para registrar decisiones técnicas.
- Se estableció el mantenimiento proactivo de la estructura y documentación del repositorio como
  parte de cada tarea, con registro de cambios relevantes e instrucciones específicas por área.
