use super::V2Server;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Implementation, InitializeResult, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities,
};
use rmcp::service::{RequestContext, RoleServer};

impl rmcp::handler::server::ServerHandler for V2Server {
    fn get_info(&self) -> InitializeResult {
        InitializeResult::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new("indodax-mcp-v2", env!("CARGO_PKG_VERSION")))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, rmcp::model::ErrorData> {
        let mut tools = crate::tools::market::tools();
        tools.extend(crate::tools::account::tools());
        tools.extend(crate::tools::orders::tools());
        tools.extend(crate::tools::trading::tools());
        tools.extend(crate::tools::portfolio::tools());
        tools.extend(crate::tools::risk::tools());
        tools.extend(crate::tools::paper::tools());
        tools.extend(crate::tools::strategy::tools());
        tools.extend(crate::tools::alerts::tools());
        tools.extend(crate::tools::reconcile::tools());
        tools.extend(crate::tools::audit::tools());
        tools.extend(crate::tools::system::tools());
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, rmcp::model::ErrorData> {
        let args = request.arguments.unwrap_or_default();
        let name: &str = &request.name;
        Ok(self.execute_tool(name, args).await)
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::ListResourcesResult, rmcp::model::ErrorData> {
        Ok(crate::resources::list())
    }

    async fn read_resource(
        &self,
        request: rmcp::model::ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::ReadResourceResult, rmcp::model::ErrorData> {
        crate::resources::read(self, request).await
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::ListPromptsResult, rmcp::model::ErrorData> {
        Ok(crate::prompts::list())
    }

    async fn get_prompt(
        &self,
        request: rmcp::model::GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::GetPromptResult, rmcp::model::ErrorData> {
        crate::prompts::get(request)
    }
}

impl V2Server {
    /// Shared dispatch used by stdio and HTTP transports alike.
    pub async fn execute_tool(
        &self,
        name: &str,
        args: serde_json::Map<String, serde_json::Value>,
    ) -> CallToolResult {
        let result = match name {
            name if name.starts_with("market_") => {
                crate::tools::market::handle(self, name, &args).await
            }
            name if name.starts_with("account_") => {
                crate::tools::account::handle(self, name, &args).await
            }
            name if name.starts_with("order_") || name.starts_with("paper_order") => {
                crate::tools::orders::handle(self, name, &args).await
            }
            name if name.starts_with("trade_") => {
                crate::tools::trading::handle(self, name, &args).await
            }
            name if name.starts_with("portfolio_") => {
                crate::tools::portfolio::handle(self, name, &args).await
            }
            name if name.starts_with("risk_") => {
                crate::tools::risk::handle(self, name, &args).await
            }
            name if name.starts_with("paper_") => {
                crate::tools::paper::handle(self, name, &args).await
            }
            name if name.starts_with("strategy_") || name.starts_with("backtest_") => {
                crate::tools::strategy::handle(self, name, &args).await
            }
            name if name.starts_with("alert_") => {
                crate::tools::alerts::handle(self, name, &args).await
            }
            name if name.starts_with("reconcile_") => {
                crate::tools::reconcile::handle(self, name, &args).await
            }
            name if name.starts_with("audit_") => {
                crate::tools::audit::handle(self, name, &args).await
            }
            _ => crate::tools::system::handle(self, name, &args).await,
        };
        result.unwrap_or_else(|| Self::fail("validation", format!("unknown tool: {name}")))
    }
}
