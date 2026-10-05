import { describe, expect, it } from "vitest";
import { createLogger, logContext } from "@indodax-mcp/logging";

describe("logging", () => {
  it("creates child loggers with context", () => {
    const logger = createLogger({ service: "test", operation: "probe" });
    expect(typeof logger.info).toBe("function");
    expect(logContext({ service: "a" }, { operation: "b" })).toEqual({
      service: "a",
      operation: "b",
    });
  });
});
