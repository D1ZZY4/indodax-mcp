use hmac::{Hmac, Mac};
use indodax_core::IndodaxError;
use sha2::{Sha256, Sha512};
use std::sync::atomic::{AtomicU64, Ordering};

/// Exchange signer with monotonic millisecond nonce.
/// TAPI v1 uses HMAC-SHA512, TAPI v2 uses HMAC-SHA256.
/// Source: btcid/indodax-official-api-docs (PHP getInfo/openssl
/// examples use sha512 for v1; Python v2 order example uses sha256).
#[derive(Debug)]
pub struct Signer {
    api_key: String,
    secret_key: String,
    last_nonce: AtomicU64,
}

impl Signer {
    pub fn new(api_key: &str, secret_key: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            secret_key: secret_key.to_string(),
            last_nonce: AtomicU64::new(0),
        }
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    pub fn next_nonce(&self) -> u64 {
        let now = indodax_core::now_millis();
        loop {
            let previous = self.last_nonce.load(Ordering::Acquire);
            let next = if now > previous { now } else { previous + 1 };
            if self
                .last_nonce
                .compare_exchange(previous, next, Ordering::Release, Ordering::Relaxed)
                .is_ok()
            {
                return next;
            }
        }
    }

    pub fn next_nonce_string(&self) -> String {
        self.next_nonce().to_string()
    }

    pub fn sign_v1(&self, payload: &str) -> Result<(String, String), IndodaxError> {
        let signature = self.hmac_sha512(payload)?;
        Ok((payload.to_string(), hex::encode(signature)))
    }

    pub fn sign_v2(&self, query: &str) -> Result<String, IndodaxError> {
        Ok(hex::encode(self.hmac_sha256(query)?))
    }

    fn hmac_sha512(&self, data: &str) -> Result<Vec<u8>, IndodaxError> {
        let mut mac = Hmac::<Sha512>::new_from_slice(self.secret_key.as_bytes())
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        mac.update(data.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }

    fn hmac_sha256(&self, data: &str) -> Result<Vec<u8>, IndodaxError> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.secret_key.as_bytes())
            .map_err(|error| IndodaxError::System(error.to_string()))?;
        mac.update(data.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_is_monotonic() {
        let signer = Signer::new("key", "secret");
        let first = signer.next_nonce();
        let second = signer.next_nonce();
        assert!(second > first);
    }

    #[test]
    fn v1_uses_sha512_v2_uses_sha256() {
        let signer = Signer::new("key", "secret");
        let (_, v1) = signer.sign_v1("method=test").unwrap();
        let v2 = signer.sign_v2("a=b").unwrap();
        assert_eq!(hex::decode(v1).unwrap().len(), 64);
        assert_eq!(hex::decode(v2).unwrap().len(), 32);
        assert_ne!(signer.hmac_sha512("same").unwrap(), signer.hmac_sha256("same").unwrap());
    }

    #[test]
    fn different_secrets_differ() {
        let first = Signer::new("key", "one").sign_v2("x").unwrap();
        let second = Signer::new("key", "two").sign_v2("x").unwrap();
        assert_ne!(first, second);
    }
}
