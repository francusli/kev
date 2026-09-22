// Server/CLI adapter. The generated distributions are estimates, not token logprobs.
export const OPENAI_CHESS_MODEL = "gpt-6-luna";

function object(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function distribution(keys) {
  return object(Object.fromEntries(keys.map(key => [key, { type: "number", minimum: 0, maximum: 1 }])));
}

function normalize(value, keys) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key) || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1)) {
    throw new Error("GPT-6-Luna returned an invalid distribution");
  }
  const total = keys.reduce((sum, key) => sum + value[key], 0);
  if (total <= 0) throw new Error("GPT-6-Luna probabilities have no mass");
  return Object.fromEntries(keys.map(key => [key, value[key] / total]));
}

/**
 * @param {import("./kev").SystemOneRequest} request
 * @param {{ apiKey?: string, signal?: AbortSignal }} options
 */
export async function evaluateOpenAI(request, { apiKey = process.env.OPENAI_API_KEY, signal } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const moves = Object.keys(request.questions.move.criteria);
  const levels = request.questions.evaluation.criteria.map((_, i) => String(i));
  if (!moves.length) throw new Error("No legal moves");
  const started = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: OPENAI_CHESS_MODEL,
      store: false,
      reasoning: { effort: "medium" },
      max_output_tokens: 4096,
      instructions: "Answer the supplied chess Choice and Score questions. Return an estimated probability for every legal move and every evaluation level. Each distribution must sum to one. Evaluate the position before the move, using the supplied level order. These are your estimates, not token probabilities. Do not include explanations.",
      input: JSON.stringify({ state: request.state, questions: request.questions }),
      text: { format: { type: "json_schema", name: "chess_decision", strict: true,
        schema: object({ move: distribution(moves), evaluation: distribution(levels) }) } },
    }),
  });
  if (!response.ok) {
    const reason = response.status === 401 ? "authentication failed" : response.status === 403 || response.status === 404
      ? "model access unavailable" : response.status === 429 ? "rate limit or quota exceeded" : "request failed";
    throw new Error(`GPT-6-Luna ${reason} (${response.status})`);
  }
  const result = await response.json();
  if (result.status !== "completed") throw new Error("GPT-6-Luna response was incomplete");
  const content = (result.output ?? []).filter(item => item.type === "message").flatMap(item => item.content ?? []);
  if (content.some(item => item.type === "refusal")) throw new Error("GPT-6-Luna declined the chess request");
  const text = content.filter(item => item.type === "output_text").map(item => item.text).join("");
  let answer;
  try { answer = JSON.parse(text); } catch { throw new Error("GPT-6-Luna returned no valid chess answer"); }
  const probabilities = normalize(answer?.move, moves);
  const evaluation = normalize(answer?.evaluation, levels);
  const choice = moves.reduce((best, key) => probabilities[key] > probabilities[best] ? key : best);
  return {
    model: result.model ?? OPENAI_CHESS_MODEL,
    answers: {
      move: { type: "choice", choice, probabilities, confidence: probabilities[choice] },
      evaluation: { type: "score", score: levels.reduce((sum, key) => sum + Number(key) * evaluation[key], 0),
        probabilities: evaluation, confidence: Math.max(...Object.values(evaluation)),
        legend: Object.fromEntries(levels.map(key => [key, request.questions.evaluation.criteria[Number(key)]])) },
    },
    usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
    latency_ms: performance.now() - started,
    probability_source: "generated_estimates",
    generated_probabilities: { move: answer.move, evaluation: answer.evaluation },
    response_id: result.id,
  };
}
