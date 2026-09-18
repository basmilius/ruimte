use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use bytes::BytesMut;
use hmac::{Hmac, Mac};
use rand::{RngCore, rngs::OsRng};
use rtc::peer_connection::{configuration::setting_engine::SettingEngine, transport::RTCDtlsRole};
use rtc::statistics::{StatsSelector, report::RTCStatsReportEntry};
use serde_json::{Value, json};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use tokio::{
    sync::{Mutex, Notify, RwLock, mpsc},
    task::JoinSet,
    time::timeout,
};
use tokio_util::sync::CancellationToken;
use webrtc::{
    data_channel::{DataChannel, DataChannelEvent},
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceCandidateType, RTCIceGatheringState, RTCIceServer,
        RTCSessionDescription,
    },
};

use crate::{
    PROTOCOL_VERSION,
    router::{
        AppState, accept_frame, finish_requests_and_detach, reachability,
        revocation_closes_connection,
    },
    rpc::{ClientAccess, RequestContext, RpcError, RpcResult},
};

const MAX_ATTEMPTS: usize = 32;
const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(30);
const GATHER_TIMEOUT: Duration = Duration::from_secs(5);
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_GRACE: Duration = Duration::from_secs(1);
const UNAUTHENTICATED_CHARS: usize = 4_096;
const AUTHENTICATED_CHARS: usize = 16 * 1024 * 1024;
const PIECE_CHARS: usize = 16_000;

#[derive(Clone)]
pub struct DirectService {
    inner: Arc<DirectInner>,
}

struct DirectInner {
    attempts: Mutex<HashMap<String, Attempt>>,
    shutting_down: AtomicBool,
    stun: Vec<String>,
    ports: Option<(u16, u16)>,
    host_addresses: Vec<String>,
    broker_ice: RwLock<Option<BrokerIceGrant>>,
}

#[derive(Clone, Debug)]
pub struct BrokerIceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

#[derive(Clone)]
struct BrokerIceGrant {
    servers: Vec<BrokerIceServer>,
    expires_at: Option<u64>,
}

struct Attempt {
    generation: uuid::Uuid,
    owner: String,
    peer: Option<Arc<dyn PeerConnection>>,
    opening: CancellationToken,
}

struct DirectHandler {
    channel_taken: Arc<AtomicBool>,
    channels: mpsc::Sender<Arc<dyn DataChannel>>,
    gathered: Arc<Notify>,
    opening: CancellationToken,
}

#[derive(Clone)]
struct SignalReply(Arc<dyn Fn(Value) + Send + Sync>);

impl SignalReply {
    fn send(&self, connection_id: &str, signal: Value) {
        (self.0)(json!({ "connectionId": connection_id, "signal": signal }));
    }
}

#[async_trait]
impl PeerConnectionEventHandler for DirectHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            self.gathered.notify_waiters();
        }
    }

    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        let channel_taken = self.channel_taken.clone();
        let channels = self.channels.clone();
        let opening = self.opening.clone();
        tokio::spawn(async move {
            let label = channel.label().await.unwrap_or_default();
            if label != "ruimte"
                || channel_taken.swap(true, Ordering::AcqRel)
                || channels.send(channel.clone()).await.is_err()
            {
                let _ = channel.close().await;
                return;
            }
            opening.cancel();
        });
    }
}

impl DirectService {
    pub fn new(stun: Vec<String>, ports: Option<(u16, u16)>, host_addresses: Vec<String>) -> Self {
        Self {
            inner: Arc::new(DirectInner {
                attempts: Mutex::new(HashMap::new()),
                shutting_down: AtomicBool::new(false),
                stun,
                ports,
                host_addresses,
                broker_ice: RwLock::new(None),
            }),
        }
    }

    pub async fn set_broker_ice(&self, servers: Vec<BrokerIceServer>, expires_at: Option<u64>) {
        *self.inner.broker_ice.write().await = Some(BrokerIceGrant {
            servers,
            expires_at,
        });
    }

