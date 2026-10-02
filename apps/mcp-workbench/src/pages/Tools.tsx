import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { connectMcp } from "../api/mcp";

const URL = "/mcp";

export function ToolsPage() {
  const [selected, setSelected] = useState("indodax_health");
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const toolsQuery = useQuery({
    queryKey: ["tools"],
    queryFn: async () => {
      const client = await connectMcp(URL);
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name);
    },
  });

  async function invoke(): Promise<void> {
    setError("");
    setResult("");
    try {
      const client = await connectMcp(URL);
      const parsed: Record<string, unknown> = JSON.parse(argsText) as Record<string, unknown>;
      const outcome = await client.callTool({ name: selected, arguments: parsed });
      setResult(JSON.stringify(outcome, null, 2));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">MCP tools</h1>
      {toolsQuery.isLoading && <p>Loading tools…</p>}
      {toolsQuery.isError && (
        <p className="text-red-600">Connection failed. Start mcp-http first.</p>
      )}
      <div className="flex gap-4">
        <select
          className="border p-2"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {(toolsQuery.data ?? ["indodax_health"]).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          className="border p-2 flex-1"
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
        />
        <button type="button" className="border px-4" onClick={() => void invoke()}>
          Invoke
        </button>
      </div>
      {error && <pre className="text-red-600 text-sm">{error}</pre>}
      {result && <pre className="text-sm whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}
