use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::{Component, Path},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use anyhow::Result;
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{
        ConnectInfo, Path as AxumPath, Query, Request, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use futures_util::{SinkExt, StreamExt};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpListener,
    sync::{Notify, mpsc},
    task::JoinSet,
    time::{Duration, timeout},
};
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;
use url::Url;
use uuid::Uuid;

use crate::{
    PROTOCOL_VERSION, VERSION,
    auth::AuthService,
    broker::BrokerService,
    browser::BrowserService,
    chat::{ChatContextHost, ChatForkWorkspaceHost, ChatService},
    config::ServerConfig,
    devices::DevicesService,
    direct::DirectService,
    events::EventBus,
    processes::ProcessesService,
    providers::ProvidersService,
    push::PushService,
    rpc::{ClientAccess, RequestContext, RpcError, RpcResult},
    runtime::NativeRuntimeHost,
    schema,
    sessions::{AgentHookResult, SessionsService},
    streams::{LIVE_STREAM_MAGIC, encode_live_frame},
    usage::UsageService,
    workspace::WorkspaceService,
};

const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAX_IN_FLIGHT_REQUESTS: usize = 16;
const CLOSE_GRACE: Duration = Duration::from_secs(1);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const IMMUTABLE_CACHE: &str = "private, max-age=31536000, immutable";
const SVG_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'";
const CLIENT_CSP: &str = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:";

#[derive(Clone)]
pub struct AppState {
    config: Arc<ServerConfig>,
    pub events: EventBus,
    pub auth: AuthService,
    pub broker: BrokerService,
    pub browser: BrowserService,
    pub chat: ChatService,
    pub devices: DevicesService,
    pub direct: DirectService,
    pub workspace: Arc<WorkspaceService>,
    pub sessions: SessionsService,
    pub processes: ProcessesService,
    pub providers: ProvidersService,
    pub push: PushService,
    pub runtime: NativeRuntimeHost,
    pub usage: UsageService,
    shutdown: CancellationToken,
    lifecycle: ConnectionLifecycle,
}

#[derive(Clone)]
struct ConnectionLifecycle {
    inner: Arc<ConnectionLifecycleInner>,
}

struct ConnectionLifecycleInner {
    accepting: AtomicBool,
    active: AtomicUsize,
    drained: Notify,
}

pub(crate) struct ConnectionLease {
    lifecycle: ConnectionLifecycle,
}

