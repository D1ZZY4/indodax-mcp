/**
 * Contract tests for the optional Jev decision advisory.
 *
 * The model is external and its output is untrusted, so these tests cover the
 * paths that decide whether an answer is used at all: a well-formed response, a
 * malformed one, a transport failure, a timeout, and a missing credential. Every
 * failure must degrade to "no opinion" rather than propagating, because the
 * calling tool must behave identically whether or not the advisory ran.
 *
 * The fetch implementation is injected, so no test touches the network and no
 * test can place an order.
 */
import { describe, expect, it } from "vitest";
import { advise, JEV_MODEL } from "@indodax-mcp/mcp-app/jev";

const STATE = "pair btc_idr. signal side BUY. signal strength 0.5.";
const QUESTIONS = {
  confidence: { type: "noul" as const, instructions: "Is this strong?" },
  classification: {
    type: "choice" as const,
    instructions: "How should an operator treat it?",
    criteria: { needs_review: "Uncertain", routine: "Ordinary" },
  },
  momentum: {
    type: "score" as const,
    instructions: "How persistent is the direction?",
    rubric: ["Fading", "Stable", "Persistent"],
  },
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The exact shape the live endpoint returned during verification. */
const LIVE_SHAPED = {
  model: JEV_MODEL,
  answers: {
    confidence: { type: "noul", noul: 0.93 },
    classification: {
      type: "choice",
      choice: "routine",
      confidence: 0.81,
      probabilities: { routine: 0.81, needs_review: 0.19 },
    },
    momentum: {
      type: "score",
      score: 0.87,
      confidence: 0.76,
      legend: { "0": "Fading", "1": "Stable", "2": "Persistent" },
      probabilities: { "0": 0.04, "1": 0.09, "2": 0.87 },
    },
  },
  usage: { input_tokens: 400, output_tokens: 60 },
};

const OPTS = { apiKey: "test-key", endpoint: "https://example.invalid/systemone" };

describe("jev advisory contract", () => {
  it("reads a well-formed response into the reported verdict", async () => {
    const advice = await advise(
      { state: STATE, questions: QUESTIONS },
      { ...OPTS, fetchFn: async () => respond(LIVE_SHAPED) },
    );
    expect(advice.available).toBe(true);
    expect(advice.model).toBe(JEV_MODEL);
    expect(advice.verdict?.confidence).toBe(0.93);
    expect(advice.verdict?.classification).toBe("routine");
    expect(advice.verdict?.momentum).toBe(0.87);
    expect(advice.verdict?.highConfidence).toBe(true);
  });

  it("marks a low-confidence answer as such instead of presenting it as fact", async () => {
    const advice = await advise(
      { state: STATE, questions: QUESTIONS },
      {
        ...OPTS,
        fetchFn: async () =>
          respond({
            answers: { classification: { type: "choice", choice: "routine", confidence: 0.2 } },
          }),
      },
    );
    expect(advice.available).toBe(true);
    expect(advice.verdict?.highConfidence).toBe(false);
  });

  it("discards a response that does not match the documented contract", async () => {
    for (const body of [
      { answers: { confidence: { type: "noul", noul: "high" } } },
      { answers: { confidence: { type: "unknown", value: 1 } } },
      { answers: { classification: { type: "choice", choice: 7, confidence: 0.5 } } },
      { notAnswers: true },
      "a bare string",
      42,
    ]) {
      const advice = await advise(
        { state: STATE, questions: QUESTIONS },
        { ...OPTS, fetchFn: async () => respond(body) },
      );
      expect(advice.available, `should reject ${JSON.stringify(body)}`).toBe(false);
      expect(advice.reason).toContain("did not match the documented contract");
    }
  });

  it("reports a refusal without claiming any decision was influenced", async () => {
    const advice = await advise(
      { state: STATE, questions: QUESTIONS },
      { ...OPTS, fetchFn: async () => respond({ error: "unauthorized" }, 401) },
    );
    expect(advice.available).toBe(false);
    expect(advice.reason).toContain("HTTP 401");
    expect(advice.reason).toContain("No decision was influenced");
  });

  it("treats a transport failure and a timeout as no opinion", async () => {
    const failed = await advise(
      { state: STATE, questions: QUESTIONS },
      {
        ...OPTS,
        fetchFn: async () => {
          throw new Error("connection reset");
        },
      },
    );
    expect(failed.available).toBe(false);
    expect(failed.reason).toContain("request failed");

    const aborted = await advise(
      { state: STATE, questions: QUESTIONS },
      {
        ...OPTS,
        timeoutMs: 1,
        fetchFn: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      },
    );
    expect(aborted.available).toBe(false);
    expect(aborted.reason).toContain("timed out");
  });

  it("stays off without a credential and never reaches the network", async () => {
    let called = false;
    const advice = await advise(
      { state: STATE, questions: QUESTIONS },
      {
        endpoint: "https://example.invalid/systemone",
        fetchFn: async () => {
          called = true;
          return respond(LIVE_SHAPED);
        },
      },
    );
    expect(advice.available).toBe(false);
    expect(advice.reason).toContain("OPENCODE_API_KEY");
    expect(called).toBe(false);
  });

  it("only ever offers the free model, so the advisory cannot incur a charge", async () => {
    const advice = await advise({ state: STATE, questions: QUESTIONS }, OPTS);
    expect(advice.model).toBe(JEV_MODEL);
    expect(advice.model).toBe("jev-1.13-free");
  });

  it("clamps an out-of-range probability rather than passing it through", async () => {
    const advice = await advise(
      { state: STATE, questions: QUESTIONS },
      {
        ...OPTS,
        fetchFn: async () => respond({ answers: { confidence: { type: "noul", noul: 4.2 } } }),
      },
    );
    expect(advice.verdict?.confidence).toBe(1);
  });
});
