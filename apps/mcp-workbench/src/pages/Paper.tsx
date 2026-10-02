import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { connectMcp } from "../api/mcp";

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await connectMcp("/mcp");
  const result = await client.callTool({ name, arguments: args });
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

export function PaperPage() {
  const [output, setOutput] = useState("");
  const status = useQuery({
    queryKey: ["paper-status"],
    queryFn: () => callTool("indodax_paper_status", {}),
  });

  async function placeDemo(): Promise<void> {
    const placed = await callTool("indodax_paper_order", {
      pair: "btc_idr",
      side: "BUY",
      price: 1000,
      quantity: 100,
    });
    setOutput(placed);
    await status.refetch();
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Paper trading</h1>
      <p className="text-sm text-gray-600">Simulation only. Never touches real money.</p>
      <button type="button" className="border px-4 py-2" onClick={() => void placeDemo()}>
        Place demo paper order
      </button>
      {output && <pre className="text-sm">{output}</pre>}
      {status.data && <pre className="text-sm">{status.data}</pre>}
    </div>
  );
}
