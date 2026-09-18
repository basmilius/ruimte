use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use serde_json::{Value, json};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct EventBus {
    inner: Arc<Mutex<HashMap<String, ClientSink>>>,
    capacity: usize,
    byte_capacity: usize,
}

#[derive(Clone)]
struct ClientSink {
    queue: Arc<ClientQueue>,
    cancel: CancellationToken,
}

struct ClientQueue {
    frames: Mutex<VecDeque<QueuedFrame>>,
    terminal: Mutex<TerminalFlow>,
    queued_bytes: Arc<AtomicUsize>,
    notify: Notify,
    capacity: usize,
    byte_capacity: usize,
}

#[derive(Default)]
struct TerminalFlow {
    paused: bool,
    resyncing: bool,
    stale: HashSet<String>,
    attaching: HashSet<String>,
}

pub struct EventSubscription {
    queue: Arc<ClientQueue>,
    pub cancel: CancellationToken,
}

pub struct QueuedFrame {
    text: String,
    bytes: usize,
    replaceable_key: Option<String>,
    queued_bytes: Arc<AtomicUsize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalSend {
    Queued,
    Stale,
    Disconnected,
}

impl Drop for QueuedFrame {
    fn drop(&mut self) {
        self.queued_bytes.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

impl EventSubscription {
    pub async fn recv(&mut self) -> Option<QueuedFrame> {
        loop {
            if let Some(frame) = self
                .queue
                .frames
                .lock()
                .expect("event queue lock poisoned")
                .pop_front()
            {
                return Some(frame);
            }
            self.queue.notify.notified().await;
        }
    }

    pub async fn recv_value(&mut self) -> Option<Value> {
        let frame = self.recv().await?;
        serde_json::from_str(frame.text()).ok()
    }
    pub fn begin_terminal_resync(&self) -> Option<Vec<String>> {
        self.queue.begin_terminal_resync()
    }

    pub fn end_terminal_resync(&self) {
        self.queue.end_terminal_resync();
    }
}

impl QueuedFrame {
    pub fn text(&self) -> &str {
        &self.text
    }
}

impl ClientQueue {
    fn enqueue(&self, frame: Value, replaceable_key: Option<String>) -> bool {
        let text = match serde_json::to_string(&frame) {
            Ok(text) => text,
            Err(_) => return false,
        };
        let bytes = text.len();
        let mut frames = self.frames.lock().expect("event queue lock poisoned");
        if let Some(key) = replaceable_key.as_deref() {
            frames.retain(|queued| queued.replaceable_key.as_deref() != Some(key));
        }
        if frames.len() >= self.capacity
            || !reserve_bytes(&self.queued_bytes, bytes, self.byte_capacity)
        {
            return false;
        }
        frames.push_back(QueuedFrame {
            text,
            bytes,
            replaceable_key,
            queued_bytes: self.queued_bytes.clone(),
        });
        drop(frames);
        self.notify.notify_one();
        true
    }

    fn at_high_water(&self) -> bool {
        let frames = self.frames.lock().expect("event queue lock poisoned");
        frames.len() >= self.capacity * 3 / 4
            || self.queued_bytes.load(Ordering::Acquire) >= self.byte_capacity * 3 / 4
    }

    fn send_terminal(&self, session_id: String, frame: Value) -> TerminalSend {
        let mut terminal = self.terminal.lock().expect("terminal flow lock poisoned");
        if terminal.paused
            || terminal.stale.contains(&session_id)
            || terminal.attaching.contains(&session_id)
        {
            terminal.stale.insert(session_id);
            return TerminalSend::Stale;
        }
        if self.at_high_water() {
            terminal.paused = true;
            terminal.stale.insert(session_id);
            return TerminalSend::Stale;
        }
        if !self.enqueue(frame, None) {
            return TerminalSend::Disconnected;
        }
        if self.at_high_water() {
            terminal.paused = true;
        }
        TerminalSend::Queued
    }

    fn begin_terminal_resync(&self) -> Option<Vec<String>> {
        let mut terminal = self.terminal.lock().expect("terminal flow lock poisoned");
        let below_low_water = {
            let frames = self.frames.lock().expect("event queue lock poisoned");
            frames.len() <= self.capacity / 4
                && self.queued_bytes.load(Ordering::Acquire) <= self.byte_capacity / 4
        };
        if !terminal.paused || terminal.resyncing || !below_low_water {
            return None;
        }
        terminal.paused = false;
        terminal.resyncing = true;
        Some(terminal.stale.iter().cloned().collect())
    }

    fn complete_terminal_resync(&self, session_id: &str, frame: Value) -> bool {
        let mut terminal = self.terminal.lock().expect("terminal flow lock poisoned");
        if !terminal.stale.contains(session_id) {
            return true;
        }
        if !self.enqueue(frame, None) {
            terminal.paused = true;
            return false;
        }
        terminal.stale.remove(session_id);
        true
    }

    fn drop_terminal_stale(&self, session_id: &str) {
        self.terminal
            .lock()
            .expect("terminal flow lock poisoned")
            .stale
            .remove(session_id);
    }

    fn end_terminal_resync(&self) {
        self.terminal
            .lock()
            .expect("terminal flow lock poisoned")
            .resyncing = false;
    }

    fn begin_terminal_attach(&self, session_id: String) {
        self.terminal
            .lock()
            .expect("terminal flow lock poisoned")
            .attaching
            .insert(session_id);
    }

    fn complete_terminal_attach(&self, session_id: &str) -> bool {
        let mut terminal = self.terminal.lock().expect("terminal flow lock poisoned");
        terminal.attaching.remove(session_id);
        terminal.stale.contains(session_id)
    }
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        Self::with_limits(capacity, 8 * 1024 * 1024)
    }

    pub fn with_limits(capacity: usize, byte_capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            capacity: capacity.max(1),
            byte_capacity: byte_capacity.max(1),
        }
    }

