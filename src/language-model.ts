import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { PROVIDER_ID, resolveRuntimeModel } from './models.js';

export type AntigravityOptions = { apiKey?: string; baseURL?: string };

const usage: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function textFromPrompt(options: LanguageModelV3CallOptions): string {
  return options.prompt
    .flatMap((message) =>
      'content' in message && Array.isArray(message.content)
        ? (message.content as Array<{ type: string; text?: string }>)
        : [],
    )
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** AI SDK adapter for the Cloud Code Assist streamGenerateContent endpoint. */
export class AntigravityLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = PROVIDER_ID;
  readonly supportedUrls = {};

  constructor(
    readonly modelId: string,
    private readonly options: AntigravityOptions,
  ) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    let text = '';
    const result = await this.doStream(options);
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'text-delta') text += value.delta;
    }
    return {
      content: text ? [{ type: 'text', text }] : [],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const token = this.options.apiKey ?? process.env.ANTIGRAVITY_ACCESS_TOKEN;
    if (!token)
      throw new Error(
        'No Antigravity credential. Set ANTIGRAVITY_ACCESS_TOKEN or configure apiKey.',
      );
    const baseURL =
      this.options.baseURL ??
      process.env.ANTIGRAVITY_BASE_URL ??
      'https://daily-cloudcode-pa.googleapis.com';
    const runtimeModel = resolveRuntimeModel(
      this.modelId,
      options.providerOptions?.antigravity?.reasoningEffort as string | undefined,
    );
    const body = {
      model: runtimeModel,
      contents: [{ role: 'user', parts: [{ text: textFromPrompt(options) }] }],
      generationConfig: { maxOutputTokens: options.maxOutputTokens },
    };
    const response = await fetch(`${baseURL}/v1internal:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Antigravity request failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    const id = crypto.randomUUID();
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id });
        const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
        let pending = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            const events = pending.split(/\n\n/);
            pending = events.pop() ?? '';
            for (const event of events) {
              const line = event.split('\n').find((item) => item.startsWith('data:'));
              if (!line) continue;
              try {
                const data = JSON.parse(line.slice(5));
                const delta =
                  data?.candidates?.[0]?.content?.parts
                    ?.map((part: { text?: string }) => part.text ?? '')
                    .join('') ?? '';
                if (delta) controller.enqueue({ type: 'text-delta', id, delta });
              } catch {
                /* Ignore keepalives and malformed partial SSE records. */
              }
            }
          }
          controller.enqueue({ type: 'text-end', id });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage,
          });
          controller.close();
        } catch (error) {
          controller.enqueue({ type: 'error', error });
          controller.error(error);
        }
      },
    });
    return {
      stream,
      request: { body },
      response: { headers: Object.fromEntries(response.headers) },
    };
  }
}