impl AppState {
    pub async fn new(config: ServerConfig) -> Result<Self> {
        let events = EventBus::default();
        let auth =
            AuthService::new(config.home.clone(), events.clone(), config.label.clone()).await?;
        auth.set_broker_override(config.broker.clone(), config.broker_advertise.clone())
            .await;
        let workspace = Arc::new(WorkspaceService::new(config.home.clone(), events.clone()).await?);
        let browser = BrowserService::new(config.home.clone(), events.clone());
        let chat = ChatService::new(config.home.clone(), events.clone()).await?;
        let push = PushService::new(config.home.clone(), auth.clone(), events.clone()).await?;
        let direct = DirectService::new(
            config.stun.clone(),
            config.direct_ports,
            config.direct_host_addresses.clone(),
        );
        let devices = DevicesService::new(config.home.clone(), events.clone());
        let broker = BrokerService::new(auth.clone(), direct.clone());
        let sessions = SessionsService::new(config.home.clone(), events.clone()).await?;
        let offline_push = push.clone();
        sessions.install_offline_approvals(Arc::new(move || offline_push.has_offline_approvals()));
        if config.install_hooks {
            sessions.install_agent_hooks().await?;
        }
        let runtime = NativeRuntimeHost::new(sessions.clone(), chat.clone());
        workspace.install_runtime_host(runtime.shared());
        let sink = workspace.runtime_fact_sink();
        runtime.facts().install(Arc::downgrade(&sink));
        let fork_host: Arc<dyn ChatForkWorkspaceHost> = workspace.clone();
        chat.install_fork_host(Arc::downgrade(&fork_host));
        let context_host: Arc<dyn ChatContextHost> = workspace.clone();
        chat.install_context_host(Arc::downgrade(&context_host));
        let processes = ProcessesService::new(config.home.clone(), events.clone()).await?;
        processes
            .install_alert_sources(sessions.clone(), chat.clone())
            .await;
        sessions.install_process_nudge(processes.nudge_callback());
        chat.install_process_nudge(processes.nudge_callback());
        sessions.install_agent_gone(processes.agent_gone_callback());
        let providers = ProvidersService::new();
        let usage = UsageService::new(config.home.clone(), events.clone(), config.price_fetch);
        let usage_limits = usage.clone();
        chat.install_limits_sink(Arc::new(move |update| {
            usage_limits.apply_live_limits(update);
        }));
        let state = Self {
            config: Arc::new(config),
            events,
            auth,
            broker,
            browser,
            chat,
            devices,
            direct,
            workspace,
            sessions,
            processes,
            providers,
            push,
            runtime,
            usage,
            shutdown: CancellationToken::new(),
            lifecycle: ConnectionLifecycle::new(),
        };
        state.refresh_process_roots().await;
        state.broker.start(state.clone()).await;
        Ok(state)
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> RpcResult {
        let payload = schema::normalize_request(method, payload)?;
        let result = match request_domain(method) {
            RequestDomain::Auth => {
                let disable_streaming = method == "endpoint.setIdentity"
                    && payload.get("streamingAllowed").and_then(Value::as_bool) == Some(false);
                let result = self.auth.dispatch(method, payload, context).await;
                if method == "endpoint.setIdentity" && result.as_ref().is_some_and(Result::is_ok) {
                    self.broker.reconfigure();
                }
                if disable_streaming && result.as_ref().is_some_and(Result::is_ok) {
                    tokio::join!(self.browser.close_all(), self.devices.close_all());
                }
                if method == "auth.revoke" && result.as_ref().is_some_and(Result::is_ok) {
                    self.push.refresh_offline_approvals().await;
                }
                result
            }
            RequestDomain::Browser => {
                if method == "browser.open" && !self.auth.streaming_allowed().await {
                    Some(Err(RpcError::new(
                        "streaming-disabled",
                        "Browser and device streaming is disabled on this machine",
                    )))
                } else {
                    self.browser.dispatch(method, payload, context).await
                }
            }
            RequestDomain::Chat => {
                let result = self.chat.dispatch(method, payload, context).await;
                self.refresh_process_roots().await;
                result
            }
            RequestDomain::Devices => {
                self.devices
                    .dispatch(
                        method,
                        payload,
                        context,
                        self.auth.streaming_allowed().await,
                    )
                    .await
            }
            RequestDomain::Direct => {
                self.direct
                    .dispatch(method, payload, context, self.clone())
                    .await
            }
            RequestDomain::Workspace => self.workspace.dispatch(method, payload, context).await,
            RequestDomain::Sessions => {
                let result = self.sessions.dispatch(method, payload, context).await;
                self.refresh_process_roots().await;
                result
            }
            RequestDomain::Processes => self.processes.dispatch(method, payload, context).await,
            RequestDomain::Providers => self.providers.dispatch(method, payload).await,
            RequestDomain::Push => self.push.dispatch(method, payload, context).await,
            RequestDomain::Usage => {
                if method == "usage.summary"
                    && let Ok(projects) = self.workspace.known_projects().await
                {
                    self.usage.set_known_projects(projects).await;
                }
                self.usage.dispatch(method, payload, context).await
            }
            RequestDomain::Unknown => None,
        };
        result.unwrap_or_else(|| {
            Err(RpcError::new(
                "unknown-request",
                format!("Unknown request type: {method}"),
            ))
        })
    }

    pub async fn begin_shutdown(&self) {
        self.lifecycle.stop();
        self.shutdown.cancel();
        self.usage.begin_shutdown();
        self.browser.begin_shutdown();
        self.devices.begin_shutdown();
        self.broker.begin_shutdown().await;
        tokio::join!(
            self.sessions.begin_shutdown(),
            self.chat.begin_shutdown(),
            self.direct.begin_shutdown(),
        );
    }

    pub async fn finish_shutdown(&self) {
        self.lifecycle.wait_for_drain().await;
        self.usage.shutdown().await;
        self.push.shutdown().await;
        self.workspace.shutdown().await;
        self.browser.shutdown().await;
        self.devices.shutdown().await;
        self.chat.shutdown().await;
        self.sessions.shutdown().await;
        self.processes.shutdown().await;
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown().await;
        self.finish_shutdown().await;
    }

    pub(crate) fn enter_connection(&self) -> Option<ConnectionLease> {
        self.lifecycle.enter()
    }

    pub(crate) fn shutdown_token(&self) -> CancellationToken {
        self.shutdown.clone()
    }

    async fn process_roots(&self) -> Vec<crate::sessions::ProcessRoot> {
        let (mut sessions, chats) =
            tokio::join!(self.sessions.process_roots(), self.chat.process_roots());
        sessions.extend(chats);
        sessions
    }

    async fn refresh_process_roots(&self) {
        self.processes
            .set_session_roots(self.process_roots().await)
            .await;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestDomain {
    Auth,
    Browser,
    Chat,
    Devices,
    Direct,
    Workspace,
    Sessions,
    Processes,
    Providers,
    Push,
    Usage,
    Unknown,
}

fn request_domain(method: &str) -> RequestDomain {
    if method == "agent.children" {
        return RequestDomain::Workspace;
    }
    let namespace = method
        .split_once('.')
        .map_or(method, |(namespace, _)| namespace);
    match namespace {
        "auth" | "endpoint" | "server" => RequestDomain::Auth,
        "browser" => RequestDomain::Browser,
        "chat" => RequestDomain::Chat,
        "device" => RequestDomain::Devices,
        "direct" => RequestDomain::Direct,
        "bytes" | "diagram" | "drawing" | "fs" | "git" | "plan" | "project" | "task" => {
            RequestDomain::Workspace
        }
        "agent" | "session" => RequestDomain::Sessions,
        "processes" => RequestDomain::Processes,
        "provider" => RequestDomain::Providers,
        "push" => RequestDomain::Push,
        "usage" => RequestDomain::Usage,
        "skills" => RequestDomain::Chat,
        _ => RequestDomain::Unknown,
    }
}

impl ConnectionLifecycle {
    fn new() -> Self {
        Self {
            inner: Arc::new(ConnectionLifecycleInner {
                accepting: AtomicBool::new(true),
                active: AtomicUsize::new(0),
                drained: Notify::new(),
            }),
        }
    }

    fn enter(&self) -> Option<ConnectionLease> {
        if !self.inner.accepting.load(Ordering::Acquire) {
            return None;
        }
        self.inner.active.fetch_add(1, Ordering::AcqRel);
        if !self.inner.accepting.load(Ordering::Acquire) {
            self.release();
            return None;
        }
        Some(ConnectionLease {
            lifecycle: self.clone(),
        })
    }

    fn stop(&self) {
        self.inner.accepting.store(false, Ordering::Release);
        self.inner.drained.notify_waiters();
    }

    async fn wait_for_drain(&self) {
        loop {
            let notified = self.inner.drained.notified();
            if self.inner.active.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }

    fn release(&self) {
        if self.inner.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.inner.drained.notify_waiters();
        }
    }
}

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        self.lifecycle.release();
    }
}

pub async fn serve(config: ServerConfig) -> Result<()> {
    let listener = match TcpListener::bind((config.host, config.port)).await {
        Ok(listener) => listener,
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            anyhow::bail!(port_in_use_message(
                config.port,
                running_machine(config.port).await
            ));
        }
        Err(error) => return Err(error.into()),
    };
    let address = listener.local_addr()?;
    let state = AppState::new(config).await?;
    state
        .auth
        .set_advertised_address(state.config.host.to_string(), address.port())
        .await;
    let context_host = if state.config.host.is_unspecified() {
        "127.0.0.1".to_owned()
    } else {
        state.config.host.to_string()
    };
    state
        .chat
        .set_context_url(format!("http://{context_host}:{}/context", address.port()));
    state.sessions.set_agent_urls(
        format!("http://{context_host}:{}/hooks", address.port()),
        format!("http://{context_host}:{}/context", address.port()),
    );
    let router = Router::new()
        .route("/health", any(health))
        .route("/auth/pairing-token", any(pairing_token))
        .route("/auth/pair", any(pair))
        .route("/auth/challenge", any(challenge))
        .route("/auth/ticket", any(ticket))
        .route("/machine/work", any(machine_work))
        .route("/machine/link-request", any(machine_link_request))
        .route("/machine/registration", any(machine_registration))
        .route("/context", get(context_list))
        .route("/context/{source_id}", get(context_read))
        .route("/hooks/{kind}", any(agent_hook))
        .route("/canvas/{verb}", any(canvas_verb))
        .route(
            "/attachments/{chat_id}/{attachment_id}",
            any(chat_attachment),
        )
        .route("/fs/file", any(file_media))
        .route("/projects/{project_id}/icon", any(project_icon))
        .route("/live-stream/{stream_id}", any(live_stream))
        .route("/ws", get(websocket))
        .route("/", any(static_index))
        .route("/{*path}", any(static_file))
        .with_state(state.clone());

    let socket_address = format!("ws://{}:{}/ws", address.ip(), address.port());
    if state.config.interactive {
        println!(
            "This machine runs Ruimte {VERSION} on {socket_address} (home: {}). Ctrl+C stops it.",
            state.config.home.display()
        );
        let port_flag = if address.port() == 4210 {
            String::new()
        } else {
            format!(" --port {}", address.port())
        };
        println!(
            "Next: `ruimte login{port_flag}` puts it on your account, `ruimte pair{port_flag}` prints a pairing link, and `ruimte service install{port_flag}` keeps it running in the background."
        );
    } else {
        println!(
            "ruimte server {VERSION} listening on {socket_address} (home: {})",
            state.config.home.display()
        );
    }
    let updater = tokio::spawn(self_update_loop(state.clone()));
    let shutdown_state = state.clone();
    let shutdown_token = state.shutdown_token();
    let shutdown = async move {
        tokio::select! {
            _ = shutdown_signal() => {}
            _ = shutdown_token.cancelled() => {}
        }
        shutdown_state.begin_shutdown().await;
    };
    let result = axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await;
    state.begin_shutdown().await;
    state.finish_shutdown().await;
    updater.abort();
    let _ = updater.await;
    result?;
    Ok(())
}

