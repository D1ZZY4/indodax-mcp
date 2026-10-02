use rmcp::model::{
    GetPromptRequestParams, GetPromptResult, ListPromptsResult, Prompt, PromptArgument,
    PromptMessage, PromptMessageRole,
};

fn argument(name: &str, description: &str) -> PromptArgument {
    PromptArgument::new(name).with_description(description)
}

pub fn list() -> ListPromptsResult {
    ListPromptsResult::with_all_items(vec![
        Prompt::new(
            "analyze_market".to_string(),
            Some("Fetch ticker, order book, and recent trades for one pair, then summarize price, spread, and tape.".to_string()),
            Some(vec![argument("pair", "Trading pair, e.g. btc_idr")]),
        ),
        Prompt::new(
            "check_portfolio".to_string(),
            Some("Read paper balances and positions, then summarize exposure and profit and loss.".to_string()),
            None,
        ),
        Prompt::new(
            "preflight_trade".to_string(),
            Some("Validate a hypothetical order through risk before anything is placed. Nothing executes.".to_string()),
            Some(vec![
                argument("pair", "Trading pair, e.g. btc_idr"),
                argument("side", "buy or sell"),
                argument("quantity", "Base units"),
                argument("price", "Limit price"),
            ]),
        ),
        Prompt::new(
            "review_open_orders".to_string(),
            Some("List open paper orders and reconcile each against the live market price.".to_string()),
            None,
        ),
        Prompt::new(
            "explain_risk_rejection".to_string(),
            Some("Re-run risk evaluation for given order parameters and explain each denying reason.".to_string()),
            Some(vec![
                argument("pair", "Trading pair, e.g. btc_idr"),
                argument("side", "buy or sell"),
                argument("quantity", "Base units"),
                argument("price", "Limit price"),
            ]),
        ),
    ])
}

pub fn get(request: GetPromptRequestParams) -> Result<GetPromptResult, rmcp::model::ErrorData> {
    let args = request.arguments.unwrap_or_default();
    let get = |name: &str| args.get(name).and_then(|value| value.as_str()).unwrap_or("");
    let text = match request.name.as_str() {
        "analyze_market" => format!(
            "Call market_ticker, market_orderbook, and market_trades for {} and summarize current price, bid-ask spread, and recent tape direction.",
            get("pair")
        ),
        "check_portfolio" => "Call paper_balances and portfolio_pnl, then summarize balances, equity in IDR, and total profit and loss.".to_string(),
        "preflight_trade" => format!(
            "Call trade_validate with pair {}, side {}, quantity {}, price {}. Report the risk outcome and every reason. Place nothing.",
            get("pair"), get("side"), get("quantity"), get("price")
        ),
        "review_open_orders" => "Call paper_orders then order_reconcile for each open order and report which are fillable at live prices.".to_string(),
        "explain_risk_rejection" => format!(
            "Call risk_evaluate with pair {}, side {}, quantity {}, price {} and explain each reason in plain words.",
            get("pair"), get("side"), get("quantity"), get("price")
        ),
        name => {
            return Err(rmcp::model::ErrorData::invalid_params(
                format!("unknown prompt: {name}"),
                None,
            ));
        }
    };
    Ok(GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)]))
}
