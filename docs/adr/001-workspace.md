# ADR-001: Workspace boundaries

* Status: accepted.
* Decision: split exchange I/O (`auth`, `transport`, `rate-limit`, `api`,
  `websocket`) from domain (`core`, `order`, `risk`, `portfolio`) and from
  interfaces (`mcp`, `gateway`, `cli`, `daemon`).
* Consequence: risk and execution stay callable without MCP or network.
