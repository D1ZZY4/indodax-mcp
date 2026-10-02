use crate::server::V2Server;
use indodax_backtest::BacktestRunner;
use indodax_core::{OrderSide, Symbol};
use indodax_strategy::{signal::moving_average, Signal};
use rmcp::model::{CallToolResult, Tool};
use rust_decimal::Decimal;

pub fn tools() -> Vec<Tool> {
    vec![
        V2Server::tool(
            "strategy_list",
            "Read-only. List built-in strategies available for evaluation. Takes no arguments. Strategies only emit signals, they never place orders.",
            serde_json::json!({}),
            &[],
        ),
        V2Server::tool(
            "strategy_get",            "Read-only. Describe one built-in strategy by id with its parameters. Args: id required, ma-cross or momentum-threshold.",
            serde_json::json!({"id": {"type": "string", "description": "Strategy id"}}),
            &["id"],
        ),
        V2Server::tool(
            "strategy_validate",
            "No side effects. Check strategy inputs without computing a signal. Args: id required, closes array, window optional. Returns validity and the reason.",
            serde_json::json!({
                "id": {"type": "string", "description": "Strategy id"},
                "closes": {"type": "array", "description": "Close prices oldest first"},
                "window": {"type": "number", "description": "Average window, default 5"},
            }),
            &["id", "closes"],
        ),
        V2Server::tool(
            "strategy_evaluate",
            "No side effects. Evaluate one moving-average signal over provided closes. Args: pair, closes array of numbers, window default 5. Returns direction, strength, and reason. Output is a signal, not an order.",
            serde_json::json!({
                "pair": {"type": "string", "description": "Pair, e.g. btc_idr"},
                "closes": {"type": "array", "description": "Close prices oldest first"},
                "window": {"type": "number", "description": "Average window, default 5"},
            }),
            &["pair", "closes"],
        ),
        V2Server::tool(
            "backtest_run",
            "No side effects. Replay closes and count threshold crossings as hypothetical fills. Args: closes array, threshold default 0.05, fee_rate default 0.0026. Separate from paper trading. Returns fills and net pnl. Never uses real money.",
            serde_json::json!({
                "closes": {"type": "array", "description": "Close prices oldest first"},
                "threshold": {"type": "number", "description": "Abs change fraction, default 0.05"},
                "fee_rate": {"type": "number", "description": "Fee fraction, default 0.0026"},
            }),
            &["closes"],
        ),
    ]
}

pub async fn handle(
    _server: &V2Server,
    name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> Option<CallToolResult> {
    match name {
        "strategy_list" => Some(V2Server::ok(serde_json::json!([
            {"id": "ma-cross", "description": "Price vs moving average crossover signal"},
            {"id": "momentum-threshold", "description": "Absolute-change threshold signal used by backtest_run"},
        ]))),
        "strategy_get" => {
            let id = V2Server::get_str(args, "id").unwrap_or_default();
            match id.as_str() {
                "ma-cross" => Some(V2Server::ok(serde_json::json!({
                    "id": "ma-cross",
                    "inputs": ["pair", "closes", "window"],
                    "output": "Signal with side, strength 0 to 1, and reason",
                    "executes_orders": false,
                }))),
                "momentum-threshold" => Some(V2Server::ok(serde_json::json!({
                    "id": "momentum-threshold",
                    "inputs": ["closes", "threshold", "fee_rate"],
                    "output": "BacktestReport with fills and net pnl",
                    "executes_orders": false,
                }))),
                _ => {
                    Some(V2Server::fail("validation", "unknown strategy, use strategy_list".into()))
                }
            }
        }
        "strategy_evaluate" => Some(evaluate(args)),
        "strategy_validate" => Some(validate_strategy(args)),
        "backtest_run" => Some(backtest(args)),
        _ => None,
    }
}

fn validate_strategy(args: &serde_json::Map<String, serde_json::Value>) -> CallToolResult {
    let id = V2Server::get_str(args, "id").unwrap_or_default();
    if id != "ma-cross" && id != "momentum-threshold" {
        return V2Server::fail("validation", "unknown strategy, use strategy_list".into());
    }
    let closes = numbers(args, "closes").unwrap_or_default();
    if closes.len() < 2 {
        return V2Server::fail("validation", "closes needs at least two numbers".into());
    }
    if closes.iter().any(|price| !price.is_finite() || *price <= 0.0) {
        return V2Server::fail("validation", "closes must hold positive finite prices".into());
    }
    let window = V2Server::get_num(args, "window").unwrap_or(5.0);
    if window.fract() != 0.0 || window < 1.0 || window > closes.len() as f64 {
        return V2Server::fail("validation", "window must fit inside closes".into());
    }
    V2Server::ok(serde_json::json!({
        "id": id,
        "valid": true,
        "closes": closes.len(),
        "window": window as u64,
    }))
}

fn numbers(args: &serde_json::Map<String, serde_json::Value>, name: &str) -> Option<Vec<f64>> {
    args.get(name)?.as_array().map(|rows| {
        rows.iter()
            .filter_map(|row| {
                row.as_f64().or_else(|| row.as_str().and_then(|text| text.parse().ok()))
            })
            .collect()
    })
}

fn evaluate(args: &serde_json::Map<String, serde_json::Value>) -> CallToolResult {
    let pair = V2Server::get_str(args, "pair").unwrap_or_default();
    let symbol = match Symbol::parse_flexible(&pair) {
        Some(symbol) => symbol,
        None => return V2Server::fail("validation", format!("invalid pair: {pair}")),
    };
    let closes = numbers(args, "closes").unwrap_or_default();
    let window = V2Server::get_num(args, "window").unwrap_or(5.0).max(1.0) as usize;
    let average = match moving_average(&closes, window) {
        Some(average) => average,
        None => {
            return V2Server::fail("validation", "need at least window closes".into());
        }
    };
    let last = closes[closes.len() - 1];
    let (side, strength) = if last >= average {
        (OrderSide::Buy, ((last - average) / average).clamp(0.0, 1.0))
    } else {
        (OrderSide::Sell, ((average - last) / average).clamp(0.0, 1.0))
    };
    V2Server::ok(
        serde_json::to_value(&Signal {
            symbol,
            side,
            strength,
            reason: format!("last {last} vs ma{window} {average}"),
        })
        .unwrap_or_default(),
    )
}

fn backtest(args: &serde_json::Map<String, serde_json::Value>) -> CallToolResult {
    let closes = numbers(args, "closes").unwrap_or_default();
    if closes.len() < 2 {
        return V2Server::fail("validation", "need at least two closes".into());
    }
    let threshold = V2Server::get_num(args, "threshold").unwrap_or(0.05);
    if !threshold.is_finite() || threshold <= 0.0 {
        return V2Server::fail("validation", "threshold must be positive".into());
    }
    let fee = V2Server::get_num(args, "fee_rate").unwrap_or(0.0026);
    let fee_rate = Decimal::from_f64_retain(fee).unwrap_or(Decimal::ZERO);
    let report = BacktestRunner::new(fee_rate).run(&closes, threshold);
    V2Server::ok(serde_json::json!({
        "signals_evaluated": report.signals_evaluated,
        "hypothetical_fills": report.hypothetical_fills,
        "net_pnl": report.net_pnl.to_string(),
    }))
}
