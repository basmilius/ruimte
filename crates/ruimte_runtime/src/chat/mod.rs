mod attachments;
mod backend;
mod claude_fork;
mod codex_fork;
pub(crate) mod context;
mod fork;
mod framing;
mod input;
mod process;
mod projector;
mod skills;
mod store;
mod subagents;

use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
};

use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio::{
    sync::{Mutex, RwLock, mpsc, oneshot},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    events::EventBus,
    processes::ChatWorkFact,
    providers::ProvidersService,
    rpc::{RequestContext, RpcError, RpcResult},
    runtime::{AgentKind, RuntimeIdentity, RuntimeMode, RuntimeTarget, RuntimeTargetKind},
    sessions::ProcessRoot,
    titles::{ChatTitleInput, ClaudeTitleReader, TitleCommand, suggest_chat_title},
};

use self::{
    attachments::{AttachmentStore, AttachmentUpload, attachment_image_mime},
    backend::BackendNormalizer,
    claude_fork::CutPoint as ClaudeCutPoint,
    codex_fork::CutPoint as CodexCutPoint,
    process::{ChatProcess, ProcessEvent},
    projector::ThreadProjector,
    store::{ChatStore, StoredChat},
};

pub use self::attachments::{ResolvedAsset, ResolvedAttachment};
pub use self::context::{ChatContextHost, ChatLaunchFacts, ChatTurnContext};
pub use self::fork::{
    ChatForkWorkspaceHost, ForkPlacementRequest, ForkPlacementResult, ForkWorkspaceLocation,
    ForkWorktree, ForkWorktreeRequest,
};

const ACTOR_QUEUE: usize = 256;
const SNAPSHOT_EVENT_INTERVAL: usize = 64;
const SNAPSHOT_LOG_BYTES: usize = 1024 * 1024;
const RESUME_PROMPT: &str = "The machine restarted while you were working on the previous message. Continue where you left off.";
type LimitsSink = Arc<dyn Fn(Value) + Send + Sync>;
type ProcessNudge = Arc<dyn Fn() + Send + Sync>;
type RuntimeChangeSink = Arc<dyn Fn(Value, u64, u64, Option<String>) + Send + Sync>;
type SharedSink<T> = Arc<std::sync::RwLock<Option<T>>>;

#[derive(Clone)]
pub struct ChatService {
    inner: Arc<Inner>,
}

struct Inner {
    home: PathBuf,
    events: EventBus,
    providers: ProvidersService,
    config: ChatConfig,
    chats: Mutex<HashMap<String, ChatHandle>>,
    creating: std::sync::Mutex<HashSet<String>>,
    accepting: Arc<AtomicBool>,
    fork_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatForkWorkspaceHost>>>>,
    bearers: Arc<std::sync::RwLock<HashMap<String, ChatBearer>>>,
    context_url: std::sync::RwLock<Option<String>>,
    context_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatContextHost>>>>,
    limits_sink: std::sync::RwLock<Option<LimitsSink>>,
    process_nudge: SharedSink<ProcessNudge>,
    runtime_change_sink: SharedSink<RuntimeChangeSink>,
    preferences: std::sync::Mutex<ComposerPreferences>,
    attachments: AttachmentStore,
    skills: skills::SkillIndex,
    claude_projects: PathBuf,
    subagent_holds: Mutex<HashMap<String, SubagentHold>>,
}

struct SubagentHold {
    chat_id: String,
    tool_use_id: String,
    clients: HashSet<String>,
    fingerprint: String,
    generation: Uuid,
    cancel: CancellationToken,
    task: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct ComposerPreferences {
    by_client: HashMap<String, HeldPreference>,
    told: u64,
}

struct HeldPreference {
    value: Value,
    told: u64,
}

impl ComposerPreferences {
    fn newest(&self) -> Option<&Value> {
        self.by_client
            .values()
            .max_by_key(|held| {
                (
                    held.value
                        .get("changedAt")
                        .and_then(Value::as_u64)
                        .unwrap_or(0),
                    held.told,
                )
            })
            .map(|held| &held.value)
    }
}

#[derive(Clone)]
struct ChatBearer {
    chat_id: String,
    generation: u64,
}

struct CreationGuard {
    inner: Arc<Inner>,
    chat_id: String,
}

impl Drop for CreationGuard {
    fn drop(&mut self) {
        self.inner
            .creating
            .lock()
            .expect("chat creation lock poisoned")
            .remove(&self.chat_id);
    }
}

#[derive(Clone, Default)]
pub struct ChatConfig {
    commands: HashMap<String, Vec<String>>,
    environment: HashMap<String, String>,
}

impl ChatConfig {
    pub fn with_command(mut self, provider: impl Into<String>, command: Vec<String>) -> Self {
        self.commands.insert(provider.into(), command);
        self
    }

