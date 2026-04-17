/**
 * tokenTracker.js — Token Usage Display
 */

/**
 * Print a summary of token usage per agent
 */
export function printTokenSummary(tokenUsage) {
  if (!tokenUsage || tokenUsage.calls.length === 0) {
    console.log("\n📊 No LLM calls made yet.\n");
    return;
  }

  const byAgent = {};
  for (const call of tokenUsage.calls) {
    if (!byAgent[call.agent]) {
      byAgent[call.agent] = { calls: 0, input: 0, output: 0 };
    }
    byAgent[call.agent].calls++;
    byAgent[call.agent].input += call.inputTokens;
    byAgent[call.agent].output += call.outputTokens;
  }

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║               📊 TOKEN USAGE SUMMARY                    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");

  for (const [agent, data] of Object.entries(byAgent)) {
    const cost = (data.input / 1_000_000) * 0.15 + (data.output / 1_000_000) * 0.60;
    console.log(`║  ${agent.padEnd(22)} ${String(data.calls).padStart(2)} call(s)  ~$${cost.toFixed(4).padStart(7)} ║`);
  }

  const totalTokens = tokenUsage.totalInput + tokenUsage.totalOutput;
  const totalCost = tokenUsage.estimatedCost;

  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  TOTAL: ${String(tokenUsage.calls.length).padStart(2)} calls | ${String(totalTokens).padStart(6)} tokens | ~$${totalCost.toFixed(4).padStart(7)}  ║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");
}