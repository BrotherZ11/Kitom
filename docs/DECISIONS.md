# Decisiones técnicas

Registro breve de decisiones técnicas relevantes: contexto, decisión y consecuencias. Las más
recientes, arriba. El detalle de cada contrato vive en su documento de referencia.

## 2026-10-07 — Pets: RLS decide la visibilidad y las escrituras envían solo columnas editables

**Contexto.** `pets` se comparte entre propietario y co-tutores (`pet_co_owners`). La seguridad está
en tres capas de BD: GRANT por columna (sin UPDATE de `owner_id`), RLS (`is_pet_member`,
`can_edit_pet`, borrado solo del propietario) y triggers (`protect_pet_structural_fields`,
`validate_pet_birth_date`).

**Decisión.**
- Las lecturas no filtran por `owner_id`: RLS devuelve propias y compartidas.
- `owner_id` lo fija la capa de datos con el usuario de la sesión al crear; nunca sale del formulario
  y nunca se envía en un update. Las escrituras construyen el payload con una lista explícita de
  columnas editables (`pets-api.ts`), así que propiedades extra no llegan a Supabase.
- Las acciones de la UI se ocultan con `can_edit_pet` (editar) y `owner_id === user.id` (borrar), solo
  como UX. Un update o delete que RLS filtra (0 filas) se trata como `not_allowed`.
- `is_active` (archivar) y `photo_path` (subida) no se exponen todavía.

**Consecuencias.** Las mascotas compartidas funcionarán sin cambios cuando se implementen las
invitaciones. Contrato completo: `FRONTEND_ARCHITECTURE.md` §4 «Pets».

## 2026-10-07 — Auth: flujo PKCE y deep links con esquema `kitom`

Ver `AUTH.md` §2. Los enlaces de email y el retorno de Google vuelven a `/auth-callback` con un `code`
de un solo uso que solo sirve en el dispositivo que inició el flujo.
