import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { callTool } from "@indodax-mcp/mcp-workbench/api/mcp";

interface HealthData {
  status: string;
  components: Record<string, { status: string; detail?: string }>;
}

export function HealthPage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => callTool<HealthData>("indodax_health"),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Activity size={20} /> System health
      </h1>
      {health.isLoading && <p>Loading…</p>}
      {health.isError && (
        <p className="text-sm text-red-600">
          {health.error instanceof Error ? health.error.message : "health read failed"}
        </p>
      )}
      {health.data?.status === "error" && (
        <p className="text-sm text-red-600">
          {health.data.code ?? "Error"}: {health.data.message ?? "health read refused"}
        </p>
      )}
      {health.data?.status === "ok" && (
        <pre className="text-sm">{JSON.stringify(health.data.data, null, 2)}</pre>
      )}
    </div>
  );
}
