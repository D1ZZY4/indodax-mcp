# ADR-010: Deadman-gated live safety

* Status: accepted.
* Decision: the Deadman Switch is a first-class state machine
  (DISARMED, ARMED, STALE, EXPIRED) with official 10 req/10s/IP
  limits. Unknown or expired Deadman denies new live trading;
  paper never touches the exchange Deadman endpoint.
* Rationale: autonomous live trading must fail closed when its
  safety heartbeat is unverifiable.
* Consequence: risk checks Deadman state for live contexts only.
