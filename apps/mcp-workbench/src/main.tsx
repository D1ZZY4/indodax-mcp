import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToolsPage } from "@d1zzy4-jethools/mcp-workbench/pages/Tools";
import { HealthPage } from "@d1zzy4-jethools/mcp-workbench/pages/Health";
import { PaperPage } from "@d1zzy4-jethools/mcp-workbench/pages/Paper";
import "./index.css";

const queryClient = new QueryClient();

function App() {
  return (
    <BrowserRouter>
      <nav className="flex gap-4 p-4 border-b">
        <Link to="/">Tools</Link>
        <Link to="/health">Health</Link>
        <Link to="/paper">Paper</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ToolsPage />} />
        <Route path="/health" element={<HealthPage />} />
        <Route path="/paper" element={<PaperPage />} />
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
