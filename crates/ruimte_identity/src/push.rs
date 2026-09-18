use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hkdf::Hkdf;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::{
    auth::AuthService,
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
};

const RETENTION_MS: u64 = 30 * 24 * 60 * 60_000;
const PUSH_MAX_AGE_MS: u64 = 120_000;
const PUSH_HKDF_SALT: &str = "pulsar-push-encryption-v1";
const ADDRESS_BOOK_PUSH_URL: &str = "https://pulsar.ruimte.app/v1/push";

type SendFuture = Pin<Box<dyn Future<Output = Result<u16, RpcError>> + Send>>;
type PushSender = Arc<dyn Fn(Value) -> SendFuture + Send + Sync>;

#[derive(Clone)]
pub struct PushService {
    inner: Arc<PushInner>,
}

struct PushInner {
    auth: AuthService,
    events: EventBus,
    path: PathBuf,
    ledger: Mutex<AttentionLedger>,
    delivery: Mutex<()>,
    connected: Mutex<HashMap<String, usize>>,
    offline_approvals: AtomicBool,
    sender: PushSender,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttentionEntry {
    node_id: String,
    issued_at: u64,
    read_through: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttentionFile {
    entries: Vec<AttentionEntry>,
    marks_from: u64,
}

struct AttentionLedger {
    entries: HashMap<String, AttentionEntry>,
    marks_from: u64,
}

impl PushService {
    pub async fn new(home: PathBuf, auth: AuthService, events: EventBus) -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        let sender: PushSender = Arc::new(move |push| {
            let client = client.clone();
            Box::pin(async move {
                let response = client
                    .post(ADDRESS_BOOK_PUSH_URL)
                    .json(&push)
                    .send()
                    .await
                    .map_err(internal)?;
                Ok(response.status().as_u16())
            })
        });
        Self::new_with_sender(home, auth, events, sender).await
    }

    async fn new_with_sender(
        home: PathBuf,
        auth: AuthService,
        events: EventBus,
        sender: PushSender,
    ) -> anyhow::Result<Self> {
        let path = home.join("push-attention.json");
        let ledger = match tokio::fs::read_to_string(&path).await {
            Ok(text) => {
                let saved: AttentionFile = serde_json::from_str(&text)?;
                AttentionLedger {
                    entries: saved
                        .entries
                        .into_iter()
                        .map(|entry| (entry.node_id.clone(), entry))
                        .collect(),
                    marks_from: saved.marks_from,
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => AttentionLedger {
                entries: HashMap::new(),
                marks_from: now_ms(),
            },
            Err(error) => return Err(error.into()),
        };
        let service = Self {
            inner: Arc::new(PushInner {
                auth,
                events,
                path,
                ledger: Mutex::new(ledger),
                delivery: Mutex::new(()),
                connected: Mutex::new(HashMap::new()),
                offline_approvals: AtomicBool::new(false),
                sender,
            }),
        };
        service.prune_and_persist().await?;
        service.refresh_offline_approvals().await;
        Ok(service)
    }

    pub async fn connected(&self, session_id: Option<&str>) {
        if let Some(session_id) = session_id {
            let mut connected = self.inner.connected.lock().await;
            *connected.entry(session_id.to_owned()).or_default() += 1;
        }
        self.refresh_offline_approvals().await;
    }

    pub async fn disconnected(&self, session_id: Option<&str>) {
        let Some(session_id) = session_id else { return };
        let mut connected = self.inner.connected.lock().await;
        let Some(count) = connected.get_mut(session_id) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            connected.remove(session_id);
        }
        drop(connected);
        self.refresh_offline_approvals().await;
    }

    pub fn has_offline_approvals(&self) -> bool {
        self.inner.offline_approvals.load(Ordering::Acquire)
    }

    pub async fn refresh_offline_approvals(&self) {
        let subscriptions = self.inner.auth.push_subscriptions().await;
        let connected = self.inner.connected.lock().await;
        let available = subscriptions.iter().any(|(session_id, subscription)| {
            subscription
                .get("approvals")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && !connected.contains_key(session_id)
        });
        self.inner
            .offline_approvals
            .store(available, Ordering::Release);
    }

    pub async fn shutdown(&self) {
        let _delivery = self.inner.delivery.lock().await;
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        let result = match method {
            "push.attention" => Ok(self.attention().await),
            "push.read" => self.read(payload).await,
            "push.subscribe" => self.subscribe(payload, context).await,
            "push.unsubscribe" => self.unsubscribe(payload, context).await,
            _ => return None,
        };
        Some(result)
    }

    pub async fn notify(&self, node_id: &str) -> Result<Value, RpcError> {
        self.alert(
            "terminal",
            node_id,
            "Agent needs attention",
            "The agent needs your attention.",
        )
        .await
    }

    pub async fn alert(
        &self,
        target: &str,
        node_id: &str,
        title: &str,
        body: &str,
    ) -> Result<Value, RpcError> {
        let _delivery = self.inner.delivery.lock().await;
        let entry = {
            let mut ledger = self.inner.ledger.lock().await;
            let previous = ledger
                .entries
                .get(node_id)
                .map_or(0, |entry| entry.issued_at);
            let entry = AttentionEntry {
                node_id: node_id.to_owned(),
                issued_at: now_ms().max(previous.saturating_add(1)),
                read_through: ledger
                    .entries
                    .get(node_id)
                    .map_or(0, |entry| entry.read_through),
            };
            ledger.entries.insert(node_id.to_owned(), entry.clone());
            entry
        };
        self.persist().await.map_err(internal)?;
        let value = serde_json::to_value(&entry).map_err(internal)?;
        self.inner.events.broadcast("push.attention", value.clone());
        self.deliver_alert(
            json!({
                "kind": "attention",
                "target": target,
                "nodeId": node_id,
                "title": truncate_utf16(title, 160),
                "body": truncate_utf16(body, 500),
            }),
            entry.issued_at,
        )
        .await?;
        Ok(value)
    }

    async fn attention(&self) -> Value {
        let ledger = self.inner.ledger.lock().await;
        let mut entries = ledger.entries.values().cloned().collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.issued_at);
        json!({ "entries": entries, "marksFrom": ledger.marks_from })
    }

    async fn read(&self, payload: Value) -> RpcResult {
        let node_id = payload
            .get("nodeId")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("bad-request", "Invalid push.read payload"))?;
        let issued_at = payload
            .get("issuedAt")
            .and_then(Value::as_u64)
            .ok_or_else(|| RpcError::new("bad-request", "Invalid push.read payload"))?;
        let _delivery = self.inner.delivery.lock().await;
        let changed = {
            let mut ledger = self.inner.ledger.lock().await;
            let Some(previous) = ledger.entries.get_mut(node_id) else {
                return Ok(json!({}));
            };
            if issued_at > previous.issued_at || issued_at <= previous.read_through {
                None
            } else {
                previous.read_through = issued_at;
                Some(previous.clone())
            }
        };
        if let Some(entry) = changed {
            self.persist().await.map_err(internal)?;
            self.inner.events.broadcast(
                "push.attention",
                serde_json::to_value(&entry).map_err(internal)?,
            );
            self.deliver_read(&entry).await?;
        }
        Ok(json!({}))
    }

