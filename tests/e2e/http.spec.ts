import { expect, test } from "@playwright/test";

test("mcp-http health is ok", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:8000/health");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { status?: string };
  expect(body.status).toBe("ok");
});