    pub fn subscribe(&self, client_id: impl Into<String>) -> EventSubscription {
        let client_id = client_id.into();
        let cancel = CancellationToken::new();
        let queue = Arc::new(ClientQueue {
            frames: Mutex::new(VecDeque::new()),
            terminal: Mutex::new(TerminalFlow::default()),
            queued_bytes: Arc::new(AtomicUsize::new(0)),
            notify: Notify::new(),
            capacity: self.capacity,
            byte_capacity: self.byte_capacity,
        });
        self.inner.lock().expect("event bus lock poisoned").insert(
            client_id,
            ClientSink {
                queue: queue.clone(),
                cancel: cancel.clone(),
            },
        );
        EventSubscription { queue, cancel }
    }

    pub fn unsubscribe(&self, client_id: &str) {
        self.inner
            .lock()
            .expect("event bus lock poisoned")
            .remove(client_id);
    }

    pub fn send(&self, client_id: &str, event: &str, payload: Value) -> bool {
        self.send_frame(
            client_id,
            json!({ "type": "event", "event": event, "payload": payload }),
        )
    }

    pub fn send_frame(&self, client_id: &str, frame: Value) -> bool {
        self.with_sink(client_id, |sink| sink.queue.enqueue(frame, None))
    }

    pub fn send_replaceable(
        &self,
        client_id: &str,
        event: &str,
        key: String,
        payload: Value,
    ) -> bool {
        let sink = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned();
        sink.is_some_and(|sink| {
            sink.queue.enqueue(
                json!({ "type": "event", "event": event, "payload": payload }),
                Some(key),
            )
        })
    }

    pub fn send_terminal(&self, client_id: &str, output_payload: Value) -> TerminalSend {
        let session_id = output_payload
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let sink = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned();
        let Some(sink) = sink else {
            return TerminalSend::Disconnected;
        };
        let result = sink.queue.send_terminal(
            session_id,
            json!({ "type": "event", "event": "session.output", "payload": output_payload }),
        );
        if result == TerminalSend::Disconnected {
            self.disconnect(client_id, &sink);
        }
        result
    }

    pub fn begin_terminal_attach(&self, client_id: &str, session_id: String) -> bool {
        let sink = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned();
        if let Some(sink) = sink {
            sink.queue.begin_terminal_attach(session_id);
            true
        } else {
            false
        }
    }

    pub fn complete_terminal_attach(&self, client_id: &str, session_id: &str) -> bool {
        self.inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned()
            .is_some_and(|sink| sink.queue.complete_terminal_attach(session_id))
    }

    pub fn complete_terminal_resync(
        &self,
        client_id: &str,
        session_id: &str,
        screen: String,
    ) -> bool {
        let sink = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned();
        let Some(sink) = sink else {
            return false;
        };
        sink.queue.complete_terminal_resync(
            session_id,
            json!({
                "type": "event",
                "event": "session.resync",
                "payload": { "sessionId": session_id, "screen": screen },
            }),
        )
    }

    pub fn drop_terminal_stale(&self, client_id: &str, session_id: &str) {
        if let Some(sink) = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned()
        {
            sink.queue.drop_terminal_stale(session_id);
        }
    }

    pub fn broadcast(&self, event: &str, payload: Value) {
        let client_ids = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for client_id in client_ids {
            let _ = self.send(&client_id, event, payload.clone());
        }
    }

    fn with_sink(&self, client_id: &str, enqueue: impl FnOnce(&ClientSink) -> bool) -> bool {
        let sink = self
            .inner
            .lock()
            .expect("event bus lock poisoned")
            .get(client_id)
            .cloned();
        let Some(sink) = sink else {
            return false;
        };
        if enqueue(&sink) {
            return true;
        }
        self.disconnect(client_id, &sink);
        false
    }

