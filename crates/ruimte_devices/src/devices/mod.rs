mod backend;
#[cfg(any(target_os = "macos", test))]
mod command;
#[cfg(any(target_os = "macos", debug_assertions, test))]
mod helper;
mod model;

#[cfg(target_os = "macos")]
mod physical;
#[cfg(target_os = "macos")]
mod simulator;
#[cfg(debug_assertions)]
mod test_backend;

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::sync::{Mutex, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
    streams::{LiveFormat, LiveFrame, LiveSubscription, OrderedLiveSender},
};
use backend::{DeviceBackend, DeviceSource, system_backends};
use model::{
    DeviceAction, DeviceInfo, DeviceKind, DeviceState, InputPayload, OpenPayload, StreamKind,
    Target,
};

#[derive(Clone)]
pub struct DevicesService {
    inner: Arc<DevicesInner>,
}

struct DevicesInner {
    events: EventBus,
    backends: Vec<Arc<dyn DeviceBackend>>,
    sessions: Mutex<HashMap<String, Arc<DeviceSession>>>,
    streams: Mutex<HashMap<String, Weak<DeviceSession>>>,
    open_gate: Mutex<()>,
    admission_epoch: AtomicU64,
    shutting_down: AtomicBool,
    shutdown: CancellationToken,
}

struct DeviceSession {
    info: DeviceInfo,
    stream_id: String,
    source: Arc<dyn DeviceSource>,
    events: EventBus,
    clients: StdMutex<HashSet<String>>,
    event_clients: StdMutex<HashSet<String>>,
    viewers: StdMutex<HashMap<String, DeviceViewer>>,
    transition: Mutex<()>,
    started: AtomicBool,
    closed: AtomicBool,
    shutdown: CancellationToken,
    cancel: CancellationToken,
}

enum DeviceViewer {
    Latest(watch::Sender<Option<LiveFrame>>),
    Ordered(OrderedLiveSender),
}

