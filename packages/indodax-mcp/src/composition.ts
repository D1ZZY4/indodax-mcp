import { z } from "zod";
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
import { createRiskEngine, defaultRiskLimits, paperOnlyPolicy } from "@indodax-mcp/indodax-risk";
import type { RiskEngine, RiskLimits, RiskPolicy } from "@indodax-mcp/indodax-risk";
import { TradingService } from "@indodax-mcp/indodax-trading";
import { ManagedSocket } from "@indodax-mcp/indodax-websocket";
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
  marketSocket: ManagedSocket;
  privateSocket: ManagedSocket;
  tenantId: string;
  accountId: string;
}

export function paperOnlyEnvelope() {
  return z.object({});
}

export function createApp(env: AppEnv): AppServices {
  const logger = createLogger({ service: "indodax-mcp" });
  const publicClient = new PublicClient({
    rateLimitRps: env.INDODAX_RATE_LIMIT,
  });
  const hasCreds = Boolean(env.INDODAX_API_KEY && env.INDODAX_API_SECRET);
  const signer = hasCreds
    ? new TapiV2Signer(env.INDODAX_API_KEY as string, env.INDODAX_API_SECRET as string)
    : null;
  const accountClient = signer ? new AccountClient({ signer }) : null;
  const liveExecutor = signer ? new LiveExecutor({ signer }) : null;
  const paper = new PaperExecutor();
  const alerts = new AlertStore();
  const audit = new AuditTrail();
  const limits = defaultRiskLimits();
  const policy = paperOnlyPolicy();
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
    metrics: new Counters(),
    events: new EventBus(),
    scheduler: new Scheduler(),
    marketSocket: new ManagedSocket(() => {}),
    privateSocket: new ManagedSocket(() => {}),
    tenantId: "local",
    accountId: "local",
  };
}