    pub async fn clear_broker_ice(&self) {
        *self.inner.broker_ice.write().await = None;
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
        state: AppState,
    ) -> Option<RpcResult> {
        if method != "direct.signal" {
            return None;
        }
        let envelope = payload.get("envelope").cloned().unwrap_or(Value::Null);
        let events = state.events.clone();
        let client_id = context.client_id.clone();
        let reply = SignalReply(Arc::new(move |envelope| {
            let _ = events.send(
                &client_id,
                "direct.signaled",
                json!({ "envelope": envelope }),
            );
        }));
        let result = self
            .signal(envelope, context.client_id.clone(), reply, state)
            .await;
        Some(result.map(|_| json!({})))
    }

    pub async fn receive_broker(
        &self,
        envelope: Value,
        owner_public_key: String,
        reply: Arc<dyn Fn(Value) + Send + Sync>,
        state: AppState,
    ) -> Result<(), RpcError> {
        self.signal(envelope, owner_public_key, SignalReply(reply), state)
            .await
    }

    pub async fn begin_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
        let attempts = self
            .inner
            .attempts
            .lock()
            .await
            .drain()
            .map(|(_, attempt)| attempt)
            .collect::<Vec<_>>();
        for attempt in attempts {
            attempt.opening.cancel();
            if let Some(peer) = attempt.peer {
                let _ = peer.close().await;
            }
        }
    }

    async fn signal(
        &self,
        envelope: Value,
        owner: String,
        reply: SignalReply,
        state: AppState,
    ) -> Result<(), RpcError> {
        let connection_id = envelope["connectionId"]
            .as_str()
            .ok_or_else(|| RpcError::new("bad-request", "Invalid direct signal"))?
            .to_owned();
        match envelope.pointer("/signal/kind").and_then(Value::as_str) {
            Some("offer") => {
                let sdp = envelope
                    .pointer("/signal/sdp")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                self.answer(connection_id, owner, sdp, reply, state).await
            }
            Some("candidate") => {
                let peer = self
                    .inner
                    .attempts
                    .lock()
                    .await
                    .get(&connection_id)
                    .filter(|attempt| attempt.owner == owner)
                    .and_then(|attempt| attempt.peer.clone());
                if let Some(peer) = peer {
                    let candidate = envelope
                        .pointer("/signal/candidate")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !candidate.is_empty() {
                        let _ = peer
                            .add_ice_candidate(RTCIceCandidateInit {
                                candidate: candidate.to_owned(),
                                sdp_mid: envelope
                                    .pointer("/signal/sdpMid")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned),
                                sdp_mline_index: envelope
                                    .pointer("/signal/sdpMLineIndex")
                                    .and_then(Value::as_u64)
                                    .and_then(|value| u16::try_from(value).ok()),
                                ..Default::default()
                            })
                            .await;
                    }
                }
                Ok(())
            }
            Some("close") => {
                self.close_owned(&connection_id, &owner).await;
                Ok(())
            }
            Some("answer") => Ok(()),
            _ => Err(RpcError::new("bad-request", "Invalid direct signal")),
        }
    }

    async fn answer(
        &self,
        connection_id: String,
        owner: String,
        offer_sdp: String,
        reply: SignalReply,
        state: AppState,
    ) -> Result<(), RpcError> {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(RpcError::new("shutting-down", "Server is shutting down"));
        }
        let generation = uuid::Uuid::new_v4();
        let opening = CancellationToken::new();
        {
            let mut attempts = self.inner.attempts.lock().await;
            if self.inner.shutting_down.load(Ordering::Acquire) {
                return Err(RpcError::new("shutting-down", "Server is shutting down"));
            }
            if attempts.contains_key(&connection_id) {
                return Ok(());
            }
            if attempts.len() >= MAX_ATTEMPTS {
                drop(attempts);
                reply.send(
                    &connection_id,
                    json!({ "kind": "close", "reason": "declined" }),
                );
                return Ok(());
            }
            attempts.insert(
                connection_id.clone(),
                Attempt {
                    generation,
                    owner: owner.clone(),
                    peer: None,
                    opening: opening.clone(),
                },
            );
        }
        let binding = Arc::new(RwLock::new(None));
        let gathered = Arc::new(Notify::new());
        let (channels, mut channel_receiver) = mpsc::channel(1);
        let handler = Arc::new(DirectHandler {
            channel_taken: Arc::new(AtomicBool::new(false)),
            channels,
            gathered: gathered.clone(),
            opening: opening.clone(),
        });
        let peer = match self.build_peer(handler).await {
            Ok(peer) => peer,
            Err(error) => {
                self.remove_exact(&connection_id, &owner, generation).await;
                return Err(error);
            }
        };
        let committed = {
            let mut attempts = self.inner.attempts.lock().await;
            if self.inner.shutting_down.load(Ordering::Acquire) {
                false
            } else if let Some(attempt) = attempts.get_mut(&connection_id)
                && attempt.owner == owner
                && attempt.generation == generation
            {
                attempt.peer = Some(peer.clone());
                true
            } else {
                false
            }
        };
        if !committed {
            let _ = peer.close().await;
            self.remove_exact(&connection_id, &owner, generation).await;
            return Err(RpcError::new("shutting-down", "Server is shutting down"));
        }

        let service = self.clone();
        let timeout_id = connection_id.clone();
        let timeout_owner = owner.clone();
        let timeout_reply = reply.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(ATTEMPT_TIMEOUT) => {}
                _ = opening.cancelled() => return,
            }
            if service
                .close_exact(&timeout_id, &timeout_owner, generation)
                .await
            {
                timeout_reply.send(&timeout_id, json!({ "kind": "close", "reason": "timeout" }));
            }
        });

        let result = async {
            let gathered_done = gathered.notified();
            tokio::pin!(gathered_done);
            gathered_done.as_mut().enable();
            peer.set_remote_description(
                RTCSessionDescription::offer(offer_sdp.clone()).map_err(direct_error)?,
            )
            .await
            .map_err(direct_error)?;
            let answer = peer.create_answer(None).await.map_err(direct_error)?;
            peer.set_local_description(answer)
                .await
                .map_err(direct_error)?;
            let _ = timeout(GATHER_TIMEOUT, &mut gathered_done).await;
            let answer = peer
                .local_description()
                .await
                .ok_or_else(|| RpcError::new("direct-failed", "WebRTC produced no answer"))?;
            *binding.write().await = Some(channel_binding(&offer_sdp, &answer.sdp));
            reply.send(
                &connection_id,
                json!({ "kind": "answer", "sdp": answer.sdp }),
            );
            Ok::<_, RpcError>(())
        }
        .await;
        if let Err(error) = result {
            reply.send(
                &connection_id,
                json!({ "kind": "close", "reason": "failed" }),
            );
            self.close_exact(&connection_id, &owner, generation).await;
            return Err(error);
        }

        let service = self.clone();
        tokio::spawn(async move {
            if let Some(channel) = channel_receiver.recv().await {
                let binding = binding.read().await.clone().unwrap_or_default();
                run_channel(channel, peer, binding, state.clone()).await;
            }
            service
                .close_exact(&connection_id, &owner, generation)
                .await;
        });
        Ok(())
    }

    async fn build_peer(
        &self,
        handler: Arc<DirectHandler>,
    ) -> Result<Arc<dyn PeerConnection>, RpcError> {
        let mut ice_servers = self
            .inner
            .stun
            .iter()
            .map(|url| RTCIceServer {
                urls: vec![url.clone()],
                ..Default::default()
            })
            .collect::<Vec<_>>();
        if let Some(grant) = self.inner.broker_ice.read().await.as_ref()
            && grant
                .expires_at
                .is_none_or(|expires_at| expires_at > now_ms())
        {
            ice_servers.extend(grant.servers.iter().map(|server| RTCIceServer {
                urls: server.urls.clone(),
                username: server.username.clone(),
                credential: server.credential.clone(),
            }));
        }
        let configuration = RTCConfigurationBuilder::new()
            .with_ice_servers(ice_servers)
            .build();
        let ports = self
            .inner
            .ports
            .map(|(first, last)| (first..=last).collect::<Vec<_>>())
            .unwrap_or_else(|| vec![0]);
        let mut last_error = None;
        for port in ports {
            let mut settings = SettingEngine::default();
            // Werift selects its SCTP association role from ICE rather than DTLS; a passive
            // answer keeps both that peer and standards-compliant browsers interoperable.
            settings
                .set_answering_dtls_role(RTCDtlsRole::Server)
                .map_err(direct_error)?;
            if !self.inner.host_addresses.is_empty() {
                settings
                    .set_nat_1to1_ips(self.inner.host_addresses.clone(), RTCIceCandidateType::Host);
            }
            match PeerConnectionBuilder::new()
                .with_configuration(configuration.clone())
                .with_setting_engine(settings)
                .with_handler(handler.clone())
                .with_udp_addrs(vec![format!("0.0.0.0:{port}")])
                .with_data_channel_send_buffer_limit(8 * 1024 * 1024)
                .build()
                .await
            {
                Ok(peer) => return Ok(Arc::new(peer)),
                Err(error) => last_error = Some(error),
            }
        }
        Err(direct_error(last_error.map_or_else(
            || "No UDP port is available".to_owned(),
            |error| error.to_string(),
        )))
    }

    async fn close_owned(&self, connection_id: &str, owner: &str) -> bool {
        self.close_matching(connection_id, owner, None).await
    }

    async fn close_exact(&self, connection_id: &str, owner: &str, generation: uuid::Uuid) -> bool {
        self.close_matching(connection_id, owner, Some(generation))
            .await
    }

    async fn remove_exact(&self, connection_id: &str, owner: &str, generation: uuid::Uuid) {
        let _ = self
            .close_matching(connection_id, owner, Some(generation))
            .await;
    }

    async fn close_matching(
        &self,
        connection_id: &str,
        owner: &str,
        generation: Option<uuid::Uuid>,
    ) -> bool {
        let attempt = {
            let mut attempts = self.inner.attempts.lock().await;
            if attempts.get(connection_id).is_some_and(|attempt| {
                attempt.owner == owner
                    && generation.is_none_or(|generation| attempt.generation == generation)
            }) {
                attempts.remove(connection_id)
            } else {
                None
            }
        };
        if let Some(attempt) = attempt {
            attempt.opening.cancel();
            if let Some(peer) = attempt.peer {
                let _ = peer.close().await;
            }
            true
        } else {
            false
        }
    }
}

