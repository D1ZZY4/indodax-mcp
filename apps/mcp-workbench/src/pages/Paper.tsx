import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { callTool } from "@indodax-mcp/mcp-workbench/api/mcp";

interface LedgerView {
  view: string;
  tradeCount: number;
  openOrders: number;
  filledOrders: number;
  totalFees: string;
  balances: Record<string, string>;
  summary: string;
}

/**
 * Reads `indodax_paper_ledger`, which absorbed the former
 * `indodax_paper_status` in 2.0.0. The default `status` view is the direct
 * replacement for the retired tool.
 */
export function PaperPage() {
  const [output, setOutput] = useState("");
  const status = useQuery({
    queryKey: ["paper-status"],
    queryFn: () => callTool<LedgerView>("indodax_paper_ledger", { view: "status" }),
  });

  async function placeDemo(): Promise<void> {
    const placed = await callTool("indodax_paper_order", {
      pair: "btc_idr",
      side: "BUY",
      price: 1000,
      quantity: 100,
    });
    setOutput(JSON.stringify(placed, null, 2));
    await status.refetch();
  }

  const ledger = status.data;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Paper trading</h1>
      <p className="text-sm text-gray-600">Simulation only. Never touches real money.</p>
      <button type="button" className="border px-4 py-2" onClick={() => void placeDemo()}>
        Place demo paper order
      </button>
      {status.isError && (
        <p className="text-sm text-red-600">
          {status.error instanceof Error ? status.error.message : "ledger read failed"}
        </p>
      )}
      {ledger?.status === "error" && (
        <p className="text-sm text-red-600">
          {ledger.code ?? "Error"}: {ledger.message ?? "ledger read refused"}
        </p>
      )}
      {ledger?.status === "ok" && ledger.data && (
        <div className="space-y-2">
          <p className="text-sm">{ledger.data.summary}</p>
          <pre className="text-sm">
            {JSON.stringify(
              {
                tradeCount: ledger.data.tradeCount,
                openOrders: ledger.data.openOrders,
                filledOrders: ledger.data.filledOrders,
                totalFees: ledger.data.totalFees,
                balances: ledger.data.balances,
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
      {output && <pre className="text-sm whitespace-pre-wrap">{output}</pre>}
    </div>
  );
}
