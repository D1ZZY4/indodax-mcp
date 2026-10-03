const PAIR = process.env.MONITOR_PAIR ?? "btc_idr";
const REFERENCE = Number(process.env.MONITOR_REFERENCE ?? "1514997000");
const UP_PCT = Number(process.env.MONITOR_UP_PCT ?? "2");
const DOWN_PCT = Number(process.env.MONITOR_DOWN_PCT ?? "2");
const BTC_HELD = Number(process.env.MONITOR_BTC_HELD ?? "0.0000095");
const ONCE = process.argv.includes("--once");
// Exit the process when an alert triggers so the supervising session
// wakes up and can notify the user. Set to "0" to keep looping.
const EXIT_ON_TRIGGER = (process.env.MONITOR_EXIT_ON_TRIGGER ?? "1") !== "0";

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
  const value = last * BTC_HELD;
  console.log(`${at} ${PAIR} last=${ticker.last} pos=${value.toFixed(0)}idr`);
  const upAt = REFERENCE * (1 + UP_PCT / 100);
  const downAt = REFERENCE * (1 - DOWN_PCT / 100);
  if (last >= upAt && !latched.has("up")) {
    latched.add("up");
    notify("BTC alert up", `${PAIR} ${last} crossed +${UP_PCT}% from ${REFERENCE}`);
    console.log(`${at} TRIGGER up ${last}`);
    if (EXIT_ON_TRIGGER) {
      console.log(`${at} ALERT up delivered, exiting for supervisor pickup`);
      process.exit(0);
    }
  }
  if (last <= downAt && !latched.has("down")) {
    latched.add("down");
    notify("BTC alert down", `${PAIR} ${last} crossed -${DOWN_PCT}% from ${REFERENCE}`);
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
