import { z } from "zod";

export const capabilitySchema = z.enum(["READ", "TRADE", "WITHDRAW", "PAPER", "SYSTEM"]);
export type Capability = z.infer<typeof capabilitySchema>;

export const riskClassSchema = z.enum(["read", "mutation", "destructive"]);
export type RiskClass = z.infer<typeof riskClassSchema>;

export const environmentRequirementSchema = z.enum(["any", "paper", "live"]);
export type EnvironmentRequirement = z.infer<typeof environmentRequirementSchema>;

export const authRequirementSchema = z.enum(["none", "credentials"]);
export type AuthRequirement = z.infer<typeof authRequirementSchema>;

export const idempotencyClassSchema = z.enum(["none", "client-key", "natural"]);
export type IdempotencyClass = z.infer<typeof idempotencyClassSchema>;

export const auditClassSchema = z.enum(["read", "mutation", "security"]);
export type AuditClass = z.infer<typeof auditClassSchema>;

export const toolMetadataSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(20),
  capability: capabilitySchema,
  riskClass: riskClassSchema,
  environmentRequirement: environmentRequirementSchema,
  authRequirement: authRequirementSchema,
  destructive: z.boolean(),
  idempotencyClass: idempotencyClassSchema,
  auditClass: auditClassSchema,
});

export type ToolMetadata = z.infer<typeof toolMetadataSchema>;

export const resourceMetadataSchema = z.object({
  uri: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(10),
});

export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;

export const promptArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().default(false),
});

export const promptMetadataSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(10),
  args: z.array(promptArgumentSchema).default([]),
});

export type PromptMetadata = z.infer<typeof promptMetadataSchema>;
