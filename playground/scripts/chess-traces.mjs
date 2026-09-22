import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { buildRequest } from "../src/lib/chess-request.mjs";

function options(argv) {
  const args = { api: "http://127.0.0.1:8009", games: 1, maxPlies: 200, out: "../runs/chess-traces.jsonl" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key || !Object.hasOwn(args, key) || argv[i + 1] === undefined) {
      throw new Error("Usage: node scripts/chess-traces.mjs [--api URL] [--games N] [--maxPlies N] [--out PATH]");
    }
    args[key] = argv[i + 1];
  }
  for (const key of ["games", "maxPlies"]) {
    args[key] = Number(args[key]);
    if (!Number.isSafeInteger(args[key]) || args[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  args.api = new URL(args.api).href.replace(/\/$/, "");
  return args;
}

function sampleMove(probabilities, legal, random = Math.random) {
  const weights = legal.map(({ san }) => {
    const p = probabilities[san];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) throw new Error(`invalid probability for ${san}`);
    return p;
  });
  const total = weights.reduce((sum, p) => sum + p, 0);
  if (total <= 0) throw new Error("move probabilities have no mass");
  let draw = random() * total;
  for (let i = 0; i < legal.length; i++) {
    draw -= weights[i];
    if (draw < 0) return legal[i].san;
  }
  return legal.at(-1).san;
}

async function getJSON(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function playGame(api, maxPlies, model) {
  const chess = new Chess();
  const positions = [];
  while (!chess.isGameOver() && positions.length < maxPlies) {
    const { req, legal } = buildRequest(chess);
    const response = await getJSON(`${api}/v1/systemone`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
    });
    const move = response.answers?.move;
    const evaluation = response.answers?.evaluation;
    if (move?.type !== "choice" || evaluation?.type !== "score" || !move.probabilities) {
      throw new Error("API response lacks a move distribution or evaluation");
    }
    const action = sampleMove(move.probabilities, legal);
    positions.push({ ply: positions.length, fen: chess.fen(), side: chess.turn(), request: req,
      probabilities: move.probabilities, evaluation: evaluation.probabilities, action,
      latency_ms: response.latency_ms, input_tokens: response.usage?.input_tokens });
    chess.move(action);
  }
  return { id: randomUUID(), model, complete: chess.isGameOver(), result: chess.isGameOver() ? chess.isCheckmate()
    ? (chess.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2" : null,
    termination: chess.isGameOver() ? chess.isCheckmate() ? "checkmate" : "draw" : "max_plies",
    pgn: chess.pgn(), positions };
}

async function main() {
  const args = options(process.argv.slice(2));
  const models = await getJSON(`${args.api}/v1/models`);
  const model = models.models?.[0];
  if (!model) throw new Error("API returned no model metadata");
  const path = resolve(args.out);
  await mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path, { flags: "a", encoding: "utf8" });
  try {
    for (let i = 0; i < args.games; i++) {
      const game = await playGame(args.api, args.maxPlies, model);
      await new Promise((resolve, reject) => output.write(`${JSON.stringify(game)}\n`, error => error ? reject(error) : resolve()));
      process.stderr.write(`game ${i + 1}/${args.games}: ${game.result ?? "unfinished"} in ${game.positions.length} plies\n`);
    }
  } finally {
    output.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

export { options, sampleMove, playGame };
