import { experimental_evaluate as evaluate } from "ai";
import { Chess } from "chess.js";
import { buildRequest, positionState } from "@/lib/chess";
import type { SystemOneResponse } from "@/lib/kev";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) return new Response("AI_GATEWAY_API_KEY is not configured", { status: 503 });

  let moves: unknown;
  try { moves = (await request.json()).moves; } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!Array.isArray(moves) || moves.length > 250 || !moves.every((m) => typeof m === "string" && m.length <= 16)) {
    return new Response("Invalid move history", { status: 400 });
  }

  const chess = new Chess();
  try { for (const move of moves) chess.move(move); } catch { return new Response("Illegal move history", { status: 400 }); }
  if (chess.isGameOver()) return new Response("Game is over", { status: 400 });

  const { req, legal } = buildRequest(chess);
  const move = req.questions.move;
  const evaluation = req.questions.evaluation;
  if (move.type !== "choice" || evaluation.type !== "score") return new Response("Invalid chess questions", { status: 500 });

  try {
    const started = performance.now();
    const result = await evaluate({
      model: "typesafe-ai/jev",
      state: positionState(chess),
      questions: {
        move: { ...move, instructions: String(move.instructions), criteria: move.criteria as Record<string, string> },
        evaluation: { ...evaluation, instructions: String(evaluation.instructions), criteria: evaluation.criteria as string[] },
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60000),
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
    const choice = result.answers.move;
    const score = result.answers.evaluation;
    if (choice.type !== "choice" || score.type !== "score" || !choice.probabilities || !score.probabilities ||
        !legal.some((m) => m.san === choice.choice)) {
      return new Response("Jev returned an incomplete chess answer", { status: 502 });
    }
    const response: SystemOneResponse = {
      model: "typesafe-ai/jev",
      answers: {
        move: { type: "choice", choice: choice.choice, probabilities: choice.probabilities,
          confidence: choice.probabilities[choice.choice] ?? 0 },
        evaluation: { type: "score", score: score.score, probabilities: score.probabilities,
          confidence: Math.max(...Object.values(score.probabilities)), legend: {} },
      },
      usage: { input_tokens: result.usage.inputTokens ?? 0, output_tokens: result.usage.outputTokens ?? 0 },
      latency_ms: performance.now() - started,
    };
    return Response.json(response);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return new Response(status === 401 || status === 403 ? "Jev authentication failed" : "Jev request failed", { status: 502 });
  }
}
