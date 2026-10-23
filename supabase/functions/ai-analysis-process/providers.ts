import { GUIDANCE_JSON_SCHEMA } from './guidance.ts';

/**
 * Proveedores de IA intercambiables (PRD §10 y §16). Se elige con `AI_PROVIDER`: `gemini` (por defecto,
 * Google AI Studio), `openai` o `mock` (respuesta fija, solo contra un Supabase local: pruebas sin coste).
 */

export type ProviderRequest = {
  system: string;
  user: string;
  /** Foto como data URL (`data:image/jpeg;base64,…`) o `null`. */
  imageDataUrl: string | null;
  symptomCodes: string[];
};

export type ProviderResponse = {
  provider: string;
  model: string;
  /** JSON devuelto por el modelo (se valida después con `parseGuidance`). */
  output: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Lo que se guarda en `response_raw` (sin la foto). */
  raw: Record<string, unknown>;
};

export class ProviderError extends Error {
  readonly code: 'ai_unavailable' | 'ai_misconfigured';

  constructor(code: 'ai_unavailable' | 'ai_misconfigured', message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export type Provider = (request: ProviderRequest) => Promise<ProviderResponse>;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Modelo de Gemini si no se define `GEMINI_MODEL` (estable, con imagen y salida JSON por esquema). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const TIMEOUT_MS = 60_000;

/** `data:image/jpeg;base64,…` → tipo y datos para `inlineData`. */
function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

/** Código del proveedor según el estado HTTP: clave, saldo, modelo o petición mal configurados, o caída. */
function httpErrorCode(status: number): 'ai_unavailable' | 'ai_misconfigured' {
  return [400, 401, 402, 403, 404].includes(status) ? 'ai_misconfigured' : 'ai_unavailable';
}

function geminiProvider(apiKey: string, model: string): Provider {
  return async ({ system, user, imageDataUrl }) => {
    const parts: unknown[] = [{ text: user }];
    const image = imageDataUrl ? splitDataUrl(imageDataUrl) : null;
    if (image) parts.push({ inlineData: image });
    let response: Response;
    try {
      response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Sin `temperature`: en los modelos Gemini 3 Google recomienda dejar el valor por defecto.
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: GUIDANCE_JSON_SCHEMA },
        }),
      });
    } catch (error) {
      throw new ProviderError('ai_unavailable', `gemini_request_failed: ${(error as Error).name}`);
    }
    if (!response.ok) {
      // Solo el estado (p. ej. RESOURCE_EXHAUSTED); el cuerpo puede repetir datos de la petición.
      let status = '';
      try {
        status = String((await response.json())?.error?.status ?? '');
      } catch {
        status = '';
      }
      throw new ProviderError(httpErrorCode(response.status), `gemini_http_${response.status}${status ? `_${status}` : ''}`);
    }
    const body = await response.json();
    if (body?.promptFeedback?.blockReason) throw new ProviderError('ai_unavailable', `gemini_blocked_${body.promptFeedback.blockReason}`);
    const candidate = body?.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;
    if (finishReason && finishReason !== 'STOP') throw new ProviderError('ai_unavailable', `gemini_finish_${finishReason}`);
    // Las partes de razonamiento (`thought`) no son la respuesta.
    const text = ((candidate?.content?.parts ?? []) as { text?: string; thought?: boolean }[])
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('');
    let output: unknown = null;
    try {
      output = JSON.parse(text || 'null');
    } catch {
      output = null;
    }
    const meta = body?.usageMetadata;
    // El razonamiento se cobra como salida.
    const usage = meta
      ? {
          inputTokens: Number(meta.promptTokenCount ?? 0),
          outputTokens: Number(meta.candidatesTokenCount ?? 0) + Number(meta.thoughtsTokenCount ?? 0),
        }
      : null;
    return {
      provider: 'gemini',
      model: String(body?.modelVersion ?? model),
      output,
      usage,
      raw: { id: body?.responseId ?? null, model: body?.modelVersion ?? model, finish_reason: finishReason, output, usage: meta ?? null },
    };
  };
}

function openAiProvider(apiKey: string, model: string): Provider {
  return async ({ system, user, imageDataUrl }) => {
    const content: unknown[] = [{ type: 'text', text: user }];
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
    let response: Response;
    try {
      response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'kitom_guidance', strict: true, schema: GUIDANCE_JSON_SCHEMA },
          },
        }),
      });
    } catch (error) {
      throw new ProviderError('ai_unavailable', `openai_request_failed: ${(error as Error).name}`);
    }
    if (!response.ok) {
      throw new ProviderError(httpErrorCode(response.status), `openai_http_${response.status}`);
    }
    const body = await response.json();
    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderError('ai_unavailable', 'openai_refusal');
    let output: unknown = null;
    try {
      output = JSON.parse(choice?.message?.content ?? 'null');
    } catch {
      output = null;
    }
    const usage = body?.usage
      ? { inputTokens: Number(body.usage.prompt_tokens ?? 0), outputTokens: Number(body.usage.completion_tokens ?? 0) }
      : null;
    return {
      provider: 'openai',
      model: String(body?.model ?? model),
      output,
      usage,
      raw: { id: body?.id ?? null, model: body?.model ?? model, finish_reason: choice?.finish_reason ?? null, output, usage: body?.usage ?? null },
    };
  };
}

/** Respuesta fija para pruebas locales: depende solo de las señales elegidas. */
function mockProvider(): Provider {
  return async ({ symptomCodes, imageDataUrl }) => {
    const urgent = symptomCodes.includes('wound') && symptomCodes.includes('lethargy');
    const output = {
      urgency_level: urgent ? 'consult_soon' : symptomCodes.length > 1 ? 'routine_change' : 'observe',
      possible_causes: ['Cansancio pasajero o un cambio reciente en su rutina.', 'Una molestia leve que conviene vigilar.'],
      recommendations: [
        urgent ? 'Pide cita con tu veterinario en los próximos días.' : 'Vigila cómo evoluciona durante dos o tres días.',
        'Anota en el registro diario si notas cambios.',
        imageDataUrl ? 'Gracias por la foto: ayuda a orientar mejor.' : 'Una foto ayuda a orientar mejor la próxima vez.',
      ],
    };
    return { provider: 'mock', model: 'mock', output, usage: { inputTokens: 0, outputTokens: 0 }, raw: { mock: true, output } };
  };
}

function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return ['kong', 'localhost', '127.0.0.1', 'host.docker.internal'].includes(hostname);
  } catch {
    return false;
  }
}

/** Proveedor según el entorno. Los fallos de configuración se dicen sin exponer valores. */
export function providerFromEnv(env: { get(name: string): string | undefined }): Provider {
  const name = (env.get('AI_PROVIDER') ?? 'gemini').toLowerCase();
  if (name === 'mock') {
    if (!isLocalSupabase(env.get('SUPABASE_URL'))) throw new ProviderError('ai_misconfigured', 'mock_provider_not_local');
    return mockProvider();
  }
  if (name === 'gemini') {
    const apiKey = env.get('GEMINI_API_KEY');
    if (!apiKey) throw new ProviderError('ai_misconfigured', 'gemini_env_missing');
    return geminiProvider(apiKey, env.get('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL);
  }
  if (name === 'openai') {
    const apiKey = env.get('OPENAI_API_KEY');
    const model = env.get('OPENAI_MODEL');
    if (!apiKey || !model) throw new ProviderError('ai_misconfigured', 'openai_env_missing');
    return openAiProvider(apiKey, model);
  }
  throw new ProviderError('ai_misconfigured', 'unknown_provider');
}
