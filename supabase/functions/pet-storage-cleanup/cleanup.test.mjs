// Pruebas de pet-storage-cleanup (Node, sin Deno), con una BD y un Storage falsos:
//   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON supabase/functions/pet-storage-cleanup/cleanup.test.mjs
// La cola, los plazos y los estados terminales viven en SQL: supabase/tests/database/pet_storage_cleanup.test.sql.
// Contra el Supabase local (Storage real): cleanup.integration.test.mjs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUCKET,
  checkInvocation,
  CleanupRpcError,
  handleCleanupRequest,
  LOCK_LOST,
  modeFromEnv,
  objectVerdict,
  parseRequestBody,
  PET_EXISTS,
  petIdFromObjectName,
  PHOTO_PATH_UNCHECKED,
  REMOVE_CHUNK,
  runCleanup,
  SECRET_HEADER,
  secretMatches,
  STORAGE_NOT_VISIBLE,
  StorageRemoveError,
  TIME_BUDGET_MS,
} from './cleanup.ts';
import { createRestCleanupDb, createRestCleanupStorage } from './rest.ts';

const PET = '0a1b2c3d-1111-4222-8333-444455556666';
const OTHER = '9f8e7d6c-1111-4222-8333-444455556666';
const SECRET = 's'.repeat(40);
const SERVICE_KEY = 'service-key-that-must-never-be-logged';

const job = (petId = PET, id = `job-${petId}`) => ({ job_id: id, pet_id: petId, lock_token: `token-${id}`, attempts: 1 });
const object = (name, bucket = BUCKET) => ({ bucket, name });

/**
 * BD falsa con el contrato de las RPC: candidatos de la mascota (como safe_pet_id_from_path), ordenados por
 * nombre y paginados con `after`; los informes se guardan; `referenced` por nombre exacto.
 */
function fakeDb({ jobs = [], objects = [], existing = [], referenced = [], reportStatus = 'pending' } = {}) {
  const state = { objects: [...objects], reports: [], claims: [], pages: [], purges: 0, previews: 0, audits: 0 };
  const db = {
    async claim(limit, lockSeconds) {
      state.claims.push({ limit, lockSeconds });
      return jobs.splice(0, limit);
    },
    async objects(claimed, after, limit) {
      state.pages.push({ job: claimed.job_id, after, limit });
      if (existing.includes(claimed.pet_id)) throw new CleanupRpcError(PET_EXISTS);
      return state.objects
        .filter((o) => o.bucket === BUCKET && petIdFromObjectName(o.name) === claimed.pet_id && (after === null || o.name > after))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, limit)
        .map((o) => ({ object_bucket: o.bucket, object_name: o.name, referenced: referenced.includes(o.name) }));
    },
    async report(claimed, removed, error) {
      state.reports.push({ job: claimed.job_id, removed, error });
      return typeof reportStatus === 'function' ? reportStatus(claimed, removed, error) : reportStatus;
    },
    async preview() {
      state.previews++;
      return [{ job_id: 'job-1', attempts: 0, due: true, pet_exists: false, objects: 3, referenced: 1 }];
    },
    async audit() {
      state.audits++;
      return [
        { folder_pet_id: PET, objects: 2, job_status: 'pending' },
        { folder_pet_id: OTHER, objects: 5, job_status: null },
      ];
    },
    async purge() {
      state.purges++;
      return 4;
    },
  };
  return { db, state };
}

/** Storage falso: borra nombres exactos del bucket; `failOn` = número de llamada que falla. */
function fakeStorage(state, { failOn = null } = {}) {
  const calls = [];
  const storage = {
    async remove(bucket, names) {
      calls.push({ bucket, names: [...names] });
      if (calls.length === failOn) throw new StorageRemoveError('storage_http_500');
      let removed = 0;
      for (const name of names) {
        const index = state.objects.findIndex((o) => o.bucket === bucket && o.name === name);
        if (index >= 0) {
          state.objects.splice(index, 1);
          removed++;
        }
      }
      return removed;
    },
  };
  return { storage, calls };
}

function deps(db, storage, { now = () => 0, logs = [] } = {}) {
  return { db, storage, now, log: (event, fields) => logs.push({ event, ...fields }) };
}

