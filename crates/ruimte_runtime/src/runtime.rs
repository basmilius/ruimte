use std::sync::{Arc, RwLock, Weak};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{chat::ChatService, rpc::RpcError, sessions::SessionsService};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeMode {
    Supervised,
    AutoAcceptEdits,
    Auto,
    FullAccess,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Gemini,
    Copilot,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeTargetKind {
    Terminal,
    Chat,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTarget {
    pub kind: RuntimeTargetKind,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub node_id: String,
    pub target: RuntimeTarget,
    pub provider: Option<AgentKind>,
    pub mode: RuntimeMode,
    pub generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuthority {
    pub identity: RuntimeIdentity,
    pub project_id: String,
    pub lineage_depth: u32,
    pub mode_ceiling: RuntimeMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOperation<T> {
    pub operation_id: Uuid,
    pub authority: RuntimeAuthority,
    pub input: T,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVersion {
    pub epoch: Uuid,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeView {
    pub identity: RuntimeIdentity,
    pub version: RuntimeVersion,
    pub process_generation: Option<u64>,
    pub chat_seq: Option<u64>,
    pub info: Value,
    pub text: Option<String>,
    pub items: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeOutcome {
    Done,
    Error,
    Aborted,
    Exited,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RuntimeFactKind {
    Updated {
        process_generation: Option<u64>,
        chat_seq: Option<u64>,
    },
    Settled {
        outcome: RuntimeOutcome,
        process_generation: Option<u64>,
        chat_seq: Option<u64>,
    },
    Removed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFact {
    pub source: RuntimeTarget,
    pub version: RuntimeVersion,
    #[serde(flatten)]
    pub fact: RuntimeFactKind,
}

pub trait RuntimeFactSink: Send + Sync {
    fn try_publish(&self, fact: RuntimeFact) -> Result<(), RuntimeTarget>;
    fn mark_dirty(&self, source: RuntimeTarget);
}

#[derive(Clone, Default)]
pub struct RuntimeFacts {
    sink: Arc<RwLock<Option<Weak<dyn RuntimeFactSink>>>>,
}

impl RuntimeFacts {
    pub fn install(&self, sink: Weak<dyn RuntimeFactSink>) {
        *self.sink.write().expect("runtime fact sink lock poisoned") = Some(sink);
    }

    pub fn publish(&self, fact: RuntimeFact) {
        let sink = self
            .sink
            .read()
            .expect("runtime fact sink lock poisoned")
            .as_ref()
            .and_then(Weak::upgrade);
        if let Some(sink) = sink
            && let Err(source) = sink.try_publish(fact)
        {
            sink.mark_dirty(source);
        }
    }

    pub fn mark_dirty(&self, source: RuntimeTarget) {
        let sink = self
            .sink
            .read()
            .expect("runtime fact sink lock poisoned")
            .as_ref()
            .and_then(Weak::upgrade);
        if let Some(sink) = sink {
            sink.mark_dirty(source);
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStart {
    pub target: RuntimeTarget,
    pub cwd: Option<String>,
    pub provider: AgentKind,
    pub mode: RuntimeMode,
    pub prompt: Option<String>,
    pub resume: Option<String>,
    pub selection: Option<Value>,
    pub resume_turn_id: Option<String>,
    pub resume_attempt: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWake {
    pub target: RuntimeTarget,
    pub text: String,
    pub label: String,
    pub note: Option<String>,
    pub task_ids: Vec<String>,
    pub summary_for: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNote {
    pub target: RuntimeTarget,
    pub note_id: String,
    pub note: String,
    pub from: String,
    pub preamble: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePreamble {
    pub target: RuntimeTarget,
    pub text: String,
}

#[async_trait]
pub trait RuntimeHost: Send + Sync {
    async fn resolve_bearer(&self, token: &str) -> Result<Option<RuntimeIdentity>, RpcError>;
    async fn inspect(&self, target: &RuntimeTarget) -> Result<Option<RuntimeView>, RpcError>;
    async fn start(
        &self,
        operation: RuntimeOperation<RuntimeStart>,
    ) -> Result<RuntimeView, RpcError>;
    async fn stop(&self, operation: RuntimeOperation<RuntimeTarget>) -> Result<(), RpcError>;
    async fn wake(&self, operation: RuntimeOperation<RuntimeWake>)
    -> Result<RuntimeView, RpcError>;
    async fn note(&self, operation: RuntimeOperation<RuntimeNote>)
    -> Result<RuntimeView, RpcError>;
    async fn preamble(
        &self,
        operation: RuntimeOperation<RuntimePreamble>,
    ) -> Result<RuntimeView, RpcError>;
    async fn read(
        &self,
        authority: &RuntimeAuthority,
        target: &RuntimeTarget,
    ) -> Result<Option<RuntimeView>, RpcError>;
    async fn read_subagent(
        &self,
        authority: &RuntimeAuthority,
        chat: &RuntimeTarget,
        tool_use_id: &str,
    ) -> Result<Option<Vec<Value>>, RpcError>;
    async fn sync_task_row(&self, _parent: &RuntimeTarget, _task: Value) -> Result<(), RpcError> {
        Ok(())
    }
    async fn drop_unspoken_fork(&self, _fork_id: &str) -> Result<bool, RpcError> {
        Ok(false)
    }
    async fn screen_notice(&self, _target: &RuntimeTarget, _text: &str) -> Result<bool, RpcError> {
        Ok(false)
    }
}

#[derive(Clone)]
pub struct NativeRuntimeHost {
    inner: Arc<NativeRuntimeInner>,
}

struct NativeRuntimeInner {
    sessions: SessionsService,
    chats: ChatService,
    facts: RuntimeFacts,
    epoch: Uuid,
}

impl NativeRuntimeHost {
    pub fn new(sessions: SessionsService, chats: ChatService) -> Self {
        let inner = Arc::new(NativeRuntimeInner {
            sessions,
            chats,
            facts: RuntimeFacts::default(),
            epoch: Uuid::new_v4(),
        });
        let weak = Arc::downgrade(&inner);
        inner
            .sessions
            .install_runtime_change_sink(Arc::new(move |info, revision| {
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                let id = info
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let target = RuntimeTarget {
                    kind: RuntimeTargetKind::Terminal,
                    id,
                };
                let generation = info
                    .get("runtimeGeneration")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                let status = info.pointer("/agent/status").and_then(Value::as_str);
                let fact = match status {
                    Some("idle") => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Done,
                        process_generation: Some(generation),
                        chat_seq: None,
                    },
                    Some("error") => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Error,
                        process_generation: Some(generation),
                        chat_seq: None,
                    },
                    Some("exited") | None => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Exited,
                        process_generation: Some(generation),
                        chat_seq: None,
                    },
                    _ => RuntimeFactKind::Updated {
                        process_generation: Some(generation),
                        chat_seq: None,
                    },
                };
                inner.facts.publish(RuntimeFact {
                    source: target,
                    version: RuntimeVersion {
                        epoch: inner.epoch,
                        revision,
                    },
                    fact,
                });
            }));
        let weak = Arc::downgrade(&inner);
        inner
            .chats
            .install_runtime_change_sink(Arc::new(move |info, seq, generation, outcome| {
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                let id = info
                    .get("chatId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let fact = match outcome.as_deref() {
                    Some("done") => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Done,
                        process_generation: Some(generation),
                        chat_seq: Some(seq),
                    },
                    Some("error") => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Error,
                        process_generation: Some(generation),
                        chat_seq: Some(seq),
                    },
                    Some("aborted") => RuntimeFactKind::Settled {
                        outcome: RuntimeOutcome::Aborted,
                        process_generation: Some(generation),
                        chat_seq: Some(seq),
                    },
                    _ => RuntimeFactKind::Updated {
                        process_generation: Some(generation),
                        chat_seq: Some(seq),
                    },
                };
                inner.facts.publish(RuntimeFact {
                    source: RuntimeTarget {
                        kind: RuntimeTargetKind::Chat,
                        id,
                    },
                    version: RuntimeVersion {
                        epoch: inner.epoch,
                        revision: seq,
                    },
                    fact,
                });
            }));
        Self { inner }
    }

    pub fn facts(&self) -> RuntimeFacts {
        self.inner.facts.clone()
    }

    pub fn shared(&self) -> Arc<dyn RuntimeHost> {
        Arc::new(self.clone())
    }

    async fn view(&self, target: &RuntimeTarget) -> Result<Option<RuntimeView>, RpcError> {
        match target.kind {
            RuntimeTargetKind::Terminal => {
                let Some((info, revision)) = self.inner.sessions.runtime_info(&target.id).await
                else {
                    return Ok(None);
                };
                let text = self.inner.sessions.plain_text(&target.id).await?;
                let generation = info
                    .get("runtimeGeneration")
                    .and_then(Value::as_u64)
                    .unwrap_or(1);
                Ok(Some(RuntimeView {
                    identity: terminal_identity(target.clone(), &info, generation),
                    version: RuntimeVersion {
                        epoch: self.inner.epoch,
                        revision,
                    },
                    process_generation: Some(generation),
                    chat_seq: None,
                    info,
                    text: Some(text),
                    items: Vec::new(),
                }))
            }
            RuntimeTargetKind::Chat => {
                let Some(state) = self.inner.chats.runtime_view(&target.id).await? else {
                    return Ok(None);
                };
                Ok(Some(RuntimeView {
                    identity: chat_identity(target.clone(), &state.info, state.generation),
                    version: RuntimeVersion {
                        epoch: self.inner.epoch,
                        revision: state.seq,
                    },
                    process_generation: Some(state.generation),
                    chat_seq: Some(state.seq),
                    info: state.info,
                    text: None,
                    items: state.items,
                }))
            }
        }
    }

    fn publish_updated(&self, view: &RuntimeView) {
        self.inner.facts.publish(RuntimeFact {
            source: view.identity.target.clone(),
            version: view.version,
            fact: RuntimeFactKind::Updated {
                process_generation: view.process_generation,
                chat_seq: view.chat_seq,
            },
        });
    }
}

#[async_trait]
impl RuntimeHost for NativeRuntimeHost {
    async fn resolve_bearer(&self, token: &str) -> Result<Option<RuntimeIdentity>, RpcError> {
        if let Some(identity) = self.inner.chats.resolve_bearer(token).await {
            return Ok(Some(identity));
        }
        Ok(self.inner.sessions.resolve_bearer(token).await)
    }

    async fn inspect(&self, target: &RuntimeTarget) -> Result<Option<RuntimeView>, RpcError> {
        self.view(target).await
    }

    async fn start(
        &self,
        operation: RuntimeOperation<RuntimeStart>,
    ) -> Result<RuntimeView, RpcError> {
        let start = operation.input;
        if mode_rank(start.mode) > mode_rank(operation.authority.mode_ceiling) {
            return Err(RpcError::new(
                "runtime-mode-refused",
                "The requested runtime mode exceeds the caller's ceiling",
            ));
        }
        if start.resume_turn_id.is_some() != start.resume_attempt.is_some() {
            return Err(RpcError::new(
                "invalid-request",
                "An interrupted turn resume needs both turnId and attempt",
            ));
        }
        if let (Some(turn_id), Some(attempt)) = (start.resume_turn_id.clone(), start.resume_attempt)
        {
            if start.target.kind != RuntimeTargetKind::Chat {
                return Err(RpcError::new(
                    "runtime-resume-unsupported",
                    "Only native chat turns can resume after a restart",
                ));
            }
            self.inner
                .chats
                .runtime_create(json!({ "chatId": start.target.id }))
                .await?;
            self.inner
                .chats
                .runtime_resume(&start.target.id, turn_id, attempt)
                .await?;
            let view = self.view(&start.target).await?.ok_or_else(|| {
                RpcError::new(
                    "runtime-not-found",
                    "The runtime disappeared while resuming",
                )
            })?;
            self.publish_updated(&view);
            return Ok(view);
        }
        match start.target.kind {
            RuntimeTargetKind::Terminal => {
                self.inner
                    .sessions
                    .runtime_create_agent(
                        start.target.id.clone(),
                        start.cwd,
                        start.provider,
                        start.mode,
                        start.resume,
                        start.prompt,
                        operation.authority.lineage_depth,
                    )
                    .await?;
            }
            RuntimeTargetKind::Chat => {
                self.inner
                    .chats
                    .runtime_create(json!({
                        "chatId": start.target.id,
                        "provider": agent_kind(start.provider),
                        "cwd": start.cwd,
                        "resume": start.resume,
                        "selection": start.selection,
                        "runtimeMode": runtime_mode(start.mode),
                    }))
                    .await?;
                if let Some(prompt) = start.prompt {
                    self.inner
                        .chats
                        .runtime_start(&start.target.id, prompt, operation.operation_id)
                        .await?;
                }
            }
        }
        let view = self.view(&start.target).await?.ok_or_else(|| {
            RpcError::new(
                "runtime-not-found",
                "The runtime disappeared while starting",
            )
        })?;
        self.publish_updated(&view);
        Ok(view)
    }

    async fn stop(&self, operation: RuntimeOperation<RuntimeTarget>) -> Result<(), RpcError> {
        match operation.input.kind {
            RuntimeTargetKind::Terminal => {
                self.inner
                    .sessions
                    .runtime_stop(&operation.input.id)
                    .await?;
            }
            RuntimeTargetKind::Chat => {
                self.inner.chats.runtime_stop(&operation.input.id).await?;
            }
        }
        Ok(())
    }

    async fn wake(
        &self,
        operation: RuntimeOperation<RuntimeWake>,
    ) -> Result<RuntimeView, RpcError> {
        let wake = operation.input;
        if wake.target.kind != RuntimeTargetKind::Chat {
            return Err(RpcError::new(
                "runtime-wake-unsupported",
                "Agent-origin wake is only implemented for native chats",
            ));
        }
        self.inner
            .chats
            .runtime_wake(
                &wake.target.id,
                wake.text,
                wake.label,
                wake.note,
                wake.task_ids,
                wake.summary_for,
                operation.operation_id,
            )
            .await?;
        let view = self.view(&wake.target).await?.ok_or_else(|| {
            RpcError::new("runtime-not-found", "The runtime disappeared while waking")
        })?;
        self.publish_updated(&view);
        Ok(view)
    }

    async fn note(
        &self,
        operation: RuntimeOperation<RuntimeNote>,
    ) -> Result<RuntimeView, RpcError> {
        let note = operation.input;
        if note.target.kind != RuntimeTargetKind::Chat {
            return Err(RpcError::new(
                "runtime-note-unsupported",
                "Durable runtime note delivery is only implemented for native chats",
            ));
        }
        self.inner
            .chats
            .runtime_note(
                &note.target.id,
                operation.operation_id,
                note.note_id,
                note.note,
                note.from,
                note.preamble,
            )
            .await?;
        let view = self.view(&note.target).await?.ok_or_else(|| {
            RpcError::new(
                "runtime-not-found",
                "The runtime disappeared while delivering a note",
            )
        })?;
        self.publish_updated(&view);
        Ok(view)
    }

    async fn preamble(
        &self,
        operation: RuntimeOperation<RuntimePreamble>,
    ) -> Result<RuntimeView, RpcError> {
        let preamble = operation.input;
        if preamble.target.kind != RuntimeTargetKind::Chat {
            return Err(RpcError::new(
                "runtime-preamble-unsupported",
                "Durable runtime preambles are only implemented for native chats",
            ));
        }
        self.inner
            .chats
            .runtime_preamble(&preamble.target.id, operation.operation_id, preamble.text)
            .await?;
        let view = self.view(&preamble.target).await?.ok_or_else(|| {
            RpcError::new(
                "runtime-not-found",
                "The runtime disappeared while queuing a preamble",
            )
        })?;
        self.publish_updated(&view);
        Ok(view)
    }

    async fn read(
        &self,
        _authority: &RuntimeAuthority,
        target: &RuntimeTarget,
    ) -> Result<Option<RuntimeView>, RpcError> {
        self.view(target).await
    }

    async fn read_subagent(
        &self,
        _authority: &RuntimeAuthority,
        chat: &RuntimeTarget,
        tool_use_id: &str,
    ) -> Result<Option<Vec<Value>>, RpcError> {
        if chat.kind != RuntimeTargetKind::Chat {
            return Ok(None);
        }
        self.inner
            .chats
            .runtime_read_subagent(&chat.id, tool_use_id)
            .await
    }

    async fn sync_task_row(&self, parent: &RuntimeTarget, task: Value) -> Result<(), RpcError> {
        if parent.kind != RuntimeTargetKind::Chat {
            return Ok(());
        }
        self.inner.chats.runtime_sync_task(&parent.id, task).await
    }

    async fn drop_unspoken_fork(&self, fork_id: &str) -> Result<bool, RpcError> {
        self.inner.chats.drop_unspoken_fork(fork_id).await
    }

    async fn screen_notice(&self, target: &RuntimeTarget, text: &str) -> Result<bool, RpcError> {
        if target.kind != RuntimeTargetKind::Terminal {
            return Ok(false);
        }
        self.inner.sessions.runtime_notice(&target.id, text).await
    }
}

fn terminal_identity(target: RuntimeTarget, info: &Value, generation: u64) -> RuntimeIdentity {
    RuntimeIdentity {
        node_id: target.id.clone(),
        target,
        provider: info
            .pointer("/agent/kind")
            .and_then(Value::as_str)
            .and_then(parse_agent_kind),
        mode: info
            .pointer("/agent/runtimeMode")
            .and_then(Value::as_str)
            .and_then(parse_runtime_mode)
            .unwrap_or(RuntimeMode::Supervised),
        generation,
    }
}

fn chat_identity(target: RuntimeTarget, info: &Value, generation: u64) -> RuntimeIdentity {
    RuntimeIdentity {
        node_id: target.id.clone(),
        target,
        provider: info
            .get("provider")
            .and_then(Value::as_str)
            .and_then(parse_agent_kind),
        mode: info
            .get("runtimeMode")
            .and_then(Value::as_str)
            .and_then(parse_runtime_mode)
            .unwrap_or(RuntimeMode::Supervised),
        generation,
    }
}

fn agent_kind(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Gemini => "gemini",
        AgentKind::Copilot => "copilot",
    }
}

fn parse_agent_kind(kind: &str) -> Option<AgentKind> {
    match kind {
        "claude" => Some(AgentKind::Claude),
        "codex" => Some(AgentKind::Codex),
        "gemini" => Some(AgentKind::Gemini),
        "copilot" => Some(AgentKind::Copilot),
        _ => None,
    }
}

fn runtime_mode(mode: RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Supervised => "supervised",
        RuntimeMode::AutoAcceptEdits => "auto-accept-edits",
        RuntimeMode::Auto => "auto",
        RuntimeMode::FullAccess => "full-access",
    }
}

fn parse_runtime_mode(mode: &str) -> Option<RuntimeMode> {
    match mode {
        "supervised" => Some(RuntimeMode::Supervised),
        "auto-accept-edits" => Some(RuntimeMode::AutoAcceptEdits),
        "auto" => Some(RuntimeMode::Auto),
        "full-access" => Some(RuntimeMode::FullAccess),
        _ => None,
    }
}

fn mode_rank(mode: RuntimeMode) -> u8 {
    match mode {
        RuntimeMode::Supervised => 0,
        RuntimeMode::AutoAcceptEdits => 1,
        RuntimeMode::Auto => 2,
        RuntimeMode::FullAccess => 3,
    }
}