    async fn subscribe(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let Some(session_id) = context.access.session_id.as_deref() else {
            return Err(RpcError::new(
                "unauthorized",
                "Push requires a paired client key",
            ));
        };
        if !self.inner.auth.set_push(session_id, payload).await? {
            return Err(RpcError::new(
                "unauthorized",
                "Push requires a paired client key",
            ));
        }
        self.refresh_offline_approvals().await;
        Ok(json!({}))
    }

    async fn unsubscribe(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let Some(session_id) = context.access.session_id.as_deref() else {
            return Err(RpcError::new(
                "unauthorized",
                "Push requires a paired client key",
            ));
        };
        let handle = payload
            .get("handle")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("bad-request", "Invalid push.unsubscribe payload"))?;
        self.inner.auth.remove_push(session_id, handle).await?;
        self.refresh_offline_approvals().await;
        Ok(json!({}))
    }

    async fn deliver_alert(&self, mut content: Value, issued_at: u64) -> Result<(), RpcError> {
        let node_id = content["nodeId"].as_str().unwrap_or_default().to_owned();
        for (session_id, subscription) in self.inner.auth.push_subscriptions().await {
            if self.is_read(&node_id, issued_at).await
                || self.is_connected(&session_id).await
                || !follows(&subscription, &node_id)
            {
                continue;
            }
            let expires_at = issued_at.saturating_add(PUSH_MAX_AGE_MS);
            content["expiresAt"] = json!(expires_at);
            let routing = self
                .routing(&subscription, &node_id, issued_at, expires_at)
                .await?;
            let push = encrypt_push(
                &self.inner.auth,
                &routing,
                value_str(&subscription, "publicKey")?,
                &content,
                "alert",
            )
            .await?;
            self.send_current(&session_id, &subscription, push, true)
                .await?;
        }
        Ok(())
    }

    async fn deliver_read(&self, entry: &AttentionEntry) -> Result<(), RpcError> {
        for (session_id, subscription) in self.inner.auth.push_subscriptions().await {
            if !subscription
                .get("readSync")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || self.is_connected(&session_id).await
            {
                continue;
            }
            let issued_at = now_ms().max(entry.read_through);
            let expires_at = issued_at.saturating_add(PUSH_MAX_AGE_MS);
            let routing = self
                .routing(&subscription, &entry.node_id, issued_at, expires_at)
                .await?;
            let content = json!({
                "nodeId": entry.node_id,
                "through": entry.read_through,
                "expiresAt": expires_at,
            });
            let push = encrypt_push(
                &self.inner.auth,
                &routing,
                value_str(&subscription, "publicKey")?,
                &content,
                "background",
            )
            .await?;
            self.send_current(&session_id, &subscription, push, false)
                .await?;
        }
        Ok(())
    }

    async fn routing(
        &self,
        subscription: &Value,
        node_id: &str,
        issued_at: u64,
        expires_at: u64,
    ) -> Result<Value, RpcError> {
        let machine_id = self.inner.auth.endpoint_id().await;
        let handle = value_str(subscription, "handle")?;
        Ok(push_routing_with_expiry(
            &machine_id,
            handle,
            node_id,
            issued_at,
            expires_at.min(issued_at.saturating_add(PUSH_MAX_AGE_MS)),
        ))
    }

    async fn send_current(
        &self,
        session_id: &str,
        subscription: &Value,
        push: Value,
        alert: bool,
    ) -> Result<bool, RpcError> {
        let current = self
            .inner
            .auth
            .push_subscriptions()
            .await
            .into_iter()
            .find(|(candidate, _)| candidate == session_id);
        if current.as_ref().map(|(_, value)| value) != Some(subscription)
            || alert && self.is_connected(session_id).await
        {
            return Ok(false);
        }
        let status = (self.inner.sender)(push).await?;
        if status == 401 || status == 410 {
            self.inner
                .auth
                .remove_push(session_id, value_str(subscription, "handle")?)
                .await?;
        }
        Ok((200..300).contains(&status))
    }

    async fn is_connected(&self, session_id: &str) -> bool {
        self.inner
            .connected
            .lock()
            .await
            .get(session_id)
            .is_some_and(|count| *count > 0)
    }

    async fn is_read(&self, node_id: &str, issued_at: u64) -> bool {
        self.inner
            .ledger
            .lock()
            .await
            .entries
            .get(node_id)
            .is_some_and(|entry| entry.read_through >= issued_at)
    }

    async fn prune_and_persist(&self) -> anyhow::Result<()> {
        {
            let mut ledger = self.inner.ledger.lock().await;
            let cutoff = now_ms().saturating_sub(RETENTION_MS);
            ledger.entries.retain(|_, entry| entry.issued_at >= cutoff);
            if ledger.entries.len() > 1000 {
                let mut entries = ledger.entries.values().cloned().collect::<Vec<_>>();
                entries.sort_by_key(|entry| entry.issued_at);
                let remove = entries.len() - 1000;
                for entry in entries.into_iter().take(remove) {
                    ledger.entries.remove(&entry.node_id);
                }
            }
        }
        self.persist().await
    }

    async fn persist(&self) -> anyhow::Result<()> {
        let file = {
            let ledger = self.inner.ledger.lock().await;
            AttentionFile {
                entries: ledger.entries.values().cloned().collect(),
                marks_from: ledger.marks_from,
            }
        };
        let mut bytes = serde_json::to_vec(&file)?;
        bytes.push(b'\n');
        let temporary = self.inner.path.with_extension("json.tmp");
        tokio::fs::write(&temporary, bytes).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600)).await?;
        }
        tokio::fs::rename(temporary, &self.inner.path).await?;
        Ok(())
    }
}

