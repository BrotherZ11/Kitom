import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { installWebCrypto } from './web-crypto.ts';

const impl = {
  getRandomValues: (array) => {
    array.fill(7);
    return array;
  },
  digestSha256: async (data) => {
    const hash = createHash('sha256').update(data).digest();
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
  },
};

describe('installWebCrypto', () => {
  it('sin crypto (Hermes): instala getRandomValues y subtle.digest SHA-256', async () => {
    const target = {};
    installWebCrypto(target, impl);
    assert.deepEqual(Array.from(target.crypto.getRandomValues(new Uint32Array(2))), [7, 7]);
    const digest = await target.crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
    assert.equal(Buffer.from(digest).toString('hex'), createHash('sha256').update('abc').digest('hex'));
    const byName = await target.crypto.subtle.digest({ name: 'sha-256' }, new Uint8Array([1, 2]));
    assert.equal(byName.byteLength, 32);
  });

  it('otro algoritmo se rechaza en vez de dar un hash equivocado', async () => {
    const target = {};
    installWebCrypto(target, impl);
    await assert.rejects(target.crypto.subtle.digest('SHA-1', new Uint8Array([1])), /no soportado/);
  });

  it('en un navegador (métodos en el prototipo) no toca la implementación nativa', () => {
    class NativeCrypto {
      getRandomValues() {
        return 'native';
      }
      get subtle() {
        return { digest: () => 'native' };
      }
    }
    const native = new NativeCrypto();
    const target = { crypto: native };
    installWebCrypto(target, impl);
    assert.deepEqual(Object.getOwnPropertyNames(native), []);
    assert.equal(target.crypto.getRandomValues(), 'native');
    assert.equal(target.crypto.subtle.digest(), 'native');
  });

  it('con crypto nativo completo no cambia nada', () => {
    const native = { getRandomValues: () => 'native', subtle: { digest: () => 'native' } };
    const target = { crypto: native };
    installWebCrypto(target, impl);
    assert.equal(target.crypto, native);
    assert.equal(target.crypto.getRandomValues(), 'native');
    assert.equal(target.crypto.subtle.digest(), 'native');
  });

  it('con crypto a medias solo añade lo que falta', async () => {
    const getRandomValues = () => 'native';
    const target = { crypto: { getRandomValues } };
    installWebCrypto(target, impl);
    assert.equal(target.crypto.getRandomValues, getRandomValues);
    assert.equal((await target.crypto.subtle.digest('SHA-256', new Uint8Array([]))).byteLength, 32);
  });
});