const run = (d, options = {}) => runCleanup(d, { mode: 'delete', task: 'process', batch: 5, ...options });

describe('rutas y validación de cada objeto', () => {
  it('el id de mascota se lee como safe_pet_id_from_path: primer segmento de carpeta, uuid en cualquier caja', () => {
    assert.equal(petIdFromObjectName(`${PET}/a.jpg`), PET);
    assert.equal(petIdFromObjectName(`${PET.toUpperCase()}/a.jpg`), PET);
    assert.equal(petIdFromObjectName(`${PET}/nested/deep/a.jpg`), PET);
    assert.equal(petIdFromObjectName(`${PET}.jpg`), null, 'sin carpeta');
    assert.equal(petIdFromObjectName(PET), null, 'sin carpeta');
    assert.equal(petIdFromObjectName(`/${PET}/a.jpg`), null, 'primer segmento vacío');
    assert.equal(petIdFromObjectName(`x/${PET}/a.jpg`), null, 'el id no es el primer segmento');
    assert.equal(petIdFromObjectName(`${PET}x/a.jpg`), null);
    assert.equal(petIdFromObjectName(`${PET}\n/a.jpg`), null);
  });

  it('solo se borra lo exactamente esperado; lo dudoso no', () => {
    const ok = { object_bucket: BUCKET, object_name: `${PET}/a.jpg`, referenced: false };
    assert.equal(objectVerdict(ok, PET), 'ok');
    assert.equal(objectVerdict({ ...ok, object_name: `${PET.toUpperCase()}/nested/b.jpg` }, PET), 'ok');
    assert.equal(objectVerdict({ ...ok, object_bucket: 'reminder-attachments' }, PET), 'invalid_object', 'otro bucket');
    assert.equal(objectVerdict({ ...ok, object_bucket: 'PET-PHOTOS' }, PET), 'invalid_object');
    assert.equal(objectVerdict({ ...ok, object_name: `${OTHER}/a.jpg` }, PET), 'invalid_object', 'otra mascota');
    assert.equal(objectVerdict({ ...ok, object_name: `x/${PET}/a.jpg` }, PET), 'invalid_object', 'prefijo engañoso');
    assert.equal(objectVerdict({ ...ok, object_name: `${PET}/a\u0000.jpg` }, PET), 'invalid_object', 'caracteres de control');
    assert.equal(objectVerdict({ ...ok, object_name: `${PET}/${'a'.repeat(1100)}` }, PET), 'invalid_object', 'demasiado largo');
    assert.equal(objectVerdict({ ...ok, object_name: '' }, PET), 'invalid_object');
    assert.equal(objectVerdict({ ...ok, object_name: null }, PET), 'invalid_object');
    assert.equal(objectVerdict({ ...ok, referenced: true }, PET), 'object_referenced');
    assert.equal(objectVerdict({ ...ok, referenced: null }, PET), 'object_referenced', 'sin poder comprobarlo cuenta como referenciado');
    assert.equal(objectVerdict({ ...ok, referenced: undefined }, PET), 'object_referenced');
  });
});

describe('invocación: secreto y cuerpo', () => {
  it('sin secreto configurado (o corto) no se ejecuta; el de la cabecera debe ser idéntico', () => {
    assert.equal(checkInvocation(SECRET, undefined), 'not_configured');
    assert.equal(checkInvocation('corto', 'corto'), 'not_configured');
    assert.equal(checkInvocation(null, SECRET), 'unauthorized');
    assert.equal(checkInvocation('', SECRET), 'unauthorized');
    assert.equal(checkInvocation(SECRET.slice(0, -1), SECRET), 'unauthorized');
    assert.equal(checkInvocation(`${SECRET}x`, SECRET), 'unauthorized');
    assert.equal(checkInvocation(`${SECRET.slice(0, -1)}t`, SECRET), 'unauthorized');
    assert.equal(checkInvocation(SECRET, SECRET), 'ok');
    assert.equal(secretMatches('ñ'.repeat(20), 'ñ'.repeat(20)), true);
  });

  it('el modo borrado solo con `delete` exacto', () => {
    assert.equal(modeFromEnv(undefined), 'report');
    assert.equal(modeFromEnv(''), 'report');
    assert.equal(modeFromEnv('DELETE'), 'report');
    assert.equal(modeFromEnv('report'), 'report');
    assert.equal(modeFromEnv('delete'), 'delete');
  });

  it('cuerpo: tarea y lote acotados; ni buckets ni rutas', () => {
    assert.deepEqual(parseRequestBody(''), { task: 'process', batch: 5 });
    assert.deepEqual(parseRequestBody('{}'), { task: 'process', batch: 5 });
    assert.deepEqual(parseRequestBody('{"task":"audit"}'), { task: 'audit', batch: 5 });
    assert.deepEqual(parseRequestBody('{"batch":10}'), { task: 'process', batch: 10 });
    for (const bad of [
      '{"batch":0}',
      '{"batch":11}',
      '{"batch":2.5}',
      '{"batch":"3"}',
      '{"task":"delete"}',
      '{"bucket":"avatars"}',
      '{"path":"x/y.jpg"}',
      '{"pet_id":"' + PET + '"}',
      '[]',
      'null',
      'no es json',
    ]) {
      assert.equal(parseRequestBody(bad), null, bad);
    }
  });
});

