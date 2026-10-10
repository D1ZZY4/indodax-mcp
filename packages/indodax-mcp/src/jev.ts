/**
 * Optional Jev decision signal for the strategy evaluation tool.
 *
 * Jev is a System One model: it evaluates a supplied state against typed
 * questions and returns values with probabilities, rather than generating
 * text. It is reached through the OpenCode Zen System One endpoint using the
 * free model `jev-1.13-free`.
 *
 * Scope and safety, stated plainly because this touches a trading surface:
 *
 * - It is **advisory only**. It annotates `indodax_strategy_evaluate`; it does
 *   not place, cancel, or arm anything, and it is not a gate.
 * - It can never turn a refusal into an approval. The deterministic risk
 *   engine, the central guard, mode and capability checks, per-call
 *   acknowledgement, and every idempotency and balance rule run independently
 *   and are unaffected by anything returned here.
 * - A missing credential, an unreachable endpoint, a timeout, a malformed
 *   body, or a low-confidence answer all degrade to "no opinion". None of them
 *   fail the tool, and none of them authorise an action.
 * - Only a summary of the already-public market series is sent. No key, secret,
 *   account identifier, order identifier, or balance is included.
 */

/** Endpoint documented for System One models. */
export const JEV_ENDPOINT = "https://opencode.ai/zen/v1/systemone";

/**
 * The free model, used so the advisory can never incur a charge. The paid
 * `jev-1.13` model exists and is deliberately not used; if the free model is
 * withdrawn the integration degrades to unavailable rather than silently
 * falling back to a billable one.
 */
export const JEV_MODEL = "jev-1.13-free";

/** Bounded so a slow advisory call cannot stall a tool response. */
const JEV_TIMEOUT_MS = 4_000;

export type JevQuestionType = "noul" | "choice" | "score";

export interface JevQuestion {
  type: JevQuestionType;
  instructions: string;
  /** Required for choice; a label to description map. */
  criteria?: Record<string, string>;
  /** Required for score; ordered rubric labels. */
  rubric?: string[];
}

export interface JevNoulAnswer {
  type: "noul";
  /** True is 1, false is 0, with the model's probability. */
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevScoreAnswer {
  type: "score";
  /** Index into the supplied rubric, normalized to 0..1. */
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevResponse {
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevRequest {
  state: string;
  questions: Record<string, JevQuestion>;
}

export interface JevAdvice {
  /** False whenever the call could not be made or trusted. */
  available: boolean;
  /** Why the advisory is missing, phrased for a tool response. */
  reason: string;
  /** Present only when the model answered every question it was asked. */
  verdict?:
    | {
        /** Model probability that the signal deserves human attention, 0..1. */
        confidence: number;
        /** Model choice between `needs_review` and `routine`, when answered. */
        classification?: string | undefined;
        /** Model rubric score, normalized 0..1, when answered. */
        momentum?: number | undefined;
        /** True only when every supplied answer cleared the confidence floor. */
        highConfidence: boolean;
      }
    | undefined;
  model: string;
}

export interface JevOptions {
  /** Credential for OpenCode Zen. Absent means the advisory stays off. */
  apiKey?: string | undefined;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
}

/** Answers below this are treated as low confidence and reported as such. */
const CONFIDENCE_FLOOR = 0.6;

/**
 * Credential for the advisory, read from the process environment.
 *
 * Deliberately not part of the typed configuration schema: it is an optional
 * external advisory credential with no effect on trading, so it is not parsed,
 * validated, echoed by indodax_config_status, or reported in configSource.
 * That keeps the server's credential provenance reporting limited to the
 * exchange key pair, which is what an operator auditing trading access needs.
 */
export function jevApiKey(): string | undefined {
  return process.env.OPENCODE_API_KEY;
}

function unavailable(reason: string, model: string): JevAdvice {
  return { available: false, reason, model };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate the response against the documented contract.
 *
 * The model is external and its output is untrusted input. Anything missing,
 * mistyped, or out of range is discarded rather than coerced, because a
 * confidently mis-parsed advisory is worse than no advisory.
 */
function parseResponse(payload: unknown): Record<string, JevAnswer> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const answers = (payload as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return null;
  const out: Record<string, JevAnswer> = {};
  for (const [id, raw] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) return null;
    const answer = raw as Record<string, unknown>;
    if (answer.type === "noul") {
      if (!isFiniteNumber(answer.noul)) return null;
      out[id] = { type: "noul", noul: Math.min(1, Math.max(0, answer.noul)) };
      continue;
    }
    if (answer.type === "choice") {
      if (typeof answer.choice !== "string") return null;
      if (!isFiniteNumber(answer.confidence)) return null;
      out[id] = {
        type: "choice",
        choice: answer.choice,
        confidence: Math.min(1, Math.max(0, answer.confidence)),
      };
      continue;
    }
    if (answer.type === "score") {
      if (!isFiniteNumber(answer.score) || !isFiniteNumber(answer.confidence)) return null;
      out[id] = {
        type: "score",
        score: Math.min(1, Math.max(0, answer.score)),
        confidence: Math.min(1, Math.max(0, answer.confidence)),
      };
      continue;
    }
    // An unrecognized answer type means the contract moved; do not guess.
    return null;
  }
  return out;
}

/**
 * Ask the free Jev model for a bounded judgment.
 *
 * Never throws. Every failure mode returns an unavailable advisory so the
 * calling tool behaves exactly as it would with the feature switched off.
 */
export async function advise(request: JevRequest, options: JevOptions = {}): Promise<JevAdvice> {
  const model = options.model ?? JEV_MODEL;
  const endpoint = options.endpoint ?? JEV_ENDPOINT;
  const apiKey = options.apiKey;
  if (apiKey === undefined || apiKey === "") {
    return unavailable(
      "Jev advisory is off: set OPENCODE_API_KEY to enable it. This does not affect any risk, permission, or execution decision.",
      model,
    );
  }
  const doFetch = options.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? JEV_TIMEOUT_MS);
  try {
    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, state: request.state, questions: request.questions }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return unavailable(
        `Jev advisory unavailable: the endpoint answered HTTP ${response.status}. No decision was influenced.`,
        model,
      );
    }
    const payload: unknown = await response.json();
    const answers = parseResponse(payload);
    if (answers === null) {
      return unavailable(
        "Jev advisory unavailable: the response did not match the documented contract and was discarded. No decision was influenced.",
        model,
      );
    }
    return {
      available: true,
      reason: "Jev advisory returned.",
      model,
      verdict: summarize(answers),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return unavailable(
      aborted
        ? "Jev advisory timed out and was skipped. No decision was influenced."
        : "Jev advisory unavailable: the request failed and was skipped. No decision was influenced.",
      model,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reduce the individual answers to the fields the tool reports.
 *
 * Missing answers are omitted rather than defaulted, and the verdict is only
 * marked high confidence when every answer actually given cleared the floor.
 */
function summarize(answers: Record<string, JevAnswer>): JevAdvice["verdict"] {
  const confidence = answers.confidence;
  const classification = answers.classification;
  const momentum = answers.momentum;
  const given = [confidence, classification, momentum].filter((answer) => answer !== undefined);
  const highConfidence = (given as { confidence?: number }[]).every(
    (answer) => (answer.confidence ?? 1) >= CONFIDENCE_FLOOR,
  );
  return {
    confidence: confidence !== undefined && confidence.type === "noul" ? confidence.noul : 0,
    ...(classification !== undefined && classification.type === "choice"
      ? { classification: classification.choice }
      : {}),
    ...(momentum !== undefined && momentum.type === "score" ? { momentum: momentum.score } : {}),
    highConfidence,
  };
}
