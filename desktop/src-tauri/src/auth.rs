use std::path::PathBuf;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub pid: u32,
    pub port: u16,
    pub attestation_secret: String,
}

#[derive(Clone, Debug)]
pub struct Auth {
    home: PathBuf,
    environment_token: Option<String>,
}

impl Auth {
    pub fn new(home: PathBuf) -> Self {
        Self {
            home,
            environment_token: std::env::var("OPENCODEX_ADMIN_AUTH_TOKEN")
                .ok()
                .filter(|value| !value.is_empty()),
        }
    }

    pub fn token(&self) -> Option<String> {
        self.environment_token.clone().or_else(|| {
            std::fs::read_to_string(self.home.join("admin-api-token"))
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
    }

    pub fn runtime_identity(&self) -> Option<RuntimeIdentity> {
        let value = std::fs::read(self.home.join("runtime-port.json")).ok()?;
        let identity: RuntimeIdentity = serde_json::from_slice(&value).ok()?;
        if identity.pid == 0 || identity.attestation_secret.len() != 43 {
            return None;
        }
        Some(identity)
    }

    pub fn user_agent() -> &'static str {
        concat!("OpenCodexDesktop/", env!("CARGO_PKG_VERSION"))
    }
}