    fn disconnect(&self, client_id: &str, sink: &ClientSink) {
        self.unsubscribe(client_id);
        sink.cancel.cancel();
    }
}

fn reserve_bytes(queued: &AtomicUsize, bytes: usize, capacity: usize) -> bool {
    let mut current = queued.load(Ordering::Acquire);
    loop {
        let Some(next) = current.checked_add(bytes).filter(|next| *next <= capacity) else {
            return false;
        };
        match queued.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return true,
            Err(changed) => current = changed,
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(256)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn byte_budget_is_held_until_the_writer_drops_the_frame() {
        let bus = EventBus::with_limits(4, 100);
        let mut subscription = bus.subscribe("client");
        assert!(bus.send_frame(
            "client",
            json!({ "value": "123456789012345678901234567890" })
        ));
        let frame = subscription.recv().await.unwrap();
        assert!(!bus.send_frame(
            "client",
            json!({ "value": "123456789012345678901234567890123456789012345678901234567890" })
        ));
        assert!(subscription.cancel.is_cancelled());
        drop(frame);
    }

    #[tokio::test]
    async fn terminal_high_water_marks_the_session_until_the_queue_drains() {
        let bus = EventBus::with_limits(4, 4096);
        let mut subscription = bus.subscribe("client");
        for data in ["one", "two", "three"] {
            assert_eq!(
                bus.send_terminal("client", json!({ "sessionId": "terminal", "data": data })),
                TerminalSend::Queued
            );
        }
        assert_eq!(
            bus.send_terminal("client", json!({ "sessionId": "terminal", "data": "four" })),
            TerminalSend::Stale
        );
        for _ in 0..3 {
            drop(subscription.recv().await.unwrap());
        }
        assert_eq!(
            subscription.begin_terminal_resync(),
            Some(vec!["terminal".to_owned()])
        );
        assert!(bus.complete_terminal_resync("client", "terminal", "snapshot".to_owned()));
        subscription.end_terminal_resync();
        let resync = subscription.recv().await.unwrap();
        assert!(resync.text().contains("session.resync"));
        drop(resync);
        assert_eq!(
            bus.send_terminal("client", json!({ "sessionId": "terminal", "data": "five" })),
            TerminalSend::Queued
        );
    }

    #[tokio::test]
    async fn stalled_terminal_output_recovers_once_with_the_latest_screen() {
        let bus = EventBus::with_limits(8, 4096);
        let mut subscription = bus.subscribe("client");
        for sequence in 0..6 {
            assert_eq!(
                bus.send_terminal(
                    "client",
                    json!({ "sessionId": "terminal", "data": sequence }),
                ),
                TerminalSend::Queued
            );
        }
        for sequence in 6..1000 {
            assert_eq!(
                bus.send_terminal(
                    "client",
                    json!({ "sessionId": "terminal", "data": sequence }),
                ),
                TerminalSend::Stale
            );
        }
        for _ in 0..4 {
            drop(subscription.recv().await.unwrap());
        }
        assert_eq!(
            subscription.begin_terminal_resync(),
            Some(vec!["terminal".to_owned()])
        );
        assert!(bus.complete_terminal_resync("client", "terminal", "latest".to_owned()));
        subscription.end_terminal_resync();
        assert_eq!(
            bus.send_terminal(
                "client",
                json!({ "sessionId": "terminal", "data": "after" }),
            ),
            TerminalSend::Queued
        );

        let mut frames = Vec::new();
        for _ in 0..4 {
            frames.push(subscription.recv_value().await.unwrap());
        }
        assert_eq!(frames[2]["event"], "session.resync");
        assert_eq!(frames[2]["payload"]["screen"], "latest");
        assert_eq!(frames[3]["payload"]["data"], "after");
    }

    #[tokio::test]
    async fn attach_reply_precedes_output_repair() {
        let bus = EventBus::with_limits(8, 4096);
        let mut subscription = bus.subscribe("client");
        assert!(bus.begin_terminal_attach("client", "terminal".to_owned()));
        assert_eq!(
            bus.send_terminal(
                "client",
                json!({ "sessionId": "terminal", "data": "during attach" }),
            ),
            TerminalSend::Stale
        );
        assert!(bus.send_frame("client", json!({ "id": "attach", "ok": true })));
        assert!(bus.complete_terminal_attach("client", "terminal"));
        assert!(bus.complete_terminal_resync("client", "terminal", "current".to_owned()));

        let reply = subscription.recv_value().await.unwrap();
        let resync = subscription.recv_value().await.unwrap();
        assert_eq!(reply["id"], "attach");
        assert_eq!(resync["event"], "session.resync");
        assert_eq!(resync["payload"]["screen"], "current");
    }

    #[tokio::test]
    async fn replaceable_frames_keep_only_the_latest_value() {
        let bus = EventBus::with_limits(4, 4096);
        let mut subscription = bus.subscribe("client");
        for sequence in 1..=100 {
            assert!(bus.send_replaceable(
                "client",
                "browser.frame",
                "browser.frame:one".to_owned(),
                json!({ "sequence": sequence }),
            ));
        }
        let frame = subscription.recv_value().await.unwrap();
        assert_eq!(frame["payload"]["sequence"], 100);
    }
}
