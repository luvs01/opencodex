use crate::{
    auth::{Auth, RuntimeIdentity},
    discovery::ProxyEndpoint,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use reqwest::{Client, Method, StatusCode};
use serde_json::Value;
use sha2::Sha256;
use std::time::Duration;

#[derive(Clone)]
pub struct ProxyClient {
    client: Client,
    endpoint: ProxyEndpoint,
    auth: Auth,
}

#[derive(Debug)]
pub enum ProxyError {
    Unreachable,
    Unauthorized,
    Http(StatusCode),
    Decode(reqwest::Error),
}

impl ProxyClient {
    pub fn new(endpoint: ProxyEndpoint, auth: Auth) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(4))
                .user_agent(Auth::user_agent())
                .build()?,
            endpoint,
            auth,
        })
    }

    pub fn endpoint(&self) -> ProxyEndpoint {
        self.endpoint
    }

    pub async fn is_alive(&self) -> Result<Value, ProxyError> {
        self.get("/healthz").await
    }

    pub async fn companion_settings(&self) -> Result<Value, ProxyError> {
        self.get("/api/companion/settings").await
    }

    pub async fn usage_summary(&self) -> Result<Value, ProxyError> {
        self.get("/api/usage?range=7d").await
    }

    pub async fn usage_today(&self) -> Result<Value, ProxyError> {
        self.get("/api/usage?range=today").await
    }

    pub async fn startup_health(&self) -> Result<Value, ProxyError> {
        self.get("/api/startup-health").await
    }

    pub async fn quotas(&self) -> Result<Value, ProxyError> {
        self.get("/api/provider-quotas").await
    }

    pub async fn timeline(&self, query: &str) -> Result<Value, ProxyError> {
        self.get(&format!("/api/usage/timeline?{query}")).await
    }

    pub async fn stop(&self) -> Result<Value, ProxyError> {
        self.request(Method::POST, "/api/stop").await
    }

    async fn get(&self, path: &str) -> Result<Value, ProxyError> {
        self.request(Method::GET, path).await
    }

    async fn request(&self, method: Method, path: &str) -> Result<Value, ProxyError> {
        let response = self.send(&method, path, None).await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            self.authenticate_target().await?;
            let token = self.auth.token().ok_or(ProxyError::Unauthorized)?;
            let response = self.send(&method, path, Some(token)).await?;
            return decode(response).await;
        }
        decode(response).await
    }

    async fn authenticate_target(&self) -> Result<(), ProxyError> {
        let identity = self
            .auth
            .runtime_identity()
            .ok_or(ProxyError::Unauthorized)?;
        if identity.port != self.endpoint.port {
            return Err(ProxyError::Unauthorized);
        }
        let mut challenge_bytes = [0_u8; 32];
        challenge_bytes[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        challenge_bytes[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(challenge_bytes);
        let response = self
            .client
            .get(self.endpoint.url("/healthz"))
            .header("x-opencodex-attestation-challenge", &challenge)
            .send()
            .await
            .map_err(map_request_error)?;
        let proof = response
            .headers()
            .get("x-opencodex-attestation-proof")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let health: Value = decode(response).await?;
        if health.get("service").and_then(Value::as_str) != Some("opencodex")
            || health.get("pid").and_then(Value::as_u64) != Some(identity.pid.into())
            || health.get("port").and_then(Value::as_u64) != Some(identity.port.into())
            || !valid_attestation_proof(&identity, &challenge, proof.as_deref())
            || self.auth.runtime_identity().as_ref() != Some(&identity)
        {
            return Err(ProxyError::Unauthorized);
        }
        Ok(())
    }

    async fn send(
        &self,
        method: &Method,
        path: &str,
        token: Option<String>,
    ) -> Result<reqwest::Response, ProxyError> {
        let mut request = self.client.request(method.clone(), self.endpoint.url(path));
        if let Some(value) = token {
            request = request.header("X-OpenCodex-API-Key", value);
        }
        request.send().await.map_err(map_request_error)
    }
}

fn valid_attestation_proof(
    identity: &RuntimeIdentity,
    challenge: &str,
    proof: Option<&str>,
) -> bool {
    let Ok(secret) = URL_SAFE_NO_PAD.decode(&identity.attestation_secret) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&secret) else {
        return false;
    };
    mac.update(
        format!(
            "opencodex-local-management-v1\n{challenge}\n{}\n{}",
            identity.pid, identity.port
        )
        .as_bytes(),
    );
    proof
        .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
        .is_some_and(|value| mac.verify_slice(&value).is_ok())
}

fn map_request_error(error: reqwest::Error) -> ProxyError {
    if error.is_connect() {
        ProxyError::Unreachable
    } else {
        ProxyError::Decode(error)
    }
}

async fn decode(response: reqwest::Response) -> Result<Value, ProxyError> {
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(ProxyError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(ProxyError::Http(response.status()));
    }
    response.json().await.map_err(ProxyError::Decode)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> RuntimeIdentity {
        RuntimeIdentity {
            pid: 4242,
            port: 10100,
            attestation_secret: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc".into(),
        }
    }

    #[test]
    fn accepts_only_a_proof_bound_to_the_runtime_identity() {
        let challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let proof = "T2FWKlQv-CS_ygbwmxZ5QRJtpqmM7J8i4IQ_LEaW1vg";
        assert!(valid_attestation_proof(&identity(), challenge, Some(proof)));

        let mut replacement = identity();
        replacement.pid += 1;
        assert!(!valid_attestation_proof(
            &replacement,
            challenge,
            Some(proof)
        ));
        assert!(!valid_attestation_proof(&identity(), challenge, None));
    }
}