describe('procesar trabajos (modo borrado)', () => {
  it('paginado: rutas anidadas y en mayúsculas, en lotes acotados; solo lo de esa mascota', async () => {
    const objects = [];
    for (let i = 0; i < 230; i++) objects.push(object(`${PET}/${String(i).padStart(3, '0')}.jpg`));
    for (let i = 0; i < 200; i++) objects.push(object(`${PET.toUpperCase()}/consults/${i}.jpg`));
    objects.push(object(`${PET}/nested/deep/x.jpg`), object(`${OTHER}/keep.jpg`), object(`${PET}/r.jpg`, 'reminder-attachments'));
    const { db, state } = fakeDb({ jobs: [job()], objects });
    const { storage, calls } = fakeStorage(state);

    const summary = await run(deps(db, storage));

    assert.equal(summary.removed, 431);
    assert.deepEqual(state.reports, [{ job: `job-${PET}`, removed: 431, error: null }]);
    assert.ok(state.pages.length >= 3, 'varias páginas');
    assert.ok(calls.every((call) => call.bucket === BUCKET && call.names.length <= REMOVE_CHUNK));
    assert.deepEqual(state.objects.map((o) => o.name).sort(), [`${OTHER}/keep.jpg`, `${PET}/r.jpg`].sort(), 'otra mascota y otro bucket intactos');
  });

  it('un candidato de otro bucket, de otra mascota o mal formado no se borra: error recuperable', async () => {
    const { db, state } = fakeDb({ jobs: [job()], objects: [object(`${PET}/ok.jpg`)] });
    const page = [
      { object_bucket: BUCKET, object_name: `${PET}/ok.jpg`, referenced: false },
      { object_bucket: 'shared-reports', object_name: `${PET}/r.pdf`, referenced: false },
      { object_bucket: BUCKET, object_name: `${OTHER}/no.jpg`, referenced: false },
      { object_bucket: BUCKET, object_name: `../${PET}/no.jpg`, referenced: false },
    ];
    db.objects = async (_job, after) => (after === null ? page : []);
    const { storage, calls } = fakeStorage(state);

    await run(deps(db, storage));

    assert.deepEqual(calls, [{ bucket: BUCKET, names: [`${PET}/ok.jpg`] }]);
    assert.deepEqual(state.reports, [{ job: `job-${PET}`, removed: 1, error: 'invalid_object' }]);
  });

  it('un objeto que otra fila referencia no se borra; los demás sí', async () => {
    const { db, state } = fakeDb({
      jobs: [job()],
      objects: [object(`${PET}/a.jpg`), object(`${PET}/b.jpg`)],
      referenced: [`${PET}/b.jpg`],
    });
    const { storage } = fakeStorage(state);

    await run(deps(db, storage));

    assert.deepEqual(state.objects.map((o) => o.name), [`${PET}/b.jpg`]);
    assert.deepEqual(state.reports, [{ job: `job-${PET}`, removed: 1, error: 'object_referenced' }]);
  });

  it('si la mascota existe, no se borra nada y el servidor lo decide', async () => {
    const { db, state } = fakeDb({ jobs: [job()], objects: [object(`${PET}/a.jpg`)], existing: [PET], reportStatus: 'failed' });
    const { storage, calls } = fakeStorage(state);

    const summary = await run(deps(db, storage));

    assert.equal(calls.length, 0);
    assert.deepEqual(state.reports, [{ job: `job-${PET}`, removed: 0, error: 'pet_exists' }]);
    assert.equal(summary.failed, 1);
  });

  it('error parcial de Storage: se informa lo borrado y se para; el reintento sigue donde quedó', async () => {
    const objects = [];
    for (let i = 0; i < 150; i++) objects.push(object(`${PET}/${String(i).padStart(3, '0')}.jpg`));
    const first = fakeDb({ jobs: [job()], objects });
    const { storage } = fakeStorage(first.state, { failOn: 2 });

    await run(deps(first.db, storage));

    assert.deepEqual(first.state.reports, [{ job: `job-${PET}`, removed: REMOVE_CHUNK, error: 'storage_remove_failed' }]);
    assert.equal(first.state.objects.length, 50);

    // Reintento (otra reserva del mismo trabajo): solo lo que queda.
    const retry = fakeDb({ jobs: [job()], objects: first.state.objects });
    const { storage: retryStorage, calls } = fakeStorage(retry.state);
    await run(deps(retry.db, retryStorage));
    assert.deepEqual(retry.state.reports, [{ job: `job-${PET}`, removed: 50, error: null }]);
    assert.equal(calls.flatMap((call) => call.names).length, 50, 'nada de lo ya borrado se vuelve a pedir');
  });

  it('un trabajo repetido o ya terminado (sin objetos, o la reserva perdida) no borra nada ni rompe la ejecución', async () => {
    const empty = fakeDb({ jobs: [job()], objects: [], reportStatus: 'done' });
    const { storage, calls } = fakeStorage(empty.state);
    const summary = await run(deps(empty.db, storage));
    assert.equal(calls.length, 0);
    assert.deepEqual(empty.state.reports, [{ job: `job-${PET}`, removed: 0, error: null }]);
    assert.equal(summary.done, 1);

    // La reserva caducó y otra ejecución la tomó: ni se lista ni se informa.
    const lost = fakeDb({ jobs: [job()], objects: [object(`${PET}/a.jpg`)] });
    lost.db.objects = async () => {
      throw new CleanupRpcError(LOCK_LOST);
    };
    const lostStorage = fakeStorage(lost.state);
    const lostSummary = await run(deps(lost.db, lostStorage.storage));
    assert.equal(lostStorage.calls.length, 0);
    assert.deepEqual(lost.state.reports, []);
    assert.equal(lostSummary.skipped, 1);

    // El informe llega tarde (otra ejecución ya terminó el trabajo): se registra y se sigue.
    const late = fakeDb({ jobs: [job(), job(OTHER)], objects: [object(`${PET}/a.jpg`), object(`${OTHER}/b.jpg`)] });
    const realReport = late.db.report;
    late.db.report = async (claimed, removed, error) => {
      if (claimed.pet_id === PET) throw new CleanupRpcError(LOCK_LOST);
      return realReport(claimed, removed, error);
    };
    const lateStorage = fakeStorage(late.state);
    const lateSummary = await run(deps(late.db, lateStorage.storage));
    assert.equal(lateSummary.skipped, 1);
    assert.equal(lateSummary.pending, 1, 'el otro trabajo sigue su curso');
    assert.equal(late.state.objects.length, 0);
  });

  it('un fallo en un trabajo no afecta a otro: cada uno solo toca su carpeta', async () => {
    const { db, state } = fakeDb({
      jobs: [job(PET), job(OTHER)],
      objects: [object(`${PET}/a.jpg`), object(`${OTHER}/b.jpg`), object(`${OTHER}/c.jpg`)],
    });
    const { storage, calls } = fakeStorage(state, { failOn: 1 });

    const summary = await run(deps(db, storage));

    assert.deepEqual(state.reports, [
      { job: `job-${PET}`, removed: 0, error: 'storage_remove_failed' },
      { job: `job-${OTHER}`, removed: 2, error: null },
    ]);
    assert.deepEqual(calls.map((call) => call.names), [[`${PET}/a.jpg`], [`${OTHER}/b.jpg`, `${OTHER}/c.jpg`]]);
    assert.deepEqual(summary.errors, { storage_remove_failed: 1 });
  });

  it('un fallo al listar o algo inesperado se informa como código, sin borrar', async () => {
    const { db, state } = fakeDb({ jobs: [job()], objects: [object(`${PET}/a.jpg`)] });
    db.objects = async () => {
      throw new CleanupRpcError('rpc_http_500');
    };
    await run(deps(db, fakeStorage(state).storage));
    assert.deepEqual(state.reports, [{ job: `job-${PET}`, removed: 0, error: 'object_list_failed' }]);
  });

  it('presupuesto de tiempo: lo que no cabe se libera (time_budget) y sigue en otra ejecución', async () => {
    const { db, state } = fakeDb({ jobs: [job(PET), job(OTHER)], objects: [object(`${PET}/a.jpg`), object(`${OTHER}/b.jpg`)] });
    let clock = 0;
    const { storage } = fakeStorage(state);
    const realRemove = storage.remove;
    storage.remove = async (bucket, names) => {
      clock += TIME_BUDGET_MS;
      return realRemove(bucket, names);
    };

    await run(deps(db, storage, { now: () => clock }));

    assert.deepEqual(state.reports, [
      { job: `job-${PET}`, removed: 1, error: null },
      { job: `job-${OTHER}`, removed: 0, error: 'time_budget' },
    ]);
    assert.deepEqual(state.objects.map((o) => o.name), [`${OTHER}/b.jpg`]);
  });

  it('reserva acotada: el lote pedido y una reserva de 300 s', async () => {
    const { db, state } = fakeDb();
    await run(deps(db, fakeStorage(state).storage), { batch: 3 });
    assert.deepEqual(state.claims, [{ limit: 3, lockSeconds: 300 }]);
  });
});

