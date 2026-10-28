// =====================================================================
// KITOM · Edge Function pet-storage-cleanup
// =====================================================================
// Borra de `pet-photos` los objetos de las mascotas eliminadas, a partir de
// la cola que llena el trigger de pets
// (supabase/migrations/20261027194908_pet_storage_cleanup.sql). La invoca
// una tarea programada, no la app: POST con la cabecera
// x-kitom-cleanup-secret = PET_STORAGE_CLEANUP_SECRET (≥ 32 caracteres). La
// pasarela no verifica JWT (config.toml: verify_jwt = false) porque un JWT
// de usuario no autoriza nada aquí; sin el secreto configurado, responde 503.
//
// Cuerpo opcional: { "task": "process" | "audit", "batch": 1..10 }.
// PET_STORAGE_CLEANUP_MODE = delete para borrar; cualquier otro valor (o
// ninguno) es el modo informe: solo lectura.
//
// Variables (supabase secrets set, las pone el usuario):
// PET_STORAGE_CLEANUP_SECRET y PET_STORAGE_CLEANUP_MODE. SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY las da la plataforma. Lógica y pruebas:
// cleanup.ts, rest.ts y sus *.test.mjs; despliegue y programación en
// docs/proposals/2026-10-26-pet-photos-cleanup.md.
// =====================================================================
import { handleCleanupRequest, type Log } from './cleanup.ts';
import { createRestCleanupDb, createRestCleanupStorage } from './rest.ts';

const log: Log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

Deno.serve((request) =>
  handleCleanupRequest(
    request,
    {
      secret: Deno.env.get('PET_STORAGE_CLEANUP_SECRET'),
      mode: Deno.env.get('PET_STORAGE_CLEANUP_MODE'),
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    },
    (url, serviceKey) => ({
      db: createRestCleanupDb({ url, serviceKey }),
      storage: createRestCleanupStorage({ url, serviceKey }),
      now: Date.now,
      log,
    }),
    log,
  ),
);
