import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { buildRequest, chessFromHistory } from "../src/lib/chess-request.mjs";
import { evaluateOpenAI } from "../src/lib/chess-openai.mjs";
import { options, playGame } from "./chess-traces.mjs";

function completed(answer) {
  return { status: "completed", id: "resp_test", model: "gpt-6-luna",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
    usage: { input_tokens: 150, output_tokens: 80 } };
}

test("hosted players reject invalid, illegal, oversized, and finished histories", () => {
  for (const moves of [null, {}, [1], ["x".repeat(17)], Array(251).fill("e4")]) {
    assert.throws(() => chessFromHistory(moves), /Invalid move history/);
  }
  assert.throws(() => chessFromHistory(["e5"]), /Illegal move history/);
  assert.throws(() => chessFromHistory(["f3", "e5", "g4", "Qh4#"]), /Game is over/);
  assert.equal(chessFromHistory(["e4"]).turn(), "b");
});

test("adapts structured output to Choice/Score and preserves provenance", async (t) => {
  const { req } = buildRequest(new Chess());
  const answer = { move: Object.fromEntries(Object.keys(req.questions.move.criteria).map(key => [key, key === "e4" ? 0.7 : key === "d4" ? 0.3 : 0])),
    evaluation: { 0: 0, 1: 0.1, 2: 0.6, 3: 0.3, 4: 0 } };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.reasoning.effort, "medium");
    assert.equal(body.store, false);
    assert.deepEqual(JSON.parse(body.input), { state: req.state, questions: req.questions });
    assert.deepEqual(body.text.format.schema.properties.move.required, Object.keys(answer.move));
    assert.equal(body.text.format.strict, true);
    return Response.json(completed(answer));
  });
  const result = await evaluateOpenAI(req, { apiKey: "test" });
  assert.equal(result.answers.move.choice, "e4");
  assert.equal(result.answers.move.confidence, 0.7);
  assert.ok(Math.abs(result.answers.evaluation.score - 2.2) < 1e-12);
  assert.equal(result.answers.evaluation.legend["4"], "White is clearly winning");
  assert.equal(result.probability_source, "generated_estimates");
  assert.equal(result.response_id, "resp_test");
  assert.deepEqual(result.usage, { input_tokens: 150, output_tokens: 80 });
});

test("rejects missing, illegal, negative, and zero-mass move probabilities", async (t) => {
  const req = { questions: { move: { criteria: { e4: "", d4: "" } }, evaluation: { criteria: ["equal"] } } };
  for (const move of [{ e4: 1 }, { e4: 1, illegal: 0 }, { e4: -1, d4: 2 }, { e4: 0, d4: 0 }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(completed({ move, evaluation: { 0: 1 } })));
    await assert.rejects(evaluateOpenAI(req, { apiKey: "test" }), /distribution|no mass/);
    t.mock.restoreAll();
  }
});

test("normalizes estimates and retains the original generated values", async (t) => {
  const req = { questions: { move: { criteria: { e4: "", d4: "" } }, evaluation: { criteria: ["equal"] } } };
  const answer = { move: { e4: 0.6, d4: 0.6 }, evaluation: { 0: 0.9 } };
  t.mock.method(globalThis, "fetch", async () => Response.json(completed(answer)));
  const result = await evaluateOpenAI(req, { apiKey: "test" });
  assert.deepEqual(result.answers.move.probabilities, { e4: 0.5, d4: 0.5 });
  assert.deepEqual(result.answers.evaluation.probabilities, { 0: 1 });
  assert.deepEqual(result.generated_probabilities, answer);
});

test("fails closed on refusal, truncation, malformed output, and access errors", async (t) => {
  const { req } = buildRequest(new Chess());
  for (const result of [{ status: "incomplete" }, { status: "completed", output: [] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    await assert.rejects(evaluateOpenAI(req, { apiKey: "test" }), /incomplete|valid chess answer|declined/);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("private upstream error", { status: 401 }));
  await assert.rejects(evaluateOpenAI(req, { apiKey: "test" }), /authentication failed \(401\)/);
  await assert.rejects(evaluateOpenAI(req, { apiKey: "" }), /not configured/);
});

test("Luna trace runner uses the same adapter and stores the full response", async (t) => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";
  t.after(() => { if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
  const sequence = ["f3", "e5", "g4", "Qh4#"];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const req = JSON.parse(JSON.parse(init.body).input);
    const action = sequence[calls++];
    return Response.json(completed({ move: Object.fromEntries(Object.keys(req.questions.move.criteria).map(key => [key, Number(key === action)])),
      evaluation: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 } }));
  });
  const game = await playGame("unused", 10, { id: "gpt-6-luna" });
  assert.equal(game.result, "0-1");
  assert.deepEqual(game.positions.map(p => p.action), sequence);
  for (const p of game.positions) {
    assert.equal(p.request.model, "gpt-6-luna");
    assert.equal(p.response.probability_source, "generated_estimates");
    assert.equal(p.response.usage.output_tokens, 80);
    assert.equal(p.selection, "sample");
  }
  assert.equal(options(["--model", "gpt-6-luna"]).model, "gpt-6-luna");
  assert.throws(() => options(["--model", "unknown"]), /model must/);
});
