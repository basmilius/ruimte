use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt};
use rand::{Rng, rngs::OsRng};
use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, mpsc, watch},
    task::{JoinHandle, JoinSet},
    time::{Instant, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

use crate::{
    auth::{AuthService, StatementAdmission},
    direct::{BrokerIceServer, DirectService},
    router::AppState,
};

const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const SILENCE: Duration = Duration::from_secs(90);
const OWNER_TTL_MS: u64 = 60_000;
const ICE_RETRY: Duration = Duration::from_secs(60);
const STATEMENT_SKEW_MS: u64 = 30_000;
const STATEMENT_LIFETIME_MS: u64 = 120_000;
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const OUTBOUND_CAPACITY: usize = 64;
const TRUSTED_STATEMENT_KEY: &str = "8Z2XUxof6KwRqMW-QjvpONNclpj_5bn811INsr_Lb9k";

#[derive(Clone)]
pub struct BrokerService {
    inner: Arc<BrokerInner>,
}

struct BrokerInner {
    auth: AuthService,
    direct: DirectService,
    cancel: CancellationToken,
    revision: watch::Sender<u64>,
    task: Mutex<Option<JoinHandle<()>>>,
    owners: Mutex<HashMap<String, SignalOwner>>,
    started: AtomicBool,
    ready_generation: AtomicU64,
}

struct SignalOwner {
    public_key: String,
    expires_at: u64,
}

enum ConnectionEnd {
    Lost,
    RateLimited(Duration),
    Reconfigured,
    Shutdown,
}

enum Outbound {
    Relay { to: String, envelope: Value },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PeerState {
    Announced,
    Ready,
}

impl BrokerService {
    pub fn new(auth: AuthService, direct: DirectService) -> Self {
        let (revision, _) = watch::channel(0);
        Self {
            inner: Arc::new(BrokerInner {
                auth,
                direct,
                cancel: CancellationToken::new(),
                revision,
                task: Mutex::new(None),
                owners: Mutex::new(HashMap::new()),
                started: AtomicBool::new(false),
                ready_generation: AtomicU64::new(0),
            }),
        }
    }

    pub async fn start(&self, state: AppState) {
        if self.inner.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let service = self.clone();
        let task = tokio::spawn(async move { service.run(state).await });
        *self.inner.task.lock().await = Some(task);
    }

    pub fn reconfigure(&self) {
        self.inner.revision.send_modify(|revision| {
            *revision = revision.wrapping_add(1);
        });
    }

    pub async fn begin_shutdown(&self) {
        self.inner.cancel.cancel();
        if let Some(mut task) = self.inner.task.lock().await.take() {
            tokio::select! {
                _ = &mut task => {}
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    task.abort();
                    let _ = task.await;
                }
            }
        }
    }

    async fn run(&self, state: AppState) {
        let mut revision = self.inner.revision.subscribe();
        let mut failures = 0_u32;
        let mut active_url: Option<String> = None;
        loop {
            if self.inner.cancel.is_cancelled() {
                return;
            }
            let Some(url) = self.inner.auth.broker_dial_url().await else {
                if active_url.take().is_some() {
                    self.inner.direct.clear_broker_ice().await;
                }
                tokio::select! {
                    _ = self.inner.cancel.cancelled() => return,
                    result = revision.changed() => if result.is_err() { return; },
                }
                failures = 0;
                continue;
            };
            if active_url.as_deref() != Some(&url) {
                self.inner.direct.clear_broker_ice().await;
                active_url = Some(url.clone());
            }
            let ready_generation = self.inner.ready_generation.load(Ordering::Acquire);
            let retry_override = match self.connect(&url, &mut revision, state.clone()).await {
                ConnectionEnd::Shutdown => return,
                ConnectionEnd::Reconfigured => {
                    failures = 0;
                    continue;
                }
                ConnectionEnd::Lost => None,
                ConnectionEnd::RateLimited(delay) => Some(delay),
            };
            if self.inner.ready_generation.load(Ordering::Acquire) != ready_generation {
                failures = 0;
            }
            let base = BACKOFF_MIN
                .saturating_mul(2_u32.saturating_pow(failures.min(5)))
                .min(BACKOFF_MAX);
            failures = failures.saturating_add(1);
            let jitter = OsRng.gen_range(80_u32..=120_u32);
            let jittered = base.saturating_mul(jitter) / 100;
            let delay = retry_override.map_or(jittered, |delay| delay.max(jittered));
            tokio::select! {
                _ = self.inner.cancel.cancelled() => return,
                result = revision.changed() => if result.is_err() { return; },
                _ = tokio::time::sleep(delay) => {}
            }
        }
    }

    async fn connect(
        &self,
        url: &str,
        revision: &mut watch::Receiver<u64>,
        state: AppState,
    ) -> ConnectionEnd {
        let broker_host = match broker_host(url) {
            Some(host) => host,
            None => return ConnectionEnd::Lost,
        };
        let socket = tokio::select! {
            _ = self.inner.cancel.cancelled() => return ConnectionEnd::Shutdown,
            result = revision.changed() => {
                if result.is_err() { return ConnectionEnd::Shutdown; }
                return ConnectionEnd::Reconfigured;
            }
            result = connect_async(url) => match result {
                Ok((socket, _)) => socket,
                Err(_) => return ConnectionEnd::Lost,
            }
        };
        let (mut sink, mut stream) = socket.split();
        let public_key = self.inner.auth.endpoint_public_key().await;
        if write_json(
            &mut sink,
            json!({ "type": "hello", "role": "machine", "publicKey": public_key }),
        )
        .await
        .is_err()
        {
            return ConnectionEnd::Lost;
        }

        let connection_cancel = CancellationToken::new();
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<Outbound>(OUTBOUND_CAPACITY);
        let mut state_kind = PeerState::Announced;
        let mut next_id = 1_u64;
        let mut ice_request_id: Option<String> = None;
        let mut ice_deadline: Option<Instant> = None;
        let mut last_heard = Instant::now();
        let mut handlers = JoinSet::new();
        let end = loop {
            tokio::select! {
                _ = self.inner.cancel.cancelled() => break ConnectionEnd::Shutdown,
                _ = connection_cancel.cancelled() => break ConnectionEnd::Lost,
                result = revision.changed() => {
                    if result.is_err() { break ConnectionEnd::Shutdown; }
                    break ConnectionEnd::Reconfigured;
                }
                _ = tokio::time::sleep_until(last_heard + SILENCE) => break ConnectionEnd::Lost,
                _ = sleep_until_option(ice_deadline), if ice_deadline.is_some() => {
                    if state_kind == PeerState::Ready {
                        let id = format!("ice-{next_id}");
                        next_id += 1;
                        if write_json(&mut sink, json!({ "type": "ice", "id": id })).await.is_err() {
                            break ConnectionEnd::Lost;
                        }
                        ice_request_id = Some(id);
                        ice_deadline = None;
                    }
                }
                Some(outbound) = outbound_rx.recv() => {
                    match outbound {
                        Outbound::Relay { to, envelope } if state_kind == PeerState::Ready => {
                            let id = format!("relay-{next_id}");
                            next_id += 1;
                            let message = signal_message(&public_key, &to, &envelope);
                            let signature = self.inner.auth.sign_message(&message).await;
                            if write_json(&mut sink, json!({
                                "type": "relay", "id": id, "to": to,
                                "envelope": envelope, "signature": signature,
                            })).await.is_err() {
                                break ConnectionEnd::Lost;
                            }
                        }
                        Outbound::Relay { .. } => {}
                    }
                }
                frame = stream.next() => {
                    let Some(Ok(frame)) = frame else { break ConnectionEnd::Lost };
                    last_heard = Instant::now();
                    let Message::Text(text) = frame else {
                        if matches!(frame, Message::Close(_)) { break ConnectionEnd::Lost; }
                        continue;
                    };
                    let Ok(frame) = serde_json::from_str::<Value>(&text) else { break ConnectionEnd::Lost };
                    match frame.get("type").and_then(Value::as_str) {
                        Some("challenge") if state_kind == PeerState::Announced => {
                            let Some(challenge_host) = frame.get("broker").and_then(Value::as_str) else { break ConnectionEnd::Lost };
                            let Some(nonce) = frame.get("nonce").and_then(Value::as_str).filter(|nonce| valid_nonce(nonce)) else { break ConnectionEnd::Lost };
                            if challenge_host != broker_host { break ConnectionEnd::Lost; }
                            let fields = json!([broker_host, "machine", public_key, nonce]);
                            let signature = self.inner.auth.sign_message(&format!("pulsar-broker-hello-v1\n{fields}")).await;
                            if write_json(&mut sink, json!({ "type": "prove", "signature": signature })).await.is_err() {
                                break ConnectionEnd::Lost;
                            }
                        }
                        Some("ready") if state_kind == PeerState::Announced => {
                            state_kind = PeerState::Ready;
                            self.inner.ready_generation.fetch_add(1, Ordering::AcqRel);
                            let id = format!("ice-{next_id}");
                            next_id += 1;
                            if write_json(&mut sink, json!({ "type": "ice", "id": id })).await.is_err() {
                                break ConnectionEnd::Lost;
                            }
                            ice_request_id = Some(id);
                        }
                        Some("relayed") if state_kind == PeerState::Ready && handlers.len() < 32 => {
                            let service = self.clone();
                            let state = state.clone();
                            let outbound = outbound_tx.clone();
                            let machine_key = public_key.clone();
                            let handler_cancel = connection_cancel.clone();
                            handlers.spawn(async move {
                                service.handle_relayed(frame, machine_key, outbound, handler_cancel, state).await;
                            });
                        }
                        Some("ice") if state_kind == PeerState::Ready => {
                            let id = frame.get("id").and_then(Value::as_str);
                            if id == ice_request_id.as_deref() {
                                ice_request_id = None;
                                if let Some((servers, expires_at)) = parse_ice_grant(&frame) {
                                    self.inner.direct.set_broker_ice(servers, expires_at).await;
                                    ice_deadline = expires_at.map(|expires_at| {
                                        let remaining = expires_at.saturating_sub(now_ms());
                                        Instant::now() + Duration::from_millis((remaining * 2 / 3).max(1_000))
                                    });
                                }
                            }
                        }
                        Some("rate-limited") => {
                            let retry = frame.get("retryAfterMs").and_then(Value::as_u64).unwrap_or(0);
                            if frame.get("id").and_then(Value::as_str) == ice_request_id.as_deref() {
                                ice_request_id = None;
                                ice_deadline = Some(Instant::now() + Duration::from_millis(retry));
                            } else if frame.get("id").is_none() {
                                break ConnectionEnd::RateLimited(Duration::from_millis(retry));
                            }
                        }
                        Some("error") => {
                            let id = frame.get("id").and_then(Value::as_str);
                            if id == ice_request_id.as_deref() {
                                ice_request_id = None;
                                ice_deadline = Some(Instant::now() + ICE_RETRY);
                            } else if id.is_none()
                                && frame.get("code").and_then(Value::as_str) == Some("bad-frame")
                                && ice_request_id.is_some()
                            {
                                ice_request_id = None;
                            } else if id.is_none()
                                && frame.get("code").and_then(Value::as_str) == Some("replaced")
                            {
                                break ConnectionEnd::RateLimited(BACKOFF_MAX);
                            } else if id.is_none() {
                                break ConnectionEnd::Lost;
                            }
                        }
                        Some("delivered") => {}
                        _ => break ConnectionEnd::Lost,
                    }
                }
                completed = handlers.join_next(), if !handlers.is_empty() => {
                    if completed.is_some_and(|result| result.is_err()) {
                        break ConnectionEnd::Lost;
                    }
                }
            }
        };
        connection_cancel.cancel();
        if timeout(Duration::from_secs(2), async {
            while handlers.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            handlers.abort_all();
            while handlers.join_next().await.is_some() {}
        }
        let _ = timeout(Duration::from_secs(1), sink.send(Message::Close(None))).await;
        end
    }

    async fn handle_relayed(
        &self,
        frame: Value,
        machine_key: String,
        outbound: mpsc::Sender<Outbound>,
        connection_cancel: CancellationToken,
        state: AppState,
    ) {
        let Some(from) = frame
            .get("from")
            .and_then(Value::as_str)
            .filter(|key| valid_public_key(key))
        else {
            return;
        };
        let Some(envelope) = frame
            .get("envelope")
            .filter(|value| valid_envelope(value))
            .cloned()
        else {
            return;
        };
        let Some(signature) = frame
            .get("signature")
            .and_then(Value::as_str)
            .filter(|signature| valid_signature(signature))
        else {
            return;
        };
        if !AuthService::verify_message(
            from,
            &signal_message(from, &machine_key, &envelope),
            signature,
        ) {
            return;
        }
        let reply = |envelope: Value| {
            let result = outbound.try_send(Outbound::Relay {
                to: from.to_owned(),
                envelope,
            });
            if result.is_err() {
                connection_cancel.cancel();
            }
        };
        if !self.inner.auth.is_public_key_paired(from).await {
            if envelope.pointer("/signal/kind").and_then(Value::as_str) != Some("offer") {
                return;
            }
            let verdict = self.admit_statement(from, &envelope).await;
            if verdict != StatementVerdict::Admitted {
                let reason = if verdict == StatementVerdict::StatementsRefused {
                    "statements-refused"
                } else {
                    "not-paired"
                };
                reply(json!({
                    "connectionId": envelope["connectionId"],
                    "signal": { "kind": "close", "reason": reason },
                }));
                return;
            }
        }
        let connection_id = envelope["connectionId"].as_str().unwrap_or_default();
        let now = now_ms();
        {
            let mut owners = self.inner.owners.lock().await;
            owners.retain(|_, owner| owner.expires_at >= now);
            if let Some(owner) = owners.get(connection_id) {
                if owner.public_key != from {
                    return;
                }
            } else if envelope.pointer("/signal/kind").and_then(Value::as_str) == Some("offer") {
                owners.insert(
                    connection_id.to_owned(),
                    SignalOwner {
                        public_key: from.to_owned(),
                        expires_at: now.saturating_add(OWNER_TTL_MS),
                    },
                );
            }
        }
        let from = from.to_owned();
        let callback_cancel = connection_cancel.clone();
        let callback_outbound = outbound.clone();
        let callback = Arc::new(move |envelope| {
            if callback_outbound
                .try_send(Outbound::Relay {
                    to: from.clone(),
                    envelope,
                })
                .is_err()
            {
                callback_cancel.cancel();
            }
        });
        let _ = self
            .inner
            .direct
            .receive_broker(envelope, from_key(&frame), callback, state)
            .await;
    }

    async fn admit_statement(&self, from: &str, envelope: &Value) -> StatementVerdict {
        let Some(access) = envelope.pointer("/signal/access") else {
            return StatementVerdict::Refused;
        };
        let Some(label) = access.get("label").and_then(Value::as_str) else {
            return StatementVerdict::Refused;
        };
        let Some(statement) = access.get("statement") else {
            return StatementVerdict::Refused;
        };
        let Some(machine_id) = statement.get("machineId").and_then(Value::as_str) else {
            return StatementVerdict::Refused;
        };
        let Some(client_key) = statement.get("clientPublicKey").and_then(Value::as_str) else {
            return StatementVerdict::Refused;
        };
        let Some(nonce) = statement
            .get("nonce")
            .and_then(Value::as_str)
            .filter(|value| valid_nonce(value))
        else {
            return StatementVerdict::Refused;
        };
        let Some(issued_at) = statement.get("issuedAt").and_then(Value::as_u64) else {
            return StatementVerdict::Refused;
        };
        let Some(expires_at) = statement.get("expiresAt").and_then(Value::as_u64) else {
            return StatementVerdict::Refused;
        };
        let Some(signature) = statement
            .get("signature")
            .and_then(Value::as_str)
            .filter(|value| valid_signature(value))
        else {
            return StatementVerdict::Refused;
        };
        if machine_id != self.inner.auth.endpoint_id().await
            || client_key != from
            || label.is_empty()
            || label.encode_utf16().count() > 80
            || expires_at <= issued_at
            || expires_at - issued_at > STATEMENT_LIFETIME_MS
        {
            return StatementVerdict::Refused;
        }
        let now = now_ms();
        if now.saturating_add(STATEMENT_SKEW_MS) < issued_at
            || now.saturating_sub(STATEMENT_SKEW_MS) > expires_at
        {
            return StatementVerdict::Refused;
        }
        let fields = json!([machine_id, client_key, nonce, issued_at, expires_at]);
        let message = format!("pulsar-access-statement-v1\n{fields}");
        if !trusted_statement_keys()
            .iter()
            .any(|key| AuthService::verify_message(key, &message, signature))
        {
            return StatementVerdict::Refused;
        }
        if self.inner.auth.refuses_statements().await {
            return StatementVerdict::StatementsRefused;
        }
        match self
            .inner
            .auth
            .admit_statement(
                from,
                label,
                nonce,
                expires_at.saturating_add(STATEMENT_SKEW_MS),
            )
            .await
        {
            Ok(StatementAdmission::Admitted { .. }) => StatementVerdict::Admitted,
            _ => StatementVerdict::Refused,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StatementVerdict {
    Admitted,
    Refused,
    StatementsRefused,
}

async fn write_json<S>(sink: &mut S, value: Value) -> Result<(), ()>
where
    S: futures_util::Sink<Message> + Unpin,
{
    let text = serde_json::to_string(&value).map_err(|_| ())?;
    timeout(WRITE_TIMEOUT, sink.send(Message::Text(text.into())))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

async fn sleep_until_option(deadline: Option<Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending::<()>().await;
    }
}

fn broker_host(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let mut result = match url.host()? {
        Host::Domain(host) => host.to_owned(),
        Host::Ipv4(host) => host.to_string(),
        Host::Ipv6(host) => format!("[{host}]"),
    };
    if let Some(port) = url.port() {
        result.push(':');
        result.push_str(&port.to_string());
    }
    Some(result)
}

fn signal_message(from: &str, to: &str, envelope: &Value) -> String {
    let signal = &envelope["signal"];
    let mut fields = vec![
        json!(from),
        json!(to),
        envelope["connectionId"].clone(),
        signal["kind"].clone(),
    ];
    match signal["kind"].as_str() {
        Some("offer") => {
            fields.push(signal["sdp"].clone());
            if let Some(access) = signal.get("access") {
                let statement = &access["statement"];
                fields.extend([
                    statement["machineId"].clone(),
                    statement["clientPublicKey"].clone(),
                    statement["nonce"].clone(),
                    statement["issuedAt"].clone(),
                    statement["expiresAt"].clone(),
                    statement["signature"].clone(),
                    access["label"].clone(),
                ]);
            }
        }
        Some("answer") => fields.push(signal["sdp"].clone()),
        Some("candidate") => fields.extend([
            signal["candidate"].clone(),
            signal["sdpMid"].clone(),
            signal["sdpMLineIndex"].clone(),
        ]),
        Some("close") => fields.push(signal["reason"].clone()),
        _ => {}
    }
    format!(
        "pulsar-signal-v1\n{}",
        serde_json::to_string(&fields).unwrap_or_default()
    )
}

fn valid_envelope(value: &Value) -> bool {
    let Some(connection_id) = value.get("connectionId").and_then(Value::as_str) else {
        return false;
    };
    if !(8..=64).contains(&connection_id.len())
        || !connection_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return false;
    }
    let signal = &value["signal"];
    match signal.get("kind").and_then(Value::as_str) {
        Some("offer") => {
            signal
                .get("sdp")
                .and_then(Value::as_str)
                .is_some_and(|sdp| !sdp.is_empty() && sdp.encode_utf16().count() <= 32_768)
                && signal.get("access").is_none_or(valid_access_shape)
        }
        Some("answer") => signal
            .get("sdp")
            .and_then(Value::as_str)
            .is_some_and(|sdp| !sdp.is_empty() && sdp.encode_utf16().count() <= 32_768),
        Some("candidate") => {
            signal
                .get("candidate")
                .and_then(Value::as_str)
                .is_some_and(|value| value.encode_utf16().count() <= 1024)
                && signal.get("sdpMid").is_some_and(|value| {
                    value.is_null()
                        || value
                            .as_str()
                            .is_some_and(|value| value.encode_utf16().count() <= 64)
                })
                && signal.get("sdpMLineIndex").is_some_and(|value| {
                    value.is_null() || value.as_u64().is_some_and(|value| value <= u16::MAX.into())
                })
        }
        Some("close") => signal
            .get("reason")
            .and_then(Value::as_str)
            .is_some_and(|reason| {
                matches!(
                    reason,
                    "declined"
                        | "failed"
                        | "timeout"
                        | "done"
                        | "not-paired"
                        | "statements-refused"
                )
            }),
        _ => false,
    }
}

fn valid_access_shape(access: &Value) -> bool {
    let Some(label) = access.get("label").and_then(Value::as_str) else {
        return false;
    };
    let statement = &access["statement"];
    !label.is_empty()
        && label.encode_utf16().count() <= 80
        && statement
            .get("machineId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.encode_utf16().count() <= 128)
        && statement
            .get("clientPublicKey")
            .and_then(Value::as_str)
            .is_some_and(valid_public_key)
        && statement
            .get("nonce")
            .and_then(Value::as_str)
            .is_some_and(valid_nonce)
        && statement.get("issuedAt").and_then(Value::as_u64).is_some()
        && statement.get("expiresAt").and_then(Value::as_u64).is_some()
        && statement
            .get("signature")
            .and_then(Value::as_str)
            .is_some_and(valid_signature)
}

fn parse_ice_grant(frame: &Value) -> Option<(Vec<BrokerIceServer>, Option<u64>)> {
    let servers = frame.get("servers")?.as_array()?;
    if servers.len() > 8 {
        return None;
    }
    let mut parsed = Vec::new();
    for server in servers {
        let urls = match server.get("urls")? {
            Value::String(url) => vec![url.clone()],
            Value::Array(urls) if (1..=8).contains(&urls.len()) => urls
                .iter()
                .map(Value::as_str)
                .collect::<Option<Vec<_>>>()?
                .into_iter()
                .map(str::to_owned)
                .collect(),
            _ => return None,
        };
        if urls.iter().any(|url| {
            url.len() > 512
                || !matches!(
                    url.split_once(':').map(|(scheme, _)| scheme),
                    Some("stun" | "stuns" | "turn" | "turns")
                )
        }) {
            return None;
        }
        let username = server
            .get("username")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let credential = server
            .get("credential")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if username.encode_utf16().count() > 256 || credential.encode_utf16().count() > 256 {
            return None;
        }
        parsed.push(BrokerIceServer {
            urls,
            username: username.to_owned(),
            credential: credential.to_owned(),
        });
    }
    let expires_at = match frame.get("expiresAt")? {
        Value::Null => None,
        value => Some(value.as_u64()?),
    };
    Some((parsed, expires_at))
}

fn valid_public_key(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32)
}

fn valid_signature(value: &str) -> bool {
    value.len() == 86
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 64)
}

fn valid_nonce(value: &str) -> bool {
    (22..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn trusted_statement_keys() -> Vec<String> {
    #[cfg(debug_assertions)]
    if let Ok(key) = std::env::var("RUIMTE_PULSAR_TEST_STATEMENT_KEY")
        && valid_public_key(key.trim())
    {
        return vec![key.trim().to_owned()];
    }
    vec![TRUSTED_STATEMENT_KEY.to_owned()]
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn from_key(frame: &Value) -> String {
    frame
        .get("from")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_build_ignores_the_test_statement_key_environment() {
        let test_key = URL_SAFE_NO_PAD.encode([7_u8; 32]);
        unsafe {
            std::env::set_var("RUIMTE_PULSAR_TEST_STATEMENT_KEY", &test_key);
        }
        let trusted = trusted_statement_keys();
        unsafe {
            std::env::remove_var("RUIMTE_PULSAR_TEST_STATEMENT_KEY");
        }
        assert!(!trusted.contains(&test_key));
        assert_eq!(trusted, vec![TRUSTED_STATEMENT_KEY.to_owned()]);
    }

    #[test]
    fn canonical_signal_message_includes_statement_fields_in_wire_order() {
        let envelope = json!({
            "connectionId": "attempt-0001",
            "signal": {
                "kind": "offer",
                "sdp": "v=0",
                "access": {
                    "statement": {
                        "machineId": "m", "clientPublicKey": "k", "nonce": "n",
                        "issuedAt": 1, "expiresAt": 2, "signature": "s"
                    },
                    "label": "Laptop"
                }
            }
        });
        assert_eq!(
            signal_message("from", "to", &envelope),
            "pulsar-signal-v1\n[\"from\",\"to\",\"attempt-0001\",\"offer\",\"v=0\",\"m\",\"k\",\"n\",1,2,\"s\",\"Laptop\"]"
        );
    }

    #[test]
    fn validates_signal_and_statement_lifetime_shapes() {
        let close = json!({
            "connectionId": "attempt-0001",
            "signal": { "kind": "close", "reason": "done" }
        });
        assert!(valid_envelope(&close));
        assert!(!valid_envelope(&json!({
            "connectionId": "short",
            "signal": { "kind": "close", "reason": "done" }
        })));
    }
}
