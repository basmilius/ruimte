use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
    },
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{Mutex, RwLock, Semaphore, mpsc, oneshot, watch},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;
use uuid::Uuid;

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
    streams::{LiveFormat, LiveFrame, LiveSubscription},
};

const CDP_TIMEOUT: Duration = Duration::from_secs(15);
const CDP_PENDING_LIMIT: usize = 128;
const FAVICON_EXPRESSION: &str = r#"
(async () => {
    const declared = [...document.querySelectorAll('link[rel~="icon"]')].at(-1)?.href;
    const href = declared && declared !== 'data:,' ? declared : new URL('/favicon.ico', location.href).href;
    const response = await fetch(href, { credentials: 'include' });
    if (!response.ok) return null;
    let type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if ((!type || type === 'application/octet-stream') && new URL(href).pathname.toLowerCase().endsWith('.ico')) type = 'image/x-icon';
    if (!/^image\/[a-z0-9.+-]+$/.test(type)) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 131072) return null;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return 'data:' + type + ';base64,' + btoa(binary);
})()
"#;

#[derive(Clone)]
pub struct BrowserService {
    inner: Arc<BrowserInner>,
}

struct BrowserInner {
    home: PathBuf,
    events: EventBus,
    process: Mutex<Option<BrowserProcess>>,
    pages: Mutex<HashMap<String, Arc<BrowserPage>>>,
    streams: Mutex<HashMap<String, Weak<BrowserPage>>>,
    shutting_down: AtomicBool,
}

struct BrowserProcess {
    child: Child,
    client: CdpClient,
}

struct BrowserPage {
    id: String,
    owner: String,
    stream_id: String,
    target_id: String,
    session_id: String,
    cdp: CdpClient,
    events: EventBus,
    state: RwLock<BrowserState>,
    operation: Mutex<()>,
    stream_started: AtomicBool,
    event_stream: AtomicBool,
    viewers: AtomicUsize,
    sequence: AtomicU32,
    frame_senders: Mutex<HashMap<String, watch::Sender<Option<LiveFrame>>>>,
    event_task: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone)]
struct BrowserState {
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    error: Option<String>,
    favicon: Option<String>,
    width: u32,
    height: u32,
    device_scale_factor: f64,
}

#[derive(Clone)]
struct CdpClient {
    commands: mpsc::Sender<CdpCommand>,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>>,
    permits: Arc<Semaphore>,
    closed: Arc<AtomicBool>,
}

struct CdpCommand {
    method: String,
    params: Value,
    session_id: Option<String>,
    reply: oneshot::Sender<Result<Value, RpcError>>,
}

impl BrowserService {
    pub fn new(home: PathBuf, events: EventBus) -> Self {
        Self {
            inner: Arc::new(BrowserInner {
                home,
                events,
                process: Mutex::new(None),
                pages: Mutex::new(HashMap::new()),
                streams: Mutex::new(HashMap::new()),
                shutting_down: AtomicBool::new(false),
            }),
        }
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        let result = match method {
            "browser.open" => self.open(payload, &context.client_id).await,
            "browser.navigate" => self.navigate(payload, &context.client_id).await,
            "browser.command" => self.command(payload, &context.client_id).await,
            "browser.resize" => self.resize(payload, &context.client_id).await,
            "browser.input" => self.input(payload, &context.client_id).await,
            "browser.detach" => self.detach_one(payload, &context.client_id).await,
            "browser.kill" => self.kill(payload, &context.client_id).await,
            _ => return None,
        };
        Some(result)
    }

