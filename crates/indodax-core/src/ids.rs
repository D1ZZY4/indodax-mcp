use serde::{Deserialize, Serialize};
use std::fmt;

/// Strongly typed identifiers so order, trade, position, and execution
/// ids cannot be confused at call sites.
macro_rules! string_id {
    ($name:ident) => {
        #[derive(
            Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default,
        )]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Option<Self> {
                let value = value.into();
                if value.trim().is_empty() || value.len() > 128 {
                    return None;
                }
                Some(Self(value))
            }

            pub fn value(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

string_id!(OrderId);
string_id!(TradeId);
string_id!(PositionId);
string_id!(ExecutionId);

/// Numeric exchange order id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ExchangeOrderId(pub u64);

impl fmt::Display for ExchangeOrderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_reject_blank() {
        assert!(OrderId::new("").is_none());
        assert!(OrderId::new("abc-1").is_some());
    }
}
