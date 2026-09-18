#[cfg(target_os = "macos")]
mod darwin;
#[cfg(target_os = "linux")]
mod linux;
mod sampler;
mod stuck;
mod tree;

use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, Notify, RwLock},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

use crate::{
    chat::{ChatAlertFact, ChatService},
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
    sessions::{ProcessRoot, SessionAlertFact, SessionsService},
};

use self::{
    sampler::{
        CommandLine, ProcessRate, ProcessSampler, RawProcess, RawSample, machine_cpu, rates,
    },
    stuck::{AgentState, Observation, ObservedGroup, ObservedProcess, StrayProcess, StuckJudge},
};

const ACTIVE_INTERVAL_MS: u64 = 1_000;
const FINE_INTERVAL_MS: u64 = 2_000;
const COARSE_INTERVAL_MS: u64 = 5 * 60_000;
const FINE_POINTS: usize = 300;
const COARSE_POINTS: usize = 288;
const NUDGE_DELAY_MS: u64 = 300;

#[derive(Clone)]
pub struct ProcessesService {
    inner: Arc<Inner>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionWorkFact {
    pub pid: u32,
    pub exited: bool,
    pub agent_live: bool,
    pub agent_status: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatWorkFact {
    pub active_turn: bool,
}

struct Inner {
    events: EventBus,
    sampler: Option<Arc<dyn ProcessSampler>>,
    state: Mutex<State>,
    sample_lock: Mutex<()>,
    roots: RwLock<Vec<ProcessRoot>>,
    alert_sources: RwLock<Option<AlertSources>>,
    nudge: Notify,
    cancel: CancellationToken,
    task: Mutex<Option<JoinHandle<()>>>,
    daemon_pid: u32,
    uid: u32,
    agent_gone: Arc<std::sync::RwLock<std::collections::HashSet<String>>>,
}

#[derive(Clone)]
struct AlertSources {
    sessions: SessionsService,
    chats: ChatService,
}

#[derive(Default)]
struct State {
    followers: HashMap<String, Subscription>,
    live: Option<RawSample>,
    latest: Option<Latest>,
    fine: Vec<Value>,
    coarse: Vec<Value>,
    fine_previous: Option<RawSample>,
    coarse_previous: Option<RawSample>,
    alerts: Vec<Value>,
    judge: StuckJudge,
    command_lines: HashMap<(u32, u64), Option<CommandLine>>,
}

#[derive(Clone)]
struct Subscription {
    scope: String,
    sort: String,
}

struct Latest {
    sample: RawSample,
    rates: HashMap<(u32, u64), ProcessRate>,
    machine: Value,
}

#[derive(Deserialize)]
struct SubscribePayload {
    scope: String,
    sort: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalPayload {
    pid: u32,
    start_time: u64,
    signal: String,
}

#[derive(Deserialize)]
struct DismissPayload {
    id: String,
}

impl ProcessesService {
    pub async fn new(home: PathBuf, events: EventBus) -> anyhow::Result<Self> {
        Self::new_with_sampler(events, sampler::create(&home), StuckJudge::default(), true).await
    }

    async fn new_with_sampler(
        events: EventBus,
        sampler: Option<Arc<dyn ProcessSampler>>,
        judge: StuckJudge,
        start: bool,
    ) -> anyhow::Result<Self> {
        let state = State {
            judge,
            ..State::default()
        };
        let inner = Arc::new(Inner {
            events,
            sampler,
            state: Mutex::new(state),
            sample_lock: Mutex::new(()),
            roots: RwLock::new(Vec::new()),
            alert_sources: RwLock::new(None),
            nudge: Notify::new(),
            cancel: CancellationToken::new(),
            task: Mutex::new(None),
            daemon_pid: std::process::id(),
            uid: current_uid(),
            agent_gone: Arc::new(std::sync::RwLock::new(std::collections::HashSet::new())),
        });
        let service = Self { inner };
        if start {
            service.start().await;
        }
        Ok(service)
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        let result = match method {
            "processes.subscribe" => self.subscribe(payload, &context.client_id).await,
            "processes.unsubscribe" => {
                self.inner
                    .state
                    .lock()
                    .await
                    .followers
                    .remove(&context.client_id);
                self.inner.nudge.notify_one();
                Ok(json!({}))
            }
            "processes.signal" => self.signal(payload).await,
            "processes.listAlerts" => Ok(json!({ "alerts": self.inner.state.lock().await.alerts })),
            "processes.dismiss" => self.dismiss(payload).await,
            _ => return None,
        };
        Some(result)
    }

    pub async fn detach(&self, client_id: &str) {
        self.inner.state.lock().await.followers.remove(client_id);
        self.inner.nudge.notify_one();
    }

    pub async fn shutdown(&self) {
        self.inner.cancel.cancel();
        if let Some(task) = self.inner.task.lock().await.take() {
            let _ = task.await;
        }
    }

    pub async fn set_session_roots(&self, roots: Vec<ProcessRoot>) {
        *self.inner.roots.write().await = roots;
        self.inner.nudge.notify_one();
    }

    pub async fn install_alert_sources(&self, sessions: SessionsService, chats: ChatService) {
        *self.inner.alert_sources.write().await = Some(AlertSources { sessions, chats });
        self.inner.nudge.notify_one();
    }

    pub fn nudge(&self) {
        self.inner.nudge.notify_one();
    }

    pub fn nudge_callback(&self) -> Arc<dyn Fn() + Send + Sync> {
        let inner = Arc::downgrade(&self.inner);
        Arc::new(move || {
            if let Some(inner) = inner.upgrade() {
                inner.nudge.notify_one();
            }
        })
    }

    pub fn is_agent_gone(&self, session_id: &str) -> bool {
        self.inner
            .agent_gone
            .read()
            .expect("agent-gone lock poisoned")
            .contains(session_id)
    }

    pub fn agent_gone_callback(&self) -> Arc<dyn Fn(&str) -> bool + Send + Sync> {
        let cache = self.inner.agent_gone.clone();
        Arc::new(move |session_id| {
            cache
                .read()
                .expect("agent-gone lock poisoned")
                .contains(session_id)
        })
    }

    pub async fn machine_work(
        &self,
        sessions: &[SessionWorkFact],
        chats: &[ChatWorkFact],
    ) -> (usize, usize) {
        let Some(sampler) = self.inner.sampler.clone() else {
            return work_of(sessions, chats, None);
        };
        let sample = tokio::task::spawn_blocking(move || sampler.sample()).await;
        let Ok(Ok(sample)) = sample else {
            return work_of(sessions, chats, None);
        };
        let parents = sample
            .processes
            .iter()
            .map(|process| process.ppid)
            .collect::<std::collections::HashSet<_>>();
        work_of(
            sessions,
            chats,
            Some(&|pid| usize::from(parents.contains(&pid))),
        )
    }

    async fn subscribe(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: SubscribePayload = parse(payload)?;
        if !matches!(payload.scope.as_str(), "ruimte" | "all")
            || !matches!(payload.sort.as_str(), "cpu" | "memory" | "disk")
        {
            return Err(RpcError::new(
                "invalid-request",
                "Invalid process scope or sort",
            ));
        }
        let (was_idle, latest_missing) = {
            let mut state = self.inner.state.lock().await;
            let was_idle = state.followers.is_empty();
            let latest_missing = state.latest.is_none();
            state.followers.insert(
                client_id.to_owned(),
                Subscription {
                    scope: payload.scope.clone(),
                    sort: payload.sort.clone(),
                },
            );
            (was_idle, latest_missing)
        };
        self.inner.nudge.notify_one();
        if self.inner.sampler.is_none() {
            return Ok(
                json!({ "supported": false, "fineIntervalMs": FINE_INTERVAL_MS, "coarseIntervalMs": COARSE_INTERVAL_MS, "fine": [], "coarse": [], "sample": null }),
            );
        }
        if was_idle || latest_missing {
            self.sample(true).await;
        }
        let roots = self.inner.roots.read().await.clone();
        let state = self.inner.state.lock().await;
        let sample = state.latest.as_ref().map(|latest| {
            sample_event(
                latest,
                &roots,
                self.inner.daemon_pid,
                &payload.scope,
                &payload.sort,
                None,
                None,
                false,
            )
        });
        Ok(json!({
            "supported": true,
            "fineIntervalMs": FINE_INTERVAL_MS,
            "coarseIntervalMs": COARSE_INTERVAL_MS,
            "fine": state.fine,
            "coarse": state.coarse,
            "sample": sample,
        }))
    }

    async fn signal(&self, payload: Value) -> RpcResult {
        let payload: SignalPayload = parse(payload)?;
        let sampler = self.inner.sampler.clone().ok_or_else(|| {
            RpcError::new(
                "processes-unsupported",
                "This machine does not support process monitoring",
            )
        })?;
        if payload.pid <= 1 || payload.pid == self.inner.daemon_pid {
            return Err(RpcError::new(
                "process-refused",
                "Ruimte does not send signals to itself or to system processes",
            ));
        }
        let pid = payload.pid;
        let signal = match payload.signal.as_str() {
            "SIGINT" => libc::SIGINT,
            "SIGTERM" => libc::SIGTERM,
            "SIGKILL" => libc::SIGKILL,
            _ => return Err(RpcError::new("invalid-request", "Invalid process signal")),
        };
        let expected_start = payload.start_time;
        let expected_uid = self.inner.uid;
        let outcome = tokio::task::spawn_blocking(move || {
            let inspected = sampler.inspect(pid).map_err(SignalFailure::Inspect)?;
            let Some((start_time, uid)) = inspected else {
                return Err(SignalFailure::Gone);
            };
            if start_time != expected_start {
                return Err(SignalFailure::Gone);
            }
            if uid != expected_uid {
                return Err(SignalFailure::Foreign);
            }
            send_signal(pid, signal).map_err(|_| SignalFailure::Gone)
        })
        .await
        .map_err(internal)?;
        match outcome {
            Ok(()) => {}
            Err(SignalFailure::Gone) => {
                return Err(RpcError::new("process-gone", "That process has ended"));
            }
            Err(SignalFailure::Foreign) => {
                return Err(RpcError::new(
                    "process-foreign",
                    "That process belongs to another user",
                ));
            }
            Err(SignalFailure::Inspect(error)) => return Err(internal(error)),
        }
        Ok(json!({}))
    }

    async fn dismiss(&self, payload: Value) -> RpcResult {
        let payload: DismissPayload = parse(payload)?;
        let mut state = self.inner.state.lock().await;
        state.judge.dismiss(&payload.id);
        let gone_node = state
            .alerts
            .iter()
            .find(|alert| alert.get("id").and_then(Value::as_str) == Some(&payload.id))
            .filter(|alert| alert.get("kind").and_then(Value::as_str) == Some("agent-gone"))
            .and_then(|alert| alert.get("nodeId"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let present = state
            .alerts
            .iter()
            .any(|alert| alert.get("id").and_then(Value::as_str) == Some(&payload.id));
        state
            .alerts
            .retain(|alert| alert.get("id").and_then(Value::as_str) != Some(&payload.id));
        if let Some(node_id) = gone_node {
            self.inner
                .agent_gone
                .write()
                .expect("agent-gone lock poisoned")
                .remove(&node_id);
        }
        if present {
            self.inner
                .events
                .broadcast("processes.alerts", json!({ "alerts": state.alerts }));
        }
        Ok(json!({}))
    }

    async fn start(&self) {
        let service = self.clone();
        let task = tokio::spawn(async move {
            let mut had_followers = false;
            let mut deadline = tokio::time::Instant::now() + Duration::from_secs(1);
            loop {
                tokio::select! {
                    _ = tokio::time::sleep_until(deadline) => {
                        service.sample(true).await;
                        had_followers = !service.inner.state.lock().await.followers.is_empty();
                        deadline = tokio::time::Instant::now() + service.rhythm_delay().await;
                    }
                    _ = service.inner.nudge.notified() => {
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(NUDGE_DELAY_MS)) => service.sample(false).await,
                            _ = service.inner.cancel.cancelled() => break,
                        }
                        let has_followers = !service.inner.state.lock().await.followers.is_empty();
                        if tokio::time::Instant::now() >= deadline {
                            service.sample(true).await;
                            had_followers = has_followers;
                            deadline = tokio::time::Instant::now() + service.rhythm_delay().await;
                        } else if has_followers != had_followers {
                            had_followers = has_followers;
                            deadline = tokio::time::Instant::now() + service.rhythm_delay().await;
                        }
                    }
                    _ = service.inner.cancel.cancelled() => break,
                }
            }
        });
        *self.inner.task.lock().await = Some(task);
    }

    async fn rhythm_delay(&self) -> Duration {
        let state = self.inner.state.lock().await;
        if !state.followers.is_empty() {
            return Duration::from_millis(ACTIVE_INTERVAL_MS);
        }
        let Some(previous) = state.coarse_previous.as_ref() else {
            return Duration::from_secs(1);
        };
        let elapsed = now_ms().saturating_sub(previous.at);
        Duration::from_millis(COARSE_INTERVAL_MS.saturating_sub(elapsed).max(1_000))
    }

    async fn sample(&self, add_fine: bool) {
        let _sample = self.inner.sample_lock.lock().await;
        let Some(sampler) = self.inner.sampler.clone() else {
            return;
        };
        let sample_sampler = sampler.clone();
        let raw = match tokio::task::spawn_blocking(move || sample_sampler.sample()).await {
            Ok(Ok(sample)) => sample,
            _ => return,
        };
        let sources = self.inner.alert_sources.read().await.clone();
        let (session_facts, chat_facts, context_url) = if let Some(sources) = sources {
            let context_url = sources.sessions.context_url();
            let (sessions, chats) =
                tokio::join!(sources.sessions.alert_facts(), sources.chats.alert_facts());
            (sessions, chats, context_url)
        } else {
            (Vec::new(), Vec::new(), None)
        };
        let existing_lines = self.inner.state.lock().await.command_lines.clone();
        let current_identities = raw
            .processes
            .iter()
            .map(sampler::identity)
            .collect::<std::collections::HashSet<_>>();
        let missing = raw
            .processes
            .iter()
            .filter(|process| {
                process.uid == self.inner.uid
                    && process.start_time != 0
                    && !existing_lines.contains_key(&sampler::identity(process))
            })
            .map(|process| (sampler::identity(process), process.pid))
            .collect::<Vec<_>>();
        let command_sampler = sampler.clone();
        let discovered = tokio::task::spawn_blocking(move || {
            missing
                .into_iter()
                .map(|(identity, pid)| (identity, command_sampler.command_line(pid)))
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();
        let roots = self.inner.roots.read().await.clone();
        let mut state = self.inner.state.lock().await;
        state
            .command_lines
            .retain(|identity, _| current_identities.contains(identity));
        state.command_lines.extend(discovered);
        let reset = state
            .live
            .as_ref()
            .is_some_and(|before| raw.asleep_ms.saturating_sub(before.asleep_ms) > 2_000);
        if reset {
            state.live = None;
            state.coarse_previous = None;
            state.fine.clear();
            state.coarse.clear();
            state.fine_previous = None;
            state.judge.reset();
        }
        let duration_ms = state
            .live
            .as_ref()
            .map(|before| raw.awake_ms.saturating_sub(before.awake_ms));
        let process_rates = rates(state.live.as_ref(), &raw);
        let disk_read = sum_rates(&process_rates, |rate| rate.disk_read);
        let disk_write = sum_rates(&process_rates, |rate| rate.disk_write);
        let machine = json!({
            "cores": raw.machine.cores,
            "cpu": machine_cpu(state.live.as_ref(), &raw),
            "memoryUsed": raw.machine.memory_used,
            "memoryTotal": raw.machine.memory_total,
            "diskRead": disk_read,
            "diskWrite": disk_write,
            "diskFree": raw.machine.disk_free,
            "diskTotal": raw.machine.disk_total,
        });
        let latest = Latest {
            sample: raw.clone(),
            rates: process_rates,
            machine,
        };
        let fine_elapsed = state
            .fine_previous
            .as_ref()
            .map(|previous| raw.awake_ms.saturating_sub(previous.awake_ms));
        let fine = if add_fine
            && !state.followers.is_empty()
            && fine_elapsed.is_none_or(|elapsed| elapsed >= FINE_INTERVAL_MS)
        {
            let point = fine_elapsed
                .filter(|elapsed| *elapsed <= FINE_INTERVAL_MS * 3)
                .map(|_| point(&latest, &roots, self.inner.daemon_pid));
            state.fine_previous = Some(raw.clone());
            if let Some(point) = point.as_ref() {
                state.fine.push(point.clone());
                trim(&mut state.fine, FINE_POINTS);
            }
            point
        } else {
            None
        };
        let coarse = match &state.coarse_previous {
            Some(previous) if raw.at.saturating_sub(previous.at) >= COARSE_INTERVAL_MS => {
                let point = point(&latest, &roots, self.inner.daemon_pid);
                state.coarse.push(point.clone());
                trim(&mut state.coarse, COARSE_POINTS);
                state.coarse_previous = Some(raw.clone());
                Some(point)
            }
            None => {
                state.coarse_previous = Some(raw.clone());
                None
            }
            _ => None,
        };
        let observation = alert_observation(
            &raw,
            &latest.rates,
            duration_ms,
            self.inner.daemon_pid,
            self.inner.uid,
            &session_facts,
            &chat_facts,
            context_url.as_deref(),
            &state.command_lines,
        );
        let alerts = state
            .judge
            .observe(&observation)
            .into_iter()
            .map(|alert| serde_json::to_value(alert).expect("process alert serializes"))
            .collect::<Vec<_>>();
        let alerts_changed = alerts != state.alerts;
        let gone = alerts
            .iter()
            .filter(|alert| alert.get("kind").and_then(Value::as_str) == Some("agent-gone"))
            .filter_map(|alert| {
                alert
                    .get("nodeId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        *self
            .inner
            .agent_gone
            .write()
            .expect("agent-gone lock poisoned") = gone;
        for alert in alerts.iter().filter(|alert| {
            alert.get("kind").and_then(Value::as_str) == Some("probe-hung")
                && !state
                    .alerts
                    .iter()
                    .any(|before| before.get("id") == alert.get("id"))
        }) {
            let pid = alert.get("pid").and_then(Value::as_u64).unwrap_or(0);
            let name = alert
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("process");
            let seconds = alert.get("value").and_then(Value::as_f64).unwrap_or(0.) / 1000.;
            eprintln!("Process {pid} ({name}) started by the daemon has run for {seconds:.0} s");
        }
        state.alerts = alerts;
        state.live = Some(raw);
        state.latest = Some(latest);
        let followers = state.followers.clone();
        let latest = state.latest.as_ref().expect("latest sample was set");
        for (client_id, subscription) in followers {
            let event = sample_event(
                latest,
                &roots,
                self.inner.daemon_pid,
                &subscription.scope,
                &subscription.sort,
                fine.clone(),
                coarse.clone(),
                reset,
            );
            self.inner
                .events
                .send(&client_id, "processes.sample", event);
        }
        if alerts_changed {
            self.inner
                .events
                .broadcast("processes.alerts", json!({ "alerts": state.alerts }));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn alert_observation(
    sample: &RawSample,
    rates: &HashMap<(u32, u64), ProcessRate>,
    duration_ms: Option<u64>,
    daemon_pid: u32,
    uid: u32,
    sessions: &[SessionAlertFact],
    chats: &[ChatAlertFact],
    context_url: Option<&str>,
    command_lines: &HashMap<(u32, u64), Option<CommandLine>>,
) -> Observation {
    let by_pid = sample
        .processes
        .iter()
        .map(|process| (process.pid, process))
        .collect::<HashMap<_, _>>();
    let mut children = HashMap::<u32, Vec<&RawProcess>>::new();
    for process in &sample.processes {
        if process.ppid != process.pid && by_pid.contains_key(&process.ppid) {
            children.entry(process.ppid).or_default().push(process);
        }
    }
    for siblings in children.values_mut() {
        siblings.sort_by_key(|process| process.pid);
    }

    let node_pids = sessions
        .iter()
        .filter(|fact| !fact.exited)
        .map(|fact| fact.pid)
        .chain(
            chats
                .iter()
                .filter(|fact| fact.pid != 0)
                .map(|fact| fact.pid),
        )
        .collect::<std::collections::HashSet<_>>();
    let mut groups = Vec::new();
    for fact in sessions.iter().filter(|fact| !fact.exited) {
        let Some(root) = by_pid.get(&fact.pid) else {
            continue;
        };
        let processes = walk_alert_tree(root, &children, &std::collections::HashSet::new())
            .into_iter()
            .map(|process| observed_process(process, rates, command_lines))
            .collect();
        let agent = fact
            .agent
            .as_ref()
            .filter(|agent| agent.live)
            .map(|agent| AgentState {
                kind: agent.kind.clone(),
                status: agent.status.clone(),
                updated_at: agent.updated_at,
                reports_end: agent.reports_end,
            });
        groups.push(ObservedGroup {
            node_id: fact.id.clone(),
            kind: "terminal".into(),
            agent,
            processes,
        });
    }
    for fact in chats.iter().filter(|fact| fact.pid != 0) {
        let Some(root) = by_pid.get(&fact.pid) else {
            continue;
        };
        let processes = walk_alert_tree(root, &children, &std::collections::HashSet::new())
            .into_iter()
            .map(|process| observed_process(process, rates, command_lines))
            .collect();
        groups.push(ObservedGroup {
            node_id: fact.id.clone(),
            kind: "chat".into(),
            agent: Some(AgentState {
                kind: fact.provider.clone(),
                status: fact.status.clone(),
                updated_at: fact.updated_at,
                reports_end: false,
            }),
            processes,
        });
    }

    let daemon = by_pid
        .get(&daemon_pid)
        .map(|root| walk_alert_tree(root, &children, &node_pids))
        .unwrap_or_default()
        .into_iter()
        .map(|process| observed_process(process, rates, command_lines))
        .collect();
    let live_sessions = sessions
        .iter()
        .filter(|fact| !fact.exited)
        .map(|fact| fact.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let strays = context_url
        .map(|context_url| {
            sample
                .processes
                .iter()
                .filter(|process| {
                    process.ppid == 1 && process.uid == uid && process.start_time != 0
                })
                .filter_map(|process| {
                    let line = command_lines.get(&sampler::identity(process))?.as_ref()?;
                    let session_id = line.env.get("RUIMTE_SESSION_ID")?;
                    (line.env.get("RUIMTE_CONTEXT_URL").map(String::as_str) == Some(context_url)
                        && !live_sessions.contains(session_id.as_str()))
                    .then(|| StrayProcess {
                        process: observed_process(process, rates, command_lines),
                        node_id: session_id.clone(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Observation {
        at: sample.at,
        duration_ms,
        groups,
        daemon_pid,
        daemon,
        alive: sample
            .processes
            .iter()
            .map(|process| (identity_string(process), process.ppid))
            .collect(),
        strays,
    }
}

fn walk_alert_tree<'a>(
    root: &'a RawProcess,
    children: &HashMap<u32, Vec<&'a RawProcess>>,
    excluded: &std::collections::HashSet<u32>,
) -> Vec<&'a RawProcess> {
    fn visit<'a>(
        process: &'a RawProcess,
        children: &HashMap<u32, Vec<&'a RawProcess>>,
        excluded: &std::collections::HashSet<u32>,
        visited: &mut std::collections::HashSet<(u32, u64)>,
        result: &mut Vec<&'a RawProcess>,
    ) {
        if !visited.insert(sampler::identity(process)) {
            return;
        }
        result.push(process);
        for child in children.get(&process.pid).into_iter().flatten() {
            if !excluded.contains(&child.pid) {
                visit(child, children, excluded, visited, result);
            }
        }
    }

    let mut result = Vec::new();
    visit(
        root,
        children,
        excluded,
        &mut std::collections::HashSet::new(),
        &mut result,
    );
    result
}

fn observed_process(
    process: &RawProcess,
    rates: &HashMap<(u32, u64), ProcessRate>,
    command_lines: &HashMap<(u32, u64), Option<CommandLine>>,
) -> ObservedProcess {
    let identity = sampler::identity(process);
    let rate = rates.get(&identity);
    let args = command_lines
        .get(&identity)
        .and_then(Option::as_ref)
        .map(|line| line.args.as_slice())
        .unwrap_or(&[]);
    ObservedProcess {
        identity: identity_string(process),
        pid: process.pid,
        start_time: process.start_time,
        name: process.name.clone(),
        own_family: tree::own_family(process, args),
        readable: process.readable,
        cpu: rate.and_then(|rate| rate.cpu),
        memory: rate
            .and_then(|rate| rate.memory)
            .map(|memory| memory as f64),
        disk: rate.and_then(|rate| match (rate.disk_read, rate.disk_write) {
            (None, None) => None,
            (read, write) => Some(read.unwrap_or(0.) + write.unwrap_or(0.)),
        }),
    }
}

fn identity_string(process: &RawProcess) -> String {
    format!("{}:{}", process.pid, process.start_time)
}

fn work_of(
    sessions: &[SessionWorkFact],
    chats: &[ChatWorkFact],
    children: Option<&dyn Fn(u32) -> usize>,
) -> (usize, usize) {
    let mut terminals = 0;
    let mut agents = 0;
    for session in sessions {
        if session.exited {
            continue;
        }
        if session.agent_live
            && matches!(
                session.agent_status.as_deref(),
                Some("running" | "needs-you")
            )
        {
            agents += 1;
        } else if children.is_none_or(|children| children(session.pid) > 0) {
            terminals += 1;
        }
    }
    agents += chats.iter().filter(|chat| chat.active_turn).count();
    (terminals, agents)
}

#[cfg(test)]
mod sampling_rhythm_tests {
    use super::sampler::MachineCounters;
    use super::*;
    use crate::rpc::ClientAccess;

    fn context(client_id: &str, events: &EventBus) -> RequestContext {
        RequestContext {
            client_id: client_id.into(),
            access: ClientAccess {
                reachability: "loopback".into(),
                session_id: None,
            },
            events: events.clone(),
        }
    }

    fn empty_sample(at: u64) -> RawSample {
        RawSample {
            at,
            awake_ms: at,
            asleep_ms: 0,
            processes: Vec::new(),
            machine: MachineCounters {
                cores: 1,
                cpu_busy: None,
                cpu_total: None,
                memory_used: None,
                memory_total: 1,
                disk_free: None,
                disk_total: None,
            },
        }
    }

    #[tokio::test]
    async fn open_subscription_uses_live_rhythm_and_both_cleanup_paths_restore_idle_rhythm() {
        let events = EventBus::default();
        let service =
            ProcessesService::new_with_sampler(events.clone(), None, StuckJudge::default(), false)
                .await
                .unwrap();
        service.inner.state.lock().await.coarse_previous = Some(empty_sample(now_ms()));

        let idle_delay = service.rhythm_delay().await;
        assert!(idle_delay > Duration::from_secs(4 * 60));

        let panel = context("panel", &events);
        service
            .dispatch(
                "processes.subscribe",
                json!({ "scope": "ruimte", "sort": "cpu" }),
                &panel,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            service.rhythm_delay().await,
            Duration::from_millis(ACTIVE_INTERVAL_MS)
        );

        service
            .dispatch("processes.unsubscribe", json!({}), &panel)
            .await
            .unwrap()
            .unwrap();
        assert!(service.rhythm_delay().await > Duration::from_secs(4 * 60));

        let disconnected = context("disconnected", &events);
        service
            .dispatch(
                "processes.subscribe",
                json!({ "scope": "all", "sort": "memory" }),
                &disconnected,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            service.rhythm_delay().await,
            Duration::from_millis(ACTIVE_INTERVAL_MS)
        );
        service.detach(&disconnected.client_id).await;
        assert!(service.rhythm_delay().await > Duration::from_secs(4 * 60));
    }
}

#[cfg(test)]
mod work_tests {
    use super::*;

    fn shell(pid: u32) -> SessionWorkFact {
        SessionWorkFact {
            pid,
            exited: false,
            agent_live: false,
            agent_status: None,
        }
    }

    #[test]
    fn idle_shell_has_no_work() {
        assert_eq!(work_of(&[shell(10)], &[], Some(&|_| 0)), (0, 0));
    }

    #[test]
    fn foreground_child_counts_as_terminal_work() {
        assert_eq!(
            work_of(
                &[shell(10), shell(20)],
                &[],
                Some(&|pid| usize::from(pid == 10))
            ),
            (1, 0)
        );
    }

    #[test]
    fn live_terminal_agent_turn_counts_as_agent_work() {
        let sessions = [
            SessionWorkFact {
                agent_live: true,
                agent_status: Some("running".into()),
                ..shell(10)
            },
            SessionWorkFact {
                agent_live: true,
                agent_status: Some("needs-you".into()),
                ..shell(20)
            },
        ];
        assert_eq!(work_of(&sessions, &[], Some(&|_| 1)), (0, 2));
    }

    #[test]
    fn agent_between_turns_keeps_terminal_work() {
        let session = SessionWorkFact {
            agent_live: true,
            agent_status: Some("idle".into()),
            ..shell(10)
        };
        assert_eq!(work_of(&[session], &[], Some(&|_| 1)), (1, 0));
    }

    #[test]
    fn stale_agent_is_not_in_turn() {
        let session = SessionWorkFact {
            agent_live: false,
            agent_status: Some("running".into()),
            ..shell(10)
        };
        assert_eq!(work_of(&[session], &[], Some(&|_| 0)), (0, 0));
    }

    #[test]
    fn exited_shell_has_no_work_without_sampler() {
        let session = SessionWorkFact {
            exited: true,
            ..shell(10)
        };
        assert_eq!(work_of(&[session], &[], None), (0, 0));
    }

    #[test]
    fn active_chat_turn_counts_as_agent_work() {
        let chats = [
            ChatWorkFact { active_turn: true },
            ChatWorkFact { active_turn: false },
        ];
        assert_eq!(work_of(&[], &chats, Some(&|_| 0)), (0, 1));
    }

    #[test]
    fn missing_sampler_keeps_live_shell_conservative() {
        assert_eq!(work_of(&[shell(10)], &[], None), (1, 0));
    }
}

#[cfg(test)]
mod alert_observation_tests {
    use super::*;
    use crate::{
        chat::ChatAlertFact, processes::sampler::MachineCounters, sessions::SessionAlertAgent,
    };

    fn process(pid: u32, ppid: u32, name: &str) -> RawProcess {
        RawProcess {
            pid,
            ppid,
            uid: current_uid(),
            start_time: u64::from(pid) * 1_000_000,
            name: name.into(),
            path: None,
            readable: true,
            cpu_ns: Some(0),
            memory: Some(1),
            disk_read: Some(0),
            disk_write: Some(0),
        }
    }

    #[test]
    fn typed_runtime_facts_define_groups_and_strays() {
        let raw = RawSample {
            at: 100_000,
            awake_ms: 100_000,
            asleep_ms: 0,
            processes: vec![
                process(10, 1, "ruimte"),
                process(20, 10, "shell"),
                process(21, 20, "node"),
                process(30, 10, "codex"),
                process(40, 1, "claude"),
            ],
            machine: MachineCounters {
                cores: 1,
                cpu_busy: None,
                cpu_total: None,
                memory_used: None,
                memory_total: 1,
                disk_free: None,
                disk_total: None,
            },
        };
        let rates = raw
            .processes
            .iter()
            .map(|process| {
                (
                    sampler::identity(process),
                    ProcessRate {
                        cpu: Some(1.),
                        memory: Some(1),
                        disk_read: Some(0.),
                        disk_write: Some(0.),
                    },
                )
            })
            .collect();
        let lines = HashMap::from([
            (
                (21, 21_000_000),
                Some(CommandLine {
                    args: vec!["node".into(), "/bin/claude".into()],
                    env: HashMap::new(),
                }),
            ),
            (
                (40, 40_000_000),
                Some(CommandLine {
                    args: vec!["claude".into()],
                    env: HashMap::from([
                        ("RUIMTE_SESSION_ID".into(), "ended".into()),
                        (
                            "RUIMTE_CONTEXT_URL".into(),
                            "http://127.0.0.1/context".into(),
                        ),
                    ]),
                }),
            ),
        ]);
        let sessions = [SessionAlertFact {
            id: "terminal".into(),
            pid: 20,
            exited: false,
            agent: Some(SessionAlertAgent {
                kind: "claude".into(),
                status: "running".into(),
                updated_at: 90_000,
                live: true,
                reports_end: true,
            }),
        }];
        let chats = [ChatAlertFact {
            id: "chat".into(),
            pid: 30,
            provider: "codex".into(),
            status: "idle".into(),
            updated_at: 90_000,
        }];

        let observation = alert_observation(
            &raw,
            &rates,
            Some(2_000),
            10,
            current_uid(),
            &sessions,
            &chats,
            Some("http://127.0.0.1/context"),
            &lines,
        );

        assert_eq!(observation.groups.len(), 2);
        assert_eq!(observation.groups[0].kind, "terminal");
        assert_eq!(
            observation.groups[0].processes[1].own_family.as_deref(),
            Some("claude")
        );
        assert_eq!(observation.groups[1].kind, "chat");
        assert_eq!(observation.daemon.len(), 1);
        assert_eq!(observation.strays[0].node_id, "ended");
    }
}

#[cfg(test)]
mod live_alert_tests {
    use std::sync::Mutex as StdMutex;

    use super::sampler::MachineCounters;
    use super::stuck::StuckThresholds;
    use super::*;
    use crate::{rpc::ClientAccess, sessions::AgentHookResult};

    struct FakeSampler {
        sample: StdMutex<RawSample>,
    }

    impl FakeSampler {
        fn new() -> Self {
            Self {
                sample: StdMutex::new(RawSample {
                    at: now_ms(),
                    awake_ms: 1,
                    asleep_ms: 0,
                    processes: Vec::new(),
                    machine: MachineCounters {
                        cores: 1,
                        cpu_busy: None,
                        cpu_total: None,
                        memory_used: None,
                        memory_total: 1,
                        disk_free: None,
                        disk_total: None,
                    },
                }),
            }
        }

        fn set_process(&self, pid: u32) {
            let mut sample = self.sample.lock().expect("fake sample lock poisoned");
            sample.at = now_ms();
            sample.awake_ms += 1;
            sample.processes = vec![RawProcess {
                pid,
                ppid: std::process::id(),
                uid: current_uid(),
                start_time: sample.at * 1_000,
                name: "sh".into(),
                path: Some("/bin/sh".into()),
                readable: true,
                cpu_ns: Some(0),
                memory: Some(1024),
                disk_read: Some(0),
                disk_write: Some(0),
            }];
        }
    }

    impl ProcessSampler for FakeSampler {
        fn sample(&self) -> anyhow::Result<RawSample> {
            Ok(self
                .sample
                .lock()
                .expect("fake sample lock poisoned")
                .clone())
        }

        fn inspect(&self, pid: u32) -> anyhow::Result<Option<(u64, u32)>> {
            Ok(self
                .sample
                .lock()
                .expect("fake sample lock poisoned")
                .processes
                .iter()
                .find(|process| process.pid == pid)
                .map(|process| (process.start_time, process.uid)))
        }

        fn command_line(&self, pid: u32) -> Option<CommandLine> {
            self.sample
                .lock()
                .expect("fake sample lock poisoned")
                .processes
                .iter()
                .any(|process| process.pid == pid)
                .then(|| CommandLine {
                    args: vec!["/bin/sh".into()],
                    env: HashMap::new(),
                })
        }
    }

    #[tokio::test]
    async fn live_agent_gone_alert_can_be_listed_and_dismissed() {
        let temporary = tempfile::tempdir().unwrap();
        let events = EventBus::default();
        let sessions = SessionsService::new(temporary.path().join("sessions"), events.clone())
            .await
            .unwrap();
        let chats = ChatService::new(temporary.path().join("chats"), events.clone())
            .await
            .unwrap();
        let context = RequestContext {
            client_id: "monitor".into(),
            access: ClientAccess {
                reachability: "loopback".into(),
                session_id: None,
            },
            events: events.clone(),
        };
        sessions
            .dispatch(
                "session.create",
                json!({
                    "sessionId": "terminal",
                    "shell": "/bin/sh",
                    "command": "sleep 30",
                    "cols": 80,
                    "rows": 24,
                }),
                &context,
            )
            .await
            .unwrap()
            .unwrap();
        let token = sessions.hook_token("terminal").await.unwrap();
        assert_eq!(
            sessions
                .apply_hook(
                    "claude",
                    &token,
                    &json!({
                        "session_id": "fixture-agent",
                        "hook_event_name": "UserPromptSubmit",
                    }),
                )
                .await,
            AgentHookResult::Applied
        );

        let root = sessions.process_roots().await.into_iter().next().unwrap();
        let sampler = Arc::new(FakeSampler::new());
        sampler.set_process(root.pid);
        let thresholds = StuckThresholds {
            agent_gone_grace_ms: 0,
            ..StuckThresholds::default()
        };
        let processes = ProcessesService::new_with_sampler(
            events.clone(),
            Some(sampler),
            StuckJudge::new(thresholds),
            false,
        )
        .await
        .unwrap();
        processes.set_session_roots(vec![root]).await;
        processes
            .install_alert_sources(sessions.clone(), chats.clone())
            .await;
        let mut subscription = events.subscribe("monitor");

        processes.sample(true).await;
        let listed = processes
            .dispatch("processes.listAlerts", json!({}), &context)
            .await
            .unwrap()
            .unwrap();
        let alerts = listed["alerts"].as_array().unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0]["kind"], "agent-gone");
        assert_eq!(alerts[0]["nodeId"], "terminal");
        assert!(processes.is_agent_gone("terminal"));
        let event = tokio::time::timeout(Duration::from_secs(1), subscription.recv_value())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event["event"], "processes.alerts");
        assert_eq!(event["payload"]["alerts"][0]["id"], alerts[0]["id"]);

        processes
            .dispatch(
                "processes.dismiss",
                json!({ "id": alerts[0]["id"] }),
                &context,
            )
            .await
            .unwrap()
            .unwrap();
        let listed = processes
            .dispatch("processes.listAlerts", json!({}), &context)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(listed, json!({ "alerts": [] }));
        assert!(!processes.is_agent_gone("terminal"));

        processes.shutdown().await;
        sessions.shutdown().await;
        chats.shutdown().await;
    }
}

#[allow(clippy::too_many_arguments)]
fn sample_event(
    latest: &Latest,
    roots: &[ProcessRoot],
    daemon_pid: u32,
    scope: &str,
    sort: &str,
    fine: Option<Value>,
    coarse: Option<Value>,
    reset: bool,
) -> Value {
    json!({
        "at": latest.sample.at,
        "scope": scope,
        "machine": latest.machine,
        "groups": tree::groups(&latest.sample, &latest.rates, roots, daemon_pid, scope, sort),
        "fine": fine,
        "coarse": coarse,
        "reset": reset,
    })
}

fn point(latest: &Latest, roots: &[ProcessRoot], daemon_pid: u32) -> Value {
    let ruimte_pids = ruimte_identities(&latest.sample, roots, daemon_pid);
    let ruimte_rates = latest
        .rates
        .iter()
        .filter(|(identity, _)| ruimte_pids.contains(identity))
        .map(|(_, rate)| rate)
        .collect::<Vec<_>>();
    let cpu = latest.machine.get("cpu").cloned().unwrap_or(Value::Null);
    let memory = latest
        .machine
        .get("memoryUsed")
        .cloned()
        .unwrap_or(Value::Null);
    let disk_read = latest.machine.get("diskRead").and_then(Value::as_f64);
    let disk_write = latest.machine.get("diskWrite").and_then(Value::as_f64);
    let disk = (disk_read.is_some() || disk_write.is_some())
        .then(|| disk_read.unwrap_or(0.) + disk_write.unwrap_or(0.));
    let memory_ruimte = {
        let values = ruimte_rates
            .iter()
            .filter_map(|rate| rate.memory)
            .collect::<Vec<_>>();
        (!values.is_empty()).then(|| values.into_iter().sum::<u64>())
    };
    json!({
        "at": latest.sample.at,
        "cpu": cpu,
        "cpuRuimte": sum_iter(ruimte_rates.iter().filter_map(|rate| rate.cpu)) .map(|cpu| cpu / latest.sample.machine.cores as f64),
        "memory": memory,
        "memoryRuimte": memory_ruimte,
        "disk": disk,
        "diskRuimte": sum_iter(ruimte_rates.iter().flat_map(|rate| [rate.disk_read, rate.disk_write]).flatten()),
    })
}

fn ruimte_identities(
    sample: &RawSample,
    roots: &[ProcessRoot],
    daemon_pid: u32,
) -> std::collections::HashSet<(u32, u64)> {
    let root_pids = roots
        .iter()
        .filter(|root| !root.exited)
        .map(|root| root.pid)
        .chain(std::iter::once(daemon_pid))
        .collect::<std::collections::HashSet<_>>();
    let mut included = root_pids.clone();
    loop {
        let before = included.len();
        for process in &sample.processes {
            if included.contains(&process.ppid) {
                included.insert(process.pid);
            }
        }
        if included.len() == before {
            break;
        }
    }
    sample
        .processes
        .iter()
        .filter(|process| included.contains(&process.pid))
        .map(sampler::identity)
        .collect()
}

fn sum_rates(
    rates: &HashMap<(u32, u64), ProcessRate>,
    field: fn(&ProcessRate) -> Option<f64>,
) -> Option<f64> {
    sum_iter(rates.values().filter_map(field))
}
fn sum_iter(values: impl Iterator<Item = f64>) -> Option<f64> {
    let values = values.collect::<Vec<_>>();
    (!values.is_empty()).then(|| values.into_iter().sum())
}
fn trim(values: &mut Vec<Value>, limit: usize) {
    let excess = values.len().saturating_sub(limit);
    values.drain(..excess);
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RpcError> {
    serde_json::from_value(payload)
        .map_err(|error| RpcError::new("invalid-request", error.to_string()))
}
fn internal(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("internal", error.to_string())
}

enum SignalFailure {
    Gone,
    Foreign,
    Inspect(anyhow::Error),
}

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe { libc::geteuid() }
}
#[cfg(not(unix))]
fn current_uid() -> u32 {
    u32::MAX
}

#[cfg(unix)]
fn send_signal(pid: u32, signal: i32) -> std::io::Result<()> {
    if unsafe { libc::kill(pid as i32, signal) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}
#[cfg(not(unix))]
fn send_signal(_pid: u32, _signal: i32) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "signals unsupported",
    ))
}
