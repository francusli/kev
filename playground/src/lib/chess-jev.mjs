import { experimental_evaluate as evaluate } from "ai";

export const JEV_CHESS_MODEL = "typesafe-ai/jev";

export async function evaluateJev(request, legal, evaluateFn = evaluate) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not configured");
  const started = performance.now();
  const result = await evaluateFn({
    model: JEV_CHESS_MODEL,
    state: request.state,
    questions: request.questions,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(60000),
    providerOptions: { gateway: { zeroDataRetention: true } },
  });
  const choice = result.answers.move;
  const score = result.answers.evaluation;
  if (choice?.type !== "choice" || score?.type !== "score" || !choice.probabilities || !score.probabilities ||
      !legal.some(move => move.san === choice.choice)) {
    throw new Error("Jev returned an incomplete chess answer");
  }
  return {
    model: JEV_CHESS_MODEL,
    answers: {
      move: { type: "choice", choice: choice.choice, probabilities: choice.probabilities,
        confidence: choice.probabilities[choice.choice] ?? 0 },
      evaluation: { type: "score", score: score.score, probabilities: score.probabilities,
        confidence: Math.max(...Object.values(score.probabilities)), legend: {} },
    },
    usage: { input_tokens: result.usage.inputTokens ?? 0, output_tokens: result.usage.outputTokens ?? 0 },
    latency_ms: performance.now() - started,
  };
}
