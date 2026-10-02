use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestReport {
    pub signals_evaluated: usize,
    pub hypothetical_fills: usize,
    pub total_fees: Decimal,
    pub net_pnl: Decimal,
}

/// Deterministic replay over historical closes. Separate from paper.
pub struct BacktestRunner {
    fee_rate: Decimal,
}

impl BacktestRunner {
    pub fn new(fee_rate: Decimal) -> Self {
        Self { fee_rate }
    }

    pub fn run(&self, closes: &[f64], threshold: f64) -> BacktestReport {
        let mut fills = 0_usize;
        let mut pnl = Decimal::ZERO;
        for window in closes.windows(2) {
            let change = (window[1] - window[0]) / window[0].max(1.0);
            if change.abs() >= threshold {
                fills += 1;
                let gross =
                    Decimal::from_f64_retain(change.abs() * 1000.0).unwrap_or(Decimal::ZERO);
                pnl += gross - gross * self.fee_rate;
            }
        }
        BacktestReport {
            signals_evaluated: closes.len().saturating_sub(1),
            hypothetical_fills: fills,
            total_fees: Decimal::ZERO,
            net_pnl: pnl,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_threshold_crosses() {
        let runner = BacktestRunner::new(Decimal::new(26, 4));
        let report = runner.run(&[100.0, 110.0, 111.0], 0.05);
        assert_eq!(report.hypothetical_fills, 1);
    }
}
