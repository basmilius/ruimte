use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{
    Signature, Signer, SigningKey, Verifier, VerifyingKey,
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, RwLock, broadcast};

use crate::{
    PROTOCOL_VERSION, VERSION,
    config::BrokerOverride,
    events::EventBus,
    rpc::{ClientAccess, RequestContext, RpcError, RpcResult},
};

const PAIRING_TTL_MS: u64 = 10 * 60 * 1000;
const CHALLENGE_TTL_MS: u64 = 60 * 1000;
const TICKET_TTL_MS: u64 = 12 * 60 * 60 * 1000;
const TICKETS_PER_SESSION: usize = 8;
const MAX_OPEN_CHALLENGES: usize = 512;
const DEFAULT_BROKER_URL: &str = "wss://broker.ruimte.app";

#[derive(Clone)]
pub struct AuthService {
    inner: Arc<AuthInner>,
}

pub enum StatementAdmission {
    Admitted { session_id: String, created: bool },
    Refused(&'static str),
}

struct AuthInner {
    home: PathBuf,
    local_secret: String,
    store: Mutex<AuthState>,
    volatile: StdMutex<VolatileAuth>,
    identity: RwLock<EndpointIdentity>,
    events: EventBus,
    advertised: RwLock<AdvertisedAddress>,
    broker_override: RwLock<(BrokerOverride, Option<String>)>,
    revocations: broadcast::Sender<String>,
}

#[derive(Clone, Debug)]
struct AdvertisedAddress {
    host: String,
    port: u16,
}

struct BrokerDescription {
    url: Option<String>,
    fixed: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthState {
    sessions: Vec<SessionRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    spent_nonces: Vec<SpentNonce>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    revoked_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRecord {
    id: String,
    label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    public_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    origin: Option<String>,
    created_at: u64,
    last_seen_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    push: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SpentNonce {
    nonce: String,
    until: u64,
}

#[derive(Default)]
struct VolatileAuth {
    pairing: Option<ExpiringToken>,
    challenges: Vec<(String, Challenge)>,
    tickets: Vec<(String, Ticket)>,
}

#[derive(Clone)]
struct ExpiringToken {
    hash: String,
    expires_at: u64,
}

struct Challenge {
    expires_at: u64,
}

struct Ticket {
    session_id: String,
    expires_at: u64,
}

#[derive(Clone)]
struct EndpointIdentity {
    path: PathBuf,
    id: String,
    public_key: String,
    signing_key: SigningKey,
    default_name: String,
    name: Option<String>,
    icon: Option<Value>,
    agents_delete_any_view: bool,
    refuse_statements: bool,
    streaming_allowed: bool,
    broker: Value,
}

struct EndpointFile {
    id: String,
    public_key: Option<String>,
    private_key: Option<String>,
    name: Option<String>,
    icon: Option<Value>,
    agents_delete_any_view: Option<bool>,
    refuse_statements: Option<bool>,
    streaming_allowed: Option<bool>,
    broker: Option<Value>,
}

#[derive(Deserialize)]
struct PairPayload {
    token: String,
    label: String,
    #[serde(rename = "publicKey")]
    public_key: Option<String>,
}

#[derive(Deserialize)]
struct TicketPayload {
    #[serde(rename = "publicKey")]
    public_key: String,
    challenge: String,
    signature: String,
}

impl AuthService {
    pub async fn new(home: PathBuf, events: EventBus, label: String) -> Result<Self> {
        tokio::fs::create_dir_all(&home).await?;
        set_directory_permissions(&home).await?;
        let local_secret = read_or_create_local_secret(&home).await?;
        let store = read_auth_state(&home.join("auth.json")).await;
        let identity = read_or_create_identity(&home, label).await?;
        let (revocations, _) = broadcast::channel(64);
        Ok(Self {
            inner: Arc::new(AuthInner {
                home,
                local_secret,
                store: Mutex::new(store),
                volatile: StdMutex::new(VolatileAuth::default()),
                identity: RwLock::new(identity),
                events,
                advertised: RwLock::new(AdvertisedAddress {
                    host: "127.0.0.1".to_owned(),
                    port: 0,
                }),
                broker_override: RwLock::new((BrokerOverride::Inherit, None)),
                revocations,
            }),
        })
    }

    pub fn local_secret(&self) -> &str {
        &self.inner.local_secret
    }

    pub async fn set_advertised_address(&self, host: String, port: u16) {
        *self.inner.advertised.write().await = AdvertisedAddress { host, port };
    }

    pub async fn set_broker_override(&self, broker: BrokerOverride, advertise: Option<String>) {
        *self.inner.broker_override.write().await = (broker, advertise);
    }

    pub fn subscribe_revocations(&self) -> broadcast::Receiver<String> {
        self.inner.revocations.subscribe()
    }

    pub async fn is_session_active(&self, session_id: &str) -> bool {
        self.inner
            .store
            .lock()
            .await
            .sessions
            .iter()
            .any(|session| session.id == session_id)
    }

    pub async fn streaming_allowed(&self) -> bool {
        self.inner.identity.read().await.streaming_allowed
    }

    pub async fn endpoint_id(&self) -> String {
        self.inner.identity.read().await.id.clone()
    }

    pub async fn endpoint_public_key(&self) -> String {
        self.inner.identity.read().await.public_key.clone()
    }

    pub async fn refuses_statements(&self) -> bool {
        self.inner.identity.read().await.refuse_statements
    }

    pub async fn is_public_key_paired(&self, public_key: &str) -> bool {
        self.inner
            .store
            .lock()
            .await
            .sessions
            .iter()
            .any(|record| record.public_key.as_deref() == Some(public_key))
    }

    pub async fn broker_dial_url(&self) -> Option<String> {
        let identity = self.inner.identity.read().await;
        self.broker_description(&identity).await.url
    }

    pub fn verify_message(public_key: &str, message: &str, signature: &str) -> bool {
        parse_public_key(public_key)
            .zip(decode_signature(signature))
            .is_some_and(|(key, signature)| key.verify(message.as_bytes(), &signature).is_ok())
    }

    pub async fn sign_message(&self, message: &str) -> String {
        self.inner.identity.read().await.sign(message)
    }

    pub async fn authenticate_signed_key(
        &self,
        public_key: &str,
        message: &str,
        signature: &str,
    ) -> Option<(String, String)> {
        let key = parse_public_key(public_key)?;
        let signature = decode_signature(signature)?;
        key.verify(message.as_bytes(), &signature).ok()?;
        let session_id = self
            .inner
            .store
            .lock()
            .await
            .sessions
            .iter()
            .find(|record| record.public_key.as_deref() == Some(public_key))?
            .id
            .clone();
        let ticket = self.issue_ticket(session_id.clone());
        Some((session_id, ticket))
    }

    pub async fn admit_statement(
        &self,
        public_key: &str,
        label: &str,
        nonce: &str,
        keep_nonce_until: u64,
    ) -> Result<StatementAdmission, RpcError> {
        if parse_public_key(public_key).is_none() {
            return Ok(StatementAdmission::Refused("bad-key"));
        }
        let now = now_ms();
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        next.spent_nonces.retain(|spent| spent.until >= now);
        if next.spent_nonces.iter().any(|spent| spent.nonce == nonce) {
            return Ok(StatementAdmission::Refused("replayed"));
        }
        next.spent_nonces.push(SpentNonce {
            nonce: nonce.to_owned(),
            until: keep_nonce_until,
        });
        if next.revoked_keys.iter().any(|key| key == public_key) {
            self.persist_auth(&next)
                .await
                .map_err(|error| RpcError::new("internal", error.to_string()))?;
            *state = next;
            return Ok(StatementAdmission::Refused("revoked"));
        }
        if let Some(record) = next
            .sessions
            .iter_mut()
            .find(|record| record.public_key.as_deref() == Some(public_key))
        {
            record.last_seen_at = now;
            let session_id = record.id.clone();
            self.persist_auth(&next)
                .await
                .map_err(|error| RpcError::new("internal", error.to_string()))?;
            *state = next;
            return Ok(StatementAdmission::Admitted {
                session_id,
                created: false,
            });
        }
        let record = SessionRecord {
            id: random_token(6),
            label: label.to_owned(),
            token_hash: None,
            public_key: Some(public_key.to_owned()),
            origin: Some("statement".to_owned()),
            created_at: now,
            last_seen_at: now,
            push: None,
        };
        let session_id = record.id.clone();
        next.sessions.push(record);
        self.persist_auth(&next)
            .await
            .map_err(|error| RpcError::new("internal", error.to_string()))?;
        *state = next;
        Ok(StatementAdmission::Admitted {
            session_id,
            created: true,
        })
    }

    pub async fn set_push(&self, session_id: &str, subscription: Value) -> Result<bool, RpcError> {
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        let Some(record) = next
            .sessions
            .iter_mut()
            .find(|record| record.id == session_id && record.public_key.is_some())
        else {
            return Ok(false);
        };
        record.push = Some(subscription);
        self.persist_auth(&next)
            .await
            .map_err(|error| RpcError::new("internal", error.to_string()))?;
        *state = next;
        Ok(true)
    }

    pub async fn remove_push(&self, session_id: &str, handle: &str) -> Result<(), RpcError> {
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        if let Some(record) = next.sessions.iter_mut().find(|record| {
            record.id == session_id
                && record
                    .push
                    .as_ref()
                    .and_then(|push| push.get("handle"))
                    .and_then(Value::as_str)
                    == Some(handle)
        }) {
            record.push = None;
            self.persist_auth(&next)
                .await
                .map_err(|error| RpcError::new("internal", error.to_string()))?;
            *state = next;
        }
        Ok(())
    }

    pub async fn push_subscriptions(&self) -> Vec<(String, Value)> {
        self.inner
            .store
            .lock()
            .await
            .sessions
            .iter()
            .filter_map(|record| {
                record
                    .public_key
                    .as_ref()
                    .zip(record.push.as_ref())
                    .map(|(_, push)| (record.id.clone(), push.clone()))
            })
            .collect()
    }

    pub fn issue_pairing_token(&self) -> String {
        let token = random_token(24);
        self.inner
            .volatile
            .lock()
            .expect("auth lock poisoned")
            .pairing = Some(ExpiringToken {
            hash: hash(&token),
            expires_at: now_ms() + PAIRING_TTL_MS,
        });
        token
    }

    pub async fn pairing_url(&self) -> String {
        let address = self.inner.advertised.read().await.clone();
        let host = if address.host == "0.0.0.0" || address.host == "::" {
            host_name()
        } else if address.host.contains(':') && !address.host.starts_with('[') {
            format!("[{}]", address.host)
        } else {
            address.host
        };
        format!(
            "http://{host}:{}/pair#{}",
            address.port,
            self.issue_pairing_token()
        )
    }

    pub async fn pair_http(
        &self,
        payload: Value,
        reachability: &str,
    ) -> Result<Value, HttpAuthError> {
        let payload: PairPayload = serde_json::from_value(payload)
            .map_err(|_| HttpAuthError::bad_request("Bad pairing request"))?;
        if payload.token.is_empty() || payload.label.is_empty() || utf16_len(&payload.label) > 80 {
            return Err(HttpAuthError::bad_request("Bad pairing request"));
        }
        let paired = self.pair(payload).await?;
        let mut result = Map::new();
        if let Some(token) = paired.session_token {
            result.insert("sessionToken".to_owned(), Value::String(token));
        }
        result.insert(
            "endpoint".to_owned(),
            self.endpoint_info(reachability, true).await,
        );
        Ok(Value::Object(result))
    }

    async fn pair(&self, payload: PairPayload) -> Result<Paired, HttpAuthError> {
        let pairing = {
            let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
            let Some(pairing) = auth.pairing.as_ref() else {
                return Err(HttpAuthError::unauthorized(
                    "That pairing link is used or expired. Ask for a new one.",
                ));
            };
            let valid =
                now_ms() <= pairing.expires_at && same_hash(&hash(&payload.token), &pairing.hash);
            if valid { auth.pairing.take() } else { None }
        };
        let Some(pairing) = pairing else {
            return Err(HttpAuthError::unauthorized(
                "That pairing link is used or expired. Ask for a new one.",
            ));
        };
        let keyed = payload
            .public_key
            .as_deref()
            .and_then(parse_public_key)
            .is_some();
        let session_token = (!keyed).then(|| random_token(32));
        let now = now_ms();
        let record = SessionRecord {
            id: random_token(6),
            label: payload.label,
            token_hash: session_token.as_deref().map(hash),
            public_key: keyed.then_some(payload.public_key.unwrap_or_default()),
            origin: Some("link".to_owned()),
            created_at: now,
            last_seen_at: now,
            push: None,
        };
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        if let Some(public_key) = record.public_key.as_ref() {
            next.revoked_keys.retain(|key| key != public_key);
        }
        next.sessions.push(record.clone());
        if let Err(error) = self.persist_auth(&next).await {
            let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
            if auth.pairing.is_none() {
                auth.pairing = Some(pairing);
            }
            return Err(HttpAuthError::internal(error));
        }
        *state = next;
        Ok(Paired {
            session_id: record.id,
            session_token,
        })
    }

    pub async fn challenge(&self) -> Value {
        let challenge = random_token(32);
        {
            let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
            sweep(&mut auth);
            let excess = auth
                .challenges
                .len()
                .saturating_sub(MAX_OPEN_CHALLENGES - 1);
            if excess > 0 {
                auth.challenges.drain(..excess);
            }
            auth.challenges.push((
                challenge.clone(),
                Challenge {
                    expires_at: now_ms() + CHALLENGE_TTL_MS,
                },
            ));
        }
        let identity = self.inner.identity.read().await;
        let message = format!("ruimte-daemon-v1\n{}\n{challenge}", identity.id);
        json!({
            "challenge": challenge,
            "daemon": {
                "id": identity.id,
                "publicKey": identity.public_key,
                "signature": identity.sign(&message),
            }
        })
    }

    pub async fn redeem_ticket(&self, payload: Value) -> Result<Value, HttpAuthError> {
        let payload: TicketPayload = serde_json::from_value(payload)
            .map_err(|_| HttpAuthError::bad_request("Bad ticket request"))?;
        let spent = {
            let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
            let position = auth
                .challenges
                .iter()
                .position(|(value, _)| value == &payload.challenge);
            position.map(|position| auth.challenges.remove(position).1)
        };
        if spent.is_none_or(|entry| now_ms() > entry.expires_at) {
            return Err(HttpAuthError::unauthorized(
                "This machine does not recognize that signature. Pair again.",
            ));
        }
        let key = parse_public_key(&payload.public_key).ok_or_else(|| {
            HttpAuthError::unauthorized(
                "This machine does not recognize that signature. Pair again.",
            )
        })?;
        let signature = decode_signature(&payload.signature).ok_or_else(|| {
            HttpAuthError::unauthorized(
                "This machine does not recognize that signature. Pair again.",
            )
        })?;
        let identity = self.inner.identity.read().await;
        let message = format!(
            "ruimte-client-v1\n{}\n{}\n{}",
            identity.id, payload.challenge, payload.public_key
        );
        drop(identity);
        if key.verify(message.as_bytes(), &signature).is_err() {
            return Err(HttpAuthError::unauthorized(
                "This machine does not recognize that signature. Pair again.",
            ));
        }
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        let Some(record) = next
            .sessions
            .iter_mut()
            .find(|record| record.public_key.as_deref() == Some(&payload.public_key))
        else {
            return Err(HttpAuthError::unauthorized(
                "This machine does not recognize that signature. Pair again.",
            ));
        };
        record.token_hash = None;
        record.last_seen_at = now_ms();
        let session_id = record.id.clone();
        self.persist_auth(&next)
            .await
            .map_err(HttpAuthError::internal)?;
        *state = next;
        let ticket = self.issue_ticket(session_id);
        Ok(json!({ "ticket": ticket, "expiresIn": TICKET_TTL_MS }))
    }

    pub async fn authenticate(&self, token: &str, reachability: String) -> Option<ClientAccess> {
        if constant_time_secret(token, &self.inner.local_secret) {
            return Some(ClientAccess {
                reachability,
                session_id: None,
            });
        }
        if let Some(session_id) = self.ticket_session(token) {
            return Some(ClientAccess {
                reachability,
                session_id: Some(session_id),
            });
        }
        let wanted = hash(token);
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        let record = next.sessions.iter_mut().find(|entry| {
            entry
                .token_hash
                .as_deref()
                .is_some_and(|stored| same_hash(stored, &wanted))
        })?;
        record.last_seen_at = now_ms();
        let session_id = record.id.clone();
        if self.persist_auth(&next).await.is_ok() {
            *state = next;
        }
        Some(ClientAccess {
            reachability,
            session_id: Some(session_id),
        })
    }

    pub async fn endpoint_info(&self, reachability: &str, authenticated: bool) -> Value {
        let identity = self.inner.identity.read().await;
        let broker = self.broker_description(&identity).await;
        identity.info(reachability, authenticated, &broker)
    }

    pub async fn sign_link_request(&self) -> Value {
        let identity = self.inner.identity.read().await;
        let broker = self.broker_description(&identity).await;
        let issued_at = now_ms();
        let name = truncate_utf16(&identity.label(), 80);
        let fields =
            serde_json::to_string(&json!([identity.id, identity.public_key, name, issued_at]))
                .expect("registration fields serialize");
        let message = format!("pulsar-device-link-start-v1\n{fields}");
        json!({
            "id": identity.id,
            "name": name,
            "icon": identity.icon,
            "brokerUrl": broker.url,
            "publicKey": identity.public_key,
            "issuedAt": issued_at,
            "signature": identity.sign(&message),
        })
    }

    pub async fn sign_registration_http(&self, account_id: &str) -> Result<Value, RpcError> {
        let payload = self
            .sign_registration(json!({ "accountId": account_id }))
            .await?;
        Ok(payload.get("registration").cloned().unwrap_or(Value::Null))
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        match method {
            "server.hello" => Some(Ok(json!({
                "version": VERSION,
                "platform": wire_platform(),
                "home": self.inner.home,
            }))),
            "server.ping" => Some(Ok(json!({ "time": now_ms() }))),
            "endpoint.info" => Some(Ok(self
                .endpoint_info(
                    &context.access.reachability,
                    context.access.session_id.is_some(),
                )
                .await)),
            "endpoint.setIdentity" => Some(self.set_identity(payload, context).await),
            "endpoint.signRegistration" => Some(self.sign_registration(payload).await),
            "auth.sessions" => Some(Ok(self
                .sessions(context.access.session_id.as_deref())
                .await)),
            "auth.revoke" => Some(self.revoke(payload).await),
            "auth.pairingToken" => Some(if context.access.session_id.is_none() {
                Ok(json!({ "url": self.pairing_url().await }))
            } else {
                Err(RpcError::new(
                    "forbidden",
                    "Only the app on this machine can make a pairing link",
                ))
            }),
            "auth.registerKey" => Some(
                self.register_key(payload, context.access.session_id.as_deref())
                    .await,
            ),
            _ => None,
        }
    }

    async fn set_identity(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let object = payload.as_object().ok_or_else(|| {
            RpcError::new("bad-request", "Invalid payload for endpoint.setIdentity")
        })?;
        let name = match object.get("name") {
            Some(Value::Null) => None,
            Some(Value::String(name)) if !name.is_empty() && utf16_len(name) <= 80 => {
                Some(name.clone())
            }
            _ => {
                return Err(RpcError::new(
                    "bad-request",
                    "Invalid payload for endpoint.setIdentity",
                ));
            }
        };
        let icon = object.get("icon").cloned().filter(|value| !value.is_null());
        let mut identity = self.inner.identity.write().await;
        identity.name = name;
        identity.icon = icon;
        if let Some(value) = object.get("agentsDeleteAnyView").and_then(Value::as_bool) {
            identity.agents_delete_any_view = value;
        }
        if let Some(value) = object.get("refuseStatements").and_then(Value::as_bool) {
            identity.refuse_statements = value;
        }
        if let Some(value) = object.get("streamingAllowed").and_then(Value::as_bool) {
            identity.streaming_allowed = value;
        }
        if let Some(value) = object.get("broker") {
            identity.broker = value.clone();
        }
        identity
            .persist()
            .await
            .map_err(|error| RpcError::new("internal", error.to_string()))?;
        let result = identity.info(
            &context.access.reachability,
            context.access.session_id.is_some(),
            &self.broker_description(&identity).await,
        );
        let changed = identity.changed_event(&self.broker_description(&identity).await);
        drop(identity);
        self.inner.events.broadcast("endpoint.changed", changed);
        Ok(result)
    }

    async fn sign_registration(&self, payload: Value) -> RpcResult {
        let account_id = payload
            .get("accountId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && utf16_len(value) <= 64)
            .ok_or_else(|| {
                RpcError::new(
                    "bad-request",
                    "Invalid payload for endpoint.signRegistration",
                )
            })?;
        let identity = self.inner.identity.read().await;
        let broker = self.broker_description(&identity).await;
        let issued_at = now_ms();
        let name = truncate_utf16(&identity.label(), 80);
        let fields = serde_json::to_string(&json!([
            account_id,
            identity.id,
            identity.public_key,
            name,
            issued_at
        ]))
        .map_err(|error| RpcError::new("internal", error.to_string()))?;
        let message = format!("pulsar-machine-registration-v1\n{fields}");
        Ok(json!({
            "registration": {
                "id": identity.id,
                "name": name,
                "icon": identity.icon,
                "brokerUrl": broker.url,
                "publicKey": identity.public_key,
                "issuedAt": issued_at,
                "signature": identity.sign(&message),
            }
        }))
    }

    async fn sessions(&self, current: Option<&str>) -> Value {
        let state = self.inner.store.lock().await;
        json!({
            "sessions": state.sessions.iter().map(|entry| json!({
                "id": entry.id,
                "label": entry.label,
                "origin": entry.origin.as_deref().unwrap_or("link"),
                "createdAt": entry.created_at,
                "lastSeenAt": entry.last_seen_at,
                "current": current == Some(entry.id.as_str()),
            })).collect::<Vec<_>>()
        })
    }

    async fn broker_description(&self, identity: &EndpointIdentity) -> BrokerDescription {
        let (override_value, advertise) = self.inner.broker_override.read().await.clone();
        match override_value {
            BrokerOverride::Off => BrokerDescription {
                url: None,
                fixed: true,
            },
            BrokerOverride::Custom(url) => BrokerDescription {
                url: Some(advertise.unwrap_or(url)),
                fixed: true,
            },
            BrokerOverride::Inherit => {
                let url = match identity.broker.get("mode").and_then(Value::as_str) {
                    Some("off") => None,
                    Some("custom") => identity
                        .broker
                        .get("url")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    _ => Some(DEFAULT_BROKER_URL.to_owned()),
                };
                BrokerDescription { url, fixed: false }
            }
        }
    }

    async fn revoke(&self, payload: Value) -> RpcResult {
        let id = payload
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| RpcError::new("bad-request", "Invalid payload for auth.revoke"))?;
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        let Some(position) = next.sessions.iter().position(|record| record.id == id) else {
            return Err(RpcError::new(
                "session-not-found",
                format!("No paired client {id}"),
            ));
        };
        let record = next.sessions.remove(position);
        if let Some(key) = record.public_key
            && !next.revoked_keys.contains(&key)
        {
            next.revoked_keys.push(key);
        }
        self.persist_auth(&next)
            .await
            .map_err(|error| RpcError::new("internal", error.to_string()))?;
        *state = next;
        {
            let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
            auth.tickets.retain(|(_, ticket)| ticket.session_id != id);
        }
        let _ = self.inner.revocations.send(id.to_owned());
        Ok(json!({}))
    }

    async fn register_key(&self, payload: Value, session_id: Option<&str>) -> RpcResult {
        let Some(session_id) = session_id else {
            return Ok(json!({ "registered": false }));
        };
        let Some(public_key) = payload
            .get("publicKey")
            .and_then(Value::as_str)
            .filter(|key| parse_public_key(key).is_some())
        else {
            return Ok(json!({ "registered": false }));
        };
        let mut state = self.inner.store.lock().await;
        let mut next = state.clone();
        if next.sessions.iter().any(|record| {
            record.id != session_id && record.public_key.as_deref() == Some(public_key)
        }) {
            return Ok(json!({ "registered": false }));
        }
        let Some(record) = next
            .sessions
            .iter_mut()
            .find(|record| record.id == session_id)
        else {
            return Ok(json!({ "registered": false }));
        };
        record.public_key = Some(public_key.to_owned());
        self.persist_auth(&next)
            .await
            .map_err(|error| RpcError::new("internal", error.to_string()))?;
        *state = next;
        Ok(json!({ "registered": true }))
    }

    fn issue_ticket(&self, session_id: String) -> String {
        let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
        sweep(&mut auth);
        let mut mine = auth
            .tickets
            .iter()
            .enumerate()
            .filter(|(_, (_, ticket))| ticket.session_id == session_id)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let remove = mine.len().saturating_sub(TICKETS_PER_SESSION - 1);
        for index in mine.drain(..remove).rev() {
            auth.tickets.remove(index);
        }
        let token = random_token(32);
        auth.tickets.push((
            token.clone(),
            Ticket {
                session_id,
                expires_at: now_ms() + TICKET_TTL_MS,
            },
        ));
        token
    }

    fn ticket_session(&self, token: &str) -> Option<String> {
        let mut auth = self.inner.volatile.lock().expect("auth lock poisoned");
        let entry = auth
            .tickets
            .iter_mut()
            .find(|(candidate, _)| constant_time_secret(candidate, token))?;
        if now_ms() > entry.1.expires_at {
            return None;
        }
        entry.1.expires_at = now_ms() + TICKET_TTL_MS;
        Some(entry.1.session_id.clone())
    }

    async fn persist_auth(&self, state: &AuthState) -> Result<()> {
        write_json_atomic(&self.inner.home.join("auth.json"), state).await
    }
}

struct Paired {
    #[allow(dead_code)]
    session_id: String,
    session_token: Option<String>,
}

#[derive(Debug)]
pub struct HttpAuthError {
    pub status: u16,
    pub message: String,
    internal: Option<anyhow::Error>,
}

impl HttpAuthError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            message: message.into(),
            internal: None,
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: 401,
            message: message.into(),
            internal: None,
        }
    }

