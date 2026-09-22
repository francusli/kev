import { buildRequest, chessFromHistory } from "@/lib/chess-request.mjs";
import { evaluateOpenAI } from "@/lib/chess-openai.mjs";

export const runtime = "nodejs";
export const maxDuration = 65;

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) return new Response("OPENAI_API_KEY is not configured", { status: 503 });
  let moves: unknown;
  try { moves = (await request.json()).moves; } catch { return new Response("Invalid JSON", { status: 400 }); }
  let chess;
  try { chess = chessFromHistory(moves); } catch (error) { return new Response((error as Error).message, { status: 400 }); }
  try {
    return Response.json(await evaluateOpenAI(buildRequest(chess).req, { signal: request.signal }));
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("GPT-6-Luna")
      ? error.message : "GPT-6-Luna request failed or timed out";
    return new Response(message, { status: 502 });
  }
}
