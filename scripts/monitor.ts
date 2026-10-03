export {};

// Generic price monitor for any INDODAX pair.
//
// Usage:
//   bun scripts/monitor.ts --once
//   MONITOR_PAIR=eth_idr bun scripts/monitor.ts
//
// Environment:
//   MONITOR_PAIR          pair like btc_idr (default btc_idr)
//   MONITOR_REFERENCE     baseline price; defaults to the first observed tick
//   MONITOR_UP_PCT        rise trigger percent (default 2, 0 disables)
//   MONITOR_DOWN_PCT      fall trigger percent (default 2, 0 disables)
//   MONITOR_AMOUNT_HELD   optional held base amount for position valuation
//   MONITOR_EXIT_ON_TRIGGER  exit on first trigger so a supervisor picks
//                            up the alert; set to "0" to keep looping
//
// Read-only. Makes no orders and holds no credentials.

const PAIR = process.env.MONITOR_PAIR ?? "btc_idr";
const UP_PCT = Number(process.env.MONITOR_UP_PCT ?? "2");
const DOWN_PCT = Number(process.env.MONITOR_DOWN_PCT ?? "2");
const AMOUNT_HELD = Number(process.env.MONITOR_AMOUNT_HELD ?? "0");
const ONCE = process.argv.includes("--once");
const EXIT_ON_TRIGGER = (process.env.MONITOR_EXIT_ON_TRIGGER ?? "1") !== "0";

let reference = Number(process.env.MONITOR_REFERENCE ?? "0");

interface TickerBody {
  last: string;
}

async function fetchTicker(pair: string): Promise<TickerBody> {
  const response = await fetch(`https://indodax.com/api/ticker/${pair}`);
  if (!response.ok) throw new Error(`ticker HTTP ${response.status}`);
  const json = (await response.json()) as { ticker: TickerBody };
  if (!json.ticker?.last) throw new Error("bad ticker shape");
  return json.ticker;
}

function randomDelayMs(): number {
  return 10_000 + Math.floor(Math.random() * 21_000);
}

function notify(title: string, body: string): void {
  try {
    Bun.spawnSync(["notify-send", title, body]);
  } catch {
    // headless fallback: log only
  }
}

async function tick(latched: Set<string>): Promise<void> {
  const ticker = await fetchTicker(PAIR);
  const last = Number(ticker.last);
  const at = new Date().toISOString();
  if (!(reference > 0)) {
    reference = last;
    console.log(`${at} ${PAIR} baseline=${reference}`);
  }
  const held = AMOUNT_HELD > 0 ? ` pos=${(last * AMOUNT_HELD).toFixed(0)}` : "";
  console.log(`${at} ${PAIR} last=${ticker.last}${held}`);
  const upAt = UP_PCT > 0 ? reference * (1 + UP_PCT / 100) : Number.POSITIVE_INFINITY;
  const downAt = DOWN_PCT > 0 ? reference * (1 - DOWN_PCT / 100) : 0;
  if (last >= upAt && !latched.has("up")) {
    latched.add("up");
    notify("Price alert up", `${PAIR} ${last} crossed +${UP_PCT}% from ${reference}`);
    console.log(`${at} TRIGGER up ${last}`);
    if (EXIT_ON_TRIGGER) {
      console.log(`${at} ALERT up delivered, exiting for supervisor pickup`);
      process.exit(0);
    }
  }
  if (last <= downAt && !latched.has("down")) {
    latched.add("down");
    notify("Price alert down", `${PAIR} ${last} crossed -${DOWN_PCT}% from ${reference}`);
    console.log(`${at} TRIGGER down ${last}`);
    if (EXIT_ON_TRIGGER) {
      console.log(`${at} ALERT down delivered, exiting for supervisor pickup`);
      process.exit(0);
    }
  }
}

const latched = new Set<string>();

if (ONCE) {
  await tick(latched);
  process.exit(0);
}

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopped = true;
  process.exit(0);
});

while (!stopped) {
  try {
    await tick(latched);
  } catch (error) {
    console.log(`${new Date().toISOString()} tick failed: ${String(error).slice(0, 120)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, randomDelayMs()));
}
