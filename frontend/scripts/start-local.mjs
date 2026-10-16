// Arranca Expo (Metro) contra el Supabase LOCAL, sin tocar `.env`: `npm run start:local [-- <args de expo start>]`.
//
// Antes de iniciar Metro comprueba, y si algo no cuadra termina sin arrancar:
// 1. `npx supabase status` responde y su API es http://127.0.0.1 o http://localhost.
// 2. El endpoint EFECTIVO (lo que verá la app tras cargar `.env*` con el mismo cargador que usa Expo)
//    es el local: las variables del proceso tienen prioridad sobre los archivos `.env`.
// 3. La API local responde (`/auth/v1/health`).
// Solo usa la clave anónima local; nunca imprime claves. Metro arranca siempre con `--clear`, porque
// los `EXPO_PUBLIC_*` se incrustan al transformar y una caché anterior podría llevar los del remoto.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);
const frontendDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(frontendDir, '..');
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`start:local: ${message} No se ha arrancado Metro.`);
  process.exit(1);
}

function isLocalApi(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

let status;
try {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  status = JSON.parse(output);
} catch {
  fail('no se pudo leer `npx supabase status`. ¿Está arrancado el Supabase local (`npx supabase start`)?');
}

const apiUrl = status.API_URL;
const anonKey = status.ANON_KEY;
if (!isLocalApi(apiUrl)) fail('la API de Supabase que informa el CLI no es local.');
if (typeof anonKey !== 'string' || anonKey === '') fail('el CLI no ha devuelto la clave anónima local.');

// Endpoint efectivo: se cargan los `.env*` del proyecto sobre una copia del entorno, igual que Expo.
const env = { ...process.env, EXPO_PUBLIC_SUPABASE_URL: apiUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey };
const { loadProjectEnv } = require('@expo/env');
// Mismo modo que `expo start` (incluye `.env.development*`).
loadProjectEnv(frontendDir, { mode: env.NODE_ENV ?? 'development', systemEnv: env, silent: true, force: true });
if (
  env.EXPO_PUBLIC_SUPABASE_URL !== apiUrl ||
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== anonKey ||
  !isLocalApi(env.EXPO_PUBLIC_SUPABASE_URL)
) {
  fail('no se puede confirmar que la app usará el Supabase local (un archivo .env sustituiría los valores).');
}

try {
  const response = await fetch(`${apiUrl}/auth/v1/health`, {
    headers: { apikey: anonKey },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) fail(`la API local responde con ${response.status}.`);
} catch {
  fail('la API local no responde.');
}

console.log(`start:local: Supabase local comprobado (${new URL(apiUrl).host}). Arrancando Metro con --clear.`);

const expoCli = require.resolve('expo/bin/cli');
const child = spawn(process.execPath, [expoCli, 'start', '--clear', ...process.argv.slice(2)], {
  cwd: frontendDir,
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
