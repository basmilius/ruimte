use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Datelike, Timelike, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::{sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
};

const SCAN_TTL_MS: u64 = 60_000;
const INDEX_VERSION: u64 = 1;
const MARKET_TTL_MS: u64 = 24 * 60 * 60_000;
const PROBE_FRAME_MAX_BYTES: usize = 4 * 1024 * 1024;
const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const FRANKFURTER_URL: &str = "https://api.frankfurter.app/latest?from=USD&to=EUR";
static MODEL_SLUG: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new("[^a-z0-9]+").expect("model slug regex"));

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub calls: u64,
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cache_write_1h: u64,
    pub output: u64,
    pub reasoning: u64,
}

impl Totals {
    fn add(&mut self, other: &Self) {
        self.calls += other.calls;
        self.input += other.input;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.cache_write_1h += other.cache_write_1h;
        self.output += other.output;
        self.reasoning += other.reasoning;
    }

    fn maximize(&mut self, other: &Self) {
        self.calls = self.calls.max(other.calls);
        self.input = self.input.max(other.input);
        self.cache_read = self.cache_read.max(other.cache_read);
        self.cache_write = self.cache_write.max(other.cache_write);
        self.cache_write_1h = self.cache_write_1h.max(other.cache_write_1h);
        self.output = self.output.max(other.output);
        self.reasoning = self.reasoning.max(other.reasoning);
    }

