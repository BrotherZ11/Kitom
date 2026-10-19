// Comparación visual tablero ↔ app (solo desarrollo, sin dependencias): `npm run visual:compare [-- escenas]`.
//
// Abre el Chrome instalado con su protocolo de depuración (Node 24: WebSocket y fetch integrados),
// renderiza cada tablero de `docs/design/prototipo` y la app web (ya arrancada, normalmente con
// `npm run start:local -- --web --port 8091`) a 390×844, mide elementos, calcula las diferencias de
// píxeles y deja en `frontend/.visual/<fecha>/` (ignorado por git): capturas, comparación lado a lado
// con la barra de estado simulada, mapa de diferencias y `report.md`.
//
// Escenas: `scripts/visual-scenes.json`. Opciones de entorno:
//   KITOM_VC_APP_URL   URL de la app web (por defecto http://localhost:8091)
//   KITOM_VC_EMAIL / KITOM_VC_PASSWORD   cuenta de prueba LOCAL para las escenas con `login`
//                       (nunca se escriben en ningún archivo)
//   CHROME_PATH         ruta de Chrome si no está en la ubicación habitual
//   KITOM_VC_PET_ID     id de una mascota de esa cuenta local: sustituye `{petId}` en las rutas
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const frontendDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(frontendDir, '..');
const prototypeDir = resolve(repoRoot, 'docs/design/prototipo');
const scenesFile = resolve(import.meta.dirname, 'visual-scenes.json');
const appUrl = process.env.KITOM_VC_APP_URL ?? 'http://localhost:8091';
const WIDTH = 390;
const HEIGHT = 844;

function fail(message) {
  console.error(`visual:compare: ${message}`);
  process.exit(1);
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) fail('no se encuentra Chrome. Define CHROME_PATH.');
  return found;
}

// ---------------------------------------------------------------- cliente mínimo del protocolo
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((ok, ko) => {
    socket.addEventListener('open', ok, { once: true });
    socket.addEventListener('error', ko, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { ok, ko } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) ko(new Error(message.error.message));
      else ok(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send(method, params = {}) {
      nextId += 1;
      const id = nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, ko) => pending.set(id, { ok, ko }));
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'error en la página');
  return result.value;
}

async function navigate(cdp, url) {
  const loaded = new Promise((ok) => {
    const off = cdp.on((message) => {
      if (message.method === 'Page.loadEventFired') {
        off();
        ok();
      }
    });
  });
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(20000)]);
  await evaluate(cdp, 'document.fonts ? document.fonts.ready.then(() => true) : true');
}

async function waitFor(cdp, expression, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, expression).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`tiempo agotado esperando: ${expression}`);
}

async function screenshot(cdp, file, height = HEIGHT, width = WIDTH) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  writeFileSync(file, Buffer.from(data, 'base64'));
  return data;
}

// ---------------------------------------------------------------- utilidades dentro de la página
// Busca un elemento por su nombre accesible (aria-label) o, si no, por su texto visible exacto.
const FIND = `(name, role) => {
  const all = [...document.querySelectorAll('*')].filter((el) => el.getClientRects().length > 0);
  const byRole = (el) => !role || el.getAttribute('role') === role || el.tagName.toLowerCase() === role;
  return all.find((el) => byRole(el) && el.getAttribute('aria-label') === name)
    ?? all.find((el) => byRole(el) && el.children.length === 0 && el.textContent.trim() === name)
    ?? all.find((el) => byRole(el) && el.textContent.trim() === name);
}`;

const MEASURE = `(el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    font: s.fontFamily.split(',')[0].replace(/["']/g, ''), size: s.fontSize, line: s.lineHeight, weight: s.fontWeight };
}`;

