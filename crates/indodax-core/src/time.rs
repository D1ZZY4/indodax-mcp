pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn now_secs() -> u64 {
    now_millis() / 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_moves_forward() {
        assert!(now_millis() > 1_000_000_000_000);
        assert!(now_secs() > 1_000_000_000);
    }
}
