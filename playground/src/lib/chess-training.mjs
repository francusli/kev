import { compactPositionState } from "./chess-request.mjs";

// The game result chooses a side. A drawn game uses the last pre-move position
// evaluation only when it confidently favors one side.
export function trainingSide(game, minConfidence = 0.8) {
  if (game.result?.startsWith("1-0")) return "white";
  if (game.result?.startsWith("0-1")) return "black";
  if (!/^(½-½|1\/2-1\/2)/.test(game.result ?? "")) return null;

  const last = [...game.moves].reverse().find(({ model }) => model?.evalProbabilities);
  if (!last) return null;
  const probabilities = last.model.evalProbabilities;
  if (![0, 1, 2, 3, 4].every((n) => Number.isFinite(probabilities[String(n)]))) return null;
  const level = [0, 1, 2, 3, 4].reduce((best, n) =>
    (probabilities[String(n)] ?? 0) > (probabilities[String(best)] ?? 0) ? n : best, 0);
  const confidence = last.model.evalConfidence ?? probabilities[String(level)];
  if (!Number.isFinite(confidence) || confidence < minConfidence || level === 2) return null;
  return level < 2 ? "black" : "white";
}

export function trainingRecords(game, minConfidence = 0.8) {
  const side = trainingSide(game, minConfidence);
  if (!side) return [];
  return game.moves.flatMap(({ san, model }) => {
    const request = model?.trace?.request;
    if (request?.state?.side_to_move?.toLowerCase() !== side) return [];
    const move = request.questions?.move;
    if (!move || !Object.hasOwn(move.criteria ?? {}, san)) throw new Error(`Missing Choice trace for ${san}`);
    return [{ state: compactPositionState(request.state), questions: { move: { ...move, label: san } } }];
  });
}
