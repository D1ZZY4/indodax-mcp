# Source references

Canonical upstream references used for exchange behavior corrections in v2.
Do not invent endpoints or signing behavior outside these sources.

## Context7 library docs

- `https://context7.com/btcid/indodax-official-api-docs/llms.txt?tokens=100000`
- Distilled API docs: public REST, TAPI v1, TradeAPI v2, deadman switch,
  market and private WebSocket, error envelopes, curl and PHP examples.
- Used for: HMAC-SHA256 for TAPI v2, v2 `{code, msg}` envelope handling,
  transHistory 7-day window, WS auth and ping shapes.

## Official API docs repository

- `https://github.com/btcid/indodax-official-api-docs`
- Upstream repo backing the Context7 library above. Consult for full
  endpoint details, changelog, and new TradeAPI revisions.
- DeepWiki has no index for this repo (checked 2026-10-01), so the
  GitHub repo and Context7 text remain the sources of truth.