    fn internal(error: anyhow::Error) -> Self {
        Self {
            status: 500,
            message: "Request failed".to_owned(),
            internal: Some(error),
        }
    }

    pub fn log_internal(&self) {
        if let Some(error) = &self.internal {
            eprintln!("Authentication request failed: {error:#}");
        }
    }
}

impl EndpointIdentity {
    fn label(&self) -> String {
        self.name
            .clone()
            .unwrap_or_else(|| self.default_name.clone())
    }

    fn sign(&self, message: &str) -> String {
        URL_SAFE_NO_PAD.encode(self.signing_key.sign(message.as_bytes()).to_bytes())
    }

    fn info(&self, reachability: &str, authenticated: bool, broker: &BrokerDescription) -> Value {
        json!({
            "id": self.id,
            "label": self.label(),
            "nameSource": if self.name.is_some() { "chosen" } else { "default" },
            "icon": self.icon,
            "agentsDeleteAnyView": self.agents_delete_any_view,
            "refuseStatements": self.refuse_statements,
            "streamingAllowed": self.streaming_allowed,
            "platform": wire_platform(),
            "version": VERSION,
            "protocol": PROTOCOL_VERSION,
            "reachability": reachability,
            "authenticated": authenticated,
            "publicKey": self.public_key,
            "broker": self.broker,
            "brokerUrl": broker.url,
            "brokerFixed": broker.fixed,
        })
    }

