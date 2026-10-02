import { expect, test } from "@playwright/test";

test("workbench boots and lists tools", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("MCP tools")).toBeVisible();
  await expect(page.getByText("Invoke")).toBeVisible();
});

test("health page renders status", async ({ page }) => {
  await page.goto("/health");
  await expect(page.getByText("System health")).toBeVisible();
});

test("paper page offers simulation only", async ({ page }) => {
  await page.goto("/paper");
  await expect(page.getByText("Simulation only")).toBeVisible();
});