impl Default for DirectService {
    fn default() -> Self {
        Self::new(Vec::new(), None, Vec::new())
    }
}

async fn run_channel(
    channel: Arc<dyn DataChannel>,
    peer: Arc<dyn PeerConnection>,
    binding: String,
    state: AppState,
) {
    let Some(_connection) = state.enter_connection() else {
        let _ = channel.close().await;
        return;
    };
    let remote_reachability = direct_reachability(&peer).await;
    let access = match timeout(
        AUTH_TIMEOUT,
        authenticate_channel(&channel, &binding, &remote_reachability, &state),
    )
    .await
    {
        Ok(Some(access)) => access,
        _ => {
            let _ = channel.close().await;
            return;
        }
    };
    let client_id = format!("direct:{}", uuid::Uuid::new_v4());
    state.sessions.register_client(&client_id).await;
    state.push.connected(access.session_id.as_deref()).await;
    let frames = state.events.subscribe(client_id.clone());
    let overflow = frames.cancel.clone();
    let closed = CancellationToken::new();
    let writer = tokio::spawn(channel_writer(
        channel.clone(),
        frames,
        closed.clone(),
        state.shutdown_token(),
        state.sessions.clone(),
        state.events.clone(),
        client_id.clone(),
    ));
    let mut assembler = FrameAssembler::default();
    let mut requests = JoinSet::new();
    let shutdown = state.shutdown_token();
    let mut revoked = state.auth.subscribe_revocations();
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            _ = closed.cancelled() => break,
            _ = overflow.cancelled() => break,
            result = revoked.recv() => {
                if revocation_closes_connection(&state.auth, access.session_id.as_deref(), result).await {
                    break;
                }
            }
            completed = requests.join_next(), if !requests.is_empty() => {
                if completed.is_some_and(|result| result.is_err()) { break; }
            }
            event = channel.poll() => {
                match event {
                    Some(DataChannelEvent::OnMessage(message)) => {
                        let piece = String::from_utf8_lossy(&message.data).into_owned();
                        match assembler.push(&piece, AUTHENTICATED_CHARS) {
                            Assembled::Frame(frame) => {
                                if accept_frame(&state, &client_id, &access, frame.as_bytes(), &mut requests).is_err() { break; }
                            }
                            Assembled::Invalid => break,
                            Assembled::Partial => {}
                        }
                    }
                    Some(DataChannelEvent::OnClose) | None => break,
                    _ => {}
                }
            }
        }
    }
    closed.cancel();
    let _ = timeout(CLOSE_GRACE, writer).await;
    state.events.unsubscribe(&client_id);
    state.push.disconnected(access.session_id.as_deref()).await;
    let _ = timeout(CLOSE_GRACE, async {
        let _ = channel.close().await;
        while let Some(event) = channel.poll().await {
            if matches!(event, DataChannelEvent::OnClose) {
                break;
            }
        }
    })
    .await;
    finish_requests_and_detach(state, client_id, requests).await;
}

