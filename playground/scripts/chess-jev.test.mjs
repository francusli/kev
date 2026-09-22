import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { buildRequest } from "../src/lib/chess-request.mjs";
import { evaluateJev } from "../src/lib/chess-jev.mjs";
import { options } from "./chess-traces.mjs";

test("accepts a Jev versus Luna headless matchup", () => {
  const args = options(["--white", "jev", "--black", "gpt-6-luna", "--games", "100", "--concurrency", "16"]);
  assert.equal(args.white, "jev");
  assert.equal(args.black, "gpt-6-luna");
  assert.equal(args.concurrency, 16);
});

test("Jev uses the same Choice and Score request as the browser", async () => {
  const originalKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test";
  try {
    const { req, legal } = buildRequest(new Chess());
    const response = await evaluateJev(req, legal, async input => {
      assert.equal(input.model, "typesafe-ai/jev");
      assert.deepEqual(input.state, req.state);
      assert.deepEqual(input.questions, req.questions);
      return { answers: {
        move: { type: "choice", choice: "e4", probabilities: { e4: 1 } },
        evaluation: { type: "score", score: 2, probabilities: { "2": 1 } },
      }, usage: { inputTokens: 12, outputTokens: 3 } };
    });
    assert.equal(response.answers.move.choice, "e4");
    assert.deepEqual(response.usage, { input_tokens: 12, output_tokens: 3 });
  } finally {
    if (originalKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = originalKey;
  }
});