    fn changed_event(&self, broker: &BrokerDescription) -> Value {
        json!({
            "id": self.id,
            "label": self.label(),
            "nameSource": if self.name.is_some() { "chosen" } else { "default" },
            "icon": self.icon,
            "agentsDeleteAnyView": self.agents_delete_any_view,
            "refuseStatements": self.refuse_statements,
            "streamingAllowed": self.streaming_allowed,
            "broker": self.broker,
            "brokerUrl": broker.url,
            "brokerFixed": broker.fixed,
        })
    }

    async fn persist(&self) -> Result<()> {
        let mut value = Map::new();
        value.insert("version".to_owned(), json!(1));
        value.insert("id".to_owned(), json!(self.id));
        value.insert("publicKey".to_owned(), json!(self.public_key));
        value.insert(
            "privateKey".to_owned(),
            json!(self.signing_key.to_pkcs8_pem(Default::default())?.as_str()),
        );
        if let Some(name) = &self.name {
            value.insert("name".to_owned(), json!(name));
        }
        if let Some(icon) = &self.icon {
            value.insert("icon".to_owned(), icon.clone());
        }
        if self.agents_delete_any_view {
            value.insert("agentsDeleteAnyView".to_owned(), json!(true));
        }
        if self.refuse_statements {
            value.insert("refuseStatements".to_owned(), json!(true));
        }
        if !self.streaming_allowed {
            value.insert("streamingAllowed".to_owned(), json!(false));
        }
        if self.broker != json!({ "mode": "default" }) {
            value.insert("broker".to_owned(), self.broker.clone());
        }
        write_json_atomic(&self.path, &Value::Object(value)).await
    }
}

async fn read_or_create_identity(home: &Path, default_name: String) -> Result<EndpointIdentity> {
    let path = home.join("endpoint.json");
    let existing = match tokio::fs::read_to_string(&path).await {
        Ok(text) => parse_endpoint_file(&text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).context("read endpoint identity"),
    };
    let keys = match existing
        .as_ref()
        .and_then(|file| file.public_key.as_ref().zip(file.private_key.as_ref()))
    {
        Some((stored_public, private)) => {
            let signing = SigningKey::from_pkcs8_pem(private)
                .context("endpoint.json contains an invalid private key")?;
            let public = URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes());
            anyhow::ensure!(
                stored_public == &public,
                "endpoint.json public and private keys do not match"
            );
            Some((public, signing))
        }
        _ => None,
    };
    let signing_key = keys
        .as_ref()
        .map(|(_, key)| key.clone())
        .unwrap_or_else(|| SigningKey::generate(&mut OsRng));
    let public_key = keys
        .map(|(public, _)| public)
        .unwrap_or_else(|| URL_SAFE_NO_PAD.encode(signing_key.verifying_key().as_bytes()));
    let identity = EndpointIdentity {
        path,
        id: existing
            .as_ref()
            .map(|file| file.id.clone())
            .unwrap_or_else(|| random_token(8)),
        public_key,
        signing_key,
        default_name,
        name: existing
            .as_ref()
            .and_then(|file| file.name.clone())
            .filter(|name| !name.is_empty()),
        icon: existing.as_ref().and_then(|file| file.icon.clone()),
        agents_delete_any_view: existing
            .as_ref()
            .and_then(|file| file.agents_delete_any_view)
            .unwrap_or(false),
        refuse_statements: existing
            .as_ref()
            .and_then(|file| file.refuse_statements)
            .unwrap_or(false),
        streaming_allowed: existing
            .as_ref()
            .and_then(|file| file.streaming_allowed)
            .unwrap_or(true),
        broker: existing
            .as_ref()
            .and_then(|file| file.broker.clone())
            .unwrap_or_else(|| json!({ "mode": "default" })),
    };
    if keys_absent(&existing) {
        identity.persist().await?;
    }
    Ok(identity)
}