describe('modo informe y auditoría: solo lectura', () => {
  it('modo informe: ni reserva, ni borra, ni informa', async () => {
    const { db, state } = fakeDb({ jobs: [job()], objects: [object(`${PET}/a.jpg`)] });
    const { storage, calls } = fakeStorage(state);

    const summary = await runCleanup(deps(db, storage), { mode: 'report', task: 'process', batch: 5 });

    assert.equal(state.claims.length, 0);
    assert.equal(calls.length, 0);
    assert.deepEqual(state.reports, []);
    assert.equal(state.previews, 1);
    assert.deepEqual({ jobs: summary.jobs, objects: summary.objects, referenced: summary.referenced }, { jobs: 1, objects: 3, referenced: 1 });
  });

  it('auditoría: carpetas sin mascota (con o sin trabajo); la retención solo en modo borrado', async () => {
    const report = fakeDb();
    const summary = await runCleanup(deps(report.db, fakeStorage(report.state).storage), { mode: 'report', task: 'audit', batch: 5 });
    assert.deepEqual({ folders: summary.folders, withoutJob: summary.foldersWithoutJob, objects: summary.objects }, { folders: 2, withoutJob: 1, objects: 7 });
    assert.equal(report.state.purges, 0);
    assert.equal(report.state.claims.length, 0);

    const del = fakeDb();
    const deleted = await runCleanup(deps(del.db, fakeStorage(del.state).storage), { mode: 'delete', task: 'audit', batch: 5 });
    assert.equal(deleted.purged, 4);
    assert.equal(del.state.claims.length, 0, 'la auditoría nunca reserva ni borra objetos');
  });
});