pub async fn encrypt_push(
    auth: &AuthService,
    routing: &Value,
    recipient_key: &str,
    content: &Value,
    push_type: &str,
) -> Result<Value, RpcError> {
    let recipient: [u8; 32] = URL_SAFE_NO_PAD
        .decode(recipient_key)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| RpcError::new("invalid-push-key", "Invalid push public key"))?;
    let mut secret = [0_u8; 32];
    OsRng.fill_bytes(&mut secret);
    let ephemeral = StaticSecret::from(secret);
    let ephemeral_public = PublicKey::from(&ephemeral);
    let shared = ephemeral.diffie_hellman(&PublicKey::from(recipient));
    let info = serde_json::to_string(&json!([routing["machineId"], routing["handle"]]))
        .map_err(internal)?;
    let hkdf = Hkdf::<Sha256>::new(Some(PUSH_HKDF_SALT.as_bytes()), shared.as_bytes());
    let mut key = [0_u8; 32];
    hkdf.expand(info.as_bytes(), &mut key)
        .map_err(|_| RpcError::new("push-encryption", "Push key derivation failed"))?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let mut fitted = content.clone();
    let mut plaintext = serde_json::to_vec(&fitted).map_err(internal)?;
    while plaintext.len() > 2200 {
        let Some(body) = fitted.get("body").and_then(Value::as_str) else {
            return Err(RpcError::new(
                "push-encryption",
                "Push content exceeds the encrypted envelope budget",
            ));
        };
        if body.is_empty() {
            return Err(RpcError::new(
                "push-encryption",
                "Push content exceeds the encrypted envelope budget",
            ));
        }
        let shorter = truncate_utf16(body, body.encode_utf16().count() / 2);
        fitted["body"] = Value::String(shorter);
        plaintext = serde_json::to_vec(&fitted).map_err(internal)?;
    }
    let aad = push_routing_message(routing)?;
    let ciphertext = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| RpcError::new("push-encryption", "Push encryption failed"))?
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: &plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| RpcError::new("push-encryption", "Push encryption failed"))?;
    let mut envelope = routing.clone();
    {
        let object = envelope
            .as_object_mut()
            .ok_or_else(|| RpcError::new("push-encryption", "Invalid push routing"))?;
        object.insert("pushType".to_owned(), Value::String(push_type.to_owned()));
        object.insert(
            "ephemeralKey".to_owned(),
            Value::String(URL_SAFE_NO_PAD.encode(ephemeral_public.as_bytes())),
        );
        object.insert(
            "nonce".to_owned(),
            Value::String(URL_SAFE_NO_PAD.encode(nonce)),
        );
        object.insert(
            "ciphertext".to_owned(),
            Value::String(URL_SAFE_NO_PAD.encode(ciphertext)),
        );
        object.insert("signature".to_owned(), Value::String(String::new()));
    }
    let message = push_message(&envelope)?;
    envelope
        .as_object_mut()
        .expect("push envelope object")
        .insert(
            "signature".to_owned(),
            Value::String(auth.sign_message(&message).await),
        );
    Ok(envelope)
}