    fn tokens(&self) -> u64 {
        self.input + self.cache_read + self.cache_write + self.output
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub provider: String,
    pub timestamp_ms: i64,
    pub model: String,
    pub session_id: String,
    pub cwd: String,
    pub totals: Totals,
    pub dedupe_key: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexState {
    model: Option<String>,
    session_id: String,
    cwd: String,
    total: Option<CodexCounts>,
    saw_session_meta: bool,
    suppressing: bool,
    anchor_ms: i64,
    last_signature: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCounts {
    input: i64,
    cached: i64,
    cache_write: i64,
    output: i64,
    reasoning: i64,
}

#[derive(Clone)]
struct IndexedFile {
    provider: String,
    size: u64,
    mtime_ms: f64,
    offset: u64,
    records: Vec<UsageRecord>,
    tail: Vec<UsageRecord>,
    codex: Option<CodexState>,
}

#[derive(Clone, Default)]
struct ScanReport {
    at: u64,
    files: usize,
    changed_files: usize,
    duration_ms: u64,
    roots: Vec<Value>,
    failed: bool,
}

struct UsageInner {
    home: PathBuf,
    roots: Vec<(String, PathBuf)>,
    index: BTreeMap<String, IndexedFile>,
    records: Arc<Vec<UsageRecord>>,
    loaded: bool,
    report: ScanReport,
    followers: HashSet<String>,
    prices: PriceBook,
    known_projects: Vec<crate::workspace::KnownProject>,
    rate: Option<Value>,
    limits: HashMap<String, LimitState>,
    limits_refreshed_at: u64,
}

#[derive(Clone)]
pub struct UsageService {
    inner: Arc<Mutex<UsageInner>>,
    scan_gate: Arc<Mutex<()>>,
    market_gate: Arc<Mutex<()>>,
    live_updates: Arc<std::sync::Mutex<BTreeMap<String, Value>>>,
    live_notify: Arc<tokio::sync::Notify>,
    limits_gate: Arc<Mutex<()>>,
    cancel: CancellationToken,
    tasks: Arc<std::sync::Mutex<Vec<JoinHandle<()>>>>,
    events: EventBus,
}

#[derive(Clone)]
struct LimitState {
    published: Value,
    backoff_ms: u64,
    next_at: u64,
}

impl UsageService {
    pub fn new(home: PathBuf, events: EventBus, allow_price_fetch: bool) -> Self {
        let user_home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let claude = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home.join(".claude"))
            .join("projects");
        let codex = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_home.join(".codex"))
            .join("sessions");
        let service = Self::new_with_roots(
            home,
            events,
            allow_price_fetch,
            vec![("claude".into(), claude), ("codex".into(), codex)],
        );
        service.start_background_loops();
        service.start_live_updates();
        service
    }

    fn start_background_loops(&self) {
        let inner = Arc::downgrade(&self.inner);
        let scan_gate = Arc::downgrade(&self.scan_gate);
        let market_gate = Arc::downgrade(&self.market_gate);
        let live_updates = Arc::downgrade(&self.live_updates);
        let live_notify = Arc::downgrade(&self.live_notify);
        let limits_gate = Arc::downgrade(&self.limits_gate);
        let tasks = Arc::downgrade(&self.tasks);
        let cancel = self.cancel.clone();
        let events = self.events.clone();
        let scan_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(SCAN_TTL_MS));
            interval.tick().await;
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = interval.tick() => {}
                }
                let (
                    Some(inner),
                    Some(scan_gate),
                    Some(market_gate),
                    Some(live_updates),
                    Some(live_notify),
                    Some(limits_gate),
                    Some(tasks),
                ) = (
                    inner.upgrade(),
                    scan_gate.upgrade(),
                    market_gate.upgrade(),
                    live_updates.upgrade(),
                    live_notify.upgrade(),
                    limits_gate.upgrade(),
                    tasks.upgrade(),
                )
                else {
                    break;
                };
                if inner.lock().await.followers.is_empty() {
                    continue;
                }
                let service = UsageService {
                    inner,
                    scan_gate,
                    market_gate,
                    live_updates,
                    live_notify,
                    limits_gate,
                    cancel: cancel.clone(),
                    tasks,
                    events: events.clone(),
                };
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    result = service.scan() => {
                        if result.is_err() {
                            service.inner.lock().await.report.failed = true;
                        }
                    }
                }
            }
        });
        self.track_task(scan_task);
        let inner = Arc::downgrade(&self.inner);
        let scan_gate = Arc::downgrade(&self.scan_gate);
        let market_gate = Arc::downgrade(&self.market_gate);
        let live_updates = Arc::downgrade(&self.live_updates);
        let live_notify = Arc::downgrade(&self.live_notify);
        let limits_gate = Arc::downgrade(&self.limits_gate);
        let tasks = Arc::downgrade(&self.tasks);
        let cancel = self.cancel.clone();
        let events = self.events.clone();
        let probe_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5 * 60));
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = interval.tick() => {}
                }
                let (
                    Some(inner),
                    Some(scan_gate),
                    Some(market_gate),
                    Some(live_updates),
                    Some(live_notify),
                    Some(limits_gate),
                    Some(tasks),
                ) = (
                    inner.upgrade(),
                    scan_gate.upgrade(),
                    market_gate.upgrade(),
                    live_updates.upgrade(),
                    live_notify.upgrade(),
                    limits_gate.upgrade(),
                    tasks.upgrade(),
                )
                else {
                    break;
                };
                UsageService {
                    inner,
                    scan_gate,
                    market_gate,
                    live_updates,
                    live_notify,
                    limits_gate,
                    cancel: cancel.clone(),
                    tasks,
                    events: events.clone(),
                }
                .refresh_limits(false)
                .await;
            }
        });
        self.track_task(probe_task);
    }

    fn start_live_updates(&self) {
        let inner = Arc::downgrade(&self.inner);
        let updates = Arc::downgrade(&self.live_updates);
        let notify = Arc::downgrade(&self.live_notify);
        let cancel = self.cancel.clone();
        let events = self.events.clone();
        let task = tokio::spawn(async move {
            while let Some(wake) = notify.upgrade() {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = wake.notified() => {}
                }
                drop(wake);
                let (Some(inner), Some(updates)) = (inner.upgrade(), updates.upgrade()) else {
                    break;
                };
                let pending =
                    std::mem::take(&mut *updates.lock().expect("usage live update lock poisoned"));
                if pending.is_empty() {
                    continue;
                }
                for update in pending.into_values() {
                    apply_live_update(&inner, &events, update).await;
                }
            }
        });
        self.track_task(task);
    }

    fn track_task(&self, task: JoinHandle<()>) {
        self.tasks
            .lock()
            .expect("usage task lock poisoned")
            .push(task);
    }

    fn new_with_roots(
        home: PathBuf,
        events: EventBus,
        allow_price_fetch: bool,
        roots: Vec<(String, PathBuf)>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(UsageInner {
                prices: PriceBook::new(allow_price_fetch),
                home,
                roots,
                index: BTreeMap::new(),
                records: Arc::new(Vec::new()),
                loaded: false,
                report: ScanReport::default(),
                followers: HashSet::new(),
                known_projects: Vec::new(),
                rate: None,
                limits: ["claude", "codex"]
                    .into_iter()
                    .map(|kind| {
                        (
                            kind.to_owned(),
                            LimitState {
                                published: blank_limit(kind),
                                backoff_ms: 5 * 60_000,
                                next_at: 0,
                            },
                        )
                    })
                    .collect(),
                limits_refreshed_at: 0,
            })),
            scan_gate: Arc::new(Mutex::new(())),
            market_gate: Arc::new(Mutex::new(())),
            live_updates: Arc::new(std::sync::Mutex::new(BTreeMap::new())),
            live_notify: Arc::new(tokio::sync::Notify::new()),
            limits_gate: Arc::new(Mutex::new(())),
            cancel: CancellationToken::new(),
            tasks: Arc::new(std::sync::Mutex::new(Vec::new())),
            events,
        }
    }

    pub fn begin_shutdown(&self) {
        self.cancel.cancel();
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown();
        let mut tasks = std::mem::take(&mut *self.tasks.lock().expect("usage task lock poisoned"));
        let timed_out = {
            let drain = async {
                for task in &mut tasks {
                    let _ = task.await;
                }
            };
            tokio::time::timeout(std::time::Duration::from_secs(2), drain)
                .await
                .is_err()
        };
        if timed_out {
            for task in &tasks {
                task.abort();
            }
            for task in tasks {
                let _ = task.await;
            }
        }
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        Some(match method {
            "usage.summary" => self.summary(payload).await,
            "usage.subscribe" => {
                self.inner
                    .lock()
                    .await
                    .followers
                    .insert(context.client_id.clone());
                Ok(json!({}))
            }
            "usage.unsubscribe" => {
                self.inner.lock().await.followers.remove(&context.client_id);
                Ok(json!({}))
            }
            "usage.limits" => Ok(self.limit_snapshot().await),
            "usage.refreshLimits" => {
                self.refresh_limits(true).await;
                Ok(self.limit_snapshot().await)
            }
            _ => return None,
        })
    }

    pub async fn detach(&self, client_id: &str) {
        self.inner.lock().await.followers.remove(client_id);
    }

    pub async fn set_known_projects(&self, projects: Vec<crate::workspace::KnownProject>) {
        self.inner.lock().await.known_projects = projects;
    }

    pub fn apply_live_limits(&self, update: Value) {
        let Some(kind) = update
            .get("kind")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        let mut pending = self
            .live_updates
            .lock()
            .expect("usage live update lock poisoned");
        let update = if let Some(previous) = pending.get(&kind) {
            let previous_windows = previous
                .get("windows")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let update_windows = update
                .get("windows")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default();
            json!({
                "kind": kind,
                "plan": update.get("plan").filter(|value| !value.is_null()).cloned().unwrap_or_else(|| previous.get("plan").cloned().unwrap_or(Value::Null)),
                "windows": merge_windows(previous_windows, update_windows),
            })
        } else {
            update
        };
        pending.insert(kind, update);
        drop(pending);
        self.live_notify.notify_one();
    }

    async fn summary(&self, payload: Value) -> RpcResult {
        let stale = {
            let inner = self.inner.lock().await;
            now_ms().saturating_sub(inner.report.at) > SCAN_TTL_MS
        };
        if stale {
            self.schedule_market_refresh();
            if self.scan().await.is_err() {
                self.inner.lock().await.report.failed = true;
            }
        }
        let inner = self.inner.lock().await;
        let mut result = aggregate(
            inner.records.as_slice(),
            &payload,
            &inner.prices,
            &inner.known_projects,
        )?;
        let report = &inner.report;
        let object = result
            .as_object_mut()
            .expect("aggregate result is an object");
        object.insert(
            "scan".into(),
            json!({
                "at": report.at,
                "files": report.files,
                "changedFiles": report.changed_files,
                "durationMs": report.duration_ms,
                "running": false,
                "failed": report.failed,
            }),
        );
        object.insert("pricing".into(), inner.prices.summary());
        object.insert("rate".into(), inner.rate.clone().unwrap_or(Value::Null));
        object.insert("roots".into(), Value::Array(report.roots.clone()));
        Ok(result)
    }

    fn schedule_market_refresh(&self) {
        let service = self.clone();
        let task = tokio::spawn(async move {
            service.refresh_market().await;
            service
                .events
                .broadcast("usage.changed", json!({ "pricing": true }));
        });
        self.track_task(task);
    }

    async fn refresh_market(&self) {
        let _refresh = self.market_gate.lock().await;
        let (home, mut prices, mut rate) = {
            let inner = self.inner.lock().await;
            (inner.home.clone(), inner.prices.clone(), inner.rate.clone())
        };
        prices.ensure(&home).await;
        ensure_rate(&home, prices.allow_fetch, &mut rate).await;
        let mut inner = self.inner.lock().await;
        inner.prices = prices;
        inner.rate = rate;
    }

    async fn limit_snapshot(&self) -> Value {
        let inner = self.inner.lock().await;
        let providers = ["claude", "codex"]
            .into_iter()
            .filter_map(|kind| inner.limits.get(kind).map(|state| state.published.clone()))
            .collect::<Vec<_>>();
        json!({ "providers": providers })
    }

    async fn refresh_limits(&self, force: bool) {
        self.refresh_limits_with(force, probe_limits).await;
    }

    async fn refresh_limits_with<F, Fut>(&self, force: bool, probe: F)
    where
        F: Fn(&'static str) -> Fut,
        Fut: std::future::Future<Output = Value>,
    {
        const INTERVAL: u64 = 5 * 60_000;
        const MAX_BACKOFF: u64 = 60 * 60_000;
        let requested_at = now_ms();
        let _refresh = tokio::select! {
            _ = self.cancel.cancelled() => return,
            guard = self.limits_gate.lock() => guard,
        };
        if force && self.inner.lock().await.limits_refreshed_at >= requested_at {
            return;
        }
        let mut changed = false;
        for kind in ["claude", "codex"] {
            let due = {
                let inner = self.inner.lock().await;
                let Some(state) = inner.limits.get(kind) else {
                    continue;
                };
                force || now_ms() >= state.next_at
            };
            if !due {
                continue;
            }
            let result = tokio::select! {
                _ = self.cancel.cancelled() => return,
                result = probe(kind) => result,
            };
            let unavailable = result.get("unavailable");
            let reason = unavailable
                .and_then(|value| value.get("reason"))
                .and_then(Value::as_str);
            let failed = reason == Some("failed");
            let mut inner = self.inner.lock().await;
            let Some(current) = inner.limits.get(kind).cloned() else {
                continue;
            };
            let backoff_ms = if failed {
                (current.backoff_ms * 2).min(MAX_BACKOFF)
            } else {
                INTERVAL
            };
            let keep_previous = failed
                && current
                    .published
                    .get("windows")
                    .and_then(Value::as_array)
                    .is_some_and(|windows| !windows.is_empty());
            let published = if keep_previous {
                current.published
            } else if let Some(unavailable) = unavailable {
                json!({"kind":kind,"plan":Value::Null,"checkedAt":now_ms(),"source":"probe","windows":[],"cost":Value::Null,"unavailable":unavailable})
            } else {
                json!({"kind":kind,"plan":result.get("plan").cloned().unwrap_or(Value::Null),"checkedAt":now_ms(),"source":"probe","windows":result.get("windows").cloned().unwrap_or_else(||json!([])),"cost":result.get("cost").cloned().unwrap_or(Value::Null),"unavailable":Value::Null})
            };
            inner.limits.insert(
                kind.into(),
                LimitState {
                    published,
                    backoff_ms,
                    next_at: now_ms() + backoff_ms,
                },
            );
            changed = true;
        }
        if changed {
            self.inner.lock().await.limits_refreshed_at = now_ms();
            self.events
                .broadcast("usage.limitsChanged", self.limit_snapshot().await);
        }
    }

    async fn scan(&self) -> Result<(), RpcError> {
        let _scan = self.scan_gate.lock().await;
        let (home, roots_to_scan, mut index, was_loaded) = {
            let mut inner = self.inner.lock().await;
            let was_loaded = inner.loaded;
            inner.loaded = true;
            (
                inner.home.clone(),
                inner.roots.clone(),
                inner.index.clone(),
                was_loaded,
            )
        };
        if !was_loaded
            && let Ok(text) = tokio::fs::read_to_string(home.join("usage/index.json")).await
        {
            index = decode_index(&text);
        }
        let started = Instant::now();
        let mut roots = Vec::new();
        let mut files = 0;
        let mut changed = 0;
        for (provider, root) in roots_to_scan {
            match tokio::fs::metadata(&root).await {
                Ok(info) if info.is_dir() => {}
                Ok(_) => {
                    roots.push(root_result(&provider, &root, "missing", None));
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    roots.push(root_result(&provider, &root, "missing", None));
                    continue;
                }
                Err(error) => {
                    roots.push(root_result(
                        &provider,
                        &root,
                        "failed",
                        Some(error.to_string()),
                    ));
                    continue;
                }
            }
            let walk_root = root.clone();
            let paths = tokio::task::spawn_blocking(move || {
                let mut paths = Vec::new();
                list_jsonl(&walk_root, &mut paths);
                paths
            })
            .await
            .map_err(internal)?;
            let mut failure = None;
            for path in paths {
                files += 1;
                match read_file_into(&mut index, &path, &provider).await {
                    Ok(true) => changed += 1,
                    Ok(false) => {}
                    Err(error) => {
                        failure.get_or_insert(error.to_string());
                    }
                };
            }
            roots.push(root_result(
                &provider,
                &root,
                if failure.is_some() { "failed" } else { "ok" },
                failure,
            ));
        }
        if changed > 0 {
            let directory = home.join("usage");
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(internal)?;
            atomic_write(
                &directory.join("index.json"),
                encode_index(&index).as_bytes(),
            )
            .await
            .map_err(internal)?;
        }
        let at = now_ms();
        let report = ScanReport {
            at,
            files,
            changed_files: changed,
            duration_ms: started.elapsed().as_millis() as u64,
            roots,
            failed: false,
        };
        let records = (!was_loaded || changed > 0).then(|| {
            Arc::new(fold_records(
                index
                    .values()
                    .flat_map(|file| file.records.iter().chain(&file.tail))
                    .cloned()
                    .collect(),
            ))
        });
        {
            let mut inner = self.inner.lock().await;
            inner.index = index;
            if let Some(records) = records {
                inner.records = records;
            }
            inner.report = report;
        }
        if changed > 0 {
            self.events
                .broadcast("usage.changed", json!({ "scannedAt": at }));
        }
        Ok(())
    }
}

