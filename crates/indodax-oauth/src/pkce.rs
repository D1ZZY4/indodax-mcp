use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut buffer);
    hex::encode(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_stable() {
        let first = pkce_challenge("verifier-123");
        assert_eq!(first, pkce_challenge("verifier-123"));
        assert!(!first.contains('='));
    }

    #[test]
    fn tokens_differ() {
        assert_ne!(random_token(16), random_token(16));
    }
}