async fn health(State(state): State<AppState>, method: Method) -> Response {
    if method != Method::GET {
        return method_not_allowed();
    }
    Json(json!({
        "ok": true,
        "version": VERSION,
        "build": state.config.build.clone(),
        "service": state.config.under_service,
    }))
    .into_response()
}

async fn pairing_token(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::POST {
        return method_not_allowed();
    }
    match authorize(&state, &headers, None, remote.ip()).await {
        Ok(access) if access.session_id.is_none() => {
            Json(json!({ "url": state.auth.pairing_url().await })).into_response()
        }
        _ => (StatusCode::FORBIDDEN, "Forbidden").into_response(),
    }
}

async fn pair(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    body: Option<Json<Value>>,
) -> Response {
    if method == Method::OPTIONS {
        return cors_response(StatusCode::NO_CONTENT, Body::empty());
    }
    if method != Method::POST {
        return cors_response(
            StatusCode::METHOD_NOT_ALLOWED,
            Body::from("Method not allowed"),
        );
    }
    let Some(Json(body)) = body else {
        return cors_response(StatusCode::BAD_REQUEST, Body::from("Bad pairing request"));
    };
    match state.auth.pair_http(body, reachability(remote.ip())).await {
        Ok(result) => cors_json(result),
        Err(error) => {
            error.log_internal();
            cors_response(
                StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                Body::from(error.message),
            )
        }
    }
}

async fn challenge(State(state): State<AppState>, method: Method) -> Response {
    if method == Method::OPTIONS {
        return cors_response(StatusCode::NO_CONTENT, Body::empty());
    }
    if method != Method::POST {
        return cors_response(
            StatusCode::METHOD_NOT_ALLOWED,
            Body::from("Method not allowed"),
        );
    }
    cors_json(state.auth.challenge().await)
}

async fn ticket(
    State(state): State<AppState>,
    method: Method,
    body: Option<Json<Value>>,
) -> Response {
    if method == Method::OPTIONS {
        return cors_response(StatusCode::NO_CONTENT, Body::empty());
    }
    if method != Method::POST {
        return cors_response(
            StatusCode::METHOD_NOT_ALLOWED,
            Body::from("Method not allowed"),
        );
    }
    let Some(Json(body)) = body else {
        return cors_response(StatusCode::BAD_REQUEST, Body::from("Bad ticket request"));
    };
    match state.auth.redeem_ticket(body).await {
        Ok(result) => cors_json(result),
        Err(error) => {
            error.log_internal();
            cors_response(
                StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                Body::from(error.message),
            )
        }
    }
}

async fn machine_work(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::GET {
        return method_not_allowed();
    }
    match authorize(&state, &headers, None, remote.ip()).await {
        Ok(access) if access.session_id.is_none() => {
            let (sessions, chats) =
                tokio::join!(state.sessions.work_facts(), state.chat.work_facts());
            let (terminals, agents) = state.processes.machine_work(&sessions, &chats).await;
            Json(json!({ "terminals": terminals, "agents": agents })).into_response()
        }
        _ => (StatusCode::FORBIDDEN, "Forbidden").into_response(),
    }
}

async fn machine_link_request(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::POST {
        return method_not_allowed();
    }
    match authorize(&state, &headers, None, remote.ip()).await {
        Ok(access) if access.session_id.is_none() => {
            Json(state.auth.sign_link_request().await).into_response()
        }
        _ => (StatusCode::FORBIDDEN, "Forbidden").into_response(),
    }
}

async fn machine_registration(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Response {
    if method != Method::POST {
        return method_not_allowed();
    }
    if !matches!(authorize(&state, &headers, None, remote.ip()).await, Ok(access) if access.session_id.is_none())
    {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let Some(account_id) = body
        .and_then(|Json(value)| {
            value
                .get("accountId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|value| !value.is_empty() && value.encode_utf16().count() <= 64)
    else {
        return (StatusCode::BAD_REQUEST, "Expected an account id").into_response();
    };
    match state.auth.sign_registration_http(&account_id).await {
        Ok(result) => Json(result).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Request failed").into_response(),
    }
}

async fn context_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(token) = bearer(&headers) else {
        return (StatusCode::UNAUTHORIZED, "Missing context bearer").into_response();
    };
    match state.workspace.runtime_authority(token).await {
        Ok(Some(authority)) => Json(json!({
            "sources": state.workspace.context_list(&authority).await
        }))
        .into_response(),
        Ok(None) => (StatusCode::UNAUTHORIZED, "Invalid context bearer").into_response(),
        Err(error) => rpc_http_error(error),
    }
}

async fn context_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(source_id): AxumPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(token) = bearer(&headers) else {
        return (StatusCode::UNAUTHORIZED, "Missing context bearer").into_response();
    };
    let authority = match state.workspace.runtime_authority(token).await {
        Ok(Some(authority)) => authority,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "Invalid context bearer").into_response(),
        Err(error) => return rpc_http_error(error),
    };
    let tail = match query.get("tail") {
        Some(value) => match value.parse::<usize>().ok().filter(|value| *value > 0) {
            Some(value) => Some(value),
            None => {
                return (StatusCode::BAD_REQUEST, "tail must be a positive integer")
                    .into_response();
            }
        },
        None => None,
    };
    match state
        .workspace
        .context_read(
            &authority,
            &source_id,
            tail,
            query.get("subagent").map(String::as_str),
        )
        .await
    {
        Ok(Some(text)) => {
            ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Unknown linked source").into_response(),
        Err(error) => rpc_http_error(error),
    }
}

async fn agent_hook(
    State(state): State<AppState>,
    AxumPath(kind): AxumPath<String>,
    request: Request,
) -> Response {
    if request.method() != Method::POST {
        return method_not_allowed();
    }
    if !matches!(kind.as_str(), "claude" | "codex") {
        return (StatusCode::NOT_FOUND, "Unknown hook kind").into_response();
    }
    let Some(token) = bearer(request.headers()).map(str::to_owned) else {
        return (StatusCode::UNAUTHORIZED, "Missing hook bearer").into_response();
    };
    if request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > 4 * 1024 * 1024)
    {
        return (StatusCode::PAYLOAD_TOO_LARGE, "Payload too large").into_response();
    }
    let body = match to_bytes(request.into_body(), 4 * 1024 * 1024).await {
        Ok(body) => match serde_json::from_slice::<Value>(&body) {
            Ok(body) => body,
            Err(_) => return (StatusCode::BAD_REQUEST, "Body is not JSON").into_response(),
        },
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "Payload too large").into_response(),
    };
    let result = state.sessions.apply_hook(&kind, &token, &body).await;
    match result {
        AgentHookResult::UnknownToken => {
            return (StatusCode::UNAUTHORIZED, "Invalid hook bearer").into_response();
        }
        AgentHookResult::Applied | AgentHookResult::Ignored => {}
    }
    if result == AgentHookResult::Applied {
        state.processes.nudge();
    }
    if result == AgentHookResult::Applied
        && body.get("hook_event_name").and_then(Value::as_str) == Some("PermissionRequest")
        && let Some(decision) = state.sessions.hold_approval(&token, &body).await
    {
        return Json(json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": decision,
            }
        }))
        .into_response();
    }
    if let Some(event @ ("SessionStart" | "UserPromptSubmit")) =
        body.get("hook_event_name").and_then(Value::as_str)
    {
        let authority = state
            .workspace
            .runtime_authority(&token)
            .await
            .ok()
            .flatten();
        let depth = authority
            .as_ref()
            .map(|authority| authority.lineage_depth)
            .unwrap_or(0);
        let sources = if let Some(authority) = authority.as_ref() {
            state.workspace.context_list(authority).await
        } else {
            Vec::new()
        };
        let turn = if let Some(authority) = authority.as_ref() {
            state
                .workspace
                .take_terminal_turn_context(&authority.identity.node_id)
                .await
                .unwrap_or_default()
        } else {
            Default::default()
        };
        let mut context = hook_context(event, depth, &sources)
            .into_iter()
            .collect::<Vec<_>>();
        context.extend(turn.change_note);
        context.extend(turn.notices);
        if !context.is_empty() {
            return Json(json!({
                "hookSpecificOutput": {
                    "hookEventName": event,
                    "additionalContext": context.join("\n\n"),
                }
            }))
            .into_response();
        }
    }
    StatusCode::NO_CONTENT.into_response()
}