async fn channel_writer(
    channel: Arc<dyn DataChannel>,
    mut frames: crate::events::EventSubscription,
    closed: CancellationToken,
    shutdown: CancellationToken,
    sessions: crate::sessions::SessionsService,
    events: crate::events::EventBus,
    client_id: String,
) {
    let overflow = frames.cancel.clone();
    loop {
        tokio::select! {
            _ = closed.cancelled() => break,
            _ = shutdown.cancelled() => break,
            _ = overflow.cancelled() => break,
            frame = frames.recv() => {
                let Some(frame) = frame else { break };
                let sent = tokio::select! {
                    _ = closed.cancelled() => false,
                    _ = shutdown.cancelled() => false,
                    _ = overflow.cancelled() => false,
                    result = timeout(WRITE_TIMEOUT, send_frame(&channel, frame.text())) => matches!(result, Ok(Ok(()))),
                };
                if !sent {
                    break;
                }
                drop(frame);
                if let Some(session_ids) = frames.begin_terminal_resync() {
                    for session_id in session_ids {
                        if closed.is_cancelled() || shutdown.is_cancelled() || overflow.is_cancelled() {
                            break;
                        }
                        if !sessions.resync(&client_id, &session_id).await {
                            events.drop_terminal_stale(&client_id, &session_id);
                        }
                    }
                    frames.end_terminal_resync();
                }
            }
        }
    }
    closed.cancel();
}

