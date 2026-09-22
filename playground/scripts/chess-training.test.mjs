import assert from "node:assert/strict";
import { test } from "node:test";
import { trainingRecords, trainingSide } from "../src/lib/chess-training.mjs";
import { compactPositionState, positionState } from "../src/lib/chess-request.mjs";
import { Chess } from "chess.js";

const move = (side, san, level, confidence) => ({
  san,
  model: {
    evalConfidence: confidence,
    evalProbabilities: Object.fromEntries([0, 1, 2, 3, 4].map((n) => [n, n === level ? confidence : (1 - confidence) / 4])),
    trace: { request: { state: { side_to_move: side }, questions: { move: {
      type: "choice", instructions: "Choose a move", criteria: { [san]: "legal move" },
    } } } },
  },
});

test("exports the selected side's moves as labelled Choice records", () => {
  const game = { result: "1-0 (checkmate)", moves: [move("White", "e4", 2, 0.9), move("Black", "e5", 2, 0.9)] };
  assert.equal(trainingSide(game), "white");
  assert.deepEqual(trainingRecords(game), [{ state: { side_to_move: "White" }, questions: { move: {
    type: "choice", instructions: "Choose a move", criteria: { e4: "legal move" }, label: "e4",
  } } }]);
});

test("draws use the final logged evaluation and confidence threshold", () => {
  const game = { result: "½-½ (repetition)", moves: [move("Black", "e5", 1, 0.9), move("White", "Nf3", 4, 0.945)] };
  assert.equal(trainingSide(game), "white");
  assert.equal(trainingRecords(game).length, 1);
  assert.equal(trainingSide({ ...game, moves: [move("White", "Nf3", 4, 0.6)] }), null);
  assert.equal(trainingSide({ ...game, moves: [move("White", "Nf3", 2, 0.95)] }), null);
});

test("old exports and live positions use the same bounded history without changing traces", () => {
  const chess = new Chess();
  for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1"]) chess.move(san);
  const state = positionState(chess);
  assert.equal(state.recent_moves, "3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1");
  assert.equal(state.fen, chess.fen());
  assert.equal(state.board, chess.ascii());
  const legacy = { ...state, moves_so_far: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1" };
  delete legacy.recent_moves;
  const row = move("Black", "b5", 2, 0.9);
  row.model.trace.request.state = legacy;
  assert.deepEqual(trainingRecords({ result: "0-1", moves: [row] })[0].state, state);
  assert.ok(legacy.moves_so_far.startsWith("1. e4"));
  assert.deepEqual(compactPositionState(state), state);
  assert.equal(positionState(new Chess()).recent_moves, "(game start)");
});