fn hook_context(event: &str, depth: u32, sources: &[Value]) -> Option<String> {
    let mut parts = Vec::new();
    if event == "SessionStart" {
        parts.push(verbs_note(depth));
    }
    if !sources.is_empty() {
        let named = sources
            .iter()
            .take(5)
            .map(|source| {
                format!(
                    "\"{}\" ({})",
                    source
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    source
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                )
            })
            .collect::<Vec<_>>();
        let rest = sources.len().saturating_sub(named.len());
        let names = if rest == 0 {
            named.join(", ")
        } else {
            format!("{} and {rest} more", named.join(", "))
        };
        parts.push(format!(
            "Ruimte: linked context is available with ruimte-context (list, read <id>): {names}."
        ));
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

fn verbs_note(depth: u32) -> String {
    let mut parts = vec![
        "Ruimte: `ruimte-context` is a command you run in your shell, not a tool. It reads context linked to you and places nodes on the canvas.".to_owned(),
        "`ruimte-context help` lists the verbs and nouns, and `ruimte-context help <verb or noun>` details one.".to_owned(),
    ];
    if depth < 1 {
        parts.push("It also opens agents (`agent` for one, `team` for several in parallel), which is for work the person asked you to split or that truly runs in parallel: every agent is a node on their canvas until someone removes it, so answer yourself whatever you can.".to_owned());
    } else if depth < 2 {
        parts.push("It also opens a helper agent with `agent`, which is for work the person asked you to split: that agent is a node on their canvas until someone removes it, so answer yourself whatever you can.".to_owned());
    }
    if depth < 2 {
        parts.push("With `--task` a result comes back as your next message once it settles, so end your turn instead of polling.".to_owned());
    }
    parts.push("Ids in its output are for your commands; to the person, name things by their title, never by id.".to_owned());
    parts.join(" ")
}

async fn canvas_verb(
    State(state): State<AppState>,
    headers: HeaderMap,
    method: Method,
    AxumPath(verb): AxumPath<String>,
    body: Option<Json<Value>>,
) -> Response {
    if method != Method::POST {
        return method_not_allowed();
    }
    let Some(token) = bearer(&headers) else {
        return (StatusCode::UNAUTHORIZED, "Missing context bearer").into_response();
    };
    let authority = match state.workspace.runtime_authority(token).await {
        Ok(Some(authority)) => authority,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "Invalid context bearer").into_response(),
        Err(error) => return rpc_http_error(error),
    };
    let Some(argv) = body
        .and_then(|Json(value)| value.get("argv").and_then(Value::as_array).cloned())
        .and_then(|values| {
            values
                .into_iter()
                .map(|value| value.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()
        })
    else {
        return (StatusCode::BAD_REQUEST, "Expected {argv: string[]}").into_response();
    };
    match state.workspace.canvas_verb(&authority, &verb, &argv).await {
        Ok(lines) => {
            let text = if lines.is_empty() {
                String::new()
            } else {
                format!("{}\n", lines.join("\n"))
            };
            ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text).into_response()
        }
        Err(refusal) => {
            let mut text = format!(
                "refused\t{}\t{}\n",
                refusal.code,
                refusal.message.replace(['\t', '\r', '\n'], " ")
            );
            if !refusal.lines.is_empty() {
                text.push_str(&refusal.lines.join("\n"));
                text.push('\n');
            }
            (
                StatusCode::from_u16(refusal.status).unwrap_or(StatusCode::UNPROCESSABLE_ENTITY),
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                text,
            )
                .into_response()
        }
    }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|value| !value.is_empty())
}

fn rpc_http_error(error: RpcError) -> Response {
    let status = if error.code == "not-found" {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, error.message).into_response()
}

async fn file_media(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return method_not_allowed();
    }
    if let Err((status, reason)) = authorize(
        &state,
        &headers,
        query.get("token").map(String::as_str),
        remote.ip(),
    )
    .await
    {
        return (status, reason).into_response();
    }
    let Some(path) = query.get("path").filter(|path| !path.is_empty()) else {
        return (StatusCode::BAD_REQUEST, "No path").into_response();
    };
    match state.workspace.resolve_file_media(Path::new(path)).await {
        Ok(Some(asset)) => serve_asset(asset, method, &headers, true).await,
        _ => (StatusCode::NOT_FOUND, "Not a file this route serves").into_response(),
    }
}

async fn chat_attachment(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    AxumPath((chat_id, attachment_id)): AxumPath<(String, String)>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return method_not_allowed();
    }
    if let Err((status, reason)) = authorize(
        &state,
        &headers,
        query.get("token").map(String::as_str),
        remote.ip(),
    )
    .await
    {
        return (status, reason).into_response();
    }
    let attachment = match state
        .chat
        .resolve_attachment(&chat_id, &attachment_id)
        .await
    {
        Ok(Some(attachment)) => attachment,
        _ => return (StatusCode::NOT_FOUND, "No attachment").into_response(),
    };
    let disposition = if attachment.inline {
        "inline"
    } else {
        "attachment"
    };
    let mut response = serve_asset(attachment.asset, method, &headers, true).await;
    if let Ok(value) = HeaderValue::from_str(&attachment_disposition(disposition, &attachment.name))
    {
        response
            .headers_mut()
            .insert(header::CONTENT_DISPOSITION, value);
    }
    response
}

