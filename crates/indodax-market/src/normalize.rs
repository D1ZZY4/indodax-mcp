use indodax_core::Symbol;

/// Normalize user input to canonical `base_quote`.
pub fn normalize_symbol(input: &str) -> Option<Symbol> {
    Symbol::parse_flexible(input)
}

/// Candidate spellings for one symbol across REST endpoints.
pub fn pair_variants(symbol: &Symbol) -> (String, String, String) {
    (symbol.as_pair(), symbol.as_compact(), symbol.as_compact().to_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_slash_form() {
        assert_eq!(normalize_symbol("BTC/IDR").unwrap().as_pair(), "btc_idr");
    }

    #[test]
    fn variants_cover_endpoints() {
        let symbol = normalize_symbol("btc_idr").unwrap();
        let (pair, compact, upper) = pair_variants(&symbol);
        assert_eq!(pair, "btc_idr");
        assert_eq!(compact, "btcidr");
        assert_eq!(upper, "BTCIDR");
    }
}
