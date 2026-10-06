import { expect, test } from "@playwright/test";

test("workbench boots and lists tools", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("MCP tools")).toBeVisible();
  await expect(page.getByText("Invoke")).toBeVisible();
  // The select is populated from a live MCP tools/list call, so a reachable
  // tool in the dropdown is the assertion that the transport actually worked.
  // Previously this test passed while every call failed, because the page
  // rendered its static single-option fallback and a "Connection failed"
  // banner beside it.
  await expect(page.getByRole("combobox")).toBeVisible();
  await expect(page.getByText("Connection failed")).toHaveCount(0);
  // Options render only once tools/list resolves, so waiting on a real tool
  // name is what proves the transport worked. The static fallback contains
  // only indodax_health.
  await expect(page.locator("select option", { hasText: "indodax_health" })).toHaveCount(1);
  await expect
    .poll(async () => page.locator("select option").count(), { timeout: 15_000 })
    .toBeGreaterThan(40);
});

test("workbench invokes a read-only tool end to end", async ({ page }) => {
  await page.goto("/");
  await page.locator("select").selectOption("indodax_version");
  await page.locator("button", { hasText: "Invoke" }).click();
  await expect(page.locator("pre").first()).toContainText("indodax-mcp");
});

test("health page renders status", async ({ page }) => {
  await page.goto("/health");
  await expect(page.getByText("System health")).toBeVisible();
});

test("paper page offers simulation only", async ({ page }) => {
  await page.goto("/paper");
  await expect(page.getByText("Simulation only")).toBeVisible();
});
