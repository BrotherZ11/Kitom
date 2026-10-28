// pet-storage-cleanup contra el Supabase LOCAL: Auth, PostgREST, el trigger y las RPC reales y la API de
// Storage real (subidas con el token del usuario, borrado con la clave de servicio, como en producción).
// `node supabase/functions/pet-storage-cleanup/run-integration.mjs`; sin esas variables se omite. Nunca
// contra `kitom-dev`.
//
// Los plazos (15 min, 25 h) se adelantan con SQL sobre el contenedor local, como los scripts de
// concurrencia. Crea usuarios `it-…@kitom.test` (quedan en el Auth local); sus mascotas, objetos y
// trabajos se borran al terminar. Los trabajos de la prueba se ponen por delante de cualquier otro de la
// BD local y cada ejecución reserva uno: nunca toca trabajos ajenos.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { BUCKET, runCleanup } from './cleanup.ts';
import { createRestCleanupDb, createRestCleanupStorage } from './rest.ts';

const URL_ = process.env.KITOM_IT_SUPABASE_URL;
const ANON_KEY = process.env.KITOM_IT_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.KITOM_IT_SUPABASE_SERVICE_ROLE_KEY;
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_Kitom';
const isLocal = URL_ !== undefined && ['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname);
const skip = !URL_ || !ANON_KEY || !SERVICE_KEY ? 'sin Supabase local (run-integration.mjs)' : !isLocal ? 'la URL no es local' : false;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/** SQL como postgres en el contenedor LOCAL (solo plazos, comprobaciones de la cola y limpieza). */
function sql(text) {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
    input: text,
    encoding: 'utf8',
  })
    .replace(/\r/g, '')
    .trim();
}

