mod agent_store;
mod hooks;
mod pty;
mod snapshot;
mod terminal;
mod unicode_width;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, RwLock, mpsc, oneshot},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::{
    events::EventBus,
    processes::SessionWorkFact,
    rpc::{RequestContext, RpcError, RpcResult},
    runtime::RuntimeIdentity,
    titles::{ClaudeTitleReader, CodexTitleReader},
};

use self::{
    agent_store::AgentStore,
    pty::{PtyEvent, SpawnOptions, SpawnedPty, WriterCommand},
    snapshot::SnapshotStore,
    terminal::TerminalState,
};

const SNAPSHOT_INTERVAL: Duration = Duration::from_secs(30);
const KILL_ESCALATION: Duration = Duration::from_secs(2);
const TITLE_READ_INTERVAL: Duration = Duration::from_secs(5);
const TITLE_RETRY_INTERVAL: Duration = Duration::from_secs(15);
const TITLE_RETRIES: usize = 6;
type AgentGone = Arc<dyn Fn(&str) -> bool + Send + Sync>;
type ProcessNudge = Arc<dyn Fn() + Send + Sync>;
type RuntimeChangeSink = Arc<dyn Fn(Value, u64) + Send + Sync>;

#[derive(Clone)]
pub struct SessionsService {
    inner: Arc<Inner>,
}

struct Inner {
    events: EventBus,
    sessions: Mutex<HashMap<String, SessionHandle>>,
    creating: std::sync::Mutex<std::collections::HashSet<String>>,
    accepting: AtomicBool,
    snapshots: SnapshotStore,
    agents: AgentStore,
    agent_urls: std::sync::RwLock<(Option<String>, Option<String>)>,
    tokens: std::sync::RwLock<HashMap<String, TokenBinding>>,
    approval_clients: Mutex<HashMap<String, bool>>,
    offline_approvals: std::sync::RwLock<Option<Arc<dyn Fn() -> bool + Send + Sync>>>,
    approvals: Mutex<HashMap<String, PendingApproval>>,
    runtime_change_sink: std::sync::RwLock<Option<RuntimeChangeSink>>,
    process_nudge: std::sync::RwLock<Option<ProcessNudge>>,
    agent_gone: std::sync::RwLock<Option<AgentGone>>,
    claude_titles: ClaudeTitleReader,
    codex_titles: CodexTitleReader,
    title_retry_interval: Duration,
    title_read_at: std::sync::Mutex<HashMap<String, tokio::time::Instant>>,
    title_tasks: Mutex<HashMap<String, JoinHandle<()>>>,
    snapshot_task: Mutex<Option<JoinHandle<()>>>,
}

struct PendingApproval {
    session_id: String,
    request: Value,
    remembers: HashMap<String, Value>,
    settle: oneshot::Sender<Option<Value>>,
}

#[derive(Clone)]
struct TokenBinding {
    session_id: String,
    generation: u64,
}

struct CreationGuard {
    inner: Arc<Inner>,
    session_id: String,
}

impl Drop for CreationGuard {
    fn drop(&mut self) {
        self.inner
            .creating
            .lock()
            .expect("session creation lock poisoned")
            .remove(&self.session_id);
    }
}

struct UnregisteredPty {
    pid: u32,
    armed: bool,
}

impl Drop for UnregisteredPty {
    fn drop(&mut self) {
        if self.armed {
            let _ = pty::signal(self.pid, libc::SIGHUP);
        }
    }
}

#[derive(Clone)]
struct SessionHandle {
    commands: mpsc::Sender<Command>,
    info: Arc<RwLock<SessionInfo>>,
}

#[derive(Clone)]
struct SessionInfo {
    session_id: String,
    cwd: String,
    pid: u32,
    cols: u16,
    rows: u16,
    created_at: u64,
    attached: usize,
    exited: bool,
    exit_code: Option<i32>,
    writer_stopped: bool,
    revision: u64,
    generation: u64,
    agent: Option<Value>,
    launch: Option<AgentLaunch>,
    hook_token: String,
}

enum Command {
    Attach {
        client_id: String,
        size: Option<(u16, u16)>,
        reply: oneshot::Sender<anyhow::Result<AttachResult>>,
    },
    Detach {
        client_id: String,
    },
    Write {
        data: String,
        reply: oneshot::Sender<anyhow::Result<()>>,
    },
    Resize {
        cols: u16,
        rows: u16,
        reply: oneshot::Sender<anyhow::Result<()>>,
    },
    Clear {
        reply: oneshot::Sender<String>,
    },
    Snapshot {
        reply: oneshot::Sender<String>,
    },
    Resync {
        client_id: String,
        reply: oneshot::Sender<bool>,
    },
    PlainText {
        reply: oneshot::Sender<String>,
    },
    Notice {
        text: String,
        reply: oneshot::Sender<bool>,
    },
    BeginShutdown {
        reply: oneshot::Sender<()>,
    },
    Kill,
}

