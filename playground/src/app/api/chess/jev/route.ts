import { buildRequest, chessFromHistory } from "@/lib/chess-request.mjs";
import { evaluateJev } from "@/lib/chess-jev.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) return new Response("AI_GATEWAY_API_KEY is not configured", { status: 503 });

  let moves: unknown;
  try { moves = (await request.json()).moves; } catch { return new Response("Invalid JSON", { status: 400 }); }
  let chess;
  try { chess = chessFromHistory(moves); } catch (error) { return new Response((error as Error).message, { status: 400 }); }

  try {
    const { req, legal } = buildRequest(chess);
    return Response.json(await evaluateJev(req, legal));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return new Response(status === 401 || status === 403 ? "Jev authentication failed" : "Jev request failed", { status: 502 });
  }
}