    pub fn with_environment(mut self, environment: HashMap<String, String>) -> Self {
        self.environment = environment;
        self
    }
}

#[derive(Clone)]
struct ChatHandle {
    commands: mpsc::Sender<Command>,
    public: Arc<PublicState>,
}

struct PublicState {
    info: RwLock<Value>,
    pid: AtomicU32,
    updated_at: AtomicU64,
    runtime_change_sink: SharedSink<RuntimeChangeSink>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatAlertFact {
    pub id: String,
    pub pid: u32,
    pub provider: String,
    pub status: String,
    pub updated_at: u64,
}

enum Command {
    Inspect {
        reply: oneshot::Sender<ChatRuntimeState>,
    },
    Attach {
        client_id: String,
        history_limit: Option<usize>,
        since: Option<u64>,
        reply: oneshot::Sender<RpcResult>,
    },
    History {
        cursor: String,
        limit: usize,
        reply: oneshot::Sender<RpcResult>,
    },
    Detach {
        client_id: String,
    },
    Send {
        text: String,
        mentions: Vec<String>,
        skills: Vec<String>,
        attachments: Vec<Value>,
        reply: oneshot::Sender<RpcResult>,
    },
    Unqueue {
        message_id: String,
        reply: oneshot::Sender<RpcResult>,
    },
    SendNow {
        message_id: String,
        reply: oneshot::Sender<RpcResult>,
    },
    Compact {
        reply: oneshot::Sender<RpcResult>,
    },
    RuntimeStart {
        text: String,
        operation_id: Uuid,
        reply: oneshot::Sender<RpcResult>,
    },
    Resume {
        turn_id: String,
        attempt: u32,
        reply: oneshot::Sender<RpcResult>,
    },
    Wake {
        text: String,
        label: String,
        note: Option<String>,
        task_ids: Vec<String>,
        summary_for: Option<String>,
        operation_id: Uuid,
        reply: oneshot::Sender<RpcResult>,
    },
    Configure {
        selection: Option<Value>,
        runtime_mode: Option<String>,
        reply: oneshot::Sender<RpcResult>,
    },
    Approve {
        request_id: String,
        decision: String,
        message: Option<String>,
        reply: oneshot::Sender<RpcResult>,
    },
    Answer {
        request_id: String,
        answers: Map<String, Value>,
        reply: oneshot::Sender<RpcResult>,
    },
    Dismiss {
        item_id: String,
        reply: oneshot::Sender<RpcResult>,
    },
    DeliverNote {
        operation_id: Uuid,
        note_id: String,
        note: String,
        from: String,
        preamble: String,
        reply: oneshot::Sender<RpcResult>,
    },
    QueuePreamble {
        operation_id: Uuid,
        text: String,
        reply: oneshot::Sender<RpcResult>,
    },
    SyncTask {
        task: Value,
        reply: oneshot::Sender<RpcResult>,
    },
    Cancel {
        reply: oneshot::Sender<RpcResult>,
    },
    Clear {
        force: bool,
        reply: oneshot::Sender<RpcResult>,
    },
    Kill {
        reply: oneshot::Sender<RpcResult>,
    },
    RuntimeStop {
        reply: oneshot::Sender<RpcResult>,
    },
    StopSubagent {
        tool_use_id: String,
        reply: oneshot::Sender<RpcResult>,
    },
    NoteSubagentNative {
        tool_use_id: String,
        agent_id: String,
        reply: oneshot::Sender<RpcResult>,
    },
    BeginShutdown {
        reply: oneshot::Sender<()>,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePayload {
    chat_id: String,
    provider: Option<String>,
    cwd: Option<String>,
    resume: Option<String>,
    selection: Option<Value>,
    runtime_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetPayload {
    chat_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachPayload {
    chat_id: String,
    history_limit: Option<usize>,
    since: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryPayload {
    chat_id: String,
    cursor: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendPayload {
    chat_id: String,
    text: String,
    #[serde(default)]
    mentions: Vec<String>,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default)]
    attachments: Vec<AttachmentUpload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuePayload {
    chat_id: String,
    message_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubagentPayload {
    chat_id: String,
    tool_use_id: String,
    cursor: Option<String>,
    limit: Option<usize>,
    watch: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopSubagentPayload {
    chat_id: String,
    tool_use_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreferencesPayload {
    runtime_mode: Option<String>,
    terminal_runtime_mode: Option<String>,
    selections: Option<Map<String, Value>>,
    changed_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigurePayload {
    chat_id: String,
    selection: Option<Value>,
    runtime_mode: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovePayload {
    chat_id: String,
    request_id: String,
    decision: String,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerPayload {
    chat_id: String,
    request_id: String,
    answers: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DismissPayload {
    chat_id: String,
    item_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearPayload {
    chat_id: String,
    force: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForkInfoPayload {
    chat_id: String,
    turn_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnPayload {
    chat_id: String,
    turn_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForkPayload {
    chat_id: String,
    turn_id: String,
    title: Option<String>,
    view_id: Option<String>,
    as_view: Option<bool>,
    worktree: Option<ForkWorktreePayload>,
    files_after_turn: Option<bool>,
    provider: Option<String>,
    selection: Option<Value>,
}

#[derive(Deserialize)]
struct ForkWorktreePayload {
    branch: Option<String>,
}

struct Actor {
    chat_id: String,
    info: Value,
    items: Vec<Value>,
    item_index: HashMap<String, usize>,
    seq: u64,
    reset_seq: u64,
    events_since_snapshot: usize,
    journal_bytes: usize,
    event_base: u64,
    recent_events: Vec<(u64, Value)>,
    viewers: HashSet<String>,
    store: ChatStore,
    events: EventBus,
    public: Arc<PublicState>,
    command: Vec<String>,
    environment: HashMap<String, String>,
    process: Option<ChatProcess>,
    generation: u64,
    process_exit: Option<Option<i32>>,
    stdout_closed: bool,
    pending_codex_text: Option<String>,
    pending_codex_attachments: Vec<Value>,
    pending_codex_compact: bool,
    codex_ready: bool,
    codex_resuming: bool,
    codex_launch_prompt: Option<String>,
    codex_thread_frame: Option<Value>,
    codex_model_cursors: HashSet<String>,
    codex_image_input_supported: Option<bool>,
    codex_context_pending: bool,
    codex_rpc_id: u64,
    pending_resume: Option<PendingResume>,
    accepting: Arc<AtomicBool>,
    backend: BackendNormalizer,
    projector: ThreadProjector,
    bearers: Arc<std::sync::RwLock<HashMap<String, ChatBearer>>>,
    bearer_token: Option<String>,
    last_persist_error: Option<String>,
    preambles: Vec<String>,
    preamble_operations: BTreeSet<String>,
    limits_sink: Option<LimitsSink>,
    fork_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatForkWorkspaceHost>>>>,
    context_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatContextHost>>>>,
    process_nudge: SharedSink<ProcessNudge>,
    claude_projects: PathBuf,
    claude_titles: ClaudeTitleReader,
    title_candidates: Vec<TitleCommand>,
    title_cancel: CancellationToken,
    naming: bool,
}

struct PendingResume {
    turn_id: String,
    attempt: u32,
    reply: oneshot::Sender<RpcResult>,
}

struct DurableStartState {
    info: Value,
    items: Vec<Value>,
    item_index: HashMap<String, usize>,
    preambles: Vec<String>,
    preamble_operations: BTreeSet<String>,
}

pub(crate) struct ChatRuntimeState {
    pub info: Value,
    pub items: Vec<Value>,
    pub seq: u64,
    pub generation: u64,
}

impl ChatService {
    pub async fn new(home: PathBuf, events: EventBus) -> anyhow::Result<Self> {
        Self::new_with_config(home, events, ChatConfig::default()).await
    }

    pub async fn new_with_config(
        home: PathBuf,
        events: EventBus,
        config: ChatConfig,
    ) -> anyhow::Result<Self> {
        let skill_home = config
            .environment
            .get("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
            .unwrap_or_else(|| home.clone());
        let claude_config = config
            .environment
            .get("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from));
        let claude_projects = claude_config
            .clone()
            .unwrap_or_else(|| skill_home.join(".claude"))
            .join("projects");
        Ok(Self {
            inner: Arc::new(Inner {
                home: home.clone(),
                events,
                providers: ProvidersService::new(),
                config,
                chats: Mutex::new(HashMap::new()),
                creating: std::sync::Mutex::new(HashSet::new()),
                accepting: Arc::new(AtomicBool::new(true)),
                fork_host: Arc::new(std::sync::RwLock::new(None)),
                bearers: Arc::new(std::sync::RwLock::new(HashMap::new())),
                context_url: std::sync::RwLock::new(None),
                context_host: Arc::new(std::sync::RwLock::new(None)),
                limits_sink: std::sync::RwLock::new(None),
                process_nudge: Arc::new(std::sync::RwLock::new(None)),
                runtime_change_sink: Arc::new(std::sync::RwLock::new(None)),
                preferences: std::sync::Mutex::new(ComposerPreferences::default()),
                attachments: AttachmentStore::new(&home),
                skills: skills::SkillIndex::new(skill_home, claude_config),
                claude_projects,
                subagent_holds: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        let result = match method {
            "chat.create" => self.create(payload).await,
            "chat.attach" => self.attach(payload, &context.client_id).await,
            "chat.history" => self.history(payload).await,
            "chat.detach" => self.detach_one(payload, &context.client_id).await,
            "chat.send" => self.send(payload).await,
            "chat.unqueue" => self.unqueue(payload).await,
            "chat.sendNow" => self.send_now(payload).await,
            "chat.compact" => self.compact(payload).await,
            "chat.turnDiff" => self.turn_diff(payload).await,
            "chat.configure" => self.configure(payload).await,
            "chat.setPreferences" => self.set_preferences(payload, &context.client_id),
            "chat.approve" => self.approve(payload).await,
            "chat.answer" => self.answer(payload).await,
            "chat.dismiss" => self.dismiss(payload).await,
            "chat.fork" => self.fork(payload).await,
            "chat.forkInfo" => self.fork_info(payload).await,
            "chat.summarize" => self.summarize(payload).await,
            "chat.subagent" => self.subagent(payload, &context.client_id).await,
            "chat.stopSubagent" => self.stop_subagent(payload).await,
            "chat.cancel" => self.cancel(payload).await,
            "chat.clear" => self.clear(payload).await,
            "chat.kill" => self.kill(payload).await,
            "chat.list" => Ok(json!({ "chats": self.list().await })),
            "skills.list" => self.skills(payload).await,
            method if method.starts_with("chat.") => Err(RpcError::new(
                "chat-unsupported",
                format!("{method} is not implemented by the Rust daemon yet"),
            )),
            _ => return None,
        };
        Some(result)
    }

    pub async fn detach(&self, client_id: &str) {
        self.inner
            .preferences
            .lock()
            .expect("chat preferences lock poisoned")
            .by_client
            .remove(client_id);
        self.release_subagent_client(client_id).await;
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for chat in chats {
            let _ = chat
                .commands
                .send(Command::Detach {
                    client_id: client_id.to_owned(),
                })
                .await;
        }
    }

    pub async fn shutdown(&self) {
        self.begin_shutdown().await;
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for chat in chats {
            let (reply, done) = oneshot::channel();
            if chat
                .commands
                .send(Command::Shutdown { reply })
                .await
                .is_ok()
            {
                let _ = done.await;
            }
        }
    }

    pub async fn begin_shutdown(&self) {
        self.inner.accepting.store(false, Ordering::Release);
        self.release_all_subagent_holds().await;
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for chat in chats {
            let (reply, done) = oneshot::channel();
            if chat
                .commands
                .send(Command::BeginShutdown { reply })
                .await
                .is_ok()
            {
                let _ = done.await;
            }
        }
    }

    pub async fn process_roots(&self) -> Vec<ProcessRoot> {
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut roots = Vec::new();
        for chat in chats {
            let pid = chat.public.pid.load(Ordering::Acquire);
            if pid != 0 {
                let info = chat.public.info.read().await;
                roots.push(ProcessRoot {
                    id: info
                        .get("chatId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    pid,
                    exited: false,
                });
            }
        }
        roots
    }

    pub async fn work_facts(&self) -> Vec<ChatWorkFact> {
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut facts = Vec::with_capacity(chats.len());
        for chat in chats {
            let info = chat.public.info.read().await;
            facts.push(ChatWorkFact {
                active_turn: info.get("activeTurnId").is_some_and(|turn| !turn.is_null()),
            });
        }
        facts
    }

    pub async fn alert_facts(&self) -> Vec<ChatAlertFact> {
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut facts = Vec::with_capacity(chats.len());
        for chat in chats {
            let info = chat.public.info.read().await;
            facts.push(ChatAlertFact {
                id: info
                    .get("chatId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                pid: chat.public.pid.load(Ordering::Acquire),
                provider: info
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                status: info
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("idle")
                    .to_owned(),
                updated_at: chat.public.updated_at.load(Ordering::Acquire),
            });
        }
        facts
    }

    pub fn install_fork_host(&self, host: Weak<dyn ChatForkWorkspaceHost>) {
        *self
            .inner
            .fork_host
            .write()
            .expect("chat fork host lock poisoned") = Some(host);
    }

    pub fn install_context_host(&self, host: Weak<dyn ChatContextHost>) {
        *self
            .inner
            .context_host
            .write()
            .expect("chat context host lock poisoned") = Some(host);
    }

    pub fn set_context_url(&self, url: String) {
        *self
            .inner
            .context_url
            .write()
            .expect("chat context URL lock poisoned") = Some(url);
    }

    pub fn install_limits_sink(&self, sink: Arc<dyn Fn(Value) + Send + Sync>) {
        *self
            .inner
            .limits_sink
            .write()
            .expect("chat limits sink lock poisoned") = Some(sink);
    }

    pub fn install_process_nudge(&self, nudge: Arc<dyn Fn() + Send + Sync>) {
        *self
            .inner
            .process_nudge
            .write()
            .expect("chat process nudge lock poisoned") = Some(nudge);
    }

    pub(crate) fn install_runtime_change_sink(
        &self,
        sink: Arc<dyn Fn(Value, u64, u64, Option<String>) + Send + Sync>,
    ) {
        *self
            .inner
            .runtime_change_sink
            .write()
            .expect("chat runtime sink lock poisoned") = Some(sink);
    }

    pub fn terminal_runtime_mode(&self) -> Option<String> {
        self.inner
            .preferences
            .lock()
            .expect("chat preferences lock poisoned")
            .newest()
            .and_then(|value| value.get("terminalRuntimeMode"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    pub(crate) async fn resolve_bearer(&self, token: &str) -> Option<RuntimeIdentity> {
        let bearer = self
            .inner
            .bearers
            .read()
            .expect("chat bearer lock poisoned")
            .get(token)
            .cloned()?;
        let handle = self
            .inner
            .chats
            .lock()
            .await
            .get(&bearer.chat_id)
            .cloned()?;
        if handle.public.pid.load(Ordering::Acquire) == 0 {
            return None;
        }
        let info = handle.public.info.read().await;
        let provider = match info.get("provider").and_then(Value::as_str) {
            Some("claude") => Some(AgentKind::Claude),
            Some("codex") => Some(AgentKind::Codex),
            _ => None,
        };
        let mode = match info.get("runtimeMode").and_then(Value::as_str) {
            Some("auto-accept-edits") => RuntimeMode::AutoAcceptEdits,
            Some("auto") => RuntimeMode::Auto,
            Some("full-access") => RuntimeMode::FullAccess,
            _ => RuntimeMode::Supervised,
        };
        Some(RuntimeIdentity {
            node_id: bearer.chat_id.clone(),
            target: RuntimeTarget {
                kind: RuntimeTargetKind::Chat,
                id: bearer.chat_id,
            },
            provider,
            mode,
            generation: bearer.generation,
        })
    }

    pub(crate) async fn runtime_create(&self, payload: Value) -> RpcResult {
        self.create(payload).await
    }

    pub(crate) async fn runtime_start(
        &self,
        chat_id: &str,
        text: String,
        operation_id: Uuid,
    ) -> RpcResult {
        self.require_accepting()?;
        self.call(chat_id, |reply| Command::RuntimeStart {
            text,
            operation_id,
            reply,
        })
        .await
    }

    pub(crate) async fn runtime_resume(
        &self,
        chat_id: &str,
        turn_id: String,
        attempt: u32,
    ) -> RpcResult {
        self.require_accepting()?;
        self.call(chat_id, |reply| Command::Resume {
            turn_id,
            attempt,
            reply,
        })
        .await
    }

    pub(crate) async fn runtime_read_subagent(
        &self,
        chat_id: &str,
        tool_use_id: &str,
    ) -> Result<Option<Vec<Value>>, RpcError> {
        let mut cursor = None::<String>;
        let mut items = Vec::new();
        loop {
            let result = match self
                .subagent(
                    json!({
                        "chatId": chat_id,
                        "toolUseId": tool_use_id,
                        "cursor": cursor.as_deref(),
                        "limit": 100,
                        "watch": false,
                    }),
                    "",
                )
                .await
            {
                Ok(result) => result,
                Err(error) if error.code == "subagent-not-found" => return Ok(None),
                Err(error) => return Err(error),
            };
            let mut page = result
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            page.append(&mut items);
            items = page;
            let next = result
                .pointer("/history/cursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if next.is_none() || next == cursor {
                return Ok(Some(items));
            }
            cursor = next;
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn runtime_wake(
        &self,
        chat_id: &str,
        text: String,
        label: String,
        note: Option<String>,
        task_ids: Vec<String>,
        summary_for: Option<String>,
        operation_id: Uuid,
    ) -> RpcResult {
        self.require_accepting()?;
        self.ensure_runtime_chat(chat_id).await?;
        self.call(chat_id, |reply| Command::Wake {
            text,
            label,
            note,
            task_ids,
            summary_for,
            operation_id,
            reply,
        })
        .await
    }

    pub(crate) async fn runtime_stop(&self, chat_id: &str) -> RpcResult {
        self.call(chat_id, |reply| Command::RuntimeStop { reply })
            .await
    }

    pub(crate) async fn runtime_note(
        &self,
        chat_id: &str,
        operation_id: Uuid,
        note_id: String,
        note: String,
        from: String,
        preamble: String,
    ) -> RpcResult {
        self.ensure_runtime_chat(chat_id).await?;
        self.call(chat_id, |reply| Command::DeliverNote {
            operation_id,
            note_id,
            note,
            from,
            preamble,
            reply,
        })
        .await
    }

    pub(crate) async fn runtime_preamble(
        &self,
        chat_id: &str,
        operation_id: Uuid,
        text: String,
    ) -> RpcResult {
        self.ensure_runtime_chat(chat_id).await?;
        self.call(chat_id, |reply| Command::QueuePreamble {
            operation_id,
            text,
            reply,
        })
        .await
    }

    pub(crate) async fn runtime_sync_task(
        &self,
        chat_id: &str,
        task: Value,
    ) -> Result<(), RpcError> {
        self.ensure_runtime_chat(chat_id).await?;
        self.call(chat_id, |reply| Command::SyncTask { task, reply })
            .await?;
        Ok(())
    }

    pub(crate) async fn drop_unspoken_fork(&self, chat_id: &str) -> Result<bool, RpcError> {
        if self.inner.chats.lock().await.contains_key(chat_id) {
            return Ok(false);
        }
        let store = ChatStore::new(&self.inner.home);
        let Some(stored) = store
            .read(chat_id)
            .await
            .map_err(|error| RpcError::new("chat-storage", error.to_string()))?
        else {
            return Ok(false);
        };
        let mut info = stored.info;
        let mut items = stored.items;
        for (_, event) in stored.events {
            apply_event(&mut info, &mut items, &event);
        }
        let Some(fork_turn) = info.pointer("/forkOf/turnId").and_then(Value::as_str) else {
            return Ok(false);
        };
        let last_turn = items
            .iter()
            .rev()
            .find(|item| item.get("kind").and_then(Value::as_str) == Some("turn"))
            .and_then(|item| item.get("id"))
            .and_then(Value::as_str);
        if last_turn != Some(fork_turn) {
            return Ok(false);
        }
        store
            .remove(chat_id)
            .await
            .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
        self.inner.attachments.remove_all(chat_id).await?;
        let host = {
            self.inner
                .fork_host
                .read()
                .expect("chat fork host lock poisoned")
                .as_ref()
                .and_then(Weak::upgrade)
        };
        if let Some(host) = host {
            host.remove_plans(chat_id).await?;
        }
        let provider = info.get("provider").and_then(Value::as_str);
        let session_id = info.get("agentSessionId").and_then(Value::as_str);
        let cwd = info.get("cwd").and_then(Value::as_str);
        if provider == Some("claude")
            && let (Some(session_id), Some(cwd)) = (session_id, cwd)
            && !session_id.contains(['/', '\\'])
            && !session_id.contains("..")
        {
            let transcript = self
                .inner
                .claude_projects
                .join(subagents::claude_project_slug(cwd))
                .join(format!("{session_id}.jsonl"));
            match tokio::fs::remove_file(transcript).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(RpcError::new("chat-storage", error.to_string())),
            }
        }
        Ok(true)
    }

    async fn ensure_runtime_chat(&self, chat_id: &str) -> Result<(), RpcError> {
        if self.inner.chats.lock().await.contains_key(chat_id) {
            return Ok(());
        }
        self.create(json!({ "chatId": chat_id })).await?;
        Ok(())
    }

    pub(crate) async fn runtime_view(
        &self,
        chat_id: &str,
    ) -> Result<Option<ChatRuntimeState>, RpcError> {
        if let Some(handle) = self.inner.chats.lock().await.get(chat_id).cloned() {
            let (reply, received) = oneshot::channel();
            handle
                .commands
                .send(Command::Inspect { reply })
                .await
                .map_err(closed)?;
            return received.await.map(Some).map_err(closed);
        }

        let store = ChatStore::new(&self.inner.home);
        let Some(mut stored) = store
            .read(chat_id)
            .await
            .map_err(|error| RpcError::new("chat-storage", error.to_string()))?
        else {
            return Ok(None);
        };
        if self
            .inner
            .attachments
            .migrate_items(chat_id, &mut stored.items)
            .await?
        {
            store
                .write_snapshot(
                    chat_id,
                    &stored.info,
                    &stored.items,
                    stored.seq,
                    stored.reset_seq,
                    &stored.preambles,
                    &stored.preamble_operations.iter().cloned().collect(),
                )
                .await
                .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
        }
        let mut info = stored.info;
        let mut items = stored.items;
        let mut seq = stored.seq;
        for (event_seq, event) in stored.events {
            apply_event(&mut info, &mut items, &event);
            seq = seq.max(event_seq);
        }
        set(&mut info, "running", json!(false));
        if info
            .get("activeTurnId")
            .is_some_and(|active| !active.is_null())
        {
            set(&mut info, "status", json!("error"));
        }
        Ok(Some(ChatRuntimeState {
            info,
            items,
            seq,
            generation: 0,
        }))
    }

    pub async fn resolve_attachment(
        &self,
        chat_id: &str,
        attachment_id: &str,
    ) -> Result<Option<ResolvedAttachment>, RpcError> {
        let Some(view) = self.runtime_view(chat_id).await? else {
            return Ok(None);
        };
        let attachment = view
            .items
            .iter()
            .filter(|item| item.get("kind").and_then(Value::as_str) == Some("user"))
            .filter_map(|item| item.get("attachments").and_then(Value::as_array))
            .flatten()
            .chain(
                view.info
                    .get("queue")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|message| message.get("attachments").and_then(Value::as_array))
                    .flatten(),
            )
            .find(|attachment| attachment.get("id").and_then(Value::as_str) == Some(attachment_id))
            .cloned();
        let Some(attachment) = attachment else {
            return Ok(None);
        };
        self.inner.attachments.resolve(chat_id, &attachment).await
    }

    async fn fork(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: ForkPayload = parse(payload)?;
        let source = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let turns = source
            .items
            .iter()
            .filter(|item| item.get("kind").and_then(Value::as_str) == Some("turn"))
            .collect::<Vec<_>>();
        let index = turns
            .iter()
            .position(|turn| turn.get("id").and_then(Value::as_str) == Some(&payload.turn_id))
            .ok_or_else(|| {
                RpcError::new(
                    "turn-not-found",
                    format!("{} has no turn {}", payload.chat_id, payload.turn_id),
                )
            })?;
        let turn = turns[index];
        if turn.get("state").and_then(Value::as_str) == Some("running") {
            return Err(RpcError::new(
                "turn-running",
                "That turn is still running; fork it once it ends",
            ));
        }
        if source
            .info
            .get("activeTurnId")
            .is_some_and(|turn| !turn.is_null())
        {
            return Err(RpcError::new(
                "chat-busy",
                "The chat is working on a turn; fork it once that turn ends",
            ));
        }
        let source_provider = source
            .info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude");
        let provider = payload.provider.as_deref().unwrap_or(source_provider);
        if !matches!(source_provider, "claude" | "codex") || !matches!(provider, "claude" | "codex")
        {
            return Err(RpcError::new(
                "chat-unsupported",
                format!("{} has no chat that can be forked", provider_name(provider)),
            ));
        }
        if !self.provider_installed(provider).await {
            return Err(RpcError::new(
                "provider-not-installed",
                format!(
                    "{} is not installed on this machine",
                    provider_name(provider)
                ),
            ));
        }
        let switching = provider != source_provider;
        let source_session = source.info.get("agentSessionId").and_then(Value::as_str);
        if source_session.is_none() && !switching {
            return Err(RpcError::new(
                "transcript-missing",
                format!(
                    "{} never started a conversation in this chat",
                    provider_name(source_provider)
                ),
            ));
        }
        let host = self.fork_host()?;
        let location = host.locate(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new(
                "chat-not-found",
                format!("{} is in no project this machine knows", payload.chat_id),
            )
        })?;
        let into_view = payload.as_view == Some(true)
            || (location.canvas_id.is_none() && payload.view_id.is_none());
        let last = index + 1 == turns.len();
        let native = if source_provider == "codex" {
            turn.pointer("/native/turnId")
        } else {
            turn.pointer("/native/lastUuid")
        }
        .and_then(Value::as_str);
        let exact = native.is_some();
        let original_title = location
            .title
            .clone()
            .unwrap_or_else(|| provider_name(source_provider).to_owned());
        let title = payload
            .title
            .clone()
            .unwrap_or_else(|| format!("{original_title} (fork)"))
            .chars()
            .take(120)
            .collect::<String>();
        let fork_id = format!("chat-{}", Uuid::new_v4());
        let source_cwd = source
            .info
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let branches = host.branches(source_cwd).await?;
        let mut worktree = None::<ForkWorktree>;
        let mut cwd = source_cwd.to_owned();
        let mut after_turn = false;
        if let Some(requested) = &payload.worktree {
            let branches = branches.as_ref().ok_or_else(|| {
                RpcError::new(
                    "not-a-repository",
                    format!("{source_cwd} is not in a git repository"),
                )
            })?;
            let branch = requested
                .branch
                .clone()
                .unwrap_or_else(|| free_branch(&branch_slug(&title), branches));
            if branches.iter().any(|existing| existing == &branch) {
                return Err(RpcError::new(
                    "branch-exists",
                    format!("The branch {branch} exists already; name another one"),
                ));
            }
            let tree = if payload.files_after_turn == Some(true) {
                let tree = turns[index]
                    .get("checkpointAfter")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        turns
                            .get(index + 1)
                            .and_then(|turn| turn.get("checkpoint"))
                            .and_then(Value::as_str)
                    });
                match tree {
                    Some(tree) if host.tree_exists(source_cwd, tree).await? => {
                        Some(tree.to_owned())
                    }
                    Some(_) => {
                        return Err(RpcError::new(
                            "checkpoint-missing",
                            "The files of this turn are no longer in the repository",
                        ));
                    }
                    None if last => host.take_tree(source_cwd).await?,
                    None => {
                        return Err(RpcError::new(
                            "checkpoint-missing",
                            "No tree of the files after this turn was taken",
                        ));
                    }
                }
            } else {
                None
            };
            let made = host
                .add_worktree(ForkWorktreeRequest {
                    cwd: source_cwd.to_owned(),
                    branch,
                    project_id: location.project_id.clone(),
                    node_id: fork_id.clone(),
                })
                .await
                .map_err(|error| RpcError::new("worktree-failed", error.message))?;
            if let Some(tree) = tree {
                if let Err(error) = host.restore_tree(&made.cwd, &tree).await {
                    let _ = host.remove_worktree(&made.record).await;
                    return Err(error);
                }
                after_turn = true;
            }
            cwd = made.cwd.clone();
            worktree = Some(made);
        }

        let mut transcript = None::<PathBuf>;
        let agent_session_id = if switching {
            None
        } else if source_provider == "claude" {
            let new_session_id = Uuid::new_v4().to_string();
            let cut = match native {
                Some(uuid) => ClaudeCutPoint::LastUuid(uuid),
                None if last => ClaudeCutPoint::Whole,
                None => ClaudeCutPoint::Turns(index + 1),
            };
            match claude_fork::fork_transcript(
                &self.claude_projects_dir(),
                source_cwd,
                source_session.unwrap_or_default(),
                cut,
                &cwd,
                &new_session_id,
            )
            .await
            {
                Ok(path) => {
                    transcript = Some(path);
                    Some(new_session_id)
                }
                Err(error) => {
                    if let Some(worktree) = &worktree {
                        let _ = host.remove_worktree(&worktree.record).await;
                    }
                    return Err(error);
                }
            }
        } else {
            let cut = match native {
                Some(turn_id) => CodexCutPoint::Turn(turn_id),
                None if last => CodexCutPoint::Whole,
                None => CodexCutPoint::Turns(index + 1),
            };
            let command = self.codex_app_server_command();
            let options = json!({
                "cwd": cwd,
                "model": source.info.pointer("/selection/model"),
                "approvalPolicy": codex_mode(source.info.get("runtimeMode").and_then(Value::as_str).unwrap_or("full-access")).0,
                "sandbox": codex_mode(source.info.get("runtimeMode").and_then(Value::as_str).unwrap_or("full-access")).1,
            });
            match codex_fork::fork_thread(
                &command,
                Path::new(&cwd),
                &self.environment(),
                source_session.unwrap_or_default(),
                cut,
                options,
            )
            .await
            {
                Ok(id) => Some(id),
                Err(error) => {
                    if let Some(worktree) = &worktree {
                        let _ = host.remove_worktree(&worktree.record).await;
                    }
                    return Err(error);
                }
            }
        };

        let created_at = now();
        let copied = items_through(&source.items, &payload.turn_id);
        let files = if let Some(worktree) = &worktree {
            ForkFiles::Worktree {
                path: worktree.cwd.clone(),
                branch: worktree
                    .record
                    .get("branch")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                after_turn,
            }
        } else {
            ForkFiles::Shared {
                repository: branches.is_some(),
            }
        };
        let (note, preamble) = if switching {
            handoff_notes(
                &copied,
                source_provider,
                provider,
                &payload.chat_id,
                &original_title,
                location.canvas_id.is_none(),
                index + 1,
                turns.len(),
                created_at,
                &cwd,
                &files,
                last,
            )
        } else {
            fork_notes(
                &payload.chat_id,
                &original_title,
                location.canvas_id.is_none(),
                index + 1,
                turns.len(),
                last,
                exact,
                &files,
            )
        };
        let selection = if let Some(selection) = payload.selection.as_ref() {
            self.inner
                .providers
                .normalize_selection(provider, Some(selection))
        } else if switching {
            let preferred = self.starting_preference(provider);
            self.inner.providers.normalize_selection(
                provider,
                preferred.as_ref().and_then(|value| value.get("selection")),
            )
        } else {
            source
                .info
                .get("selection")
                .cloned()
                .unwrap_or_else(|| self.inner.providers.normalize_selection(provider, None))
        };
        let source_mode = source
            .info
            .get("runtimeMode")
            .and_then(Value::as_str)
            .unwrap_or("supervised");
        let runtime_mode = if switching {
            let preferred = self
                .starting_preference(provider)
                .and_then(|value| value.get("runtimeMode").cloned())
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_else(|| source_mode.to_owned());
            narrower_mode(&preferred, source_mode).to_owned()
        } else {
            source_mode.to_owned()
        };
        let mut info = source.info.clone();
        for key in ["queue", "suggestedTitle", "skills"] {
            info.as_object_mut().unwrap().remove(key);
        }
        set(&mut info, "chatId", json!(fork_id));
        set(&mut info, "provider", json!(provider));
        set(&mut info, "cwd", json!(cwd));
        set(&mut info, "agentSessionId", json!(agent_session_id));
        set(&mut info, "selection", selection.clone());
        set(&mut info, "runtimeMode", json!(runtime_mode));
        set(&mut info, "status", json!("idle"));
        set(&mut info, "running", json!(false));
        set(&mut info, "activeTurnId", Value::Null);
        set(
            &mut info,
            "usage",
            json!({
                "contextTokens": 0,
                "contextWindow": self.inner.providers.context_window(provider, &selection),
                "costUsd": 0,
                "turns": index + 1,
            }),
        );
        set(
            &mut info,
            "forkOf",
            json!({ "chatId": payload.chat_id, "turnId": payload.turn_id, "at": created_at }),
        );
        set(&mut info, "createdAt", json!(created_at));
        if switching {
            set(&mut info, "model", Value::Null);
            set(&mut info, "slashCommands", json!([]));
        }
        let mut items = copied;
        items.push(json!({
            "id": format!("note-fork-{created_at}"),
            "kind": "note",
            "createdAt": created_at,
            "turnId": null,
            "level": "info",
            "text": note,
        }));
        let store = ChatStore::new(&self.inner.home);
        if let Err(error) = store
            .write_record(&fork_id, &info, &items, &[preamble])
            .await
        {
            self.rollback_fork(&host, &fork_id, transcript.as_deref(), worktree.as_ref())
                .await;
            return Err(RpcError::new("chat-storage", error.to_string()));
        }
        if let Err(error) = host.copy_plans(&payload.chat_id, &fork_id).await {
            self.rollback_fork(&host, &fork_id, transcript.as_deref(), worktree.as_ref())
                .await;
            return Err(error);
        }
        let placement = host
            .place_fork(ForkPlacementRequest {
                project_id: location.project_id,
                source_id: payload.chat_id,
                fork_id: fork_id.clone(),
                provider: provider.to_owned(),
                title,
                cwd: (cwd != location.folder).then_some(cwd),
                as_view: into_view,
                canvas_id: payload.view_id.or(location.canvas_id),
                worktree: worktree.as_ref().map(|worktree| worktree.record.clone()),
            })
            .await;
        let placement = match placement {
            Ok(placement) => placement,
            Err(error) => {
                self.rollback_fork(&host, &fork_id, transcript.as_deref(), worktree.as_ref())
                    .await;
                return Err(error);
            }
        };
        let mut result = json!({
            "info": info,
            "nodeId": placement.node_id,
            "viewId": placement.view_id,
            "edgeId": placement.edge_id,
        });
        if let Some(worktree) = worktree {
            result["worktree"] = worktree.record;
        }
        Ok(result)
    }

    async fn rollback_fork(
        &self,
        host: &Arc<dyn ChatForkWorkspaceHost>,
        fork_id: &str,
        transcript: Option<&Path>,
        worktree: Option<&ForkWorktree>,
    ) {
        let _ = host.remove_plans(fork_id).await;
        let _ = ChatStore::new(&self.inner.home).remove(fork_id).await;
        if let Some(transcript) = transcript {
            let _ = tokio::fs::remove_file(transcript).await;
        }
        if let Some(worktree) = worktree {
            let _ = host.remove_worktree(&worktree.record).await;
        }
    }

    async fn provider_installed(&self, provider: &str) -> bool {
        if self.inner.config.commands.contains_key(provider) {
            return true;
        }
        self.inner
            .providers
            .list()
            .await
            .get("providers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|entry| {
                entry.get("kind").and_then(Value::as_str) == Some(provider)
                    && entry.get("installed").and_then(Value::as_bool) == Some(true)
            })
    }

    fn claude_projects_dir(&self) -> PathBuf {
        let environment = self.environment();
        environment
            .get("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                environment
                    .get("HOME")
                    .map(|home| Path::new(home).join(".claude"))
            })
            .unwrap_or_else(|| self.inner.home.join(".claude"))
            .join("projects")
    }

    fn codex_app_server_command(&self) -> Vec<String> {
        let mut command = self
            .inner
            .config
            .commands
            .get("codex")
            .cloned()
            .unwrap_or_else(|| vec!["codex".into()]);
        command.push("app-server".into());
        command
    }

    async fn fork_info(&self, payload: Value) -> RpcResult {
        let payload: ForkInfoPayload = parse(payload)?;
        let source = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let turns = source
            .items
            .iter()
            .filter(|item| item.get("kind").and_then(Value::as_str) == Some("turn"))
            .collect::<Vec<_>>();
        let index = turns
            .iter()
            .position(|turn| turn.get("id").and_then(Value::as_str) == Some(&payload.turn_id))
            .ok_or_else(|| {
                RpcError::new(
                    "turn-not-found",
                    format!("{} has no turn {}", payload.chat_id, payload.turn_id),
                )
            })?;
        let cwd = source
            .info
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let host = self.fork_host()?;
        let Some(branches) = host.branches(cwd).await? else {
            return Ok(json!({
                "repository": false,
                "branches": [],
                "branch": null,
                "filesAfterTurn": false,
            }));
        };
        let tree = turns[index]
            .get("checkpointAfter")
            .and_then(Value::as_str)
            .or_else(|| {
                turns
                    .get(index + 1)
                    .and_then(|turn| turn.get("checkpoint"))
                    .and_then(Value::as_str)
            });
        let files_after_turn = match tree {
            Some(tree) => host.tree_exists(cwd, tree).await?,
            None => index + 1 == turns.len(),
        };
        let location = host.locate(&payload.chat_id).await?;
        let provider = source
            .info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude");
        let title = format!(
            "{} (fork)",
            location
                .and_then(|location| location.title)
                .unwrap_or_else(|| provider_name(provider).to_owned())
        );
        let branch = free_branch(&branch_slug(&title), &branches);
        Ok(json!({
            "repository": true,
            "branches": branches,
            "branch": branch,
            "filesAfterTurn": files_after_turn,
        }))
    }

    async fn summarize(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let source = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let fork_of = source.info.get("forkOf").ok_or_else(|| {
            RpcError::new(
                "not-a-fork",
                format!("{} was not forked from another chat", payload.chat_id),
            )
        })?;
        if source
            .info
            .get("activeTurnId")
            .is_some_and(|turn| !turn.is_null())
        {
            return Err(RpcError::new("chat-busy", "The fork is working on a turn"));
        }
        let original_id = fork_of
            .get("chatId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let original_turn = fork_of
            .get("turnId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let host = self.fork_host()?;
        let location = host.locate(original_id).await?.ok_or_else(|| {
            RpcError::new(
                "original-gone",
                "The chat this one was forked from is no longer in the project",
            )
        })?;
        let after = source
            .items
            .iter()
            .filter(|item| item.get("kind").and_then(Value::as_str) == Some("turn"))
            .position(|turn| turn.get("id").and_then(Value::as_str) == Some(original_turn))
            .map(|index| index + 1);
        let kind = if location.canvas_id.is_none() {
            "view"
        } else {
            "node"
        };
        let prompt = format!(
            "Ruimte: write a summary of what this conversation found out and decided since it was forked from {kind} {original_id}{}, for the agent that continues there. At most 300 words. Say what changed in the files and where, what worked, what did not, and what is left; leave out what the original already knows. Do not run tools.",
            after
                .map(|after| format!(" after turn {after}"))
                .unwrap_or_default()
        );
        self.create(json!({ "chatId": payload.chat_id })).await?;
        let title = location.title.unwrap_or_else(|| original_id.to_owned());
        let result = self
            .runtime_wake(
                &payload.chat_id,
                prompt,
                format!("Summary for {title}"),
                Some(format!("Writing a summary for {title}")),
                Vec::new(),
                Some(original_id.to_owned()),
                Uuid::new_v4(),
            )
            .await?;
        Ok(json!({ "turnId": result.get("turnId").cloned().unwrap_or(Value::Null) }))
    }

    fn fork_host(&self) -> Result<Arc<dyn ChatForkWorkspaceHost>, RpcError> {
        self.inner
            .fork_host
            .read()
            .expect("chat fork host lock poisoned")
            .as_ref()
            .and_then(Weak::upgrade)
            .ok_or_else(|| RpcError::new("fork-unavailable", "Chat fork workspace is unavailable"))
    }

    async fn create(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: CreatePayload = parse(payload)?;
        if payload.chat_id.is_empty() {
            return Err(RpcError::new("invalid-request", "chatId is required"));
        }
        if let Some(existing) = self.inner.chats.lock().await.get(&payload.chat_id).cloned() {
            return Ok(existing.public.info.read().await.clone());
        }
        {
            let mut creating = self
                .inner
                .creating
                .lock()
                .expect("chat creation lock poisoned");
            if !creating.insert(payload.chat_id.clone()) {
                return Err(RpcError::new("chat-busy", "The chat is being created"));
            }
        }
        let _guard = CreationGuard {
            inner: self.inner.clone(),
            chat_id: payload.chat_id.clone(),
        };
        self.create_inner(payload).await
    }

    async fn create_inner(&self, payload: CreatePayload) -> RpcResult {
        self.require_accepting()?;
        let store = ChatStore::new(&self.inner.home);
        let mut stored = store
            .read(&payload.chat_id)
            .await
            .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
        if let Some(stored) = &mut stored
            && self
                .inner
                .attachments
                .migrate_items(&payload.chat_id, &mut stored.items)
                .await?
        {
            store
                .write_snapshot(
                    &payload.chat_id,
                    &stored.info,
                    &stored.items,
                    stored.seq,
                    stored.reset_seq,
                    &stored.preambles,
                    &stored.preamble_operations.iter().cloned().collect(),
                )
                .await
                .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
        }
        if let Some(stored) = &mut stored
            && let Some(interrupted) = stored_interruption(stored)
        {
            let owed = if let Some(reason) = interrupted.reason.as_deref() {
                Err(reason.to_owned())
            } else {
                let host = self
                    .inner
                    .context_host
                    .read()
                    .expect("chat context host lock poisoned")
                    .as_ref()
                    .and_then(Weak::upgrade);
                match host {
                    Some(host) => host
                        .owe_interrupted_run(
                            &payload.chat_id,
                            &interrupted.turn_id,
                            interrupted.attempt + 1,
                            interrupted.created_at,
                        )
                        .await
                        .map_err(|error| error.message),
                    None => Ok(false),
                }
            };
            if owed != Ok(true) {
                settle_stored_interruption(
                    stored,
                    &interrupted.turn_id,
                    owed.err()
                        .as_deref()
                        .unwrap_or("no project holds this chat any more"),
                );
                store
                    .write_snapshot(
                        &payload.chat_id,
                        &stored.info,
                        &stored.items,
                        stored.seq,
                        stored.reset_seq,
                        &stored.preambles,
                        &stored.preamble_operations.iter().cloned().collect(),
                    )
                    .await
                    .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
            }
        }
        let restored = stored.as_ref().map(materialize_stored);
        let provider = restored
            .as_ref()
            .and_then(|(info, _)| info.get("provider"))
            .and_then(Value::as_str)
            .or(payload.provider.as_deref())
            .unwrap_or("claude")
            .to_owned();
        if !matches!(provider.as_str(), "claude" | "codex") {
            return Err(RpcError::new(
                "chat-unsupported",
                format!("{provider} does not support native chat"),
            ));
        }
        let selection = self.inner.providers.normalize_selection(
            &provider,
            restored
                .as_ref()
                .and_then(|(info, _)| info.get("selection"))
                .or(payload.selection.as_ref()),
        );
        let cwd = restored
            .as_ref()
            .and_then(|(info, _)| info.get("cwd"))
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .or_else(|| payload.cwd.map(PathBuf::from))
            .unwrap_or_else(|| self.inner.home.clone());
        if !cwd.is_dir() {
            return Err(RpcError::new(
                "invalid-request",
                format!("Chat cwd does not exist: {}", cwd.display()),
            ));
        }
        let runtime_mode = restored
            .as_ref()
            .and_then(|(info, _)| info.get("runtimeMode"))
            .and_then(Value::as_str)
            .or(payload.runtime_mode.as_deref())
            .unwrap_or("full-access")
            .to_owned();
        if !matches!(
            runtime_mode.as_str(),
            "supervised" | "auto-accept-edits" | "auto" | "full-access"
        ) {
            return Err(RpcError::new("invalid-request", "Invalid runtimeMode"));
        }
        let context_window = self.inner.providers.context_window(&provider, &selection);
        let mut info = restored
            .as_ref()
            .map(|(info, _)| info.clone())
            .unwrap_or_else(|| {
                json!({
                    "chatId": payload.chat_id,
                    "provider": provider,
                    "cwd": cwd.to_string_lossy(),
                    "agentSessionId": payload.resume,
                    "model": null,
                    "selection": selection,
                    "runtimeMode": runtime_mode,
                    "status": "idle",
                    "running": false,
                    "activeTurnId": null,
                    "slashCommands": [],
                    "usage": { "contextTokens": 0, "contextWindow": context_window, "costUsd": 0.0, "turns": 0 },
                    "createdAt": now(),
                })
            });
        set(&mut info, "running", json!(false));
        if info
            .get("activeTurnId")
            .is_some_and(|value| !value.is_null())
        {
            set(&mut info, "status", json!("running"));
        }
        let actor_info = stored
            .as_ref()
            .map(|stored| stored.info.clone())
            .unwrap_or_else(|| info.clone());
        let public = Arc::new(PublicState {
            info: RwLock::new(info.clone()),
            pid: AtomicU32::new(0),
            updated_at: AtomicU64::new(now()),
            runtime_change_sink: self.inner.runtime_change_sink.clone(),
        });
        let (commands, command_rx) = mpsc::channel(ACTOR_QUEUE);
        let (process_tx, process_rx) = mpsc::channel(ACTOR_QUEUE);
        let command = self.command_for(&provider, &info);
        let mut actor = Actor::new(
            actor_info,
            stored,
            store,
            self.inner.events.clone(),
            public.clone(),
            command,
            self.environment(),
            self.inner.accepting.clone(),
            self.inner.bearers.clone(),
            self.inner
                .limits_sink
                .read()
                .expect("chat limits sink lock poisoned")
                .clone(),
            self.inner.fork_host.clone(),
            self.inner.context_host.clone(),
            self.inner.process_nudge.clone(),
        );
        self.require_accepting()?;
        let chat_id = actor.chat_id.clone();
        tokio::spawn(async move { actor.run(command_rx, process_rx, process_tx).await });
        self.inner
            .chats
            .lock()
            .await
            .insert(chat_id, ChatHandle { commands, public });
        Ok(info)
    }

    fn command_for(&self, provider: &str, info: &Value) -> Vec<String> {
        let command = self
            .inner
            .config
            .commands
            .get(provider)
            .cloned()
            .unwrap_or_else(|| vec![provider.to_owned()]);
        build_chat_command(command, provider, info)
    }

    fn environment(&self) -> HashMap<String, String> {
        let mut environment = if !self.inner.config.environment.is_empty() {
            self.inner.config.environment.clone()
        } else {
            std::env::vars().collect()
        };
        for key in [
            "RUIMTE_HOOK_URL",
            "RUIMTE_HOOK_TOKEN",
            "RUIMTE_CONTEXT_URL",
            "RUIMTE_CONTEXT_TOKEN",
            "RUIMTE_SESSION_ID",
        ] {
            environment.remove(key);
        }
        if let Some(url) = self
            .inner
            .context_url
            .read()
            .expect("chat context URL lock poisoned")
            .clone()
        {
            environment.insert("RUIMTE_CONTEXT_URL".to_owned(), url);
        }
        environment
    }

    async fn attach(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: AttachPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Attach {
            client_id: client_id.to_owned(),
            history_limit: payload.history_limit,
            since: payload.since,
            reply,
        })
        .await
    }

    async fn detach_one(&self, payload: Value, client_id: &str) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.chat_id).await?;
        handle
            .commands
            .send(Command::Detach {
                client_id: client_id.to_owned(),
            })
            .await
            .map_err(closed)?;
        Ok(json!({}))
    }

    async fn history(&self, payload: Value) -> RpcResult {
        let payload: HistoryPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::History {
            cursor: payload.cursor,
            limit: payload.limit.unwrap_or(60).clamp(1, 100),
            reply,
        })
        .await
    }

    async fn send(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: SendPayload = parse(payload)?;
        if payload.text.trim().is_empty() && payload.attachments.is_empty() {
            return Err(RpcError::new(
                "invalid-request",
                "A message needs text or an attachment",
            ));
        }
        let handle = self.require(&payload.chat_id).await?;
        let attachments = self
            .inner
            .attachments
            .save_all(&payload.chat_id, payload.attachments)
            .await?;
        let (reply, result) = oneshot::channel();
        if handle
            .commands
            .send(Command::Send {
                text: payload.text,
                mentions: payload.mentions,
                skills: payload.skills,
                attachments: attachments.clone(),
                reply,
            })
            .await
            .is_err()
        {
            self.inner.attachments.remove_saved(&attachments).await;
            return Err(closed("chat actor closed"));
        }
        match result.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => {
                self.inner.attachments.remove_saved(&attachments).await;
                Err(error)
            }
            Err(error) => {
                self.inner.attachments.remove_saved(&attachments).await;
                Err(closed(error))
            }
        }
    }

    async fn skills(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let handle = self.require(&payload.chat_id).await?;
        let info = handle.public.info.read().await.clone();
        let provider = info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude");
        let cwd = Path::new(info.get("cwd").and_then(Value::as_str).unwrap_or("."));
        let mut skills = self.inner.skills.list(provider, cwd).await?;
        if let Some(announced) = info.get("skills").and_then(Value::as_array)
            && !announced.is_empty()
        {
            let names = announced
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>();
            skills.retain(|skill| {
                skill
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| names.contains(name))
            });
        }
        Ok(json!({ "skills": skills }))
    }

    async fn subagent(&self, payload: Value, _client_id: &str) -> RpcResult {
        let payload: SubagentPayload = parse(payload)?;
        let key = format!("{}\n{}", payload.chat_id, payload.tool_use_id);
        if payload.watch == Some(false) {
            self.release_subagent_hold(&key, _client_id).await;
        }
        let watch = payload.watch == Some(true);
        let client_id = _client_id.to_owned();
        let initial_fingerprint = if watch {
            self.subagent_source_fingerprint(&payload.chat_id, &payload.tool_use_id)
                .await
                .ok()
        } else {
            None
        };
        let result = self.read_subagent_payload(&payload).await?;
        if watch {
            self.hold_subagent(
                key,
                payload.chat_id,
                payload.tool_use_id,
                client_id,
                initial_fingerprint,
            )
            .await;
        }
        Ok(result)
    }

    async fn read_subagent_payload(&self, payload: &SubagentPayload) -> RpcResult {
        let parent = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let row = parent
            .items
            .iter()
            .find(|item| {
                item.get("kind").and_then(Value::as_str) == Some("subagent")
                    && item.get("toolUseId").and_then(Value::as_str)
                        == Some(payload.tool_use_id.as_str())
            })
            .cloned();
        if let Some(row) = &row
            && row.get("origin").and_then(Value::as_str) == Some("ruimte")
            && let Some(child_id) = row.get("childId").and_then(Value::as_str)
        {
            let child = self.runtime_view(child_id).await?.ok_or_else(|| {
                RpcError::new(
                    "chat-unsupported",
                    "This task runs in a terminal or has not started; its node shows what it does",
                )
            })?;
            return subagents::page(
                child.items,
                payload.cursor.as_deref(),
                payload.limit.unwrap_or(60).clamp(1, 100),
                &format!("child-{child_id}"),
                if child.info.get("provider").and_then(Value::as_str) == Some("codex") {
                    "codex-thread"
                } else {
                    "claude-transcript"
                },
                child
                    .info
                    .get("activeTurnId")
                    .is_some_and(|turn| !turn.is_null()),
            );
        }

        let provider = parent
            .info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude");
        let live = row
            .as_ref()
            .and_then(|row| row.get("status"))
            .and_then(Value::as_str)
            == Some("running")
            && (provider != "codex"
                || parent.info.get("running").and_then(Value::as_bool) == Some(true));
        let limit = payload.limit.unwrap_or(60).clamp(1, 100);
        if provider == "codex" {
            let thread_id = row
                .as_ref()
                .and_then(|row| row.pointer("/native/threadId"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    RpcError::new(
                        "subagent-not-found",
                        "Codex has not said which thread this sub-agent works in",
                    )
                })?;
            let command = self.command_for("codex", &parent.info);
            let cwd = Path::new(
                parent
                    .info
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or("."),
            );
            return subagents::read_codex(
                &command,
                cwd,
                &self.environment(),
                thread_id,
                payload.cursor.as_deref(),
                limit,
                live,
            )
            .await;
        }

        let mut seen = HashSet::new();
        let mut current = Some(parent.info);
        while let Some(info) = current {
            let chat_id = info
                .get("chatId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if !seen.insert(chat_id) {
                break;
            }
            if let Some(transcript) = subagents::find_claude_transcript(
                &self.inner.claude_projects,
                &info,
                &payload.tool_use_id,
            )
            .await
            {
                self.call(&payload.chat_id, |reply| Command::NoteSubagentNative {
                    tool_use_id: payload.tool_use_id.clone(),
                    agent_id: transcript.agent_id,
                    reply,
                })
                .await?;
                return subagents::read_claude(
                    &transcript.path,
                    payload.cursor.as_deref(),
                    limit,
                    live,
                )
                .await;
            }
            current = if let Some(origin) = info.pointer("/forkOf/chatId").and_then(Value::as_str) {
                self.runtime_view(origin).await?.map(|view| view.info)
            } else {
                None
            };
        }
        Err(RpcError::new(
            "subagent-not-found",
            "Claude has not written a transcript for this sub-agent",
        ))
    }

    async fn hold_subagent(
        &self,
        key: String,
        chat_id: String,
        tool_use_id: String,
        client_id: String,
        initial_fingerprint: Option<String>,
    ) {
        let fingerprint = match initial_fingerprint {
            Some(fingerprint) => fingerprint,
            None => self
                .subagent_source_fingerprint(&chat_id, &tool_use_id)
                .await
                .unwrap_or_default(),
        };
        let mut holds = self.inner.subagent_holds.lock().await;
        if let Some(hold) = holds.get_mut(&key) {
            hold.clients.insert(client_id);
            return;
        }
        let generation = Uuid::new_v4();
        let cancel = CancellationToken::new();
        holds.insert(
            key.clone(),
            SubagentHold {
                chat_id,
                tool_use_id,
                clients: HashSet::from([client_id]),
                fingerprint,
                generation,
                cancel: cancel.clone(),
                task: None,
            },
        );
        drop(holds);
        let service = self.clone();
        let task_key = key.clone();
        let task =
            tokio::spawn(async move { service.poll_subagent(task_key, generation, cancel).await });
        let mut holds = self.inner.subagent_holds.lock().await;
        if let Some(hold) = holds.get_mut(&key)
            && hold.generation == generation
        {
            hold.task = Some(task);
        } else {
            task.abort();
        }
    }

    async fn poll_subagent(&self, key: String, generation: Uuid, cancel: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {}
            }
            let (chat_id, tool_use_id) = {
                let holds = self.inner.subagent_holds.lock().await;
                let Some(hold) = holds.get(&key) else {
                    return;
                };
                if hold.generation != generation {
                    return;
                }
                (hold.chat_id.clone(), hold.tool_use_id.clone())
            };
            let Ok(fingerprint) = self
                .subagent_source_fingerprint(&chat_id, &tool_use_id)
                .await
            else {
                continue;
            };
            let clients = {
                let mut holds = self.inner.subagent_holds.lock().await;
                let Some(hold) = holds.get_mut(&key) else {
                    return;
                };
                if hold.generation != generation {
                    return;
                }
                if hold.fingerprint == fingerprint {
                    continue;
                }
                hold.fingerprint = fingerprint;
                hold.clients.iter().cloned().collect::<Vec<_>>()
            };
            for client_id in clients {
                self.inner.events.send(
                    &client_id,
                    "chat.subagentChanged",
                    json!({ "chatId": chat_id, "toolUseId": tool_use_id }),
                );
            }
        }
    }

    async fn subagent_source_fingerprint(
        &self,
        chat_id: &str,
        tool_use_id: &str,
    ) -> Result<String, RpcError> {
        let parent = self
            .runtime_view(chat_id)
            .await?
            .ok_or_else(|| RpcError::new("chat-not-found", format!("No chat {chat_id}")))?;
        let row = parent.items.iter().find(|item| {
            item.get("kind").and_then(Value::as_str) == Some("subagent")
                && item.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id)
        });
        if let Some(child_id) = row
            .filter(|row| row.get("origin").and_then(Value::as_str) == Some("ruimte"))
            .and_then(|row| row.get("childId"))
            .and_then(Value::as_str)
            && let Some(child) = self.runtime_view(child_id).await?
        {
            return Ok(format!("child:{}:{}", child.seq, child.items.len()));
        }
        if parent.info.get("provider").and_then(Value::as_str) == Some("codex") {
            return Ok(format!("codex:{}:{}", parent.seq, parent.items.len()));
        }
        let mut seen = HashSet::new();
        let mut current = Some(parent.info);
        while let Some(info) = current {
            let current_id = info
                .get("chatId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if !seen.insert(current_id) {
                break;
            }
            if let Some(transcript) =
                subagents::find_claude_transcript(&self.inner.claude_projects, &info, tool_use_id)
                    .await
            {
                let metadata = tokio::fs::metadata(transcript.path)
                    .await
                    .map_err(|error| RpcError::new("subagent-read", error.to_string()))?;
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_nanos())
                    .unwrap_or_default();
                return Ok(format!("claude:{}:{modified}", metadata.len()));
            }
            current = if let Some(origin) = info.pointer("/forkOf/chatId").and_then(Value::as_str) {
                self.runtime_view(origin).await?.map(|view| view.info)
            } else {
                None
            };
        }
        Err(RpcError::new(
            "subagent-not-found",
            "The sub-agent conversation disappeared",
        ))
    }

    async fn release_subagent_hold(&self, key: &str, client_id: &str) {
        let removed = {
            let mut holds = self.inner.subagent_holds.lock().await;
            let Some(hold) = holds.get_mut(key) else {
                return;
            };
            hold.clients.remove(client_id);
            if hold.clients.is_empty() {
                holds.remove(key)
            } else {
                None
            }
        };
        if let Some(mut hold) = removed {
            hold.cancel.cancel();
            if let Some(task) = hold.task.take() {
                let _ = task.await;
            }
        }
    }

    async fn release_subagent_client(&self, client_id: &str) {
        let keys = self
            .inner
            .subagent_holds
            .lock()
            .await
            .iter()
            .filter(|(_, hold)| hold.clients.contains(client_id))
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        for key in keys {
            self.release_subagent_hold(&key, client_id).await;
        }
    }

    async fn release_subagent_chat(&self, chat_id: &str) {
        let removed = {
            let mut holds = self.inner.subagent_holds.lock().await;
            let keys = holds
                .iter()
                .filter(|(_, hold)| hold.chat_id == chat_id)
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| holds.remove(&key))
                .collect::<Vec<_>>()
        };
        for mut hold in removed {
            hold.cancel.cancel();
            if let Some(task) = hold.task.take() {
                let _ = task.await;
            }
        }
    }

    async fn release_all_subagent_holds(&self) {
        let removed = {
            let mut holds = self.inner.subagent_holds.lock().await;
            holds.drain().map(|(_, hold)| hold).collect::<Vec<_>>()
        };
        for mut hold in removed {
            hold.cancel.cancel();
            if let Some(task) = hold.task.take() {
                let _ = task.await;
            }
        }
    }

    async fn stop_subagent(&self, payload: Value) -> RpcResult {
        let payload: StopSubagentPayload = parse(payload)?;
        let view = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let row = view.items.iter().find(|item| {
            item.get("kind").and_then(Value::as_str) == Some("subagent")
                && item.get("toolUseId").and_then(Value::as_str)
                    == Some(payload.tool_use_id.as_str())
        });
        let Some(row) = row else {
            return Err(RpcError::new(
                "subagent-not-found",
                "This chat has no such sub-agent",
            ));
        };
        if row.get("status").and_then(Value::as_str) != Some("running") {
            return Ok(json!({}));
        }
        if row.get("origin").and_then(Value::as_str) == Some("ruimte") {
            let child_id = row.get("childId").and_then(Value::as_str).ok_or_else(|| {
                RpcError::new(
                    "chat-unsupported",
                    "This task cannot be stopped from here; stop its node instead",
                )
            })?;
            let context_host = {
                let host = self
                    .inner
                    .context_host
                    .read()
                    .expect("chat context host lock poisoned");
                host.as_ref().and_then(Weak::upgrade)
            }
            .ok_or_else(|| {
                RpcError::new(
                    "chat-unsupported",
                    "This task cannot be stopped from here; stop its node instead",
                )
            })?;
            context_host
                .stop_child(child_id, "a person stopped it")
                .await?;
            return Ok(json!({}));
        }
        self.call(&payload.chat_id, |reply| Command::StopSubagent {
            tool_use_id: payload.tool_use_id,
            reply,
        })
        .await
    }

    async fn unqueue(&self, payload: Value) -> RpcResult {
        let payload: QueuePayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Unqueue {
            message_id: payload.message_id,
            reply,
        })
        .await
    }

    async fn send_now(&self, payload: Value) -> RpcResult {
        let payload: QueuePayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::SendNow {
            message_id: payload.message_id,
            reply,
        })
        .await
    }

    async fn compact(&self, payload: Value) -> RpcResult {
        self.require_accepting()?;
        let payload: TargetPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Compact { reply })
            .await
    }

    async fn turn_diff(&self, payload: Value) -> RpcResult {
        let payload: TurnPayload = parse(payload)?;
        let source = self.runtime_view(&payload.chat_id).await?.ok_or_else(|| {
            RpcError::new("chat-not-found", format!("No chat {}", payload.chat_id))
        })?;
        let turn = source
            .items
            .iter()
            .find(|item| {
                item.get("kind").and_then(Value::as_str) == Some("turn")
                    && item.get("id").and_then(Value::as_str) == Some(&payload.turn_id)
            })
            .ok_or_else(|| {
                RpcError::new(
                    "request-not-found",
                    format!("No turn {} in chat {}", payload.turn_id, payload.chat_id),
                )
            })?;
        if let Some(diff) = turn.get("checkpointDiff").filter(|value| !value.is_null()) {
            return Ok(json!({ "diff": diff }));
        }
        let Some(tree) = turn.get("checkpoint").and_then(Value::as_str) else {
            return Ok(json!({ "diff": null }));
        };
        let cwd = source
            .info
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let diff = self.fork_host()?.diff_tree(cwd, tree).await?;
        Ok(json!({ "diff": diff }))
    }

    async fn configure(&self, payload: Value) -> RpcResult {
        let payload: ConfigurePayload = parse(payload)?;
        if let Some(mode) = payload.runtime_mode.as_deref()
            && !matches!(
                mode,
                "supervised" | "auto-accept-edits" | "auto" | "full-access"
            )
        {
            return Err(RpcError::new("invalid-request", "Invalid runtimeMode"));
        }
        let handle = self.require(&payload.chat_id).await?;
        let provider = handle
            .public
            .info
            .read()
            .await
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude")
            .to_owned();
        let selection = payload.selection.as_ref().map(|selection| {
            self.inner
                .providers
                .normalize_selection(&provider, Some(selection))
        });
        self.call(&payload.chat_id, |reply| Command::Configure {
            selection,
            runtime_mode: payload.runtime_mode,
            reply,
        })
        .await
    }

    fn set_preferences(&self, payload: Value, client_id: &str) -> RpcResult {
        let parsed: PreferencesPayload = parse(payload)?;
        for mode in [
            parsed.runtime_mode.as_deref(),
            parsed.terminal_runtime_mode.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !matches!(
                mode,
                "supervised" | "auto-accept-edits" | "auto" | "full-access"
            ) {
                return Err(RpcError::new("invalid-request", "Invalid runtimeMode"));
            }
        }
        let value = json!({
            "runtimeMode": parsed.runtime_mode,
            "terminalRuntimeMode": parsed.terminal_runtime_mode,
            "selections": parsed.selections,
            "changedAt": parsed.changed_at,
        });
        let mut preferences = self
            .inner
            .preferences
            .lock()
            .expect("chat preferences lock poisoned");
        preferences.told += 1;
        let told = preferences.told;
        preferences
            .by_client
            .insert(client_id.to_owned(), HeldPreference { value, told });
        Ok(json!({}))
    }

    fn starting_preference(&self, provider: &str) -> Option<Value> {
        let preferences = self
            .inner
            .preferences
            .lock()
            .expect("chat preferences lock poisoned");
        let newest = preferences.newest()?;
        let mut result = Map::new();
        if let Some(mode) = newest.get("runtimeMode").filter(|value| !value.is_null()) {
            result.insert("runtimeMode".into(), mode.clone());
        }
        if let Some(selection) = newest
            .get("selections")
            .and_then(|selections| selections.get(provider))
        {
            result.insert("selection".into(), selection.clone());
        }
        Some(Value::Object(result))
    }

    async fn cancel(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Cancel { reply })
            .await
    }

    async fn approve(&self, payload: Value) -> RpcResult {
        let payload: ApprovePayload = parse(payload)?;
        if !matches!(payload.decision.as_str(), "allow" | "allow-always" | "deny") {
            return Err(RpcError::new(
                "invalid-request",
                "Invalid approval decision",
            ));
        }
        self.call(&payload.chat_id, |reply| Command::Approve {
            request_id: payload.request_id,
            decision: payload.decision,
            message: payload.message,
            reply,
        })
        .await
    }

    async fn answer(&self, payload: Value) -> RpcResult {
        let payload: AnswerPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Answer {
            request_id: payload.request_id,
            answers: payload.answers,
            reply,
        })
        .await
    }

    async fn dismiss(&self, payload: Value) -> RpcResult {
        let payload: DismissPayload = parse(payload)?;
        self.call(&payload.chat_id, |reply| Command::Dismiss {
            item_id: payload.item_id,
            reply,
        })
        .await
    }

    async fn clear(&self, payload: Value) -> RpcResult {
        let payload: ClearPayload = parse(payload)?;
        let chat_id = payload.chat_id.clone();
        let result = self
            .call(&chat_id, |reply| Command::Clear {
                force: payload.force.unwrap_or(false),
                reply,
            })
            .await?;
        self.inner.attachments.remove_all(&chat_id).await?;
        Ok(result)
    }

    async fn kill(&self, payload: Value) -> RpcResult {
        let payload: TargetPayload = parse(payload)?;
        let result = self
            .call(&payload.chat_id, |reply| Command::Kill { reply })
            .await;
        self.release_subagent_chat(&payload.chat_id).await;
        result
    }

    async fn call(
        &self,
        chat_id: &str,
        make: impl FnOnce(oneshot::Sender<RpcResult>) -> Command,
    ) -> RpcResult {
        let handle = self.require(chat_id).await?;
        let (reply, result) = oneshot::channel();
        handle.commands.send(make(reply)).await.map_err(closed)?;
        result.await.map_err(closed)?
    }

    async fn require(&self, chat_id: &str) -> Result<ChatHandle, RpcError> {
        self.inner
            .chats
            .lock()
            .await
            .get(chat_id)
            .cloned()
            .ok_or_else(|| RpcError::new("chat-not-found", format!("Chat {chat_id} was not found")))
    }

    fn require_accepting(&self) -> Result<(), RpcError> {
        self.inner
            .accepting
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(shutting_down)
    }

    async fn list(&self) -> Vec<Value> {
        let chats = self
            .inner
            .chats
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut list = Vec::with_capacity(chats.len());
        for chat in chats {
            list.push(chat.public.info.read().await.clone());
        }
        list
    }
}

impl Actor {
    #[allow(clippy::too_many_arguments)]
    fn new(
        mut info: Value,
        stored: Option<StoredChat>,
        store: ChatStore,
        events: EventBus,
        public: Arc<PublicState>,
        command: Vec<String>,
        environment: HashMap<String, String>,
        accepting: Arc<AtomicBool>,
        bearers: Arc<std::sync::RwLock<HashMap<String, ChatBearer>>>,
        limits_sink: Option<LimitsSink>,
        fork_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatForkWorkspaceHost>>>>,
        context_host: Arc<std::sync::RwLock<Option<Weak<dyn ChatContextHost>>>>,
        process_nudge: SharedSink<ProcessNudge>,
    ) -> Self {
        let mut items = stored
            .as_ref()
            .map(|stored| stored.items.clone())
            .unwrap_or_default();
        let mut seq = stored.as_ref().map(|stored| stored.seq).unwrap_or(0);
        let recent_events = stored
            .as_ref()
            .map(|stored| stored.events.clone())
            .unwrap_or_default();
        let event_base = retained_event_base(seq, &recent_events);
        let events_since_snapshot = stored
            .as_ref()
            .map(|stored| stored.events.len())
            .unwrap_or(0);
        let journal_bytes = stored.as_ref().map(|stored| stored.log_bytes).unwrap_or(0);
        let reset_seq = stored.as_ref().map(|stored| stored.reset_seq).unwrap_or(0);
        let preambles = stored
            .as_ref()
            .map(|stored| stored.preambles.clone())
            .unwrap_or_default();
        let preamble_operations = stored
            .as_ref()
            .map(|stored| stored.preamble_operations.iter().cloned().collect())
            .unwrap_or_default();
        if let Some(stored) = &stored {
            for (event_seq, event) in &stored.events {
                apply_event(&mut info, &mut items, event);
                seq = seq.max(*event_seq);
            }
        }
        set(&mut info, "running", json!(false));
        if info
            .get("activeTurnId")
            .is_some_and(|value| !value.is_null())
        {
            set(&mut info, "status", json!("running"));
        }
        let item_index = index_items(&items);
        let chat_id = info
            .get("chatId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let provider = info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude");
        let provider_name = if provider == "claude" {
            "Claude Code"
        } else {
            "Codex"
        };
        let suffix = Uuid::new_v4()
            .simple()
            .to_string()
            .chars()
            .take(6)
            .collect();
        let backend = BackendNormalizer::new(provider);
        let projector =
            ThreadProjector::new(info.clone(), items.clone(), provider_name, now(), suffix);
        let claude_projects = environment
            .get("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                environment
                    .get("HOME")
                    .map(|home| Path::new(home).join(".claude"))
            })
            .unwrap_or_default()
            .join("projects");
        let mut title_candidates = vec![TitleCommand {
            provider: provider.to_owned(),
            command: base_chat_command(&command, provider),
        }];
        for fallback in ["claude", "codex", "gemini"] {
            if fallback != provider {
                title_candidates.push(TitleCommand {
                    provider: fallback.to_owned(),
                    command: vec![fallback.to_owned()],
                });
            }
        }
        Self {
            chat_id,
            info,
            items,
            item_index,
            seq,
            reset_seq,
            events_since_snapshot,
            journal_bytes,
            event_base,
            recent_events,
            viewers: HashSet::new(),
            store,
            events,
            public,
            command,
            environment,
            process: None,
            generation: 0,
            process_exit: None,
            stdout_closed: false,
            pending_codex_text: None,
            pending_codex_attachments: Vec::new(),
            pending_codex_compact: false,
            codex_ready: false,
            codex_resuming: false,
            codex_launch_prompt: None,
            codex_thread_frame: None,
            codex_model_cursors: HashSet::new(),
            codex_image_input_supported: None,
            codex_context_pending: false,
            codex_rpc_id: 10,
            pending_resume: None,
            accepting,
            backend,
            projector,
            bearers,
            bearer_token: None,
            last_persist_error: None,
            preambles,
            preamble_operations,
            limits_sink,
            fork_host,
            context_host,
            process_nudge,
            claude_titles: ClaudeTitleReader::new(claude_projects.clone()),
            claude_projects,
            title_candidates,
            title_cancel: CancellationToken::new(),
            naming: false,
        }
    }

    async fn run(
        &mut self,
        mut commands: mpsc::Receiver<Command>,
        mut process_events: mpsc::Receiver<ProcessEvent>,
        process_tx: mpsc::Sender<ProcessEvent>,
    ) {
        self.settle_orphaned_subagents(self.running_background_subagents(), true)
            .await;
        self.publish().await;
        loop {
            tokio::select! {
                command = commands.recv() => {
                    let Some(command) = command else { break };
                    if self.handle_command(command, &process_tx).await { break; }
                }
                event = process_events.recv() => {
                    if let Some(event) = event { self.handle_process(event, &process_tx).await; }
                }
            }
        }
    }

    async fn handle_command(
        &mut self,
        command: Command,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> bool {
        match command {
            Command::Inspect { reply } => {
                let _ = reply.send(ChatRuntimeState {
                    info: self.info.clone(),
                    items: self.items.clone(),
                    seq: self.seq,
                    generation: self.generation,
                });
            }
            Command::Attach {
                client_id,
                history_limit,
                since,
                reply,
            } => {
                self.viewers.insert(client_id);
                let result = if let Some(events) = since.and_then(|since| self.events_after(since))
                {
                    json!({ "info": self.info, "items": [], "events": events, "seq": self.seq })
                } else if let Some(limit) = history_limit {
                    let (items, history) = self.history_page(self.items.len(), limit.clamp(1, 100));
                    let pending = self.pending_items();
                    json!({ "info": self.info, "items": items, "history": history, "pending": pending, "seq": self.seq })
                } else {
                    json!({ "info": self.info, "items": self.items, "seq": self.seq })
                };
                let _ = reply.send(Ok(result));
            }
            Command::History {
                cursor,
                limit,
                reply,
            } => {
                let parts = cursor.split(':').collect::<Vec<_>>();
                let end = parts.get(1).and_then(|part| part.parse::<usize>().ok());
                let generation = parts.first().and_then(|part| part.parse::<u64>().ok());
                if parts.len() != 2
                    || generation != Some(self.reset_seq)
                    || end.is_none_or(|end| end > self.items.len())
                {
                    let _ = reply.send(Err(RpcError::new(
                        "history-expired",
                        "The conversation changed. Reload its history.",
                    )));
                } else {
                    let (items, history) = self.history_page(end.unwrap(), limit);
                    let _ = reply.send(Ok(json!({ "items": items, "history": history })));
                }
            }
            Command::Detach { client_id } => {
                self.viewers.remove(&client_id);
            }
            Command::Send {
                text,
                mentions,
                skills,
                attachments,
                reply,
            } => {
                let result = if self.active_turn().is_some() {
                    self.queue_message(text, mentions, skills, attachments)
                        .await
                } else {
                    self.start_turn(text, None, None, mentions, skills, attachments, process_tx)
                        .await
                };
                let _ = reply.send(result);
            }
            Command::Unqueue { message_id, reply } => {
                let result = self.unqueue_message(&message_id).await;
                let _ = reply.send(result);
            }
            Command::SendNow { message_id, reply } => {
                let result = self.send_queued_now(&message_id, process_tx).await;
                let _ = reply.send(result);
            }
            Command::Compact { reply } => {
                let result = self.compact_context(process_tx).await;
                let _ = reply.send(result);
            }
            Command::RuntimeStart {
                text,
                operation_id,
                reply,
            } => {
                let result = self
                    .start_turn(
                        text,
                        None,
                        Some(operation_id),
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                        process_tx,
                    )
                    .await;
                let _ = reply.send(result);
            }
            Command::Resume {
                turn_id,
                attempt,
                reply,
            } => match self.resume_turn(&turn_id, attempt, process_tx).await {
                Ok(Some(result)) => {
                    let _ = reply.send(Ok(result));
                }
                Ok(None) => {
                    self.pending_resume = Some(PendingResume {
                        turn_id,
                        attempt,
                        reply,
                    });
                }
                Err(error) => {
                    let _ = reply.send(Err(error));
                }
            },
            Command::Wake {
                text,
                label,
                note,
                task_ids,
                summary_for,
                operation_id,
                reply,
            } => {
                let result = self
                    .wake_turn(
                        text,
                        label,
                        note,
                        task_ids,
                        summary_for,
                        operation_id,
                        process_tx,
                    )
                    .await;
                let _ = reply.send(result);
            }
            Command::Configure {
                selection,
                runtime_mode,
                reply,
            } => {
                if self.active_turn().is_some() {
                    let _ = reply.send(Err(RpcError::new(
                        "chat-busy",
                        "The chat has an active turn",
                    )));
                } else {
                    let next_selection = selection
                        .as_ref()
                        .unwrap_or_else(|| &self.info["selection"]);
                    let next_mode = runtime_mode.as_deref().unwrap_or_else(|| {
                        self.info
                            .get("runtimeMode")
                            .and_then(Value::as_str)
                            .unwrap_or("full-access")
                    });
                    let changed = next_selection != &self.info["selection"]
                        || self.info.get("runtimeMode").and_then(Value::as_str) != Some(next_mode);
                    if changed {
                        if let Some(selection) = selection {
                            let context_window = selection
                                .pointer("/options/contextWindow")
                                .and_then(Value::as_str)
                                .and_then(|window| match window {
                                    "1m" => Some(1_000_000),
                                    "200k" => Some(200_000),
                                    _ => None,
                                });
                            set(&mut self.info, "selection", selection);
                            if let Some(context_window) = context_window
                                && let Some(usage) = self.info.get_mut("usage")
                            {
                                set(usage, "contextWindow", json!(context_window));
                            }
                        }
                        if let Some(mode) = runtime_mode {
                            set(&mut self.info, "runtimeMode", json!(mode));
                        }
                        let base = base_chat_command(&self.command, self.provider());
                        self.command = build_chat_command(base, self.provider(), &self.info);
                        if let Some(process) = self.process.take() {
                            process.terminate(libc::SIGTERM);
                            self.generation += 1;
                            self.revoke_bearer();
                            self.public.pid.store(0, Ordering::Release);
                            self.process_exit = None;
                            self.stdout_closed = false;
                            self.codex_ready = false;
                            set(&mut self.info, "running", json!(false));
                        }
                        self.emit_info().await;
                    }
                    let _ = reply.send(Ok(self.info.clone()));
                }
            }
            Command::Approve {
                request_id,
                decision,
                message,
                reply,
            } => {
                let result = self
                    .approve_request(&request_id, &decision, message.as_deref())
                    .await;
                let _ = reply.send(result);
            }
            Command::Answer {
                request_id,
                answers,
                reply,
            } => {
                let result = self.answer_request(&request_id, answers).await;
                let _ = reply.send(result);
            }
            Command::Dismiss { item_id, reply } => {
                let result = self.dismiss_request(&item_id).await;
                let _ = reply.send(result);
            }
            Command::DeliverNote {
                operation_id,
                note_id,
                note,
                from,
                preamble,
                reply,
            } => {
                let result = self
                    .deliver_note(operation_id, note_id, note, from, preamble)
                    .await;
                let _ = reply.send(result);
            }
            Command::QueuePreamble {
                operation_id,
                text,
                reply,
            } => {
                let result = self.queue_preamble(operation_id, text).await;
                let _ = reply.send(result);
            }
            Command::SyncTask { task, reply } => {
                let result = self.sync_task_row(task).await;
                let _ = reply.send(result);
            }
            Command::Cancel { reply } => {
                self.interrupt_turn(process_tx).await;
                let _ = reply.send(Ok(json!({})));
            }
            Command::Clear { force, reply } => {
                if self.active_turn().is_some() && !force {
                    let _ = reply.send(Err(RpcError::new(
                        "chat-busy",
                        "The chat has an active turn",
                    )));
                } else {
                    if let Some(process) = self.process.take() {
                        process.terminate(libc::SIGKILL);
                    }
                    self.generation = self.generation.wrapping_add(1);
                    self.title_cancel.cancel();
                    self.title_cancel = CancellationToken::new();
                    self.naming = false;
                    self.revoke_bearer();
                    self.process_exit = None;
                    self.stdout_closed = false;
                    self.codex_ready = false;
                    self.pending_codex_text = None;
                    self.pending_codex_attachments.clear();
                    self.items.clear();
                    self.item_index.clear();
                    self.reset_seq = self.seq + 1;
                    set(&mut self.info, "agentSessionId", Value::Null);
                    set(&mut self.info, "running", json!(false));
                    set(&mut self.info, "activeTurnId", Value::Null);
                    set(&mut self.info, "status", json!("idle"));
                    set(&mut self.info, "queue", json!([]));
                    set(&mut self.info, "slashCommands", json!([]));
                    if let Some(usage) = self.info.get_mut("usage") {
                        set(usage, "contextTokens", json!(0));
                    }
                    self.emit(json!({ "type": "reset", "info": self.info, "items": [] }))
                        .await;
                    let _ = reply.send(Ok(json!({})));
                }
            }
            Command::Kill { reply } => {
                self.title_cancel.cancel();
                self.revoke_bearer();
                if let Some(process) = &self.process {
                    process.terminate(libc::SIGKILL);
                }
                let _ = reply.send(Ok(json!({})));
            }
            Command::RuntimeStop { reply } => {
                if self.active_turn().is_some() {
                    self.finish_turn("aborted", 0.0, None).await;
                }
                self.title_cancel.cancel();
                self.revoke_bearer();
                if let Some(process) = &self.process {
                    process.terminate(libc::SIGTERM);
                }
                let _ = reply.send(Ok(json!({})));
            }
            Command::StopSubagent { tool_use_id, reply } => {
                let result = self.stop_subagent(&tool_use_id).await;
                let _ = reply.send(result);
            }
            Command::NoteSubagentNative {
                tool_use_id,
                agent_id,
                reply,
            } => {
                let result = self.note_subagent_native(&tool_use_id, &agent_id).await;
                let _ = reply.send(result);
            }
            Command::BeginShutdown { reply } => {
                self.title_cancel.cancel();
                self.revoke_bearer();
                if let Some(process) = &self.process {
                    process.terminate(libc::SIGKILL);
                }
                let _ = reply.send(());
            }
            Command::Shutdown { reply } => {
                self.title_cancel.cancel();
                self.revoke_bearer();
                if let Some(process) = &self.process {
                    process.terminate(libc::SIGKILL);
                }
                let _ = self.persist_snapshot().await;
                let _ = reply.send(());
                return true;
            }
        }
        false
    }

    #[allow(clippy::too_many_arguments)]
    async fn start_turn(
        &mut self,
        text: String,
        requested_turn_id: Option<String>,
        operation_id: Option<Uuid>,
        mentions: Vec<String>,
        skills: Vec<String>,
        attachments: Vec<Value>,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> RpcResult {
        if let Some(operation_id) = operation_id {
            let operation_id = operation_id.to_string();
            if let Some(existing) = self.items.iter().find(|item| {
                item.get("kind").and_then(Value::as_str) == Some("turn")
                    && item.get("operationId").and_then(Value::as_str)
                        == Some(operation_id.as_str())
            }) {
                return Ok(json!({ "queued": false, "turnId": existing.get("id") }));
            }
        }
        if !self.accepting.load(Ordering::Acquire) {
            return Err(shutting_down());
        }
        if self.active_turn().is_some() {
            return Err(RpcError::new("chat-busy", "The chat has an active turn"));
        }
        let previous = self.durable_start_state();
        let turn_id = requested_turn_id.unwrap_or_else(|| format!("turn-{}", Uuid::new_v4()));
        let at = now();
        let mut turn = json!({ "id": turn_id, "createdAt": at, "turnId": turn_id, "kind": "turn", "origin": "user", "state": "running", "endedAt": null, "costUsd": 0.0 });
        if let Some(operation_id) = operation_id {
            turn["operationId"] = json!(operation_id);
        }
        self.upsert(turn).await;
        self.checkpoint_turn(&turn_id).await;
        let mut user = json!({
            "id": format!("user-{}", Uuid::new_v4()),
            "createdAt": at,
            "turnId": turn_id,
            "kind": "user",
            "text": text,
        });
        if !mentions.is_empty() {
            user["mentions"] = json!(mentions);
        }
        if !skills.is_empty() {
            user["skills"] = json!(skills);
        }
        if !attachments.is_empty() {
            user["attachments"] = json!(attachments);
        }
        self.upsert(user).await;
        let (prompt, preamble) = match self.prompt_for_turn(&text).await {
            Ok(prompt) => prompt,
            Err(error) => {
                self.note("error", &error.message).await;
                self.finish_turn("error", 0.0, None).await;
                return Err(error);
            }
        };
        if let Some(preamble) = &preamble {
            self.upsert(json!({
                "id": format!("note-{}", Uuid::new_v4()), "kind": "note", "createdAt": at,
                "turnId": turn_id, "level": "info", "text": preamble,
            }))
            .await;
        }
        set(&mut self.info, "activeTurnId", json!(turn_id));
        set(&mut self.info, "status", json!("running"));
        self.emit_info().await;
        if let Err(error) = self.persistence_result() {
            self.restore_durable_start(previous).await;
            return Err(error);
        }
        if let Err(error) = self.ensure_process(process_tx).await {
            self.note("error", &error.message).await;
            self.finish_turn("error", 0.0, None).await;
            return Err(error);
        }
        let delivered = if self.provider() == "claude" {
            let frame = input::claude_user_frame(
                &prompt,
                preamble.as_deref(),
                self.info
                    .pointer("/selection/options/effort")
                    .and_then(Value::as_str)
                    == Some("ultrathink"),
                &skills,
                &attachments,
            );
            self.process
                .as_ref()
                .unwrap()
                .send(&frame)
                .map_err(agent_error)
        } else if self.codex_ready {
            self.send_codex_turn(
                input::text_prompt(&prompt, preamble.as_deref(), &attachments),
                &attachments,
            )
            .map_err(agent_error)
        } else {
            self.pending_codex_text = Some(input::text_prompt(
                &prompt,
                preamble.as_deref(),
                &attachments,
            ));
            self.pending_codex_attachments = attachments;
            Ok(())
        };
        if let Err(error) = delivered {
            self.note("error", &error.message).await;
            self.finish_turn("error", 0.0, None).await;
            return Err(error);
        }
        self.persistence_result()?;
        Ok(json!({ "queued": false, "turnId": turn_id }))
    }

    async fn queue_message(
        &mut self,
        text: String,
        mentions: Vec<String>,
        skills: Vec<String>,
        attachments: Vec<Value>,
    ) -> RpcResult {
        let turn_id = format!("turn-{}", Uuid::new_v4());
        let message_id = format!("queued-{}", Uuid::new_v4());
        let mut message = json!({
            "id": message_id,
            "turnId": turn_id,
            "text": text,
            "createdAt": now(),
        });
        if !mentions.is_empty() {
            message["mentions"] = json!(mentions);
        }
        if !skills.is_empty() {
            message["skills"] = json!(skills);
        }
        if !attachments.is_empty() {
            message["attachments"] = json!(attachments);
        }
        let mut queue = self.queue();
        queue.push(message);
        set(&mut self.info, "queue", Value::Array(queue));
        self.emit_info().await;
        self.persistence_result()?;
        Ok(json!({ "queued": true, "turnId": turn_id }))
    }

    async fn unqueue_message(&mut self, message_id: &str) -> RpcResult {
        let mut queue = self.queue();
        let before = queue.len();
        queue.retain(|message| message.get("id").and_then(Value::as_str) != Some(message_id));
        if queue.len() == before {
            return Err(RpcError::new(
                "request-not-found",
                format!("No queued message {message_id} in chat {}", self.chat_id),
            ));
        }
        set(&mut self.info, "queue", Value::Array(queue));
        self.emit_info().await;
        self.persistence_result()?;
        Ok(json!({}))
    }

    async fn send_queued_now(
        &mut self,
        message_id: &str,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> RpcResult {
        let mut queue = self.queue();
        let Some(index) = queue
            .iter()
            .position(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        else {
            return Err(RpcError::new(
                "request-not-found",
                format!("No queued message {message_id} in chat {}", self.chat_id),
            ));
        };
        let previous_info = self.info.clone();
        let message = queue.remove(index);
        queue.insert(0, message);
        set(&mut self.info, "queue", Value::Array(queue));
        self.emit_info().await;
        if let Err(error) = self.persistence_result() {
            self.info = previous_info;
            self.publish().await;
            return Err(error);
        }
        if self.active_turn().is_some() {
            self.interrupt_turn(process_tx).await;
        } else {
            self.drain_queue(process_tx).await?;
        }
        self.persistence_result()?;
        Ok(json!({}))
    }

    async fn drain_queue(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) -> RpcResult {
        if self.active_turn().is_some() {
            return Ok(json!({}));
        }
        let mut queue = self.queue();
        if queue.is_empty() {
            return Ok(json!({}));
        }
        let previous_info = self.info.clone();
        let message = queue.remove(0);
        set(&mut self.info, "queue", Value::Array(queue));
        self.emit_info().await;
        if let Err(error) = self.persistence_result() {
            self.info = previous_info;
            self.publish().await;
            return Err(error);
        }
        let text = message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let turn_id = message
            .get("turnId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mentions = string_array(message.get("mentions"));
        let skills = string_array(message.get("skills"));
        let attachments = message
            .get("attachments")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        self.start_turn(
            text,
            turn_id,
            None,
            mentions,
            skills,
            attachments,
            process_tx,
        )
        .await
    }

    fn queue(&self) -> Vec<Value> {
        self.info
            .get("queue")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    }

    async fn compact_context(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) -> RpcResult {
        if self.active_turn().is_some() {
            return Err(RpcError::new(
                "chat-busy",
                format!(
                    "Chat {} is still working on the previous message",
                    self.chat_id
                ),
            ));
        }
        if self.provider() == "claude" {
            return self
                .start_turn(
                    "/compact".into(),
                    None,
                    None,
                    Vec::new(),
                    Vec::new(),
                    Vec::new(),
                    process_tx,
                )
                .await
                .map(|_| json!({}));
        }
        let previous = self.durable_start_state();
        let turn_id = format!("turn-{}", Uuid::new_v4());
        self.upsert(json!({
            "id": turn_id,
            "createdAt": now(),
            "turnId": null,
            "kind": "turn",
            "state": "running",
            "endedAt": null,
            "costUsd": 0.0,
        }))
        .await;
        set(&mut self.info, "activeTurnId", json!(turn_id));
        set(&mut self.info, "status", json!("running"));
        self.emit_info().await;
        if let Err(error) = self.persistence_result() {
            self.restore_durable_start(previous).await;
            return Err(error);
        }
        if let Err(error) = self.ensure_process(process_tx).await {
            self.note("error", &error.message).await;
            self.finish_turn("error", 0.0, None).await;
            return Err(error);
        }
        if self.codex_ready {
            self.send_codex_compact().map_err(agent_error)?;
        } else {
            self.pending_codex_compact = true;
        }
        self.persistence_result()?;
        Ok(json!({}))
    }

    #[allow(clippy::too_many_arguments)]
    async fn wake_turn(
        &mut self,
        text: String,
        label: String,
        note: Option<String>,
        task_ids: Vec<String>,
        summary_for: Option<String>,
        operation_id: Uuid,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> RpcResult {
        let operation_key = operation_id.to_string();
        if let Some(existing) = self.items.iter().find(|item| {
            item.get("kind").and_then(Value::as_str) == Some("turn")
                && item.get("operationId").and_then(Value::as_str) == Some(operation_key.as_str())
        }) {
            return Ok(json!({ "turnId": existing.get("id") }));
        }
        if !self.accepting.load(Ordering::Acquire) {
            return Err(shutting_down());
        }
        if self.active_turn().is_some() {
            return Err(RpcError::new("chat-busy", "The chat has an active turn"));
        }
        let previous = self.durable_start_state();
        let turn_id = format!("turn-{}", Uuid::new_v4());
        let at = now();
        let mut turn = json!({
            "id": turn_id,
            "createdAt": at,
            "turnId": turn_id,
            "kind": "turn",
            "state": "running",
            "origin": "agent",
            "label": label,
            "operationId": operation_id,
            "endedAt": null,
            "costUsd": 0,
        });
        if !task_ids.is_empty() {
            turn["taskIds"] = json!(task_ids);
        }
        if let Some(summary_for) = summary_for {
            turn["summaryFor"] = json!(summary_for);
        }
        self.upsert(turn).await;
        self.checkpoint_turn(&turn_id).await;
        if let Some(note) = note {
            self.upsert(json!({
                "id": format!("note-{}", Uuid::new_v4()),
                "createdAt": at,
                "turnId": turn_id,
                "kind": "note",
                "level": "info",
                "text": note,
            }))
            .await;
        }
        let (prompt, preamble) = match self.prompt_for_turn(&text).await {
            Ok(prompt) => prompt,
            Err(error) => {
                self.note("error", &error.message).await;
                self.finish_turn("error", 0.0, None).await;
                return Err(error);
            }
        };
        if let Some(preamble) = &preamble {
            self.upsert(json!({
                "id": format!("note-{}", Uuid::new_v4()), "kind": "note", "createdAt": at,
                "turnId": turn_id, "level": "info", "text": preamble,
            }))
            .await;
        }
        set(&mut self.info, "activeTurnId", json!(turn_id));
        set(&mut self.info, "status", json!("running"));
        self.emit_info().await;
        if let Err(error) = self.persistence_result() {
            self.restore_durable_start(previous).await;
            return Err(error);
        }
        if let Err(error) = self.ensure_process(process_tx).await {
            self.note("error", &error.message).await;
            self.finish_turn("error", 0.0, None).await;
            return Err(error);
        }
        let delivered = if self.provider() == "claude" {
            self.process
                .as_ref()
                .unwrap()
                .send(&input::claude_user_frame(
                    &prompt,
                    preamble.as_deref(),
                    self.info
                        .pointer("/selection/options/effort")
                        .and_then(Value::as_str)
                        == Some("ultrathink"),
                    &[],
                    &[],
                ))
                .map_err(agent_error)
        } else if self.codex_ready {
            self.send_codex_turn(input::text_prompt(&prompt, preamble.as_deref(), &[]), &[])
                .map_err(agent_error)
        } else {
            self.pending_codex_text = Some(input::text_prompt(&prompt, preamble.as_deref(), &[]));
            Ok(())
        };
        if let Err(error) = delivered {
            self.note("error", &error.message).await;
            self.finish_turn("error", 0.0, None).await;
            return Err(error);
        }
        self.persistence_result()?;
        Ok(json!({ "turnId": turn_id }))
    }

    async fn ensure_process(
        &mut self,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> Result<(), RpcError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(shutting_down());
        }
        if self.process.is_some() {
            return Ok(());
        }
        self.revoke_bearer();
        self.generation += 1;
        let bearer = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.bearers
            .write()
            .expect("chat bearer lock poisoned")
            .insert(
                bearer.clone(),
                ChatBearer {
                    chat_id: self.chat_id.clone(),
                    generation: self.generation,
                },
            );
        self.environment
            .insert("RUIMTE_CONTEXT_TOKEN".to_owned(), bearer.clone());
        self.bearer_token = Some(bearer);
        self.backend = BackendNormalizer::with_generation(self.provider(), self.generation);
        self.process_exit = None;
        self.stdout_closed = false;
        self.codex_ready = false;
        self.codex_resuming = false;
        self.codex_launch_prompt = None;
        self.codex_thread_frame = None;
        self.codex_model_cursors.clear();
        self.codex_image_input_supported = None;
        self.codex_context_pending = false;
        let context_host = {
            let host = self
                .context_host
                .read()
                .expect("chat context host lock poisoned");
            host.as_ref().and_then(Weak::upgrade)
        };
        let launch_facts = if let Some(host) = context_host {
            host.launch_facts(&self.chat_id).await?
        } else {
            ChatLaunchFacts::default()
        };
        let launch_prompt = context::chat_prompt(&launch_facts);
        let cwd = Path::new(self.info.get("cwd").and_then(Value::as_str).unwrap_or("."));
        let mut command = self.command.clone();
        if self.provider() == "claude" {
            command.extend(["--append-system-prompt".to_owned(), launch_prompt.clone()]);
        }
        let process = match process::spawn(
            &command,
            cwd,
            &self.environment,
            self.generation,
            process_tx.clone(),
        ) {
            Ok(process) => process,
            Err(error) => {
                self.revoke_bearer();
                return Err(agent_error(error));
            }
        };
        self.public.pid.store(process.pid, Ordering::Release);
        set(&mut self.info, "running", json!(true));
        self.emit_info().await;
        self.process = Some(process);
        if self.provider() == "codex" {
            self.codex_resuming = self
                .info
                .get("agentSessionId")
                .is_some_and(|id| !id.is_null());
            self.codex_context_pending = self.codex_resuming && launch_facts.has_context;
            self.codex_launch_prompt = Some(launch_prompt);
            self.process
                .as_ref()
                .unwrap()
                .send(&json!({
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "clientInfo": {
                            "name": "ruimte",
                            "title": "Ruimte",
                            "version": crate::VERSION,
                        },
                        "capabilities": {
                            "experimentalApi": true,
                            "requestAttestation": false,
                        }
                    }
                }))
                .map_err(agent_error)?;
        }
        Ok(())
    }

    async fn resume_turn(
        &mut self,
        turn_id: &str,
        attempt: u32,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> Result<Option<Value>, RpcError> {
        if self.pending_resume.is_some() {
            return Err(RpcError::new(
                "chat-busy",
                "The interrupted turn is already being resumed",
            ));
        }
        let Some(index) = self.item_index.get(turn_id).copied() else {
            return Ok(Some(json!({ "resumed": false })));
        };
        let current_attempt = self.items[index]
            .get("attempt")
            .and_then(Value::as_u64)
            .unwrap_or(1);
        let awaits_resume = self.items[index].get("kind").and_then(Value::as_str) == Some("turn")
            && self.items[index].get("state").and_then(Value::as_str) == Some("running")
            && self.active_turn() == Some(turn_id)
            && current_attempt < u64::from(attempt);
        if !awaits_resume {
            return Ok(Some(json!({ "resumed": false })));
        }
        self.ensure_process(process_tx).await?;
        if self.provider() == "codex" && !self.codex_ready {
            return Ok(None);
        }
        self.perform_resume(turn_id, attempt).await.map(Some)
    }

    async fn perform_resume(&mut self, turn_id: &str, attempt: u32) -> RpcResult {
        let Some(index) = self.item_index.get(turn_id).copied() else {
            return Ok(json!({ "resumed": false }));
        };
        let current_attempt = self.items[index]
            .get("attempt")
            .and_then(Value::as_u64)
            .unwrap_or(1);
        if self.items[index].get("kind").and_then(Value::as_str) != Some("turn")
            || self.items[index].get("state").and_then(Value::as_str) != Some("running")
            || self.active_turn() != Some(turn_id)
            || current_attempt >= u64::from(attempt)
        {
            return Ok(json!({ "resumed": false }));
        }
        let previous = self.durable_start_state();
        set(&mut self.items[index], "attempt", json!(attempt));
        self.emit_item_at(index).await;
        self.upsert(json!({
            "id": format!("note-{}", Uuid::new_v4()),
            "kind": "note",
            "createdAt": now(),
            "turnId": turn_id,
            "level": "info",
            "text": "Resumed after the machine restarted",
        }))
        .await;
        if let Err(error) = self.persistence_result() {
            self.restore_durable_start(previous).await;
            return Err(error);
        }
        if self.provider() == "claude" {
            self.process
                .as_ref()
                .ok_or_else(|| RpcError::new("chat-process", "Claude is not running"))?
                .send(&json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": RESUME_PROMPT }],
                    },
                    "parent_tool_use_id": null,
                    "session_id": "",
                }))
                .map_err(agent_error)?;
        } else {
            self.send_codex_turn(RESUME_PROMPT.to_owned(), &[])
                .map_err(agent_error)?;
        }
        self.persistence_result()?;
        Ok(json!({ "resumed": true }))
    }

    fn send_codex_turn(&mut self, text: String, attachments: &[Value]) -> anyhow::Result<()> {
        self.codex_rpc_id += 1;
        let images = attachments
            .iter()
            .filter_map(|attachment| {
                let name = attachment.get("name")?.as_str()?;
                let mime = attachment.get("mime")?.as_str()?;
                attachment_image_mime(name, mime)?;
                Some(json!({ "type": "localImage", "path": attachment.get("path")? }))
            })
            .collect::<Vec<_>>();
        if !images.is_empty() && self.codex_image_input_supported == Some(false) {
            let model = self
                .info
                .pointer("/selection/model")
                .and_then(Value::as_str)
                .unwrap_or("This model");
            anyhow::bail!(
                "{model} does not support image input. Choose a model that accepts images."
            );
        }
        let text = if self.codex_context_pending {
            self.codex_context_pending = false;
            format!(
                "{}\n\n{text}",
                self.codex_launch_prompt.as_deref().unwrap_or_default()
            )
        } else {
            text
        };
        let mut input = vec![json!({ "type": "text", "text": text, "text_elements": [] })];
        input.extend(images);
        let mut params = json!({
            "threadId": self.info.get("agentSessionId"),
            "input": input,
            "model": self.info.pointer("/selection/model"),
            "effort": self.info.pointer("/selection/options/effort"),
        });
        if let Some(tier) = codex_service_tier(&self.info) {
            set(&mut params, "serviceTier", json!(tier));
        }
        self.process
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Codex is not running"))?
            .send(&json!({
                "id": self.codex_rpc_id,
                "method": "turn/start",
                "params": params,
            }))
    }

    fn send_codex_compact(&mut self) -> anyhow::Result<()> {
        self.codex_rpc_id += 1;
        self.process
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Codex is not running"))?
            .send(&json!({
                "id": self.codex_rpc_id,
                "method": "thread/compact/start",
                "params": { "threadId": self.info.get("agentSessionId") },
            }))
    }

    async fn stop_subagent(&mut self, tool_use_id: &str) -> RpcResult {
        let Some(index) = self.items.iter().position(|item| {
            item.get("kind").and_then(Value::as_str) == Some("subagent")
                && item.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id)
        }) else {
            return Err(RpcError::new(
                "subagent-not-found",
                "This chat has no such sub-agent",
            ));
        };
        if self.items[index].get("status").and_then(Value::as_str) != Some("running") {
            return Ok(json!({}));
        }
        if self.items[index].get("origin").and_then(Value::as_str) == Some("ruimte") {
            return Err(RpcError::new(
                "chat-unsupported",
                "This task must be stopped through its child node",
            ));
        }
        if self.active_turn().is_some() {
            return Err(RpcError::new(
                "chat-busy",
                "A turn is running; stop the turn instead",
            ));
        }
        let name = self.items[index]
            .get("description")
            .or_else(|| self.items[index].get("subagentType"))
            .and_then(Value::as_str)
            .unwrap_or("Sub-agent")
            .to_owned();
        set(&mut self.items[index], "status", json!("failed"));
        set(&mut self.items[index], "finishedAt", json!(now()));
        self.emit_item_at(index).await;
        self.upsert(json!({
            "id": format!("note-{}", Uuid::new_v4()),
            "kind": "note",
            "createdAt": now(),
            "turnId": null,
            "level": "info",
            "text": format!("\"{name}\" was marked as stopped. {} cannot stop one sub-agent on its own, so it may keep working until the chat's process ends.", if self.provider() == "claude" { "Claude Code" } else { "Codex" }),
        })).await;
        self.persistence_result()?;
        Ok(json!({}))
    }

    async fn interrupt_turn(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) {
        let Some(turn_id) = self.active_turn().map(str::to_owned) else {
            return;
        };
        if let Some(process) = &self.process {
            let sent = if self.provider() == "claude" {
                process.send(&json!({
                    "type": "control_request",
                    "request_id": format!("interrupt-{}", Uuid::new_v4()),
                    "request": { "subtype": "interrupt" },
                }))
            } else if let Some(native_turn_id) = self.backend.codex_turn_id() {
                self.codex_rpc_id += 1;
                process.send(&json!({
                    "id": self.codex_rpc_id,
                    "method": "turn/interrupt",
                    "params": {
                        "threadId": self.info.get("agentSessionId"),
                        "turnId": native_turn_id,
                    },
                }))
            } else {
                Ok(())
            };
            if sent.is_err() {
                process.terminate(libc::SIGTERM);
                return;
            }
            let events = process_tx.clone();
            let generation = self.generation;
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let _ = events
                    .send(ProcessEvent::InterruptTimeout {
                        generation,
                        turn_id,
                    })
                    .await;
            });
        } else {
            self.finish_turn("aborted", 0.0, None).await;
            let _ = self.drain_queue(process_tx).await;
        }
    }

    async fn handle_process(
        &mut self,
        event: ProcessEvent,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) {
        let generation = match &event {
            ProcessEvent::Frame { generation, .. }
            | ProcessEvent::ProtocolError { generation, .. }
            | ProcessEvent::StdoutClosed { generation }
            | ProcessEvent::Exited { generation, .. }
            | ProcessEvent::InterruptTimeout { generation, .. }
            | ProcessEvent::SuggestedTitle { generation, .. } => *generation,
        };
        if generation != self.generation {
            return;
        }
        match event {
            ProcessEvent::Frame { frame, .. } => {
                if self.provider() == "codex" && self.handle_codex_startup(&frame, process_tx).await
                {
                    return;
                }
                self.handle_backend_frame(&frame, process_tx).await;
            }
            ProcessEvent::ProtocolError { message, .. } => {
                self.project_backend(json!({ "type": "note", "level": "error", "text": message }))
                    .await;
            }
            ProcessEvent::StdoutClosed { .. } => {
                self.stdout_closed = true;
                self.finish_exit(process_tx).await;
            }
            ProcessEvent::Exited { code, .. } => {
                self.process_exit = Some(code);
                self.finish_exit(process_tx).await;
            }
            ProcessEvent::InterruptTimeout { turn_id, .. } => {
                if self.active_turn() == Some(turn_id.as_str())
                    && let Some(process) = &self.process
                {
                    process.terminate(libc::SIGTERM);
                }
            }
            ProcessEvent::SuggestedTitle {
                agent_session_id,
                title,
                only_if_absent,
                set_backend,
                ..
            } => {
                if set_backend {
                    self.naming = false;
                }
                if self.info.get("agentSessionId").and_then(Value::as_str)
                    != Some(agent_session_id.as_str())
                    || (only_if_absent && self.info.get("suggestedTitle").is_some())
                {
                    return;
                }
                if let Some(title) = title {
                    self.apply_suggested_title(title, set_backend).await;
                }
            }
        }
    }

    async fn handle_codex_startup(
        &mut self,
        frame: &Value,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) -> bool {
        match frame.get("id").and_then(Value::as_u64) {
            Some(1) => {
                if let Some(message) = frame.pointer("/error/message").and_then(Value::as_str) {
                    self.fail_pending_resume(message);
                    self.project_backend(json!({ "type": "failed", "message": message }))
                        .await;
                    if let Some(process) = &self.process {
                        process.terminate(libc::SIGTERM);
                    }
                } else {
                    let result = self
                        .process
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("Codex is not running"))
                        .and_then(|process| {
                            process.send(&json!({ "method": "initialized", "params": {} }))
                        })
                        .and_then(|_| self.send_codex_thread_request(self.codex_resuming));
                    if let Err(error) = result {
                        self.fail_pending_resume(&error.to_string());
                        self.project_backend(json!({
                            "type": "failed",
                            "message": error.to_string(),
                        }))
                        .await;
                        if let Some(process) = &self.process {
                            process.terminate(libc::SIGTERM);
                        }
                    }
                }
                true
            }
            Some(2) => {
                if frame.get("result").is_some() {
                    self.codex_thread_frame = Some(frame.clone());
                    if let Err(error) = self.request_codex_models(None) {
                        self.project_backend(json!({
                            "type": "note",
                            "level": "warning",
                            "text": format!("Codex did not report model capabilities: {error}"),
                        }))
                        .await;
                        self.finish_codex_startup(process_tx).await;
                    }
                } else if self.codex_resuming {
                    let message = frame
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("the stored thread is unavailable");
                    self.codex_resuming = false;
                    self.codex_context_pending = false;
                    self.project_backend(json!({
                        "type": "note",
                        "level": "warning",
                        "text": format!("Codex could not resume its thread ({message}). Started a new one."),
                    }))
                    .await;
                    if let Err(error) = self.send_codex_thread_request(false) {
                        self.fail_pending_resume(&error.to_string());
                        self.project_backend(json!({
                            "type": "failed",
                            "message": error.to_string(),
                        }))
                        .await;
                    }
                } else {
                    self.handle_backend_frame(frame, process_tx).await;
                }
                true
            }
            Some(3) => {
                if let Some(result) = frame.get("result") {
                    let model = self
                        .info
                        .pointer("/selection/model")
                        .and_then(Value::as_str);
                    if let Some(entry) = result
                        .get("data")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .find(|entry| entry.get("model").and_then(Value::as_str) == model)
                    {
                        self.codex_image_input_supported = entry
                            .get("inputModalities")
                            .and_then(Value::as_array)
                            .map(|modalities| modalities.iter().any(|value| value == "image"));
                        self.finish_codex_startup(process_tx).await;
                    } else if let Some(cursor) = result.get("nextCursor").and_then(Value::as_str) {
                        if self.codex_model_cursors.insert(cursor.to_owned()) {
                            if self.request_codex_models(Some(cursor)).is_err() {
                                self.finish_codex_startup(process_tx).await;
                            }
                        } else {
                            self.finish_codex_startup(process_tx).await;
                        }
                    } else {
                        self.finish_codex_startup(process_tx).await;
                    }
                } else {
                    self.finish_codex_startup(process_tx).await;
                }
                true
            }
            _ => false,
        }
    }

    fn send_codex_thread_request(&self, resume: bool) -> anyhow::Result<()> {
        let (approval_policy, sandbox) = codex_mode(
            self.info
                .get("runtimeMode")
                .and_then(Value::as_str)
                .unwrap_or("full-access"),
        );
        let mut params = json!({
            "cwd": self.info.get("cwd"),
            "model": self.info.pointer("/selection/model"),
            "approvalPolicy": approval_policy,
            "sandbox": sandbox,
        });
        if let Some(tier) = codex_service_tier(&self.info) {
            set(&mut params, "serviceTier", json!(tier));
        }
        if resume {
            set(
                &mut params,
                "threadId",
                self.info
                    .get("agentSessionId")
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            set(&mut params, "excludeTurns", json!(true));
        } else if let Some(prompt) = &self.codex_launch_prompt {
            set(&mut params, "developerInstructions", json!(prompt));
        }
        self.process
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Codex is not running"))?
            .send(&json!({
                "id": 2,
                "method": if resume { "thread/resume" } else { "thread/start" },
                "params": params,
            }))
    }

    fn request_codex_models(&self, cursor: Option<&str>) -> anyhow::Result<()> {
        let mut params = json!({ "includeHidden": true });
        if let Some(cursor) = cursor {
            set(&mut params, "cursor", json!(cursor));
        }
        self.process
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Codex is not running"))?
            .send(&json!({ "id": 3, "method": "model/list", "params": params }))
    }

    async fn finish_codex_startup(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) {
        if let Some(frame) = self.codex_thread_frame.take() {
            self.handle_backend_frame(&frame, process_tx).await;
        }
    }

    async fn handle_backend_frame(
        &mut self,
        frame: &Value,
        process_tx: &mpsc::Sender<ProcessEvent>,
    ) {
        let was_active = self.active_turn().is_some();
        let output = self.backend.handle(frame);
        for event in output.events {
            let kind = event
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let direct_title = (kind == "title")
                .then(|| {
                    event
                        .get("title")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .flatten()
                .or_else(|| {
                    (kind == "session")
                        .then(|| {
                            event
                                .get("title")
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                        .flatten()
                });
            let turn_done = (kind == "turn.done")
                .then(|| event.get("state").and_then(Value::as_str) == Some("done"));
            if event.get("type").and_then(Value::as_str) == Some("limits")
                && let Some(update) = event.get("update")
                && let Some(sink) = &self.limits_sink
            {
                sink(update.clone());
            }
            self.project_backend(event).await;
            if let Some(title) = direct_title {
                self.apply_suggested_title(title, false).await;
            }
            if kind == "session" {
                self.schedule_claude_title(process_tx, None);
                if self.info.get("suggestedTitle").is_none() {
                    self.schedule_claude_title(
                        process_tx,
                        Some(std::time::Duration::from_secs(10)),
                    );
                }
            }
            if let Some(done) = turn_done {
                self.schedule_claude_title(process_tx, None);
                if done {
                    self.name_codex_thread(process_tx);
                }
            }
        }
        if was_active && self.active_turn().is_none() {
            let _ = self.drain_queue(process_tx).await;
        }
        if output.ready {
            self.codex_ready = true;
            if let Some(pending) = self.pending_resume.take() {
                let result = self.perform_resume(&pending.turn_id, pending.attempt).await;
                let _ = pending.reply.send(result);
            } else if let Some(text) = self.pending_codex_text.take() {
                let attachments = std::mem::take(&mut self.pending_codex_attachments);
                if let Err(error) = self.send_codex_turn(text, &attachments) {
                    self.project_backend(json!({
                        "type": "failed",
                        "message": error.to_string(),
                    }))
                    .await;
                }
            } else if self.pending_codex_compact {
                self.pending_codex_compact = false;
                if let Err(error) = self.send_codex_compact() {
                    self.project_backend(json!({
                        "type": "failed",
                        "message": error.to_string(),
                    }))
                    .await;
                }
            }
        }
    }

    fn schedule_claude_title(
        &self,
        process_tx: &mpsc::Sender<ProcessEvent>,
        delay: Option<std::time::Duration>,
    ) {
        if self.provider() != "claude" {
            return;
        }
        let Some(agent_session_id) = self
            .info
            .get("agentSessionId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        let reader = self.claude_titles.clone();
        let events = process_tx.clone();
        let cancel = self.title_cancel.clone();
        let generation = self.generation;
        tokio::spawn(async move {
            if let Some(delay) = delay {
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(delay) => {}
                }
            }
            let title = tokio::select! {
                _ = cancel.cancelled() => return,
                title = reader.for_session(&agent_session_id) => title,
            };
            let _ = events
                .send(ProcessEvent::SuggestedTitle {
                    generation,
                    agent_session_id,
                    title,
                    only_if_absent: false,
                    set_backend: false,
                })
                .await;
        });
    }

    fn name_codex_thread(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) {
        if self.provider() != "codex" || self.naming || self.info.get("suggestedTitle").is_some() {
            return;
        }
        let done = self
            .items
            .iter()
            .filter(|item| {
                item.get("kind").and_then(Value::as_str) == Some("turn")
                    && item.get("state").and_then(Value::as_str) == Some("done")
            })
            .collect::<Vec<_>>();
        let Some(turn) = (done.len() == 1).then(|| done[0]) else {
            return;
        };
        let Some(prompt) = self
            .items
            .iter()
            .find(|item| item.get("kind").and_then(Value::as_str) == Some("user"))
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map(str::to_owned)
        else {
            return;
        };
        let turn_id = turn.get("id").and_then(Value::as_str).unwrap_or_default();
        let answer = self
            .items
            .iter()
            .filter(|item| {
                item.get("kind").and_then(Value::as_str) == Some("assistant")
                    && item.get("turnId").and_then(Value::as_str) == Some(turn_id)
            })
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n");
        let Some(agent_session_id) = self
            .info
            .get("agentSessionId")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        let input = ChatTitleInput {
            cwd: PathBuf::from(self.info.get("cwd").and_then(Value::as_str).unwrap_or(".")),
            prompt,
            answer,
        };
        let candidates = self.title_candidates.clone();
        let events = process_tx.clone();
        let cancel = self.title_cancel.clone();
        let generation = self.generation;
        self.naming = true;
        tokio::spawn(async move {
            let title = tokio::select! {
                _ = cancel.cancelled() => return,
                title = suggest_chat_title(&candidates, &input) => title,
            };
            let _ = events
                .send(ProcessEvent::SuggestedTitle {
                    generation,
                    agent_session_id,
                    title,
                    only_if_absent: true,
                    set_backend: true,
                })
                .await;
        });
    }

    async fn apply_suggested_title(&mut self, title: String, set_backend: bool) {
        if self.info.get("suggestedTitle").and_then(Value::as_str) == Some(title.as_str()) {
            return;
        }
        set(&mut self.info, "suggestedTitle", json!(title));
        self.emit_info().await;
        if set_backend && self.provider() == "codex" {
            self.codex_rpc_id += 1;
            if let Some(process) = &self.process {
                let _ = process.send(&json!({
                    "id": self.codex_rpc_id,
                    "method": "thread/name/set",
                    "params": { "threadId": self.info.get("agentSessionId"), "name": self.info.get("suggestedTitle") },
                }));
            }
        }
    }

    async fn finish_exit(&mut self, process_tx: &mpsc::Sender<ProcessEvent>) {
        if !self.stdout_closed || self.process_exit.is_none() {
            return;
        }
        let code = self.process_exit.take().flatten();
        self.process = None;
        self.pending_codex_compact = false;
        self.fail_pending_resume("The agent process exited before it could resume the turn");
        self.revoke_bearer();
        self.public.pid.store(0, Ordering::Release);
        let orphaned = self.running_background_subagents();
        self.project_backend(json!({ "type": "exit", "exitCode": code }))
            .await;
        self.settle_orphaned_subagents(orphaned, false).await;
        if self.active_turn().is_none() {
            let _ = self.drain_queue(process_tx).await;
        }
    }

    fn running_background_subagents(&self) -> Vec<(String, String)> {
        self.items
            .iter()
            .filter(|item| {
                item.get("kind").and_then(Value::as_str) == Some("subagent")
                    && item.get("status").and_then(Value::as_str) == Some("running")
                    && item.get("background").and_then(Value::as_bool) == Some(true)
                    && item.get("origin").and_then(Value::as_str) != Some("ruimte")
            })
            .filter_map(|item| {
                Some((
                    item.get("id")?.as_str()?.to_owned(),
                    item.get("toolUseId")?.as_str()?.to_owned(),
                ))
            })
            .collect()
    }

    async fn settle_orphaned_subagents(&mut self, rows: Vec<(String, String)>, settle_codex: bool) {
        if rows.is_empty() {
            return;
        }
        if self.provider() == "codex" {
            if !settle_codex {
                return;
            }
            for (id, _) in rows {
                let Some(index) = self.item_index.get(&id).copied() else {
                    continue;
                };
                let mut item = self.items[index].clone();
                item["status"] = json!("failed");
                item["finishedAt"] = json!(now());
                self.upsert(item).await;
            }
            return;
        }
        for (id, tool_use_id) in rows {
            let Some(transcript) =
                subagents::find_claude_transcript(&self.claude_projects, &self.info, &tool_use_id)
                    .await
            else {
                continue;
            };
            let Some(settlement) = subagents::read_claude_settlement(&transcript.path).await else {
                continue;
            };
            let Some(index) = self.item_index.get(&id).copied() else {
                continue;
            };
            let mut item = self.items[index].clone();
            if !matches!(
                item.get("status").and_then(Value::as_str),
                Some("running" | "failed")
            ) {
                continue;
            }
            item["status"] = json!("done");
            item["finishedAt"] = json!(settlement.finished_at.unwrap_or_else(now));
            if let Some(report) = settlement.report {
                item["result"] = json!(report);
            }
            self.upsert(item).await;
        }
    }

    fn fail_pending_resume(&mut self, message: &str) {
        if let Some(pending) = self.pending_resume.take() {
            let _ = pending
                .reply
                .send(Err(RpcError::new("chat-process", message.to_owned())));
        }
    }

    async fn project_backend(&mut self, event: Value) {
        self.projector.sync_thread(&self.info, &self.items);
        let projected = self.projector.project(self.generation, &event);
        for event in projected {
            let previous_turn = self.active_turn().map(str::to_owned);
            let changes_info = matches!(
                event.get("type").and_then(Value::as_str),
                Some("info" | "reset")
            );
            apply_event(&mut self.info, &mut self.items, &event);
            self.item_index = index_items(&self.items);
            if changes_info {
                self.publish().await;
            }
            self.emit(event).await;
            let next_turn = self.active_turn().map(str::to_owned);
            match (previous_turn, next_turn) {
                (None, Some(turn_id)) => self.checkpoint_turn(&turn_id).await,
                (Some(turn_id), None) => self.settle_checkpoint(&turn_id).await,
                _ => {}
            }
        }
    }

    async fn approve_request(
        &mut self,
        request_id: &str,
        decision: &str,
        message: Option<&str>,
    ) -> RpcResult {
        let outbound = if self.provider() == "claude" {
            self.backend
                .claude_approval_response(request_id, decision, message)
                .map(|frame| (frame, false))
        } else {
            self.backend
                .codex_approval_decision(request_id, decision)
                .map(|frame| (frame, true))
        };
        let Some((outbound, codex_response)) = outbound else {
            return Err(RpcError::new(
                "request-not-found",
                "The approval request is no longer pending",
            ));
        };
        if codex_response {
            self.send_codex_response(&outbound)?;
        } else {
            self.process
                .as_ref()
                .ok_or_else(|| RpcError::new("chat-process", "The agent is not running"))?
                .send(&outbound)
                .map_err(agent_error)?;
        }
        if let Some(index) = self
            .item_index
            .get(&format!("approval-{request_id}"))
            .copied()
        {
            set(&mut self.items[index], "decision", json!(decision));
            self.emit_item_at(index).await;
        }
        set(&mut self.info, "status", json!("running"));
        self.emit_info().await;
        Ok(json!({}))
    }

    async fn answer_request(&mut self, request_id: &str, answers: Map<String, Value>) -> RpcResult {
        let answered = if self.provider() == "claude" {
            let Some(frame) = self.backend.claude_question_response(request_id, &answers) else {
                return Err(RpcError::new(
                    "request-not-found",
                    "The question is no longer pending",
                ));
            };
            self.process
                .as_ref()
                .ok_or_else(|| RpcError::new("chat-process", "The agent is not running"))?
                .send(&frame)
                .map_err(agent_error)?;
            true
        } else {
            let Some(answer) = self.backend.codex_question_answer(request_id, &answers) else {
                return Err(RpcError::new(
                    "request-not-found",
                    "The question is no longer pending",
                ));
            };
            if answer.get("kind").and_then(Value::as_str) == Some("respond") {
                self.send_codex_response(&answer)?;
                true
            } else {
                let Some(turn_id) = self.backend.codex_turn_id().map(str::to_owned) else {
                    return Err(RpcError::new(
                        "request-not-found",
                        "The question is no longer pending",
                    ));
                };
                self.codex_rpc_id += 1;
                self.process
                    .as_ref()
                    .ok_or_else(|| RpcError::new("chat-process", "The agent is not running"))?
                    .send(&json!({
                        "id": self.codex_rpc_id,
                        "method": "turn/steer",
                        "params": {
                            "threadId": self.info.get("agentSessionId"),
                            "expectedTurnId": turn_id,
                            "input": [{ "type": "text", "text": answer.get("text").and_then(Value::as_str).unwrap_or(""), "text_elements": [] }],
                        }
                    }))
                    .map_err(agent_error)?;
                true
            }
        };
        if !answered {
            return Err(RpcError::new(
                "request-not-found",
                "The question is no longer pending",
            ));
        }
        if let Some(index) = self
            .item_index
            .get(&format!("question-{request_id}"))
            .copied()
        {
            set(&mut self.items[index], "answers", Value::Object(answers));
            set(&mut self.items[index], "state", json!("answered"));
            self.emit_item_at(index).await;
        }
        set(&mut self.info, "status", json!("running"));
        self.emit_info().await;
        Ok(json!({}))
    }

    fn send_codex_response(&self, response: &Value) -> Result<(), RpcError> {
        let rpc_id = response
            .get("rpcId")
            .cloned()
            .ok_or_else(|| RpcError::new("chat-process", "Codex response has no request id"))?;
        let result = response.get("result").cloned().unwrap_or(Value::Null);
        self.process
            .as_ref()
            .ok_or_else(|| RpcError::new("chat-process", "The agent is not running"))?
            .send(&json!({ "id": rpc_id, "result": result }))
            .map_err(agent_error)
    }

    async fn dismiss_request(&mut self, item_id: &str) -> RpcResult {
        let Some(index) = self.item_index.get(item_id).copied() else {
            return Err(RpcError::new(
                "request-not-found",
                format!("No question to dismiss under {item_id}"),
            ));
        };
        let request_id = self.items[index]
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let dismissible = self.items[index].get("kind").and_then(Value::as_str) == Some("question")
            && self.items[index].get("state").and_then(Value::as_str) == Some("pending")
            && self.items[index].get("async").and_then(Value::as_bool) == Some(true);
        if !dismissible || request_id.is_none() {
            return Err(RpcError::new(
                "request-not-found",
                format!("No question to dismiss under {item_id}"),
            ));
        }
        self.backend
            .codex_dismiss_question(request_id.as_deref().unwrap());
        set(&mut self.items[index], "state", json!("dismissed"));
        self.emit_item_at(index).await;
        let status = if self.active_turn().is_some() {
            "running"
        } else {
            "idle"
        };
        set(&mut self.info, "status", json!(status));
        self.emit_info().await;
        Ok(json!({}))
    }

    async fn deliver_note(
        &mut self,
        operation_id: Uuid,
        note_id: String,
        note: String,
        from: String,
        preamble: String,
    ) -> RpcResult {
        if self.item_index.contains_key(&note_id) {
            return Ok(json!({ "delivered": false }));
        }
        let operation_id = operation_id.to_string();
        if self.preamble_operations.insert(operation_id.clone()) {
            self.preambles.push(preamble);
        }
        self.upsert(json!({
            "id": note_id,
            "kind": "note",
            "createdAt": now(),
            "turnId": null,
            "level": "info",
            "text": note,
            "from": from,
            "operationId": operation_id,
        }))
        .await;
        self.persistence_result()?;
        Ok(json!({ "delivered": true }))
    }

    async fn note_subagent_native(&mut self, tool_use_id: &str, agent_id: &str) -> RpcResult {
        let Some(index) = self.items.iter().position(|item| {
            item.get("kind").and_then(Value::as_str) == Some("subagent")
                && item.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id)
        }) else {
            return Ok(json!({}));
        };
        if self.items[index]
            .pointer("/native/agentId")
            .and_then(Value::as_str)
            == Some(agent_id)
        {
            return Ok(json!({}));
        }
        let mut native = self.items[index]
            .get("native")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        native.insert("agentId".to_owned(), json!(agent_id));
        set(&mut self.items[index], "native", Value::Object(native));
        self.emit_item_at(index).await;
        self.persistence_result()?;
        Ok(json!({}))
    }

    async fn sync_task_row(&mut self, task: Value) -> RpcResult {
        let task_id = task
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("invalid-task", "A task row needs an id"))?;
        let id = format!("task-{task_id}");
        let existing = self
            .item_index
            .get(&id)
            .and_then(|index| self.items.get(*index));
        let turn_id = existing
            .and_then(|item| item.get("turnId"))
            .cloned()
            .unwrap_or_else(|| {
                self.info
                    .get("activeTurnId")
                    .cloned()
                    .unwrap_or(Value::Null)
            });
        let status = match task.get("status").and_then(Value::as_str) {
            Some("open") => "running",
            Some("done") => "done",
            _ => "failed",
        };
        let result = task.pointer("/result/text").cloned().unwrap_or(Value::Null);
        let row = json!({
            "id": id,
            "kind": "subagent",
            "createdAt": task.get("createdAt").cloned().unwrap_or_else(|| json!(now())),
            "turnId": turn_id,
            "toolUseId": id,
            "description": task.get("title").cloned().unwrap_or_else(|| json!("Task")),
            "subagentType": null,
            "prompt": task.get("prompt").cloned().unwrap_or_else(|| json!("")),
            "background": true,
            "status": status,
            "startedAt": task.get("createdAt").cloned().unwrap_or(Value::Null),
            "finishedAt": task.get("settledAt").cloned().unwrap_or(Value::Null),
            "summary": null,
            "result": result,
            "usage": null,
            "lastTool": null,
            "itemsTruncated": false,
            "origin": "ruimte",
            "childId": task.get("childId").cloned().unwrap_or(Value::Null),
        });
        if existing != Some(&row) {
            self.upsert(row).await;
        }
        if task.get("status").and_then(Value::as_str) == Some("cancelled") {
            let note_id = format!("task-{task_id}-cancelled");
            if !self.item_index.contains_key(&note_id) {
                let title = task.get("title").and_then(Value::as_str).unwrap_or("Task");
                let reason = task
                    .pointer("/result/text")
                    .and_then(Value::as_str)
                    .unwrap_or("its node was removed");
                self.upsert(json!({
                    "id": note_id,
                    "kind": "note",
                    "createdAt": task.get("settledAt").or_else(|| task.get("createdAt")).cloned().unwrap_or_else(|| json!(now())),
                    "turnId": null,
                    "level": "warning",
                    "text": format!("The task \"{title}\" was cancelled: {reason}"),
                }))
                .await;
            }
        }
        self.persistence_result()?;
        Ok(json!({}))
    }

    async fn queue_preamble(&mut self, operation_id: Uuid, text: String) -> RpcResult {
        let operation_id = operation_id.to_string();
        if !self.preamble_operations.insert(operation_id) {
            return Ok(json!({ "queued": false }));
        }
        self.preambles.push(text);
        let _ = self.persist_snapshot().await;
        self.persistence_result()?;
        Ok(json!({ "queued": true }))
    }

    async fn finish_turn(&mut self, state: &str, cost: f64, native: Option<Value>) {
        let Some(turn_id) = self.active_turn().map(str::to_owned) else {
            return;
        };
        if let Some(index) = self.item_index.get(&turn_id).copied() {
            set(&mut self.items[index], "state", json!(state));
            set(&mut self.items[index], "endedAt", json!(now()));
            set(&mut self.items[index], "costUsd", json!(cost));
            if let Some(native) = native {
                set(&mut self.items[index], "native", native);
            }
            self.emit_item_at(index).await;
        }
        set(&mut self.info, "activeTurnId", Value::Null);
        set(
            &mut self.info,
            "status",
            json!(if state == "error" { "error" } else { "idle" }),
        );
        self.update_usage(None, None, Some(cost)).await;
        self.emit_info().await;
        self.settle_checkpoint(&turn_id).await;
    }

    async fn checkpoint_turn(&mut self, turn_id: &str) {
        let host = self
            .fork_host
            .read()
            .expect("chat fork host lock poisoned")
            .as_ref()
            .and_then(Weak::upgrade);
        let Some(host) = host else {
            return;
        };
        let cwd = self
            .info
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let Ok(Some(tree)) = host.take_tree(&cwd).await else {
            return;
        };
        if let Some(index) = self.item_index.get(turn_id).copied() {
            set(&mut self.items[index], "checkpoint", json!(tree));
            self.emit_item_at(index).await;
        }
    }

    async fn settle_checkpoint(&mut self, turn_id: &str) {
        let Some(index) = self.item_index.get(turn_id).copied() else {
            return;
        };
        let Some(checkpoint) = self.items[index]
            .get("checkpoint")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        if self.items[index].get("checkpointDiff").is_some() {
            return;
        }
        let host = self
            .fork_host
            .read()
            .expect("chat fork host lock poisoned")
            .as_ref()
            .and_then(Weak::upgrade);
        let Some(host) = host else {
            return;
        };
        let cwd = self
            .info
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let Ok(Some(diff)) = host.diff_tree(&cwd, &checkpoint).await else {
            return;
        };
        let Ok(Some(after)) = host.take_tree(&cwd).await else {
            return;
        };
        if let Some(index) = self.item_index.get(turn_id).copied() {
            set(&mut self.items[index], "checkpointDiff", diff);
            set(&mut self.items[index], "checkpointAfter", json!(after));
            self.emit_item_at(index).await;
        }
    }

    async fn update_usage(&mut self, tokens: Option<u64>, window: Option<u64>, cost: Option<f64>) {
        let usage = self
            .info
            .get_mut("usage")
            .and_then(Value::as_object_mut)
            .expect("chat usage is an object");
        if let Some(tokens) = tokens {
            usage.insert("contextTokens".to_owned(), json!(tokens));
        }
        if let Some(window) = window {
            usage.insert("contextWindow".to_owned(), json!(window));
        }
        if let Some(cost) = cost {
            let total = usage.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0) + cost;
            let turns = usage.get("turns").and_then(Value::as_u64).unwrap_or(0) + 1;
            usage.insert("costUsd".to_owned(), json!(total));
            usage.insert("turns".to_owned(), json!(turns));
        }
    }

    async fn upsert(&mut self, item: Value) {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let index = if let Some(index) = self.item_index.get(&id).copied() {
            self.items[index] = item;
            index
        } else {
            let index = self.items.len();
            self.items.push(item);
            self.item_index.insert(id, index);
            index
        };
        self.emit_item_at(index).await;
    }

    async fn emit_item_at(&mut self, index: usize) {
        self.emit(json!({ "type": "item", "item": self.items[index], "historyIndex": index }))
            .await;
    }

    async fn note(&mut self, level: &str, text: &str) {
        self.upsert(json!({ "id": format!("note-{}", Uuid::new_v4()), "createdAt": now(), "turnId": self.active_turn(), "kind": "note", "level": level, "text": text })).await;
    }

    async fn emit_info(&mut self) {
        self.publish().await;
        self.emit(json!({ "type": "info", "info": self.info }))
            .await;
    }

    async fn emit(&mut self, event: Value) {
        let publish_runtime_change = Self::runtime_change_event(&event);
        self.seq += 1;
        let append_result = self.store.append(&self.chat_id, self.seq, &event).await;
        if let Ok(bytes) = append_result.as_ref() {
            self.events_since_snapshot += 1;
            self.journal_bytes += bytes;
        }
        let append_error = append_result.err().map(|error| error.to_string());
        self.recent_events.push((self.seq, event.clone()));
        let payload = json!({ "chatId": self.chat_id, "event": event, "seq": self.seq });
        self.viewers
            .retain(|client| self.events.send(client, "chat.event", payload.clone()));
        let snapshot_error = if append_error.is_some()
            || self.events_since_snapshot >= SNAPSHOT_EVENT_INTERVAL
            || self.journal_bytes >= SNAPSHOT_LOG_BYTES
        {
            self.write_snapshot().await.err()
        } else {
            None
        };
        let durable = append_error.is_none() || snapshot_error.is_none();
        self.last_persist_error = if durable {
            None
        } else {
            Some(format!(
                "event log: {}; snapshot: {}",
                append_error.unwrap_or_else(|| "unknown error".to_owned()),
                snapshot_error.unwrap_or_else(|| "unknown error".to_owned())
            ))
        };
        if !durable {
            return;
        }
        if publish_runtime_change {
            let sink = self
                .public
                .runtime_change_sink
                .read()
                .expect("chat runtime sink lock poisoned")
                .clone();
            if let Some(sink) = sink {
                sink(
                    self.info.clone(),
                    self.seq,
                    self.generation,
                    self.runtime_outcome(),
                );
            }
        }
    }

    fn runtime_outcome(&self) -> Option<String> {
        if self
            .info
            .get("activeTurnId")
            .is_some_and(|turn| !turn.is_null())
        {
            return None;
        }
        let turn = self.items.iter().rev().find(|item| {
            item.get("kind").and_then(Value::as_str) == Some("turn")
                && matches!(
                    item.get("state").and_then(Value::as_str),
                    Some("done" | "error" | "aborted")
                )
        })?;
        turn.get("state").and_then(Value::as_str).map(str::to_owned)
    }

    async fn publish(&self) {
        *self.public.info.write().await = self.info.clone();
        self.public.updated_at.store(now(), Ordering::Release);
        if let Some(nudge) = self
            .process_nudge
            .read()
            .expect("chat process nudge lock poisoned")
            .clone()
        {
            nudge();
        }
    }

    fn revoke_bearer(&mut self) {
        let Some(token) = self.bearer_token.take() else {
            return;
        };
        self.bearers
            .write()
            .expect("chat bearer lock poisoned")
            .remove(&token);
        self.environment.remove("RUIMTE_CONTEXT_TOKEN");
    }

    fn persistence_result(&self) -> Result<(), RpcError> {
        match &self.last_persist_error {
            Some(error) => Err(RpcError::new("chat-storage", error.clone())),
            None => Ok(()),
        }
    }

    fn durable_start_state(&self) -> DurableStartState {
        DurableStartState {
            info: self.info.clone(),
            items: self.items.clone(),
            item_index: self.item_index.clone(),
            preambles: self.preambles.clone(),
            preamble_operations: self.preamble_operations.clone(),
        }
    }

    async fn restore_durable_start(&mut self, state: DurableStartState) {
        self.info = state.info;
        self.items = state.items;
        self.item_index = state.item_index;
        self.preambles = state.preambles;
        self.preamble_operations = state.preamble_operations;
        self.publish().await;
    }

    async fn persist_snapshot(&mut self) -> Result<(), String> {
        let result = self.write_snapshot().await;
        self.last_persist_error = result.clone().err();
        result
    }

    async fn write_snapshot(&mut self) -> Result<(), String> {
        self.store
            .write_snapshot(
                &self.chat_id,
                &self.info,
                &self.items,
                self.seq,
                self.reset_seq,
                &self.preambles,
                &self.preamble_operations,
            )
            .await
            .map_err(|error| error.to_string())?;
        self.events_since_snapshot = 0;
        self.journal_bytes = 0;
        self.event_base = self.seq;
        self.recent_events.clear();
        let _ = self.store.compact_log(&self.chat_id, self.seq).await;
        Ok(())
    }

    fn runtime_change_event(event: &Value) -> bool {
        match event.get("type").and_then(Value::as_str) {
            Some("info" | "reset") => true,
            Some("item") => {
                event
                    .get("item")
                    .and_then(|item| item.get("kind"))
                    .and_then(Value::as_str)
                    == Some("turn")
            }
            _ => false,
        }
    }

    fn events_after(&self, since: u64) -> Option<Vec<Value>> {
        if since < self.reset_seq || since < self.event_base || since > self.seq {
            return None;
        }
        Some(
            self.recent_events
                .iter()
                .filter(|(seq, _)| *seq > since)
                .map(|(_, event)| event.clone())
                .collect(),
        )
    }

    async fn prompt_for_turn(&mut self, text: &str) -> Result<(String, Option<String>), RpcError> {
        if text.starts_with('/') {
            return Ok((text.to_owned(), None));
        }
        let mut parts = std::mem::take(&mut self.preambles);
        self.preamble_operations.clear();
        let context_host = {
            let host = self
                .context_host
                .read()
                .expect("chat context host lock poisoned");
            host.as_ref().and_then(Weak::upgrade)
        };
        if let Some(host) = context_host {
            let turn = host.take_turn_context(&self.chat_id).await?;
            if let Some(change) = turn.change_note {
                parts.push(change);
            }
            parts.extend(turn.notices);
        }
        let preamble = (!parts.is_empty()).then(|| parts.join("\n\n"));
        Ok((text.to_owned(), preamble))
    }
    fn provider(&self) -> &str {
        self.info
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("claude")
    }
    fn active_turn(&self) -> Option<&str> {
        self.info.get("activeTurnId").and_then(Value::as_str)
    }

    fn history_page(&self, end: usize, limit: usize) -> (Vec<Value>, Value) {
        let mut page = Vec::new();
        let mut bytes = 0;
        let mut start = end;
        while start > 0 && page.len() < limit {
            let item = &self.items[start - 1];
            let size = serde_json::to_vec(item).map(|body| body.len()).unwrap_or(0);
            if !page.is_empty() && bytes + size > 512 * 1024 {
                break;
            }
            page.insert(0, item.clone());
            bytes += size;
            start -= 1;
        }
        let cursor = (start > 0).then(|| format!("{}:{start}", self.reset_seq));
        (page, json!({ "start": start, "cursor": cursor }))
    }

    fn pending_items(&self) -> Vec<Value> {
        self.items
            .iter()
            .filter(|item| {
                (item.get("kind").and_then(Value::as_str) == Some("approval")
                    && item.get("decision").and_then(Value::as_str) == Some("pending"))
                    || (item.get("kind").and_then(Value::as_str) == Some("question")
                        && item.get("state").and_then(Value::as_str) == Some("pending"))
            })
            .cloned()
            .collect()
    }
}

struct StoredInterruption {
    turn_id: String,
    attempt: u32,
    created_at: u64,
    reason: Option<String>,
}

fn materialize_stored(stored: &StoredChat) -> (Value, Vec<Value>) {
    let mut info = stored.info.clone();
    let mut items = stored.items.clone();
    for (_, event) in &stored.events {
        apply_event(&mut info, &mut items, event);
    }
    (info, items)
}

fn stored_interruption(stored: &StoredChat) -> Option<StoredInterruption> {
    let (info, items) = materialize_stored(stored);
    let turn_id = info.get("activeTurnId")?.as_str()?.to_owned();
    let turn = items.iter().find(|item| {
        item.get("kind").and_then(Value::as_str) == Some("turn")
            && item.get("id").and_then(Value::as_str) == Some(turn_id.as_str())
            && item.get("state").and_then(Value::as_str) == Some("running")
    })?;
    let attempt = turn.get("attempt").and_then(Value::as_u64).unwrap_or(1) as u32;
    let created_at = turn.get("createdAt").and_then(Value::as_u64).unwrap_or(0);
    let reason = if info
        .get("agentSessionId")
        .is_none_or(|session_id| session_id.is_null())
    {
        Some("the agent had not started a session to resume yet".to_owned())
    } else if attempt >= 2 {
        Some("it was already resumed after an earlier restart".to_owned())
    } else {
        None
    };
    Some(StoredInterruption {
        turn_id,
        attempt,
        created_at,
        reason,
    })
}

fn settle_stored_interruption(stored: &mut StoredChat, turn_id: &str, reason: &str) {
    for (seq, event) in std::mem::take(&mut stored.events) {
        apply_event(&mut stored.info, &mut stored.items, &event);
        stored.seq = stored.seq.max(seq);
    }
    let at = now();
    for item in &mut stored.items {
        let belongs = item.get("turnId").and_then(Value::as_str) == Some(turn_id)
            || item.get("id").and_then(Value::as_str) == Some(turn_id);
        if !belongs {
            continue;
        }
        match item.get("kind").and_then(Value::as_str) {
            Some("turn") if item.get("state").and_then(Value::as_str) == Some("running") => {
                set(item, "state", json!("aborted"));
                set(item, "endedAt", json!(at));
            }
            Some("assistant" | "thinking") => set(item, "streaming", json!(false)),
            Some("tool") if item.get("state").and_then(Value::as_str) == Some("running") => {
                set(item, "state", json!("error"));
            }
            Some("approval") if item.get("decision").and_then(Value::as_str) == Some("pending") => {
                set(item, "decision", json!("cancelled"));
            }
            Some("question") if item.get("state").and_then(Value::as_str) == Some("pending") => {
                set(item, "state", json!("cancelled"));
            }
            Some("subagent") if item.get("status").and_then(Value::as_str) == Some("running") => {
                set(item, "status", json!("failed"));
                set(item, "finishedAt", json!(at));
            }
            _ => {}
        }
    }
    stored.items.push(json!({
        "id": format!("note-{}", Uuid::new_v4()),
        "createdAt": at,
        "turnId": turn_id,
        "kind": "note",
        "level": "warning",
        "text": format!("This turn could not be resumed after the machine restarted: {reason}"),
    }));
    set(&mut stored.info, "activeTurnId", Value::Null);
    set(&mut stored.info, "status", json!("idle"));
    set(&mut stored.info, "running", json!(false));
}

fn apply_event(info: &mut Value, items: &mut Vec<Value>, event: &Value) {
    match event.get("type").and_then(Value::as_str) {
        Some("info") => {
            if let Some(next) = event.get("info") {
                *info = next.clone();
            }
        }
        Some("reset") => {
            if let Some(next) = event.get("info") {
                *info = next.clone();
            }
            *items = event
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        Some("item") => {
            let Some(item) = event.get("item") else {
                return;
            };
            let id = item.get("id").and_then(Value::as_str).unwrap_or("");
            if let Some(index) = items
                .iter()
                .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
            {
                items[index] = item.clone();
            } else {
                items.push(item.clone());
            }
        }
        Some("delta") => {
            let id = event.get("itemId").and_then(Value::as_str).unwrap_or("");
            let text = event.get("text").and_then(Value::as_str).unwrap_or("");
            if let Some(item) = items
                .iter_mut()
                .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
            {
                let current = item.get("text").and_then(Value::as_str).unwrap_or("");
                set(item, "text", json!(format!("{current}{text}")));
            }
        }
        _ => {}
    }
}

fn index_items(items: &[Value]) -> HashMap<String, usize> {
    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_owned(), index))
        })
        .collect()
}

fn set(value: &mut Value, key: &str, next: Value) {
    value
        .as_object_mut()
        .expect("chat value is an object")
        .insert(key.to_owned(), next);
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn codex_mode(mode: &str) -> (&'static str, &'static str) {
    match mode {
        "supervised" => ("untrusted", "read-only"),
        "auto-accept-edits" => ("untrusted", "workspace-write"),
        "auto" => ("on-request", "workspace-write"),
        _ => ("never", "danger-full-access"),
    }
}

fn provider_name(provider: &str) -> &'static str {
    match provider {
        "claude" => "Claude Code",
        "codex" => "Codex",
        "gemini" => "Gemini",
        "copilot" => "GitHub Copilot",
        _ => "Agent",
    }
}

enum ForkFiles {
    Shared {
        repository: bool,
    },
    Worktree {
        path: String,
        branch: String,
        after_turn: bool,
    },
}

fn items_through(items: &[Value], turn_id: &str) -> Vec<Value> {
    let mut kept = HashSet::<String>::new();
    let mut end = None;
    for (index, item) in items.iter().enumerate() {
        if item.get("kind").and_then(Value::as_str) == Some("turn")
            && !kept.contains(turn_id)
            && let Some(id) = item.get("id").and_then(Value::as_str)
        {
            kept.insert(id.to_owned());
        }
        if item.get("turnId").and_then(Value::as_str) == Some(turn_id)
            || item.get("id").and_then(Value::as_str) == Some(turn_id)
        {
            end = Some(index);
        }
    }
    items
        .iter()
        .enumerate()
        .filter(|(index, item)| match item.get("turnId") {
            Some(Value::Null) | None => end.is_some_and(|end| *index <= end),
            Some(turn_id) => turn_id
                .as_str()
                .is_some_and(|turn_id| kept.contains(turn_id)),
        })
        .map(|(_, item)| item.clone())
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn fork_notes(
    original_id: &str,
    original_title: &str,
    original_is_view: bool,
    number: usize,
    total: usize,
    last: bool,
    exact: bool,
    files: &ForkFiles,
) -> (String, String) {
    let where_text = if last {
        format!("its last turn (turn {number})")
    } else {
        format!("turn {number} of {total}")
    };
    let counted = if exact || last {
        ""
    } else {
        " The cut was made by counting turns, since this turn is older than the names the CLI gives them."
    };
    let (person_files, agent_files, outside) = match files {
        ForkFiles::Shared { repository } => (
            if last {
                "Both work in the same folder from here."
            } else {
                "The files stay as they are now, which may be newer than that turn."
            },
            if last {
                "You work in the same folder as the original, which may go on working there, so check the files before you assume."
            } else {
                "You work in the same folder as the original; its files may be newer than that turn, so check before you assume."
            },
            if *repository {
                ""
            } else {
                " The folder is in no git repository, so the fork has no worktree of its own."
            },
        ),
        ForkFiles::Worktree { after_turn, .. } => (
            if *after_turn {
                "The files start from the state after that turn"
            } else {
                "The files start from HEAD"
            },
            if *after_turn {
                "with the files as they were after that turn"
            } else {
                "from the current HEAD, so work the original left uncommitted is not there"
            },
            "",
        ),
    };
    let note = match files {
        ForkFiles::Worktree { branch, .. } => format!(
            "Forked from {original_title} after {where_text}. {person_files}, in worktree {branch}.{outside}{counted}"
        ),
        _ => format!(
            "Forked from {original_title} after {where_text}. {person_files}{outside}{counted}"
        ),
    };
    let location = if original_is_view { "view" } else { "node" };
    let folder = match files {
        ForkFiles::Worktree { path, branch, .. } => {
            format!("You work in a git worktree at {path} on branch {branch}, {agent_files}.")
        }
        _ => agent_files.to_owned(),
    };
    let mut preamble = format!(
        "Ruimte: this conversation was forked from {location} {original_id} (\"{original_title}\") after {where_text}; what follows that turn there did not happen here. {folder}"
    );
    if !exact && !last {
        preamble.push_str(" The cut was made by counting turns; if the last message you remember does not match, say so.");
    }
    (note, preamble)
}

fn base_chat_command(command: &[String], provider: &str) -> Vec<String> {
    if provider == "codex" {
        let mut base = command.to_vec();
        if base.last().is_some_and(|argument| argument == "app-server") {
            base.pop();
        }
        base
    } else {
        command
            .iter()
            .position(|argument| argument == "-p")
            .map(|index| command[..index].to_vec())
            .unwrap_or_else(|| command.to_vec())
    }
}

fn build_chat_command(mut command: Vec<String>, provider: &str, info: &Value) -> Vec<String> {
    if provider == "codex" {
        if command
            .last()
            .is_none_or(|argument| argument != "app-server")
        {
            command.push("app-server".to_owned());
        }
        return command;
    }

    command.extend([
        "-p".to_owned(),
        "--output-format".to_owned(),
        "stream-json".to_owned(),
        "--input-format".to_owned(),
        "stream-json".to_owned(),
        "--verbose".to_owned(),
        "--include-partial-messages".to_owned(),
        "--permission-prompt-tool".to_owned(),
        "stdio".to_owned(),
        "--allowedTools=Bash(ruimte-context *)".to_owned(),
    ]);
    if let Some(model) = info.pointer("/selection/model").and_then(Value::as_str) {
        let one_million = info
            .pointer("/selection/options/contextWindow")
            .and_then(Value::as_str)
            == Some("1m");
        command.extend([
            "--model".to_owned(),
            format!("{model}{}", if one_million { "[1m]" } else { "" }),
        ]);
    }
    if let Some(effort) = info
        .pointer("/selection/options/effort")
        .and_then(Value::as_str)
        .filter(|effort| matches!(*effort, "low" | "medium" | "high" | "xhigh" | "max"))
    {
        command.extend(["--effort".to_owned(), effort.to_owned()]);
    }
    if info
        .pointer("/selection/options/fastMode")
        .and_then(Value::as_bool)
        == Some(true)
    {
        command.extend(["--settings".to_owned(), r#"{"fastMode":true}"#.to_owned()]);
    }
    let permission_mode = match info.get("runtimeMode").and_then(Value::as_str) {
        Some("auto-accept-edits") => Some("acceptEdits"),
        Some("auto") => Some("auto"),
        Some("full-access") => Some("bypassPermissions"),
        _ => None,
    };
    if let Some(permission_mode) = permission_mode {
        command.extend(["--permission-mode".to_owned(), permission_mode.to_owned()]);
        if permission_mode == "bypassPermissions" {
            command.push("--allow-dangerously-skip-permissions".to_owned());
        }
    }
    if let Some(session_id) = info.get("agentSessionId").and_then(Value::as_str) {
        command.extend(["--resume".to_owned(), session_id.to_owned()]);
    }
    command
}

fn codex_service_tier(info: &Value) -> Option<&'static str> {
    (info
        .pointer("/selection/options/serviceTier")
        .and_then(Value::as_bool)
        == Some(true))
    .then_some("priority")
}

#[allow(clippy::too_many_arguments)]
fn handoff_notes(
    items: &[Value],
    from_provider: &str,
    to_provider: &str,
    original_id: &str,
    original_title: &str,
    original_is_view: bool,
    number: usize,
    total: usize,
    at: u64,
    cwd: &str,
    files: &ForkFiles,
    last: bool,
) -> (String, String) {
    let rendered = render_turns(items);
    let mut kept = Vec::new();
    let mut bytes = 0;
    for text in rendered.iter().rev() {
        let size = text.len() + 2;
        if !kept.is_empty() && bytes + size > 12 * 1024 {
            break;
        }
        kept.push(text.clone());
        bytes += size;
    }
    kept.reverse();
    let all = kept.len() == rendered.len();
    let location = if original_is_view { "view" } else { "node" };
    let time = chrono::DateTime::from_timestamp_millis(at as i64)
        .map(|time| time.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "an unknown time".into());
    let folder = match files {
        ForkFiles::Shared { .. } => format!(
            "{cwd}, the same folder the original works in, so its files may be newer than that turn."
        ),
        ForkFiles::Worktree {
            branch, after_turn, ..
        } => format!(
            "{cwd} (a git worktree on branch {branch}, {}).",
            if *after_turn {
                "with the files as they were after that turn"
            } else {
                "from the current HEAD"
            }
        ),
    };
    let part = if all {
        "all of it".to_owned()
    } else if kept.len() == 1 {
        "its last turn".to_owned()
    } else {
        format!("its last {} turns", kept.len())
    };
    let preamble = format!(
        "Ruimte: you take over a conversation that ran with {} in {location} {original_id} (\"{original_title}\") on this machine, forked after its turn {number} of {total} on {time}.\nFolder: {folder}\nThe original is readable with: ruimte-context read {original_id} (add --tail 200 for the last part); only its turns up to turn {number} happened here. What follows is {part}, as text. The tool lines are what {} ran, not you, so check the files before you assume.\n---\n{}\n---\nContinue from here. The person's next message follows.",
        provider_name(from_provider),
        provider_name(from_provider),
        kept.join("\n\n")
    );
    let where_text = if last {
        format!("its last turn (turn {number})")
    } else {
        format!("turn {number} of {total}")
    };
    let place = match files {
        ForkFiles::Shared { .. } if last => " Both work in the same folder from here.".to_owned(),
        ForkFiles::Shared { .. } => {
            " The files stay as they are now, which may be newer than that turn.".to_owned()
        }
        ForkFiles::Worktree {
            branch, after_turn, ..
        } => format!(
            " The files start from {}, in worktree {branch}.",
            if *after_turn {
                "the state after that turn"
            } else {
                "HEAD"
            }
        ),
    };
    let read = if all {
        "the whole conversation".to_owned()
    } else if kept.len() == 1 {
        "the last turn".to_owned()
    } else {
        format!("the last {} turns", kept.len())
    };
    let note = format!(
        "Forked from {original_title} after {where_text} and continued with {}.{place} The agent got {read} as text and can read the rest of {original_title} through ruimte-context.",
        provider_name(to_provider)
    );
    (note, preamble)
}

fn render_turns(items: &[Value]) -> Vec<String> {
    let mut order = Vec::<String>::new();
    let mut by_turn = HashMap::<String, Vec<String>>::new();
    for item in items {
        let Some(turn_id) = item.get("turnId").and_then(Value::as_str) else {
            continue;
        };
        if !by_turn.contains_key(turn_id) {
            order.push(turn_id.to_owned());
        }
        let rendered = match item.get("kind").and_then(Value::as_str) {
            Some("user") => item
                .get("text")
                .and_then(Value::as_str)
                .map(|text| format!("Person: {text}")),
            Some("assistant") => item
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| format!("Assistant: {text}")),
            Some("tool") => {
                let name = item.get("name").and_then(Value::as_str).unwrap_or("Tool");
                let output = item.get("output").and_then(Value::as_str).unwrap_or("");
                Some(format!("Tool {name}: {output}"))
            }
            _ => None,
        };
        if let Some(rendered) = rendered {
            by_turn
                .entry(turn_id.to_owned())
                .or_default()
                .push(rendered);
        }
    }
    order
        .into_iter()
        .filter_map(|turn_id| {
            let text = by_turn.remove(&turn_id)?.join("\n");
            (!text.is_empty()).then_some(text)
        })
        .collect()
}

fn narrower_mode<'a>(mode: &'a str, ceiling: &'a str) -> &'a str {
    let rank = |mode: &str| match mode {
        "supervised" => 0,
        "auto-accept-edits" => 1,
        "auto" => 2,
        "full-access" => 3,
        _ => 0,
    };
    if rank(mode) <= rank(ceiling) {
        mode
    } else {
        ceiling
    }
}

fn retained_event_base(snapshot_seq: u64, events: &[(u64, Value)]) -> u64 {
    let Some((first, _)) = events.first() else {
        return snapshot_seq;
    };
    let mut base = first.saturating_sub(1);
    for pair in events.windows(2) {
        if pair[1].0 != pair[0].0 + 1 {
            base = pair[0].0;
        }
    }
    base
}

fn branch_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in title.to_ascii_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() && slug.len() < 48 {
                slug.push('-');
            }
            separator = false;
            if slug.len() < 48 {
                slug.push(character);
            }
        } else {
            separator = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "agent".into()
    } else {
        slug
    }
}

fn free_branch(base: &str, taken: &[String]) -> String {
    if !taken.iter().any(|branch| branch == base) {
        return base.to_owned();
    }
    for number in 2.. {
        let candidate = format!("{base}-{number}");
        if !taken.iter().any(|branch| branch == &candidate) {
            return candidate;
        }
    }
    unreachable!()
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, RpcError> {
    serde_json::from_value(value)
        .map_err(|error| RpcError::new("invalid-request", error.to_string()))
}

fn agent_error(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("chat-process", error.to_string())
}
fn closed(error: impl std::fmt::Display) -> RpcError {
    RpcError::new("chat-closed", error.to_string())
}

fn shutting_down() -> RpcError {
    RpcError::new("daemon-shutting-down", "The daemon is shutting down")
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    #[derive(Default)]
    struct TestForkHost {
        placements: std::sync::Mutex<Vec<ForkPlacementRequest>>,
    }

    #[async_trait]
    impl ChatForkWorkspaceHost for TestForkHost {
        async fn locate(&self, node_id: &str) -> Result<Option<ForkWorkspaceLocation>, RpcError> {
            Ok(Some(ForkWorkspaceLocation {
                project_id: "project".into(),
                canvas_id: Some("canvas".into()),
                folder: "/tmp".into(),
                title: Some(if node_id == "lead" { "Lexer" } else { node_id }.into()),
                lineage_depth: 0,
            }))
        }

        async fn place_fork(
            &self,
            request: ForkPlacementRequest,
        ) -> Result<ForkPlacementResult, RpcError> {
            self.placements.lock().unwrap().push(request.clone());
            Ok(ForkPlacementResult {
                node_id: request.fork_id,
                view_id: request.canvas_id.unwrap_or_else(|| "canvas".into()),
                edge_id: Some("edge".into()),
            })
        }

        async fn branches(&self, _cwd: &str) -> Result<Option<Vec<String>>, RpcError> {
            Ok(None)
        }

        async fn add_worktree(
            &self,
            _request: ForkWorktreeRequest,
        ) -> Result<ForkWorktree, RpcError> {
            unreachable!()
        }

        async fn remove_worktree(&self, _worktree: &Value) -> Result<(), RpcError> {
            Ok(())
        }

        async fn tree_exists(&self, _cwd: &str, _tree: &str) -> Result<bool, RpcError> {
            Ok(false)
        }

        async fn take_tree(&self, _cwd: &str) -> Result<Option<String>, RpcError> {
            Ok(None)
        }

        async fn restore_tree(&self, _cwd: &str, _tree: &str) -> Result<(), RpcError> {
            Ok(())
        }

        async fn diff_tree(&self, _cwd: &str, _tree: &str) -> Result<Option<Value>, RpcError> {
            Ok(None)
        }

        async fn copy_plans(&self, _from_chat_id: &str, _to_chat_id: &str) -> Result<(), RpcError> {
            Ok(())
        }

        async fn remove_plans(&self, _chat_id: &str) -> Result<(), RpcError> {
            Ok(())
        }
    }

    fn test_actor(home: &Path) -> Actor {
        let info = json!({
            "chatId": "chat",
            "provider": "claude",
            "cwd": home,
            "agentSessionId": null,
            "model": null,
            "selection": { "model": "fake", "options": {} },
            "runtimeMode": "full-access",
            "status": "running",
            "running": false,
            "activeTurnId": "turn-active",
            "slashCommands": [],
            "usage": { "contextTokens": 0, "contextWindow": 1000, "costUsd": 0, "turns": 0 },
            "createdAt": 1,
        });
        let public = Arc::new(PublicState {
            info: RwLock::new(info.clone()),
            pid: AtomicU32::new(0),
            updated_at: AtomicU64::new(now()),
            runtime_change_sink: Arc::new(std::sync::RwLock::new(None)),
        });
        Actor::new(
            info,
            None,
            ChatStore::new(home),
            EventBus::default(),
            public,
            vec!["unused".into()],
            HashMap::new(),
            Arc::new(AtomicBool::new(true)),
            Arc::new(std::sync::RwLock::new(HashMap::new())),
            None,
            Arc::new(std::sync::RwLock::new(None)),
            Arc::new(std::sync::RwLock::new(None)),
            Arc::new(std::sync::RwLock::new(None)),
        )
    }

    #[test]
    fn log_replay_upserts_and_applies_deltas() {
        let mut info = json!({ "status": "running" });
        let mut items = vec![];
        apply_event(
            &mut info,
            &mut items,
            &json!({ "type": "item", "item": { "id": "a", "text": "one" } }),
        );
        apply_event(
            &mut info,
            &mut items,
            &json!({ "type": "delta", "itemId": "a", "text": " two" }),
        );
        apply_event(
            &mut info,
            &mut items,
            &json!({ "type": "info", "info": { "status": "idle" } }),
        );
        assert_eq!(items[0]["text"], "one two");
        assert_eq!(info["status"], "idle");
    }

    #[test]
    fn large_threads_page_under_the_socket_limit_and_keep_pending_prompts() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        actor.items = (0..5_000)
            .map(|index| {
                json!({
                    "id": format!("tool-{index}"),
                    "kind": "tool",
                    "createdAt": index,
                    "turnId": Value::Null,
                    "toolUseId": format!("tool-{index}"),
                    "name": "fixture",
                    "input": { "body": "x".repeat(16_000) },
                    "state": "done",
                    "output": Value::Null,
                    "parentToolUseId": Value::Null,
                })
            })
            .collect();
        actor.items.insert(
            1,
            json!({
                "id": "pending",
                "kind": "question",
                "createdAt": 1,
                "turnId": Value::Null,
                "requestId": "request",
                "questions": [],
                "answers": Value::Null,
                "state": "pending",
            }),
        );

        let (page, history) = actor.history_page(actor.items.len(), 60);
        let encoded = serde_json::to_vec(&json!({ "items": page, "history": history })).unwrap();

        assert!(encoded.len() < 1024 * 1024);
        assert!(history["cursor"].is_string());
        assert_eq!(actor.pending_items()[0]["id"], "pending");
    }

    #[tokio::test]
    async fn shutdown_gate_refuses_new_chats() {
        let temporary = tempfile::tempdir().unwrap();
        let service = ChatService::new(temporary.path().to_owned(), EventBus::default())
            .await
            .unwrap();
        service.begin_shutdown().await;
        let error = service
            .create(json!({
                "chatId": "late",
                "provider": "claude",
                "cwd": temporary.path(),
            }))
            .await
            .unwrap_err();
        assert_eq!(error.code, "daemon-shutting-down");
        service.shutdown().await;
    }

    #[tokio::test]
    async fn create_materializes_a_complete_journal_without_a_snapshot() {
        let temporary = tempfile::tempdir().unwrap();
        let mut info = test_actor(temporary.path()).info;
        set(&mut info, "status", json!("idle"));
        set(&mut info, "running", json!(true));
        set(&mut info, "activeTurnId", Value::Null);
        ChatStore::new(temporary.path())
            .append("chat", 1, &json!({ "type": "info", "info": info }))
            .await
            .unwrap();
        let service = ChatService::new(temporary.path().to_owned(), EventBus::default())
            .await
            .unwrap();

        let created = service.create(json!({ "chatId": "chat" })).await.unwrap();

        assert_eq!(created["chatId"], "chat");
        assert_eq!(created["status"], "idle");
        assert_eq!(created["running"], false);
        service.shutdown().await;
    }

    #[tokio::test]
    async fn queued_messages_can_be_reordered_and_removed() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        let first = actor
            .queue_message("first".into(), vec!["node".into()], Vec::new(), Vec::new())
            .await
            .unwrap();
        let second = actor
            .queue_message(
                "second".into(),
                Vec::new(),
                vec!["review".into()],
                Vec::new(),
            )
            .await
            .unwrap();
        assert_eq!(first["queued"], true);
        assert_eq!(second["queued"], true);

        let second_id = actor.info["queue"][1]["id"].as_str().unwrap().to_owned();
        let (process_tx, _process_rx) = mpsc::channel(1);
        actor
            .send_queued_now(&second_id, &process_tx)
            .await
            .unwrap();
        assert!(actor.items.iter().any(|item| {
            item.get("kind").and_then(Value::as_str) == Some("user")
                && item.get("text").and_then(Value::as_str) == Some("second")
                && item.pointer("/skills/0").and_then(Value::as_str) == Some("review")
        }));

        let first_id = actor.info["queue"][0]["id"].as_str().unwrap().to_owned();
        actor.unqueue_message(&first_id).await.unwrap();
        assert!(actor.info["queue"].as_array().unwrap().is_empty());
        assert!(actor.unqueue_message(&first_id).await.is_err());
    }

    #[tokio::test]
    async fn settled_turn_publishes_a_fact_at_the_latest_chat_sequence() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        actor
            .upsert(json!({
                "id": "turn-active", "kind": "turn", "createdAt": 1,
                "turnId": "turn-active", "origin": "user", "state": "running",
                "endedAt": null, "costUsd": 0,
            }))
            .await;
        let facts = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = facts.clone();
        *actor
            .public
            .runtime_change_sink
            .write()
            .expect("runtime sink lock") =
            Some(Arc::new(move |_info, seq, _generation, outcome| {
                seen.lock().unwrap().push((seq, outcome));
            }));
        actor.finish_turn("done", 0.0, None).await;
        let facts = facts.lock().unwrap();
        assert_eq!(facts.last(), Some(&(actor.seq, Some("done".to_owned()))));
    }

    #[tokio::test]
    async fn settlement_fact_waits_for_a_durable_log_or_snapshot() {
        let temporary = tempfile::tempdir().unwrap();
        let blocked = temporary.path().join("not-a-directory");
        tokio::fs::write(&blocked, b"file").await.unwrap();
        let mut actor = test_actor(&blocked);
        actor.items.push(json!({
            "id": "turn-active", "kind": "turn", "createdAt": 1,
            "turnId": "turn-active", "origin": "user", "state": "running",
            "endedAt": null, "costUsd": 0,
        }));
        actor.item_index = index_items(&actor.items);
        let facts = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = facts.clone();
        *actor
            .public
            .runtime_change_sink
            .write()
            .expect("runtime sink lock") =
            Some(Arc::new(move |_info, seq, _generation, outcome| {
                seen.lock().unwrap().push((seq, outcome));
            }));

        actor.finish_turn("done", 0.0, None).await;

        assert!(facts.lock().unwrap().is_empty());
        assert!(actor.persistence_result().is_err());
    }

    #[tokio::test]
    async fn event_journal_is_folded_into_bounded_snapshots() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        let event_count = SNAPSHOT_EVENT_INTERVAL * 2 + 5;
        for index in 0..event_count {
            actor
                .upsert(json!({
                    "id": "stream", "createdAt": 1, "turnId": "turn-active",
                    "kind": "assistant", "text": index.to_string(), "streaming": true,
                }))
                .await;
        }

        let stored = ChatStore::new(temporary.path())
            .read("chat")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.seq, (SNAPSHOT_EVENT_INTERVAL * 2) as u64);
        assert_eq!(stored.events.len(), 5);
        let mut info = stored.info;
        let mut items = stored.items;
        for (_, event) in stored.events {
            apply_event(&mut info, &mut items, &event);
        }
        assert_eq!(
            items.iter().find(|item| item["id"] == "stream").unwrap()["text"],
            (event_count - 1).to_string()
        );
    }

