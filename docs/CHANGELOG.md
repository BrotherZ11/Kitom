# Changelog

Cambios relevantes del proyecto, en orden cronológico inverso. El detalle de cada contrato o
decisión permanece en su documento de referencia.

## 2026-10-07

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
