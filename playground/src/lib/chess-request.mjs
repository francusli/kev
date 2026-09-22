import { Chess } from "chess.js";

export const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const EVAL_LEVELS = ["Black is clearly winning", "Black is better", "Roughly equal", "White is better", "White is clearly winning"];

// Hosted players accept history only; derive the board and legal options on the server.
export function chessFromHistory(moves) {
  if (!Array.isArray(moves) || moves.length > 250 || !moves.every(m => typeof m === "string" && m.length <= 16)) {
    throw new Error("Invalid move history");
  }
  const chess = new Chess();
  try { for (const move of moves) chess.move(move); } catch { throw new Error("Illegal move history"); }
  if (chess.isGameOver()) throw new Error("Game is over");
  return chess;
}

export function describeMove(m) {
  const parts = [`${PIECE_NAMES[m.piece]} ${m.from} to ${m.to}`];
  if (m.captured) parts.push(`captures ${PIECE_NAMES[m.captured]}`);
  if (m.promotion) parts.push(`promotes to ${PIECE_NAMES[m.promotion]}`);
  if (m.flags.includes("k") || m.flags.includes("q")) parts[0] = m.flags.includes("k") ? "castles kingside" : "castles queenside";
  if (m.san.endsWith("#")) parts.push("checkmate");
  else if (m.san.endsWith("+")) parts.push("gives check");
  return parts.join(", ");
}

// Keep history bounded for Kev's training context; the board and FEN remain complete.
export function compactPositionState(state) {
  if (typeof state?.moves_so_far !== "string") return state;
  const { moves_so_far, ...position } = state;
  return { ...position, recent_moves: moves_so_far.split(/(?=\b\d+\.\s)/).slice(-4).join("").trim() };
}

export function positionState(chess) {
  const side = chess.turn() === "w" ? "White" : "Black";
  const history = chess.history();
  const moves = history.length ? history.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join(" ") : "(game start)";
  return compactPositionState({
    game: "chess",
    side_to_move: side,
    board: chess.ascii(),
    fen: chess.fen(),
    moves_so_far: moves,
    in_check: chess.inCheck(),
  });
}

/** @returns {{ req: import("./kev").SystemOneRequest, legal: import("chess.js").Move[] }} */
export function buildRequest(chess) {
  const legal = chess.moves({ verbose: true });
  const side = chess.turn() === "w" ? "White" : "Black";
  const criteria = {};
  for (const m of legal) criteria[m.san] = describeMove(m);
  return {
    legal,
    req: {
      state: positionState(chess),
      model: "kev-latest",
      questions: {
        move: {
          type: "choice",
          instructions: `You are playing ${side}. Choose the best legal move for ${side} in this position. Prefer captures of undefended pieces, checks that win material, and moves that develop pieces toward the center.`,
          criteria,
        },
        evaluation: {
          type: "score",
          instructions: "Who is better in this position, before the move is played?",
          criteria: EVAL_LEVELS,
        },
      },
    },
  };
}
