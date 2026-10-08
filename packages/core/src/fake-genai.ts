/**
 * In-memory stand-in for `GoogleGenAI.models.generateContent`, for unit tests:
 * it records every request and returns queued answers in order (or throws a
 * queued error). Install it with `setClientOverride("genai", fake.asGenAI())`.
 */
import type { GenerateContentParameters, GoogleGenAI } from "@google/genai";

export interface FakeAnswer {
  /** The JSON text Gemini returns. */
  text: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    toolUsePromptTokenCount?: number;
  };
}

export class FakeGenAI {
  readonly requests: GenerateContentParameters[] = [];
  private readonly queue: Array<FakeAnswer | Error> = [];

  /** Queues answers (or errors) for the next calls. */
  answer(...answers: Array<FakeAnswer | Error>): this {
    this.queue.push(...answers);
    return this;
  }

  readonly models = {
    generateContent: async (request: GenerateContentParameters) => {
      this.requests.push(structuredClone(request));
      const next = this.queue.shift();
      if (!next) throw new Error("FakeGenAI: no answer queued");
      if (next instanceof Error) throw next;
      return {
        text: next.text,
        modelVersion: "fake-model-001",
        usageMetadata: {
          promptTokenCount: 8_000,
          candidatesTokenCount: 900,
          thoughtsTokenCount: 100,
          totalTokenCount: 9_000,
          ...next.usage,
        },
      };
    },
  };

  asGenAI(): GoogleGenAI {
    return this as unknown as GoogleGenAI;
  }
}