describe('petición HTTP', () => {
  const env = { secret: SECRET, mode: 'delete', supabaseUrl: 'http://127.0.0.1:54321', serviceKey: SERVICE_KEY };
  const post = (headers = {}, body = '') => new Request('http://localhost/pet-storage-cleanup', { method: 'POST', headers, body });

  function harness() {
    const made = [];
    const logs = [];
    const { db, state } = fakeDb({ jobs: [job()], objects: [object(`${PET}/a.jpg`)] });
    const makeDeps = (url, key) => {
      made.push({ url, key });
      return deps(db, fakeStorage(state).storage, { logs });
    };
    return { made, logs, state, makeDeps, log: (event, fields) => logs.push({ event, ...fields }) };
  }

  it('sin secreto, con uno incorrecto o sin configurar: no se toca la BD', async () => {
    for (const [request, environment, status] of [
      [post(), env, 401],
      [post({ [SECRET_HEADER]: 'x'.repeat(40) }), env, 401],
      [post({ Authorization: `Bearer ${SECRET}` }), env, 401],
      [post({ [SECRET_HEADER]: SECRET }), { ...env, secret: undefined }, 503],
      [post({ [SECRET_HEADER]: 'corto' }), { ...env, secret: 'corto' }, 503],
    ]) {
      const h = harness();
      const response = await handleCleanupRequest(request, environment, h.makeDeps, h.log);
      assert.equal(response.status, status);
      assert.equal(h.made.length, 0, 'ni BD ni Storage');
    }
    const h = harness();
    const get = await handleCleanupRequest(new Request('http://localhost/x', { method: 'GET' }), env, h.makeDeps, h.log);
    assert.equal(get.status, 405);
  });

  it('con el secreto: cuerpo inválido 400; sin configuración de Supabase 503; correcto 200 con el resumen', async () => {
    const bad = harness();
    assert.equal((await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }, '{"bucket":"avatars"}'), env, bad.makeDeps, bad.log)).status, 400);
    assert.equal(bad.made.length, 0);

    const unconfigured = harness();
    assert.equal((await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }), { ...env, serviceKey: undefined }, unconfigured.makeDeps, unconfigured.log)).status, 503);

    const ok = harness();
    const response = await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }, '{"batch":2}'), env, ok.makeDeps, ok.log);
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.deepEqual({ mode: summary.mode, task: summary.task, removed: summary.removed, pending: summary.pending }, { mode: 'delete', task: 'process', removed: 1, pending: 1 });
    assert.deepEqual(ok.made, [{ url: env.supabaseUrl, key: SERVICE_KEY }]);
  });

  it('un fallo de la ejecución responde 500 genérico y registra solo un código', async () => {
    const h = harness();
    const makeDeps = (url, key) => {
      const d = h.makeDeps(url, key);
      d.db.claim = async () => {
        throw new CleanupRpcError('rpc_42501');
      };
      return d;
    };
    const response = await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }), env, makeDeps, h.log);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'cleanup_failed' });
    assert.deepEqual(h.logs.at(-1), { event: 'pet_storage_cleanup.run_failed', mode: 'delete', task: 'process', code: 'rpc_42501' });
  });

  it('si la BD no puede trabajar con garantías (no ve Storage): 500 con su código, nada reservado ni borrado', async () => {
    const h = harness();
    const removed = [];
    const makeDeps = (url, key) => {
      const d = h.makeDeps(url, key);
      d.db.claim = async () => {
        throw new CleanupRpcError(STORAGE_NOT_VISIBLE);
      };
      d.storage.remove = async (_bucket, names) => {
        removed.push(...names);
        return names.length;
      };
      return d;
    };
    const response = await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }), env, makeDeps, h.log);
    assert.equal(response.status, 500);
    assert.deepEqual(removed, []);
    assert.equal(h.state.reports.length, 0);
    assert.equal(h.logs.at(-1).code, STORAGE_NOT_VISIBLE);
  });

  it('una cabecera del secreto repetida no vale (llega unida: «a, b»)', async () => {
    const h = harness();
    const headers = new Headers();
    headers.append(SECRET_HEADER, SECRET);
    headers.append(SECRET_HEADER, SECRET);
    const response = await handleCleanupRequest(new Request('http://localhost/x', { method: 'POST', headers }), env, h.makeDeps, h.log);
    assert.equal(response.status, 401);
    assert.equal(h.made.length, 0);
  });

  it('los registros no contienen el secreto, la clave, URLs ni rutas', async () => {
    const h = harness();
    await handleCleanupRequest(post({ [SECRET_HEADER]: 'y'.repeat(40) }), env, h.makeDeps, h.log);
    await handleCleanupRequest(post({ [SECRET_HEADER]: SECRET }), env, h.makeDeps, h.log);
    const text = JSON.stringify(h.logs);
    assert.ok(h.logs.length >= 2);
    for (const forbidden of [SECRET, 'y'.repeat(40), SERVICE_KEY, 'http', `${PET}/a.jpg`, '.jpg']) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
});