fn attachment_disposition(disposition: &str, name: &str) -> String {
    let basename = name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control() && *character != '"')
        .collect::<String>();
    let basename = if basename.is_empty() {
        "attachment".to_owned()
    } else {
        basename
    };
    let fallback = basename
        .chars()
        .map(|character| {
            if character.is_ascii() && !character.is_ascii_control() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let encoded = utf8_percent_encode(&basename, NON_ALPHANUMERIC);
    format!("{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

async fn project_icon(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    AxumPath(project_id): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return method_not_allowed();
    }
    if let Err((status, reason)) = authorize(
        &state,
        &headers,
        query.get("token").map(String::as_str),
        remote.ip(),
    )
    .await
    {
        return (status, reason).into_response();
    }
    let theme = (query.get("theme").map(String::as_str) == Some("dark")).then_some("dark");
    match state
        .workspace
        .resolve_project_icon(&project_id, Some(theme.unwrap_or("light")))
        .await
    {
        Ok(Some(asset)) => serve_asset(asset, method, &headers, false).await,
        _ => (StatusCode::NOT_FOUND, "No icon").into_response(),
    }
}

async fn live_stream(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    AxumPath(stream_id): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if method == Method::OPTIONS {
        if !origin_allowed(
            origin,
            headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok()),
            &state.config.allowed_origins,
        ) {
            return stream_cors(
                (StatusCode::FORBIDDEN, "Origin not allowed").into_response(),
                origin,
            );
        }
        let mut response = stream_cors(StatusCode::NO_CONTENT.into_response(), origin);
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("authorization"),
        );
        return response;
    }
    if method != Method::GET {
        return stream_cors(method_not_allowed(), origin);
    }
    let access = match authorize(
        &state,
        &headers,
        query.get("token").map(String::as_str),
        remote.ip(),
    )
    .await
    {
        Ok(access) => access,
        Err((status, reason)) => {
            return stream_cors((status, reason).into_response(), origin);
        }
    };
    if !state.auth.streaming_allowed().await {
        return stream_cors(
            (
                StatusCode::FORBIDDEN,
                "Browser and device streaming is disabled on this machine",
            )
                .into_response(),
            origin,
        );
    }
    let subscription = if state.browser.has_stream(&stream_id).await {
        state.browser.subscribe_stream(&stream_id).await
    } else if state.devices.has_stream(&stream_id).await {
        state.devices.subscribe_stream(&stream_id).await
    } else {
        return stream_cors(
            (StatusCode::NOT_FOUND, "Live stream not found").into_response(),
            origin,
        );
    };
    let subscription = match subscription {
        Ok(subscription) => subscription,
        Err(error) => {
            return stream_cors(
                (StatusCode::SERVICE_UNAVAILABLE, error.message).into_response(),
                origin,
            );
        }
    };
    let content_type = subscription.format().content_type();
    let magic = futures_util::stream::once(async {
        Ok::<_, std::convert::Infallible>(axum::body::Bytes::from_static(LIVE_STREAM_MAGIC))
    });
    let shutdown = state.shutdown.clone();
    let auth = state.auth.clone();
    let session_id = access.session_id;
    let revoked = auth.subscribe_revocations();
    let frames = futures_util::stream::unfold(
        (subscription, shutdown, auth, session_id, revoked),
        |(mut subscription, shutdown, auth, session_id, mut revoked)| async move {
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => return None,
                    result = revoked.recv() => {
                        if revocation_closes_connection(&auth, session_id.as_deref(), result).await {
                            return None;
                        }
                    }
                    frame = subscription.recv() => {
                        let frame = frame?;
                        return Some((
                            Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(
                                encode_live_frame(&frame),
                            )),
                            (subscription, shutdown, auth, session_id, revoked),
                        ));
                    }
                }
            }
        },
    );
    let mut response = Response::new(Body::from_stream(magic.chain(frames)));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    stream_cors(response, origin)
}

fn stream_cors(mut response: Response, origin: Option<&str>) -> Response {
    if let Some(origin) = origin.and_then(|origin| HeaderValue::from_str(origin).ok()) {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response
            .headers_mut()
            .insert(header::VARY, HeaderValue::from_static("origin"));
    }
    response
}

async fn serve_asset(
    asset: crate::workspace::ResolvedAsset,
    method: Method,
    request_headers: &HeaderMap,
    ranges: bool,
) -> Response {
    if request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        == Some(asset.etag.as_str())
    {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    let range = if ranges {
        match parse_byte_range(
            request_headers
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok()),
            asset.len,
        ) {
            Ok(range) => range,
            Err(()) => {
                let mut response =
                    (StatusCode::RANGE_NOT_SATISFIABLE, "Range not satisfiable").into_response();
                response
                    .headers_mut()
                    .insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
                if let Ok(value) = HeaderValue::from_str(&format!("bytes */{}", asset.len)) {
                    response.headers_mut().insert(header::CONTENT_RANGE, value);
                }
                return response;
            }
        }
    } else {
        None
    };
    let (status, start, end) = range
        .map(|(start, end)| (StatusCode::PARTIAL_CONTENT, start, end))
        .unwrap_or((StatusCode::OK, 0, asset.len.saturating_sub(1)));
    let length = if asset.len == 0 { 0 } else { end - start + 1 };
    let body = if method == Method::HEAD || length == 0 {
        Body::empty()
    } else {
        let Ok(mut file) = tokio::fs::File::open(&asset.path).await else {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        };
        if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        }
        Body::from_stream(ReaderStream::new(file.take(length)))
    };
    let mut response = Response::builder()
        .status(status)
        .body(body)
        .expect("valid asset response");
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&asset.mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(IMMUTABLE_CACHE),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if let Ok(value) = HeaderValue::from_str(&asset.etag) {
        headers.insert(header::ETAG, value);
    }
    if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, value);
    }
    if ranges {
        headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }
    if let Some((start, end)) = range
        && let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{}", asset.len))
    {
        headers.insert(header::CONTENT_RANGE, value);
    }
    if asset.mime == "image/svg+xml" {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(SVG_CSP),
        );
    }
    response
}

fn parse_byte_range(header: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = header.and_then(|value| value.trim().strip_prefix("bytes=")) else {
        return Ok(None);
    };
    let Some((from, to)) = value.split_once('-') else {
        return Ok(None);
    };
    if to.contains('-')
        || !from.bytes().all(|byte| byte.is_ascii_digit())
        || !to.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Ok(None);
    }
    if from.is_empty() {
        if to.is_empty() {
            return Err(());
        }
        let length = to.parse::<u64>().unwrap_or(u64::MAX);
        if length == 0 || size == 0 {
            return Err(());
        }
        return Ok(Some((size.saturating_sub(length), size - 1)));
    }
    let start = from.parse::<u64>().map_err(|_| ())?;
    let end = if to.is_empty() {
        size.saturating_sub(1)
    } else {
        let end = to.parse::<u64>().unwrap_or(u64::MAX);
        end.min(size.saturating_sub(1))
    };
    if start >= size || start > end {
        return Err(());
    }
    Ok(Some((start, end)))
}

async fn websocket(
    State(state): State<AppState>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let query = query_parameters(uri.query());
    let access = match authorize(
        &state,
        &headers,
        query.get("token").map(String::as_str),
        remote.ip(),
    )
    .await
    {
        Ok(access) => access,
        Err((status, reason)) => return (status, reason).into_response(),
    };
    let protocol_refused = query
        .get("protocol")
        .is_some_and(|value| value.parse::<u64>().ok() != Some(PROTOCOL_VERSION));
    upgrade.on_upgrade(move |socket| socket_connection(socket, state, access, protocol_refused))
}

