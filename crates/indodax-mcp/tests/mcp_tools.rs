use indodax_mcp::McpResponse;
use indodax_paper::PaperState;

#[test]
fn paper_tools_return_stable_envelope() {
    let tools = indodax_mcp::tools::paper::PaperTools::new(PaperState::with_defaults());
    let balances = tools.balances();
    assert_eq!(balances.status, "ok");
    let status = tools.status();
    assert_eq!(status.status, "ok");
    let _ = McpResponse::ok(serde_json::json!({"smoke": true}));
}