struct AttachResult {
    screen: String,
    cols: u16,
    rows: u16,
    exited: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePayload {
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    command: Option<String>,
    agent: Option<AgentLaunch>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentLaunch {
    kind: String,
    runtime_mode: Option<String>,
    model: Option<String>,
    resume: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachPayload {
    session_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    follow: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetPayload {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritePayload {
    session_id: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizePayload {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalAnswerPayload {
    session_id: String,
    request_id: String,
    choice_id: String,
}

#[derive(Deserialize)]
struct ApprovalPreferencePayload {
    enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessRoot {
    pub id: String,
    pub pid: u32,
    pub exited: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionAlertAgent {
    pub kind: String,
    pub status: String,
    pub updated_at: u64,
    pub live: bool,
    pub reports_end: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionAlertFact {
    pub id: String,
    pub pid: u32,
    pub exited: bool,
    pub agent: Option<SessionAlertAgent>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentHookResult {
    Applied,
    Ignored,
    UnknownToken,
}

impl SessionsService {
    pub async fn new(home: PathBuf, events: EventBus) -> anyhow::Result<Self> {
        Self::new_with_title_readers(
            home,
            events,
            ClaudeTitleReader::new(ClaudeTitleReader::default_path()),
            CodexTitleReader::new(CodexTitleReader::default_path()),
            TITLE_RETRY_INTERVAL,
        )
        .await
    }

    async fn new_with_title_readers(
        home: PathBuf,
        events: EventBus,
        claude_titles: ClaudeTitleReader,
        codex_titles: CodexTitleReader,
        title_retry_interval: Duration,
    ) -> anyhow::Result<Self> {
        let inner = Arc::new(Inner {
            events,
            sessions: Mutex::new(HashMap::new()),
            creating: std::sync::Mutex::new(std::collections::HashSet::new()),
            accepting: AtomicBool::new(true),
            snapshots: SnapshotStore::new(&home),
            agents: AgentStore::new(&home),
            agent_urls: std::sync::RwLock::new((None, None)),
            tokens: std::sync::RwLock::new(HashMap::new()),
            approval_clients: Mutex::new(HashMap::new()),
            offline_approvals: std::sync::RwLock::new(None),
            approvals: Mutex::new(HashMap::new()),
            runtime_change_sink: std::sync::RwLock::new(None),
            process_nudge: std::sync::RwLock::new(None),
            agent_gone: std::sync::RwLock::new(None),
            claude_titles,
            codex_titles,
            title_retry_interval,
            title_read_at: std::sync::Mutex::new(HashMap::new()),
            title_tasks: Mutex::new(HashMap::new()),
            snapshot_task: Mutex::new(None),
        });
        let service = Self { inner };
        service.start_snapshot_task().await;
        Ok(service)
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        let result = match method {
            "session.create" => self.create(payload).await,
            "session.attach" => self.attach(payload, &context.client_id).await,
            "session.detach" => self.detach_one(payload, &context.client_id).await,
            "session.write" => self.write(payload).await,
            "session.resize" => self.resize(payload).await,
            "session.clear" => self.clear(payload).await,
            "session.kill" => self.kill(payload).await,
            "session.list" => Ok(self.list().await),
            "agent.resume" => self.resume_agent(payload).await,
            "agent.answerApproval" => self.answer_approval(payload).await,
            "agent.setApprovals" => {
                self.set_approval_preference(payload, &context.client_id)
                    .await
            }
            _ => return None,
        };
        Some(result)
    }

    pub async fn detach(&self, client_id: &str) {
        self.inner.approval_clients.lock().await.remove(client_id);
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for handle in handles {
            let _ = handle
                .commands
                .send(Command::Detach {
                    client_id: client_id.to_owned(),
                })
                .await;
        }
    }

    pub async fn register_client(&self, client_id: &str) {
        self.inner
            .approval_clients
            .lock()
            .await
            .entry(client_id.to_owned())
            .or_insert(true);
    }

    pub fn install_offline_approvals(&self, available: Arc<dyn Fn() -> bool + Send + Sync>) {
        *self
            .inner
            .offline_approvals
            .write()
            .expect("offline approval callback lock poisoned") = Some(available);
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown().await;
        if let Some(task) = self.inner.snapshot_task.lock().await.take() {
            task.abort();
        }
        self.flush_snapshots().await;
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for handle in handles {
            let _ = handle.commands.send(Command::Kill).await;
        }
        let deadline = tokio::time::Instant::now() + KILL_ESCALATION + Duration::from_secs(1);
        loop {
            let handles = self
                .inner
                .sessions
                .lock()
                .await
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let mut all_exited = true;
            for handle in handles {
                let info = handle.info.read().await;
                all_exited &= info.exited && info.writer_stopped;
            }
            if all_exited || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub async fn begin_shutdown(&self) {
        self.inner.accepting.store(false, Ordering::Release);
        let title_tasks = std::mem::take(&mut *self.inner.title_tasks.lock().await);
        for task in title_tasks.into_values() {
            task.abort();
        }
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for handle in handles {
            let (reply, received) = oneshot::channel();
            if handle
                .commands
                .send(Command::BeginShutdown { reply })
                .await
                .is_ok()
            {
                let _ = received.await;
            }
        }
    }

    pub async fn process_roots(&self) -> Vec<ProcessRoot> {
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut roots = Vec::with_capacity(handles.len());
        for handle in handles {
            let info = handle.info.read().await;
            roots.push(ProcessRoot {
                id: info.session_id.clone(),
                pid: info.pid,
                exited: info.exited,
            });
        }
        roots
    }

    pub async fn work_facts(&self) -> Vec<SessionWorkFact> {
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut facts = Vec::with_capacity(handles.len());
        for handle in handles {
            let info = handle.info.read().await;
            facts.push(SessionWorkFact {
                pid: info.pid,
                exited: info.exited,
                agent_live: info
                    .agent
                    .as_ref()
                    .and_then(|agent| agent.get("live"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                agent_status: info
                    .agent
                    .as_ref()
                    .and_then(|agent| agent.get("status"))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            });
        }
        facts
    }

    pub async fn alert_facts(&self) -> Vec<SessionAlertFact> {
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut facts = Vec::with_capacity(handles.len());
        for handle in handles {
            let info = handle.info.read().await;
            let agent = info.agent.as_ref().and_then(|agent| {
                let kind = agent.get("kind")?.as_str()?.to_owned();
                Some(SessionAlertAgent {
                    reports_end: matches!(kind.as_str(), "claude" | "codex"),
                    kind,
                    status: agent.get("status")?.as_str()?.to_owned(),
                    updated_at: agent.get("updatedAt")?.as_u64()?,
                    live: agent.get("live").and_then(Value::as_bool).unwrap_or(false),
                })
            });
            facts.push(SessionAlertFact {
                id: info.session_id.clone(),
                pid: info.pid,
                exited: info.exited,
                agent,
            });
        }
        facts
    }

    #[cfg(test)]
    pub(crate) async fn hook_token(&self, session_id: &str) -> Option<String> {
        let handle = self.inner.sessions.lock().await.get(session_id).cloned()?;
        Some(handle.info.read().await.hook_token.clone())
    }

    pub fn context_url(&self) -> Option<String> {
        self.inner
            .agent_urls
            .read()
            .expect("agent URL lock poisoned")
            .1
            .clone()
    }

    pub fn set_agent_urls(&self, hook_url: String, context_url: String) {
        *self
            .inner
            .agent_urls
            .write()
            .expect("agent URL lock poisoned") = (Some(hook_url), Some(context_url));
    }

    pub async fn install_agent_hooks(&self) -> anyhow::Result<()> {
        hooks::install_defaults().await
    }

    pub(crate) fn install_runtime_change_sink(&self, sink: Arc<dyn Fn(Value, u64) + Send + Sync>) {
        *self
            .inner
            .runtime_change_sink
            .write()
            .expect("session runtime sink lock poisoned") = Some(sink);
    }

    pub fn install_process_nudge(&self, nudge: Arc<dyn Fn() + Send + Sync>) {
        *self
            .inner
            .process_nudge
            .write()
            .expect("session process nudge lock poisoned") = Some(nudge);
    }

    pub fn install_agent_gone(&self, judge: Arc<dyn Fn(&str) -> bool + Send + Sync>) {
        *self
            .inner
            .agent_gone
            .write()
            .expect("session agent-gone lock poisoned") = Some(judge);
    }

    pub async fn apply_hook(&self, kind: &str, token: &str, body: &Value) -> AgentHookResult {
        if hooks::events(kind).is_none() {
            return AgentHookResult::Ignored;
        }
        let Some(binding) = self
            .inner
            .tokens
            .read()
            .expect("session token lock poisoned")
            .get(token)
            .cloned()
        else {
            return AgentHookResult::UnknownToken;
        };
        let Some(handle) = self
            .inner
            .sessions
            .lock()
            .await
            .get(&binding.session_id)
            .cloned()
        else {
            return AgentHookResult::UnknownToken;
        };
        let Some(outcome) = hooks::normalize(body) else {
            return AgentHookResult::Ignored;
        };
        let (agent, info_value, revision, settle_approvals) = {
            let mut info = handle.info.write().await;
            if info.generation != binding.generation || info.hook_token != token || info.exited {
                return AgentHookResult::UnknownToken;
            }
            let previous_agent = info.agent.as_ref();
            let previous_transcript = previous_agent
                .and_then(|agent| agent.get("transcriptPath"))
                .cloned()
                .unwrap_or(Value::Null);
            let suggested_title = previous_agent
                .filter(|agent| {
                    agent.get("agentSessionId").and_then(Value::as_str)
                        == Some(outcome.agent_session_id.as_str())
                })
                .and_then(|agent| agent.get("suggestedTitle"))
                .cloned();
            let launched_mode = info
                .launch
                .as_ref()
                .and_then(|launch| launch.runtime_mode.as_deref())
                .unwrap_or("supervised");
            let prior_mode = info
                .agent
                .as_ref()
                .and_then(|agent| agent.get("runtimeMode"))
                .and_then(Value::as_str)
                .unwrap_or(launched_mode);
            let runtime_mode =
                hooks::mode_of(kind, outcome.permission_mode.as_deref(), launched_mode)
                    .unwrap_or_else(|| prior_mode.to_owned());
            let agent = outcome.status.map(|status| {
                let mut agent = json!({
                    "kind": kind,
                    "agentSessionId": outcome.agent_session_id,
                    "transcriptPath": outcome.transcript_path.map(Value::String).unwrap_or(previous_transcript),
                    "status": status,
                    "live": true,
                    "updatedAt": now_ms(),
                    "runtimeMode": runtime_mode,
                });
                if let Some(title) = suggested_title {
                    agent["suggestedTitle"] = title;
                }
                agent
            });
            info.agent = agent.clone();
            info.revision = info.revision.wrapping_add(1);
            let settle_approvals = agent.as_ref().is_none_or(|agent| {
                matches!(
                    agent.get("status").and_then(Value::as_str),
                    Some("idle" | "error")
                )
            });
            (agent, info_json(&info), info.revision, settle_approvals)
        };
        match &agent {
            Some(agent) => {
                let _ = self.inner.agents.write(&binding.session_id, agent).await;
            }
            None => {
                let _ = self.inner.agents.delete(&binding.session_id).await;
            }
        }
        self.inner.events.broadcast(
            "session.status",
            json!({ "sessionId": binding.session_id, "agent": agent }),
        );
        if let Some(sink) = self
            .inner
            .runtime_change_sink
            .read()
            .expect("session runtime sink lock poisoned")
            .clone()
        {
            sink(info_value, revision);
        }
        self.refresh_title(&binding.session_id, binding.generation, agent.as_ref())
            .await;
        nudge_processes(&self.inner);
        if settle_approvals {
            self.drop_approvals(&binding.session_id).await;
        }
        AgentHookResult::Applied
    }

    async fn refresh_title(&self, session_id: &str, generation: u64, agent: Option<&Value>) {
        let Some(agent) = agent else {
            self.cancel_title(session_id).await;
            return;
        };
        let kind = agent
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let agent_session_id = agent
            .get("agentSessionId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let transcript = agent
            .get("transcriptPath")
            .and_then(Value::as_str)
            .map(PathBuf::from);
        if agent_session_id.is_empty()
            || (kind == "claude" && transcript.is_none())
            || !matches!(kind, "claude" | "codex")
        {
            self.cancel_title(session_id).await;
            return;
        }
        let running = agent.get("status").and_then(Value::as_str) == Some("running");
        if running && agent.get("suggestedTitle").is_some() {
            return;
        }
        let now = tokio::time::Instant::now();
        if running
            && self
                .inner
                .title_read_at
                .lock()
                .expect("session title read lock poisoned")
                .get(session_id)
                .is_some_and(|last| now.duration_since(*last) < TITLE_READ_INTERVAL)
        {
            return;
        }
        self.inner
            .title_read_at
            .lock()
            .expect("session title read lock poisoned")
            .insert(session_id.to_owned(), now);
        let mut tasks = self.inner.title_tasks.lock().await;
        if let Some(task) = tasks.remove(session_id) {
            task.abort();
        }
        let inner = Arc::downgrade(&self.inner);
        let session_id = session_id.to_owned();
        let kind = kind.to_owned();
        let agent_session_id = agent_session_id.to_owned();
        let key = session_id.clone();
        tasks.insert(
            key,
            tokio::spawn(async move {
                refresh_session_title(
                    inner,
                    session_id,
                    generation,
                    kind,
                    agent_session_id,
                    transcript,
                )
                .await;
            }),
        );
    }

    async fn cancel_title(&self, session_id: &str) {
        if let Some(task) = self.inner.title_tasks.lock().await.remove(session_id) {
            task.abort();
        }
        self.inner
            .title_read_at
            .lock()
            .expect("session title read lock poisoned")
            .remove(session_id);
    }

    pub async fn hold_approval(&self, token: &str, body: &Value) -> Option<Value> {
        let binding = self
            .inner
            .tokens
            .read()
            .expect("session token lock poisoned")
            .get(token)
            .cloned()?;
        let online = self
            .inner
            .approval_clients
            .lock()
            .await
            .values()
            .any(|enabled| *enabled);
        let offline = self
            .inner
            .offline_approvals
            .read()
            .expect("offline approval callback lock poisoned")
            .clone()
            .is_some_and(|available| available());
        if !online && !offline {
            return None;
        }
        let ask = permission_ask(body)?;
        let request_id = Uuid::new_v4().to_string();
        let created_at = now_ms();
        let mut choices = vec![json!({ "id": "allow", "kind": "allow", "label": "Allow once" })];
        let mut remembers = HashMap::new();
        for (index, suggestion) in ask.suggestions.iter().enumerate() {
            if let Some(label) = suggestion_label(suggestion) {
                let id = format!("remember-{index}");
                choices.push(json!({ "id": id, "kind": "remember", "label": label }));
                remembers.insert(id, suggestion.clone());
            }
        }
        choices.push(json!({ "id": "deny", "kind": "deny", "label": "Deny" }));
        let request = json!({
            "requestId": request_id,
            "sessionId": binding.session_id,
            "toolName": ask.tool_name,
            "summary": ask.summary,
            "choices": choices,
            "createdAt": created_at,
            "expiresAt": created_at + 110_000,
        });
        let (settle, receive) = oneshot::channel();
        self.inner.approvals.lock().await.insert(
            request_id.clone(),
            PendingApproval {
                session_id: binding.session_id.clone(),
                request,
                remembers,
                settle,
            },
        );
        self.publish_approvals(&binding.session_id).await;
        let decision = tokio::time::timeout(Duration::from_secs(110), receive)
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
        if self
            .inner
            .approvals
            .lock()
            .await
            .remove(&request_id)
            .is_some()
        {
            self.publish_approvals(&binding.session_id).await;
        }
        decision
    }

    pub async fn plain_text(&self, session_id: &str) -> Result<String, RpcError> {
        let handle = self.require(session_id).await?;
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::PlainText { reply })
            .await
            .map_err(closed)?;
        received.await.map_err(closed)
    }

    pub(crate) async fn runtime_notice(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<bool, RpcError> {
        let Some(handle) = self.inner.sessions.lock().await.get(session_id).cloned() else {
            return Ok(false);
        };
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Notice {
                text: text.to_owned(),
                reply,
            })
            .await
            .map_err(closed)?;
        received.await.map_err(closed)
    }

    pub(crate) async fn runtime_info(&self, session_id: &str) -> Option<(Value, u64)> {
        let handle = self.inner.sessions.lock().await.get(session_id).cloned()?;
        let info = handle.info.read().await;
        Some((info_json(&info), info.revision))
    }

    pub(crate) async fn resolve_bearer(&self, token: &str) -> Option<RuntimeIdentity> {
        let binding = self
            .inner
            .tokens
            .read()
            .expect("session token lock poisoned")
            .get(token)
            .cloned()?;
        let handle = self
            .inner
            .sessions
            .lock()
            .await
            .get(&binding.session_id)
            .cloned()?;
        let info = handle.info.read().await;
        if info.exited || info.generation != binding.generation || info.hook_token != token {
            return None;
        }
        let provider = info
            .agent
            .as_ref()
            .and_then(|agent| agent.get("kind"))
            .and_then(Value::as_str)
            .or_else(|| info.launch.as_ref().map(|launch| launch.kind.as_str()))
            .and_then(|kind| match kind {
                "claude" => Some(crate::runtime::AgentKind::Claude),
                "codex" => Some(crate::runtime::AgentKind::Codex),
                "gemini" => Some(crate::runtime::AgentKind::Gemini),
                "copilot" => Some(crate::runtime::AgentKind::Copilot),
                _ => None,
            });
        let mode = info
            .agent
            .as_ref()
            .and_then(|agent| agent.get("runtimeMode"))
            .and_then(Value::as_str)
            .or_else(|| {
                info.launch
                    .as_ref()
                    .and_then(|launch| launch.runtime_mode.as_deref())
            })
            .and_then(runtime_mode)
            .unwrap_or(crate::runtime::RuntimeMode::Supervised);
        Some(RuntimeIdentity {
            node_id: binding.session_id.clone(),
            target: crate::runtime::RuntimeTarget {
                kind: crate::runtime::RuntimeTargetKind::Terminal,
                id: binding.session_id,
            },
            provider,
            mode,
            generation: binding.generation,
        })
    }

    pub(crate) async fn runtime_stop(&self, session_id: &str) -> RpcResult {
        self.kill(json!({ "sessionId": session_id })).await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn runtime_create_agent(
        &self,
        session_id: String,
        cwd: Option<String>,
        provider: crate::runtime::AgentKind,
        mode: crate::runtime::RuntimeMode,
        resume: Option<String>,
        prompt: Option<String>,
        depth: u32,
    ) -> RpcResult {
        let launch = AgentLaunch {
            kind: match provider {
                crate::runtime::AgentKind::Claude => "claude",
                crate::runtime::AgentKind::Codex => "codex",
                crate::runtime::AgentKind::Gemini => "gemini",
                crate::runtime::AgentKind::Copilot => "copilot",
            }
            .to_owned(),
            runtime_mode: Some(
                match mode {
                    crate::runtime::RuntimeMode::Supervised => "supervised",
                    crate::runtime::RuntimeMode::AutoAcceptEdits => "auto-accept-edits",
                    crate::runtime::RuntimeMode::Auto => "auto",
                    crate::runtime::RuntimeMode::FullAccess => "full-access",
                }
                .to_owned(),
            ),
            model: None,
            resume,
        };
        let note = crate::chat::context::chat_prompt(&crate::chat::ChatLaunchFacts {
            has_context: false,
            depth,
        });
        let command = hooks::terminal_command_with_prompt(&launch, prompt.as_deref(), Some(&note));
        self.create(json!({
            "sessionId": session_id,
            "cwd": cwd,
            "cols": 80,
            "rows": 24,
            "agent": {
                "kind": launch.kind,
                "runtimeMode": launch.runtime_mode,
                "model": launch.model,
                "resume": launch.resume,
            },
            "command": command,
        }))
        .await
    }

    pub async fn screen(&self, session_id: &str) -> Option<String> {
        let handle = self.inner.sessions.lock().await.get(session_id).cloned()?;
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Snapshot { reply })
            .await
            .ok()?;
        received.await.ok()
    }

    pub async fn resync(&self, client_id: &str, session_id: &str) -> bool {
        let Some(handle) = self.inner.sessions.lock().await.get(session_id).cloned() else {
            return false;
        };
        let (reply, received) = oneshot::channel();
        if handle
            .commands
            .send(Command::Resync {
                client_id: client_id.to_owned(),
                reply,
            })
            .await
            .is_err()
        {
            return false;
        }
        received.await.unwrap_or(false)
    }

    async fn create(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("invalid-request", "Missing sessionId"))?
            .to_owned();
        if !self
            .inner
            .creating
            .lock()
            .expect("session creation lock poisoned")
            .insert(session_id.clone())
        {
            return Err(RpcError::new(
                "session-exists",
                format!("Session {session_id} is already being created"),
            ));
        }
        let _guard = CreationGuard {
            inner: self.inner.clone(),
            session_id,
        };
        self.create_inner(payload).await
    }

    async fn create_inner(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: CreatePayload = parse(payload)?;
        if payload.cols == 0 || payload.rows == 0 {
            return Err(RpcError::new(
                "invalid-request",
                "Terminal size must be positive",
            ));
        }
        if payload.agent.as_ref().is_some_and(|agent| {
            !matches!(
                agent.kind.as_str(),
                "claude" | "codex" | "gemini" | "copilot"
            ) || agent.runtime_mode.as_deref().is_some_and(|mode| {
                !matches!(
                    mode,
                    "supervised" | "auto-accept-edits" | "auto" | "full-access"
                )
            })
        }) {
            return Err(RpcError::new(
                "invalid-request",
                "Invalid terminal agent launch",
            ));
        }
        let existing = self
            .inner
            .sessions
            .lock()
            .await
            .get(&payload.session_id)
            .cloned();
        let generation = match &existing {
            Some(existing) => existing.info.read().await.generation.wrapping_add(1),
            None => 1,
        };
        if let Some(existing) = &existing
            && !existing.info.read().await.exited
        {
            return Err(RpcError::new(
                "session-exists",
                format!("Session {} already exists", payload.session_id),
            ));
        }

        let (restored, restored_agent) = if let Some(existing) = existing {
            let agent = existing.info.read().await.agent.clone();
            let (reply, received) = oneshot::channel();
            existing
                .commands
                .send(Command::Snapshot { reply })
                .await
                .map_err(closed)?;
            (Some(received.await.map_err(closed)?), agent)
        } else {
            let screen = self
                .inner
                .snapshots
                .read(&payload.session_id)
                .await
                .map_err(internal)?;
            let mut agent = self
                .inner
                .agents
                .read(&payload.session_id)
                .await
                .map_err(internal)?;
            if let Some(agent) = agent.as_mut() {
                agent["live"] = json!(false);
            }
            (screen, agent)
        };
        let cwd = payload.cwd.map(PathBuf::from).unwrap_or_else(default_home);
        let shell = payload.shell.unwrap_or_else(default_shell);
        let args = default_shell_args(&shell);
        let mut env = std::env::vars().collect::<HashMap<_, _>>();
        for inherited in [
            "RUIMTE_HOOK_URL",
            "RUIMTE_HOOK_TOKEN",
            "RUIMTE_CONTEXT_URL",
            "RUIMTE_CONTEXT_TOKEN",
            "RUIMTE_SESSION_ID",
            "RUIMTE_SERVICE",
        ] {
            env.remove(inherited);
        }
        env.insert("TERM".into(), "xterm-256color".into());
        env.insert("COLORTERM".into(), "truecolor".into());
        env.insert("RUIMTE_SESSION_ID".into(), payload.session_id.clone());
        let hook_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let (hook_url, context_url) = self
            .inner
            .agent_urls
            .read()
            .expect("agent URL lock poisoned")
            .clone();
        if let Some(url) = hook_url {
            env.insert("RUIMTE_HOOK_URL".into(), url);
            env.insert("RUIMTE_HOOK_TOKEN".into(), hook_token.clone());
        }
        if let Some(url) = context_url {
            env.insert("RUIMTE_CONTEXT_URL".into(), url);
            env.insert("RUIMTE_CONTEXT_TOKEN".into(), hook_token.clone());
        }
        let spawn_options = SpawnOptions {
            shell,
            args,
            cwd: cwd.clone(),
            cols: payload.cols,
            rows: payload.rows,
            env,
        };
        let (pty_sender, pty_receiver) = mpsc::channel(64);
        let spawned = tokio::task::spawn_blocking(move || pty::spawn(spawn_options, pty_sender))
            .await
            .map_err(internal)?
            .map_err(|error| RpcError::new("spawn-failed", error.to_string()))?;
        let mut unregistered = UnregisteredPty {
            pid: spawned.pid,
            armed: true,
        };
        if !self.inner.accepting.load(Ordering::Acquire) {
            let pid = spawned.pid;
            let _ = tokio::task::spawn_blocking(move || pty::signal(pid, libc::SIGKILL)).await;
            return Err(shutting_down());
        }
        let has_restored_screen = restored.is_some();
        let handle = self.spawn_actor(
            payload.session_id.clone(),
            cwd,
            payload.cols,
            payload.rows,
            restored,
            spawned,
            pty_receiver,
            Arc::downgrade(&self.inner),
            generation,
            payload.agent.clone(),
            restored_agent,
            hook_token.clone(),
        );
        {
            let mut sessions = self.inner.sessions.lock().await;
            if !self.inner.accepting.load(Ordering::Acquire) {
                drop(sessions);
                let (reply, received) = oneshot::channel();
                let _ = handle.commands.send(Command::BeginShutdown { reply }).await;
                let _ = received.await;
                return Err(shutting_down());
            }
            sessions.insert(payload.session_id.clone(), handle.clone());
        }
        self.inner
            .tokens
            .write()
            .expect("session token lock poisoned")
            .insert(
                hook_token,
                TokenBinding {
                    session_id: payload.session_id.clone(),
                    generation,
                },
            );
        let initial_command = payload.command.or_else(|| {
            (!has_restored_screen).then(|| {
                payload.agent.as_ref().map(|launch| {
                    let note = crate::chat::context::chat_prompt(&crate::chat::ChatLaunchFacts {
                        has_context: false,
                        depth: 0,
                    });
                    hooks::terminal_command_with_prompt(launch, None, Some(&note))
                })
            })?
        });
        if let Some(command) = initial_command {
            let (reply, received) = oneshot::channel();
            let result = async {
                handle
                    .commands
                    .send(Command::Write {
                        data: format!("{command}\n"),
                        reply,
                    })
                    .await
                    .map_err(closed)?;
                received.await.map_err(closed)?.map_err(internal)
            }
            .await;
            if let Err(error) = result {
                self.inner.sessions.lock().await.remove(&payload.session_id);
                self.inner
                    .tokens
                    .write()
                    .expect("session token lock poisoned")
                    .retain(|_, binding| {
                        binding.session_id != payload.session_id || binding.generation != generation
                    });
                let (reply, received) = oneshot::channel();
                let _ = handle.commands.send(Command::BeginShutdown { reply }).await;
                let _ = received.await;
                return Err(error);
            }
        }
        let info = handle.info.read().await.clone();
        unregistered.armed = false;
        self.inner
            .events
            .broadcast("session.list-changed", json!({}));
        Ok(info_json(&info))
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_actor(
        &self,
        session_id: String,
        cwd: PathBuf,
        cols: u16,
        rows: u16,
        restored: Option<String>,
        spawned: SpawnedPty,
        pty_events: mpsc::Receiver<PtyEvent>,
        owner: std::sync::Weak<Inner>,
        generation: u64,
        launch: Option<AgentLaunch>,
        agent: Option<Value>,
        hook_token: String,
    ) -> SessionHandle {
        let (commands, command_receiver) = mpsc::channel(64);
        let info = Arc::new(RwLock::new(SessionInfo {
            session_id: session_id.clone(),
            cwd: cwd.to_string_lossy().into_owned(),
            pid: spawned.pid,
            cols,
            rows,
            created_at: now_ms(),
            attached: 0,
            exited: false,
            exit_code: None,
            writer_stopped: false,
            revision: 0,
            generation,
            agent,
            launch,
            hook_token,
        }));
        tokio::spawn(run_session(
            session_id,
            info.clone(),
            self.inner.events.clone(),
            spawned,
            TerminalState::new(rows, cols, restored.as_deref()),
            command_receiver,
            pty_events,
            owner,
        ));
        SessionHandle { commands, info }
    }

    async fn attach(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: AttachPayload = parse(payload)?;
        let size = if payload.follow == Some(true) {
            None
        } else {
            match (payload.cols, payload.rows) {
                (Some(cols), Some(rows)) if cols > 0 && rows > 0 => Some((cols, rows)),
                _ => {
                    return Err(RpcError::new(
                        "invalid-request",
                        "Supply both cols and rows, or follow the existing terminal size",
                    ));
                }
            }
        };
        let handle = self.require(&payload.session_id).await?;
        self.inner
            .approval_clients
            .lock()
            .await
            .entry(client_id.to_owned())
            .or_insert(true);
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Attach {
                client_id: client_id.to_owned(),
                size,
                reply,
            })
            .await
            .map_err(closed)?;
        let result = received.await.map_err(closed)?.map_err(internal)?;
        Ok(
            json!({ "screen": result.screen, "cols": result.cols, "rows": result.rows, "exited": result.exited }),
        )
    }

    async fn detach_one(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.session_id).await?;
        handle
            .commands
            .send(Command::Detach {
                client_id: client_id.to_owned(),
            })
            .await
            .map_err(closed)?;
        Ok(json!({}))
    }

    async fn write(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: WritePayload = parse(payload)?;
        let handle = self.require(&payload.session_id).await?;
        if handle.info.read().await.exited {
            return Err(RpcError::new(
                "session-exited",
                format!("Session {} has ended", payload.session_id),
            ));
        }
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Write {
                data: payload.data,
                reply,
            })
            .await
            .map_err(closed)?;
        received.await.map_err(closed)?.map_err(internal)?;
        Ok(json!({}))
    }

    async fn resize(&self, payload: Value) -> RpcResult {
        let payload: ResizePayload = parse(payload)?;
        if payload.cols == 0 || payload.rows == 0 {
            return Err(RpcError::new(
                "invalid-request",
                "Terminal size must be positive",
            ));
        }
        let handle = self.require(&payload.session_id).await?;
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Resize {
                cols: payload.cols,
                rows: payload.rows,
                reply,
            })
            .await
            .map_err(closed)?;
        received.await.map_err(closed)?.map_err(internal)?;
        Ok(json!({}))
    }

    async fn clear(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.session_id).await?;
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Clear { reply })
            .await
            .map_err(closed)?;
        let screen = received.await.map_err(closed)?;
        let clients = {
            let info = handle.info.read().await;
            info.attached
        };
        if clients > 0 {
            // The actor sends resync while the clear is ordered against PTY output.
            let _ = screen;
        }
        Ok(json!({}))
    }

    async fn kill(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.session_id).await?;
        self.cancel_title(&payload.session_id).await;
        self.inner
            .snapshots
            .delete(&payload.session_id)
            .await
            .map_err(internal)?;
        self.inner
            .agents
            .delete(&payload.session_id)
            .await
            .map_err(internal)?;
        self.inner
            .tokens
            .write()
            .expect("session token lock poisoned")
            .retain(|_, binding| binding.session_id != payload.session_id);
        self.drop_approvals(&payload.session_id).await;
        if handle.info.read().await.exited {
            self.inner.sessions.lock().await.remove(&payload.session_id);
            self.inner
                .events
                .broadcast("session.list-changed", json!({}));
        } else {
            handle.commands.send(Command::Kill).await.map_err(closed)?;
        }
        Ok(json!({}))
    }

    async fn resume_agent(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.session_id).await?;
        let command = {
            let info = handle.info.read().await;
            if info.exited {
                return Err(RpcError::new(
                    "session-exited",
                    format!("Session {} has ended", payload.session_id),
                ));
            }
            let agent = info.agent.as_ref().ok_or_else(|| {
                RpcError::new(
                    "agent-not-found",
                    format!("Session {} has no agent to resume", payload.session_id),
                )
            })?;
            let reported_gone = self
                .inner
                .agent_gone
                .read()
                .expect("session agent-gone lock poisoned")
                .as_ref()
                .is_some_and(|judge| judge(&payload.session_id));
            if agent.get("live").and_then(Value::as_bool) == Some(true) && !reported_gone {
                return Err(RpcError::new(
                    "agent-live",
                    format!("The agent in {} is still running", payload.session_id),
                ));
            }
            let kind = agent
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("claude");
            let launch = info
                .launch
                .as_ref()
                .filter(|launch| launch.kind == kind)
                .cloned()
                .unwrap_or(AgentLaunch {
                    kind: kind.to_owned(),
                    runtime_mode: Some("supervised".into()),
                    model: None,
                    resume: None,
                });
            hooks::resume_command(
                &launch,
                agent
                    .get("agentSessionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
        };
        let (reply, received) = oneshot::channel();
        handle
            .commands
            .send(Command::Write {
                data: format!("{command}\n"),
                reply,
            })
            .await
            .map_err(closed)?;
        received.await.map_err(closed)?.map_err(internal)?;
        Ok(json!({}))
    }

    async fn answer_approval(&self, payload: Value) -> RpcResult {
        let payload: ApprovalAnswerPayload = parse(payload)?;
        let pending = {
            let mut approvals = self.inner.approvals.lock().await;
            let Some(pending) = approvals.get(&payload.request_id) else {
                return Ok(json!({ "accepted": false }));
            };
            if pending.session_id != payload.session_id
                || !pending.request["choices"]
                    .as_array()
                    .is_some_and(|choices| {
                        choices
                            .iter()
                            .any(|choice| choice["id"] == payload.choice_id)
                    })
            {
                return Ok(json!({ "accepted": false }));
            }
            approvals.remove(&payload.request_id).unwrap()
        };
        let decision = if payload.choice_id == "deny" {
            json!({ "behavior": "deny", "message": "Denied from Ruimte." })
        } else if let Some(suggestion) = pending.remembers.get(&payload.choice_id) {
            json!({ "behavior": "allow", "updatedPermissions": [suggestion] })
        } else {
            json!({ "behavior": "allow" })
        };
        let _ = pending.settle.send(Some(decision));
        self.publish_approvals(&payload.session_id).await;
        if !self
            .inner
            .approvals
            .lock()
            .await
            .values()
            .any(|pending| pending.session_id == payload.session_id)
            && let Ok(handle) = self.require(&payload.session_id).await
        {
            let updated = {
                let mut info = handle.info.write().await;
                let Some(agent) = info.agent.as_mut() else {
                    return Ok(json!({ "accepted": true }));
                };
                if agent.get("status").and_then(Value::as_str) != Some("needs-you") {
                    return Ok(json!({ "accepted": true }));
                }
                agent["status"] = json!("running");
                agent["updatedAt"] = json!(now_ms());
                info.revision = info.revision.wrapping_add(1);
                Some((info.agent.clone().unwrap(), info_json(&info), info.revision))
            };
            if let Some((agent, info_value, revision)) = updated {
                let _ = self.inner.agents.write(&payload.session_id, &agent).await;
                self.inner.events.broadcast(
                    "session.status",
                    json!({ "sessionId": payload.session_id, "agent": agent }),
                );
                if let Some(sink) = self
                    .inner
                    .runtime_change_sink
                    .read()
                    .expect("session runtime sink lock poisoned")
                    .clone()
                {
                    sink(info_value, revision);
                }
                nudge_processes(&self.inner);
            }
        }
        Ok(json!({ "accepted": true }))
    }

    async fn set_approval_preference(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: ApprovalPreferencePayload = parse(payload)?;
        self.inner
            .approval_clients
            .lock()
            .await
            .insert(client_id.to_owned(), payload.enabled);
        Ok(json!({}))
    }

    async fn publish_approvals(&self, session_id: &str) {
        let approvals = self
            .inner
            .approvals
            .lock()
            .await
            .values()
            .filter(|pending| pending.session_id == session_id)
            .map(|pending| pending.request.clone())
            .collect::<Vec<_>>();
        self.inner.events.broadcast(
            "session.approvals",
            json!({ "sessionId": session_id, "approvals": approvals }),
        );
    }

    async fn drop_approvals(&self, session_id: &str) {
        drop_approvals_inner(&self.inner, session_id).await;
    }

    async fn list(&self) -> Value {
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut sessions = Vec::with_capacity(handles.len());
        for handle in handles {
            let info = handle.info.read().await;
            let mut value = info_json(&info);
            let session_id = info.session_id.clone();
            drop(info);
            value["approvals"] = json!(self.approvals_for(&session_id).await);
            sessions.push(value);
        }
        json!({ "sessions": sessions })
    }

    async fn approvals_for(&self, session_id: &str) -> Vec<Value> {
        self.inner
            .approvals
            .lock()
            .await
            .values()
            .filter(|pending| pending.session_id == session_id)
            .map(|pending| pending.request.clone())
            .collect()
    }

    async fn require(&self, session_id: &str) -> Result<SessionHandle, RpcError> {
        self.inner
            .sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| RpcError::new("session-not-found", format!("No session {session_id}")))
    }

    fn require_accepting(&self) -> Result<(), RpcError> {
        self.inner
            .accepting
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(shutting_down)
    }

    async fn start_snapshot_task(&self) {
        let service = self.clone();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(SNAPSHOT_INTERVAL);
            interval.tick().await;
            loop {
                interval.tick().await;
                service.flush_snapshots().await;
            }
        });
        *self.inner.snapshot_task.lock().await = Some(task);
    }

    async fn flush_snapshots(&self) {
        let handles = self
            .inner
            .sessions
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for handle in handles {
            let session_id = handle.info.read().await.session_id.clone();
            let (reply, received) = oneshot::channel();
            if handle
                .commands
                .send(Command::Snapshot { reply })
                .await
                .is_err()
            {
                continue;
            }
            if let Ok(screen) = received.await {
                let _ = self.inner.snapshots.write(&session_id, &screen).await;
            }
        }
    }
}

async fn refresh_session_title(
    owner: std::sync::Weak<Inner>,
    session_id: String,
    generation: u64,
    kind: String,
    agent_session_id: String,
    transcript: Option<PathBuf>,
) {
    for attempt in 0..=TITLE_RETRIES {
        let Some(inner) = owner.upgrade() else {
            return;
        };
        if attempt > 0 {
            tokio::time::sleep(inner.title_retry_interval).await;
        }
        let Some(current) = title_agent(&inner, &session_id, generation, &agent_session_id).await
        else {
            return;
        };
        if attempt > 0
            && (current.get("suggestedTitle").is_some()
                || current.get("live").and_then(Value::as_bool) != Some(true))
        {
            return;
        }
        inner
            .title_read_at
            .lock()
            .expect("session title read lock poisoned")
            .insert(session_id.clone(), tokio::time::Instant::now());
        let title = match kind.as_str() {
            "claude" => {
                inner
                    .claude_titles
                    .for_transcript(transcript.as_deref().expect("Claude title path checked"))
                    .await
            }
            "codex" => inner.codex_titles.for_thread(&agent_session_id).await,
            _ => return,
        };
        if let Some(title) = title {
            publish_session_title(&inner, &session_id, generation, &agent_session_id, title).await;
            return;
        }
        let Some(current) = title_agent(&inner, &session_id, generation, &agent_session_id).await
        else {
            return;
        };
        if current.get("suggestedTitle").is_some()
            || current.get("live").and_then(Value::as_bool) != Some(true)
        {
            return;
        }
    }
}

async fn title_agent(
    inner: &Inner,
    session_id: &str,
    generation: u64,
    agent_session_id: &str,
) -> Option<Value> {
    let handle = inner.sessions.lock().await.get(session_id).cloned()?;
    let info = handle.info.read().await;
    if info.generation != generation || info.exited {
        return None;
    }
    info.agent
        .as_ref()
        .filter(|agent| {
            agent.get("agentSessionId").and_then(Value::as_str) == Some(agent_session_id)
        })
        .cloned()
}

async fn publish_session_title(
    inner: &Inner,
    session_id: &str,
    generation: u64,
    agent_session_id: &str,
    title: String,
) {
    let Some(handle) = inner.sessions.lock().await.get(session_id).cloned() else {
        return;
    };
    let update = {
        let mut info = handle.info.write().await;
        if info.generation != generation || info.exited {
            return;
        }
        let Some(agent) = info.agent.as_mut().filter(|agent| {
            agent.get("agentSessionId").and_then(Value::as_str) == Some(agent_session_id)
        }) else {
            return;
        };
        if agent.get("suggestedTitle").and_then(Value::as_str) == Some(title.as_str()) {
            return;
        }
        agent["suggestedTitle"] = Value::String(title);
        let agent = agent.clone();
        info.revision = info.revision.wrapping_add(1);
        (agent, info_json(&info), info.revision)
    };
    let _ = inner.agents.write(session_id, &update.0).await;
    inner.events.broadcast(
        "session.status",
        json!({ "sessionId": session_id, "agent": update.0 }),
    );
    if let Some(sink) = inner
        .runtime_change_sink
        .read()
        .expect("session runtime sink lock poisoned")
        .clone()
    {
        sink(update.1, update.2);
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_session(
    session_id: String,
    info: Arc<RwLock<SessionInfo>>,
    events: EventBus,
    mut spawned: SpawnedPty,
    mut terminal: TerminalState,
    mut commands: mpsc::Receiver<Command>,
    mut pty_events: mpsc::Receiver<PtyEvent>,
    owner: std::sync::Weak<Inner>,
) {
    let mut exit_code = None;
    let mut reader_closed = false;
    let mut drain_elapsed = false;
    let mut killed = false;
    let mut finalized = false;
    let mut next_write_id = 0u64;
    let mut pending_writes = HashMap::new();
    let kill_cancel = tokio_util::sync::CancellationToken::new();
    let mut pty_events_open = true;
    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { break };
                match command {
                    Command::Attach { client_id, size, reply } => {
                        if let Some((cols, rows)) = size
                            && resize_runtime(&spawned, &mut terminal, &info, cols, rows).await.is_ok()
                        {
                            events.broadcast("session.list-changed", json!({}));
                        }
                        let screen = terminal.attach(client_id);
                        let mut current = info.write().await;
                        current.attached = terminal.client_count();
                        current.revision = current.revision.wrapping_add(1);
                        let result = AttachResult { screen, cols: current.cols, rows: current.rows, exited: current.exited };
                        let _ = reply.send(Ok(result));
                        events.broadcast("session.list-changed", json!({}));
                    }
                    Command::Detach { client_id } => {
                        if terminal.detach(&client_id) {
                            let mut current = info.write().await;
                            current.attached = terminal.client_count();
                            current.revision = current.revision.wrapping_add(1);
                            events.broadcast("session.list-changed", json!({}));
                        }
                    }
                    Command::Write { data, reply } => {
                        next_write_id = next_write_id.wrapping_add(1);
                        let command = WriterCommand { id: Some(next_write_id), data: data.into_bytes() };
                        match spawned.writer.as_ref().map(|writer| writer.try_send(command)) {
                            None => { let _ = reply.send(Err(anyhow::anyhow!("PTY writer stopped"))); }
                            Some(Ok(())) => { pending_writes.insert(next_write_id, reply); }
                            Some(Err(error)) => { let _ = reply.send(Err(anyhow::anyhow!("PTY write queue unavailable: {error}"))); }
                        }
                    }
                    Command::Resize { cols, rows, reply } => {
                        let result = resize_runtime(&spawned, &mut terminal, &info, cols, rows).await;
                        if result.is_ok() {
                            events.broadcast("session.list-changed", json!({}));
                        }
                        let _ = reply.send(result);
                    }
                    Command::Clear { reply } => {
                        let screen = terminal.clear();
                        let mut current = info.write().await;
                        current.revision = current.revision.wrapping_add(1);
                        drop(current);
                        for client_id in terminal.clients() {
                            events.send(client_id, "session.resync", json!({ "sessionId": session_id, "screen": screen }));
                        }
                        let _ = reply.send(screen);
                    }
                    Command::Snapshot { reply } => { let _ = reply.send(terminal.serialize()); }
                    Command::Resync { client_id, reply } => {
                        let screen = terminal.serialize();
                        let queued = events.complete_terminal_resync(&client_id, &session_id, screen);
                        let _ = reply.send(queued);
                    }
                    Command::PlainText { reply } => { let _ = reply.send(terminal.plain_text()); }
                    Command::Notice { text, reply } => {
                        if info.read().await.exited {
                            let _ = reply.send(false);
                            continue;
                        }
                        if let Some(output) = terminal.notice(&text) {
                            for client_id in terminal.clients() {
                                events.send_terminal(client_id, json!({ "sessionId": session_id, "data": output }));
                            }
                        }
                        let mut current = info.write().await;
                        current.revision = current.revision.wrapping_add(1);
                        let _ = reply.send(true);
                    }
                    Command::BeginShutdown { reply } => {
                        spawned.cancel_writer();
                        for (_, pending) in pending_writes.drain() {
                            let _ = pending.send(Err(anyhow::anyhow!("PTY writer cancelled")));
                        }
                        if !info.read().await.exited {
                            kill_cancel.cancel();
                            let pid = spawned.pid;
                            let _ = tokio::task::spawn_blocking(move || pty::signal(pid, libc::SIGKILL)).await;
                        }
                        let _ = reply.send(());
                    }
                    Command::Kill => {
                        if !killed && !info.read().await.exited {
                            killed = true;
                            spawned.cancel_writer();
                            for (_, pending) in pending_writes.drain() {
                                let _ = pending.send(Err(anyhow::anyhow!("PTY writer cancelled")));
                            }
                            let pid = spawned.pid;
                            tokio::task::spawn_blocking(move || pty::signal(pid, libc::SIGHUP)).await.ok();
                            let cancel = kill_cancel.clone();
                            tokio::spawn(async move {
                                tokio::select! {
                                    _ = tokio::time::sleep(KILL_ESCALATION) => {
                                        let _ = tokio::task::spawn_blocking(move || pty::signal(pid, libc::SIGKILL)).await;
                                    }
                                    _ = cancel.cancelled() => {}
                                }
                            });
                        }
                    }
                }
            }
            event = pty_events.recv(), if pty_events_open => {
                let Some(event) = event else {
                    pty_events_open = false;
                    continue;
                };
                match event {
                    PtyEvent::Output(bytes) => {
                        if finalized {
                            continue;
                        }
                        let (output, responses) = terminal.process(&bytes);
                        let mut current = info.write().await;
                        current.revision = current.revision.wrapping_add(1);
                        drop(current);
                        if let Some(output) = output {
                            for client_id in terminal.clients() {
                                events.send_terminal(client_id, json!({ "sessionId": session_id, "data": output }));
                            }
                        }
                        for response in responses {
                            if let Some(writer) = &spawned.writer {
                                let _ = writer.try_send(WriterCommand { id: None, data: response.into_bytes() });
                            }
                        }
                    }
                    PtyEvent::ReaderClosed => {
                        reader_closed = true;
                        if let Some(output) = terminal.finish_output() {
                            for client_id in terminal.clients() {
                                events.send_terminal(client_id, json!({ "sessionId": session_id, "data": output }));
                            }
                        }
                    }
                    PtyEvent::Exited(code) => {
                        exit_code = Some(code);
                        kill_cancel.cancel();
                        spawned.cancel_writer();
                        for (_, pending) in pending_writes.drain() {
                            let _ = pending.send(Err(anyhow::anyhow!("PTY exited")));
                        }
                    }
                    PtyEvent::DrainElapsed => drain_elapsed = true,
                    PtyEvent::WriterStopped => {
                        let mut current = info.write().await;
                        current.writer_stopped = true;
                        current.revision = current.revision.wrapping_add(1);
                    }
                    PtyEvent::WriteCompleted { id, result } => {
                        if let Some(reply) = pending_writes.remove(&id) {
                            let _ = reply.send(result.map_err(anyhow::Error::msg));
                        }
                    }
                }
                if !finalized && (reader_closed || drain_elapsed) && let Some(code) = exit_code {
                    finalized = true;
                    let clients = terminal.clients().map(str::to_owned).collect::<Vec<_>>();
                    let (agent, generation, info_value, revision) = {
                        let mut current = info.write().await;
                        current.exited = true;
                        current.exit_code = Some(code);
                        if !killed
                            && let Some(agent) = current.agent.as_mut()
                            && agent.get("live").and_then(Value::as_bool) == Some(true)
                        {
                            agent["live"] = json!(false);
                            agent["status"] = json!("exited");
                            agent["updatedAt"] = json!(now_ms());
                        }
                        current.revision = current.revision.wrapping_add(1);
                        (
                            current.agent.clone(),
                            current.generation,
                            info_json(&current),
                            current.revision,
                        )
                    };
                    for client_id in clients {
                        events.send(&client_id, "session.exit", json!({ "sessionId": session_id, "exitCode": code }));
                    }
                    events.broadcast("session.list-changed", json!({}));
                    if let Some(owner) = owner.upgrade() {
                        owner
                            .tokens
                            .write()
                            .expect("session token lock poisoned")
                            .retain(|_, binding| {
                                binding.session_id != session_id
                                    || binding.generation != generation
                            });
                        drop_approvals_inner(&owner, &session_id).await;
                        if killed {
                            owner.sessions.lock().await.remove(&session_id);
                            events.broadcast("session.list-changed", json!({}));
                        } else if let Some(agent) = agent {
                            let _ = owner.agents.write(&session_id, &agent).await;
                            events.broadcast(
                                "session.status",
                                json!({ "sessionId": session_id, "agent": agent }),
                            );
                        }
                        if let Some(sink) = owner
                            .runtime_change_sink
                            .read()
                            .expect("session runtime sink lock poisoned")
                            .clone()
                        {
                            sink(info_value, revision);
                        }
                        nudge_processes(&owner);
                    }
                    spawned.release();
                }
            }
        }
    }
    for (_, reply) in pending_writes {
        let _ = reply.send(Err(anyhow::anyhow!("PTY writer stopped")));
    }
}

async fn drop_approvals_inner(inner: &Inner, session_id: &str) {
    let removed = {
        let mut approvals = inner.approvals.lock().await;
        let ids = approvals
            .iter()
            .filter(|(_, pending)| pending.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        ids.into_iter()
            .filter_map(|id| approvals.remove(&id))
            .collect::<Vec<_>>()
    };
    if removed.is_empty() {
        return;
    }
    for pending in removed {
        let _ = pending.settle.send(None);
    }
    inner.events.broadcast(
        "session.approvals",
        json!({ "sessionId": session_id, "approvals": [] }),
    );
}

fn nudge_processes(inner: &Inner) {
    if let Some(nudge) = inner
        .process_nudge
        .read()
        .expect("session process nudge lock poisoned")
        .clone()
    {
        nudge();
    }
}

async fn resize_runtime(
    spawned: &SpawnedPty,
    terminal: &mut TerminalState,
    info: &RwLock<SessionInfo>,
    cols: u16,
    rows: u16,
) -> anyhow::Result<()> {
    let unchanged = {
        let current = info.read().await;
        current.cols == cols && current.rows == rows
    };
    if unchanged {
        return Ok(());
    }
    if !info.read().await.exited {
        let master = spawned
            .master
            .as_ref()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("PTY has been released"))?;
        tokio::task::spawn_blocking(move || pty::resize(&master, cols, rows)).await??;
    }
    terminal.resize(rows, cols);
    let mut current = info.write().await;
    current.cols = cols;
    current.rows = rows;
    current.revision = current.revision.wrapping_add(1);
    Ok(())
}

fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RpcError> {
    serde_json::from_value(payload)
        .map_err(|error| RpcError::new("invalid-request", error.to_string()))
}

fn internal(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("internal", error.to_string())
}

fn closed(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("session-exited", error.to_string())
}

fn shutting_down() -> RpcError {
    RpcError::new("daemon-shutting-down", "The daemon is shutting down")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn default_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".into()
            } else {
                "/bin/bash".into()
            }
        })
}

fn default_shell_args(shell: &str) -> Vec<String> {
    let name = Path::new(shell)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if matches!(name, "zsh" | "bash" | "fish" | "sh" | "dash" | "ksh") {
        vec!["-l".into()]
    } else {
        Vec::new()
    }
}

fn info_json(info: &SessionInfo) -> Value {
    let mut value = json!({
        "sessionId": info.session_id,
        "cwd": info.cwd,
        "pid": info.pid,
        "cols": info.cols,
        "rows": info.rows,
        "createdAt": info.created_at,
        "attached": info.attached,
        "exited": info.exited,
        "agent": info.agent.clone(),
        "approvals": [],
        "runtimeGeneration": info.generation,
    });
    if let Some(exit_code) = info.exit_code {
        value["exitCode"] = json!(exit_code);
    }
    value
}

fn runtime_mode(mode: &str) -> Option<crate::runtime::RuntimeMode> {
    match mode {
        "supervised" => Some(crate::runtime::RuntimeMode::Supervised),
        "auto-accept-edits" => Some(crate::runtime::RuntimeMode::AutoAcceptEdits),
        "auto" => Some(crate::runtime::RuntimeMode::Auto),
        "full-access" => Some(crate::runtime::RuntimeMode::FullAccess),
        _ => None,
    }
}

struct PermissionAsk {
    tool_name: String,
    summary: String,
    suggestions: Vec<Value>,
}

fn permission_ask(body: &Value) -> Option<PermissionAsk> {
    if body.get("hook_event_name").and_then(Value::as_str) != Some("PermissionRequest") {
        return None;
    }
    let tool_name = body
        .get("tool_name")
        .and_then(Value::as_str)
        .filter(|tool| !tool.is_empty() && *tool != "AskUserQuestion")?
        .to_owned();
    let input = body.get("tool_input").and_then(Value::as_object);
    let summary = input
        .and_then(|input| {
            ["command", "file_path", "path", "url", "pattern"]
                .into_iter()
                .find_map(|key| input.get(key).and_then(Value::as_str))
                .or_else(|| input.values().find_map(Value::as_str))
        })
        .unwrap_or(&tool_name)
        .to_owned();
    let suggestions = body
        .get("permission_suggestions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Some(PermissionAsk {
        tool_name,
        summary,
        suggestions,
    })
}

fn suggestion_label(suggestion: &Value) -> Option<String> {
    let suggestion = suggestion.as_object()?;
    if suggestion.get("type").and_then(Value::as_str) == Some("addRules")
        && suggestion.get("behavior").and_then(Value::as_str) == Some("allow")
    {
        let first = suggestion
            .get("rules")
            .and_then(Value::as_array)?
            .first()?
            .as_object()?;
        let tool = first
            .get("toolName")
            .and_then(Value::as_str)
            .unwrap_or("this tool");
        return Some(match first.get("ruleContent").and_then(Value::as_str) {
            Some(content) if !content.is_empty() => format!("Always allow {content}"),
            _ => format!("Always allow {tool}"),
        });
    }
    if suggestion.get("type").and_then(Value::as_str) == Some("addDirectories") {
        return suggestion
            .get("directories")
            .and_then(Value::as_array)?
            .first()?
            .as_str()
            .filter(|directory| !directory.is_empty())
            .map(|directory| format!("Always allow {directory}"));
    }
    None
}

#[cfg(test)]
mod tests {
    use tokio::fs;