    #[tokio::test]
    async fn attach_since_uses_only_the_retained_contiguous_tail() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        for index in 0..3 {
            actor
                .upsert(json!({
                    "id": "stream", "createdAt": 1, "turnId": "turn-active",
                    "kind": "assistant", "text": index.to_string(), "streaming": true,
                }))
                .await;
        }

        assert_eq!(actor.events_after(0).unwrap().len(), 3);
        assert!(actor.events_after(actor.seq).unwrap().is_empty());
        assert!(actor.events_after(actor.seq + 1).is_none());

        actor.persist_snapshot().await.unwrap();
        assert!(actor.events_after(0).is_none());
        assert!(actor.events_after(actor.seq).unwrap().is_empty());
        actor.reset_seq = actor.seq + 1;
        actor.seq += 1;
        assert!(actor.events_after(actor.seq - 1).is_none());
    }

    #[tokio::test]
    async fn text_deltas_do_not_publish_runtime_lifecycle_facts() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        let facts = Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = facts.clone();
        *actor
            .public
            .runtime_change_sink
            .write()
            .expect("runtime sink lock") =
            Some(Arc::new(move |_info, seq, _generation, _outcome| {
                seen.lock().unwrap().push(seq);
            }));

        actor
            .upsert(json!({
                "id": "answer", "createdAt": 1, "turnId": "turn-active",
                "kind": "assistant", "text": "one", "streaming": true,
            }))
            .await;
        actor
            .upsert(json!({
                "id": "answer", "createdAt": 1, "turnId": "turn-active",
                "kind": "assistant", "text": "one two", "streaming": true,
            }))
            .await;

