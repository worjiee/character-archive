import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

/**
 * Character Archive Reference Tokenizer
 *
 * NOTE: cl100k_base is utilized as the Character Archive's deterministic reference tokenizer.
 * Upstream platforms (including Janitor AI) may employ alternative tokenizers or model-specific
 * encodings. This metric provides a consistent, reproducible baseline across all archived characters,
 * rather than universal or model-independent precision.
 */
export const TOKEN_REFERENCE_TOOLTIP =
  "Reference token count. Actual token usage may vary by model.";

export interface BotTokenMetricInput {
  personality?: string | null;
  scenario?: string | null;
  exampleDialogs?: string | null;
  systemPrompt?: string | null;
  postHistoryInstructions?: string | null;
  firstGreeting?: string | null;
}

export interface BotTokenMetrics {
  tokenCount: number;
  permanentTokenCount: number;
}

/**
 * Counts the tokens in a text string using the cl100k_base reference encoding.
 * Returns 0 for null, undefined, or empty strings.
 */
export function countReferenceTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return countTokens(trimmed);
}

/**
 * Calculates bot token metrics for a character definition:
 * - permanentTokenCount = Personality + Scenario + Example Dialogs + System Prompt + Post-History Instructions
 * - tokenCount = permanentTokenCount + First Greeting
 *
 * Excludes: Description, alternate greetings, creator notes, lorebook content, tags, source metadata.
 */
export function calculateBotTokenMetrics(input: BotTokenMetricInput): BotTokenMetrics {
  const personalityTokens = countReferenceTokens(input.personality);
  const scenarioTokens = countReferenceTokens(input.scenario);
  const exampleDialogsTokens = countReferenceTokens(input.exampleDialogs);
  const systemPromptTokens = countReferenceTokens(input.systemPrompt);
  const postHistoryTokens = countReferenceTokens(input.postHistoryInstructions);
  const firstGreetingTokens = countReferenceTokens(input.firstGreeting);

  const permanentTokenCount =
    personalityTokens +
    scenarioTokens +
    exampleDialogsTokens +
    systemPromptTokens +
    postHistoryTokens;

  const tokenCount = permanentTokenCount + firstGreetingTokens;

  return {
    tokenCount,
    permanentTokenCount,
  };
}

/**
 * Extracts optional CCv2 system_prompt and post_history_instructions fields from rawData
 * where present.
 */
export function extractCcv2PromptFields(rawData: unknown): {
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
} {
  if (!rawData || typeof rawData !== "object") {
    return { systemPrompt: null, postHistoryInstructions: null };
  }

  const record = rawData as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;

  const systemPrompt =
    typeof data.system_prompt === "string" && data.system_prompt.trim()
      ? data.system_prompt.trim()
      : null;

  const postHistoryInstructions =
    typeof data.post_history_instructions === "string" &&
    data.post_history_instructions.trim()
      ? data.post_history_instructions.trim()
      : null;

  return { systemPrompt, postHistoryInstructions };
}

/**
 * Formats a token count into a compact string for cards (e.g. "2.5K TOKENS" or "530 TOKENS").
 */
export function formatCompactTokens(count: number | null | undefined): string {
  if (count == null || Number.isNaN(count)) return "—";
  if (count < 1000) {
    return `${count} TOKENS`;
  }
  const inK = count / 1000;
  const formatted = inK >= 10 ? inK.toFixed(0) : inK.toFixed(1).replace(/\.0$/, "");
  return `${formatted}K TOKENS`;
}

/**
 * Formats a token count into an exact localized string (e.g. "2,530 TOKENS").
 */
export function formatExactTokens(count: number | null | undefined): string {
  if (count == null || Number.isNaN(count)) return "—";
  return `${count.toLocaleString("en-US")} TOKENS`;
}
