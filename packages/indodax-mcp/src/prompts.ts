import type { Registry } from "@d1zzy4-jethools/mcp-registry";
import type { ServerHandlers } from "@d1zzy4-jethools/mcp-core";
import type { AppServices } from "@d1zzy4-jethools/mcp-app/composition";

export function registerPrompts(
  registry: Registry,
  handlers: ServerHandlers,
  _app: AppServices,
): void {
  void _app;
  const defs = [
    {
      name: "indodax_market_review",
      title: "Market review",
      description: "Fetch ticker, book, and trades for one pair, then summarize price and spread.",
      args: [{ name: "pair", description: "Trading pair, e.g. btc_idr", required: true }],
    },
    {
      name: "indodax_portfolio_review",
      title: "Portfolio review",
      description: "Read paper balances and risk state, then summarize exposure.",
      args: [],
    },
    {
      name: "indodax_order_review",
      title: "Order review",
      description: "Validate a hypothetical order through risk and explain the verdict.",
      args: [
        { name: "pair", description: "Trading pair", required: true },
        { name: "side", description: "buy or sell", required: true },
        { name: "quantity", description: "Base units", required: true },
        { name: "price", description: "Limit price", required: true },
      ],
    },
    {
      name: "indodax_strategy_review",
      title: "Strategy review",
      description: "Evaluate a signal over provided closes and judge its strength.",
      args: [{ name: "closes", description: "Comma-separated closes", required: true }],
    },
    {
      name: "indodax_incident_review",
      title: "Incident review",
      description: "Pull audit trace, reconciliation state, and health for one correlation id.",
      args: [{ name: "correlationId", description: "Correlation id", required: true }],
    },
  ];
  for (const def of defs) registry.registerPrompt(def);

  handlers.prompts.set("indodax_market_review", (args) => [
    {
      role: "user",
      text: `Call indodax_ticker, indodax_orderbook, and indodax_trades for ${args.pair ?? "btc_idr"} and summarize current price, spread, and tape.`,
    },
  ]);
  handlers.prompts.set("indodax_portfolio_review", () => [
    {
      role: "user",
      text: "Call indodax_portfolio and indodax_risk_state, then summarize exposure and limits.",
    },
  ]);
  handlers.prompts.set("indodax_order_review", (args) => [
    {
      role: "user",
      text: `Call indodax_validate_order with pair ${args.pair ?? ""}, side ${args.side ?? ""}, quantity ${args.quantity ?? ""}, price ${args.price ?? ""} and explain the verdict. Place nothing.`,
    },
  ]);
  handlers.prompts.set("indodax_strategy_review", (args) => [
    {
      role: "user",
      text: `Call indodax_strategy_evaluate with closes ${args.closes ?? ""} and judge signal strength.`,
    },
  ]);
  handlers.prompts.set("indodax_incident_review", (args) => [
    {
      role: "user",
      text: `Call indodax_execution_trace for ${args.correlationId ?? ""}, plus indodax_reconciliation_state and indodax_health, then summarize the incident.`,
    },
  ]);
}
