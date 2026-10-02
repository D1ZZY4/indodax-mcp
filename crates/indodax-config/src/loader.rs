use crate::model::{Credentials, RuntimeConfig};
use indodax_core::IndodaxError;

/// Resolve credentials with explicit priority:
/// explicit args > environment > config file values passed in.
pub fn resolve_credentials(
    cli_key: Option<String>,
    cli_secret: Option<String>,
    env_key: Option<String>,
    env_secret: Option<String>,
    file_key: Option<String>,
    file_secret: Option<String>,
) -> Result<Option<Credentials>, IndodaxError> {
    let key = first_non_empty([cli_key, env_key, file_key]);
    let secret = first_non_empty([cli_secret, env_secret, file_secret]);
    match (key, secret) {
        (Some(api_key), Some(api_secret)) => {
            let creds = Credentials { api_key, api_secret };
            if creds.is_complete() {
                Ok(Some(creds))
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

fn first_non_empty(values: [Option<String>; 3]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

/// Load TOML runtime config from text.
pub fn load_runtime_config(text: &str) -> Result<RuntimeConfig, IndodaxError> {
    toml::from_str(text).map_err(|error| IndodaxError::Validation(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_overrides_env() {
        let creds = resolve_credentials(
            Some("cli".into()),
            Some("secret".into()),
            Some("env".into()),
            Some("env-secret".into()),
            None,
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(creds.api_key, "cli");
    }

    #[test]
    fn partial_credentials_yield_none() {
        let result =
            resolve_credentials(Some("only-key".into()), None, None, None, None, None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn toml_config_loads() {
        let config = load_runtime_config("mode = \"paper\"\nrate_limit_rps = 5\n").unwrap();
        assert_eq!(config.rate_limit_rps, 5);
    }
}
