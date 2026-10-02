use indodax_api::rest::IndodaxRest;
use indodax_auth::Signer;
use std::collections::HashMap;

/// Read-only live check. Credentials come from process env only.
/// This file contains no secrets and never prints any.
#[tokio::main]
async fn main() {
    if std::env::var("INDODAX_API_KEY").is_err() || std::env::var("INDODAX_API_SECRET").is_err() {
        eprintln!("credentials missing from environment");
        std::process::exit(2);
    }

    let public = IndodaxRest::public_client(5).expect("public client builds");
    let time: serde_json::Value =
        public.public_get("/api/server_time").await.expect("server_time responds");
    println!("server_time ok: {time}");

    let key = std::env::var("INDODAX_API_KEY").expect("key present");
    let secret = std::env::var("INDODAX_API_SECRET").expect("secret present");
    let authed = IndodaxRest::new(Some(Signer::new(&key, &secret)), 5).expect("client builds");

    match authed.private_post_v1::<serde_json::Value>("getInfo", &HashMap::new()).await {
        Ok(info) => {
            let name = info.get("name").and_then(|name| name.as_str()).unwrap_or("?");
            println!("v1 getInfo ok for account: {name}");
        }
        Err(error) => println!("v1 getInfo denied: {error}"),
    }

    // TAPI v2 uses HMAC-SHA256 against api.indodax.com.
    let timestamp = indodax_core::now_millis().to_string();
    let mut parts = [
        "omitZeroBalances=true".to_string(),
        format!("timestamp={timestamp}"),
        "recvWindow=5000".to_string(),
    ];
    parts.sort();
    let query = parts.join("&");
    let signature = Signer::new(&key, &secret).sign_v2(&query).expect("v2 signature");
    let url = format!("https://api.indodax.com/api/v2/account?{query}");
    let response = reqwest::Client::new()
        .get(&url)
        .header("X-APIKEY", &key)
        .header("Sign", &signature)
        .send()
        .await
        .expect("v2 account responds");
    drop(key);
    drop(secret);
    drop(signature);
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let preview: String = body.chars().take(300).collect();
    println!("v2 account status: {status} body: {preview}");
}
