import type { CancelState, ExecutionState } from "@indodax-mcp/core";

type Edge = readonly [ExecutionState, ExecutionState];

const LEGAL_EDGES: Edge[] = [
  ["NEW", "SUBMITTING"],
  ["SUBMITTING", "ACCEPTED"],
  ["SUBMITTING", "REJECTED"],
  ["SUBMITTING", "UNKNOWN"],
  ["UNKNOWN", "ACCEPTED"],
  ["UNKNOWN", "FILLED"],
  ["UNKNOWN", "REJECTED"],
  ["UNKNOWN", "RECONCILING"],
  ["RECONCILING", "RECONCILED"],
  ["RECONCILING", "ACCEPTED"],
  ["RECONCILING", "FILLED"],
  ["RECONCILING", "CANCELLED"],
  ["ACCEPTED", "PARTIALLY_FILLED"],
  ["ACCEPTED", "FILLED"],
  ["ACCEPTED", "CANCELLING"],
  ["PARTIALLY_FILLED", "FILLED"],
  ["PARTIALLY_FILLED", "CANCELLING"],
  ["CANCELLING", "CANCELLED"],
  ["CANCELLING", "FILLED"],
  ["CANCELLING", "UNKNOWN"],
  ["ACCEPTED", "RECONCILING"],
  ["PARTIALLY_FILLED", "RECONCILING"],
];

export class TransitionError extends Error {
  constructor(
    readonly from: ExecutionState,
    readonly to: ExecutionState,
  ) {
    super(`invalid transition from ${from} to ${to}`);
  }
}

export function isLegalTransition(from: ExecutionState, to: ExecutionState): boolean {
  return LEGAL_EDGES.some(([edgeFrom, edgeTo]) => edgeFrom === from && edgeTo === to);
}

export function transition(current: ExecutionState, to: ExecutionState): ExecutionState {
  if (!isLegalTransition(current, to)) throw new TransitionError(current, to);
  return to;
}

export function afterNetworkFailure(current: ExecutionState): ExecutionState {
  if (current === "SUBMITTING" || current === "CANCELLING") return "UNKNOWN";
  return current;
}

export function afterAmbiguousCancel(): CancelState {
  return "CANCEL_UNKNOWN";
}