pub fn push_routing(machine_id: &str, handle: &str, node_id: &str, issued_at: u64) -> Value {
    push_routing_with_expiry(
        machine_id,
        handle,
        node_id,
        issued_at,
        issued_at.saturating_add(PUSH_MAX_AGE_MS),
    )
}

fn push_routing_with_expiry(
    machine_id: &str,
    handle: &str,
    node_id: &str,
    issued_at: u64,
    expires_at: u64,
) -> Value {
    let collapse = serde_json::to_vec(&json!([machine_id, node_id])).unwrap_or_default();
    json!({
        "machineId": machine_id,
        "handle": handle,
        "id": random_token(32),
        "issuedAt": issued_at,
        "expiresAt": expires_at,
        "collapseId": URL_SAFE_NO_PAD.encode(Sha256::digest(collapse)),
    })
}

fn follows(subscription: &Value, node_id: &str) -> bool {
    subscription
        .get("followAll")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || subscription
            .get("follow")
            .and_then(Value::as_array)
            .is_some_and(|follow| follow.iter().any(|value| value.as_str() == Some(node_id)))
}

fn value_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, RpcError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::new("invalid-push-subscription", format!("Missing {key}")))
}

fn truncate_utf16(value: &str, limit: usize) -> String {
    if value.encode_utf16().count() <= limit {
        return value.to_owned();
    }
    let mut units = 0;
    value
        .chars()
        .take_while(|character| {
            let next = units + character.len_utf16();
            if next > limit {
                return false;
            }
            units = next;
            true
        })
        .collect()
}

