import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { DEFAULT_GEMINI_MODEL, ProviderError, providerFromEnv } from './providers.ts';

const env = (values) => ({ get: (name) => values[name] });
const realFetch = globalThis.fetch;
const request = { system: 'sistema', user: 'usuario', imageDataUrl: 'data:image/jpeg;base64,QUJD', symptomCodes: [] };

/** Sustituye `fetch` por una respuesta fija y guarda la petición. */
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('providerFromEnv', () => {
  it('Gemini por defecto; sin clave, mal configurado; el simulador solo en local', () => {
    assert.throws(() => providerFromEnv(env({})), (error) => error instanceof ProviderError && error.code === 'ai_misconfigured');
    assert.equal(typeof providerFromEnv(env({ GEMINI_API_KEY: 'k' })), 'function');
    assert.throws(() => providerFromEnv(env({ AI_PROVIDER: 'mock', SUPABASE_URL: 'https://x.supabase.co' })), ProviderError);
    assert.equal(typeof providerFromEnv(env({ AI_PROVIDER: 'mock', SUPABASE_URL: 'http://kong:8000' })), 'function');
    assert.throws(() => providerFromEnv(env({ AI_PROVIDER: 'otro' })), ProviderError);
  });
});

describe('Gemini', () => {
  it('envía sistema, texto, foto y esquema JSON con la clave en la cabecera; lee la respuesta sin el razonamiento', async () => {
    const output = { urgency_level: 'observe', possible_causes: ['a'], recommendations: ['b'] };
    const calls = stubFetch(200, {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'pensando', thought: true }, { text: JSON.stringify(output) }] },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
      modelVersion: 'gemini-x',
      responseId: 'r1',
    });
    const result = await providerFromEnv(env({ GEMINI_API_KEY: 'clave' }))(request);

    const [call] = calls;
    assert.equal(call.url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    assert.equal(call.init.headers['x-goog-api-key'], 'clave');
    assert.ok(!call.url.includes('clave'));
    assert.deepEqual(call.body.systemInstruction, { parts: [{ text: 'sistema' }] });
    assert.deepEqual(call.body.contents[0].parts, [{ text: 'usuario' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }]);
    assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(call.body.generationConfig.responseJsonSchema.additionalProperties, false);

    assert.deepEqual(result.output, output);
    assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50 });
    assert.equal(result.provider, 'gemini');
    assert.equal(result.model, 'gemini-x');
  });

  it('usa GEMINI_MODEL si está definido', async () => {
    const calls = stubFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] });
    await providerFromEnv(env({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-otro' }))({ ...request, imageDataUrl: null });
    assert.match(calls[0].url, /models\/gemini-otro:generateContent$/);
    assert.equal(calls[0].body.contents[0].parts.length, 1);
  });

  it('sin saldo o con la clave mal: mal configurado; límite o caída: no disponible (sin repetir el cuerpo)', async () => {
    const provider = providerFromEnv(env({ GEMINI_API_KEY: 'k' }));
    stubFetch(402, { error: { code: 402, status: 'RESOURCE_EXHAUSTED', message: 'Your prepayment credits are depleted' } });
    await assert.rejects(provider(request), (error) => {
      assert.equal(error.code, 'ai_misconfigured');
      assert.equal(error.message, 'gemini_http_402_RESOURCE_EXHAUSTED');
      return true;
    });
    stubFetch(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    await assert.rejects(provider(request), (error) => error.code === 'ai_unavailable');
    stubFetch(503, {});
    await assert.rejects(provider(request), (error) => error.code === 'ai_unavailable' && error.message === 'gemini_http_503');
  });

  it('respuesta bloqueada o cortada: no disponible', async () => {
    const provider = providerFromEnv(env({ GEMINI_API_KEY: 'k' }));
    stubFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    await assert.rejects(provider(request), (error) => error.message === 'gemini_blocked_SAFETY');
    stubFetch(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"urgency' }] } }] });
    await assert.rejects(provider(request), (error) => error.message === 'gemini_finish_MAX_TOKENS');
  });
});