fn parse_claude_line(line: &str) -> Option<UsageRecord> {
    let record: Value = serde_json::from_str(line).ok()?;
    if record.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = record.get("message")?.as_object()?;
    let usage = message.get("usage")?.as_object()?;
    let model = message.get("model")?.as_str()?;
    if model.is_empty() || model == "<synthetic>" {
        return None;
    }
    let timestamp_ms = timestamp(record.get("timestamp")?.as_str()?)?;
    let creation = usage.get("cache_creation").and_then(Value::as_object);
    let details = usage
        .get("output_tokens_details")
        .and_then(Value::as_object);
    let totals = Totals {
        calls: 1,
        input: int(usage.get("input_tokens")),
        cache_read: int(usage.get("cache_read_input_tokens")),
        cache_write: int(usage.get("cache_creation_input_tokens")),
        cache_write_1h: int(creation.and_then(|value| value.get("ephemeral_1h_input_tokens"))),
        output: int(usage.get("output_tokens")),
        reasoning: int(details.and_then(|value| value.get("thinking_tokens"))),
    };
    if totals.tokens() == 0 {
        return None;
    }
    Some(UsageRecord {
        provider: "claude".into(),
        timestamp_ms,
        model: model.into(),
        session_id: string(record.get("sessionId")),
        cwd: string(record.get("cwd")),
        totals,
        dedupe_key: message
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
    })
}

fn parse_codex_line(line: &str, state: &mut CodexState) -> Option<UsageRecord> {
    let record: Value = serde_json::from_str(line).ok()?;
    let record = record.as_object()?;
    let payload = record.get("payload")?.as_object()?;
    match record.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            if state.saw_session_meta {
                return None;
            }
            state.saw_session_meta = true;
            state.session_id = nonempty(payload.get("id"))
                .or_else(|| nonempty(payload.get("session_id")))
                .unwrap_or_default();
            state.cwd = string(payload.get("cwd"));
            if is_fork(payload) {
                state.suppressing = true;
                state.anchor_ms = record
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(timestamp)
                    .unwrap_or(0);
            }
            return None;
        }
        Some("turn_context") => {
            if let Some(model) = nonempty(payload.get("model")) {
                state.model = Some(model);
            }
            if let Some(cwd) = nonempty(payload.get("cwd")) {
                state.cwd = cwd;
            }
            return None;
        }
        _ => {}
    }
    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return None;
    }
    let info = payload.get("info")?.as_object()?;
    let total_value = info.get("total_token_usage")?;
    let total = counts(total_value.as_object()?);
    let model = state.model.clone()?;
    let timestamp_ms = timestamp(record.get("timestamp")?.as_str()?)?;
    let signature = codex_signature(total_value.as_object()?);
    if state.last_signature.as_deref() == Some(&signature) {
        return None;
    }
    state.last_signature = Some(signature);
    let difference = delta(&total, state.total.as_ref()).or_else(|| {
        info.get("last_token_usage")
            .and_then(Value::as_object)
            .map(counts)
    });
    state.total = Some(total);
    let count = difference?;
    if state.suppressing {
        if timestamp_ms - state.anchor_ms <= 1_000 {
            state.anchor_ms = timestamp_ms;
            return None;
        }
        state.suppressing = false;
    }
    let uncached = (count.input - count.cached - count.cache_write).max(0) as u64;
    let totals = Totals {
        calls: 1,
        input: uncached,
        cache_read: count.cached.max(0) as u64,
        cache_write: count.cache_write.max(0) as u64,
        cache_write_1h: 0,
        output: count.output.max(0) as u64,
        reasoning: count.reasoning.min(count.output).max(0) as u64,
    };
    if totals.tokens() == 0 {
        return None;
    }
    Some(UsageRecord {
        provider: "codex".into(),
        timestamp_ms,
        model,
        session_id: state.session_id.clone(),
        cwd: state.cwd.clone(),
        totals,
        dedupe_key: None,
    })
}

async fn read_file_into(
    index: &mut BTreeMap<String, IndexedFile>,
    path: &Path,
    provider: &str,
) -> anyhow::Result<bool> {
    read_file_into_with(index, path, provider, |_, _| Ok(())).await
}

async fn read_file_into_with<F>(
    index: &mut BTreeMap<String, IndexedFile>,
    path: &Path,
    provider: &str,
    mut after_stamp: F,
) -> anyhow::Result<bool>
where
    F: FnMut(usize, &Path) -> std::io::Result<()>,
{
    let key = path.to_string_lossy().into_owned();
    for attempt in 0..2 {
        let before = file_stamp(&tokio::fs::metadata(path).await?)?;
        let known = index.get(&key).cloned();
        if known.as_ref().is_some_and(|known| {
            known.provider == provider
                && known.size == before.size
                && mtime_matches(known.mtime_ms, before.mtime_ms())
        }) {
            return Ok(false);
        }
        after_stamp(attempt, path)?;
        let grown = known
            .as_ref()
            .is_some_and(|known| known.provider == provider && before.size > known.size);
        let from = known
            .as_ref()
            .filter(|_| grown)
            .map_or(0, |known| known.offset);
        let (records, tail, offset, codex) = parse_file_incremental(
            path,
            provider,
            from,
            known
                .as_ref()
                .filter(|_| grown)
                .and_then(|known| known.codex.clone()),
        )
        .await?;
        let after = file_stamp(&tokio::fs::metadata(path).await?)?;
        if before != after && attempt == 0 {
            continue;
        }
        let mut committed = known
            .as_ref()
            .filter(|_| grown)
            .map_or_else(Vec::new, |known| known.records.clone());
        committed.extend(records);
        index.insert(
            key,
            IndexedFile {
                provider: provider.into(),
                size: before.size,
                mtime_ms: before.mtime_ms(),
                offset,
                records: fold_records(committed),
                tail,
                codex,
            },
        );
        return Ok(true);
    }
    unreachable!()
}

#[derive(PartialEq)]
struct FileStamp {
    size: u64,
    modified: SystemTime,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl FileStamp {
    fn mtime_ms(&self) -> f64 {
        self.modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.0
    }
}

fn file_stamp(metadata: &std::fs::Metadata) -> std::io::Result<FileStamp> {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    Ok(FileStamp {
        size: metadata.len(),
        modified: metadata.modified()?,
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
    })
}

fn mtime_matches(left: f64, right: f64) -> bool {
    // An epoch-scale f64 can move by one ULP through the JSON index; one microsecond covers that loss.
    (left - right).abs() < 0.001
}

async fn parse_file_incremental(
    path: &Path,
    provider: &str,
    from: u64,
    state: Option<CodexState>,
) -> anyhow::Result<(Vec<UsageRecord>, Vec<UsageRecord>, u64, Option<CodexState>)> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    const CHUNK_BYTES: usize = 64 * 1024;
    const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;

    let mut file = tokio::fs::File::open(path).await?;
    file.seek(std::io::SeekFrom::Start(from)).await?;
    let mut buffer = vec![0; CHUNK_BYTES];
    let mut line = Vec::new();
    let mut oversized = false;
    let mut position = from;
    let mut committed_offset = from;
    let mut records = Vec::new();
    let mut codex = (provider == "codex").then(|| state.unwrap_or_default());

    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            position += 1;
            if *byte == b'\n' {
                if !oversized && let Some(record) = parse_usage_line(&line, provider, &mut codex) {
                    records.push(record);
                }
                line.clear();
                oversized = false;
                committed_offset = position;
            } else if !oversized {
                if line.len() < MAX_LINE_BYTES {
                    line.push(*byte);
                } else {
                    line.clear();
                    oversized = true;
                }
            }
        }
    }
    let committed = codex.clone();
    let mut tail = Vec::new();
    if !oversized && let Some(record) = parse_usage_line(&line, provider, &mut codex) {
        tail.push(record);
    }
    Ok((records, tail, committed_offset, committed))
}

fn parse_usage_line(
    raw: &[u8],
    provider: &str,
    codex: &mut Option<CodexState>,
) -> Option<UsageRecord> {
    let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
    let line = std::str::from_utf8(raw).ok()?;
    if provider == "claude" {
        return line
            .contains("\"usage\"")
            .then(|| parse_claude_line(line))
            .flatten();
    }
    if !line.contains("token_count")
        && !line.contains("turn_context")
        && !line.contains("session_meta")
    {
        return None;
    }
    parse_codex_line(line, codex.as_mut()?)
}

fn fold_records(records: Vec<UsageRecord>) -> Vec<UsageRecord> {
    let mut folded: Vec<UsageRecord> = Vec::new();
    let mut positions: HashMap<String, usize> = HashMap::new();
    for record in records {
        let Some(key) = record.dedupe_key.clone() else {
            folded.push(record);
            continue;
        };
        if let Some(position) = positions.get(&key).copied() {
            folded[position].totals.maximize(&record.totals);
        } else {
            positions.insert(key, folded.len());
            folded.push(record);
        }
    }
    folded
}

fn encode_index(index: &BTreeMap<String, IndexedFile>) -> String {
    let mut models = Interner::default();
    let mut sessions = Interner::default();
    let mut folders = Interner::default();
    let mut files = Map::new();
    for (path, file) in index {
        let rows = |records: &[UsageRecord],
                    models: &mut Interner,
                    sessions: &mut Interner,
                    folders: &mut Interner| {
            records
                .iter()
                .map(|record| {
                    json!([
                        record.timestamp_ms,
                        models.get(&record.model),
                        sessions.get(&record.session_id),
                        folders.get(&record.cwd),
                        record.totals.calls,
                        record.totals.input,
                        record.totals.cache_read,
                        record.totals.cache_write,
                        record.totals.cache_write_1h,
                        record.totals.output,
                        record.totals.reasoning,
                        record
                            .dedupe_key
                            .as_ref()
                            .map_or(Value::from(0), |key| Value::from(key.clone()))
                    ])
                })
                .collect::<Vec<_>>()
        };
        let records = rows(&file.records, &mut models, &mut sessions, &mut folders);
        let tail = rows(&file.tail, &mut models, &mut sessions, &mut folders);
        files.insert(path.clone(), json!({"p":file.provider,"s":file.size,"m":file.mtime_ms,"o":file.offset,"r":records,"t":tail,"c":file.codex}));
    }
    serde_json::to_string(&json!({"version":INDEX_VERSION,"models":models.values,"sessions":sessions.values,"folders":folders.values,"files":files})).unwrap()
}