async fn authenticate_channel(
    channel: &Arc<dyn DataChannel>,
    binding: &str,
    reachability: &str,
    state: &AppState,
) -> Option<ClientAccess> {
    let daemon_id = state.auth.endpoint_id().await;
    let daemon_key = state.auth.endpoint_public_key().await;
    let challenge = random_token(32);
    let daemon_message = format!("ruimte-daemon-channel-v1\n{daemon_id}\n{challenge}\n{binding}");
    let challenge_frame = json!({
        "type": "direct.challenge",
        "protocol": PROTOCOL_VERSION,
        "challenge": challenge,
        "daemon": {
            "id": daemon_id,
            "publicKey": daemon_key,
            "signature": state.auth.sign_message(&daemon_message).await,
        }
    });
    send_frame(channel, &challenge_frame.to_string())
        .await
        .ok()?;
    let mut assembler = FrameAssembler::default();
    let proof = loop {
        match channel.poll().await? {
            DataChannelEvent::OnMessage(message) => {
                let piece = String::from_utf8_lossy(&message.data);
                match assembler.push(&piece, UNAUTHENTICATED_CHARS) {
                    Assembled::Frame(frame) => break serde_json::from_str::<Value>(&frame).ok()?,
                    Assembled::Invalid => return refuse(channel, "Expected a proof", None).await,
                    Assembled::Partial => {}
                }
            }
            DataChannelEvent::OnClose => return None,
            _ => {}
        }
    };
    if !valid_proof(&proof) {
        return refuse(channel, "Expected a proof", None).await;
    }
    if proof["challenge"].as_str() != Some(&challenge) {
        return refuse(channel, "Expected a proof", None).await;
    }
    if let Some(protocol) = proof.get("protocol").and_then(Value::as_u64)
        && protocol != PROTOCOL_VERSION
    {
        return refuse(
            channel,
            "This machine and this client run different versions of Ruimte",
            Some(PROTOCOL_VERSION),
        )
        .await;
    }
    let (access, ticket) = match proof["type"].as_str() {
        Some("direct.key") => {
            let public_key = proof["publicKey"].as_str()?;
            let signature = proof["signature"].as_str()?;
            let message = format!(
                "ruimte-client-channel-v1\n{daemon_id}\n{challenge}\n{public_key}\n{binding}"
            );
            let Some((session_id, ticket)) = state
                .auth
                .authenticate_signed_key(public_key, &message, signature)
                .await
            else {
                return refuse(
                    channel,
                    "This machine does not recognize that signature. Pair again.",
                    None,
                )
                .await;
            };
            (
                ClientAccess {
                    reachability: reachability.to_owned(),
                    session_id: Some(session_id),
                },
                Some(ticket),
            )
        }
        Some("direct.secret") => {
            let message = format!("ruimte-local-channel-v1\n{daemon_id}\n{challenge}\n{binding}");
            let mut mac =
                Hmac::<Sha256>::new_from_slice(state.auth.local_secret().as_bytes()).ok()?;
            mac.update(message.as_bytes());
            let expected = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
            let supplied = proof["proof"].as_str().unwrap_or_default();
            if expected.as_bytes().ct_eq(supplied.as_bytes()).unwrap_u8() != 1 {
                return refuse(channel, "That is not the secret of this machine", None).await;
            }
            (
                ClientAccess {
                    reachability: reachability.to_owned(),
                    session_id: None,
                },
                None,
            )
        }
        _ => return refuse(channel, "Expected a proof", None).await,
    };
    let accepted = json!({
        "type": "direct.accepted",
        "ticket": ticket,
        "expiresIn": ticket.as_ref().map(|_| 12 * 60 * 60 * 1000_u64),
    });
    send_frame(channel, &accepted.to_string()).await.ok()?;
    Some(access)
}

