/// Endpoint path constants. Raw exchange paths stay here.
pub struct PublicApi;

impl PublicApi {
    pub const SERVER_TIME: &'static str = "/api/server_time";
    pub const PAIRS: &'static str = "/api/pairs";
    pub const TICKER_ALL: &'static str = "/api/ticker_all";
    pub const SUMMARIES: &'static str = "/api/summaries";
    pub const PRICE_INCREMENTS: &'static str = "/api/price_increments";

    pub fn ticker(pair: &str) -> String {
        format!("/api/ticker/{pair}")
    }

    pub fn depth(pair: &str) -> String {
        format!("/api/depth/{pair}")
    }

    pub fn trades(pair: &str) -> String {
        format!("/api/trades/{}", pair.replace('_', ""))
    }
}

pub struct PrivateV1;

impl PrivateV1 {
    pub const URL: &'static str = "https://indodax.com/tapi";
    pub const WS_TOKEN_URL: &'static str = "https://indodax.com/api/private_ws/v1/generate_token";
}

pub struct PrivateV2;

impl PrivateV2 {
    pub const BASE: &'static str = "https://api.indodax.com";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticker_paths() {
        assert_eq!(PublicApi::ticker("btc_idr"), "/api/ticker/btc_idr");
        assert_eq!(PublicApi::trades("btc_idr"), "/api/trades/btcidr");
    }
}