    pub fn begin_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
    }

    pub async fn close_all(&self) {
        let pages = self
            .inner
            .pages
            .lock()
            .await
            .drain()
            .map(|(_, page)| page)
            .collect::<Vec<_>>();
        self.inner.streams.lock().await.clear();
        for page in pages {
            page.close().await;
        }
    }

    pub async fn subscribe_stream(&self, stream_id: &str) -> Result<LiveSubscription, RpcError> {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(RpcError::new("not-found", "Live stream not found"));
        }
        let page = self
            .inner
            .streams
            .lock()
            .await
            .get(stream_id)
            .and_then(Weak::upgrade)
            .ok_or_else(|| RpcError::new("not-found", "Live stream not found"))?;
        let id = Uuid::new_v4().to_string();
        let (sender, receiver) = watch::channel(None);
        page.frame_senders.lock().await.insert(id.clone(), sender);
        page.viewers.fetch_add(1, Ordering::AcqRel);
        page.reconcile_stream().await?;
        let weak_page = Arc::downgrade(&page);
        Ok(LiveSubscription::new(receiver, move || {
            tokio::spawn(async move {
                if let Some(page) = weak_page.upgrade() {
                    page.frame_senders.lock().await.remove(&id);
                    page.viewers.fetch_sub(1, Ordering::AcqRel);
                    let _ = page.reconcile_stream().await;
                }
            });
        }))
    }

    pub async fn has_stream(&self, stream_id: &str) -> bool {
        self.inner
            .streams
            .lock()
            .await
            .get(stream_id)
            .and_then(Weak::upgrade)
            .is_some()
    }

    pub async fn detach(&self, client_id: &str) {
        let pages = self
            .inner
            .pages
            .lock()
            .await
            .iter()
            .filter(|(_, page)| page.owner == client_id)
            .map(|(key, page)| (key.clone(), page.clone()))
            .collect::<Vec<_>>();
        for (key, page) in pages {
            self.destroy_page(&key, page).await;
        }
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown();
        self.close_all().await;
        if let Some(mut process) = self.inner.process.lock().await.take() {
            process.client.closed.store(true, Ordering::Release);
            let _ = process.child.start_kill();
            let _ = timeout(Duration::from_secs(2), process.child.wait()).await;
        }
    }

    async fn open(&self, payload: Value, client_id: &str) -> RpcResult {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(RpcError::new(
                "browser-unavailable",
                "Server is shutting down",
            ));
        }
        let browser_id = required_string(&payload, "browserId")?;
        let requested_url = payload
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let url = normalize_url(requested_url)?;
        let width = required_u32(&payload, "width")?;
        let height = required_u32(&payload, "height")?;
        let scale = payload
            .get("deviceScaleFactor")
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        let event_stream = payload.get("stream").and_then(Value::as_str) == Some("events");
        let key = page_key(client_id, browser_id);
        if let Some(page) = self.inner.pages.lock().await.get(&key).cloned() {
            page.event_stream.store(event_stream, Ordering::Release);
            page.resize(width, height, scale).await?;
            if page.state.read().await.url == "about:blank" && url != "about:blank" {
                page.navigate(&url).await;
            }
            page.reconcile_stream().await?;
            return Ok(page.info().await);
        }

        let cdp = self.client().await?;
        let created = cdp
            .command(None, "Target.createTarget", json!({ "url": "about:blank" }))
            .await?;
        let target_id = value_string(&created, "targetId")?;
        let attached = cdp
            .command(
                None,
                "Target.attachToTarget",
                json!({ "targetId": target_id, "flatten": true }),
            )
            .await?;
        let session_id = value_string(&attached, "sessionId")?;
        let event_receiver = cdp.register_session(&session_id).await;
        let page = Arc::new(BrowserPage {
            id: browser_id.to_owned(),
            owner: client_id.to_owned(),
            stream_id: format!("browser:{}", Uuid::new_v4()),
            target_id,
            session_id,
            cdp,
            events: self.inner.events.clone(),
            state: RwLock::new(BrowserState {
                url: "about:blank".to_owned(),
                title: String::new(),
                loading: false,
                can_go_back: false,
                can_go_forward: false,
                error: None,
                favicon: None,
                width,
                height,
                device_scale_factor: scale,
            }),
            operation: Mutex::new(()),
            stream_started: AtomicBool::new(false),
            event_stream: AtomicBool::new(event_stream),
            viewers: AtomicUsize::new(0),
            sequence: AtomicU32::new(0),
            frame_senders: Mutex::new(HashMap::new()),
            event_task: Mutex::new(None),
        });
        page.start_events(event_receiver).await;
        page.command("Page.enable", json!({})).await?;
        page.command("Runtime.enable", json!({})).await?;
        page.resize(width, height, scale).await?;
        self.inner
            .streams
            .lock()
            .await
            .insert(page.stream_id.clone(), Arc::downgrade(&page));
        self.inner.pages.lock().await.insert(key, page.clone());
        page.navigate(&url).await;
        page.reconcile_stream().await?;
        Ok(page.info().await)
    }

    async fn navigate(&self, payload: Value, client_id: &str) -> RpcResult {
        let page = self.page(&payload, client_id).await?;
        let url = normalize_url(
            payload
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?;
        page.navigate(&url).await;
        Ok(page.info().await)
    }

    async fn command(&self, payload: Value, client_id: &str) -> RpcResult {
        let page = self.page(&payload, client_id).await?;
        let command = required_string(&payload, "command")?;
        page.navigation_command(
            command,
            payload
                .get("ignoreCache")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .await?;
        Ok(page.info().await)
    }

    async fn resize(&self, payload: Value, client_id: &str) -> RpcResult {
        let page = self.page(&payload, client_id).await?;
        page.resize(
            required_u32(&payload, "width")?,
            required_u32(&payload, "height")?,
            payload
                .get("deviceScaleFactor")
                .and_then(Value::as_f64)
                .unwrap_or(1.0),
        )
        .await?;
        Ok(json!({}))
    }

    async fn input(&self, payload: Value, client_id: &str) -> RpcResult {
        let page = self.page(&payload, client_id).await?;
        let input = payload
            .get("input")
            .and_then(Value::as_object)
            .ok_or_else(|| RpcError::new("bad-request", "Invalid browser input"))?;
        match input.get("kind").and_then(Value::as_str) {
            Some("text") => {
                let text = input
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                page.command("Input.insertText", json!({ "text": text }))
                    .await?;
            }
            Some("wheel") => {
                page.command(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": "mouseWheel", "x": input["x"], "y": input["y"],
                        "deltaX": input["deltaX"], "deltaY": input["deltaY"],
                        "modifiers": input.get("modifiers").cloned().unwrap_or(json!(0)),
                    }),
                )
                .await?;
            }
            Some("pointer") => {
                let phase = input.get("phase").and_then(Value::as_str).unwrap_or("move");
                let event_type = match phase {
                    "down" => "mousePressed",
                    "up" => "mouseReleased",
                    _ => "mouseMoved",
                };
                page.command(
                    "Input.dispatchMouseEvent",
                    json!({
                        "type": event_type, "x": input["x"], "y": input["y"],
                        "button": input.get("button").cloned().unwrap_or(json!("none")),
                        "buttons": input.get("buttons").cloned().unwrap_or(json!(0)),
                        "clickCount": if phase == "move" { 0 } else { 1 },
                        "modifiers": input.get("modifiers").cloned().unwrap_or(json!(0)),
                    }),
                )
                .await?;
            }
            Some("key") => {
                let down = input.get("phase").and_then(Value::as_str) == Some("down");
                page.command(
                    "Input.dispatchKeyEvent",
                    json!({
                        "type": if down { "keyDown" } else { "keyUp" },
                        "key": input["key"], "code": input["code"],
                        "text": if down { input.get("text").cloned().unwrap_or(json!("")) } else { Value::Null },
                        "modifiers": input.get("modifiers").cloned().unwrap_or(json!(0)),
                    }),
                )
                .await?;
            }
            _ => return Err(RpcError::new("bad-request", "Invalid browser input")),
        }
        Ok(json!({}))
    }

    async fn detach_one(&self, payload: Value, client_id: &str) -> RpcResult {
        let page = self.page(&payload, client_id).await?;
        page.event_stream.store(false, Ordering::Release);
        page.reconcile_stream().await?;
        Ok(json!({}))
    }

    async fn kill(&self, payload: Value, client_id: &str) -> RpcResult {
        let browser_id = required_string(&payload, "browserId")?;
        let key = page_key(client_id, browser_id);
        let page = self.inner.pages.lock().await.remove(&key);
        if let Some(page) = page {
            self.destroy_page(&key, page).await;
        }
        Ok(json!({}))
    }

    async fn page(&self, payload: &Value, client_id: &str) -> Result<Arc<BrowserPage>, RpcError> {
        let browser_id = required_string(payload, "browserId")?;
        self.inner
            .pages
            .lock()
            .await
            .get(&page_key(client_id, browser_id))
            .cloned()
            .ok_or_else(|| RpcError::new("browser-not-found", "This browser page is not running"))
    }

    async fn destroy_page(&self, key: &str, page: Arc<BrowserPage>) {
        self.inner.pages.lock().await.remove(key);
        self.inner.streams.lock().await.remove(&page.stream_id);
        page.close().await;
    }

    async fn client(&self) -> Result<CdpClient, RpcError> {
        let mut process = self.inner.process.lock().await;
        if let Some(process) = process.as_ref()
            && !process.client.closed.load(Ordering::Acquire)
        {
            return Ok(process.client.clone());
        }
        let launched = launch_chromium(&self.inner.home).await?;
        let client = launched.client.clone();
        *process = Some(launched);
        Ok(client)
    }
}