fn keys_absent(existing: &Option<EndpointFile>) -> bool {
    existing
        .as_ref()
        .is_none_or(|file| file.public_key.is_none() || file.private_key.is_none())
}

fn parse_endpoint_file(text: &str) -> Option<EndpointFile> {
    let value: Value = serde_json::from_str(text).ok()?;
    let object = value.as_object()?;
    if object.get("version").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())?
        .to_owned();
    Some(EndpointFile {
        id,
        public_key: object
            .get("publicKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        private_key: object
            .get("privateKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        name: object
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        icon: object
            .get("icon")
            .filter(|value| !value.is_null() && crate::schema::is_endpoint_icon(value))
            .cloned(),
        agents_delete_any_view: object.get("agentsDeleteAnyView").and_then(Value::as_bool),
        refuse_statements: object.get("refuseStatements").and_then(Value::as_bool),
        streaming_allowed: object.get("streamingAllowed").and_then(Value::as_bool),
        broker: object
            .get("broker")
            .filter(|value| value.is_object())
            .cloned(),
    })
}

async fn read_auth_state(path: &Path) -> AuthState {
    let Ok(text) = tokio::fs::read_to_string(path).await else {
        return AuthState::default();
    };
    let Ok(mut state) = serde_json::from_str::<AuthState>(&text) else {
        return AuthState::default();
    };
    state.sessions.retain(|record| {
        !record.id.is_empty()
            && (record.token_hash.is_some()
                || record
                    .public_key
                    .as_deref()
                    .and_then(parse_public_key)
                    .is_some())
    });
    state
}

async fn read_or_create_local_secret(home: &Path) -> Result<String> {
    let path = home.join("local.key");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => {
            let value = text.trim();
            if !value.is_empty() {
                return Ok(value.to_owned());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("read local secret"),
    }
    let secret = random_token(32);
    write_atomic(&path, format!("{secret}\n").as_bytes()).await?;
    Ok(secret)
}

async fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    write_atomic(path, text.as_bytes()).await
}

async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("file has no parent")?;
    tokio::fs::create_dir_all(parent).await?;
    set_directory_permissions(parent).await?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("ruimte"),
        random_token(6)
    ));
    tokio::fs::write(&temporary, bytes).await?;
    set_file_permissions(&temporary).await?;
    tokio::fs::rename(&temporary, path).await?;
    Ok(())
}