async fn socket_connection(
    mut socket: WebSocket,
    state: AppState,
    access: ClientAccess,
    protocol_refused: bool,
) {
    if protocol_refused {
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: 4406,
                reason: format!("protocol {PROTOCOL_VERSION}").into(),
            })))
            .await;
        return;
    }
    let Some(_connection) = state.lifecycle.enter() else {
        let _ = timeout(
            CLOSE_GRACE,
            socket.send(Message::Close(Some(CloseFrame {
                code: 1001,
                reason: "Server shutting down".into(),
            }))),
        )
        .await;
        return;
    };
    let client_id = Uuid::new_v4().to_string();
    state.sessions.register_client(&client_id).await;
    state.push.connected(access.session_id.as_deref()).await;
    let events = state.events.subscribe(client_id.clone());
    let events_cancel = events.cancel.clone();
    let mut revoked = state.auth.subscribe_revocations();
    let (socket_sender, mut socket_receiver) = socket.split();
    let (controls, control_receiver) = mpsc::channel(4);
    let closer = SocketCloser::new();
    let writer = tokio::spawn(socket_writer(
        socket_sender,
        events,
        control_receiver,
        closer.clone(),
        state.sessions.clone(),
        state.events.clone(),
        client_id.clone(),
    ));
    let mut requests = JoinSet::new();
    loop {
        tokio::select! {
            _ = state.shutdown.cancelled() => {
                closer.close(CloseFrame { code: 1001, reason: "Server shutting down".into() });
                break;
            }
            _ = closer.cancel.cancelled() => break,
            _ = events_cancel.cancelled() => {
                closer.close(CloseFrame { code: 1013, reason: "Client fell behind".into() });
                break;
            }
            result = revoked.recv() => {
                if revocation_closes_connection(&state.auth, access.session_id.as_deref(), result).await {
                    closer.close(CloseFrame { code: 4001, reason: "Access revoked".into() });
                    break;
                }
            }
            completed = requests.join_next(), if !requests.is_empty() => {
                if completed.is_some_and(|result| result.is_err()) {
                    closer.close(CloseFrame { code: 1011, reason: "Request failed".into() });
                    break;
                }
            }
            message = socket_receiver.next() => {
                let Some(Ok(message)) = message else { break; };
                match message {
                    Message::Text(text) => {
                        if let Err(frame) = accept_frame(&state, &client_id, &access, text.as_bytes(), &mut requests) {
                            closer.close(frame);
                            break;
                        }
                    }
                    Message::Binary(bytes) => {
                        if let Err(frame) = accept_frame(&state, &client_id, &access, &bytes, &mut requests) {
                            closer.close(frame);
                            break;
                        }
                    }
                    Message::Close(_) => {
                        closer.close(CloseFrame { code: 1000, reason: "Connection closed".into() });
                        break;
                    }
                    Message::Ping(bytes) => {
                        if controls.try_send(bytes).is_err() {
                            closer.close(CloseFrame { code: 1013, reason: "Client fell behind".into() });
                            break;
                        }
                    }
                    Message::Pong(_) => {}
                }
            }
        }
    }
    closer.close(CloseFrame {
        code: 1000,
        reason: "Connection closed".into(),
    });
    let _ = writer.await;
    state.events.unsubscribe(&client_id);
    state.push.disconnected(access.session_id.as_deref()).await;
    finish_requests_and_detach(state, client_id, requests).await;
}

pub(crate) async fn revocation_closes_connection(
    auth: &AuthService,
    session_id: Option<&str>,
    result: Result<String, tokio::sync::broadcast::error::RecvError>,
) -> bool {
    match result {
        Ok(revoked) => session_id == Some(revoked.as_str()),
        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => match session_id {
            Some(session_id) => !auth.is_session_active(session_id).await,
            None => false,
        },
        Err(tokio::sync::broadcast::error::RecvError::Closed) => true,
    }
}

