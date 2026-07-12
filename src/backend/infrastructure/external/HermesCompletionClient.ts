// Hermes API Server-backed implementation of the AITextCompletionClient boundary.
//
// The MarketDesk app runs in Docker and calls the Hermes Agent gateway/API server
// on the same VPS. Hermes then decides which configured model/provider/tools to
// use; MarketDesk no longer owns a direct Claude/Anthropic integration.

import type {
  AITextCompletionClient,
  AICompletionRequest,
  HermesAIConfig,
} from './HermesAI';
import { loadHermesConfig } from './HermesAI';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class HermesCompletionClient implements AITextCompletionClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;

  constructor(config: HermesAIConfig = loadHermesConfig()) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens;
    this.timeoutMs = config.timeoutMs;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          'X-Hermes-Session-Key': 'marketdesk:ai-provider',
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          max_tokens: request.maxTokens ?? this.defaultMaxTokens,
          messages: [
            { role: 'system', content: this.withJsonSchemaInstruction(request) },
            { role: 'user', content: request.prompt },
          ],
        }),
      });

      const body = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
      if (!response.ok) {
        const message = body.error?.message || `Hermes API request failed with ${response.status}`;
        throw new Error(message);
      }

      return body.choices?.[0]?.message?.content?.trim() ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private withJsonSchemaInstruction(request: AICompletionRequest): string {
    if (!request.jsonSchema) return request.system;

    return [
      request.system,
      'Return only valid JSON. Do not include markdown fences, comments, prose, or extra keys.',
      `The JSON must match this schema: ${JSON.stringify(request.jsonSchema)}.`,
    ].join('\n');
  }
}
