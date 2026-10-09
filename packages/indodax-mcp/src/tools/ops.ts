import { z } from "zod";
import Decimal from "decimal.js";
import { ValidationError } from "@indodax-mcp/errors";
import type { Registry } from "@indodax-mcp/mcp-registry";
import type { ServerHandlers } from "@indodax-mcp/mcp-core";
import { fail, ok, parseArgs } from "@indodax-mcp/mcp-app/respond";
import type { AppServices } from "@indodax-mcp/mcp-app/composition";
import { defineTool } from "@indodax-mcp/mcp-app/tools/define";
import { getBacktest } from "@indodax-mcp/mcp-app/tools/ops-backtest";
import { exposureReport } from "@indodax-mcp/mcp-app/tools/ops-exposure";

export type { StoredBacktest } from "@indodax-mcp/mcp-app/tools/ops-backtest";
import type { StoredBacktest } from "@indodax-mcp/mcp-app/tools/ops-backtest";
export { storeBacktest } from "@indodax-mcp/mcp-app/tools/ops-backtest";

const READ = {
  capability: "READ" as const,
  riskClass: "read" as const,
  environmentRequirement: "any" as const,
  authRequirement: "none" as const,
  destructive: false,
  idempotencyClass: "none" as const,
  auditClass: "read" as const,
};

export function registerOpsTools(
  registry: Registry,
  handlers: ServerHandlers,
  app: AppServices,
): void {
  /**
   * Stored backtest runs.
   *
   * `indodax_backtest_get` and `indodax_backtest_compare` both read the same
   * module-level run map through `getBacktest`, and compare was just get over a
   * list plus a sort. One tool with `ids` covers both: a single id returns one
   * report, two or more return the ranked comparison.
   */
  const backtest = defineTool(
    {
      name: "indodax_backtest",
      title: "Backtest reports",
      description:
        "Read-only. Stored deterministic replay reports, bounded at 100 runs. Absorbs the former indodax_backtest_get and indodax_backtest_compare. Args: a single id returns that report with its trade journal; two to ten ids return rows ranked by net PnL with best naming the winner.",
      ...READ,
    },
    { ids: z.array(z.string().min(1)).min(1).max(10) },
  );
  const exposure = defineTool(
    {
      name: "indodax_exposure",
      title: "Exposure",
      description: "Read-only. Per-asset paper exposure in IDR at live prices.",
      ...READ,
    },
    {},
  );
  for (const tool of [backtest, exposure]) {
    registry.registerTool(tool);
  }

  handlers.tools.set("indodax_backtest", async (raw) => {
    try {
      const args = parseArgs(backtest.inputSchema, raw);
      const runs = args.ids.map((id) => {
        const run = getBacktest(id);
        if (!run) throw ValidationError(`backtest ${id} not found`);
        return run;
      });
      // One id is a lookup, several ids are a comparison. Both answer from the
      // same read, so a caller never has to choose the right tool for a shape.
      if (runs.length === 1) {
        const run = runs[0] as StoredBacktest;
        return ok({
          ...run,
          summary: `backtest ${run.id} with ${run.report.hypotheticalFills} hypothetical fill(s), net PnL ${run.report.netPnl}`,
        });
      }
      const rows = runs.map((run) => ({
        id: run.id,
        netPnl: run.report.netPnl,
        fills: run.report.hypotheticalFills,
        fees: run.report.totalFees,
        evaluated: run.report.signalsEvaluated,
      }));
      const ranked = [...rows].sort((a, b) =>
        new Decimal(b.netPnl).comparedTo(new Decimal(a.netPnl)),
      );
      return ok({
        count: rows.length,
        rows,
        best: ranked[0]?.id ?? null,
        summary: `best of ${rows.length} is ${ranked[0]?.id ?? "none"} with net PnL ${ranked[0]?.netPnl ?? "n/a"}`,
      });
    } catch (error) {
      return fail(error);
    }
  });
  handlers.tools.set("indodax_exposure", async () => ok(await exposureReport(app)));
}
