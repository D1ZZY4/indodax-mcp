# @indodax-mcp/mcp-workbench

React workbench for browsing and invoking INDODAX MCP tools from a browser. It
lists the registered tools, shows health, and runs paper simulations against a
running MCP endpoint.

## What this package is

The built static assets (`dist/`): an `index.html` and its bundled JavaScript
and CSS. There is no server entry point and no importable API. To run it, serve
the contents of `dist/` from any static host, or use the development server
from the repository.

```bash
bun run dev:workbench
```

## Connecting

The workbench expects an MCP endpoint on the same origin at `/mcp`. Point it at
a running gateway:

```bash
MCP_HTTP_PORT=8080 bunx @indodax-mcp/mcp-http
```

## Safety

The workbench invokes tools through the same server, so paper-only tools can
only simulate. Anything live-capable remains behind the server's own risk
review and acknowledgement gate; the browser adds no privilege.

## License

SSPL-1.0. See the `LICENSE` file in the repository root.