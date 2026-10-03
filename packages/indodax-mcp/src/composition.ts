import type { AppEnv } from "@indodax-mcp/config";
import { AuditTrail } from "@indodax-mcp/indodax-audit";
import { AccountClient } from "@indodax-mcp/indodax-account";
import { AlertStore } from "@indodax-mcp/indodax-alerts";
import { TapiV2Signer } from "@indodax-mcp/indodax-auth";
import { PublicClient } from "@indodax-mcp/indodax-client";
import { DeadmanSwitch } from "@indodax-mcp/indodax-deadman";
import { LiveExecutor } from "@indodax-mcp/indodax-execution";
import { EventBus } from "@indodax-mcp/events";
import { HealthTracker, Counters } from "@indodax-mcp/observability";
import { PaperExecutor } from "@indodax-mcp/indodax-paper";
import {
  createRiskEngine,
  defaultRiskLimits,
  liveEnabledPolicy,
  paperOnlyPolicy,
} from "@indodax-mcp/indodax-risk";
import type { RiskEngine, RiskLimits, RiskPolicy } from "@indodax-mcp/indodax-risk";
import { OFFICIAL_V2_BUCKET, RateLimiter } from "@indodax-mcp/transport";
import { TradingService } from "@indodax-mcp/indodax-trading";
import {
  ManagedSocket,
  PrivateChannelManager,
  requestPrivateToken,
  type TokenFetcher,
} from "@indodax-mcp/indodax-websocket";
import { Scheduler } from "@indodax-mcp/scheduler";
import { createLogger } from "@indodax-mcp/logging";

export interface AppServices {
  env: AppEnv;
  logger: ReturnType<typeof createLogger>;
  publicClient: PublicClient;
  signer: TapiV2Signer | null;
  accountClient: AccountClient | null;
  liveExecutor: LiveExecutor | null;
  paper: PaperExecutor;
  alerts: AlertStore;
  audit: AuditTrail;
  risk: RiskEngine;
  limits: RiskLimits;
  policy: RiskPolicy;
  trading: TradingService;
  deadman: DeadmanSwitch;
  health: HealthTracker;
  metrics: Counters;
  events: EventBus;
  scheduler: Scheduler;
  limiter: RateLimiter;
  marketSocket: ManagedSocket;
  privateChannel: PrivateChannelManager;
  privateTokenFetcher: TokenFetcher | null;
  tenantId: string;
  accountId: string;
  /** Epoch ms of the last successful authenticated account read. Null when never synced. */
  accountSyncedAt: number | null;
  /** Set by full exchange reconciliation; enforced for live-mode risk evaluation. */
  reconciliationHalted: boolean;
  /** Async resource cleanup (database pools). Short-lived CLIs must drain these to exit. */
  shutdownHooks: Array<() => Promise<void>>;
}

export function createApp(env: AppEnv): AppServices {
  const logger = createLogger({ service: "indodax-mcp" });
  const publicClient = new PublicClient({
    rateLimitRps: env.INDODAX_RATE_LIMIT,
  });
  const hasCreds = Boolean(env.INDODAX_API_KEY && env.INDODAX_API_SECRET);
  const limiter = new RateLimiter([OFFICIAL_V2_BUCKET]);
  const signer = hasCreds
    ? new TapiV2Signer(env.INDODAX_API_KEY as string, env.INDODAX_API_SECRET as string)
    : null;
  const accountClient = signer ? new AccountClient({ signer, limiter }) : null;
  const liveExecutor = signer ? new LiveExecutor({ signer, limiter }) : null;
  const paper = new PaperExecutor();
  const alerts = new AlertStore();
  const audit = new AuditTrail();
  const limits = defaultRiskLimits();
  const policy = env.APP_ENV === "live" ? liveEnabledPolicy() : paperOnlyPolicy();
  const risk = createRiskEngine(limits, policy);
  const auditKinds = ["AgentIntentCreated", "RiskApproved", "RiskRejected"] as const;
  const trading = new TradingService(risk, {
    record: (entry) => {
      const kind = (auditKinds as readonly string[]).includes(entry.kind)
        ? (entry.kind as "AgentIntentCreated" | "RiskApproved" | "RiskRejected")
        : "AgentIntentCreated";
      audit.record({
        correlationId: entry.correlationId,
        kind,
        ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
        ...(entry.symbol !== undefined ? { symbol: entry.symbol } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      });
    },
  });
  const metrics = new Counters();
  const privateChannel = new PrivateChannelManager({
    onEvent: () => {
      metrics.increment("private_events");
    },
  });
  // Token endpoint uses the legacy TAPI key/secret pair, not the v2 signer.
  // Null without credentials; the token itself never leaves the server.
  const privateTokenFetcher: TokenFetcher | null = hasCreds
    ? () =>
        requestPrivateToken(env.INDODAX_API_KEY as string, env.INDODAX_API_SECRET as string).then(
          (result) => ({ token: result.token, channel: result.channel }),
        )
    : null;
  return {
    env,
    logger,
    publicClient,
    signer,
    accountClient,
    liveExecutor,
    paper,
    alerts,
    audit,
    risk,
    limits,
    policy,
    trading,
    deadman: new DeadmanSwitch(),
    health: new HealthTracker(),
    metrics,
    events: new EventBus(),
    scheduler: new Scheduler(),
    limiter,
    marketSocket: new ManagedSocket(() => {}),
    privateChannel,
    privateTokenFetcher,
    tenantId: "local",
    accountId: "local",
    accountSyncedAt: null,
    reconciliationHalted: false,
    shutdownHooks: [],
  };
}
