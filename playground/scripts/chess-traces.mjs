import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import { buildRequest } from "../src/lib/chess-request.mjs";
import { evaluateOpenAI, OPENAI_CHESS_MODEL } from "../src/lib/chess-openai.mjs";
import { evaluateJev, JEV_CHESS_MODEL } from "../src/lib/chess-jev.mjs";

function options(argv) {
  const args = { api: "http://127.0.0.1:8009", model: "kev", white: null, black: null, games: 1, concurrency: 1, maxPlies: 200, out: "../runs/chess-traces.jsonl" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key || !Object.hasOwn(args, key) || argv[i + 1] === undefined) {
      throw new Error("Usage: node scripts/chess-traces.mjs [--white kev|jev|gpt-6-luna] [--black kev|jev|gpt-6-luna] [--model kev|gpt-6-luna] [--api URL] [--games N] [--concurrency N] [--maxPlies N] [--out PATH]");
    }
    args[key] = argv[i + 1];
  }
  for (const key of ["games", "concurrency", "maxPlies"]) {
    args[key] = Number(args[key]);
    if (!Number.isSafeInteger(args[key]) || args[key] < 1) throw new Error(`${key} must be a positive integer`);
  }
  args.api = new URL(args.api).href.replace(/\/$/, "");
  if (!["kev", OPENAI_CHESS_MODEL].includes(args.model)) throw new Error("model must be kev or gpt-6-luna");
  for (const side of ["white", "black"]) {
    args[side] ??= args.model;
    if (!["kev", "jev", OPENAI_CHESS_MODEL].includes(args[side])) throw new Error(`${side} must be kev, jev, or gpt-6-luna`);
  }
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

async function playGame(api, maxPlies, model, blackModel = model) {
  const chess = new Chess();
  const positions = [];
  while (!chess.isGameOver() && positions.length < maxPlies) {
    const player = chess.turn() === "w" ? model : blackModel;
    const { req, legal } = buildRequest(chess);
    if (player.id === OPENAI_CHESS_MODEL || player.id === JEV_CHESS_MODEL) req.model = player.id;
    const response = player.id === OPENAI_CHESS_MODEL ? await evaluateOpenAI(req)
      : player.id === JEV_CHESS_MODEL ? await evaluateJev(req, legal) : await getJSON(`${api}/v1/systemone`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req),
    });
    const move = response.answers?.move;
    const evaluation = response.answers?.evaluation;
    if (move?.type !== "choice" || evaluation?.type !== "score" || !move.probabilities) {
      throw new Error("API response lacks a move distribution or evaluation");
    }
    const action = sampleMove(move.probabilities, legal);
    positions.push({ ply: positions.length, fen: chess.fen(), side: chess.turn(), request: req,
      response, selection: "sample", probabilities: move.probabilities, evaluation: evaluation.probabilities, action,
      latency_ms: response.latency_ms, input_tokens: response.usage?.input_tokens });
    chess.move(action);
  }
  return { id: randomUUID(), model: model === blackModel ? model : { white: model, black: blackModel },
    players: { white: model.id, black: blackModel.id }, complete: chess.isGameOver(), result: chess.isGameOver() ? chess.isCheckmate()
    ? (chess.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2" : null,
    termination: chess.isGameOver() ? chess.isCheckmate() ? "checkmate" : "draw" : "max_plies",
    pgn: chess.pgn(), positions };
}

async function runGames(count, concurrency, play, save) {
  let next = 0;
  let failed;
  async function worker() {
    while (next < count && !failed) {
      const index = next++;
      try {
        const game = await play(index);
        await save(game, index);
      } catch (error) {
        failed ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, worker));
  if (failed) throw failed;
}

async function main() {
  const args = options(process.argv.slice(2));
  // The CLI shares Next's env files; exported shell variables take precedence.
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(resolve(new URL("..", import.meta.url).pathname), true, { info() {}, error() {} });
  const kev = [args.white, args.black].includes("kev") ? (await getJSON(`${args.api}/v1/models`)).models?.[0] : null;
  if ([args.white, args.black].includes("kev") && !kev) throw new Error("API returned no model metadata");
  const playerModel = player => player === "kev" ? kev : { id: player === "jev" ? JEV_CHESS_MODEL : OPENAI_CHESS_MODEL };
  const white = playerModel(args.white);
  const black = playerModel(args.black);
  const path = resolve(args.out);
  await mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path, { flags: "a", encoding: "utf8" });
  try {
    await runGames(args.games, args.concurrency, () => playGame(args.api, args.maxPlies, white, black), async (game, i) => {
      await new Promise((resolve, reject) => output.write(`${JSON.stringify(game)}\n`, error => error ? reject(error) : resolve()));
      process.stderr.write(`game ${i + 1}/${args.games}: ${game.result ?? "unfinished"} in ${game.positions.length} plies\n`);
    });
  } finally {
    output.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

export { options, sampleMove, playGame, runGames };