pub(crate) fn accept_frame(
    state: &AppState,
    client_id: &str,
    access: &ClientAccess,
    bytes: &[u8],
    requests: &mut JoinSet<()>,
) -> Result<(), CloseFrame> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(CloseFrame {
            code: 1009,
            reason: "Frame too large".into(),
        });
    }
    let parsed: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(_) => {
            return send_reply(
                state,
                client_id,
                &error_reply(Value::Null, "bad-request", "Frame is not valid JSON"),
            );
        }
    };
    let id = parsed
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let Some(method) = parsed
        .get("type")
        .and_then(Value::as_str)
        .filter(|method| !method.is_empty())
    else {
        return send_reply(
            state,
            client_id,
            &error_reply(
                id.map(Value::String).unwrap_or(Value::Null),
                "bad-request",
                "Invalid request frame",
            ),
        );
    };
    let Some(id) = id else {
        return send_reply(
            state,
            client_id,
            &error_reply(Value::Null, "bad-request", "Invalid request frame"),
        );
    };
    let Some(payload) = parsed.get("payload").cloned() else {
        return send_reply(
            state,
            client_id,
            &error_reply(Value::String(id), "bad-request", "Invalid request frame"),
        );
    };
    if requests.len() >= MAX_IN_FLIGHT_REQUESTS {
        return send_reply(
            state,
            client_id,
            &error_reply(Value::String(id), "busy", "Too many requests are in flight"),
        );
    }
    let context = RequestContext {
        client_id: client_id.to_owned(),
        access: access.clone(),
        events: state.events.clone(),
    };
    let state = state.clone();
    let reply_client_id = client_id.to_owned();
    let method = method.to_owned();
    let attach_session = (method == "session.attach")
        .then(|| {
            payload
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten()
        .filter(|session_id| {
            state
                .events
                .begin_terminal_attach(client_id, session_id.clone())
        });
    requests.spawn(async move {
        let response = match state.dispatch(&method, payload, &context).await {
            Ok(result) => json!({ "id": id, "ok": true, "result": result }),
            Err(error) => error_reply(Value::String(id), &error.code, &error.message),
        };
        let sent = state.events.send_frame(&reply_client_id, response);
        if let Some(session_id) = attach_session
            && state
                .events
                .complete_terminal_attach(&reply_client_id, &session_id)
            && sent
        {
            let _ = state.sessions.resync(&reply_client_id, &session_id).await;
        }
        if !sent {
            state.events.unsubscribe(&reply_client_id);
        }
    });
    Ok(())
}

fn send_reply(state: &AppState, client_id: &str, value: &Value) -> Result<(), CloseFrame> {
    state
        .events
        .send_frame(client_id, value.clone())
        .then_some(())
        .ok_or_else(|| CloseFrame {
            code: 1013,
            reason: "Client fell behind".into(),
        })
}

#[derive(Clone)]
struct SocketCloser {
    cancel: CancellationToken,
    frame: Arc<Mutex<Option<CloseFrame>>>,
}

impl SocketCloser {
    fn new() -> Self {
        Self {
            cancel: CancellationToken::new(),
            frame: Arc::new(Mutex::new(None)),
        }
    }

    fn close(&self, frame: CloseFrame) {
        let mut pending = self.frame.lock().expect("socket close lock poisoned");
        if pending.is_none() {
            *pending = Some(frame);
        }
        drop(pending);
        self.cancel.cancel();
    }

    fn frame(&self) -> CloseFrame {
        self.frame
            .lock()
            .expect("socket close lock poisoned")
            .clone()
            .unwrap_or(CloseFrame {
                code: 1000,
                reason: "Connection closed".into(),
            })
    }
}

async fn socket_writer(
    mut socket: futures_util::stream::SplitSink<WebSocket, Message>,
    mut frames: crate::events::EventSubscription,
    mut pongs: mpsc::Receiver<axum::body::Bytes>,
    closer: SocketCloser,
    sessions: SessionsService,
    events: EventBus,
    client_id: String,
) {
    let overflow = frames.cancel.clone();
    loop {
        tokio::select! {
            _ = closer.cancel.cancelled() => {
                break;
            }
            _ = overflow.cancelled() => {
                closer.close(CloseFrame { code: 1013, reason: "Client fell behind".into() });
                break;
            }
            pong = pongs.recv() => {
                let Some(bytes) = pong else { break; };
                if !send_message(&mut socket, Message::Pong(bytes), &closer, &overflow).await {
                    break;
                }
            }
            frame = frames.recv() => {
                let Some(frame) = frame else { break; };
                let message = Message::Text(frame.text().to_owned().into());
                if !send_message(&mut socket, message, &closer, &overflow).await { break; }
                drop(frame);
                if let Some(session_ids) = frames.begin_terminal_resync() {
                    for session_id in session_ids {
                        if closer.cancel.is_cancelled() || overflow.is_cancelled() {
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
    send_close(&mut socket, closer.frame()).await;
}

async fn send_message(
    socket: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: Message,
    closer: &SocketCloser,
    overflow: &CancellationToken,
) -> bool {
    let sent = tokio::select! {
        _ = closer.cancel.cancelled() => false,
        _ = overflow.cancelled() => false,
        result = timeout(WRITE_TIMEOUT, socket.send(message)) => matches!(result, Ok(Ok(()))),
    };
    if !sent && !closer.cancel.is_cancelled() {
        if overflow.is_cancelled() {
            closer.close(CloseFrame {
                code: 1013,
                reason: "Client fell behind".into(),
            });
        } else {
            closer.close(CloseFrame {
                code: 1001,
                reason: "Client stopped reading".into(),
            });
        }
    }
    sent
}

async fn send_close(
    socket: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    frame: CloseFrame,
) {
    let _ = timeout(CLOSE_GRACE, socket.send(Message::Close(Some(frame)))).await;
}

pub(crate) async fn finish_requests_and_detach(
    state: AppState,
    client_id: String,
    mut requests: JoinSet<()>,
) {
    while requests.join_next().await.is_some() {}
    state.browser.detach(&client_id).await;
    state.devices.detach(&client_id).await;
    state.chat.detach(&client_id).await;
    state.workspace.detach(&client_id).await;
    state.sessions.detach(&client_id).await;
    state.processes.detach(&client_id).await;
    state.usage.detach(&client_id).await;
}

fn error_reply(id: Value, code: &str, message: &str) -> Value {
    json!({ "id": id, "ok": false, "error": { "code": code, "message": message } })
}

async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    query_token: Option<&str>,
    remote: IpAddr,
) -> Result<ClientAccess, (StatusCode, &'static str)> {
    if !origin_allowed(
        headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok()),
        headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok()),
        &state.config.allowed_origins,
    ) {
        return Err((StatusCode::FORBIDDEN, "Origin not allowed"));
    }
    let header_token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim);
    let token = header_token
        .or(query_token)
        .filter(|value| !value.is_empty())
        .ok_or((StatusCode::UNAUTHORIZED, "Pair this client first"))?;
    state
        .auth
        .authenticate(token, reachability(remote).to_owned())
        .await
        .ok_or((StatusCode::UNAUTHORIZED, "Unknown token"))
}

fn origin_allowed(origin: Option<&str>, host: Option<&str>, extras: &[String]) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    let Ok(parsed) = Url::parse(origin) else {
        return false;
    };
    let origin_host = parsed.host_str().unwrap_or_default();
    if origin_host == "localhost"
        || origin_host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
    {
        return true;
    }
    let authority = parsed.port().map_or_else(
        || origin_host.to_owned(),
        |port| format!("{origin_host}:{port}"),
    );
    host == Some(authority.as_str())
        || extras
            .iter()
            .any(|allowed| allowed == origin || allowed == &authority)
}

pub(crate) fn reachability(address: IpAddr) -> &'static str {
    if address.is_loopback() {
        "loopback"
    } else if is_private(address) {
        "lan"
    } else {
        "public"
    }
}

fn is_private(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => address.is_private() || address.is_link_local(),
        IpAddr::V6(address) => address.is_unique_local() || address.is_unicast_link_local(),
    }
}

fn query_parameters(query: Option<&str>) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .into_owned()
        .collect()
}

async fn static_file(State(state): State<AppState>, AxumPath(path): AxumPath<String>) -> Response {
    serve_static(&state, &path).await
}

async fn static_index(State(state): State<AppState>) -> Response {
    serve_static(&state, "").await
}

async fn serve_static(state: &AppState, path: &str) -> Response {
    let Some(root) = state.config.serve.as_ref() else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    let relative = Path::new(path);
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    }
    let candidate = root.join(relative);
    let file = if candidate.is_file() {
        candidate
    } else {
        root.join("index.html")
    };
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&file).first_or_octet_stream();
            let content_type = if mime.type_() == mime_guess::mime::TEXT {
                format!("{mime}; charset=utf-8")
            } else {
                mime.to_string()
            };
            let mut response = Response::new(Body::from(bytes));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(&content_type)
                    .unwrap_or(HeaderValue::from_static("application/octet-stream")),
            );
            response.headers_mut().insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static(CLIENT_CSP),
            );
            response
        }
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut terminate = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn self_update_loop(state: AppState) {
    if !state.config.under_service || state.config.build.is_none() {
        return;
    }
    let Some(build_file) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("ruimte.build")))
    else {
        return;
    };
    let running = state.config.build.as_deref().unwrap_or_default();
    let mut delay = Duration::from_secs(60);
    let mut last = "current";
    loop {
        tokio::select! {
            _ = state.shutdown.cancelled() => return,
            _ = tokio::time::sleep(delay) => {}
        }
        let on_disk = tokio::fs::read_to_string(&build_file)
            .await
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let verdict = match on_disk.as_deref() {
            None => "unreadable",
            Some(value) if value == running => "current",
            Some(_) => {
                let (sessions, chats) =
                    tokio::join!(state.sessions.work_facts(), state.chat.work_facts());
                let (terminals, agents) = state.processes.machine_work(&sessions, &chats).await;
                if terminals == 0 && agents == 0 {
                    "update"
                } else {
                    "busy"
                }
            }
        };
        if verdict != last {
            match verdict {
                "unreadable" => {
                    println!("A build id beside the binary cannot be read; waiting before updating")
                }
                "busy" => println!(
                    "A newer build is on disk; updating once no terminal or agent is running"
                ),
                "update" => println!(
                    "A newer build is on disk and nothing is running; exiting so the service starts it"
                ),
                _ => {}
            }
        }
        last = verdict;
        if verdict == "update" {
            state.shutdown.cancel();
            return;
        }
        delay = if verdict == "busy" {
            Duration::from_secs(3)
        } else {
            Duration::from_secs(60)
        };
    }
}