    use super::*;

    #[tokio::test]
    async fn shutdown_gate_refuses_new_sessions() {
        let temporary = tempfile::tempdir().unwrap();
        let service = SessionsService::new(temporary.path().to_owned(), EventBus::default())
            .await
            .unwrap();
        service.begin_shutdown().await;
        let error = service
            .create(json!({
                "sessionId": "late",
                "shell": "/bin/sh",
                "cols": 40,
                "rows": 8,
            }))
            .await
            .unwrap_err();
        assert_eq!(error.code, "daemon-shutting-down");
        service.shutdown().await;
    }

    #[tokio::test]
    async fn hook_titles_follow_the_agent_conversation_and_late_codex_index() {
        let temporary = tempfile::tempdir().unwrap();
        let transcript = temporary.path().join("claude.jsonl");
        let codex_index = temporary.path().join("session_index.jsonl");
        fs::write(
            &transcript,
            "{\"type\":\"ai-title\",\"aiTitle\":\"Tidy the build\"}\n",
        )
        .await
        .unwrap();
        fs::write(&codex_index, "").await.unwrap();
        let service = SessionsService::new_with_title_readers(
            temporary.path().to_owned(),
            EventBus::default(),
            ClaudeTitleReader::new(temporary.path().to_owned()),
            CodexTitleReader::new(codex_index.clone()),
            Duration::from_millis(10),
        )
        .await
        .unwrap();
        service
            .create(json!({
                "sessionId": "terminal",
                "cwd": temporary.path(),
                "shell": "/bin/sh",
                "cols": 80,
                "rows": 24,
            }))
            .await
            .unwrap();
        let handle = service
            .inner
            .sessions
            .lock()
            .await
            .get("terminal")
            .cloned()
            .unwrap();
        let token = handle.info.read().await.hook_token.clone();

        assert_eq!(
            service
                .apply_hook(
                    "claude",
                    &token,
                    &json!({
                        "session_id": "claude-1",
                        "transcript_path": transcript,
                        "hook_event_name": "Stop",
                    }),
                )
                .await,
            AgentHookResult::Applied
        );
        wait_for_title(&handle, "Tidy the build").await;
        service
            .apply_hook(
                "claude",
                &token,
                &json!({
                    "session_id": "claude-1",
                    "transcript_path": transcript,
                    "hook_event_name": "UserPromptSubmit",
                }),
            )
            .await;
        assert_eq!(
            handle.info.read().await.agent.as_ref().unwrap()["suggestedTitle"],
            "Tidy the build"
        );

        fs::write(&transcript, "").await.unwrap();
        service
            .apply_hook(
                "claude",
                &token,
                &json!({
                    "session_id": "claude-2",
                    "transcript_path": transcript,
                    "hook_event_name": "UserPromptSubmit",
                }),
            )
            .await;
        assert!(handle.info.read().await.agent.as_ref().unwrap()["suggestedTitle"].is_null());

        service
            .apply_hook(
                "codex",
                &token,
                &json!({
                    "session_id": "thread-1",
                    "hook_event_name": "Stop",
                }),
            )
            .await;
        tokio::time::sleep(Duration::from_millis(5)).await;
        fs::write(
            &codex_index,
            "{\"id\":\"other\",\"thread_name\":\"Someone else\"}\n{\"id\":\"thread-1\",\"thread_name\":\"Name the thread\"}\n",
        )
        .await
        .unwrap();
        wait_for_title(&handle, "Name the thread").await;
        service.shutdown().await;
    }

    async fn wait_for_title(handle: &SessionHandle, expected: &str) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if handle
                    .info
                    .read()
                    .await
                    .agent
                    .as_ref()
                    .and_then(|agent| agent.get("suggestedTitle"))
                    .and_then(Value::as_str)
                    == Some(expected)
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
}
