import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToolsPage } from "../src/pages/Tools.js";

describe("workbench", () => {
  it("renders the tools page with invoke controls", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ToolsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("MCP tools")).toBeTruthy();
    expect(screen.getByText("Invoke")).toBeTruthy();
  });
});