async fn running_machine(port: u16) -> Option<(String, Option<bool>)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .ok()?;
    let body = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    if body.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let version = body.get("version")?.as_str()?.to_owned();
    let service = body.get("service").and_then(Value::as_bool);
    Some((version, service))
}

fn port_in_use_message(port: u16, running: Option<(String, Option<bool>)>) -> String {
    let Some((version, service)) = running else {
        return format!(
            "Port {port} is in use by another program. Stop that program, or start Ruimte on a free port with --port."
        );
    };
    let port_flag = if port == 4210 {
        String::new()
    } else {
        format!(" --port {port}")
    };
    let how = if service == Some(true) {
        ", as the background service"
    } else {
        ""
    };
    let check = if service == Some(true) {
        format!("`ruimte service status{port_flag}` checks on it, ")
    } else {
        String::new()
    };
    format!(
        "A Ruimte machine is already running on port {port} (version {version}{how}).\nThere is no need to start another: {check}`ruimte login{port_flag}` puts it on your account and `ruimte pair{port_flag}` prints a pairing link. To run a second one anyway, give it its own --port and RUIMTE_HOME."
    )
}

fn method_not_allowed() -> Response {
    (StatusCode::METHOD_NOT_ALLOWED, "Method not allowed").into_response()
}

fn cors_json(value: Value) -> Response {
    let response = Json(value).into_response();
    with_cors(response)
}

fn cors_response(status: StatusCode, body: Body) -> Response {
    with_cors(
        Response::builder()
            .status(status)
            .body(body)
            .expect("valid response"),
    )
}

fn with_cors(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_policy_allows_loopback_and_same_host() {
        assert!(origin_allowed(
            Some("http://localhost:5183"),
            Some("box:4221"),
            &[]
        ));
        assert!(origin_allowed(
            Some("https://box:4221"),
            Some("box:4221"),
            &[]
        ));
        assert!(!origin_allowed(
            Some("https://example.com"),
            Some("box:4221"),
            &[]
        ));
    }

    #[test]
    fn byte_ranges_match_media_request_semantics() {
        assert_eq!(parse_byte_range(Some("bytes=2-5"), 10), Ok(Some((2, 5))));
        assert_eq!(parse_byte_range(Some("bytes=8-"), 10), Ok(Some((8, 9))));
        assert_eq!(parse_byte_range(Some("bytes=-3"), 10), Ok(Some((7, 9))));
        assert_eq!(parse_byte_range(Some("bytes=20-"), 10), Err(()));
        assert_eq!(
            parse_byte_range(Some("bytes=999999999999999999999999-"), 10),
            Err(())
        );
        assert_eq!(
            parse_byte_range(Some("bytes=-999999999999999999999999"), 10),
            Ok(Some((0, 9)))
        );
        assert_eq!(parse_byte_range(Some("bytes=1-2,4-5"), 10), Ok(None));
        assert_eq!(parse_byte_range(Some("else"), 10), Ok(None));
    }

    #[test]
    fn attachment_names_use_safe_ascii_and_utf8_filenames() {
        let value = attachment_disposition("attachment", "../report \"界\".txt");
        assert!(value.starts_with("attachment; filename=\"report _.txt\";"));
        assert!(value.contains("filename*=UTF-8''report%20%E7%95%8C%2Etxt"));
        assert!(!value.contains("../"));
    }

    #[test]
    fn reachability_does_not_grant_access() {
        assert_eq!(reachability("127.0.0.1".parse().unwrap()), "loopback");
        assert_eq!(reachability("192.168.1.2".parse().unwrap()), "lan");
        assert_eq!(reachability("8.8.8.8".parse().unwrap()), "public");
    }

    #[test]
    fn hook_context_matches_depth_and_source_limits() {
        let sources = (0..7)
            .map(|index| json!({ "title": format!("Source {index}"), "kind": "text" }))
            .collect::<Vec<_>>();
        let start = hook_context("SessionStart", 1, &sources).unwrap();
        assert!(start.contains("helper agent with `agent`"));
        assert!(!start.contains("`team`"));
        assert!(start.contains("\"Source 4\" (text) and 2 more"));
        let prompt = hook_context("UserPromptSubmit", 0, &sources).unwrap();
        assert!(prompt.starts_with("Ruimte: linked context is available"));
        assert!(!prompt.contains("command you run in your shell"));
        assert_eq!(hook_context("UserPromptSubmit", 0, &[]), None);
    }

    #[test]
    fn port_conflict_message_explains_the_running_service() {
        assert_eq!(
            port_in_use_message(4210, None),
            "Port 4210 is in use by another program. Stop that program, or start Ruimte on a free port with --port."
        );
        let message = port_in_use_message(4221, Some(("1.2.3".into(), Some(true))));
        assert!(message.contains("version 1.2.3, as the background service"));
        assert!(message.contains("`ruimte service status --port 4221`"));
        assert!(message.contains("`ruimte login --port 4221`"));
    }

    #[test]
    fn every_contract_request_has_an_authoritative_domain() {
        let contracts: Value =
            serde_json::from_str(include_str!("../schema/contracts.json")).unwrap();
        for method in contracts["requests"].as_object().unwrap().keys() {
            assert_ne!(request_domain(method), RequestDomain::Unknown, "{method}");
        }
    }

    #[tokio::test]
    async fn lagged_revocations_recheck_the_current_auth_store() {
        let home = tempfile::tempdir().unwrap();
        let events = EventBus::default();
        let auth = AuthService::new(home.path().to_path_buf(), events.clone(), "test".into())
            .await
            .unwrap();
        let pairing = auth.issue_pairing_token();
        auth.pair_http(json!({ "token": pairing, "label": "browser" }), "loopback")
            .await
            .unwrap();
        let context = RequestContext {
            client_id: "local".into(),
            access: ClientAccess {
                session_id: None,
                reachability: "loopback".into(),
            },
            events,
        };
        let sessions = auth
            .dispatch("auth.sessions", json!({}), &context)
            .await
            .unwrap()
            .unwrap();
        let session_id = sessions["sessions"][0]["id"].as_str().unwrap();
        let lagged = Err(tokio::sync::broadcast::error::RecvError::Lagged(65));
        assert!(!revocation_closes_connection(&auth, Some(session_id), lagged).await);
        auth.dispatch("auth.revoke", json!({ "id": session_id }), &context)
            .await
            .unwrap()
            .unwrap();
        let lagged = Err(tokio::sync::broadcast::error::RecvError::Lagged(65));
        assert!(revocation_closes_connection(&auth, Some(session_id), lagged).await);
    }
}