impl DeviceViewer {
    fn send(&self, frame: LiveFrame) -> bool {
        match self {
            Self::Latest(sender) => {
                if sender.is_closed() {
                    return false;
                }
                sender.send_replace(Some(frame));
                !sender.is_closed()
            }
            Self::Ordered(sender) => sender.try_send(frame),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceError {
    pub code: String,
    pub message: String,
}

impl DeviceError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<DeviceError> for RpcError {
    fn from(error: DeviceError) -> Self {
        Self::new(error.code, error.message)
    }
}

impl DevicesService {
    pub fn new(home: PathBuf, events: EventBus) -> Self {
        Self::with_backends(events, system_backends(home))
    }

    fn with_backends(events: EventBus, backends: Vec<Arc<dyn DeviceBackend>>) -> Self {
        Self {
            inner: Arc::new(DevicesInner {
                events,
                backends,
                sessions: Mutex::new(HashMap::new()),
                streams: Mutex::new(HashMap::new()),
                open_gate: Mutex::new(()),
                admission_epoch: AtomicU64::new(0),
                shutting_down: AtomicBool::new(false),
                shutdown: CancellationToken::new(),
            }),
        }
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
        streaming_allowed: bool,
    ) -> Option<RpcResult> {
        let gated = matches!(
            method,
            "device.list"
                | "device.boot"
                | "device.shutdown"
                | "device.open"
                | "device.detail"
                | "device.action"
        );
        if gated && !streaming_allowed {
            return Some(Err(RpcError::new(
                "streaming-disabled",
                "Browser and device streaming is disabled on this machine",
            )));
        }
        let result = match method {
            "device.list" => self.list().await,
            "device.boot" => match parse(payload) {
                Ok(value) => self.boot(value).await,
                Err(error) => Err(error),
            },
            "device.shutdown" => match parse(payload) {
                Ok(value) => self.shutdown_device(value).await,
                Err(error) => Err(error),
            },
            "device.open" => match parse(payload) {
                Ok(value) => self.open(value, &context.client_id).await,
                Err(error) => Err(error),
            },
            "device.detach" => match parse(payload) {
                Ok(value) => self.detach_one(value, &context.client_id).await,
                Err(error) => Err(error),
            },
            "device.input" => match parse(payload) {
                Ok(value) => self.input(value, &context.client_id).await,
                Err(error) => Err(error),
            },
            "device.detail" => match parse(payload) {
                Ok(value) => self.detail(value).await,
                Err(error) => Err(error),
            },
            "device.action" => match parse(payload) {
                Ok(value) => self.action(value).await,
                Err(error) => Err(error),
            },
            _ => return None,
        };
        Some(result.map_err(Into::into))
    }

    pub fn begin_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
        self.inner.shutdown.cancel();
        let service = self.clone();
        tokio::spawn(async move {
            service.close_all().await;
        });
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown();
        self.close_all().await;
    }

    pub async fn close_all(&self) {
        self.inner.admission_epoch.fetch_add(1, Ordering::AcqRel);
        let sessions = self
            .inner
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>();
        self.inner.streams.lock().await.clear();
        for session in sessions {
            session.close().await;
        }
    }

    pub async fn detach(&self, client_id: &str) {
        let sessions = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for session in sessions {
            session.detach(client_id).await;
        }
    }

    pub async fn subscribe_stream(&self, stream_id: &str) -> Result<LiveSubscription, RpcError> {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(RpcError::new("not-found", "Live stream not found"));
        }
        let session = self
            .inner
            .streams
            .lock()
            .await
            .get(stream_id)
            .and_then(Weak::upgrade)
            .ok_or_else(|| RpcError::new("not-found", "Live stream not found"))?;
        session.subscribe().await.map_err(Into::into)
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

    async fn list(&self) -> Result<Value, DeviceError> {
        let mut tasks = Vec::new();
        for backend in &self.inner.backends {
            let backend = backend.clone();
            tasks.push(tokio::spawn(async move { backend.list().await }));
        }
        let mut devices = Vec::new();
        let mut failures = Vec::new();
        for task in tasks {
            match task.await {
                Ok(Ok(mut listed)) => devices.append(&mut listed),
                Ok(Err(error)) => failures.push(error),
                Err(error) => failures.push(DeviceError::new(
                    "device-discovery-failed",
                    error.to_string(),
                )),
            }
        }
        if devices.is_empty() && !failures.is_empty() && failures.len() == self.inner.backends.len()
        {
            return Err(failures.remove(0));
        }
        devices.sort_by_key(|device| {
            (
                device_sort_key(&device.name),
                device_sort_key(&device.runtime),
            )
        });
        Ok(json!({ "devices": devices }))
    }

    async fn boot(&self, target: Target) -> Result<Value, DeviceError> {
        let backend = self.backend(&target)?;
        Ok(serde_json::to_value(backend.boot(&target.device_id).await?)
            .expect("device info serializes"))
    }

    async fn shutdown_device(&self, target: Target) -> Result<Value, DeviceError> {
        let _gate = self.inner.open_gate.lock().await;
        let backend = self.backend(&target)?;
        let removed = self
            .inner
            .sessions
            .lock()
            .await
            .remove(&session_key(&target.backend_id, &target.device_id));
        if let Some(session) = removed {
            self.inner.streams.lock().await.remove(&session.stream_id);
            session.close().await;
        }
        Ok(
            serde_json::to_value(backend.shutdown(&target.device_id).await?)
                .expect("device info serializes"),
        )
    }

    async fn detail(&self, target: Target) -> Result<Value, DeviceError> {
        let settings = self.backend(&target)?.detail(&target.device_id).await?;
        Ok(
            json!({ "deviceId": target.device_id, "backendId": target.backend_id, "platform": target.platform, "settings": settings }),
        )
    }

    async fn action(&self, action: DeviceAction) -> Result<Value, DeviceError> {
        let target = action.target().clone();
        let settings = self.backend(&target)?.action(&action).await?;
        Ok(
            json!({ "deviceId": target.device_id, "backendId": target.backend_id, "platform": target.platform, "settings": settings }),
        )
    }

    async fn open(&self, payload: OpenPayload, client_id: &str) -> Result<Value, DeviceError> {
        let admission = self.inner.admission_epoch.load(Ordering::Acquire);
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return Err(DeviceError::new(
                "device-helper-unavailable",
                "Server is shutting down",
            ));
        }
        let _gate = self.inner.open_gate.lock().await;
        if self.inner.shutting_down.load(Ordering::Acquire)
            || admission != self.inner.admission_epoch.load(Ordering::Acquire)
        {
            return Err(DeviceError::new(
                "device-helper-unavailable",
                "Device streaming was closed",
            ));
        }
        let key = session_key(&payload.target.backend_id, &payload.target.device_id);
        let existing = self.inner.sessions.lock().await.get(&key).cloned();
        let session = if let Some(session) = existing {
            session
        } else {
            let backend = self.backend(&payload.target)?;
            let device = backend
                .list()
                .await?
                .into_iter()
                .find(|device| device.device_id == payload.target.device_id)
                .ok_or_else(|| {
                    DeviceError::new("device-not-found", "The device is no longer available")
                })?;
            if device.state != DeviceState::Booted {
                return Err(DeviceError::new(
                    "device-not-booted",
                    unavailable_device_message(device.kind),
                ));
            }
            if self.inner.shutting_down.load(Ordering::Acquire)
                || admission != self.inner.admission_epoch.load(Ordering::Acquire)
            {
                return Err(DeviceError::new(
                    "device-helper-unavailable",
                    "Device streaming was closed",
                ));
            }
            let source = backend.create_source(&device.device_id)?;
            let stream_id = format!("device:{}", Uuid::new_v4());
            let session = Arc::new(DeviceSession::new(
                device,
                stream_id.clone(),
                source,
                self.inner.events.clone(),
                self.inner.shutdown.clone(),
            ));
            let mut sessions = self.inner.sessions.lock().await;
            if self.inner.shutting_down.load(Ordering::Acquire)
                || admission != self.inner.admission_epoch.load(Ordering::Acquire)
            {
                return Err(DeviceError::new(
                    "device-helper-unavailable",
                    "Device streaming was closed",
                ));
            }
            sessions.insert(key.clone(), session.clone());
            drop(sessions);
            self.inner
                .streams
                .lock()
                .await
                .insert(stream_id, Arc::downgrade(&session));
            session
        };
        session
            .clients
            .lock()
            .expect("device client lock poisoned")
            .insert(client_id.to_owned());
        let stream_result = match payload.stream {
            StreamKind::Events => session.enable_events(client_id).await,
            StreamKind::Http => {
                session.disable_events(client_id).await;
                Ok(())
            }
        };
        if let Err(error) = stream_result {
            session
                .clients
                .lock()
                .expect("device client lock poisoned")
                .remove(client_id);
            if session.closed.load(Ordering::Acquire)
                || admission != self.inner.admission_epoch.load(Ordering::Acquire)
            {
                self.remove_session_if_same(&key, &session).await;
            }
            return Err(error);
        }
        if self.inner.shutting_down.load(Ordering::Acquire)
            || admission != self.inner.admission_epoch.load(Ordering::Acquire)
        {
            session.detach(client_id).await;
            self.remove_session_if_same(&key, &session).await;
            return Err(DeviceError::new(
                "device-helper-unavailable",
                "Device streaming was closed",
            ));
        }
        let mut value = serde_json::to_value(&session.info).expect("device info serializes");
        value
            .as_object_mut()
            .expect("device info is object")
            .insert("streamId".into(), Value::String(session.stream_id.clone()));
        Ok(value)
    }

    async fn remove_session_if_same(&self, key: &str, session: &Arc<DeviceSession>) {
        let removed = {
            let mut sessions = self.inner.sessions.lock().await;
            if sessions
                .get(key)
                .is_some_and(|current| Arc::ptr_eq(current, session))
            {
                sessions.remove(key)
            } else {
                None
            }
        };
        if let Some(removed) = removed {
            self.inner.streams.lock().await.remove(&removed.stream_id);
            removed.close().await;
        }
    }

    async fn detach_one(&self, target: Target, client_id: &str) -> Result<Value, DeviceError> {
        if let Some(session) = self
            .inner
            .sessions
            .lock()
            .await
            .get(&session_key(&target.backend_id, &target.device_id))
            .cloned()
        {
            session.detach(client_id).await;
        }
        Ok(json!({}))
    }

    async fn input(&self, payload: InputPayload, client_id: &str) -> Result<Value, DeviceError> {
        let session = self
            .inner
            .sessions
            .lock()
            .await
            .get(&session_key(
                &payload.target.backend_id,
                &payload.target.device_id,
            ))
            .cloned();
        let session = session
            .filter(|session| {
                session
                    .clients
                    .lock()
                    .expect("device client lock poisoned")
                    .contains(client_id)
            })
            .ok_or_else(|| {
                DeviceError::new("device-not-open", "Open the device before sending input")
            })?;
        session.source.input(payload.input).await?;
        Ok(json!({}))
    }

    fn backend(&self, target: &Target) -> Result<Arc<dyn DeviceBackend>, DeviceError> {
        self.inner
            .backends
            .iter()
            .find(|backend| {
                backend.id() == target.backend_id && backend.platform() == target.platform
            })
            .cloned()
            .ok_or_else(|| {
                DeviceError::new(
                    "platform-unavailable",
                    format!(
                        "{} simulators are not available on this machine",
                        target.platform.name()
                    ),
                )
            })
    }
}

impl DeviceSession {
    fn new(
        info: DeviceInfo,
        stream_id: String,
        source: Arc<dyn DeviceSource>,
        events: EventBus,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            info,
            stream_id,
            source,
            events,
            clients: StdMutex::new(HashSet::new()),
            event_clients: StdMutex::new(HashSet::new()),
            viewers: StdMutex::new(HashMap::new()),
            transition: Mutex::new(()),
            started: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            shutdown,
            cancel: CancellationToken::new(),
        }
    }