fn decode_index(text: &str) -> BTreeMap<String, IndexedFile> {
    let Ok(document) = serde_json::from_str::<Value>(text) else {
        return BTreeMap::new();
    };
    if document.get("version").and_then(Value::as_u64) != Some(INDEX_VERSION) {
        return BTreeMap::new();
    }
    let tables =
        ["models", "sessions", "folders"].map(|name| document.get(name).and_then(Value::as_array));
    let [Some(models), Some(sessions), Some(folders)] = tables else {
        return BTreeMap::new();
    };
    let mut index = BTreeMap::new();
    let Some(files) = document.get("files").and_then(Value::as_object) else {
        return index;
    };
    for (path, file) in files {
        let Some(provider) = file
            .get("p")
            .and_then(Value::as_str)
            .filter(|p| matches!(*p, "claude" | "codex"))
        else {
            continue;
        };
        let Some(size) = file.get("s").and_then(Value::as_u64) else {
            continue;
        };
        let Some(mtime_ms) = file.get("m").and_then(Value::as_f64).filter(|v| *v >= 0.0) else {
            continue;
        };
        let Some(offset) = file.get("o").and_then(Value::as_u64) else {
            continue;
        };
        let Some(records) = decode_rows(file.get("r"), provider, models, sessions, folders) else {
            continue;
        };
        let Some(tail) = decode_rows(
            file.get("t").or(Some(&Value::Array(vec![]))),
            provider,
            models,
            sessions,
            folders,
        ) else {
            continue;
        };
        let codex = file
            .get("c")
            .filter(|v| !v.is_null())
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        index.insert(
            path.clone(),
            IndexedFile {
                provider: provider.into(),
                size,
                mtime_ms,
                offset,
                records,
                tail,
                codex,
            },
        );
    }
    index
}

fn decode_rows(
    value: Option<&Value>,
    provider: &str,
    models: &[Value],
    sessions: &[Value],
    folders: &[Value],
) -> Option<Vec<UsageRecord>> {
    let mut output = Vec::new();
    for row in value?.as_array()? {
        let row = row.as_array()?;
        if row.len() != 12 {
            return None;
        }
        let at = |index: usize| row.get(index)?.as_u64();
        let name = |table: &[Value], index: usize| {
            table.get(at(index)? as usize)?.as_str().map(str::to_owned)
        };
        output.push(UsageRecord {
            provider: provider.into(),
            timestamp_ms: row[0].as_i64()?,
            model: name(models, 1)?,
            session_id: name(sessions, 2)?,
            cwd: name(folders, 3)?,
            totals: Totals {
                calls: at(4)?,
                input: at(5)?,
                cache_read: at(6)?,
                cache_write: at(7)?,
                cache_write_1h: at(8)?,
                output: at(9)?,
                reasoning: at(10)?,
            },
            dedupe_key: if row[11] == 0 {
                None
            } else {
                Some(row[11].as_str()?.into())
            },
        });
    }
    Some(output)
}

#[derive(Default)]
struct Interner {
    values: Vec<String>,
    at: HashMap<String, usize>,
}
impl Interner {
    fn get(&mut self, value: &str) -> usize {
        if let Some(at) = self.at.get(value) {
            *at
        } else {
            let at = self.values.len();
            self.values.push(value.into());
            self.at.insert(value.into(), at);
            at
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelPrice {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
    cache_write_1h: f64,
}

#[derive(Clone)]
struct PriceBook {
    table: HashMap<String, ModelPrice>,
    allow_fetch: bool,
    source: &'static str,
    fetched_at: Option<u64>,
    loaded_from_disk: bool,
}
impl PriceBook {
    fn new(allow_fetch: bool) -> Self {
        let document: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/data/prices-snapshot.json"
        )))
        .unwrap_or(Value::Null);
        Self {
            table: parse_price_table(&document),
            allow_fetch,
            source: "snapshot",
            fetched_at: None,
            loaded_from_disk: false,
        }
    }
    fn look(&self, model: &str) -> (Option<&ModelPrice>, &'static str, Option<String>) {
        lookup_price(&self.table, model)
    }
    fn summary(&self) -> Value {
        json!({"source":if self.table.is_empty(){"none"}else{self.source},"fetchedAt":self.fetched_at,"models":self.table.len()})
    }

    async fn ensure(&mut self, home: &Path) {
        let file = home.join("usage/prices.json");
        if !self.loaded_from_disk {
            self.loaded_from_disk = true;
            if let Ok(text) = tokio::fs::read_to_string(&file).await
                && let Ok(snapshot) = serde_json::from_str::<Value>(&text)
                && let Some(fetched_at) = snapshot.get("fetchedAt").and_then(Value::as_u64)
            {
                let table = parse_price_table(snapshot.get("document").unwrap_or(&Value::Null));
                if !table.is_empty() {
                    self.table = table;
                    self.source = "litellm";
                    self.fetched_at = Some(fetched_at);
                }
            }
        }
        if !self.allow_fetch
            || self
                .fetched_at
                .is_some_and(|at| now_ms().saturating_sub(at) < MARKET_TTL_MS)
        {
            return;
        }
        let url = std::env::var("RUIMTE_LITELLM_URL").unwrap_or_else(|_| LITELLM_URL.into());
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let Ok(response) = client.get(url).send().await else {
            return;
        };
        if !response.status().is_success() {
            return;
        }
        let Ok(document) = response.json::<Value>().await else {
            return;
        };
        let table = parse_price_table(&document);
        if table.is_empty() {
            return;
        }
        let fetched_at = now_ms();
        let snapshot = json!({"fetchedAt":fetched_at,"document":document});
        if let Some(directory) = file.parent()
            && tokio::fs::create_dir_all(directory).await.is_ok()
        {
            let _ = atomic_write(&file, snapshot.to_string().as_bytes()).await;
        }
        self.table = table;
        self.source = "litellm";
        self.fetched_at = Some(fetched_at);
    }
}

async fn ensure_rate(home: &Path, allow_fetch: bool, current: &mut Option<Value>) {
    let file = home.join("usage/exchange-rate.json");
    if current.is_none()
        && let Ok(text) = tokio::fs::read_to_string(&file).await
        && let Ok(stored) = serde_json::from_str::<Value>(&text)
        && valid_rate(&stored)
    {
        *current = Some(stored);
    }
    if !allow_fetch
        || current
            .as_ref()
            .and_then(|rate| rate.get("fetchedAt"))
            .and_then(Value::as_u64)
            .is_some_and(|at| now_ms().saturating_sub(at) < MARKET_TTL_MS)
    {
        return;
    }
    let url = std::env::var("RUIMTE_FRANKFURTER_URL").unwrap_or_else(|_| FRANKFURTER_URL.into());
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let Ok(response) = client.get(url).send().await else {
        return;
    };
    if !response.status().is_success() {
        return;
    }
    let Ok(document) = response.json::<Value>().await else {
        return;
    };
    let Some(rate) = document
        .pointer("/rates/EUR")
        .and_then(Value::as_f64)
        .filter(|rate| rate.is_finite() && *rate > 0.0)
    else {
        return;
    };
    let Some(date) = document.get("date").and_then(Value::as_str) else {
        return;
    };
    let value = json!({"currency":"EUR","rate":rate,"date":date,"fetchedAt":now_ms()});
    if let Some(directory) = file.parent()
        && tokio::fs::create_dir_all(directory).await.is_ok()
    {
        let _ = atomic_write(&file, value.to_string().as_bytes()).await;
    }
    *current = Some(value);
}

fn valid_rate(value: &Value) -> bool {
    value.get("currency").and_then(Value::as_str) == Some("EUR")
        && value
            .get("rate")
            .and_then(Value::as_f64)
            .is_some_and(|rate| rate.is_finite() && rate > 0.0)
        && value.get("date").and_then(Value::as_str).is_some()
        && value.get("fetchedAt").and_then(Value::as_u64).is_some()
}

fn parse_price_table(document: &Value) -> HashMap<String, ModelPrice> {
    let mut table = HashMap::new();
    let Some(entries) = document.as_object() else {
        return table;
    };
    for (name, value) in entries {
        let Some(entry) = value.as_object() else {
            continue;
        };
        if !matches!(
            entry.get("litellm_provider").and_then(Value::as_str),
            Some("anthropic" | "openai")
        ) || !matches!(
            entry.get("mode").and_then(Value::as_str),
            Some("chat" | "responses")
        ) {
            continue;
        }
        let Some(input) = rate(entry.get("input_cost_per_token")) else {
            continue;
        };
        let Some(output) = rate(entry.get("output_cost_per_token")) else {
            continue;
        };
        let price = ModelPrice {
            input,
            output,
            cache_read: rate(entry.get("cache_read_input_token_cost")).unwrap_or(input * 0.1),
            cache_write: rate(entry.get("cache_creation_input_token_cost")).unwrap_or(input * 1.25),
            cache_write_1h: input * 2.,
        };
        let key = name.trim().to_lowercase();
        table.insert(key.clone(), price.clone());
        if let Some((_, bare)) = key.rsplit_once('/') {
            table.entry(bare.into()).or_insert(price);
        }
    }
    table
}

