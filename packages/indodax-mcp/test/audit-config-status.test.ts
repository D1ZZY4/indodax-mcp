import { describe, expect, it } from "vitest";
import { loadConfig, loadEnv } from "@indodax-mcp/config";
import { withInMemoryServer } from "@indodax-mcp/mcp-testing";
import { buildIndodaxServer } from "@indodax-mcp/mcp-app";

type Harness = Awaited<ReturnType<typeof withInMemoryServer>>;

async function dataOf(harness: Harness, name: string, args: Record<string, unknown> = {}) {
  const result = (await harness.client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as { data: never };
}

describe("config_status explains a credential that never arrived", () => {
  it("names the origin channel and never a value", async () => {
    const { server, app } = buildIndodaxServer(loadEnv({}));
    app.scheduler.stopAll();
    const harness = await withInMemoryServer(server);
    try {
      const body = await dataOf(harness, "indodax_config_status");
      const data = body.data as {
        credentialsConfigured: boolean;
        remedy: string;
        configSource: {
          credentials: Record<string, string>;
          repoEnvFileFound: boolean;
        };
      };
      expect(data.credentialsConfigured).toBe(false);
      expect(data.configSource.credentials).toEqual({
        INDODAX_API_KEY: "absent",
        INDODAX_API_SECRET: "absent",
      });
      // The actionable part: the operator learns the process received nothing.
      expect(data.remedy).toContain("received no INDODAX_API_KEY");
      expect(data.remedy).toContain("repository .env");
      expect(JSON.stringify(body)).not.toContain("unit-test");
    } finally {
      await harness.close();
    }
  });

  it("reports credentials present with their origin when configured", async () => {
    const source = { INDODAX_API_KEY: "unit-test-key", INDODAX_API_SECRET: "unit-test-secret" };
    const { env, diagnostic } = loadConfig(source);
    const built = buildIndodaxServer(env, diagnostic);
    built.app.scheduler.stopAll();
    const harness = await withInMemoryServer(built.server);
    try {
      const body = await dataOf(harness, "indodax_config_status");
      const data = body.data as {
        credentialsConfigured: boolean;
        remedy: string;
        mcpHost: string;
        mcpPort: number;
        configSource: { credentials: Record<string, string> };
      };
      expect(data.credentialsConfigured).toBe(true);
      expect(data.configSource.credentials.INDODAX_API_KEY).toBe("process-env");
      expect(data.remedy).toContain("process-env");
      // Values must never be echoed back over MCP.
      expect(JSON.stringify(body)).not.toContain("unit-test-secret");
      // The gateway bind address is observable so a container misbind is
      // visible from the tool output itself.
      expect(data.mcpHost).toBe("127.0.0.1");
      expect(data.mcpPort).toBe(8000);
    } finally {
      await harness.close();
    }
  });
});