async function api(path, { method = 'GET', token, key = ANON_KEY, body, headers = {} } = {}) {
  const response = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

async function signUp() {
  const email = `it-${randomUUID()}@kitom.test`;
  const { status, data } = await api('/auth/v1/signup', { method: 'POST', body: { email, password: `It-${randomUUID()}` } });
  assert.equal(status, 200, 'el Auth local no exige confirmar el email');
  return { id: data.user.id, token: data.access_token };
}

const upload = (user, name) =>
  api(`/storage/v1/object/${BUCKET}/${name}`, { method: 'POST', token: user.token, body: JPEG, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' } });

/** Nombres de pet-photos cuya carpeta es esa mascota (cualquier caja), leídos de la BD. */
const objectsOf = (petId) =>
  sql(`select coalesce(string_agg(name, ',' order by name collate "C"), '') from storage.objects
       where bucket_id = 'pet-photos' and public.safe_pet_id_from_path(name) = '${petId}'`);

const jobOf = (petId) =>
  sql(`select status || '|' || objects_removed || '|' || coalesce(last_error, '') || '|' || attempts
       from private.pet_storage_cleanup_jobs where pet_id = '${petId}'`);

/** Adelanta el trabajo: vencido y por delante de los demás; con `settled`, pasadas las 25 h. */
function makeDue(petId, { settled = false } = {}) {
  sql(`update private.pet_storage_cleanup_jobs
          set next_attempt_at = now() - interval '100 years'${settled ? ", deleted_at = now() - interval '26 hours'" : ''}
        where pet_id = '${petId}'`);
}

const cleanupDeps = (logs = []) => ({
  db: createRestCleanupDb({ url: URL_, serviceKey: SERVICE_KEY }),
  storage: createRestCleanupStorage({ url: URL_, serviceKey: SERVICE_KEY }),
  now: Date.now,
  log: (event, fields) => logs.push({ event, ...fields }),
});

const runOne = (logs) => runCleanup(cleanupDeps(logs), { mode: 'delete', task: 'process', batch: 1 });

describe('pet-storage-cleanup contra el Supabase local', { skip }, () => {
  let user;
  let speciesId;
  const pets = [];

  const createPet = async (name) => {
    const { status, data } = await api('/rest/v1/pets', {
      method: 'POST',
      token: user.token,
      body: { owner_id: user.id, name, species_id: speciesId },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(status, 201);
    pets.push(data[0].id);
    return data[0].id;
  };
  const deletePet = async (id) => {
    const { status } = await api(`/rest/v1/pets?id=eq.${id}`, { method: 'DELETE', token: user.token });
    assert.equal(status, 204);
  };

  before(async () => {
    assert.equal(sql("select count(*) from storage.buckets where id = 'pet-photos'"), '1', 'bucket local: npx supabase seed buckets --local');
    user = await signUp();
    const { data } = await api('/rest/v1/species?select=id&code=eq.dog', { token: user.token });
    speciesId = data[0].id;
  });

  after(async () => {
    // Lo que quede de mascotas vivas, por la API (como el usuario); lo de las borradas, con SQL local.
    for (const id of pets) {
      const { data } = await api(`/rest/v1/pets?select=id&id=eq.${id}`, { token: user.token });
      if (Array.isArray(data) && data.length > 0) {
        const names = objectsOf(id);
        if (names) await api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: user.token, body: { prefixes: names.split(',') } });
        await deletePet(id);
      }
    }
    if (pets.length > 0) {
      const list = pets.map((id) => `'${id}'`).join(',');
      sql(`begin; set local storage.allow_delete_query = 'true';
           delete from storage.objects where bucket_id = 'pet-photos' and public.safe_pet_id_from_path(name) in (${list});
           commit;
           delete from private.pet_storage_cleanup_jobs where pet_id in (${list});`);
    }
  });

  it('borrar una mascota encola su limpieza y solo se borran sus objetos (anidados y en mayúsculas); otra mascota queda intacta', async () => {
    const gone = await createPet('Se borra');
    const kept = await createPet('Se queda');
    const profile = `${gone}/${randomUUID()}.jpg`;
    const names = [profile, `${gone}/${randomUUID()}.jpg`, `${gone.toUpperCase()}/upper.jpg`, `${gone}/nested/deep/n.jpg`];
    for (const name of names) assert.equal((await upload(user, name)).status, 200, `subida ${name}`);
    const keptName = `${kept}/${randomUUID()}.jpg`;
    assert.equal((await upload(user, keptName)).status, 200);
    assert.equal((await api(`/rest/v1/pets?id=eq.${gone}`, { method: 'PATCH', token: user.token, body: { photo_path: profile } })).status, 204);
    assert.equal((await api(`/rest/v1/pets?id=eq.${kept}`, { method: 'PATCH', token: user.token, body: { photo_path: keptName } })).status, 204);

    // El CHECK nuevo, por la API: la otra mascota no puede apuntar a la carpeta de esta.
    const cross = await api(`/rest/v1/pets?id=eq.${kept}`, { method: 'PATCH', token: user.token, body: { photo_path: profile } });
    assert.equal(cross.status, 400);
    assert.equal(cross.data.code, '23514');

    await deletePet(gone);
    assert.equal(jobOf(gone), 'pending|0||0', 'encolado al borrar, sin tocar Storage');
    assert.equal(objectsOf(gone).split(',').length, 4, 'los objetos siguen ahí hasta que pasa la limpieza');

    // Modo informe: lo ve, no toca nada.
    const preview = await runCleanup(cleanupDeps(), { mode: 'report', task: 'process', batch: 1 });
    assert.ok(preview.objects >= 4);
    assert.equal(jobOf(gone), 'pending|0||0');

    // Primera pasada: borra lo de esa mascota (por la API de Storage) y queda pendiente hasta las 25 h.
    makeDue(gone);
    const first = await runOne();
    assert.deepEqual({ jobs: first.jobs, removed: first.removed, pending: first.pending, errors: first.errors }, { jobs: 1, removed: 4, pending: 1, errors: {} });
    assert.equal(objectsOf(gone), '', 'ninguna variante de la carpeta queda');
    assert.equal(jobOf(gone), 'pending|4||0', 'no termina antes del plazo');
    const download = await api(`/storage/v1/object/authenticated/${BUCKET}/${profile}`, { key: SERVICE_KEY });
    assert.notEqual(download.status, 200, 'el archivo ya no está en Storage');
    assert.equal(objectsOf(kept), keptName, 'la otra mascota conserva su foto');
    const keptDownload = await api(`/storage/v1/object/authenticated/${BUCKET}/${keptName}`, { key: SERVICE_KEY });
    assert.equal(keptDownload.status, 200);

    // Verificación pasado el plazo: vacío → terminado.
    makeDue(gone, { settled: true });
    const second = await runOne();
    assert.deepEqual({ jobs: second.jobs, removed: second.removed, done: second.done }, { jobs: 1, removed: 0, done: 1 });
    assert.match(jobOf(gone), /^done\|4\|\|/);
    assert.equal(objectsOf(kept), keptName);
  });

  it('subida reanudable (TUS) empezada antes del borrado y terminada después: el trabajo no termina con el objeto ahí', async (t) => {
    const pet = await createPet('Subida tardía');
    const name = `${pet}/${randomUUID()}.jpg`;
    const b64 = (value) => Buffer.from(value).toString('base64');
    const created = await api('/storage/v1/upload/resumable', {
      method: 'POST',
      token: user.token,
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(JPEG.length),
        'Upload-Metadata': `bucketName ${b64(BUCKET)},objectName ${b64(name)},contentType ${b64('image/jpeg')}`,
        'x-upsert': 'false',
      },
    });
    assert.equal(created.status, 201, 'la subida se crea con la mascota viva');
    const location = new URL(created.headers.get('location'));

    await deletePet(pet);
    makeDue(pet);
    const early = await runOne();
    assert.deepEqual({ jobs: early.jobs, removed: early.removed, pending: early.pending }, { jobs: 1, removed: 0, pending: 1 });

    const finished = await api(`${location.pathname}`, {
      method: 'PATCH',
      token: user.token,
      body: JPEG,
      headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    });
    const appeared = objectsOf(pet) === name;
    t.diagnostic(`TUS terminada tras el borrado: HTTP ${finished.status}; objeto creado: ${appeared}`);
    // Solo dos resultados válidos: terminada (204, y entonces el objeto existe) o rechazada por la
    // política (403 de RLS, sin objeto). Cualquier otro (una URL mal formada, 404…) es un fallo de la prueba.
    if (finished.status === 204) {
      assert.equal(appeared, true, 'terminada: el objeto existe');
    } else {
      assert.equal(finished.status, 403);
      assert.match(JSON.stringify(finished.data), /row-level security/i);
      assert.equal(appeared, false);
    }

    makeDue(pet, { settled: true });
    const verify = await runOne();
    if (appeared) {
      // Apareció después de la primera pasada: la verificación lo borra y solo entonces termina.
      assert.equal(verify.removed, 1);
    } else {
      assert.equal(verify.removed, 0, 'Storage rechazó terminar la subida de una mascota borrada');
    }
    assert.equal(objectsOf(pet), '');
    assert.match(jobOf(pet), /^done\|/);
  });
});
