import { defineCommand, runMain } from "citty";
import { loadEnv } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

const env = loadEnv();
const logger = createLogger({ service: "cli" });
const { app } = buildIndodaxServer(env);

const market = defineCommand({
  meta: { name: "market", description: "Market reads" },
  args: {
    action: { type: "positional", description: "ticker|pairs|server-time", required: true },
    pair: { type: "positional", description: "Pair like btc_idr", required: false },
    output: { type: "string", alias: "o", description: "table|json", default: "table" },
  },
  async run({ args }) {
    if (args.action === "ticker") {
      const { getTicker } = await import("@indodax-mcp/indodax-market");
      const ticker = await getTicker(app.publicClient, String(args.pair ?? "btc_idr"));
      if (args.output === "json") {
        console.log(JSON.stringify(ticker, null, 2));
      } else {
        console.log(`${ticker.symbol.base}_${ticker.symbol.quote} last=${ticker.last}`);
      }
      return;
    }
    if (args.action === "pairs") {
      console.log(JSON.stringify(await app.publicClient.pairs(), null, 2));
      return;
    }
    console.log(JSON.stringify(await app.publicClient.serverTime(), null, 2));
  },
});

const account = defineCommand({
  meta: { name: "account", description: "Account reads (needs credentials)" },
  args: {
    action: { type: "positional", description: "info|balances", required: true },
  },
  async run({ args }) {
    if (!app.accountClient) {
      logger.error("private command needs INDODAX_API_KEY and INDODAX_API_SECRET");
      process.exit(2);
    }
    const info = await app.accountClient.getAccount();
    if (args.action === "balances") {
      for (const balance of info.balances) {
        console.log(`${balance.asset}: free=${balance.free} locked=${balance.locked}`);
      }
      return;
    }
    console.log(JSON.stringify({ canTrade: info.canTrade, balances: info.balances.length }));
  },
});

const paper = defineCommand({
  meta: { name: "paper", description: "Paper trading (simulation only)" },
  args: {
    action: {
      type: "positional",
      description: "balances|status|reset",
      required: true,
    },
  },
  async run({ args }) {
    if (args.action === "balances") {
      console.log(JSON.stringify(app.paper.snapshot().balances, null, 2));
      return;
    }
    if (args.action === "status") {
      const snapshot = app.paper.snapshot();
      console.log(
        `trades=${snapshot.tradeCount} open=${snapshot.orders.filter((o) => o.state === "ACCEPTED").length} fees=${snapshot.totalFees}`,
      );
      return;
    }
    app.paper.reset();
    console.log("paper state reset");
  },
});

const risk = defineCommand({
  meta: { name: "risk", description: "Risk limits and state" },
  args: {
    action: { type: "positional", description: "limits|state", required: true },
  },
  async run({ args }) {
    if (args.action === "state") {
      console.log(JSON.stringify({ policy: app.policy, deadman: app.deadman.snapshot() }, null, 2));
      return;
    }
    console.log(JSON.stringify(app.limits, null, 2));
  },
});

const system = defineCommand({
  meta: { name: "system", description: "System health and capabilities" },
  args: {
    action: { type: "positional", description: "health|capabilities", required: true },
  },
  async run({ args }) {
    if (args.action === "capabilities") {
      console.log("market.read=allowed trade.place=controlled funding.withdraw=disabled");
      return;
    }
    console.log(JSON.stringify({ status: app.health.overall() }));
  },
});

const main = defineCommand({
  meta: { name: "indodax", description: "Indodax MCP CLI (paper by default)" },
  subCommands: { market, account, paper, risk, system },
});

await runMain(main);
for (const hook of app.shutdownHooks) {
  await hook();
}
process.exit(0);
