import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SavedGame } from "@/lib/chess";
import { trainingRecords } from "../../../../lib/chess-training.mjs";

export const runtime = "nodejs";

const directory = resolve(process.cwd(), "../runs/chess-games");
const trainingDirectory = join(directory, "training");
const maxGames = 20;

async function files() {
  await mkdir(directory, { recursive: true });
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const entries = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(join(directory, name))).mtimeMs })));
  return entries.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name));
}

export async function GET() {
  try {
    const entries = await files();
    const games = await Promise.all(entries.map(async ({ name }) => JSON.parse(await readFile(join(directory, name), "utf8")) as SavedGame));
    return Response.json(games);
  } catch {
    return new Response("Could not read saved chess games", { status: 500 });
  }
}

export async function PUT(request: Request) {
  let game: SavedGame;
  try { game = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!game || typeof game.id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(game.id) ||
      !Number.isFinite(game.startedAt) || !Array.isArray(game.moves)) {
    return new Response("Invalid game", { status: 400 });
  }
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${game.id}.json`);
  const temporary = join(directory, `${game.id}.${randomUUID()}.tmp`);
  const training = join(trainingDirectory, `${game.id}.train.jsonl`);
  const trainingTemporary = join(trainingDirectory, `${game.id}.${randomUUID()}.train.tmp`);
  try {
    const records = trainingRecords(game);
    await writeFile(temporary, `${JSON.stringify(game)}\n`, "utf8");
    await rename(temporary, target);
    if (records.length) {
      await mkdir(trainingDirectory, { recursive: true });
      await writeFile(trainingTemporary, records.map((row: unknown) => JSON.stringify(row)).join("\n") + "\n", "utf8");
      await rename(trainingTemporary, training);
    } else {
      await unlink(training).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
    const old = (await files()).slice(0, -maxGames);
    await Promise.all(old.map(async ({ name }) => {
      await unlink(join(directory, name));
      await unlink(join(trainingDirectory, name.replace(/\.json$/, ".train.jsonl"))).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }));
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Could not save chess game", { status: 500 });
  } finally {
    await unlink(temporary).catch(() => {});
    await unlink(trainingTemporary).catch(() => {});
  }
}
