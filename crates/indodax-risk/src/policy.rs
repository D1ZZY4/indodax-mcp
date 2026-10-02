use indodax_core::Capability;

/// Default autonomous-agent posture:
/// reads allowed, trading controlled, withdrawal disabled.
pub fn default_agent_capabilities() -> Vec<Capability> {
    vec![
        Capability::MarketRead,
        Capability::AccountRead,
        Capability::PaperTrade,
        Capability::RiskRead,
        Capability::AuditRead,
        Capability::SystemRead,
    ]
}

pub fn withdrawal_requires_explicit_opt_in(granted: &[Capability]) -> bool {
    !granted.contains(&Capability::FundingWithdraw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn withdrawal_not_in_defaults() {
        assert!(!default_agent_capabilities().contains(&Capability::FundingWithdraw));
        assert!(withdrawal_requires_explicit_opt_in(&default_agent_capabilities()));
    }
}