fn push_routing_message(routing: &Value) -> Result<String, RpcError> {
    let fields = json!([
        routing["machineId"],
        routing["handle"],
        routing["id"],
        routing["issuedAt"],
        routing["expiresAt"],
        routing["collapseId"],
    ]);
    Ok(format!(
        "pulsar-push-routing-v1\n{}",
        serde_json::to_string(&fields).map_err(internal)?
    ))
}

fn push_message(envelope: &Value) -> Result<String, RpcError> {
    let fields = json!([
        envelope["machineId"],
        envelope["handle"],
        envelope["id"],
        envelope["issuedAt"],
        envelope["expiresAt"],
        envelope["collapseId"],
        envelope["pushType"],
        envelope["ephemeralKey"],
        envelope["nonce"],
        envelope["ciphertext"],
    ]);
    Ok(format!(
        "pulsar-push-v1\n{}",
        serde_json::to_string(&fields).map_err(internal)?
    ))
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn internal(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("internal", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;
    use ed25519_dalek::SigningKey;
    use std::{io::Write, process::Stdio};
    use tempfile::tempdir;

    #[test]
    fn routing_and_signature_messages_use_the_canonical_field_order() {
        let routing = json!({
            "machineId": "machine", "handle": "handle", "id": "id", "issuedAt": 1,
            "expiresAt": 2, "collapseId": "collapse",
        });
        assert_eq!(
            push_routing_message(&routing).unwrap(),
            "pulsar-push-routing-v1\n[\"machine\",\"handle\",\"id\",1,2,\"collapse\"]"
        );
        let envelope = json!({
            "machineId": "machine", "handle": "handle", "id": "id", "issuedAt": 1,
            "expiresAt": 2, "collapseId": "collapse", "pushType": "alert",
            "ephemeralKey": "ephemeral", "nonce": "nonce", "ciphertext": "ciphertext",
        });
        assert_eq!(
            push_message(&envelope).unwrap(),
            "pulsar-push-v1\n[\"machine\",\"handle\",\"id\",1,2,\"collapse\",\"alert\",\"ephemeral\",\"nonce\",\"ciphertext\"]"
        );
    }

    #[tokio::test]
    async fn alerts_and_reads_are_ordered_encrypted_and_suppressed_while_connected() {
        let directory = tempdir().unwrap();
        let events = EventBus::default();
        let auth = AuthService::new(
            directory.path().to_path_buf(),
            events.clone(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let pair_token = auth.issue_pairing_token();
        let client_key = SigningKey::generate(&mut OsRng);
        auth.pair_http(
            json!({
                "token": pair_token,
                "label": "Push test",
                "publicKey": URL_SAFE_NO_PAD.encode(client_key.verifying_key().as_bytes()),
            }),
            "local",
        )
        .await
        .unwrap();
        let auth_file: Value = serde_json::from_slice(
            &tokio::fs::read(directory.path().join("auth.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        let session_id = auth_file["sessions"][0]["id"].as_str().unwrap().to_owned();
        let recipient = StaticSecret::from([11_u8; 32]);
        let recipient_public = PublicKey::from(&recipient);
        let handle = URL_SAFE_NO_PAD.encode([7_u8; 32]);
        auth.set_push(
            &session_id,
            json!({
                "handle": handle,
                "publicKey": URL_SAFE_NO_PAD.encode(recipient_public.as_bytes()),
                "follow": ["node-1"],
                "approvals": true,
                "readSync": true,
            }),
        )
        .await
        .unwrap();
        let sent = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = sent.clone();
        let sender: PushSender = Arc::new(move |push| {
            let captured = captured.clone();
            Box::pin(async move {
                captured.lock().await.push(push);
                Ok(200)
            })
        });
        let service = PushService::new_with_sender(
            directory.path().to_path_buf(),
            auth.clone(),
            events,
            sender,
        )
        .await
        .unwrap();

        assert!(service.has_offline_approvals());
        service.connected(Some(&session_id)).await;
        assert!(!service.has_offline_approvals());
        let first = service.notify("node-1").await.unwrap();
        assert!(sent.lock().await.is_empty());
        service.disconnected(Some(&session_id)).await;
        assert!(service.has_offline_approvals());
        let entry = service.notify("node-1").await.unwrap();
        service
            .read(json!({ "nodeId": "node-1", "issuedAt": entry["issuedAt"] }))
            .await
            .unwrap();

        let pushes = sent.lock().await.clone();
        assert_eq!(pushes.len(), 2);
        assert_eq!(pushes[0]["pushType"], "alert");
        assert_eq!(pushes[1]["pushType"], "background");
        assert!(entry["issuedAt"].as_u64() > first["issuedAt"].as_u64());
        let alert = decrypt(&pushes[0], &recipient);
        let read = decrypt(&pushes[1], &recipient);
        assert_eq!(alert["nodeId"], "node-1");
        assert_eq!(read["through"], entry["issuedAt"]);
    }

    #[tokio::test]
    async fn rust_envelope_validates_decrypts_and_verifies_in_the_typescript_protocol() {
        let directory = tempdir().unwrap();
        let auth = AuthService::new(
            directory.path().to_path_buf(),
            EventBus::default(),
            "Test".to_owned(),
        )
        .await
        .unwrap();
        let recipient = StaticSecret::from([23_u8; 32]);
        let recipient_public = PublicKey::from(&recipient);
        let routing = push_routing(
            &auth.endpoint_id().await,
            &URL_SAFE_NO_PAD.encode([9_u8; 32]),
            "node-1",
            1_000,
        );
        let content = json!({
            "kind": "attention",
            "target": "chat",
            "nodeId": "node-1",
            "title": "Café 界",
            "body": "The agent needs your attention.",
            "expiresAt": 121_000,
        });
        let push = encrypt_push(
            &auth,
            &routing,
            &URL_SAFE_NO_PAD.encode(recipient_public.as_bytes()),
            &content,
            "alert",
        )
        .await
        .unwrap();
        let daemon_public = auth.endpoint_info("local", true).await["publicKey"]
            .as_str()
            .unwrap()
            .to_owned();
        let input = json!({
            "push": push,
            "recipientPrivateKey": URL_SAFE_NO_PAD.encode(recipient.to_bytes()),
            "recipientPublicKey": URL_SAFE_NO_PAD.encode(recipient_public.as_bytes()),
            "daemonPublicKey": daemon_public,
        });
        let mut child = std::process::Command::new("bun")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../apps/server-rust/tests/push-envelope-oracle.ts"
            ))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Bun is required for the push protocol oracle");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(serde_json::to_string(&input).unwrap().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let decrypted: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(decrypted, content);
    }

    fn decrypt(push: &Value, recipient: &StaticSecret) -> Value {
        let ephemeral: [u8; 32] = URL_SAFE_NO_PAD
            .decode(push["ephemeralKey"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let nonce: [u8; 12] = URL_SAFE_NO_PAD
            .decode(push["nonce"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let ciphertext = URL_SAFE_NO_PAD
            .decode(push["ciphertext"].as_str().unwrap())
            .unwrap();
        let shared = recipient.diffie_hellman(&PublicKey::from(ephemeral));
        let info = serde_json::to_string(&json!([push["machineId"], push["handle"]])).unwrap();
        let hkdf = Hkdf::<Sha256>::new(Some(PUSH_HKDF_SALT.as_bytes()), shared.as_bytes());
        let mut key = [0_u8; 32];
        hkdf.expand(info.as_bytes(), &mut key).unwrap();
        let plaintext = Aes256Gcm::new_from_slice(&key)
            .unwrap()
            .decrypt(
                (&nonce).into(),
                Payload {
                    msg: &ciphertext,
                    aad: push_routing_message(push).unwrap().as_bytes(),
                },
            )
            .unwrap();
        serde_json::from_slice(&plaintext).unwrap()
    }
}
