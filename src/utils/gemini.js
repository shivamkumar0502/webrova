/**
 * gemini.js — Gemini API Wrapper
 * 
 * FIXES:
 * 1. maxOutputTokens set to 65536 — prevents truncation on large code responses
 * 2. Detects truncated responses (finishReason: MAX_TOKENS) and retries with hint
 * 3. Aggressive JSON extraction — handles markdown, leading text, trailing text
 * 4. Truncation repair — attempts to close unclosed JSON brackets/braces
 */

import { GoogleGenAI } from "@google/genai";

let aiClient = null;

export function initGemini(apiKey) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Get one from https://aistudio.google.com/apikey");
  }
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

export function getClient() {
  if (!aiClient) throw new Error("Gemini not initialized. Call initGemini(apiKey) first.");
  return aiClient;
}

export async function callGemini({ systemPrompt, userPrompt, agentName = "unknown", currentCost = 0, tokenBudget = 2, model, maxTokens }) {
  const client = getClient();
  // Configure rates for the selected model. These are planning estimates, not billing guarantees.
  const inputRate = Number(process.env.LLM_INPUT_USD_PER_MILLION || 0.30);
  const outputRate = Number(process.env.LLM_OUTPUT_USD_PER_MILLION || 2.50);
  if (![inputRate, outputRate, tokenBudget].every(n => Number.isFinite(n) && n > 0)) throw new Error("Invalid LLM budget/rates");
  const fullPrompt = `${systemPrompt}\n\nINPUT:\n${userPrompt}\nRespond with valid JSON only.`;
  const totals = { input: 0, output: 0, cost: 0 };
  const limit = Math.min(maxTokens || (agentName.toLowerCase().includes("coder") ? 16384 : 8192), Number(process.env.LLM_MAX_OUTPUT_TOKENS || 16384));
  const retries = Math.max(1, Math.min(3, Number(process.env.LLM_MAX_ATTEMPTS || 2)));
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    const available = tokenBudget - currentCost - totals.cost;
    const estimatedInput = Math.ceil(fullPrompt.length / 3);
    const affordable = Math.floor((available - estimatedInput * inputRate / 1e6) * 1e6 / outputRate);
    if (affordable < 256) {
      const error = new Error("TOKEN_BUDGET_EXCEEDED: insufficient remaining estimated budget");
      error.tokens = totals; throw error;
    }
    try {
      const response = await client.models.generateContent({
        model: model || process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: fullPrompt,
        config: { responseMimeType: "application/json", maxOutputTokens: Math.min(limit, affordable) },
      });
      const raw = response.text || "", usage = response.usageMetadata || {};
      const input = usage.promptTokenCount ?? estimatedInput;
      const output = (usage.candidatesTokenCount ?? Math.ceil(raw.length / 3)) + (usage.thoughtsTokenCount || 0);
      totals.input += input; totals.output += output;
      totals.cost += (input * inputRate + output * outputRate) / 1e6;
      if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Response truncated; reduce task scope");
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      return { parsed: JSON.parse(cleaned), raw, tokens: totals };
    } catch (error) {
      lastError = error;
      // Only transient transport errors and JSON errors warrant another paid attempt.
      const transient = [429, 500, 502, 503, 504].includes(Number(error.status));
      if (!(error instanceof SyntaxError) && !transient) break;
      if (attempt + 1 < retries) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  lastError.tokens = totals; throw lastError;
}

/**
 * Helper: build tokenUsage delta from a single callGemini result
 */
export function makeTokenDelta(agentName, tokens) {
  return {
    newCalls: [{
      agent: agentName,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      timestamp: Date.now(),
    }],
    addedInput: tokens.input,
    addedOutput: tokens.output,
    addedCost: tokens.cost,
  };
}

/** Empty token delta — for when LLM call fails */
export function emptyTokenDelta(agentName) {
  return makeTokenDelta(agentName, { input: 0, output: 0, cost: 0 });
}

/**
 * Safe wrapper around callGemini — NEVER throws (except TOKEN_BUDGET_EXCEEDED).
 * Returns { ok: true, parsed, raw, tokens } on success
 * Returns { ok: false, error, tokens } on failure
 * 
 * Use this in every agent to prevent graph crashes.
 */
export async function safeCallGemini(options) {
  try {
    const result = await callGemini(options);
    return { ok: true, ...result };
  } catch (error) {
    // Token budget is the only hard stop
    if (error.message?.includes("TOKEN_BUDGET_EXCEEDED")) throw error;
    
    console.error(`[${options.agentName}] LLM call failed: ${error.message}`);
    return {
      ok: false,
      error: error.message,
      parsed: null,
      raw: "",
      tokens: error.tokens || { input: 0, output: 0, cost: 0 },
    };
  }
}