impl BrowserPage {
    async fn start_events(self: &Arc<Self>, mut events: mpsc::UnboundedReceiver<Value>) {
        let page = Arc::downgrade(self);
        *self.event_task.lock().await = Some(tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                let Some(page) = page.upgrade() else { break };
                page.handle_event(event).await;
            }
        }));
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.cdp
            .command(Some(&self.session_id), method, params)
            .await
    }

    async fn navigate(&self, url: &str) {
        {
            let mut state = self.state.write().await;
            state.url = url.to_owned();
            state.loading = true;
            state.error = None;
            state.favicon = None;
        }
        self.broadcast().await;
        let _guard = self.operation.lock().await;
        match self.command("Page.navigate", json!({ "url": url })).await {
            Ok(result) if result.get("errorText").is_none() => {}
            Ok(result) => {
                let mut state = self.state.write().await;
                state.loading = false;
                state.error = result
                    .get("errorText")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                drop(state);
                self.broadcast().await;
            }
            Err(error) => {
                let mut state = self.state.write().await;
                state.loading = false;
                state.error = Some(error.message);
                drop(state);
                self.broadcast().await;
            }
        }
    }

    async fn navigation_command(&self, command: &str, ignore_cache: bool) -> Result<(), RpcError> {
        let _guard = self.operation.lock().await;
        match command {
            "reload" => {
                self.command("Page.reload", json!({ "ignoreCache": ignore_cache }))
                    .await?;
            }
            "stop" => {
                self.command("Page.stopLoading", json!({})).await?;
                self.state.write().await.loading = false;
            }
            "back" | "forward" => {
                let history = self.command("Page.getNavigationHistory", json!({})).await?;
                let index = history
                    .get("currentIndex")
                    .and_then(Value::as_i64)
                    .unwrap_or(0);
                let next = if command == "back" {
                    index - 1
                } else {
                    index + 1
                };
                if let Some(entry_id) = history
                    .get("entries")
                    .and_then(Value::as_array)
                    .and_then(|entries| entries.get(next.max(0) as usize))
                    .and_then(|entry| entry.get("id"))
                    .and_then(Value::as_i64)
                {
                    self.command(
                        "Page.navigateToHistoryEntry",
                        json!({ "entryId": entry_id }),
                    )
                    .await?;
                }
            }
            _ => return Err(RpcError::new("bad-request", "Unknown browser command")),
        }
        Ok(())
    }

    async fn resize(&self, width: u32, height: u32, scale: f64) -> Result<(), RpcError> {
        let _guard = self.operation.lock().await;
        self.command(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": width, "height": height, "deviceScaleFactor": scale, "mobile": false,
            }),
        )
        .await?;
        let mut state = self.state.write().await;
        state.width = width;
        state.height = height;
        state.device_scale_factor = scale;
        Ok(())
    }

    async fn reconcile_stream(&self) -> Result<(), RpcError> {
        let wanted =
            self.event_stream.load(Ordering::Acquire) || self.viewers.load(Ordering::Acquire) > 0;
        let started = self.stream_started.load(Ordering::Acquire);
        if wanted == started {
            return Ok(());
        }
        let _guard = self.operation.lock().await;
        if wanted {
            let state = self.state.read().await.clone();
            self.command("Page.enable", json!({})).await?;
            self.command(
                "Page.startScreencast",
                json!({
                    "format": "jpeg", "quality": 78,
                    "maxWidth": (state.width as f64 * state.device_scale_factor).round() as u32,
                    "maxHeight": (state.height as f64 * state.device_scale_factor).round() as u32,
                    "everyNthFrame": 1,
                }),
            )
            .await?;
            self.stream_started.store(true, Ordering::Release);
        } else {
            let _ = self.command("Page.stopScreencast", json!({})).await;
            self.stream_started.store(false, Ordering::Release);
        }
        Ok(())
    }

    async fn handle_event(&self, event: Value) {
        match event.get("method").and_then(Value::as_str) {
            Some("Page.screencastFrame") => {
                let params = &event["params"];
                if let Some(session_id) = params.get("sessionId").and_then(Value::as_u64) {
                    let _ = self
                        .command(
                            "Page.screencastFrameAck",
                            json!({ "sessionId": session_id }),
                        )
                        .await;
                }
                let Some(mut data) = params
                    .get("data")
                    .and_then(Value::as_str)
                    .and_then(|data| STANDARD.decode(data).ok())
                else {
                    return;
                };
                let state = self.state.read().await.clone();
                let high_density = state.device_scale_factor > 1.0;
                if high_density {
                    let Some(screenshot) = self
                        .command(
                            "Page.captureScreenshot",
                            json!({
                                "format": "jpeg", "quality": 78,
                                "fromSurface": true, "captureBeyondViewport": false,
                            }),
                        )
                        .await
                        .ok()
                        .and_then(|value| {
                            value
                                .get("data")
                                .and_then(Value::as_str)
                                .and_then(|encoded| STANDARD.decode(encoded).ok())
                        })
                    else {
                        return;
                    };
                    data = screenshot;
                }
                if data.len() > 8 * 1024 * 1024 {
                    return;
                }
                let width = if high_density {
                    (state.width as f64 * state.device_scale_factor).round()
                } else {
                    params
                        .pointer("/metadata/deviceWidth")
                        .and_then(Value::as_f64)
                        .unwrap_or(state.width as f64)
                        .round()
                }
                .clamp(1.0, u16::MAX as f64) as u16;
                let height = if high_density {
                    (state.height as f64 * state.device_scale_factor).round()
                } else {
                    params
                        .pointer("/metadata/deviceHeight")
                        .and_then(Value::as_f64)
                        .unwrap_or(state.height as f64)
                        .round()
                }
                .clamp(1.0, u16::MAX as f64) as u16;
                let sequence = self.sequence.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
                let frame = LiveFrame {
                    sequence,
                    width,
                    height,
                    data: Arc::new(data),
                    format: LiveFormat::Jpeg,
                };
                for sender in self.frame_senders.lock().await.values() {
                    sender.send_replace(Some(frame.clone()));
                }
                if self.event_stream.load(Ordering::Acquire) {
                    let _ = self.events.send_replaceable(
                        &self.owner,
                        "browser.frame",
                        format!("browser.frame:{}", self.id),
                        json!({
                            "browserId": self.id, "sequence": sequence,
                            "width": width, "height": height,
                            "data": STANDARD.encode(frame.data.as_ref()),
                        }),
                    );
                }
            }
            Some("Page.frameNavigated") => {
                if let Some(url) = event.pointer("/params/frame/url").and_then(Value::as_str) {
                    let mut state = self.state.write().await;
                    state.url = url.to_owned();
                    state.loading = false;
                    state.error = None;
                    drop(state);
                    self.refresh_page_state().await;
                }
            }
            Some("Page.loadEventFired") => self.refresh_page_state().await,
            _ => {}
        }
    }

    async fn refresh_page_state(&self) {
        let title = self
            .command(
                "Runtime.evaluate",
                json!({ "expression": "document.title", "returnByValue": true }),
            )
            .await
            .ok()
            .and_then(|value| {
                value
                    .pointer("/result/value")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_default();
        let history = self
            .command("Page.getNavigationHistory", json!({}))
            .await
            .ok();
        let favicon = self
            .command(
                "Runtime.evaluate",
                json!({
                    "expression": FAVICON_EXPRESSION,
                    "awaitPromise": true,
                    "returnByValue": true,
                }),
            )
            .await
            .ok()
            .and_then(|value| value.pointer("/result/value").cloned())
            .and_then(valid_favicon);
        let mut state = self.state.write().await;
        state.title = title;
        state.favicon = favicon;
        state.loading = false;
        if let Some(history) = history {
            let index = history
                .get("currentIndex")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let count = history
                .get("entries")
                .and_then(Value::as_array)
                .map_or(0, Vec::len) as i64;
            state.can_go_back = index > 0;
            state.can_go_forward = index + 1 < count;
        }
        drop(state);
        self.broadcast().await;
    }

    async fn info(&self) -> Value {
        let state = self.state.read().await;
        json!({
            "browserId": self.id, "url": state.url, "title": state.title,
            "loading": state.loading, "canGoBack": state.can_go_back,
            "canGoForward": state.can_go_forward, "error": state.error,
            "favicon": state.favicon, "streamId": self.stream_id,
        })
    }

    async fn broadcast(&self) {
        let _ = self
            .events
            .send(&self.owner, "browser.status", self.info().await);
    }

    async fn close(&self) {
        self.event_stream.store(false, Ordering::Release);
        self.frame_senders.lock().await.clear();
        let _ = self.command("Page.stopScreencast", json!({})).await;
        let _ = self
            .cdp
            .command(
                None,
                "Target.closeTarget",
                json!({ "targetId": self.target_id }),
            )
            .await;
        self.cdp.unregister_session(&self.session_id).await;
        if let Some(task) = self.event_task.lock().await.take() {
            task.abort();
        }
    }
}

impl CdpClient {
    async fn command(
        &self,
        session_id: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RpcError::new("browser-unavailable", "Chromium stopped"));
        }
        let permit = timeout(CDP_TIMEOUT, self.permits.clone().acquire_owned())
            .await
            .map_err(|_| RpcError::new("browser-busy", "Chromium is busy"))?
            .map_err(|_| RpcError::new("browser-unavailable", "Chromium stopped"))?;
        let (reply, received) = oneshot::channel();
        self.commands
            .send(CdpCommand {
                method: method.to_owned(),
                params,
                session_id: session_id.map(str::to_owned),
                reply,
            })
            .await
            .map_err(|_| RpcError::new("browser-unavailable", "Chromium stopped"))?;
        let result = timeout(CDP_TIMEOUT, received)
            .await
            .map_err(|_| {
                RpcError::new(
                    "browser-timeout",
                    format!("Chromium timed out during {method}"),
                )
            })?
            .map_err(|_| RpcError::new("browser-unavailable", "Chromium stopped"))?;
        drop(permit);
        result
    }

    async fn register_session(&self, session_id: &str) -> mpsc::UnboundedReceiver<Value> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.sessions
            .lock()
            .await
            .insert(session_id.to_owned(), sender);
        receiver
    }

    async fn unregister_session(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}

