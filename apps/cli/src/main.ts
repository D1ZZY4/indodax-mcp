import { defineCommand, runMain } from "citty";
import { loadConfig } from "@indodax-mcp/config";
import { createLogger } from "@indodax-mcp/logging";
import { buildIndodaxServer } from "@indodax-mcp/indodax-mcp";

// loadConfig keeps the parsed environment and its provenance together, so
// indodax_config_status can explain which channel supplied each credential.
const { env, diagnostic } = loadConfig();
const logger = createLogger({ service: "cli" });
const { app } = buildIndodaxServer(env, diagnostic);

/** sysexits.h convention: usage error, distinct from a runtime failure. */
const USAGE_EXIT = 64;
/** Distinct from 1 so a script can tell "no credentials" from "request failed". */
const MISSING_CREDENTIALS_EXIT = 2;
const UNACKNOWLEDGED_EXIT = 3;

let draining: Promise<void> | null = null;

/**
 * Release resources once.
 *
 * `process.exit` discards pending work, so every non-zero exit path drains the
 * shutdown hooks first. Without that, a configured database pool is abandoned
 * mid-connection on exactly the paths an operator is most likely to hit.
 */
function shutdown(): Promise<void> {
  draining ??= (async () => {
    for (const hook of app.shutdownHooks) {
      try {
        await hook();
      } catch (error) {
        logger.warn({ error: String(error) }, "cli shutdown hook failed");
      }
    }
  })();
  return draining;
}

async function exitWith(code: number): Promise<never> {
  await shutdown();
  process.exit(code);
}

/** Reject an unrecognized action instead of falling through to a default branch. */
async function unknownAction(group: string, action: string, expected: string): Promise<never> {
  console.error(`unknown ${group} action: ${action} (expected one of: ${expected})`);
  return exitWith(USAGE_EXIT);
}

const MARKET_ACTIONS = ["ticker", "pairs", "server-time"] as const;
const ACCOUNT_ACTIONS = ["info", "balances"] as const;
const PAPER_ACTIONS = ["balances", "status", "reset"] as const;
const RISK_ACTIONS = ["limits", "state"] as const;
const SYSTEM_ACTIONS = ["health", "capabilities"] as const;

const market = defineCommand({
  meta: { name: "market", description: "Market reads" },
  args: {
    action: { type: "positional", description: MARKET_ACTIONS.join("|"), required: true },
    pair: { type: "positional", description: "Pair like btc_idr", required: false },
    output: { type: "string", alias: "o", description: "table|json", default: "table" },
  },
  async run({ args }) {
    const action = String(args.action);
    if (!MARKET_ACTIONS.includes(action as (typeof MARKET_ACTIONS)[number])) {
      return unknownAction("market", action, MARKET_ACTIONS.join(", "));
    }
    if (action === "ticker") {
      const { getTicker } = await import("@indodax-mcp/indodax-market");
      const ticker = await getTicker(app.publicClient, String(args.pair ?? "btc_idr"));
      if (args.output === "json") {
        console.log(JSON.stringify(ticker, null, 2));
      } else {
        console.log(`${ticker.symbol.base}_${ticker.symbol.quote} last=${ticker.last}`);
      }
      return;
    }
    if (action === "pairs") {
      console.log(JSON.stringify(await app.publicClient.pairs(), null, 2));
      return;
    }
    console.log(JSON.stringify(await app.publicClient.serverTime(), null, 2));
  },
});

const account = defineCommand({
  meta: { name: "account", description: "Account reads (needs credentials)" },
  args: {
    action: { type: "positional", description: ACCOUNT_ACTIONS.join("|"), required: true },
  },
  async run({ args }) {
    const action = String(args.action);
    // Validate the action before the credential check: a typo should report a
    // usage error rather than being reported as a missing-credentials problem.
    if (!ACCOUNT_ACTIONS.includes(action as (typeof ACCOUNT_ACTIONS)[number])) {
      return unknownAction("account", action, ACCOUNT_ACTIONS.join(", "));
    }
    if (!app.accountClient) {
      logger.error("private command needs INDODAX_API_KEY and INDODAX_API_SECRET");
      return exitWith(MISSING_CREDENTIALS_EXIT);
    }
    const info = await app.accountClient.getAccount();
    if (action === "balances") {
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
    action: { type: "positional", description: PAPER_ACTIONS.join("|"), required: true },
    acknowledged: {
      type: "boolean",
      description: "Required opt-in for reset",
      default: false,
    },
  },
  async run({ args }) {
    const action = String(args.action);
    if (!PAPER_ACTIONS.includes(action as (typeof PAPER_ACTIONS)[number])) {
      return unknownAction("paper", action, PAPER_ACTIONS.join(", "));
    }
    if (action === "balances") {
      console.log(JSON.stringify(app.paper.snapshot().balances, null, 2));
      return;
    }
    if (action === "status") {
      const snapshot = app.paper.snapshot();
      const open = snapshot.orders.filter(
        (o) => o.state === "ACCEPTED" || o.state === "PARTIALLY_FILLED",
      ).length;
      console.log(`trades=${snapshot.tradeCount} open=${open} fees=${snapshot.totalFees}`);
      return;
    }
    if (args.acknowledged !== true) {
      console.error("paper reset needs --acknowledged");
      return exitWith(UNACKNOWLEDGED_EXIT);
    }
    app.paper.reset();
    console.log("paper state reset");
  },
});

const risk = defineCommand({
  meta: { name: "risk", description: "Risk limits and state" },
  args: {
    action: { type: "positional", description: RISK_ACTIONS.join("|"), required: true },
  },
  async run({ args }) {
    const action = String(args.action);
    if (!RISK_ACTIONS.includes(action as (typeof RISK_ACTIONS)[number])) {
      return unknownAction("risk", action, RISK_ACTIONS.join(", "));
    }
    if (action === "state") {
      console.log(
        JSON.stringify(
          {
            policy: app.policy,
            deadman: app.deadman.snapshot(),
            configSource: app.configDiagnostic.credentials,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(JSON.stringify(app.limits, null, 2));
  },
});

const system = defineCommand({
  meta: { name: "system", description: "System health and capabilities" },
  args: {
    action: { type: "positional", description: SYSTEM_ACTIONS.join("|"), required: true },
  },
  async run({ args }) {
    const action = String(args.action);
    if (!SYSTEM_ACTIONS.includes(action as (typeof SYSTEM_ACTIONS)[number])) {
      return unknownAction("system", action, SYSTEM_ACTIONS.join(", "));
    }
    if (action === "capabilities") {
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
await exitWith(0);
