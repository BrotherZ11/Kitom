import { GUIDANCE_JSON_SCHEMA } from './guidance.ts';

/**
 * Proveedores de IA intercambiables (PRD §10 y §16). Se elige con `AI_PROVIDER` (`openai` por defecto).
 * `mock` devuelve una respuesta fija y solo se permite contra un Supabase local (pruebas sin coste).
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
const TIMEOUT_MS = 60_000;

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
      // 401/403/404: clave o modelo mal configurados; el resto, indisponibilidad.
      const code = [401, 403, 404].includes(response.status) ? 'ai_misconfigured' : 'ai_unavailable';
      throw new ProviderError(code, `openai_http_${response.status}`);
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
  const name = (env.get('AI_PROVIDER') ?? 'openai').toLowerCase();
  if (name === 'mock') {
    if (!isLocalSupabase(env.get('SUPABASE_URL'))) throw new ProviderError('ai_misconfigured', 'mock_provider_not_local');
    return mockProvider();
  }
  if (name === 'openai') {
    const apiKey = env.get('OPENAI_API_KEY');
    const model = env.get('OPENAI_MODEL');
    if (!apiKey || !model) throw new ProviderError('ai_misconfigured', 'openai_env_missing');
    return openAiProvider(apiKey, model);
  }
  throw new ProviderError('ai_misconfigured', 'unknown_provider');
}