async fn launch_chromium(home: &Path) -> Result<BrowserProcess, RpcError> {
    let executable = chromium_executable().ok_or_else(|| {
        RpcError::new(
            "browser-unavailable",
            "Chromium, Chrome, Edge or Brave is not installed",
        )
    })?;
    let profile = home.join("browser");
    tokio::fs::create_dir_all(&profile)
        .await
        .map_err(|error| RpcError::new("browser-unavailable", error.to_string()))?;
    let mut child = Command::new(executable)
        .args([
            "--headless=new",
            "--remote-debugging-port=0",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-component-update",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| RpcError::new("browser-unavailable", error.to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| RpcError::new("browser-unavailable", "Chromium has no diagnostic stream"))?;
    let mut lines = BufReader::new(stderr).lines();
    let websocket = timeout(CDP_TIMEOUT, async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(url) = line
                .split_whitespace()
                .find(|part| part.starts_with("ws://"))
            {
                return Some(url.to_owned());
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
    .ok_or_else(|| {
        RpcError::new(
            "browser-unavailable",
            "Chromium did not expose its debugging socket",
        )
    })?;
    tokio::spawn(async move { while lines.next_line().await.ok().flatten().is_some() {} });
    let client = connect_cdp(&websocket).await?;
    Ok(BrowserProcess { child, client })
}

async fn connect_cdp(url: &str) -> Result<CdpClient, RpcError> {
    let (socket, _) = connect_async(url)
        .await
        .map_err(|error| RpcError::new("browser-unavailable", error.to_string()))?;
    let (mut writer, mut reader) = socket.split();
    let (commands, mut incoming) = mpsc::channel::<CdpCommand>(CDP_PENDING_LIMIT);
    let sessions = Arc::new(Mutex::new(
        HashMap::<String, mpsc::UnboundedSender<Value>>::new(),
    ));
    let routed_sessions = sessions.clone();
    let closed = Arc::new(AtomicBool::new(false));
    let actor_closed = closed.clone();
    tokio::spawn(async move {
        let mut sequence = 0_u64;
        let mut pending = HashMap::<u64, oneshot::Sender<Result<Value, RpcError>>>::new();
        loop {
            tokio::select! {
                command = incoming.recv() => {
                    let Some(command) = command else { break };
                    sequence = sequence.wrapping_add(1);
                    let mut frame = json!({ "id": sequence, "method": command.method, "params": command.params });
                    if let Some(session_id) = command.session_id {
                        frame["sessionId"] = Value::String(session_id);
                    }
                    if writer.send(Message::Text(frame.to_string().into())).await.is_err() {
                        let _ = command.reply.send(Err(RpcError::new("browser-unavailable", "Chromium stopped")));
                        break;
                    }
                    pending.insert(sequence, command.reply);
                }
                message = reader.next() => {
                    let Some(Ok(Message::Text(text))) = message else { break };
                    let Ok(frame) = serde_json::from_str::<Value>(&text) else { continue };
                    if let Some(id) = frame.get("id").and_then(Value::as_u64) {
                        if let Some(reply) = pending.remove(&id) {
                            let result = if let Some(error) = frame.get("error") {
                                Err(RpcError::new(
                                    "browser-failed",
                                    error.get("message").and_then(Value::as_str).unwrap_or("Chromium command failed"),
                                ))
                            } else {
                                Ok(frame.get("result").cloned().unwrap_or_else(|| json!({})))
                            };
                            let _ = reply.send(result);
                        }
                    } else if let Some(session_id) = frame.get("sessionId").and_then(Value::as_str)
                        && let Some(sender) = routed_sessions.lock().await.get(session_id).cloned()
                    {
                        let _ = sender.send(frame);
                    }
                }
            }
        }
        actor_closed.store(true, Ordering::Release);
        for (_, reply) in pending {
            let _ = reply.send(Err(RpcError::new(
                "browser-unavailable",
                "Chromium stopped",
            )));
        }
    });
    Ok(CdpClient {
        commands,
        sessions,
        permits: Arc::new(Semaphore::new(CDP_PENDING_LIMIT)),
        closed,
    })
}

fn chromium_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("RUIMTE_CHROME").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }
    let candidates = if cfg!(target_os = "macos") {
        vec![
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
    } else {
        vec![
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
        ]
    };
    candidates
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn normalize_url(input: &str) -> Result<String, RpcError> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed == "about:blank" {
        return Ok("about:blank".to_owned());
    }
    let local = trimmed.starts_with("localhost")
        || trimmed
            .split_once('/')
            .map_or(trimmed, |(host, _)| host)
            .parse::<std::net::IpAddr>()
            .is_ok();
    let candidate = if local {
        format!("http://{trimmed}")
    } else if Url::parse(trimmed).is_ok() {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate)
        .map_err(|_| RpcError::new("bad-address", "Enter a valid web address"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(RpcError::new(
            "bad-address",
            "Only HTTP and HTTPS pages can be opened",
        ));
    }
    Ok(candidate)
}

fn page_key(client_id: &str, browser_id: &str) -> String {
    format!("{client_id}\0{browser_id}")
}

fn required_string<'a>(payload: &'a Value, key: &str) -> Result<&'a str, RpcError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcError::new("bad-request", format!("Missing {key}")))
}

fn required_u32(payload: &Value, key: &str) -> Result<u32, RpcError> {
    payload
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| RpcError::new("bad-request", format!("Missing {key}")))
}

fn value_string(value: &Value, key: &str) -> Result<String, RpcError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| RpcError::new("browser-failed", format!("Chromium omitted {key}")))
}

fn valid_favicon(value: Value) -> Option<String> {
    let value = value.as_str()?;
    if value.len() > 180_000 || !value.starts_with("data:image/") {
        return None;
    }
    let (mime, data) = value.split_once(";base64,")?;
    if mime.len() <= "data:image/".len()
        || !mime["data:image/".len()..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
        || data.is_empty()
        || !data
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return None;
    }
    Some(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_default_to_https_but_never_allow_local_files() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
        assert_eq!(
            normalize_url("localhost:3000/demo").unwrap(),
            "http://localhost:3000/demo"
        );
        assert_eq!(normalize_url("  ").unwrap(), "about:blank");
        assert_eq!(
            normalize_url("file:///tmp/private").unwrap_err().code,
            "bad-address"
        );
    }

    #[test]
    fn favicons_cross_the_daemon_only_as_bounded_image_data() {
        assert_eq!(
            valid_favicon(json!("data:image/png;base64,AQID")),
            Some("data:image/png;base64,AQID".to_owned())
        );
        assert_eq!(valid_favicon(json!("http://localhost/favicon.png")), None);
        assert_eq!(valid_favicon(json!("data:text/html;base64,AQID")), None);
    }
}