        assert!(facts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn orphaned_claude_subagent_settles_from_its_complete_transcript() {
        let temporary = tempfile::tempdir().unwrap();
        let mut actor = test_actor(temporary.path());
        actor.info["agentSessionId"] = json!("session-1");
        actor.claude_projects = temporary.path().join("projects");
        let directory = actor
            .claude_projects
            .join(subagents::claude_project_slug(
                temporary.path().to_str().unwrap(),
            ))
            .join("session-1/subagents");
        tokio::fs::create_dir_all(&directory).await.unwrap();
        tokio::fs::write(
            directory.join("agent-child.meta.json"),
            json!({ "agentId": "child", "toolUseId": "toolu-child" }).to_string(),
        )
        .await
        .unwrap();
        tokio::fs::write(
            directory.join("agent-child.jsonl"),
            format!(
                "{}\n",
                json!({
                    "type": "assistant", "timestamp": "2026-09-16T09:12:12.045Z",
                    "message": { "content": [{ "type": "text", "text": "Finished" }], "stop_reason": "end_turn" }
                })
            ),
        )
        .await
        .unwrap();
        actor
            .upsert(json!({
                "id": "subagent-1", "kind": "subagent", "toolUseId": "toolu-child",
                "background": true, "status": "running", "finishedAt": null, "result": null,
            }))
            .await;

        actor
            .settle_orphaned_subagents(actor.running_background_subagents(), true)
            .await;

        let row = &actor.items[*actor.item_index.get("subagent-1").unwrap()];
        assert_eq!(row["status"], "done");
        assert_eq!(row["result"], "Finished");
        assert_eq!(row["finishedAt"], 1_789_549_932_045_u64);
    }

    #[tokio::test]
    async fn direct_create_does_not_inherit_connected_composer_preferences() {
        let temporary = tempfile::tempdir().unwrap();
        let service = ChatService::new(temporary.path().to_owned(), EventBus::default())
            .await
            .unwrap();
        service
            .set_preferences(
                json!({
                    "runtimeMode": "supervised",
                    "terminalRuntimeMode": "auto",
                    "selections": { "claude": { "model": "opus", "options": {} } },
                    "changedAt": 20,
                }),
                "newer",
            )
            .unwrap();
        service
            .set_preferences(
                json!({ "runtimeMode": "full-access", "changedAt": 10 }),
                "older",
            )
            .unwrap();
        assert_eq!(service.terminal_runtime_mode().as_deref(), Some("auto"));

        let info = service
            .create(json!({
                "chatId": "preferred",
                "provider": "claude",
                "cwd": temporary.path(),
            }))
            .await
            .unwrap();
        assert_eq!(info["runtimeMode"], "full-access");
        assert_ne!(info["selection"]["model"], "claude-opus-5");

        service.detach("newer").await;
        let info = service
            .create(json!({
                "chatId": "remaining",
                "provider": "claude",
                "cwd": temporary.path(),
            }))
            .await
            .unwrap();
        assert_eq!(info["runtimeMode"], "full-access");
        service.shutdown().await;
    }

    #[tokio::test]
    async fn child_environment_drops_inherited_runtime_identity() {
        let temporary = tempfile::tempdir().unwrap();
        let mut environment = HashMap::from([
            ("PATH".to_owned(), "/bin".to_owned()),
            ("RUIMTE_HOOK_URL".to_owned(), "stale-hook".to_owned()),
            ("RUIMTE_HOOK_TOKEN".to_owned(), "stale-token".to_owned()),
            ("RUIMTE_CONTEXT_URL".to_owned(), "stale-context".to_owned()),
            ("RUIMTE_CONTEXT_TOKEN".to_owned(), "stale-bearer".to_owned()),
            ("RUIMTE_SESSION_ID".to_owned(), "parent".to_owned()),
        ]);
        environment.insert(
            "HOME".to_owned(),
            temporary.path().to_string_lossy().into_owned(),
        );
        let service = ChatService::new_with_config(
            temporary.path().to_owned(),
            EventBus::default(),
            ChatConfig::default().with_environment(environment),
        )
        .await
        .unwrap();
        service.set_context_url("http://owned/context".into());
        let child = service.environment();
        assert_eq!(
            child.get("RUIMTE_CONTEXT_URL").map(String::as_str),
            Some("http://owned/context")
        );
        for key in [
            "RUIMTE_HOOK_URL",
            "RUIMTE_HOOK_TOKEN",
            "RUIMTE_CONTEXT_TOKEN",
            "RUIMTE_SESSION_ID",
        ] {
            assert!(
                !child.contains_key(key),
                "{key} survived environment scrubbing"
            );
        }
        service.shutdown().await;
    }

    #[tokio::test]
    async fn drop_unspoken_fork_removes_only_its_owned_record_and_transcript() {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().join("repo");
        tokio::fs::create_dir_all(&cwd).await.unwrap();
        let info = json!({
            "chatId": "fork", "provider": "claude", "cwd": cwd,
            "agentSessionId": "session-fork", "model": null,
            "selection": { "model": "claude-sonnet-4-5", "options": {} },
            "runtimeMode": "supervised", "status": "idle", "running": false,
            "activeTurnId": null, "slashCommands": [],
            "usage": { "contextTokens": 0, "contextWindow": 200000, "costUsd": 0, "turns": 1 },
            "forkOf": { "chatId": "lead", "turnId": "turn-1", "at": 2 }, "createdAt": 2,
        });
        let items = vec![json!({
            "id": "turn-1", "createdAt": 1, "turnId": "turn-1", "kind": "turn",
            "origin": "user", "state": "done", "endedAt": 2, "costUsd": 0,
        })];
        let home = temporary.path().join("home");
        ChatStore::new(&home)
            .write_record("fork", &info, &items, &[])
            .await
            .unwrap();
        let transcript = temporary
            .path()
            .join(".claude/projects")
            .join(subagents::claude_project_slug(cwd.to_str().unwrap()))
            .join("session-fork.jsonl");
        tokio::fs::create_dir_all(transcript.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&transcript, "copied").await.unwrap();
        let service = ChatService::new_with_config(
            home.clone(),
            EventBus::default(),
            ChatConfig::default().with_environment(HashMap::from([(
                "HOME".to_owned(),
                temporary.path().to_string_lossy().into_owned(),
            )])),
        )
        .await
        .unwrap();
        assert!(service.drop_unspoken_fork("fork").await.unwrap());
        assert!(ChatStore::new(&home).read("fork").await.unwrap().is_none());
        assert!(!transcript.exists());

        let mut spoken = items;
        spoken.push(json!({
            "id": "turn-2", "createdAt": 3, "turnId": "turn-2", "kind": "turn",
            "origin": "user", "state": "done", "endedAt": 4, "costUsd": 0,
        }));
        let mut spoken_info = info.clone();
        spoken_info["chatId"] = json!("spoken");
        ChatStore::new(&home)
            .write_record("spoken", &spoken_info, &spoken, &[])
            .await
            .unwrap();
        assert!(!service.drop_unspoken_fork("spoken").await.unwrap());
        assert!(
            ChatStore::new(&home)
                .read("spoken")
                .await
                .unwrap()
                .is_some()
        );
        service.shutdown().await;
    }

    #[tokio::test]
    async fn claude_fork_cuts_transcript_before_placing_node() {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().join("repo");
        tokio::fs::create_dir(&cwd).await.unwrap();
        let source_info = json!({
            "chatId": "lead",
            "provider": "claude",
            "cwd": cwd,
            "agentSessionId": "session-old",
            "model": "fake",
            "selection": { "model": "claude-sonnet-4-5", "options": {} },
            "runtimeMode": "supervised",
            "status": "idle",
            "running": false,
            "activeTurnId": null,
            "slashCommands": [],
            "usage": { "contextTokens": 100, "contextWindow": 200000, "costUsd": 1, "turns": 1 },
            "createdAt": 1,
        });
        let source_items = vec![
            json!({ "id": "turn-1", "createdAt": 1, "turnId": "turn-1", "kind": "turn", "state": "done", "endedAt": 2, "costUsd": 1, "native": { "lastUuid": "answer-1" } }),
            json!({ "id": "user-1", "createdAt": 1, "turnId": "turn-1", "kind": "user", "text": "alpha" }),
            json!({ "id": "assistant-1", "createdAt": 2, "turnId": "turn-1", "kind": "assistant", "text": "done", "streaming": false }),
        ];
        ChatStore::new(temporary.path())
            .write_record("lead", &source_info, &source_items, &[])
            .await
            .unwrap();
        let slug = cwd
            .to_string_lossy()
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let projects = temporary.path().join(".claude/projects").join(slug);
        tokio::fs::create_dir_all(&projects).await.unwrap();
        let transcript = [
            json!({ "type": "user", "uuid": "prompt-1", "sessionId": "session-old", "message": { "content": "alpha" } }),
            json!({ "type": "assistant", "uuid": "answer-1", "sessionId": "session-old", "message": { "content": [{ "type": "text", "text": "done" }] } }),
        ]
        .into_iter()
        .map(|line| format!("{}\n", serde_json::to_string(&line).unwrap()))
        .collect::<String>();
        tokio::fs::write(projects.join("session-old.jsonl"), transcript)
            .await
            .unwrap();
        let environment = HashMap::from([
            (
                "HOME".into(),
                temporary.path().to_string_lossy().into_owned(),
            ),
            ("PATH".into(), std::env::var("PATH").unwrap_or_default()),
        ]);
        let service = ChatService::new_with_config(
            temporary.path().to_owned(),
            EventBus::default(),
            ChatConfig::default()
                .with_command("claude", vec!["unused".into()])
                .with_environment(environment),
        )
        .await
        .unwrap();
        let host = Arc::new(TestForkHost::default());
        let host_trait: Arc<dyn ChatForkWorkspaceHost> = host.clone();
        service.install_fork_host(Arc::downgrade(&host_trait));

        let result = service
            .fork(json!({ "chatId": "lead", "turnId": "turn-1" }))
            .await
            .unwrap();
        assert_eq!(result["info"]["forkOf"]["chatId"], "lead");
        assert_eq!(result["viewId"], "canvas");
        let fork_id = result["nodeId"].as_str().unwrap();
        let record = ChatStore::new(temporary.path())
            .read(fork_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(record.items[..source_items.len()], source_items);
        assert!(record.preambles[0].contains("forked from node lead (\"Lexer\")"));
        let new_session = result["info"]["agentSessionId"].as_str().unwrap();
        let copy = tokio::fs::read_to_string(projects.join(format!("{new_session}.jsonl")))
            .await
            .unwrap();
        assert!(copy.contains(new_session));
        assert!(!copy.contains("session-old"));
        assert_eq!(host.placements.lock().unwrap().len(), 1);
        service.shutdown().await;
    }
}
