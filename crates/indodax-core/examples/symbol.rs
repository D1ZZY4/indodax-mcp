use indodax_core::Symbol;
use std::str::FromStr;

fn main() {
    let symbol = Symbol::from_str("btc_idr").expect("valid symbol");
    println!("pair: {}", symbol.as_pair());
    println!("compact: {}", symbol.as_compact());
}
