import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("saves each game as JSON and keeps the latest 20", async () => {
  const root = await mkdtemp(join(tmpdir(), "kev-chess-games-"));
  const original = process.cwd();
  await mkdir(join(root, "playground"));
  process.chdir(join(root, "playground"));
  try {
    const { GET, PUT } = await import("../src/app/api/chess/games/route.ts");
    for (let i = 0; i < 21; i++) {
      const game = { id: `game-${i}`, startedAt: i, players: { white: "kev", black: "kev" }, pgn: "", moves: [] };
      const response = await PUT(new Request("http://localhost/api/chess/games", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(game),
      }));
      assert.equal(response.status, 204);
    }
    const games = await (await GET()).json();
    assert.equal(games.length, 20);
    assert.equal(games[0].id, "game-1");
    assert.equal(games.at(-1).id, "game-20");
    const directory = join(root, "runs/chess-games");
    assert.deepEqual(await readdir(directory), games.map((game) => `${game.id}.json`).sort());
    assert.deepEqual(JSON.parse(await readFile(join(directory, "game-20.json"), "utf8")), games.at(-1));

    const finished = { ...games.at(-1), result: "1-0 (checkmate)", moves: [{ san: "e4", by: "kev", model: {
      trace: { request: { state: { side_to_move: "White" }, questions: { move: {
        type: "choice", instructions: "Choose a move", criteria: { e4: "pawn e2 to e4" },
      } } } },
    } }] };
    assert.equal((await PUT(new Request("http://localhost/api/chess/games", {
      method: "PUT", body: JSON.stringify(finished),
    }))).status, 204);
    const trainingDirectory = join(directory, "training");
    const training = join(trainingDirectory, "game-20.train.jsonl");
    const rows = (await readFile(training, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].questions.move.label, "e4");
    assert.equal((await PUT(new Request("http://localhost/api/chess/games", {
      method: "PUT", body: JSON.stringify({ ...finished, result: undefined }),
    }))).status, 204);
    assert.equal((await readdir(trainingDirectory)).includes("game-20.train.jsonl"), false);

    const invalid = await PUT(new Request("http://localhost/api/chess/games", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "../outside", startedAt: 1, moves: [] }),
    }));
    assert.equal(invalid.status, 400);
  } finally {
    process.chdir(original);
    await rm(root, { recursive: true, force: true });
  }
});