    async fn subscribe(self: &Arc<Self>) -> Result<LiveSubscription, DeviceError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(DeviceError::new(
                "device-not-open",
                "The device stream has closed",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let format = self.source.format();
        let weak = Arc::downgrade(self);
        let release_id = id.clone();
        let release = move || {
            if let Some(session) = weak.upgrade() {
                tokio::spawn(async move {
                    session.remove_viewer(&release_id).await;
                });
            }
        };
        let (viewer, subscription) = match format {
            LiveFormat::Jpeg => {
                let (sender, receiver) = watch::channel(None);
                (
                    DeviceViewer::Latest(sender),
                    LiveSubscription::with_format(receiver, format, release),
                )
            }
            LiveFormat::Hevc => {
                let (sender, subscription) =
                    LiveSubscription::ordered(format, 32, 16 * 1024 * 1024, release);
                (DeviceViewer::Ordered(sender), subscription)
            }
        };
        self.viewers
            .lock()
            .expect("device viewer lock poisoned")
            .insert(id.clone(), viewer);
        let mut pending = PendingSubscription::new(Arc::downgrade(self), id.clone(), false);
        if let Err(error) = self.ensure_started().await {
            self.viewers
                .lock()
                .expect("device viewer lock poisoned")
                .remove(&id);
            pending.disarm();
            return Err(error);
        }
        pending.disarm();
        Ok(subscription)
    }

    async fn enable_events(self: &Arc<Self>, client_id: &str) -> Result<(), DeviceError> {
        let inserted = self
            .event_clients
            .lock()
            .expect("device event lock poisoned")
            .insert(client_id.to_owned());
        if inserted {
            let mut pending =
                PendingSubscription::new(Arc::downgrade(self), client_id.to_owned(), true);
            if let Err(error) = self.ensure_started().await {
                self.event_clients
                    .lock()
                    .expect("device event lock poisoned")
                    .remove(client_id);
                pending.disarm();
                return Err(error);
            }
            pending.disarm();
        }
        Ok(())
    }

    async fn disable_events(&self, client_id: &str) {
        if self
            .event_clients
            .lock()
            .expect("device event lock poisoned")
            .remove(client_id)
        {
            self.stop_if_unused().await;
        }
    }

    async fn detach(&self, client_id: &str) {
        self.clients
            .lock()
            .expect("device client lock poisoned")
            .remove(client_id);
        self.disable_events(client_id).await;
    }

    async fn remove_viewer(&self, id: &str) {
        self.viewers
            .lock()
            .expect("device viewer lock poisoned")
            .remove(id);
        self.stop_if_unused().await;
    }

    async fn ensure_started(self: &Arc<Self>) -> Result<(), DeviceError> {
        let _transition = self.transition.lock().await;
        if self.started.load(Ordering::Acquire) {
            return Ok(());
        }
        if self.closed.load(Ordering::Acquire) {
            return Err(DeviceError::new(
                "device-not-open",
                "The device stream has closed",
            ));
        }
        let weak = Arc::downgrade(self);
        let start = self.source.start(Arc::new(move |frame| {
            if let Some(session) = weak.upgrade() {
                session.publish(frame);
            }
        }));
        tokio::select! {
            result = start => result?,
            _ = self.shutdown.cancelled() => {
                self.source.stop().await;
                return Err(DeviceError::new("device-helper-unavailable", "Server is shutting down"));
            }
            _ = self.cancel.cancelled() => {
                self.source.stop().await;
                return Err(DeviceError::new("device-helper-unavailable", "Device streaming was closed"));
            }
        }
        self.started.store(true, Ordering::Release);
        Ok(())
    }

    fn publish(&self, frame: LiveFrame) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        self.viewers
            .lock()
            .expect("device viewer lock poisoned")
            .retain(|_, viewer| viewer.send(frame.clone()));
        let mut payload = json!({
            "deviceId": self.info.device_id,
            "backendId": self.info.backend_id,
            "platform": self.info.platform,
            "sequence": frame.sequence,
            "width": frame.width,
            "height": frame.height,
            "data": STANDARD.encode(frame.data.as_slice()),
        });
        if frame.format == LiveFormat::Hevc {
            payload
                .as_object_mut()
                .expect("device frame is object")
                .insert("format".into(), Value::String("hevc".into()));
        }
        let key = format!("device:{}/{}", self.info.backend_id, self.info.device_id);
        for client_id in self
            .event_clients
            .lock()
            .expect("device event lock poisoned")
            .iter()
        {
            if frame.format == LiveFormat::Hevc {
                self.events.send(client_id, "device.frame", payload.clone());
            } else {
                self.events.send_replaceable(
                    client_id,
                    "device.frame",
                    key.clone(),
                    payload.clone(),
                );
            }
        }
    }

