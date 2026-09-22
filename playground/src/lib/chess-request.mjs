export const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const EVAL_LEVELS = ["Black is clearly winning", "Black is better", "Roughly equal", "White is better", "White is clearly winning"];

export function describeMove(m) {
  const parts = [`${PIECE_NAMES[m.piece]} ${m.from} to ${m.to}`];
  if (m.captured) parts.push(`captures ${PIECE_NAMES[m.captured]}`);
  if (m.promotion) parts.push(`promotes to ${PIECE_NAMES[m.promotion]}`);
  if (m.flags.includes("k") || m.flags.includes("q")) parts[0] = m.flags.includes("k") ? "castles kingside" : "castles queenside";
  if (m.san.endsWith("#")) parts.push("checkmate");
  else if (m.san.endsWith("+")) parts.push("gives check");
  return parts.join(", ");
}

export function positionState(chess) {
  const side = chess.turn() === "w" ? "White" : "Black";
  const history = chess.history();
  const moves = history.length ? history.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m)).join(" ") : "(game start)";
  return {
    game: "chess",
    side_to_move: side,
    board: chess.ascii(),
    fen: chess.fen(),
    moves_so_far: moves,
    in_check: chess.inCheck(),
  };
}

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