fn lookup_price<'a>(
    table: &'a HashMap<String, ModelPrice>,
    model: &str,
) -> (Option<&'a ModelPrice>, &'static str, Option<String>) {
    let key = model
        .trim()
        .to_lowercase()
        .split('[')
        .next()
        .unwrap_or_default()
        .to_owned();
    let bare = key.rsplit('/').next().unwrap_or_default();
    if bare.is_empty()
        || matches!(
            bare,
            "opus" | "sonnet" | "haiku" | "fable" | "gpt" | "codex" | "synthetic" | "<synthetic>"
        )
    {
        return (None, "unknown", None);
    }
    if let Some(price) = table.get(&key).or_else(|| table.get(bare)) {
        return (Some(price), "exact", None);
    }
    let dated = regex::Regex::new(r"^(.*)-\d{6,8}$")
        .unwrap()
        .captures(bare)
        .and_then(|c| c.get(1))
        .map(|v| v.as_str().to_owned());
    if let Some(name) = dated.as_ref()
        && let Some(price) = table.get(name)
    {
        return (Some(price), "exact", Some(name.clone()));
    }
    let mut family = dated.unwrap_or_else(|| bare.into());
    while let Some(at) = family.rfind('-') {
        family.truncate(at);
        if !matches!(
            family.as_str(),
            "opus" | "sonnet" | "haiku" | "fable" | "gpt" | "codex"
        ) && let Some(price) = table.get(&family)
        {
            return (Some(price), "family", Some(family));
        }
    }
    (None, "unknown", None)
}

fn aggregate(
    records: &[UsageRecord],
    payload: &Value,
    prices: &PriceBook,
    known_projects: &[crate::workspace::KnownProject],
) -> RpcResult {
    let from = payload
        .get("from")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let to = payload
        .get("to")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let resolution = payload
        .get("resolution")
        .and_then(Value::as_str)
        .unwrap_or("day");
    let timezone = payload
        .get("timeZone")
        .and_then(Value::as_str)
        .unwrap_or("UTC");
    let zone = timezone.parse::<Tz>().unwrap_or(chrono_tz::UTC);
    #[derive(Default)]
    struct Acc {
        totals: Totals,
        cost: f64,
        priced: bool,
        savings: f64,
        sessions: HashSet<String>,
    }
    let mut buckets: HashMap<(String, String, String), Acc> = HashMap::new();
    let mut models: HashMap<(String, String), Acc> = HashMap::new();
    type PriceBasis<'a> = HashMap<(String, String), (&'a str, Option<String>)>;
    type ProjectUsage = HashMap<String, (Acc, HashMap<String, (f64, u64)>)>;
    let mut basis: PriceBasis<'_> = HashMap::new();
    let mut projects: ProjectUsage = HashMap::new();
    let mut project_roots = HashMap::<&str, String>::new();
    let mut sessions = HashSet::new();
    for record in records {
        let Some(at) = DateTime::<Utc>::from_timestamp_millis(record.timestamp_ms) else {
            continue;
        };
        let local = at.with_timezone(&zone);
        let day = format!(
            "{:04}-{:02}-{:02}",
            local.year(),
            local.month(),
            local.day()
        );
        if day.as_str() < from || day.as_str() > to {
            continue;
        }
        let slot = if resolution == "hour" {
            format!("{day}T{:02}", local.hour())
        } else {
            day
        };
        let (price, price_basis, priced_as) = prices.look(&record.model);
        let cost = price.map_or(0., |p| cost_of(&record.totals, p));
        let savings = price.map_or(0., |p| {
            record.totals.cache_read as f64 * (p.input - p.cache_read)
        });
        let bucket = buckets
            .entry((slot, record.provider.clone(), record.model.clone()))
            .or_default();
        bucket.totals.add(&record.totals);
        bucket.cost += cost;
        bucket.priced |= price.is_some();
        bucket.savings += savings;
        if !record.session_id.is_empty() {
            bucket.sessions.insert(record.session_id.clone());
            sessions.insert(format!("{}\0{}", record.provider, record.session_id));
        }
        let key = (record.provider.clone(), record.model.clone());
        let model = models.entry(key.clone()).or_default();
        model.totals.add(&record.totals);
        model.cost += cost;
        model.priced |= price.is_some();
        basis.entry(key).or_insert((price_basis, priced_as));
        let folder = project_roots
            .entry(record.cwd.as_str())
            .or_insert_with(|| project_root(&record.cwd));
        let project = projects.entry(folder.clone()).or_default();
        project.0.totals.add(&record.totals);
        project.0.cost += cost;
        let share = project.1.entry(record.provider.clone()).or_default();
        share.0 += cost;
        share.1 += record.totals.tokens();
    }
    let mut bucket_values=buckets.into_iter().map(|((slot,provider,model),a)|json!({"slot":slot,"provider":provider,"model":model,"totals":a.totals,"costUsd":if a.priced{Value::from(a.cost)}else{Value::Null},"cacheSavingsUsd":a.savings,"sessions":a.sessions.len()})).collect::<Vec<_>>();
    bucket_values.sort_by_key(|v| {
        (
            string(v.get("slot")),
            string(v.get("provider")),
            string(v.get("model")),
        )
    });
    let mut model_values=models.into_iter().map(|((provider,model),a)|{let b=basis.remove(&(provider.clone(),model.clone())).unwrap_or(("unknown",None));json!({"provider":provider,"model":model,"totals":a.totals,"costUsd":if a.priced{Value::from(a.cost)}else{Value::Null},"priceBasis":b.0,"pricedAs":b.1})}).collect::<Vec<_>>();
    model_values.sort_by(|a, b| {
        b.get("costUsd")
            .and_then(Value::as_f64)
            .unwrap_or(-1.)
            .total_cmp(&a.get("costUsd").and_then(Value::as_f64).unwrap_or(-1.))
    });
    let mut project_values=projects.into_iter().map(|(folder,(a,shares))|{let known=known_projects.iter().find(|project|project.folder.as_deref()==Some(&folder));let name=known.map(|project|project.name.as_str()).unwrap_or_else(||Path::new(&folder).file_name().and_then(|v|v.to_str()).unwrap_or(if folder.is_empty(){"Elsewhere"}else{""}));let by_provider=shares.into_iter().map(|(kind,(cost,tokens))|(kind,json!({"costUsd":cost,"tokens":tokens}))).collect::<Map<_,_>>();json!({"folder":folder,"name":name,"projectId":known.map(|project|project.project_id.clone()),"byProvider":by_provider,"totals":a.totals,"costUsd":a.cost})}).collect::<Vec<_>>();
    project_values.sort_by(|a, b| {
        b["costUsd"]
            .as_f64()
            .unwrap_or_default()
            .total_cmp(&a["costUsd"].as_f64().unwrap_or_default())
    });
    Ok(
        json!({"from":from,"to":to,"resolution":resolution,"timeZone":timezone,"buckets":bucket_values,"models":model_values,"projects":project_values,"sessions":sessions.len()}),
    )
}

fn project_root(cwd: &str) -> String {
    if cwd.is_empty() {
        return String::new();
    }
    let mut at = PathBuf::from(cwd);
    loop {
        let git = at.join(".git");
        if let Ok(metadata) = std::fs::metadata(&git) {
            if metadata.is_file()
                && let Ok(text) = std::fs::read_to_string(&git)
                && let Some(git_dir) = text.lines().find_map(|line| line.strip_prefix("gitdir:"))
                && let Some(position) = git_dir.trim().find("/.git/worktrees/")
            {
                return git_dir.trim()[..position].to_owned();
            }
            return at.to_string_lossy().into_owned();
        }
        if !at.pop() {
            return cwd.to_owned();
        }
    }
}

fn cost_of(t: &Totals, p: &ModelPrice) -> f64 {
    t.input as f64 * p.input
        + t.cache_read as f64 * p.cache_read
        + t.cache_write.saturating_sub(t.cache_write_1h) as f64 * p.cache_write
        + t.cache_write_1h as f64 * p.cache_write_1h
        + t.output as f64 * p.output
}
fn blank_limit(kind: &str) -> Value {
    json!({"kind":kind,"plan":Value::Null,"checkedAt":0,"source":"probe","windows":[],"cost":Value::Null,"unavailable":Value::Null})
}

fn kind_of_duration(duration_ms: Option<f64>) -> &'static str {
    match duration_ms {
        None => "other",
        Some(value) if value >= 30.0 * 24.0 * 60.0 * 60_000.0 => "monthly",
        Some(value) if value >= 7.0 * 24.0 * 60.0 * 60_000.0 => "weekly",
        Some(_) => "session",
    }
}

