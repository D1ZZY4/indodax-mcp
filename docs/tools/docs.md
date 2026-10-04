<h1 align="center">Docs tool</h1>

The `indodax_docs` tool serves these guide pages to agent harnesses at
runtime, so instructions stay identical between the repository and the MCP.

| Tool | Parameters | Response `data` | Notes |
| --- | --- | --- | --- |
| `indodax_docs` | `page`? one of the area names below | `{ page, markdown }` or the index when omitted | Unknown pages are a `ValidationError` listing valid pages. Pages resolve from an allowlist only; no path input ever reaches the filesystem. |

Pages: `market`, `account`, `orders`, `paper`, `portfolio`, `risk`,
`strategy`, `alerts`, `reconcile`, `audit`, `system`, `funding`, `history`,
`ops`, `deadman`, `stops`, `docs`. See [README](README.md) for the tool
tables behind each page.