async fn direct_reachability(peer: &Arc<dyn PeerConnection>) -> String {
    let report = peer.get_stats(Instant::now(), StatsSelector::None).await;
    let remote_id = report.iter().find_map(|entry| match entry {
        RTCStatsReportEntry::IceCandidatePair(pair) if pair.nominated => {
            Some(pair.remote_candidate_id.as_str())
        }
        _ => None,
    });
    remote_id
        .and_then(|id| report.get(id))
        .and_then(|entry| match entry {
            RTCStatsReportEntry::RemoteCandidate(candidate) => candidate.address.as_deref(),
            _ => None,
        })
        .and_then(|address| address.parse().ok())
        .map(reachability)
        .unwrap_or("public")
        .to_owned()
}

async fn refuse(
    channel: &Arc<dyn DataChannel>,
    reason: &str,
    protocol: Option<u64>,
) -> Option<ClientAccess> {
    let mut frame = json!({ "type": "direct.refused", "reason": reason });
    if let Some(protocol) = protocol {
        frame["protocol"] = json!(protocol);
    }
    let _ = send_frame(channel, &frame.to_string()).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let _ = channel.close().await;
    None
}

async fn send_frame(channel: &Arc<dyn DataChannel>, frame: &str) -> Result<(), ()> {
    for piece in split_frame(frame, PIECE_CHARS) {
        channel
            .send(BytesMut::from(piece.as_bytes()))
            .await
            .map_err(|_| ())?;
    }
    Ok(())
}

fn split_frame(frame: &str, limit: usize) -> Vec<String> {
    if frame.encode_utf16().count() <= limit {
        return vec![format!("={frame}")];
    }
    let mut pieces = Vec::new();
    let mut start = 0;
    let mut units = 0;
    for (index, character) in frame.char_indices() {
        let width = character.len_utf16();
        if units + width > limit {
            pieces.push(format!("+{}", &frame[start..index]));
            start = index;
            units = 0;
        }
        units += width;
    }
    pieces.push(format!("={}", &frame[start..]));
    pieces
}

#[derive(Default)]
struct FrameAssembler {
    buffer: String,
    units: usize,
}

enum Assembled {
    Frame(String),
    Partial,
    Invalid,
}