fn read_claude_usage(response: &Value) -> Value {
    let Some(response) = response.as_object() else {
        return json!({"unavailable":{"reason":"failed","message":"Claude Code returned no readable usage"}});
    };
    let limits = response.get("rate_limits").and_then(Value::as_object);
    if response
        .get("rate_limits_available")
        .and_then(Value::as_bool)
        == Some(false)
        || limits.is_none()
    {
        return json!({"unavailable":{"reason":"no-subscription","message":Value::Null}});
    }
    let limits = limits.unwrap();
    let known = [
        ("five_hour", "Session", "session", 5 * 60 * 60_000),
        ("seven_day", "Weekly", "weekly", 7 * 24 * 60 * 60_000),
        (
            "seven_day_opus",
            "Weekly · Opus",
            "weekly",
            7 * 24 * 60 * 60_000,
        ),
        (
            "seven_day_sonnet",
            "Weekly · Sonnet",
            "weekly",
            7 * 24 * 60 * 60_000,
        ),
    ];
    let mut windows = Vec::new();
    let mut push = |id: String, label: String, kind: &str, duration: i64, value: Option<&Value>| {
        let Some(entry) = value.and_then(Value::as_object) else {
            return;
        };
        let Some(utilization) = entry.get("utilization").and_then(Value::as_f64) else {
            return;
        };
        let reset = entry
            .get("resets_at")
            .and_then(Value::as_str)
            .and_then(timestamp);
        windows.push(json!({"id":id,"label":label,"kind":kind,"used":(utilization/100.0).clamp(0.0,1.0),"resetsAt":reset,"durationMs":duration}));
    };
    for (id, label, kind, duration) in known {
        push(id.into(), label.into(), kind, duration, limits.get(id));
    }
    for entry in limits
        .get("model_scoped")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(name) = entry
            .as_object()
            .and_then(|value| value.get("display_name"))
            .and_then(Value::as_str)
        {
            let slug = MODEL_SLUG
                .replace_all(&name.to_lowercase(), "_")
                .trim_matches('_')
                .to_owned();
            push(
                format!("seven_day_{slug}"),
                format!("Weekly · {name}"),
                "weekly",
                7 * 24 * 60 * 60_000,
                Some(entry),
            );
        }
    }
    let cost = response
        .get("session")
        .and_then(Value::as_object)
        .and_then(|value| value.get("total_cost_usd"))
        .and_then(Value::as_f64)
        .map(|session_usd| json!({"sessionUsd":session_usd}));
    json!({"plan":response.get("subscription_type").and_then(Value::as_str),"windows":windows,"cost":cost})
}

#[cfg(test)]
fn read_claude_event(info: &Value) -> Value {
    let Some(info) = info.as_object() else {
        return Value::Null;
    };
    let (Some(kind), Some(utilization)) = (
        info.get("rateLimitType").and_then(Value::as_str),
        info.get("utilization").and_then(Value::as_f64),
    ) else {
        return Value::Null;
    };
    let known = match kind {
        "five_hour" => Some(("Session", "session", 5 * 60 * 60_000)),
        "seven_day" => Some(("Weekly", "weekly", 7 * 24 * 60 * 60_000)),
        "seven_day_opus" => Some(("Weekly · Opus", "weekly", 7 * 24 * 60 * 60_000)),
        "seven_day_sonnet" => Some(("Weekly · Sonnet", "weekly", 7 * 24 * 60 * 60_000)),
        _ => None,
    };
    let mut window = Map::new();
    window.insert("id".into(), Value::from(kind));
    if let Some((label, kind, duration)) = known {
        window.insert("label".into(), Value::from(label));
        window.insert("kind".into(), Value::from(kind));
        window.insert("durationMs".into(), Value::from(duration));
    }
    window.insert("used".into(), Value::from(utilization.clamp(0.0, 1.0)));
    if let Some(reset) = info.get("resetsAt").and_then(Value::as_f64) {
        window.insert("resetsAt".into(), Value::from(js_round(reset * 1000.0)));
    }
    json!({"kind":"claude","windows":[Value::Object(window)]})
}

fn read_codex_limits(snapshot: &Value) -> Value {
    let Some(snapshot) = snapshot.as_object() else {
        return Value::Null;
    };
    if snapshot
        .get("limitId")
        .and_then(Value::as_str)
        .is_some_and(|value| value != "codex")
    {
        return Value::Null;
    }
    let mut windows = Vec::new();
    for (position, value) in [
        ("primary", snapshot.get("primary")),
        ("secondary", snapshot.get("secondary")),
    ] {
        let Some(window) = value.and_then(Value::as_object) else {
            continue;
        };
        let Some(used) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        let duration = window
            .get("windowDurationMins")
            .and_then(Value::as_f64)
            .map(|value| js_round(value * 60_000.0));
        let kind = kind_of_duration(duration.map(|value| value as f64));
        let label = match kind {
            "session" => "Session",
            "weekly" => "Weekly",
            "monthly" => "Monthly",
            _ => "Usage",
        };
        let reset = window
            .get("resetsAt")
            .and_then(Value::as_f64)
            .map(|value| js_round(value * 1000.0));
        windows.push(json!({"id":position,"kind":kind,"label":label,"used":(used/100.0).clamp(0.0,1.0),"resetsAt":reset,"durationMs":duration}));
    }
    json!({"plan":snapshot.get("planType").and_then(Value::as_str),"windows":windows,"cost":Value::Null})
}

fn merge_windows(known: &[Value], updates: &[Value]) -> Vec<Value> {
    let mut merged = known.to_vec();
    for update in updates {
        let Some(update) = update.as_object() else {
            continue;
        };
        let (Some(id), Some(_)) = (
            update.get("id").and_then(Value::as_str),
            update.get("used").and_then(Value::as_f64),
        ) else {
            continue;
        };
        if let Some(existing) = merged
            .iter_mut()
            .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
        {
            existing.as_object_mut().unwrap().extend(update.clone());
        } else {
            merged.push(json!({
                "id":id,
                "kind":update.get("kind").and_then(Value::as_str).unwrap_or("other"),
                "label":update.get("label").and_then(Value::as_str).unwrap_or("Usage"),
                "used":update["used"],
                "resetsAt":update.get("resetsAt").cloned().unwrap_or(Value::Null),
                "durationMs":update.get("durationMs").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    merged
}

async fn apply_live_update(inner: &Arc<Mutex<UsageInner>>, events: &EventBus, update: Value) {
    let Some(kind) = update.get("kind").and_then(Value::as_str) else {
        return;
    };
    let Some(windows) = update.get("windows").and_then(Value::as_array) else {
        return;
    };
    if windows.is_empty() {
        return;
    }
    let snapshot = {
        let mut inner = inner.lock().await;
        let Some(state) = inner.limits.get_mut(kind) else {
            return;
        };
        let previous = state.published.as_object().cloned().unwrap_or_default();
        let known_windows = previous
            .get("windows")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        state.published = json!({
            "kind": kind,
            "plan": update.get("plan").filter(|value| !value.is_null()).cloned().unwrap_or_else(|| previous.get("plan").cloned().unwrap_or(Value::Null)),
            "checkedAt": now_ms(),
            "source": "event",
            "windows": merge_windows(known_windows, windows),
            "cost": previous.get("cost").cloned().unwrap_or(Value::Null),
            "unavailable": Value::Null,
        });
        let providers = ["claude", "codex"]
            .into_iter()
            .filter_map(|provider| {
                inner
                    .limits
                    .get(provider)
                    .map(|state| state.published.clone())
            })
            .collect::<Vec<_>>();
        json!({ "providers": providers })
    };
    events.broadcast("usage.limitsChanged", snapshot);
}

fn js_round(value: f64) -> i64 {
    (value + 0.5).floor() as i64
}

async fn probe_limits(kind: &str) -> Value {
    match kind {
        "claude" => probe_claude().await,
        "codex" => probe_codex().await,
        _ => json!({"unavailable":{"reason":"failed","message":"Unknown provider"}}),
    }
}

async fn read_probe_frame<R>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    use tokio::io::AsyncBufReadExt;

    let mut frame = Vec::new();
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok((!frame.is_empty()).then_some(frame));
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if frame.len().saturating_add(take) > PROBE_FRAME_MAX_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "provider response exceeded the frame limit",
            ));
        }
        frame.extend_from_slice(&available[..take]);
        reader.consume(take);
        if frame.last() == Some(&b'\n') {
            return Ok(Some(frame));
        }
    }
}

async fn probe_claude() -> Value {
    use tokio::io::{AsyncWriteExt, BufReader};
    use tokio::process::Command;

    let mut command = Command::new("claude");
    command
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .env_remove("RUIMTE_HOOK_URL")
        .env_remove("RUIMTE_HOOK_TOKEN")
        .env_remove("RUIMTE_CONTEXT_URL")
        .env_remove("RUIMTE_CONTEXT_TOKEN")
        .env_remove("RUIMTE_SESSION_ID")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return json!({"unavailable":{"reason":"not-installed","message":Value::Null}});
        }
        Err(error) => {
            return json!({"unavailable":{"reason":"failed","message":error.to_string()}});
        }
    };
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let work = async {
        stdin.write_all(br#"{"type":"control_request","request_id":"ruimte-init","request":{"subtype":"initialize","hooks":{}}}
"#).await?;
        let mut asked = false;
        while let Some(line) = read_probe_frame(&mut stdout).await? {
            let Ok(frame) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if frame.get("type").and_then(Value::as_str) != Some("control_response") {
                continue;
            }
            if !asked {
                asked = true;
                stdin.write_all(br#"{"type":"control_request","request_id":"ruimte-usage","request":{"subtype":"get_usage"}}
"#).await?;
                continue;
            }
            if frame.pointer("/response/subtype").and_then(Value::as_str) == Some("error") {
                return Ok::<Value, std::io::Error>(
                    json!({"unavailable":{"reason":"failed","message":"Claude Code refused to report its usage"}}),
                );
            }
            return Ok(read_claude_usage(
                frame
                    .pointer("/response/response")
                    .or_else(|| frame.get("response"))
                    .unwrap_or(&Value::Null),
            ));
        }
        Ok(
            json!({"unavailable":{"reason":"failed","message":"Claude Code closed without reporting its usage"}}),
        )
    };
    let result = match tokio::time::timeout(std::time::Duration::from_secs(20), work).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({"unavailable":{"reason":"failed","message":error.to_string()}}),
        Err(_) => {
            json!({"unavailable":{"reason":"failed","message":"Claude Code did not answer in time"}})
        }
    };
    let _ = child.kill().await;
    result
}

