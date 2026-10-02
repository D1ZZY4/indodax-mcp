use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Decimal money amount with an asset-agnostic value.
/// Currency context lives in `Balance` / `Asset`, not here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct Money(Decimal);

impl Money {
    pub fn new(value: Decimal) -> Self {
        Self(value)
    }

    pub fn zero() -> Self {
        Self(Decimal::ZERO)
    }

    pub fn from_f64(value: f64) -> Option<Self> {
        Decimal::from_f64(value).map(Self)
    }

    pub fn value(self) -> Decimal {
        self.0
    }

    pub fn to_f64(self) -> f64 {
        self.0.to_f64().unwrap_or(0.0)
    }

    pub fn is_zero(self) -> bool {
        self.0.is_zero()
    }

    pub fn is_positive(self) -> bool {
        self.0.is_sign_positive() && !self.0.is_zero()
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<Decimal> for Money {
    fn from(value: Decimal) -> Self {
        Self(value)
    }
}

impl FromStr for Money {
    type Err = rust_decimal::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(Decimal::from_str(s)?))
    }
}

/// Quoted price in quote currency per one unit of base currency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct Price(Decimal);

impl Price {
    pub fn new(value: Decimal) -> Option<Self> {
        if value.is_sign_positive() && !value.is_zero() {
            Some(Self(value))
        } else {
            None
        }
    }

    pub fn from_f64(value: f64) -> Option<Self> {
        let decimal = Decimal::from_f64(value)?;
        Self::new(decimal)
    }

    pub fn value(self) -> Decimal {
        self.0
    }

    pub fn to_f64(self) -> f64 {
        self.0.to_f64().unwrap_or(0.0)
    }
}

impl fmt::Display for Price {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Base-asset quantity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct Quantity(Decimal);

impl Quantity {
    pub fn new(value: Decimal) -> Option<Self> {
        if value.is_sign_positive() && !value.is_zero() {
            Some(Self(value))
        } else {
            None
        }
    }

    pub fn from_f64(value: f64) -> Option<Self> {
        let decimal = Decimal::from_f64(value)?;
        Self::new(decimal)
    }

    pub fn value(self) -> Decimal {
        self.0
    }

    pub fn to_f64(self) -> f64 {
        self.0.to_f64().unwrap_or(0.0)
    }
}

impl fmt::Display for Quantity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Percentage value, e.g. 5.0 means five percent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub struct Percentage(Decimal);

impl Percentage {
    pub fn new(value: Decimal) -> Self {
        Self(value)
    }

    pub fn from_f64(value: f64) -> Option<Self> {
        Decimal::from_f64(value).map(Self)
    }

    pub fn value(self) -> Decimal {
        self.0
    }

    pub fn to_f64(self) -> f64 {
        self.0.to_f64().unwrap_or(0.0)
    }
}

impl fmt::Display for Percentage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}%", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_roundtrip() {
        let money = Money::from_f64(100.5).unwrap();
        assert!(money.is_positive());
        assert!(!money.is_zero());
    }

    #[test]
    fn price_rejects_non_positive() {
        assert!(Price::from_f64(0.0).is_none());
        assert!(Price::from_f64(-5.0).is_none());
        assert!(Price::from_f64(10.0).is_some());
    }

    #[test]
    fn quantity_rejects_non_positive() {
        assert!(Quantity::from_f64(0.0).is_none());
        assert!(Quantity::from_f64(1.5).is_some());
    }
}
