/**
 * Shared Bedrock Converse invocation helper.
 *
 * Every Praxis AI feature (estimate, prioritize, overlap) ultimately
 * calls this. Centralizing it means:
 *
 *   - One place to set safe defaults (max tokens, temperature).
 *   - One place to handle the SDK response shape — Converse wraps the
 *     model text in `output.message.content[0].text`, which is awkward
 *     to remember at every call site.
 *   - One place to handle "the model wrapped JSON in a markdown fence"
 *     (Claude sometimes does this even when told not to), so feature
 *     modules can rely on `runJsonConverse<T>()` returning a parsed
 *     object.
 *
 * No retry / throttle handling is built in yet. Bedrock returns
 * ThrottlingException with a clean retryable status code; the SDK's
 * default retry strategy already handles transient throttles. If we
 * need explicit backoff later (e.g. for the priority recommendation
 * which sends large prompts), we add it here.
 */

import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

import { bedrockRuntimeClient } from "./bedrock";
import { assertAiEnabled } from "./feature-flag";

export interface ConverseOptions {
  modelId: string;
  /**
   * System prompt — primes the model's behavior. Keep short and
   * load-bearing; long system prompts dilute the user message.
   */
  system: string;
  /**
   * The user prompt. May be long; if you're sending structured data
   * (a project list, an idea against existing projects), include it
   * as labeled blocks so the model can keep its bearings.
   */
  user: string;
  /**
   * Maximum tokens the model may emit. Default 1024 — fine for
   * structured-output features. Raise for prioritize, which emits
   * one ranked entry per open project.
   */
  maxTokens?: number;
  /**
   * 0 = fully deterministic. We default to 0.2 so the model has
   * just enough latitude to produce natural-sounding rationales
   * without paraphrasing itself across two calls with the same
   * input.
   */
  temperature?: number;
}

export interface ConverseResult {
  /** The raw assistant text — useful when the caller wants it verbatim. */
  text: string;
  /**
   * Per-call usage if Bedrock returned it. Surfaced for future
   * cost telemetry; consumers can ignore.
   */
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  /** modelId we actually invoked — echoed for logging / audit. */
  modelId: string;
}

/**
 * Low-level invocation. Returns the raw response text. Use this
 * when the model is expected to emit free-form prose (or when the
 * caller wants to parse JSON themselves).
 */
export async function runConverse(opts: ConverseOptions): Promise<ConverseResult> {
  assertAiEnabled();
  const client = bedrockRuntimeClient();

  const resp = await client.send(
    new ConverseCommand({
      modelId: opts.modelId,
      system: [{ text: opts.system }],
      messages: [
        {
          role: "user",
          content: [{ text: opts.user }],
        },
      ],
      inferenceConfig: {
        maxTokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.2,
      },
    }),
  );

  const blocks = resp.output?.message?.content ?? [];
  const text = blocks
    .map((b) => ("text" in b ? b.text : ""))
    .filter(Boolean)
    .join("");

  if (!text) {
    throw new Error(
      `Bedrock model ${opts.modelId} returned no text content.`,
    );
  }

  return {
    text,
    usage: {
      inputTokens: resp.usage?.inputTokens,
      outputTokens: resp.usage?.outputTokens,
      totalTokens: resp.usage?.totalTokens,
    },
    modelId: opts.modelId,
  };
}

/**
 * Invoke the model and parse the response as JSON. Strips fence
 * markers (```json … ```) if the model leaks them despite the
 * system prompt telling it not to.
 *
 * Throws if the response isn't valid JSON after fence-stripping;
 * the caller can decide whether to retry or surface the error.
 */
export async function runJsonConverse<T>(
  opts: ConverseOptions & { schemaHint?: string },
): Promise<{ value: T; raw: ConverseResult }> {
  const raw = await runConverse({
    ...opts,
    // Bias the system prompt toward valid JSON. We append rather
    // than replace so callers can still set their own rules.
    system:
      opts.system +
      "\n\nRespond with valid JSON only. No prose outside the JSON. " +
      "No markdown code fences." +
      (opts.schemaHint ? `\n\nExpected shape: ${opts.schemaHint}` : ""),
  });

  const stripped = stripCodeFence(raw.text);
  try {
    const value = JSON.parse(stripped) as T;
    return { value, raw };
  } catch (err) {
    throw new Error(
      `Bedrock model ${opts.modelId} returned non-JSON content: ` +
        (err instanceof Error ? err.message : String(err)) +
        `\nRaw response: ${raw.text.slice(0, 500)}`,
    );
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // Common patterns: ```json\n…\n```  /  ```\n…\n```
  const fence = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/;
  const m = trimmed.match(fence);
  if (m) return m[1].trim();
  return trimmed;
}