describe('adaptadores HTTP (rest.ts)', () => {
  function stubFetch(responses) {
    const calls = [];
    const fetchStub = async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchStub };
  }

  it('RPC: POST a /rest/v1/rpc con la clave de servicio y los parámetros con nombre', async () => {
    const { calls, fetchStub } = stubFetch([{ status: 200, body: [job()] }, { status: 200, body: 'pending' }]);
    const db = createRestCleanupDb({ url: 'http://127.0.0.1:54321/', serviceKey: SERVICE_KEY, fetch: fetchStub });

    assert.deepEqual(await db.claim(2, 300), [job()]);
    assert.equal(await db.report(job(), 3, null), 'pending');

    assert.equal(calls[0].url, 'http://127.0.0.1:54321/rest/v1/rpc/pet_storage_cleanup_claim');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.apikey, SERVICE_KEY);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
    assert.deepEqual(JSON.parse(calls[0].init.body), { p_limit: 2, p_lock_seconds: 300 });
    assert.deepEqual(JSON.parse(calls[1].init.body), { p_job_id: job().job_id, p_lock_token: job().lock_token, p_removed: 3, p_error: null });
  });

  it('RPC: errores como códigos seguros (reserva perdida, mascota existente, SQLSTATE, red)', async () => {
    const { fetchStub } = stubFetch([
      { status: 400, body: { code: 'P0001', message: LOCK_LOST, hint: LOCK_LOST, details: null } },
      { status: 400, body: { code: 'P0001', message: PET_EXISTS, hint: PET_EXISTS, details: null } },
      { status: 400, body: { code: 'P0001', message: STORAGE_NOT_VISIBLE, hint: STORAGE_NOT_VISIBLE, details: null } },
      { status: 400, body: { code: 'P0001', message: PHOTO_PATH_UNCHECKED, hint: PHOTO_PATH_UNCHECKED, details: null } },
      { status: 401, body: { code: '42501', message: `permission denied; key ${SERVICE_KEY}` } },
      { status: 502, body: 'gateway' },
      new TypeError('fetch failed http://127.0.0.1'),
    ]);
    const db = createRestCleanupDb({ url: 'http://127.0.0.1:54321', serviceKey: SERVICE_KEY, fetch: fetchStub });
    const codes = [];
    for (let i = 0; i < 7; i++) {
      try {
        await db.claim(1, 60);
      } catch (error) {
        assert.ok(error instanceof CleanupRpcError);
        codes.push(error.code);
        assert.equal(error.message.includes(SERVICE_KEY), false);
      }
    }
    assert.deepEqual(codes, [LOCK_LOST, PET_EXISTS, STORAGE_NOT_VISIBLE, PHOTO_PATH_UNCHECKED, 'rpc_42501', 'rpc_http_502', 'rpc_network']);
  });

  it('Storage: DELETE /storage/v1/object/pet-photos con los nombres exactos; cuenta lo borrado', async () => {
    const { calls, fetchStub } = stubFetch([
      { status: 200, body: [{ name: `${PET}/a.jpg` }] },
      { status: 400, body: { error: 'x' } },
      { status: 200, body: { not: 'an array' } },
    ]);
    const storage = createRestCleanupStorage({ url: 'http://127.0.0.1:54321', serviceKey: SERVICE_KEY, fetch: fetchStub });

    assert.equal(await storage.remove(BUCKET, [`${PET}/a.jpg`, `${PET}/gone.jpg`]), 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:54321/storage/v1/object/pet-photos');
    assert.equal(calls[0].init.method, 'DELETE');
    assert.deepEqual(JSON.parse(calls[0].init.body), { prefixes: [`${PET}/a.jpg`, `${PET}/gone.jpg`] });
    await assert.rejects(storage.remove(BUCKET, ['x']), (error) => error instanceof StorageRemoveError && error.code === 'storage_http_400');
    await assert.rejects(storage.remove(BUCKET, ['x']), (error) => error.code === 'storage_bad_response');
    await assert.rejects(storage.remove('avatars', ['x']), (error) => error.code === 'storage_bucket_not_allowed');
    assert.equal(calls.length, 3, 'otro bucket ni siquiera llega a Storage');
  });
});
