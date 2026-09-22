import assert from "node:assert/strict";
import { test } from "node:test";
import { options, playGame, runGames, sampleMove } from "./chess-traces.mjs";

test("accepts a bounded game concurrency", () => {
  assert.equal(options(["--games", "6", "--concurrency", "3"]).concurrency, 3);
  assert.throws(() => options(["--concurrency", "0"]), /positive integer/);
});

test("runs games concurrently and saves each result once", async () => {
  let active = 0;
  let peak = 0;
  const saved = [];
  await runGames(7, 3, async index => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return index;
  }, async (game, index) => { assert.equal(game, index); saved.push(index); });
  assert.equal(peak, 3);
  assert.deepEqual(saved.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test("samples only legal moves using the returned probabilities", () => {
  const legal = [{ san: "e4" }, { san: "d4" }];
  assert.equal(sampleMove({ e4: 0.25, d4: 0.75 }, legal, () => 0.1), "e4");
  assert.equal(sampleMove({ e4: 0.25, d4: 0.75 }, legal, () => 0.9), "d4");
  assert.throws(() => sampleMove({ e4: 1, d4: -1 }, legal), /invalid probability/);
});

test("records a complete game with the request at each position", async () => {
  const originalFetch = globalThis.fetch;
  const sequence = ["f3", "e5", "g4", "Qh4#"];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const action = sequence[calls++];
    assert.ok(Object.hasOwn(request.questions.move.criteria, action));
    return { ok: true, json: async () => ({ answers: {
      move: { type: "choice", probabilities: Object.fromEntries(Object.keys(request.questions.move.criteria).map(san => [san, Number(san === action)])) },
      evaluation: { type: "score", probabilities: { "0": 0, "1": 0, "2": 1, "3": 0, "4": 0 } },
    }, usage: { input_tokens: 100 }, latency_ms: 1 }) };
  };
  try {
    const game = await playGame("http://localhost:8009", 10, { run: "test-checkpoint" });
    assert.equal(calls, 4);
    assert.equal(game.result, "0-1");
    assert.equal(game.termination, "checkmate");
    assert.equal(game.complete, true);
    assert.deepEqual(game.positions.map(position => position.action), sequence);
    assert.equal(game.positions[0].request.state.fen, game.positions[0].fen);
    assert.equal(game.positions[0].side, "w");
    assert.equal(game.positions[1].side, "b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
