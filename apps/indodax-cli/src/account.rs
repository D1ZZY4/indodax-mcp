use super::*;
use crate::commands::account::{AccountAction, AccountArgs};
use indodax_account::AccountService;

pub async fn run(rest: Arc<IndodaxRest>, args: &AccountArgs) -> Result<()> {
    let service = AccountService::new(&rest);
    match &args.action {
        AccountAction::Info => {
            let info = service.info().await?;
            println!("account: {} balances: {}", info.name, info.portfolio.balances.len());
            Ok(())
        }
        AccountAction::Balance => {
            let info = service.info().await?;
            let mut table = comfy_table::Table::new();
            table.set_header(["Asset", "Available"]);
            for (code, balance) in &info.portfolio.balances {
                table.add_row([code, &balance.available.to_string()]);
            }
            println!("{table}");
            Ok(())
        }
        AccountAction::OpenOrders { pair } => {
            let orders = service.open_orders_raw(pair.as_deref()).await?;
            println!("{}", serde_json::to_string_pretty(&orders)?);
            Ok(())
        }
    }
}