#[cfg(unix)]
async fn set_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn set_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
async fn set_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn set_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn sweep(auth: &mut VolatileAuth) {
    let now = now_ms();
    auth.challenges
        .retain(|(_, challenge)| challenge.expires_at >= now);
    auth.tickets.retain(|(_, ticket)| ticket.expires_at >= now);
}

fn parse_public_key(value: &str) -> Option<VerifyingKey> {
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    let bytes: [u8; 32] = bytes.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

fn decode_signature(value: &str) -> Option<Signature> {
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    Signature::from_slice(&bytes).ok()
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn same_hash(left: &str, right: &str) -> bool {
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

fn constant_time_secret(left: &str, right: &str) -> bool {
    let left = Sha256::digest(left.as_bytes());
    let right = Sha256::digest(right.as_bytes());
    left.ct_eq(&right).into()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn truncate_utf16(value: &str, maximum: usize) -> String {
    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            let next = units + character.len_utf16();
            if next > maximum {
                return false;
            }
            units = next;
            true
        })
        .collect()
}

fn wire_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        platform => platform,
    }
}

fn host_name() -> String {
    let mut bytes = [0_u8; 256];
    let result = unsafe { libc::gethostname(bytes.as_mut_ptr().cast(), bytes.len()) };
    if result != 0 {
        return "localhost".to_owned();
    }
    let length = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..length]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_secret_survives_restart_and_has_private_permissions() {
        let home = tempfile::tempdir().unwrap();
        let first = read_or_create_local_secret(home.path()).await.unwrap();
        let second = read_or_create_local_secret(home.path()).await.unwrap();
        assert_eq!(first, second);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(home.path().join("local.key"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[tokio::test]
    async fn pairing_token_is_single_use() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let token = auth.issue_pairing_token();
        let payload = json!({ "token": token, "label": "Client" });
        assert!(auth.pair_http(payload.clone(), "loopback").await.is_ok());
        assert_eq!(
            auth.pair_http(payload, "loopback")
                .await
                .unwrap_err()
                .status,
            401
        );
    }

    #[tokio::test]
    async fn wrong_pairing_token_does_not_spend_the_right_one() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let token = auth.issue_pairing_token();
        assert_eq!(
            auth.pair_http(json!({ "token": "wrong", "label": "Client" }), "loopback")
                .await
                .unwrap_err()
                .status,
            401
        );
        assert!(
            auth.pair_http(json!({ "token": token, "label": "Client" }), "loopback")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn pairing_label_limits_use_javascript_utf16_units() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let token = auth.issue_pairing_token();
        assert_eq!(
            auth.pair_http(
                json!({ "token": token, "label": "🚀".repeat(41) }),
                "loopback",
            )
            .await
            .unwrap_err()
            .status,
            400
        );
        assert!(
            auth.pair_http(
                json!({ "token": token, "label": "🚀".repeat(40) }),
                "loopback",
            )
            .await
            .is_ok()
        );
    }

    #[tokio::test]
    async fn failed_pair_persistence_restores_the_token_and_state() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        tokio::fs::create_dir(home.path().join("auth.json"))
            .await
            .unwrap();
        let token = auth.issue_pairing_token();
        let payload = json!({ "token": token, "label": "Client" });
        assert_eq!(
            auth.pair_http(payload.clone(), "loopback")
                .await
                .unwrap_err()
                .status,
            500
        );
        assert!(auth.inner.store.lock().await.sessions.is_empty());

        tokio::fs::remove_dir(home.path().join("auth.json"))
            .await
            .unwrap();
        assert!(auth.pair_http(payload, "loopback").await.is_ok());
    }

    #[tokio::test]
    async fn failed_revoke_persistence_keeps_session_active_and_sends_no_event() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let token = auth.issue_pairing_token();
        auth.pair_http(json!({ "token": token, "label": "Client" }), "loopback")
            .await
            .unwrap();
        let id = auth.inner.store.lock().await.sessions[0].id.clone();
        let auth_path = home.path().join("auth.json");
        let saved_path = home.path().join("auth.saved.json");
        tokio::fs::rename(&auth_path, &saved_path).await.unwrap();
        tokio::fs::create_dir(&auth_path).await.unwrap();
        let mut revoked = auth.subscribe_revocations();

        assert!(auth.revoke(json!({ "id": id })).await.is_err());
        assert!(auth.is_session_active(&id).await);
        assert!(matches!(
            revoked.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));

        tokio::fs::remove_dir(&auth_path).await.unwrap();
        tokio::fs::rename(&saved_path, &auth_path).await.unwrap();
        assert!(auth.revoke(json!({ "id": id })).await.is_ok());
    }

    #[tokio::test]
    async fn failed_statement_persistence_does_not_spend_the_nonce() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        tokio::fs::create_dir(home.path().join("auth.json"))
            .await
            .unwrap();
        let key = SigningKey::generate(&mut OsRng);
        let public_key = URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes());
        let keep_until = now_ms() + 60_000;
        assert!(
            auth.admit_statement(&public_key, "Client", "nonce", keep_until)
                .await
                .is_err()
        );

        tokio::fs::remove_dir(home.path().join("auth.json"))
            .await
            .unwrap();
        assert!(matches!(
            auth.admit_statement(&public_key, "Client", "nonce", keep_until)
                .await
                .unwrap(),
            StatementAdmission::Admitted { created: true, .. }
        ));
    }

    #[tokio::test]
    async fn invalid_optional_identity_fields_do_not_replace_the_id() {
        let home = tempfile::tempdir().unwrap();
        let first = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "First".to_owned(),
        )
        .await
        .unwrap();
        let id = first.endpoint_info("loopback", false).await["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut file: Value = serde_json::from_str(
            &tokio::fs::read_to_string(home.path().join("endpoint.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        file["name"] = json!(12);
        file["streamingAllowed"] = json!("yes");
        file["icon"] = json!({ "kind": "unknown", "value": "x" });
        tokio::fs::write(
            home.path().join("endpoint.json"),
            serde_json::to_vec(&file).unwrap(),
        )
        .await
        .unwrap();
        let second = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Second".to_owned(),
        )
        .await
        .unwrap();
        let info = second.endpoint_info("loopback", false).await;
        assert_eq!(info["id"], id);
        assert_eq!(info["label"], "Second");
        assert_eq!(info["streamingAllowed"], true);
        assert_eq!(info["icon"], Value::Null);
    }

    #[tokio::test]
    async fn corrupt_identity_key_fails_startup() {
        let home = tempfile::tempdir().unwrap();
        tokio::fs::write(
            home.path().join("endpoint.json"),
            serde_json::to_vec(&json!({
                "version": 1,
                "id": "machine",
                "publicKey": random_token(32),
                "privateKey": "not a pem"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert!(
            AuthService::new(
                home.path().to_owned(),
                EventBus::default(),
                "Test".to_owned()
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn pairing_url_keeps_token_in_fragment_and_brackets_ipv6() {
        let home = tempfile::tempdir().unwrap();
        let auth = AuthService::new(
            home.path().to_owned(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        auth.set_advertised_address("::1".to_owned(), 4221).await;
        let url = auth.pairing_url().await;
        assert!(url.starts_with("http://[::1]:4221/pair#"));
        assert!(!url.contains("?token="));
    }

    #[test]
    fn node_platform_name_matches_the_wire() {
        if cfg!(target_os = "macos") {
            assert_eq!(wire_platform(), "darwin");
        }
    }
}
