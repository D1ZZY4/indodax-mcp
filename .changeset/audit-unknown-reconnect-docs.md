---
"indodax-mcp": patch
"@indodax-mcp/cli": patch
---

Audit fixes: ambiguous live submit/cancel transport failures now surface as non-retryable unknown outcomes with the client order id preserved, market socket reconnect re-establishes the connection instead of only dropping it, failed connects reset socket state instead of sticking at reconnecting, CLI paper reset requires acknowledgement, and packed installs ship the agent guide pages so indodax_docs works outside the repo.
