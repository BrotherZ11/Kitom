// Ejecuta cleanup.integration.test.mjs contra el Supabase LOCAL (Storage real, migraciones aplicadas y
// el bucket `pet-photos` creado con `npx supabase seed buckets --local`).
// Lee la URL y las claves de `npx supabase status` (sin mostrarlas) y se niega a seguir si la URL no es
// local: la prueba sube y borra objetos y usa la clave de servicio. Nunca contra `kitom-dev`.
//
// Uso, desde la raíz del repo: node supabase/functions/pet-storage-cleanup/run-integration.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..', '..');
let status;
try {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  status = JSON.parse(output);
} catch {
  console.error('No se pudo leer `npx supabase status`. ¿Está arrancado el Supabase local (`npx supabase start`)?');
  process.exit(1);
}

const url = new URL(status.API_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error(`La API de Supabase no es local (${url.hostname}). Esta prueba solo se ejecuta en local.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--test-timeout=120000', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'cleanup.integration.test.mjs'],
  {
    cwd: import.meta.dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      KITOM_IT_SUPABASE_URL: status.API_URL,
      KITOM_IT_SUPABASE_ANON_KEY: status.ANON_KEY,
      KITOM_IT_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    },
  },
);
process.exit(result.status ?? 1);