async fn probe_codex() -> Value {
    use tokio::io::{AsyncWriteExt, BufReader};
    use tokio::process::Command;

    let mut command = Command::new("codex");
    command
        .arg("app-server")
        .env_remove("RUIMTE_HOOK_URL")
        .env_remove("RUIMTE_HOOK_TOKEN")
        .env_remove("RUIMTE_CONTEXT_URL")
        .env_remove("RUIMTE_CONTEXT_TOKEN")
        .env_remove("RUIMTE_SESSION_ID")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return json!({"unavailable":{"reason":"not-installed","message":Value::Null}});
        }
        Err(error) => {
            return json!({"unavailable":{"reason":"failed","message":error.to_string()}});
        }
    };
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let work = async {
        stdin.write_all(br#"{"id":1,"method":"initialize","params":{"clientInfo":{"name":"ruimte","title":"Ruimte","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
"#).await?;
        while let Some(line) = read_probe_frame(&mut stdout).await? {
            let Ok(frame) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if frame.get("id").and_then(Value::as_u64) == Some(1) {
                stdin
                    .write_all(
                        br#"{"method":"initialized","params":{}}
{"id":2,"method":"account/rateLimits/read"}
"#,
                    )
                    .await?;
            } else if frame.get("id").and_then(Value::as_u64) == Some(2) {
                let reading =
                    read_codex_limits(frame.pointer("/result/rateLimits").unwrap_or(&Value::Null));
                return Ok::<Value, std::io::Error>(if reading.is_null() {
                    json!({"unavailable":{"reason":"no-subscription","message":Value::Null}})
                } else {
                    reading
                });
            }
        }
        Ok(
            json!({"unavailable":{"reason":"failed","message":"Codex closed without reporting its usage"}}),
        )
    };
    let result = match tokio::time::timeout(std::time::Duration::from_secs(20), work).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({"unavailable":{"reason":"failed","message":error.to_string()}}),
        Err(_) => {
            json!({"unavailable":{"reason":"failed","message":"Codex did not answer in time"}})
        }
    };
    let _ = child.kill().await;
    result
}
fn int(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v > 0.)
        .map(|v| v.trunc() as u64)
        .unwrap_or(0)
}
fn rate(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|v| v.is_finite() && *v >= 0.)
}
fn string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().into()
}
fn nonempty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
fn timestamp(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|v| v.timestamp_millis())
}
fn counts(value: &Map<String, Value>) -> CodexCounts {
    CodexCounts {
        input: int(value.get("input_tokens")) as i64,
        cached: int(value.get("cached_input_tokens")) as i64,
        cache_write: int(value.get("cache_write_input_tokens")) as i64,
        output: int(value.get("output_tokens")) as i64,
        reasoning: int(value.get("reasoning_output_tokens")) as i64,
    }
}
fn codex_signature(value: &Map<String, Value>) -> String {
    let fields = [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
    ];
    let body = fields
        .into_iter()
        .filter_map(|name| {
            value.get(name).map(|value| {
                format!(
                    "{}:{}",
                    serde_json::to_string(name).unwrap(),
                    serde_json::to_string(value).unwrap()
                )
            })
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{body}}}")
}
fn delta(total: &CodexCounts, previous: Option<&CodexCounts>) -> Option<CodexCounts> {
    let Some(previous) = previous else {
        return Some(total.clone());
    };
    let value = CodexCounts {
        input: total.input - previous.input,
        cached: total.cached - previous.cached,
        cache_write: total.cache_write - previous.cache_write,
        output: total.output - previous.output,
        reasoning: total.reasoning - previous.reasoning,
    };
    (value.input >= 0
        && value.cached >= 0
        && value.cache_write >= 0
        && value.output >= 0
        && value.reasoning >= 0)
        .then_some(value)
}
fn is_fork(payload: &Map<String, Value>) -> bool {
    payload
        .get("forked_from_id")
        .and_then(Value::as_str)
        .is_some()
        || payload
            .get("parent_thread_id")
            .and_then(Value::as_str)
            .is_some()
        || payload
            .get("source")
            .and_then(Value::as_object)
            .and_then(|value| value.get("subagent"))
            .and_then(Value::as_object)
            .and_then(|value| value.get("thread_spawn"))
            .and_then(Value::as_object)
            .and_then(|value| value.get("parent_thread_id"))
            .and_then(Value::as_str)
            .is_some()
}
fn root_result(provider: &str, path: &Path, status: &str, message: Option<String>) -> Value {
    json!({"provider":provider,"path":path.to_string_lossy(),"status":status,"message":message})
}
fn list_jsonl(path: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            list_jsonl(&path, out)
        } else if path.extension().and_then(|v| v.to_str()) == Some("jsonl") {
            out.push(path)
        }
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn internal(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("internal-error", error.to_string())
}
async fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    tokio::fs::write(&temporary, bytes).await?;
    tokio::fs::rename(temporary, path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readers_preserve_claude_and_codex_accounting() {
        let claude = r#"{"type":"assistant","timestamp":"2026-09-10T09:00:01.000Z","sessionId":"s","cwd":"/work","message":{"id":"m","model":"claude-opus-5","usage":{"input_tokens":12,"cache_read_input_tokens":9000,"cache_creation_input_tokens":800,"cache_creation":{"ephemeral_1h_input_tokens":300},"output_tokens":640,"output_tokens_details":{"thinking_tokens":120}}}}"#;
        let record = parse_claude_line(claude).unwrap();
        assert_eq!(record.totals.cache_write_1h, 300);
        assert_eq!(record.totals.reasoning, 120);
        let mut state = CodexState::default();
        parse_codex_line(
            r#"{"type":"session_meta","timestamp":"2026-09-10T09:00:00Z","payload":{"id":"thread","cwd":"/work"}}"#,
            &mut state,
        );
        parse_codex_line(
            r#"{"type":"turn_context","timestamp":"2026-09-10T09:00:01Z","payload":{"model":"gpt-5"}}"#,
            &mut state,
        );
        let record=parse_codex_line(r#"{"type":"event_msg","timestamp":"2026-09-10T09:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":800,"cache_write_input_tokens":100,"output_tokens":50,"reasoning_output_tokens":20}}}}"#,&mut state).unwrap();
        assert_eq!(record.totals.input, 100);
        assert_eq!(record.totals.reasoning, 20);
    }

    #[test]
    fn index_round_trip_is_typescript_compatible_shape() {
        let record = UsageRecord {
            provider: "claude".into(),
            timestamp_ms: 1,
            model: "m".into(),
            session_id: "s".into(),
            cwd: "/w".into(),
            totals: Totals {
                calls: 1,
                input: 2,
                ..Totals::default()
            },
            dedupe_key: Some("d".into()),
        };
        let mut index = BTreeMap::new();
        index.insert(
            "/a".into(),
            IndexedFile {
                provider: "claude".into(),
                size: 4,
                mtime_ms: 5.0,
                offset: 4,
                records: vec![record],
                tail: vec![],
                codex: None,
            },
        );
        let encoded = encode_index(&index);
        let decoded = decode_index(&encoded);
        assert_eq!(decoded["/a"].records[0].totals.input, 2);
    }

    #[test]
    fn reader_oracle_matches_typescript() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/usage-oracle.json"
        )))
        .unwrap();
        for case in fixture["claude"].as_array().unwrap() {
            let actual = case["line"]
                .as_str()
                .and_then(parse_claude_line)
                .map(|record| serde_json::to_value(record).unwrap())
                .unwrap_or(Value::Null);
            assert_eq!(actual, case["result"], "Claude line: {}", case["line"]);
        }
        for sequence in fixture["codex"].as_array().unwrap() {
            let mut state = CodexState::default();
            for step in sequence["steps"].as_array().unwrap() {
                let actual = parse_codex_line(step["line"].as_str().unwrap(), &mut state)
                    .map(|record| serde_json::to_value(record).unwrap())
                    .unwrap_or(Value::Null);
                assert_eq!(actual, step["result"], "sequence {}", sequence["name"]);
                assert_eq!(
                    serde_json::to_value(&state).unwrap(),
                    step["state"],
                    "state in sequence {}",
                    sequence["name"]
                );
            }
        }
    }

    #[test]
    fn pricing_and_limit_math_oracle_matches_typescript() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/usage-math-oracle.json"
        )))
        .unwrap();
        let table = parse_price_table(&fixture["prices"]["document"]);
        for case in fixture["prices"]["lookups"].as_array().unwrap() {
            let (price, basis, priced_as) = lookup_price(&table, case["model"].as_str().unwrap());
            assert_eq!(basis, case["expected"]["basis"].as_str().unwrap());
            assert_eq!(priced_as.as_deref(), case["expected"]["pricedAs"].as_str());
            match (price, case["expected"]["price"].as_object()) {
                (None, None) => {}
                (Some(price), Some(expected)) => {
                    let actual = serde_json::to_value(price).unwrap();
                    for name in ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"] {
                        assert_eq!(actual[name].as_f64(), expected[name].as_f64());
                    }
                }
                _ => panic!("price mismatch for {}", case["model"]),
            }
        }
        for case in fixture["prices"]["costs"].as_array().unwrap() {
            let totals: Totals = serde_json::from_value(case["totals"].clone()).unwrap();
            let price: ModelPrice = serde_json::from_value(case["price"].clone()).unwrap();
            assert_eq!(cost_of(&totals, &price), case["cost"].as_f64().unwrap());
            assert_eq!(
                totals.cache_read as f64 * (price.input - price.cache_read),
                case["savings"].as_f64().unwrap()
            );
        }
        for case in fixture["limits"]["claude"].as_array().unwrap() {
            assert_value_eq(&read_claude_usage(&case["input"]), &case["expected"]);
        }
        for case in fixture["limits"]["events"].as_array().unwrap() {
            assert_value_eq(&read_claude_event(&case["input"]), &case["expected"]);
        }
        for case in fixture["limits"]["codex"].as_array().unwrap() {
            assert_value_eq(&read_codex_limits(&case["input"]), &case["expected"]);
        }
        for case in fixture["limits"]["durations"].as_array().unwrap() {
            assert_eq!(
                kind_of_duration(case["input"].as_f64()),
                case["expected"].as_str().unwrap()
            );
        }
        for case in fixture["limits"]["merges"].as_array().unwrap() {
            assert_value_eq(
                &Value::Array(merge_windows(
                    case["known"].as_array().unwrap(),
                    case["updates"].as_array().unwrap(),
                )),
                &case["expected"],
            );
        }
        let prices = PriceBook {
            table,
            allow_fetch: false,
            source: "snapshot",
            fetched_at: None,
            loaded_from_disk: true,
        };
        let records: Vec<UsageRecord> = serde_json::from_value(fixture["records"].clone()).unwrap();
        for case in fixture["aggregations"].as_array().unwrap() {
            let actual = aggregate(&records, &case["payload"], &prices, &[]).unwrap();
            assert_value_eq(&actual["buckets"], &case["expected"]["buckets"]);
            assert_value_eq(&actual["models"], &case["expected"]["models"]);
            assert_value_eq(&actual["projects"], &case["expected"]["projects"]);
            assert_value_eq(&actual["sessions"], &case["expected"]["sessions"]);
        }
    }

    #[tokio::test]
    async fn scanner_lifecycle_matches_typescript_records() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/usage-scan-oracle.json"
        )))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().join("home");
        let claude = directory.path().join("claude");
        let codex = directory.path().join("codex");
        tokio::fs::create_dir_all(&home).await.unwrap();
        tokio::fs::create_dir_all(&claude).await.unwrap();
        tokio::fs::create_dir_all(&codex).await.unwrap();
        let roots = vec![
            ("claude".to_owned(), claude.clone()),
            ("codex".to_owned(), codex.clone()),
        ];
        let mut service =
            UsageService::new_with_roots(home.clone(), EventBus::default(), false, roots.clone());
        for step in fixture["steps"].as_array().unwrap() {
            for action in step["actions"].as_array().unwrap() {
                let kind = action["kind"].as_str().unwrap();
                if kind == "restart" {
                    service = UsageService::new_with_roots(
                        home.clone(),
                        EventBus::default(),
                        false,
                        roots.clone(),
                    );
                    continue;
                }
                let path = directory.path().join(action["path"].as_str().unwrap());
                match kind {
                    "write" => tokio::fs::write(&path, action["text"].as_str().unwrap())
                        .await
                        .unwrap(),
                    "append" => {
                        use tokio::io::AsyncWriteExt;
                        let mut file = tokio::fs::OpenOptions::new()
                            .append(true)
                            .open(&path)
                            .await
                            .unwrap();
                        file.write_all(action["text"].as_str().unwrap().as_bytes())
                            .await
                            .unwrap();
                    }
                    "delete" => {
                        if path.is_dir() {
                            tokio::fs::remove_dir_all(path).await.unwrap();
                        } else {
                            tokio::fs::remove_file(path).await.unwrap();
                        }
                    }
                    _ => panic!("unknown scanner action {kind}"),
                }
            }
            service.scan().await.unwrap();
            let inner = service.inner.lock().await;
            assert_eq!(
                inner.report.files,
                step["expected"]["files"].as_u64().unwrap() as usize,
                "{}",
                step["name"]
            );
            assert_eq!(
                inner.report.changed_files,
                step["expected"]["changedFiles"].as_u64().unwrap() as usize,
                "{}",
                step["name"]
            );
            let records = serde_json::to_value(inner.records.as_slice()).unwrap();
            if records != step["expected"]["records"] {
                eprintln!(
                    "scanner step {}\nactual {records}\nexpected {}",
                    step["name"], step["expected"]["records"]
                );
            }
            assert_value_eq(&records, &step["expected"]["records"]);
        }
    }

    #[tokio::test]
    async fn scanner_retries_an_equal_size_replacement_during_read() {
        fn line(output: u8) -> String {
            json!({
                "type": "assistant",
                "timestamp": "2026-09-10T09:00:01.000Z",
                "sessionId": "s",
                "cwd": "/work",
                "message": {
                    "id": "m",
                    "model": "claude-opus-5",
                    "usage": {"input_tokens": 1, "output_tokens": output}
                }
            })
            .to_string()
                + "\n"
        }

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("usage.jsonl");
        tokio::fs::write(&path, line(1)).await.unwrap();
        let mut index = BTreeMap::new();
        read_file_into(&mut index, &path, "claude").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        tokio::fs::write(&path, line(2)).await.unwrap();

        let final_line = line(3);
        let changed = read_file_into_with(&mut index, &path, "claude", move |attempt, path| {
            if attempt == 0 {
                let replacement = path.with_extension("replacement");
                std::fs::write(&replacement, &final_line)?;
                std::fs::rename(replacement, path)?;
            }
            Ok(())
        })
        .await
        .unwrap();
        assert!(changed);
        let stored = index.get(&path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(stored.records[0].totals.output, 3);
        assert!(!read_file_into(&mut index, &path, "claude").await.unwrap());
    }

    #[tokio::test]
    async fn live_limit_updates_coalesce_without_losing_windows() {
        let home = tempfile::tempdir().unwrap();
        let service = UsageService::new_with_roots(
            home.path().to_owned(),
            EventBus::default(),
            false,
            Vec::new(),
        );
        service.start_live_updates();
        service.apply_live_limits(json!({
            "kind": "claude",
            "windows": [{ "id": "session", "used": 0.25 }]
        }));
        service.apply_live_limits(json!({
            "kind": "claude",
            "plan": "max",
            "windows": [{ "id": "weekly", "used": 0.5 }]
        }));
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(1);
        loop {
            let published = service.inner.lock().await.limits["claude"]
                .published
                .clone();
            if published["source"] == "event" {
                assert_eq!(published["plan"], "max");
                assert_eq!(published["windows"].as_array().unwrap().len(), 2);
                break;
            }
            assert!(tokio::time::Instant::now() < deadline);
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        service.shutdown().await;
    }

    #[tokio::test]
    async fn failed_probe_keeps_a_newer_live_limit_update() {
        let home = tempfile::tempdir().unwrap();
        let service = UsageService::new_with_roots(
            home.path().to_owned(),
            EventBus::default(),
            false,
            Vec::new(),
        );
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let probe_started = started.clone();
        let probe_release = release.clone();
        let worker = {
            let service = service.clone();
            tokio::spawn(async move {
                service
                    .refresh_limits_with(true, move |kind| {
                        let kind = kind.to_owned();
                        let started = probe_started.clone();
                        let release = probe_release.clone();
                        async move {
                            if kind == "claude" {
                                started.notify_one();
                                release.notified().await;
                            }
                            json!({"unavailable":{"reason":"failed","message":"fixture"}})
                        }
                    })
                    .await;
            })
        };
        started.notified().await;
        apply_live_update(
            &service.inner,
            &service.events,
            json!({
                "kind": "claude",
                "plan": "max",
                "windows": [{"id":"session","used":0.75}]
            }),
        )
        .await;
        release.notify_one();
        worker.await.unwrap();
        let published = service.inner.lock().await.limits["claude"]
            .published
            .clone();
        assert_eq!(published["source"], "event");
        assert_eq!(published["windows"][0]["used"], 0.75);
    }

    #[tokio::test]
    async fn shutdown_releases_idle_live_loop_and_pending_probe() {
        struct DropSignal(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for DropSignal {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }

        let home = tempfile::tempdir().unwrap();
        let service = UsageService::new_with_roots(
            home.path().to_owned(),
            EventBus::default(),
            false,
            Vec::new(),
        );
        service.start_live_updates();
        let started = Arc::new(tokio::sync::Notify::new());
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let probe_started = started.clone();
        let probe_dropped = dropped.clone();
        let worker_service = service.clone();
        let worker = tokio::spawn(async move {
            worker_service
                .refresh_limits_with(true, move |_| {
                    let started = probe_started.clone();
                    let signal = DropSignal(probe_dropped.clone());
                    async move {
                        started.notify_one();
                        let _signal = signal;
                        std::future::pending::<Value>().await
                    }
                })
                .await;
        });
        service.track_task(worker);
        started.notified().await;
        tokio::time::timeout(std::time::Duration::from_millis(250), service.shutdown())
            .await
            .expect("usage shutdown stalled during a provider probe");
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(
            service
                .tasks
                .lock()
                .expect("usage task lock poisoned")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn provider_frames_are_bounded_before_newline() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, reader) = tokio::io::duplex(PROBE_FRAME_MAX_BYTES + 2);
        let writing = tokio::spawn(async move {
            writer
                .write_all(&vec![b'x'; PROBE_FRAME_MAX_BYTES + 1])
                .await
                .unwrap();
        });
        let error = read_probe_frame(&mut tokio::io::BufReader::new(reader))
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        writing.await.unwrap();
    }

    fn assert_value_eq(actual: &Value, expected: &Value) {
        match (actual, expected) {
            (Value::Number(actual), Value::Number(expected)) => {
                assert_eq!(actual.as_f64(), expected.as_f64())
            }
            (Value::Array(actual), Value::Array(expected)) => {
                assert_eq!(actual.len(), expected.len());
                for (actual, expected) in actual.iter().zip(expected) {
                    assert_value_eq(actual, expected);
                }
            }
            (Value::Object(actual), Value::Object(expected)) => {
                assert_eq!(actual.len(), expected.len());
                for (name, expected) in expected {
                    assert_value_eq(&actual[name], expected);
                }
            }
            _ => assert_eq!(actual, expected),
        }
    }
}
