# Risk

Risk is deterministic and capability-gated. Live trading needs both
`ExecutionMode::Live` and `Capability::TradePlace`. Withdrawal needs the
separate `Capability::FundingWithdraw` and stays disabled by default.
Stale market/account data, duplicates, daily loss, kill switch, circuit
breaker, and halted reconciliation all deny or halt explicitly.