async function runStep(cdp, step) {
  if (step.wait) return sleep(step.wait);
  if (step.waitText) {
    return waitFor(cdp, `!!(${FIND})(${JSON.stringify(step.waitText)})`);
  }
  if (step.fill) {
    const value = step.fill.value ?? process.env[step.fill.env] ?? '';
    return evaluate(
      cdp,
      `(() => { const el = (${FIND})(${JSON.stringify(step.fill.label)}, 'textbox') ?? document.querySelector('[aria-label=${JSON.stringify(step.fill.label)}]');
        if (!el) throw new Error('campo no encontrado: ${step.fill.label}');
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
    );
  }
  if (step.click) {
    return evaluate(
      cdp,
      `(() => { const el = (${FIND})(${JSON.stringify(step.click.name)}, ${JSON.stringify(step.click.role ?? null)});
        if (!el) throw new Error('no encontrado: ${step.click.name}'); el.click(); return true; })()`
    );
  }
  if (step.blur) return evaluate(cdp, 'document.activeElement?.blur(), true');
  if (step.login) {
    if (!process.env.KITOM_VC_EMAIL || !process.env.KITOM_VC_PASSWORD) {
      throw new Error('la escena necesita KITOM_VC_EMAIL y KITOM_VC_PASSWORD (cuenta LOCAL)');
    }
    await navigate(cdp, `${appUrl}/login`);
    // Con sesión de una escena anterior, /login redirige: se espera a una de las dos cosas.
    await waitFor(cdp, `!location.pathname.startsWith('/login') || !!(${FIND})('Entrar', 'button')`);
    if (!(await evaluate(cdp, `location.pathname.startsWith('/login')`))) return;
    await runStep(cdp, { fill: { label: 'Email', env: 'KITOM_VC_EMAIL' } });
    await runStep(cdp, { fill: { label: 'Contraseña', env: 'KITOM_VC_PASSWORD' } });
    await runStep(cdp, { click: { name: 'Entrar', role: 'button' } });
    return waitFor(cdp, `!location.pathname.startsWith('/login')`);
  }
  throw new Error(`paso desconocido: ${JSON.stringify(step)}`);
}

async function measureAll(cdp, measures, side) {
  const out = {};
  for (const item of measures ?? []) {
    const target = item[side];
    if (!target) continue;
    const expression = target.css
      ? `(${MEASURE})(document.querySelector(${JSON.stringify(target.css)}))`
      : `(${MEASURE})((${FIND})(${JSON.stringify(target.name)}, ${JSON.stringify(target.role ?? null)}))`;
    out[item.name] = await evaluate(cdp, expression).catch(() => null);
  }
  return out;
}

// ---------------------------------------------------------------- comparación (en el propio navegador)
function comparePage(protoB64, appB64, statusBar, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#7a7a7a;font:600 13px system-ui;color:#fff}
  .row{display:flex;gap:12px;padding:10px} figure{margin:0} figcaption{padding:2px 0 6px}
  canvas{display:block;background:#fff}</style></head><body>
  <div class="row"><figure><figcaption>Tablero · ${title}</figcaption><canvas id="a" width="${WIDTH}" height="${HEIGHT}"></canvas></figure>
  <figure><figcaption>App (web) + ${statusBar} px de barra de estado</figcaption><canvas id="b" width="${WIDTH}" height="${HEIGHT}"></canvas></figure>
  <figure><figcaption>Diferencias</figcaption><canvas id="d" width="${WIDTH}" height="${HEIGHT}"></canvas></figure></div>
  <script>
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  window.__done = Promise.all([load('data:image/png;base64,${protoB64}'), load('data:image/png;base64,${appB64}')]).then(([pa, pb]) => {
    const a = document.getElementById('a').getContext('2d'); a.drawImage(pa, 0, 0);
    const b = document.getElementById('b').getContext('2d');
    b.fillStyle = '#d5dcd9'; b.fillRect(0, 0, ${WIDTH}, ${statusBar}); b.drawImage(pb, 0, ${statusBar});
    const A = a.getImageData(0, 0, ${WIDTH}, ${HEIGHT}).data, B = b.getImageData(0, 0, ${WIDTH}, ${HEIGHT}).data;
    const d = document.getElementById('d').getContext('2d'); const out = d.createImageData(${WIDTH}, ${HEIGHT});
    let diff = 0;
    for (let i = 0; i < A.length; i += 4) {
      const delta = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      const hit = delta > 40; if (hit) diff++;
      const g = (A[i] + A[i + 1] + A[i + 2]) / 3;
      out.data[i] = hit ? 220 : g * 0.35 + 160; out.data[i + 1] = hit ? 40 : g * 0.35 + 160; out.data[i + 2] = hit ? 40 : g * 0.35 + 160; out.data[i + 3] = 255;
    }
    d.putImageData(out, 0, 0);
    return Math.round((diff / (${WIDTH} * ${HEIGHT})) * 1000) / 10;
  });
  </script></body></html>`;
}

function deltas(proto, app, statusBar, tolerance) {
  const rows = [];
  for (const name of Object.keys(proto)) {
    const p = proto[name];
    const a = app[name];
    if (!p || !a) {
      rows.push({ name, note: !p ? 'no está en el tablero' : 'no está en la app', flag: true });
      continue;
    }
    const dy = a.y + statusBar - p.y;
    const dh = a.h - p.h;
    const font = p.size !== a.size || p.line !== a.line ? `${p.size}/${p.line} → ${a.size}/${a.line}` : '';
    rows.push({ name, dy, dh, font, flag: Math.abs(dy) > tolerance || Math.abs(dh) > tolerance || Boolean(font) });
  }
  return rows;
}

// ---------------------------------------------------------------- principal
const config = JSON.parse(readFileSync(scenesFile, 'utf8'));
const wanted = process.argv.slice(2);
const scenes = config.scenes.filter((scene) => wanted.length === 0 || wanted.includes(scene.id));
if (scenes.length === 0) fail(`ninguna escena coincide con: ${wanted.join(', ')}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(frontendDir, '.visual', stamp);
const profileDir = resolve(frontendDir, '.visual', 'chrome-profile');
mkdirSync(outDir, { recursive: true });
rmSync(resolve(profileDir, 'DevToolsActivePort'), { force: true });

const chrome = spawn(
  chromePath(),
  ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'],
  { stdio: 'ignore' }
);

try {
  const portFile = resolve(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(100);
  if (!existsSync(portFile)) fail('Chrome no ha abierto el puerto de depuración.');
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true });

  const report = [`# Comparación visual · ${stamp}`, '', `App: ${appUrl} · ${WIDTH}×${HEIGHT}`, ''];
  for (const scene of scenes) {
    const statusBar = scene.statusBar ?? config.statusBar ?? 44;
    const tolerance = scene.tolerance ?? config.tolerance ?? 4;
    const scheme = scene.scheme ?? 'light';
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    try {
      // Tablero
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true });
      await navigate(cdp, pathToFileURL(resolve(prototypeDir, scene.board)).href);
      for (const selector of scene.hide ?? []) {
        await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).forEach((n) => n.remove()), true`);
      }
      await sleep(300);
      const protoB64 = await screenshot(cdp, resolve(outDir, `${scene.id}-board.png`));
      const protoMeasures = await measureAll(cdp, scene.measure, 'board');

      // App (sin barra de estado en web: se recorta la altura y luego se desplaza)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT - statusBar, deviceScaleFactor: 1, mobile: true });
      if (scene.login) {
        await runStep(cdp, { login: true });
      } else {
        // Escena sin sesión: se borra la de escenas anteriores (solo datos de la app web local).
        await navigate(cdp, `${appUrl}/login`);
        await cdp.send('Storage.clearDataForOrigin', { origin: new URL(appUrl).origin, storageTypes: 'all' });
      }
      if (scene.path.includes('{petId}') && !process.env.KITOM_VC_PET_ID) {
        throw new Error('la escena necesita KITOM_VC_PET_ID (mascota de la cuenta LOCAL)');
      }
      await navigate(cdp, `${appUrl}${scene.path.replace('{petId}', process.env.KITOM_VC_PET_ID ?? '')}`);
      for (const step of scene.steps ?? []) await runStep(cdp, step);
      await sleep(scene.settle ?? 600);
      const appB64 = await screenshot(cdp, resolve(outDir, `${scene.id}-app.png`), HEIGHT - statusBar);
      const appMeasures = await measureAll(cdp, scene.measure, 'app');

      // Composición y diferencias
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH * 3 + 48, height: HEIGHT + 40, deviceScaleFactor: 1, mobile: false });
      const html = comparePage(protoB64, appB64, statusBar, scene.title ?? scene.id);
      const htmlFile = resolve(outDir, `${scene.id}-compare.html`);
      writeFileSync(htmlFile, html);
      await navigate(cdp, pathToFileURL(htmlFile).href);
      const diffPercent = await evaluate(cdp, 'window.__done');
      await screenshot(cdp, resolve(outDir, `${scene.id}-compare.png`), HEIGHT + 40, WIDTH * 3 + 48);
      rmSync(htmlFile);

      const rows = deltas(protoMeasures, appMeasures, statusBar, tolerance);
      const flagged = rows.filter((row) => row.flag).length;
      console.log(`${scene.id.padEnd(22)} píxeles distintos ${String(diffPercent).padStart(5)} % · elementos fuera de tolerancia ${flagged}/${rows.length}`);
      report.push(`## ${scene.title ?? scene.id} (\`${scene.board}\` ↔ \`${scene.path}\`, ${scheme})`, '');
      report.push(`- Píxeles distintos: **${diffPercent} %** (diferencias de contenido incluidas: el tablero usa datos de ejemplo).`);
      report.push(`- Tolerancia: ${tolerance} px · barra de estado simulada: ${statusBar} px`, '');
      if (rows.length) {
        report.push('| Elemento | Δy | Δalto | Tipografía | |', '|---|---|---|---|---|');
        for (const row of rows) {
          report.push(row.note
            ? `| ${row.name} | — | — | ${row.note} | ⚠ |`
            : `| ${row.name} | ${row.dy} | ${row.dh} | ${row.font || 'igual'} | ${row.flag ? '⚠' : '✓'} |`);
        }
      }
      report.push('', `![${scene.id}](${scene.id}-compare.png)`, '');
    } catch (error) {
      console.log(`${scene.id.padEnd(22)} ERROR: ${error.message}`);
      report.push(`## ${scene.id}`, '', `Error: ${error.message}`, '');
    }
  }
  writeFileSync(resolve(outDir, 'report.md'), report.join('\n'));
  console.log(`\nInforme: ${resolve(outDir, 'report.md')}`);
  cdp.close();
} finally {
  chrome.kill();
}
