use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Canonical asset code, always lowercase (`btc`, `idr`, `usdt`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Asset(String);

impl Asset {
    pub fn new(code: &str) -> Option<Self> {
        let normalized = code.trim().to_lowercase();
        if normalized.is_empty()
            || normalized.len() > 16
            || !normalized.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return None;
        }
        Some(Self(normalized))
    }

    pub fn idr() -> Self {
        Self("idr".to_string())
    }

    pub fn code(&self) -> &str {
        &self.0
    }

    pub fn is_fiat_or_stable(&self) -> bool {
        matches!(self.0.as_str(), "idr" | "usdt" | "usdc" | "dai" | "busd" | "tusd")
    }
}

impl fmt::Display for Asset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for Asset {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s).ok_or_else(|| format!("invalid asset code: {s}"))
    }
}

/// Canonical trading pair `base_quote`, both lowercase (`btc_idr`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Symbol {
    base: Asset,
    quote: Asset,
}

impl Symbol {
    pub fn new(base: Asset, quote: Asset) -> Self {
        Self { base, quote }
    }

    pub fn parse(pair: &str) -> Option<Self> {
        let normalized = pair.trim().to_lowercase().replace(['-', '/'], "_");
        let mut parts = normalized.split('_');
        let base = parts.next()?;
        let quote = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        Some(Self { base: Asset::new(base)?, quote: Asset::new(quote)? })
    }

    /// Parse compact `btcidr` by matching a known quote suffix.
    pub fn parse_flexible(pair: &str) -> Option<Self> {
        if let Some(symbol) = Self::parse(pair) {
            return Some(symbol);
        }
        let compact = pair.trim().to_lowercase().replace(['-', '/', '_'], "");
        for quote in ["usdt", "usdc", "idr", "btc", "eth"] {
            if let Some(base) = compact.strip_suffix(quote) {
                if base.is_empty() {
                    continue;
                }
                let base = Asset::new(base)?;
                let quote = Asset::new(quote)?;
                return Some(Self { base, quote });
            }
        }
        None
    }

    pub fn base(&self) -> &Asset {
        &self.base
    }

    pub fn quote(&self) -> &Asset {
        &self.quote
    }

    /// Canonical `base_quote` form.
    pub fn as_pair(&self) -> String {
        format!("{}_{}", self.base, self.quote)
    }

    /// Compact v2 form (`btcidr`).
    pub fn as_compact(&self) -> String {
        format!("{}{}", self.base, self.quote)
    }
}

impl fmt::Display for Symbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_pair())
    }
}

impl FromStr for Symbol {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse_flexible(s).ok_or_else(|| format!("invalid symbol: {s}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_normalizes_case() {
        assert_eq!(Asset::new("BTC").unwrap().code(), "btc");
        assert!(Asset::new("").is_none());
    }

    #[test]
    fn symbol_parses_separators() {
        assert_eq!(Symbol::parse("btc/idr").unwrap().as_pair(), "btc_idr");
        assert_eq!(Symbol::parse("BTC-IDR").unwrap().as_pair(), "btc_idr");
    }

    #[test]
    fn symbol_parses_compact() {
        assert_eq!(Symbol::parse_flexible("btcidr").unwrap().as_pair(), "btc_idr");
    }
}
