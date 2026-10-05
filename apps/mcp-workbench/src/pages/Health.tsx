import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { connectMcp } from "@indodax-mcp/mcp-workbench/api/mcp";

export function HealthPage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const client = await connectMcp("/mcp");
      const result = await client.callTool({ name: "indodax_health", arguments: {} });
      const text = result.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n");
      return JSON.parse(text) as { status: string; data: unknown };
    },
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Activity size={20} /> System health
      </h1>
      {health.isLoading && <p>Loading…</p>}
      {health.data && <pre className="text-sm">{JSON.stringify(health.data, null, 2)}</pre>}
    </div>
  );
}
