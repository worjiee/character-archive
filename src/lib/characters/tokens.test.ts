import { describe, expect, it } from "vitest";
import {
  calculateBotTokenMetrics,
  countReferenceTokens,
  extractCcv2PromptFields,
  formatCompactTokens,
  formatExactTokens,
  TOKEN_REFERENCE_TOOLTIP,
} from "./tokens";

describe("tokens utility", () => {
  describe("countReferenceTokens", () => {
    it("returns 0 for null, undefined, and empty/whitespace strings", () => {
      expect(countReferenceTokens(null)).toBe(0);
      expect(countReferenceTokens(undefined)).toBe(0);
      expect(countReferenceTokens("")).toBe(0);
      expect(countReferenceTokens("   \n\t  ")).toBe(0);
    });

    it("deterministically counts ASCII text", () => {
      const text = "The quick brown fox jumps over the lazy dog.";
      const count1 = countReferenceTokens(text);
      const count2 = countReferenceTokens(text);
      expect(count1).toBeGreaterThan(0);
      expect(count1).toBe(count2);
    });

    it("handles multiline text with special characters", () => {
      const text = "Line 1: Hello!\nLine 2: *smiles warmly*\nLine 3: \"What's your name?\"";
      expect(countReferenceTokens(text)).toBeGreaterThan(10);
    });

    it("handles CJK and Unicode characters correctly", () => {
      const text = "こんにちは、世界！你好世界！안녕하세요 세계!";
      expect(countReferenceTokens(text)).toBeGreaterThan(0);
    });

    it("handles emojis correctly", () => {
      const text = "👋 🤖 🚀 ✨ 🐱";
      expect(countReferenceTokens(text)).toBeGreaterThan(0);
    });
  });

  describe("calculateBotTokenMetrics", () => {
    it("returns 0 for all zero/empty inputs", () => {
      const metrics = calculateBotTokenMetrics({
        personality: null,
        scenario: "",
        exampleDialogs: undefined,
        systemPrompt: "   ",
        postHistoryInstructions: null,
        firstGreeting: null,
      });
      expect(metrics.permanentTokenCount).toBe(0);
      expect(metrics.tokenCount).toBe(0);
    });

    it("correctly separates permanent tokens from greeting tokens", () => {
      const personality = "Cheerful, energetic, loves baking.";
      const scenario = "Meeting in a cozy kitchen.";
      const greeting = "Hello there! Welcome to my bakery!";

      const personalityCount = countReferenceTokens(personality);
      const scenarioCount = countReferenceTokens(scenario);
      const greetingCount = countReferenceTokens(greeting);

      const metrics = calculateBotTokenMetrics({
        personality,
        scenario,
        firstGreeting: greeting,
      });

      expect(metrics.permanentTokenCount).toBe(personalityCount + scenarioCount);
      expect(metrics.tokenCount).toBe(metrics.permanentTokenCount + greetingCount);
    });

    it("includes systemPrompt and postHistoryInstructions in permanentTokenCount", () => {
      const prompt = "Always stay in character.";
      const postHistory = "Respond in 2-3 sentences.";
      const greeting = "Hi!";

      const metrics = calculateBotTokenMetrics({
        systemPrompt: prompt,
        postHistoryInstructions: postHistory,
        firstGreeting: greeting,
      });

      const promptTokens = countReferenceTokens(prompt);
      const postTokens = countReferenceTokens(postHistory);
      const greetingTokens = countReferenceTokens(greeting);

      expect(metrics.permanentTokenCount).toBe(promptTokens + postTokens);
      expect(metrics.tokenCount).toBe(promptTokens + postTokens + greetingTokens);
    });
  });

  describe("extractCcv2PromptFields", () => {
    it("returns nulls for invalid or missing rawData", () => {
      expect(extractCcv2PromptFields(null)).toEqual({
        systemPrompt: null,
        postHistoryInstructions: null,
      });
      expect(extractCcv2PromptFields("invalid")).toEqual({
        systemPrompt: null,
        postHistoryInstructions: null,
      });
      expect(extractCcv2PromptFields({})).toEqual({
        systemPrompt: null,
        postHistoryInstructions: null,
      });
    });

    it("extracts from data object in CCv2 format", () => {
      const rawData = {
        spec: "chara_card_v2",
        data: {
          system_prompt: "  System directive  ",
          post_history_instructions: "Instructions after history",
        },
      };
      expect(extractCcv2PromptFields(rawData)).toEqual({
        systemPrompt: "System directive",
        postHistoryInstructions: "Instructions after history",
      });
    });

    it("returns null for empty string values", () => {
      const rawData = {
        data: {
          system_prompt: "   ",
          post_history_instructions: "",
        },
      };
      expect(extractCcv2PromptFields(rawData)).toEqual({
        systemPrompt: null,
        postHistoryInstructions: null,
      });
    });
  });

  describe("formatters", () => {
    it("formatCompactTokens handles null/undefined/NaN", () => {
      expect(formatCompactTokens(null)).toBe("—");
      expect(formatCompactTokens(undefined)).toBe("—");
      expect(formatCompactTokens(NaN)).toBe("—");
    });

    it("formatCompactTokens formats counts under 1000", () => {
      expect(formatCompactTokens(0)).toBe("0 TOKENS");
      expect(formatCompactTokens(530)).toBe("530 TOKENS");
      expect(formatCompactTokens(999)).toBe("999 TOKENS");
    });

    it("formatCompactTokens formats counts 1000 and above", () => {
      expect(formatCompactTokens(1000)).toBe("1K TOKENS");
      expect(formatCompactTokens(2530)).toBe("2.5K TOKENS");
      expect(formatCompactTokens(12450)).toBe("12K TOKENS");
    });

    it("formatExactTokens formats with commas", () => {
      expect(formatExactTokens(null)).toBe("—");
      expect(formatExactTokens(0)).toBe("0 TOKENS");
      expect(formatExactTokens(2530)).toBe("2,530 TOKENS");
      expect(formatExactTokens(123456)).toBe("123,456 TOKENS");
    });
  });

  describe("reference tooltip constant", () => {
    it("matches approved client wording exactly", () => {
      expect(TOKEN_REFERENCE_TOOLTIP).toBe(
        "Reference token count. Actual token usage may vary by model."
      );
    });
  });
});