impl FrameAssembler {
    fn push(&mut self, piece: &str, limit: usize) -> Assembled {
        let Some(mark) = piece.chars().next() else {
            return Assembled::Invalid;
        };
        if mark != '+' && mark != '=' {
            return Assembled::Invalid;
        }
        let body = &piece[mark.len_utf8()..];
        self.units = self.units.saturating_add(body.encode_utf16().count());
        if self.units > limit {
            self.buffer.clear();
            self.units = 0;
            return Assembled::Invalid;
        }
        if mark == '+' {
            if body.is_empty() {
                return Assembled::Invalid;
            }
            self.buffer.push_str(body);
            return Assembled::Partial;
        }
        self.buffer.push_str(body);
        let frame = std::mem::take(&mut self.buffer);
        self.units = 0;
        Assembled::Frame(frame)
    }
}

fn valid_proof(proof: &Value) -> bool {
    let Some(object) = proof.as_object() else {
        return false;
    };
    let bounded = |field: &str, max: usize| {
        object
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.encode_utf16().count() <= max)
    };
    let protocol_valid = object
        .get("protocol")
        .is_none_or(|value| value.as_u64().is_some());
    protocol_valid
        && bounded("challenge", 256)
        && match object.get("type").and_then(Value::as_str) {
            Some("direct.key") => bounded("publicKey", 256) && bounded("signature", 512),
            Some("direct.secret") => bounded("proof", 256),
            _ => false,
        }
}

fn channel_binding(offer: &str, answer: &str) -> String {
    serde_json::to_string(&json!([sdp_fingerprints(offer), sdp_fingerprints(answer)]))
        .unwrap_or_default()
}

fn sdp_fingerprints(sdp: &str) -> Vec<String> {
    let mut fingerprints = sdp
        .lines()
        .filter_map(|line| line.trim_end_matches('\r').strip_prefix("a=fingerprint:"))
        .filter_map(|value| value.split_once(char::is_whitespace))
        .filter(|(algorithm, fingerprint)| {
            !algorithm.is_empty()
                && !fingerprint.is_empty()
                && fingerprint
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || byte == b':')
        })
        .map(|(algorithm, fingerprint)| {
            format!(
                "{} {}",
                algorithm.to_ascii_lowercase(),
                fingerprint.to_ascii_uppercase()
            )
        })
        .collect::<Vec<_>>();
    fingerprints.sort();
    fingerprints.dedup();
    fingerprints
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn direct_error(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("direct-failed", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmentation_uses_javascript_utf16_boundaries() {
        assert_eq!(split_frame("a😀b", 2), vec!["+a", "+😀", "=b"]);
        let mut assembler = FrameAssembler::default();
        assert!(matches!(assembler.push("+a", 4), Assembled::Partial));
        assert!(matches!(assembler.push("+😀", 4), Assembled::Partial));
        match assembler.push("=b", 4) {
            Assembled::Frame(frame) => assert_eq!(frame, "a😀b"),
            _ => panic!("frame did not assemble"),
        }
        assert!(matches!(assembler.push("+", 4), Assembled::Invalid));
    }

    #[test]
    fn binding_sorts_and_deduplicates_fingerprints() {
        let offer = "a=fingerprint:SHA-256 aa:bb\r\na=fingerprint:sha-256 AA:BB\r\n";
        let answer = "a=fingerprint:sha-384 cc:dd\r\n";
        assert_eq!(
            channel_binding(offer, answer),
            "[[\"sha-256 AA:BB\"],[\"sha-384 CC:DD\"]]"
        );
    }

    #[test]
    fn proof_requires_the_discriminated_shape_and_nonnegative_integer_protocol() {
        assert!(valid_proof(&json!({
            "type": "direct.secret", "challenge": "c", "proof": "p"
        })));
        assert!(valid_proof(&json!({
            "type": "direct.key", "protocol": 1, "challenge": "c",
            "publicKey": "k", "signature": "s"
        })));
        assert!(!valid_proof(&json!({
            "type": "direct.secret", "protocol": null, "challenge": "c", "proof": "p"
        })));
        assert!(!valid_proof(&json!({
            "type": "direct.secret", "protocol": -1, "challenge": "c", "proof": "p"
        })));
        assert!(!valid_proof(&json!({
            "type": "direct.key", "challenge": "c", "publicKey": "k"
        })));
    }
}
