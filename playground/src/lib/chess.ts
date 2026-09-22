// Chess via the decision model: legal moves become the options of one Choice question,
// the position (board, FEN, history) is the state. A Score question rates the position in the same pass.
import { Chess, type Move } from "chess.js";
import { api, type SystemOneRequest, type SystemOneResponse } from "@/lib/kev";
import { describeMove as describeMoveShared, positionState as positionStateShared, buildRequest as buildRequestShared } from "./chess-request.mjs";
export { PIECE_NAMES, EVAL_LEVELS } from "./chess-request.mjs";

export const describeMove = describeMoveShared as (m: Move) => string;
export const positionState = positionStateShared as (chess: Chess) => ReturnType<typeof positionStateShared>;
export const buildRequest = buildRequestShared as (chess: Chess) => { req: SystemOneRequest; legal: Move[] };

export type ModelMove = {
  san: string;
  probabilities: Record<string, number>;
  confidence: number;
  evaluation: number; // expected level 0..4
  evalConfidence?: number; // absent in games saved by older versions
  evalProbabilities: Record<string, number>;
  latency_ms: number;
  input_tokens: number;
  n_legal: number;
  trace?: { request: SystemOneRequest; response: SystemOneResponse; selection: "sample" | "argmax"; action: string };
};

export type Player = "human" | "kev" | "jev" | "gpt-6-luna";
export type Players = { white: Player; black: Player };

export async function askModel(chess: Chess, player: Exclude<Player, "human">, sample = false): Promise<ModelMove> {
  const { req, legal } = buildRequest(chess);
  if (player !== "kev") req.model = player === "jev" ? "typesafe-ai/jev" : player;
  const r: SystemOneResponse = player === "kev" ? await api.systemOne(req)
    : await api.chess(player === "jev" ? "jev" : "openai", chess.history());
  const a = r.answers.move;
  const e = r.answers.evaluation;
  if (a.type !== "choice" || e.type !== "score") throw new Error("unexpected answer types");
  let san = a.choice;
  if (sample) {
    let u = Math.random();
    for (const [k, p] of Object.entries(a.probabilities)) { u -= p; if (u <= 0) { san = k; break; } }
  }
  if (!legal.some((m) => m.san === san)) throw new Error(`model returned ${JSON.stringify(san)}, which is not a legal move here`);
  return { san, probabilities: a.probabilities, confidence: a.confidence, evaluation: e.score, evalConfidence: e.confidence, evalProbabilities: e.probabilities, latency_ms: r.latency_ms, input_tokens: r.usage.input_tokens, n_legal: legal.length,
    trace: { request: req, response: r, selection: sample ? "sample" : "argmax", action: san } };
}

// ---- persistence -------------------------------------------------------------------------------

type Mode = "self" | "white" | "black"; // games saved before player selection existed

function legacyPlayers(mode: Mode | undefined): Players {
  if (mode === "white") return { white: "human", black: "kev" };
  if (mode === "black") return { white: "kev", black: "human" };
  return { white: "kev", black: "kev" };
}

export type SavedGame = {
  id: string;
  startedAt: number;
  players: Players;
  mode?: Mode;
  pgn: string;
  moves: { san: string; by: Player | "model"; model?: ModelMove }[];
  result?: string;
};

const KEY = "kev.chess.v1";

// Replays a game's moves, stopping at the first one that is not legal in its position (chess.js throws on illegal SAN).
export function replay(moves: SavedGame["moves"]): { chess: Chess; moves: SavedGame["moves"] } {
  const chess = new Chess();
  const ok: SavedGame["moves"] = [];
  for (const m of moves) {
    try { chess.move(m.san); ok.push(m); } catch { break; }
  }
  return { chess, moves: ok };
}

// The legal move `san` in the position after `game`, or undefined if it is not legal there.
export function legalMove(game: SavedGame, san: string): Move | undefined {
  return replay(game.moves).chess.moves({ verbose: true }).find((m) => m.san === san);
}

export function loadLegacyGames(): SavedGame[] {
  if (typeof window === "undefined") return [];
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  // stored games are untrusted: keep only the legal prefix of each move list so the board and the list agree
  return raw.filter((g): g is SavedGame => !!g && typeof g.id === "string" && Array.isArray(g.moves)).map((g) => {
    const { chess, moves } = replay(g.moves);
    const players = g.players && [g.players.white, g.players.black].every((p) => p === "human" || p === "kev" || p === "jev" || p === "gpt-6-luna")
      ? g.players : legacyPlayers(g.mode);
    return { ...g, players, moves, pgn: chess.pgn(), result: moves.length === g.moves.length ? g.result : resultText(chess) };
  });
}

export function clearLegacyGames() {
  localStorage.removeItem(KEY);
}

export async function loadGames(): Promise<SavedGame[]> {
  const response = await fetch("/api/chess/games", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load chess games (${response.status})`);
  return response.json();
}

export async function saveGame(game: SavedGame): Promise<void> {
  const response = await fetch("/api/chess/games", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(game),
  });
  if (!response.ok) throw new Error(`Could not save chess game (${response.status})`);
}

export function resultText(chess: Chess): string | undefined {
  if (!chess.isGameOver()) return undefined;
  if (chess.isCheckmate()) return chess.turn() === "w" ? "0-1 (checkmate)" : "1-0 (checkmate)";
  if (chess.isStalemate()) return "½-½ (stalemate)";
  if (chess.isThreefoldRepetition()) return "½-½ (repetition)";
  if (chess.isInsufficientMaterial()) return "½-½ (insufficient material)";
  if (chess.isDrawByFiftyMoves()) return "½-½ (fifty-move rule)";
  return "½-½ (draw)";
}