    async fn stop_if_unused(&self) {
        let _transition = self.transition.lock().await;
        let unused = self
            .viewers
            .lock()
            .expect("device viewer lock poisoned")
            .is_empty()
            && self
                .event_clients
                .lock()
                .expect("device event lock poisoned")
                .is_empty();
        if !unused {
            return;
        }
        self.started.store(false, Ordering::Release);
        self.source.stop().await;
    }

    async fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.cancel.cancel();
        self.clients
            .lock()
            .expect("device client lock poisoned")
            .clear();
        self.event_clients
            .lock()
            .expect("device event lock poisoned")
            .clear();
        self.viewers
            .lock()
            .expect("device viewer lock poisoned")
            .clear();
        let _transition = self.transition.lock().await;
        self.started.store(false, Ordering::Release);
        self.source.stop().await;
    }
}

struct PendingSubscription {
    session: Weak<DeviceSession>,
    id: String,
    event: bool,
    armed: bool,
}

impl PendingSubscription {
    fn new(session: Weak<DeviceSession>, id: String, event: bool) -> Self {
        Self {
            session,
            id,
            event,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingSubscription {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(session) = self.session.upgrade() else {
            return;
        };
        let id = self.id.clone();
        let event = self.event;
        tokio::spawn(async move {
            if event {
                session.disable_events(&id).await;
            } else {
                session.remove_viewer(&id).await;
            }
        });
    }
}

fn parse<T: DeserializeOwned>(payload: Value) -> Result<T, DeviceError> {
    serde_json::from_value(payload)
        .map_err(|error| DeviceError::new("invalid-payload", error.to_string()))
}

fn session_key(backend_id: &str, device_id: &str) -> String {
    format!("{backend_id}\0{device_id}")
}

fn unavailable_device_message(kind: DeviceKind) -> &'static str {
    match kind {
        DeviceKind::Simulator => "Start the simulator before opening it",
        DeviceKind::Physical => {
            "The physical device is unavailable; unlock it and reconnect it before opening it"
        }
    }
}

fn device_sort_key(value: &str) -> (Vec<u16>, Vec<u8>) {
    let primary = value
        .bytes()
        .map(|byte| match byte {
            b'_' => 1,
            b'-' => 2,
            b':' => 3,
            byte => u16::from(byte.to_ascii_lowercase()) + 4,
        })
        .collect();
    let case = value
        .bytes()
        .map(|byte| u8::from(byte.is_ascii_uppercase()))
        .collect();
    (primary, case)
}

#[cfg(test)]
mod tests {
    use super::{DeviceKind, device_sort_key, unavailable_device_message};

    #[test]
    fn device_names_use_client_compatible_ascii_collation() {
        let mut names = ["RuimtePhone", "iPhone", "alpha", "Alpha", "a-b", "a_b"];
        names.sort_by_key(|name| device_sort_key(name));
        assert_eq!(
            names,
            ["a_b", "a-b", "alpha", "Alpha", "iPhone", "RuimtePhone"]
        );
    }

    #[test]
    fn unavailable_physical_device_message_explains_how_to_reconnect() {
        assert_eq!(
            unavailable_device_message(DeviceKind::Physical),
            "The physical device is unavailable; unlock it and reconnect it before opening it"
        );
        assert_eq!(
            unavailable_device_message(DeviceKind::Simulator),
            "Start the simulator before opening it"
        );
    }
}
