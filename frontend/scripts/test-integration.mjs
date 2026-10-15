// Ejecuta las pruebas de integración (`src/**/*.integration.test.mjs`) contra el Supabase LOCAL.
// Lee la URL y la clave anónima de `npx supabase status` (sin mostrarlas) y se niega a seguir si la
// URL no es local: estas pruebas crean usuarios, mascotas y registros. Nunca contra `kitom-dev`.
//
// Uso (desde frontend/, con `npx supabase start` hecho en la raíz): npm run test:integration
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
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
  console.error(`La API de Supabase no es local (${url.hostname}). Las pruebas de integración solo se ejecutan en local.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  // Tiempo límite por test: una petición colgada falla en vez de bloquear la ejecución.
  ['--test', '--test-timeout=60000', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'src/**/*.integration.test.mjs'],
  {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, KITOM_IT_SUPABASE_URL: status.API_URL, KITOM_IT_SUPABASE_ANON_KEY: status.ANON_KEY },
  }
);
process.exit(result.status ?? 1);
