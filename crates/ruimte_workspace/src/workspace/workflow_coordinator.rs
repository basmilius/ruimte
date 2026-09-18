use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex as StdMutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use serde_json::{Value, json};
use tokio::sync::{Mutex, Notify, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    rpc::RpcError,
    runtime::{
        AgentKind, RuntimeAuthority, RuntimeFact, RuntimeFactKind, RuntimeFactSink, RuntimeHost,
        RuntimeMode, RuntimeNote, RuntimeOperation, RuntimeStart, RuntimeTarget, RuntimeTargetKind,
        RuntimeView, RuntimeWake,
    },
};

use super::{
    outbox_store::OutboxStore, project::ProjectStore, util::now_ms, workflow::result_of_turn,
    workflow_store::WorkflowStore,
};

const RETRY_DELAYS_MS: [u64; 3] = [1_000, 5_000, 30_000];
const RESULT_PREVIEW_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Eq, PartialEq)]
enum WorkOutcome {
    Done,
    Wait,
}

pub(crate) struct RuntimeNodeState {
    pub id: String,
    pub live: bool,
    pub working: bool,
}

#[derive(Default)]
struct WaitState {
    waiting: HashSet<String>,
    generations: HashMap<String, u64>,
}

struct TaskState {
    accepting: bool,
    active: usize,
}

struct TaskCompletion {
    state: Arc<StdMutex<TaskState>>,
    done: Arc<Notify>,
}

impl Drop for TaskCompletion {
    fn drop(&mut self) {
        self.state
            .lock()
            .expect("workflow task state lock poisoned")
            .active -= 1;
        self.done.notify_waiters();
    }
}

pub(crate) struct WorkflowCoordinator {
    projects: Arc<ProjectStore>,
    store: WorkflowStore,
    outbox: OutboxStore,
    runtime: RwLock<Option<Arc<dyn RuntimeHost>>>,
    fact_tx: mpsc::Sender<RuntimeFact>,
    dirty: StdMutex<HashSet<RuntimeTarget>>,
    dirty_attempts: StdMutex<HashMap<RuntimeTarget, usize>>,
    dirty_notify: Notify,
    resume_owing: Mutex<()>,
    summaries_owed: Mutex<HashSet<String>>,
    running: Mutex<HashSet<String>>,
    waits: Mutex<WaitState>,
    notify: Notify,
    cancel: CancellationToken,
    task_state: Arc<StdMutex<TaskState>>,
    task_done: Arc<Notify>,
    stopped: AtomicBool,
}

impl WorkflowCoordinator {
    pub(crate) fn new(projects: Arc<ProjectStore>, store: WorkflowStore) -> Arc<Self> {
        let (fact_tx, fact_rx) = mpsc::channel(256);
        let coordinator = Arc::new(Self {
            projects,
            outbox: store.outbox().clone(),
            store,
            runtime: RwLock::new(None),
            fact_tx,
            dirty: StdMutex::new(HashSet::new()),
            dirty_attempts: StdMutex::new(HashMap::new()),
            dirty_notify: Notify::new(),
            resume_owing: Mutex::new(()),
            summaries_owed: Mutex::new(HashSet::new()),
            running: Mutex::new(HashSet::new()),
            waits: Mutex::new(WaitState::default()),
            notify: Notify::new(),
            cancel: CancellationToken::new(),
            task_state: Arc::new(StdMutex::new(TaskState {
                accepting: true,
                active: 0,
            })),
            task_done: Arc::new(Notify::new()),
            stopped: AtomicBool::new(false),
        });
        coordinator.spawn(coordinator.clone().fact_loop(fact_rx));
        coordinator.spawn(coordinator.clone().dirty_loop());
        coordinator.spawn(coordinator.clone().outbox_loop());
        coordinator
    }

    pub(crate) fn install_runtime(self: &Arc<Self>, runtime: Arc<dyn RuntimeHost>) {
        *self.runtime.write().expect("runtime host lock poisoned") = Some(runtime);
        let coordinator = self.clone();
        self.spawn(async move {
            let mut repair_attempt = 0;
            loop {
                match coordinator.ensure_wake_entries().await {
                    Ok(()) => break,
                    Err(error) => {
                        eprintln!("Repairing task wake entries failed: {error}");
                        let delay = RETRY_DELAYS_MS[repair_attempt.min(RETRY_DELAYS_MS.len() - 1)];
                        repair_attempt += 1;
                        tokio::select! {
                            _ = coordinator.cancel.cancelled() => return,
                            _ = tokio::time::sleep(Duration::from_millis(delay)) => {},
                        }
                    }
                }
            }
            for task in coordinator.store.all_tasks().await {
                if let Err(error) = coordinator.sync_task_row(&task).await {
                    eprintln!("Restoring task row failed: {error}");
                }
                if task["status"] != "open" {
                    continue;
                }
                if let Some(child_id) = task["childId"].as_str() {
                    coordinator.mark_dirty(RuntimeTarget {
                        kind: coordinator.runtime_kind(child_id).await,
                        id: child_id.to_owned(),
                    });
                }
            }
            for entry in coordinator.outbox.list().await {
                if let Some(target) = entry["target"].as_str() {
                    coordinator.wake_target(target).await;
                }
            }
            coordinator.notify.notify_one();
        });
    }

    pub(crate) async fn shutdown(&self) {
        self.stopped.store(true, Ordering::Release);
        self.task_state
            .lock()
            .expect("workflow task state lock poisoned")
            .accepting = false;
        self.cancel.cancel();
        loop {
            let done = self.task_done.notified();
            if self
                .task_state
                .lock()
                .expect("workflow task state lock poisoned")
                .active
                == 0
            {
                break;
            }
            done.await;
        }
    }

    pub(crate) async fn enqueue(
        &self,
        project_id: &str,
        target: &str,
        work: Value,
        authority: &RuntimeAuthority,
    ) -> Result<Value, RpcError> {
        let authority = serde_json::to_value(authority)
            .map_err(|error| RpcError::new("internal-error", error.to_string()))?;
        let entry = self
            .outbox
            .put(project_id, target, work, Some(authority), now_ms())
            .await?;
        self.notify.notify_one();
        Ok(entry)
    }

    pub(crate) async fn stop_child(&self, node_id: &str, reason: &str) -> Result<(), RpcError> {
        let project_id = self.store.project_of(node_id).await.ok_or_else(|| {
            RpcError::new(
                "unknown-node",
                format!("No workflow lineage exists for {node_id}"),
            )
        })?;
        let parent_id = self.store.made_by(node_id).await.ok_or_else(|| {
            RpcError::new(
                "unknown-parent",
                format!("No workflow parent exists for {node_id}"),
            )
        })?;
        let mut node_ids = vec![node_id.to_owned()];
        node_ids.extend(self.store.descendants_including_ended(node_id).await);
        let authority = self
            .cascade_authority(&project_id, &parent_id, &node_ids)
            .await?;
        let cancelled = self
            .store
            .cancel_open(
                &std::iter::once(node_id.to_owned()).collect(),
                reason,
                now_ms(),
            )
            .await?;
        self.tasks_cancelled(&cancelled).await;
        self.store.drop_wake(node_id).await?;
        self.enqueue(
            &project_id,
            &parent_id,
            json!({ "kind": "end-children", "payload": { "nodeIds": node_ids } }),
            &authority,
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn owe_interrupted_run(
        &self,
        chat_id: &str,
        turn_id: &str,
        attempt: u32,
        created_at: u64,
    ) -> Result<bool, RpcError> {
        if let Some(ended_at) = self
            .store
            .lineage_entry(chat_id)
            .await
            .and_then(|entry| entry.get("endedAt").and_then(Value::as_u64))
            && ended_at >= created_at
        {
            return Ok(false);
        }
        let Some(place) = self.projects.locate(chat_id).await else {
            return Ok(false);
        };
        let Some(project_id) = place["projectId"].as_str().map(ToOwned::to_owned) else {
            return Ok(false);
        };
        let _guard = self.resume_owing.lock().await;
        let already_owed = self.outbox.list().await.into_iter().any(|entry| {
            entry["kind"] == "resume-run"
                && entry["target"] == chat_id
                && entry["payload"]["turnId"] == turn_id
                && entry["payload"]["attempt"] == attempt
        });
        if !already_owed {
            self.outbox
                .put(
                    &project_id,
                    chat_id,
                    json!({
                        "kind": "resume-run",
                        "payload": { "turnId": turn_id, "attempt": attempt }
                    }),
                    None,
                    now_ms(),
                )
                .await?;
            self.notify.notify_one();
        }
        Ok(true)
    }

    pub(crate) async fn done(
        &self,
        authority: &RuntimeAuthority,
        text: String,
    ) -> Result<Option<Value>, RpcError> {
        let child_id = &authority.identity.node_id;
        let Some(task) = self.store.open_for(child_id).await else {
            return Ok(None);
        };
        self.validate_task_authority(&task, authority, child_id, true)
            .await?;
        self.settle_and_owe(
            &task,
            "done",
            json!({ "text": text, "source": "done", "at": now_ms() }),
        )
        .await
    }

    pub(crate) async fn places_changed(
        &self,
        project_id: &str,
        existing_ids: &HashSet<String>,
    ) -> Result<(), RpcError> {
        let entries = self.outbox.list().await;
        for opener in self.store.orphan_openers(project_id, existing_ids).await {
            let node_ids = self.store.descendants(&opener).await;
            if node_ids.is_empty()
                || entries
                    .iter()
                    .any(|entry| entry["kind"] == "end-children" && entry["target"] == opener)
            {
                continue;
            }
            self.outbox
                .put(
                    project_id,
                    &opener,
                    json!({ "kind": "end-children", "payload": { "nodeIds": node_ids } }),
                    None,
                    now_ms(),
                )
                .await?;
        }
        self.notify.notify_one();
        Ok(())
    }

    pub(crate) async fn tasks_cancelled(&self, tasks: &[Value]) {
        for task in tasks {
            if let Err(error) = self.sync_task_row(task).await {
                eprintln!("Updating cancelled task row failed: {error}");
            }
        }
        for parent_id in tasks
            .iter()
            .filter_map(|task| task["parentId"].as_str())
            .collect::<HashSet<_>>()
        {
            self.mark_dirty(RuntimeTarget {
                kind: self.runtime_kind(parent_id).await,
                id: parent_id.to_owned(),
            });
        }
    }

    async fn fact_loop(self: Arc<Self>, mut receiver: mpsc::Receiver<RuntimeFact>) {
        loop {
            let fact = tokio::select! {
                _ = self.cancel.cancelled() => return,
                fact = receiver.recv() => match fact {
                    Some(fact) => fact,
                    None => return,
                }
            };
            let source = fact.source.clone();
            if let Err(error) = self.reconcile_fact(fact).await {
                eprintln!("Reconciling runtime fact for {} failed: {error}", source.id);
                self.mark_dirty(source);
            }
        }
    }

    async fn dirty_loop(self: Arc<Self>) {
        loop {
            tokio::select! {
                _ = self.cancel.cancelled() => return,
                _ = self.dirty_notify.notified() => {},
            }
            self.drain_dirty().await;
        }
    }

    async fn drain_dirty(self: &Arc<Self>) {
        let sources = {
            let mut dirty = self.dirty.lock().expect("workflow dirty lock poisoned");
            dirty.drain().collect::<Vec<_>>()
        };
        for source in sources {
            match self.reconcile_source(&source, None).await {
                Ok(()) => {
                    self.dirty_attempts
                        .lock()
                        .expect("workflow dirty attempts lock poisoned")
                        .remove(&source);
                }
                Err(error) => {
                    eprintln!(
                        "Reconciling dirty runtime source {} failed: {error}",
                        source.id
                    );
                    let attempt = {
                        let mut attempts = self
                            .dirty_attempts
                            .lock()
                            .expect("workflow dirty attempts lock poisoned");
                        let attempt = attempts.entry(source.clone()).or_default();
                        let current = *attempt;
                        *attempt = (*attempt + 1).min(RETRY_DELAYS_MS.len() - 1);
                        current
                    };
                    let delay = RETRY_DELAYS_MS[attempt.min(RETRY_DELAYS_MS.len() - 1)];
                    let coordinator = self.clone();
                    self.spawn(async move {
                        tokio::select! {
                            _ = coordinator.cancel.cancelled() => {},
                            _ = tokio::time::sleep(Duration::from_millis(delay)) => {
                                coordinator.mark_dirty(source);
                            },
                        }
                    });
                }
            }
        }
    }

    async fn reconcile_fact(&self, fact: RuntimeFact) -> Result<(), RpcError> {
        self.wake_target(&fact.source.id).await;
        self.reconcile_source(&fact.source, Some(&fact)).await
    }

    async fn reconcile_source(
        &self,
        source: &RuntimeTarget,
        fact: Option<&RuntimeFact>,
    ) -> Result<(), RpcError> {
        if source.kind == RuntimeTargetKind::Chat {
            self.reconcile_summaries(source, fact).await?;
            for task in self.store.tasks_of_parent(&source.id).await {
                self.sync_task_row(&task).await?;
            }
        }
        let Some(task) = self.store.open_for(&source.id).await else {
            return Ok(());
        };
        let authority = self.task_authority(&task).await?;
        self.validate_task_authority(&task, &authority, &source.id, false)
            .await?;
        if self.projects.locate(&source.id).await.is_none() {
            return Ok(());
        }
        let runtime = self.runtime_required()?;
        let current = runtime.read(&authority, source).await?;
        if let (Some(fact), Some(current)) = (fact, current.as_ref())
            && !fact_matches_view(fact, current)
        {
            return Ok(());
        }
        match source.kind {
            RuntimeTargetKind::Terminal => {
                if matches!(
                    fact.map(|fact| &fact.fact),
                    Some(RuntimeFactKind::Settled { .. } | RuntimeFactKind::Removed)
                ) && current.as_ref().is_none_or(terminal_settled)
                {
                    self.settle_and_owe(
                        &task,
                        "failed",
                        json!({
                            "text": "It ended without a result: a terminal reports back with ruimte-context done.",
                            "source": "exit",
                            "at": now_ms()
                        }),
                    )
                    .await?;
                }
            }
            RuntimeTargetKind::Chat => {
                let delegated = self
                    .store
                    .tasks_of_parent(&source.id)
                    .await
                    .iter()
                    .any(|task| task["status"] == "open" || task["wake"] == "pending");
                if delegated {
                    return Ok(());
                }
                let Some(view) = current else {
                    return Ok(());
                };
                if view
                    .info
                    .get("activeTurnId")
                    .is_some_and(|value| !value.is_null())
                {
                    return Ok(());
                }
                let created_at = task["createdAt"].as_u64().unwrap_or(0);
                let Some(turn) = view.items.iter().rev().find(|item| {
                    item["kind"] == "turn"
                        && item["state"] != "running"
                        && item["createdAt"].as_u64().unwrap_or(0) >= created_at
                }) else {
                    return Ok(());
                };
                let result = result_of_turn(turn, &view.items, now_ms());
                self.settle_and_owe(
                    &task,
                    result["status"].as_str().unwrap_or("failed"),
                    result["result"].clone(),
                )
                .await?;
            }
        }
        Ok(())
    }

    async fn reconcile_summaries(
        &self,
        source: &RuntimeTarget,
        fact: Option<&RuntimeFact>,
    ) -> Result<(), RpcError> {
        let Some(lineage) = self.store.lineage_entry(&source.id).await else {
            return Ok(());
        };
        let Some(expected_original) = summary_source(&lineage) else {
            return Ok(());
        };
        let Some(view) = self.runtime_required()?.inspect(source).await? else {
            return Ok(());
        };
        if fact.is_some_and(|fact| !fact_matches_view(fact, &view)) {
            return Ok(());
        }
        for turn in view.items.iter().filter(|item| {
            item["kind"] == "turn"
                && item["state"] == "done"
                && item["summaryFor"].as_str().is_some()
        }) {
            let Some(turn_id) = turn["id"].as_str() else {
                continue;
            };
            let Some(original_id) = turn["summaryFor"].as_str() else {
                continue;
            };
            if original_id != expected_original {
                continue;
            }
            let Some(text) = view.items.iter().rev().find_map(|item| {
                (item["kind"] == "assistant"
                    && item["turnId"] == turn_id
                    && item.get("parentToolUseId").is_none_or(Value::is_null))
                .then(|| item["text"].as_str().map(str::trim))
                .flatten()
                .filter(|text| !text.is_empty())
            }) else {
                continue;
            };
            let Some(place) = self.projects.locate(original_id).await else {
                continue;
            };
            let Some(project_id) = place["projectId"].as_str() else {
                continue;
            };
            let mut owed = self.summaries_owed.lock().await;
            if owed.contains(turn_id)
                || self.outbox.list().await.iter().any(|entry| {
                    entry["kind"] == "deliver-summary" && entry["payload"]["turnId"] == turn_id
                })
            {
                owed.insert(turn_id.to_owned());
                continue;
            }
            self.outbox
                .put(
                    project_id,
                    original_id,
                    json!({
                        "kind": "deliver-summary",
                        "payload": { "forkId": source.id, "turnId": turn_id, "text": text }
                    }),
                    None,
                    now_ms(),
                )
                .await?;
            owed.insert(turn_id.to_owned());
            drop(owed);
            self.notify.notify_one();
        }
        Ok(())
    }

    async fn settle_and_owe(
        &self,
        task: &Value,
        status: &str,
        result: Value,
    ) -> Result<Option<Value>, RpcError> {
        let Some(task_id) = task["id"].as_str() else {
            return Ok(None);
        };
        let Some(settled) = self
            .store
            .settle_task(task_id, status, Some(result), now_ms())
            .await?
        else {
            return Ok(None);
        };
        self.sync_task_row(&settled).await?;
        let authority = self.task_authority(&settled).await?;
        self.enqueue(
            settled["projectId"].as_str().unwrap_or_default(),
            settled["parentId"].as_str().unwrap_or_default(),
            json!({ "kind": "wake-parent", "payload": { "taskId": task_id } }),
            &authority,
        )
        .await?;
        Ok(Some(settled))
    }

    pub(crate) async fn sync_task(&self, task: &Value) {
        if let Err(error) = self.sync_task_row(task).await {
            eprintln!("Updating task row failed: {error}");
            if let Some(parent_id) = task["parentId"].as_str() {
                self.mark_dirty(RuntimeTarget {
                    kind: RuntimeTargetKind::Chat,
                    id: parent_id.to_owned(),
                });
            }
        }
    }

    pub(crate) async fn working_nodes(&self, node_ids: &[String]) -> Result<Vec<String>, RpcError> {
        Ok(self
            .runtime_node_states(node_ids)
            .await?
            .into_iter()
            .filter(|state| state.working)
            .map(|state| state.id)
            .collect())
    }

    pub(crate) async fn runtime_node_states(
        &self,
        node_ids: &[String],
    ) -> Result<Vec<RuntimeNodeState>, RpcError> {
        let Some(runtime) = self.runtime() else {
            return Ok(Vec::new());
        };
        let mut states = Vec::new();
        for node_id in node_ids {
            let target = RuntimeTarget {
                kind: self.runtime_kind(node_id).await,
                id: node_id.clone(),
            };
            let Some(view) = runtime.inspect(&target).await? else {
                continue;
            };
            let active = match target.kind {
                RuntimeTargetKind::Chat => view
                    .info
                    .get("activeTurnId")
                    .is_some_and(|turn| !turn.is_null()),
                RuntimeTargetKind::Terminal => {
                    view.info.pointer("/agent/live").and_then(Value::as_bool) == Some(true)
                        && view.info.pointer("/agent/status").and_then(Value::as_str)
                            == Some("running")
                }
            };
            let live = match target.kind {
                RuntimeTargetKind::Chat => view
                    .info
                    .get("running")
                    .and_then(Value::as_bool)
                    .unwrap_or(active),
                RuntimeTargetKind::Terminal => {
                    view.info.get("exited").and_then(Value::as_bool) != Some(true)
                }
            };
            states.push(RuntimeNodeState {
                id: node_id.clone(),
                live,
                working: active,
            });
        }
        Ok(states)
    }

    pub(crate) async fn stop_runtime_node(&self, node_id: &str) -> Result<(), RpcError> {
        let Some(runtime) = self.runtime() else {
            return Err(RpcError::new(
                "runtime-unavailable",
                "The runtime host is not installed",
            ));
        };
        let kind = self.runtime_kind(node_id).await;
        let target = RuntimeTarget {
            kind,
            id: node_id.to_owned(),
        };
        let Some(view) = runtime.inspect(&target).await? else {
            return Ok(());
        };
        let placed_project = self
            .projects
            .locate(node_id)
            .await
            .and_then(|place| place["projectId"].as_str().map(ToOwned::to_owned));
        let lineage_project = self.store.project_of(node_id).await;
        let project_id = placed_project.or(lineage_project.clone()).ok_or_else(|| {
            RpcError::new(
                "runtime-ownership-refused",
                format!("No project owns runtime {node_id}"),
            )
        })?;
        let authority = self.store.authority(view.identity, project_id).await;
        if lineage_project.is_some() {
            self.store
                .mark_ended(&[node_id.to_owned()], now_ms())
                .await?;
            let cancelled = self
                .store
                .cancel_open(
                    &std::iter::once(node_id.to_owned()).collect(),
                    "the worktree this agent worked in was merged or removed",
                    now_ms(),
                )
                .await?;
            self.tasks_cancelled(&cancelled).await;
            self.store.drop_wake(node_id).await?;
        }
        runtime
            .stop(RuntimeOperation {
                operation_id: Uuid::new_v4(),
                authority,
                input: target,
            })
            .await
    }

    async fn sync_task_row(&self, task: &Value) -> Result<(), RpcError> {
        let Some(runtime) = self.runtime() else {
            return Ok(());
        };
        let Some(parent_id) = task["parentId"].as_str() else {
            return Ok(());
        };
        runtime
            .sync_task_row(
                &RuntimeTarget {
                    kind: RuntimeTargetKind::Chat,
                    id: parent_id.to_owned(),
                },
                task.clone(),
            )
            .await
    }

    async fn ensure_wake_entries(&self) -> Result<(), RpcError> {
        let existing = self.outbox.list().await;
        let owed = existing
            .iter()
            .filter(|entry| entry["kind"] == "wake-parent")
            .filter_map(|entry| entry["payload"]["taskId"].as_str())
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        let mut failure = None;
        for task in self.store.all_tasks().await {
            let Some(task_id) = task["id"].as_str() else {
                continue;
            };
            if task["status"] == "open" || task["wake"] != "pending" || owed.contains(task_id) {
                continue;
            }
            let result = async {
                let authority = self.task_authority(&task).await?;
                self.enqueue(
                    task["projectId"].as_str().unwrap_or_default(),
                    task["parentId"].as_str().unwrap_or_default(),
                    json!({ "kind": "wake-parent", "payload": { "taskId": task_id } }),
                    &authority,
                )
                .await
                .map(|_| ())
            }
            .await;
            if let Err(error) = result {
                eprintln!("Repairing wake for task {task_id} failed: {error}");
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    async fn outbox_loop(self: Arc<Self>) {
        self.notify.notify_one();
        loop {
            if self.stopped.load(Ordering::Acquire) {
                return;
            }
            let next_due = self.schedule_due().await;
            if self.stopped.load(Ordering::Acquire) {
                return;
            }
            if let Some(next_due) = next_due {
                let delay = next_due.saturating_sub(now_ms());
                tokio::select! {
                    _ = self.cancel.cancelled() => return,
                    _ = self.notify.notified() => {},
                    _ = tokio::time::sleep(Duration::from_millis(delay)) => {},
                }
            } else {
                tokio::select! {
                    _ = self.cancel.cancelled() => return,
                    _ = self.notify.notified() => {},
                }
            }
        }
    }

    async fn schedule_due(self: &Arc<Self>) -> Option<u64> {
        if self.runtime().is_none() || self.cancel.is_cancelled() {
            return None;
        }
        let entries = self.outbox.list().await;
        let waiting = self.waits.lock().await.waiting.clone();
        let now = now_ms();
        let mut running = self.running.lock().await;
        let (selected, next_due) = due_entries(&entries, &running, &waiting, now);
        for (entry, lanes) in selected {
            if self.cancel.is_cancelled() {
                break;
            }
            for lane in &lanes {
                running.insert(lane.clone());
            }
            let coordinator = self.clone();
            self.spawn(async move { coordinator.run_entry(entry, lanes).await });
        }
        next_due
    }

    async fn run_entry(self: Arc<Self>, entry: Value, lanes: Vec<String>) {
        let id = entry["id"].as_str().unwrap_or_default().to_owned();
        let target = entry["target"].as_str().unwrap_or_default().to_owned();
        let wake_generation = self
            .waits
            .lock()
            .await
            .generations
            .get(&target)
            .copied()
            .unwrap_or(0);
        match self.handle_entry(&entry).await {
            Ok(WorkOutcome::Done) => {
                if let Err(error) = self.outbox.remove(&id).await {
                    eprintln!("Removing completed outbox entry {id} failed: {error}");
                }
            }
            Ok(WorkOutcome::Wait) => {
                let exists = self.outbox.has(&id).await;
                park_wait(&self.waits, &target, &id, wake_generation, exists).await;
            }
            Err(error) => {
                if let Err(persist_error) = self.failed_entry(&entry, &error).await {
                    eprintln!("Recording failed outbox entry {id} failed: {persist_error}");
                }
            }
        }
        let mut running = self.running.lock().await;
        for lane in lanes {
            running.remove(&lane);
        }
        drop(running);
        self.notify.notify_one();
    }

    async fn failed_entry(&self, entry: &Value, error: &RpcError) -> Result<(), RpcError> {
        let attempts = entry["attempts"].as_u64().unwrap_or(0) as usize;
        let Some(delay) = RETRY_DELAYS_MS.get(attempts) else {
            self.outbox
                .remove(entry["id"].as_str().unwrap_or_default())
                .await?;
            self.parked(entry, error).await;
            return Ok(());
        };
        let mut updated = entry.clone();
        updated["attempts"] = json!(attempts + 1);
        updated["notBefore"] = json!(now_ms() + delay);
        self.outbox.update(updated).await
    }

    async fn handle_entry(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        match entry["kind"].as_str().unwrap_or_default() {
            "start-agent" => self.start_agent(entry).await,
            "wake-parent" => self.wake_parent(entry).await,
            "end-children" => self.end_children(entry).await,
            "resume-run" => self.resume_run(entry).await,
            "deliver-summary" => self.deliver_summary(entry).await,
            kind => Err(RpcError::new(
                "outbox-invalid",
                format!("Unknown outbox work kind {kind}"),
            )),
        }
    }

    async fn start_agent(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        let target_id = entry["target"].as_str().unwrap_or_default();
        let lineage = self
            .store
            .lineage_entry(target_id)
            .await
            .ok_or_else(|| permission_error("The agent has no authoritative lineage"))?;
        let opener = lineage["openedBy"].as_str().unwrap_or_default();
        let ceiling = entry["payload"]
            .get("ceiling")
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        let authority = self
            .authority_for_node(
                entry["projectId"].as_str().unwrap_or_default(),
                opener,
                ceiling,
            )
            .await?;
        self.validate_child(&authority, target_id).await?;
        let Some(place) = self.projects.locate(target_id).await else {
            return Ok(WorkOutcome::Done);
        };
        if place["projectId"] != authority.project_id {
            return Err(permission_error(
                "The agent is no longer in the authorized project",
            ));
        }
        let payload = &entry["payload"];
        let kind = if payload["node"] == "terminal" {
            RuntimeTargetKind::Terminal
        } else {
            RuntimeTargetKind::Chat
        };
        let provider: AgentKind = serde_json::from_value(payload["provider"].clone())
            .map_err(|_| RpcError::new("outbox-invalid", "The start has an invalid provider"))?;
        let picked = payload
            .get("runtimeMode")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or(authority.identity.mode);
        let ceiling = payload
            .get("ceiling")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or(authority.mode_ceiling);
        let mode = narrower_mode(picked, ceiling);
        let operation = RuntimeOperation {
            operation_id: OutboxStore::operation_id(entry),
            authority: authority.clone(),
            input: RuntimeStart {
                target: RuntimeTarget {
                    kind,
                    id: target_id.to_owned(),
                },
                cwd: payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                provider,
                mode,
                prompt: self.store.prompts().take(target_id).await?,
                resume: payload
                    .get("resume")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                selection: payload
                    .get("selection")
                    .filter(|value| !value.is_null())
                    .cloned(),
                resume_turn_id: None,
                resume_attempt: None,
            },
        };
        let runtime = self.runtime_required()?;
        if let Err(error) = runtime.start(operation).await {
            if let Some(task) = self.store.open_for(target_id).await {
                self.settle_and_owe(
                    &task,
                    "failed",
                    json!({
                        "text": format!("The agent could not be started: {}", error.message),
                        "source": "exit",
                        "at": now_ms()
                    }),
                )
                .await?;
            }
            self.parked(entry, &error).await;
        }
        Ok(WorkOutcome::Done)
    }

    async fn wake_parent(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        let parent_id = entry["target"].as_str().unwrap_or_default();
        let authority = self
            .authority_for_node(
                entry["projectId"].as_str().unwrap_or_default(),
                parent_id,
                None,
            )
            .await?;
        if authority.project_id != entry["projectId"] || authority.identity.node_id != parent_id {
            return Err(permission_error(
                "The wake authority does not own this parent chat",
            ));
        }
        let pending = self
            .store
            .tasks_of_parent(parent_id)
            .await
            .into_iter()
            .filter(|task| task["wake"] == "pending")
            .collect::<Vec<_>>();
        if pending.is_empty() {
            return Ok(WorkOutcome::Done);
        }
        let ready = self.store.ready_wake(parent_id).await;
        if ready.is_empty() {
            return Ok(if ready.len() < pending.len() {
                WorkOutcome::Wait
            } else {
                WorkOutcome::Done
            });
        }
        let runtime = self.runtime_required()?;
        let target = RuntimeTarget {
            kind: RuntimeTargetKind::Chat,
            id: parent_id.to_owned(),
        };
        let Some(view) = runtime.read(&authority, &target).await? else {
            self.store.drop_wake(parent_id).await?;
            return Ok(WorkOutcome::Done);
        };
        let named = view
            .items
            .iter()
            .filter(|item| item["kind"] == "turn")
            .flat_map(|item| item["taskIds"].as_array().into_iter().flatten())
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>();
        let already = pending
            .iter()
            .filter_map(|task| task["id"].as_str())
            .filter(|id| named.contains(id))
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !already.is_empty() {
            self.store.mark_woken(&already).await?;
        }
        let ready = self
            .store
            .ready_wake(parent_id)
            .await
            .into_iter()
            .filter(|task| task["id"].as_str().is_none_or(|id| !named.contains(id)))
            .collect::<Vec<_>>();
        if ready.is_empty() {
            return Ok(self.held_outcome(parent_id).await);
        }
        let task_ids = ready
            .iter()
            .filter_map(|task| task["id"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        let wake = RuntimeWake {
            target,
            text: wake_prompt(&ready, self.open_batches(parent_id).await),
            label: ready
                .iter()
                .filter_map(|task| task["title"].as_str())
                .collect::<Vec<_>>()
                .join(", "),
            note: Some(format!(
                "Woken by {} finished {}",
                ready.len(),
                if ready.len() == 1 { "task" } else { "tasks" }
            )),
            task_ids: task_ids.clone(),
            summary_for: None,
        };
        match runtime
            .wake(RuntimeOperation {
                operation_id: OutboxStore::operation_id(entry),
                authority,
                input: wake,
            })
            .await
        {
            Ok(_) => self.store.mark_woken(&task_ids).await?,
            Err(error) if is_busy(&error) => return Ok(WorkOutcome::Wait),
            Err(error) => return Err(error),
        }
        Ok(self.held_outcome(parent_id).await)
    }

    async fn held_outcome(&self, parent_id: &str) -> WorkOutcome {
        let pending = self
            .store
            .tasks_of_parent(parent_id)
            .await
            .into_iter()
            .filter(|task| task["wake"] == "pending")
            .count();
        if self.store.ready_wake(parent_id).await.len() < pending {
            WorkOutcome::Wait
        } else {
            WorkOutcome::Done
        }
    }

    async fn open_batches(&self, parent_id: &str) -> usize {
        self.store
            .tasks_of_parent(parent_id)
            .await
            .iter()
            .filter(|task| task["status"] == "open")
            .filter_map(|task| task.get("batchId").and_then(Value::as_str))
            .collect::<HashSet<_>>()
            .len()
    }

    async fn end_children(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        let project_id = entry["projectId"].as_str().unwrap_or_default();
        let target = entry["target"].as_str().unwrap_or_default();
        let mut node_ids = entry["payload"]["nodeIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        node_ids.extend(self.store.descendants(target).await);
        let mut seen = HashSet::new();
        node_ids.retain(|node_id| seen.insert(node_id.clone()));
        let descendants = self
            .store
            .descendants_including_ended(target)
            .await
            .into_iter()
            .collect::<HashSet<_>>();
        node_ids.retain(|node_id| descendants.contains(node_id));
        let mut valid_node_ids = Vec::with_capacity(node_ids.len());
        for node_id in node_ids {
            if self.store.project_of(&node_id).await.as_deref() == Some(project_id) {
                valid_node_ids.push(node_id);
            }
        }
        let node_ids = valid_node_ids;
        if node_ids.is_empty() {
            return Ok(WorkOutcome::Done);
        }
        let authority = self
            .cascade_authority(project_id, target, &node_ids)
            .await?;
        self.store.mark_ended(&node_ids, now_ms()).await?;
        let ended = node_ids.iter().cloned().collect::<HashSet<_>>();
        for owed in self.outbox.list().await {
            if matches!(
                owed["kind"].as_str(),
                Some("start-agent" | "resume-run" | "wake-parent")
            ) && owed["target"]
                .as_str()
                .is_some_and(|node_id| ended.contains(node_id))
            {
                self.outbox
                    .remove(owed["id"].as_str().unwrap_or_default())
                    .await?;
            }
        }
        self.store
            .cancel_open(
                &ended,
                "the agent that opened this chat was stopped",
                now_ms(),
            )
            .await?;
        for node_id in &node_ids {
            self.store.drop_wake(node_id).await?;
        }
        let runtime = self.runtime_required()?;
        for node_id in node_ids.iter().rev() {
            let kind = self.runtime_kind(node_id).await;
            runtime
                .stop(RuntimeOperation {
                    operation_id: OutboxStore::operation_id_for(entry, node_id),
                    authority: authority.clone(),
                    input: RuntimeTarget {
                        kind,
                        id: node_id.clone(),
                    },
                })
                .await?;
        }
        Ok(WorkOutcome::Done)
    }

    async fn cascade_authority(
        &self,
        project_id: &str,
        target: &str,
        node_ids: &[String],
    ) -> Result<RuntimeAuthority, RpcError> {
        let mut candidates = vec![target.to_owned()];
        if let Some(opener) = self
            .store
            .lineage_entry(target)
            .await
            .and_then(|entry| entry["openedBy"].as_str().map(ToOwned::to_owned))
        {
            candidates.push(opener);
        }
        candidates.extend(node_ids.iter().cloned());
        for candidate in candidates {
            if let Ok(authority) = self.authority_for_node(project_id, &candidate, None).await {
                return Ok(authority);
            }
        }
        Err(RpcError::new(
            "runtime-authority-unavailable",
            format!("No runtime identity is available for the descendants of {target}"),
        ))
    }

    async fn resume_run(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        let target_id = entry["target"].as_str().unwrap_or_default();
        let authority = self
            .authority_for_node(
                entry["projectId"].as_str().unwrap_or_default(),
                target_id,
                None,
            )
            .await?;
        if authority.project_id != entry["projectId"] || authority.identity.node_id != target_id {
            return Err(permission_error(
                "The resume authority does not own this chat",
            ));
        }
        let provider = authority
            .identity
            .provider
            .ok_or_else(|| RpcError::new("runtime-unavailable", "The chat provider is unknown"))?;
        self.runtime_required()?
            .start(RuntimeOperation {
                operation_id: OutboxStore::operation_id(entry),
                authority: authority.clone(),
                input: RuntimeStart {
                    target: RuntimeTarget {
                        kind: RuntimeTargetKind::Chat,
                        id: target_id.to_owned(),
                    },
                    cwd: None,
                    provider,
                    mode: narrower_mode(authority.identity.mode, authority.mode_ceiling),
                    prompt: None,
                    resume: None,
                    selection: None,
                    resume_turn_id: entry["payload"]["turnId"].as_str().map(ToOwned::to_owned),
                    resume_attempt: entry["payload"]["attempt"]
                        .as_u64()
                        .map(|value| value as u32),
                },
            })
            .await?;
        Ok(WorkOutcome::Done)
    }

    async fn deliver_summary(&self, entry: &Value) -> Result<WorkOutcome, RpcError> {
        let authority = self
            .authority_for_node(
                entry["projectId"].as_str().unwrap_or_default(),
                entry["payload"]["forkId"].as_str().unwrap_or_default(),
                None,
            )
            .await?;
        if authority.project_id != entry["projectId"] {
            return Err(permission_error(
                "The summary authority is for another project",
            ));
        }
        let target = RuntimeTarget {
            kind: RuntimeTargetKind::Chat,
            id: entry["target"].as_str().unwrap_or_default().to_owned(),
        };
        let text = entry["payload"]["text"].as_str().unwrap_or_default();
        let runtime = self.runtime_required()?;
        runtime
            .note(RuntimeOperation {
                operation_id: OutboxStore::operation_id(entry),
                authority,
                input: RuntimeNote {
                    target,
                    note_id: format!(
                        "summary-{}",
                        entry["payload"]["turnId"].as_str().unwrap_or_default()
                    ),
                    note: text.to_owned(),
                    from: entry["payload"]["forkId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned(),
                    preamble: text.to_owned(),
                },
            })
            .await?;
        Ok(WorkOutcome::Done)
    }

    async fn parked(&self, entry: &Value, error: &RpcError) {
        if entry["kind"] == "deliver-summary" {
            return;
        }
        let chat_id = if entry["kind"] == "wake-parent" {
            entry["target"].as_str().map(ToOwned::to_owned)
        } else {
            self.store
                .made_by(entry["target"].as_str().unwrap_or_default())
                .await
        };
        let Some(chat_id) = chat_id else {
            return;
        };
        eprintln!(
            "The machine could not complete {} for {} (parent {}): {}",
            entry["kind"].as_str().unwrap_or("work"),
            entry["target"].as_str().unwrap_or_default(),
            chat_id,
            error.message
        );
    }

    async fn task_authority(&self, task: &Value) -> Result<RuntimeAuthority, RpcError> {
        self.authority_for_node(
            task["projectId"].as_str().unwrap_or_default(),
            task["parentId"].as_str().unwrap_or_default(),
            None,
        )
        .await
    }

    async fn authority_for_node(
        &self,
        project_id: &str,
        node_id: &str,
        ceiling: Option<RuntimeMode>,
    ) -> Result<RuntimeAuthority, RpcError> {
        let kind = self.runtime_kind(node_id).await;
        let target = RuntimeTarget {
            kind,
            id: node_id.to_owned(),
        };
        let runtime = self.runtime_required()?;
        let view = runtime.inspect(&target).await?.ok_or_else(|| {
            RpcError::new(
                "runtime-authority-unavailable",
                format!("No runtime identity is available for {node_id}"),
            )
        })?;
        if view.identity.node_id != node_id || view.identity.target != target {
            return Err(permission_error(
                "The runtime identity does not match its target",
            ));
        }
        let located = self.projects.locate(node_id).await;
        let lineage_project = self.store.project_of(node_id).await;
        let belongs = located
            .as_ref()
            .and_then(|place| place["projectId"].as_str())
            .is_some_and(|found| found == project_id)
            || lineage_project.as_deref() == Some(project_id);
        if !belongs {
            return Err(permission_error(
                "The runtime target belongs to another project",
            ));
        }
        let lineage = self.store.lineage_entry(node_id).await;
        let lineage_depth = lineage
            .as_ref()
            .and_then(|entry| entry["depth"].as_u64())
            .unwrap_or(0) as u32;
        let stored_ceiling = lineage
            .as_ref()
            .and_then(|entry| entry.get("modeCeiling"))
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        Ok(RuntimeAuthority {
            mode_ceiling: ceiling.or(stored_ceiling).unwrap_or(view.identity.mode),
            identity: view.identity,
            project_id: project_id.to_owned(),
            lineage_depth,
        })
    }

    async fn validate_task_authority(
        &self,
        task: &Value,
        authority: &RuntimeAuthority,
        child_id: &str,
        child_call: bool,
    ) -> Result<(), RpcError> {
        if task["projectId"] != authority.project_id {
            return Err(permission_error("The task belongs to another project"));
        }
        if child_call && authority.identity.node_id != child_id {
            return Err(permission_error(
                "Only the task child may report its result",
            ));
        }
        let parent = task["parentId"].as_str().unwrap_or_default();
        if !child_call && authority.identity.node_id != parent {
            return Err(permission_error(
                "The persisted task authority is not its parent",
            ));
        }
        let Some(lineage) = self.store.lineage_entry(child_id).await else {
            return Err(permission_error(
                "The task child has no authoritative lineage",
            ));
        };
        if lineage["projectId"] != authority.project_id || lineage["openedBy"] != parent {
            return Err(permission_error(
                "The task lineage no longer matches its parent",
            ));
        }
        Ok(())
    }

    async fn validate_child(
        &self,
        authority: &RuntimeAuthority,
        child_id: &str,
    ) -> Result<(), RpcError> {
        let Some(lineage) = self.store.lineage_entry(child_id).await else {
            return Err(permission_error("The agent has no authoritative lineage"));
        };
        if lineage["projectId"] != authority.project_id
            || lineage["openedBy"] != authority.identity.node_id
        {
            return Err(permission_error(
                "The agent was not opened by this authority",
            ));
        }
        Ok(())
    }

    async fn runtime_kind(&self, node_id: &str) -> RuntimeTargetKind {
        self.projects
            .locate(node_id)
            .await
            .and_then(|place| place["kind"].as_str().map(ToOwned::to_owned))
            .map_or(RuntimeTargetKind::Chat, |kind| {
                if kind == "terminal" {
                    RuntimeTargetKind::Terminal
                } else {
                    RuntimeTargetKind::Chat
                }
            })
    }

    async fn wake_target(&self, target: &str) {
        let entries = self.outbox.list().await;
        let ids = entries
            .iter()
            .filter(|entry| entry["target"] == target)
            .filter_map(|entry| entry["id"].as_str())
            .collect::<Vec<_>>();
        wake_wait_state(&self.waits, target, &ids).await;
        self.notify.notify_one();
    }

    fn runtime(&self) -> Option<Arc<dyn RuntimeHost>> {
        self.runtime
            .read()
            .expect("runtime host lock poisoned")
            .clone()
    }

    fn runtime_required(&self) -> Result<Arc<dyn RuntimeHost>, RpcError> {
        self.runtime().ok_or_else(|| {
            RpcError::new("runtime-unavailable", "The runtime host is not installed")
        })
    }

    fn spawn(&self, future: impl std::future::Future<Output = ()> + Send + 'static) {
        {
            let mut state = self
                .task_state
                .lock()
                .expect("workflow task state lock poisoned");
            if !state.accepting {
                return;
            }
            state.active += 1;
        }
        let state = self.task_state.clone();
        let done = self.task_done.clone();
        tokio::spawn(async move {
            let _completion = TaskCompletion { state, done };
            future.await;
        });
    }
}

fn due_entries(
    entries: &[Value],
    running: &HashSet<String>,
    waiting: &HashSet<String>,
    now: u64,
) -> (Vec<(Value, Vec<String>)>, Option<u64>) {
    let mut busy = running.clone();
    let mut selected = Vec::new();
    let mut next_due: Option<u64> = None;
    for entry in entries {
        let id = entry["id"].as_str().unwrap_or_default();
        let target = entry["target"].as_str().unwrap_or_default();
        if waiting.contains(id) || busy.contains(target) {
            continue;
        }
        let lanes = OutboxStore::lanes(entry);
        busy.insert(target.to_owned());
        if lanes.iter().skip(1).any(|lane| busy.contains(lane)) {
            continue;
        }
        let due = entry["notBefore"].as_u64().unwrap_or(0);
        if due > now {
            next_due = Some(next_due.map_or(due, |current| current.min(due)));
            continue;
        }
        for lane in lanes.iter().skip(1) {
            busy.insert(lane.clone());
        }
        selected.push((entry.clone(), lanes));
    }
    (selected, next_due)
}

async fn park_wait(
    state: &Mutex<WaitState>,
    target: &str,
    entry_id: &str,
    before: u64,
    entry_exists: bool,
) -> bool {
    let mut state = state.lock().await;
    let unchanged = state.generations.get(target).copied().unwrap_or(0) == before;
    if entry_exists && unchanged {
        state.waiting.insert(entry_id.to_owned());
        true
    } else {
        false
    }
}

async fn wake_wait_state(state: &Mutex<WaitState>, target: &str, entry_ids: &[&str]) {
    let mut state = state.lock().await;
    *state.generations.entry(target.to_owned()).or_default() += 1;
    for entry_id in entry_ids {
        state.waiting.remove(*entry_id);
    }
}

fn fact_matches_view(fact: &RuntimeFact, view: &RuntimeView) -> bool {
    if fact.version.epoch != view.version.epoch {
        return false;
    }
    match &fact.fact {
        RuntimeFactKind::Updated {
            process_generation,
            chat_seq,
        }
        | RuntimeFactKind::Settled {
            process_generation,
            chat_seq,
            ..
        } => {
            process_generation.is_none_or(|generation| {
                view.process_generation == Some(generation)
                    && view.identity.generation == generation
            }) && chat_seq
                .is_none_or(|sequence| view.chat_seq.is_some_and(|current| current >= sequence))
        }
        RuntimeFactKind::Removed => false,
    }
}

fn terminal_settled(view: &RuntimeView) -> bool {
    view.info.pointer("/agent/status").and_then(Value::as_str) == Some("exited")
        || view.info.get("exited").and_then(Value::as_bool) == Some(true)
}

impl RuntimeFactSink for WorkflowCoordinator {
    fn try_publish(&self, fact: RuntimeFact) -> Result<(), RuntimeTarget> {
        self.fact_tx
            .try_send(fact)
            .map_err(|error| error.into_inner().source)
    }

    fn mark_dirty(&self, source: RuntimeTarget) {
        self.dirty
            .lock()
            .expect("workflow dirty lock poisoned")
            .insert(source);
        self.dirty_notify.notify_one();
    }
}

fn narrower_mode(mode: RuntimeMode, ceiling: RuntimeMode) -> RuntimeMode {
    if mode_rank(mode) <= mode_rank(ceiling) {
        mode
    } else {
        ceiling
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

fn permission_error(message: &str) -> RpcError {
    RpcError::new("runtime-authority-invalid", message)
}

fn is_busy(error: &RpcError) -> bool {
    matches!(
        error.code.as_str(),
        "chat-busy" | "turn-running" | "runtime-busy" | "wake-busy"
    )
}

fn summary_source(lineage: &Value) -> Option<&str> {
    if lineage.get("relation").and_then(Value::as_str) == Some("fork") {
        lineage.get("openedBy").and_then(Value::as_str)
    } else {
        None
    }
}

fn wake_prompt(tasks: &[Value], teams_out: usize) -> String {
    let head = if tasks.len() == 1 {
        "A task you gave has settled. Its result:".to_owned()
    } else {
        format!(
            "{} tasks you gave have settled. Their results:",
            tasks.len()
        )
    };
    let mut sections = tasks
        .iter()
        .map(|task| {
            let (text, cut) = cut_utf8(
                task["result"]["text"].as_str().unwrap_or_default(),
                RESULT_PREVIEW_BYTES,
            );
            let mut lines = vec![
                format!(
                    "## {} (node {}, task {}): {}",
                    task["title"].as_str().unwrap_or_default(),
                    task["childId"].as_str().unwrap_or_default(),
                    task["id"].as_str().unwrap_or_default(),
                    task["status"].as_str().unwrap_or_default()
                ),
                String::new(),
                if text.is_empty() {
                    "(no result text)".to_owned()
                } else {
                    text
                },
            ];
            if cut {
                lines.extend([
                    String::new(),
                    format!(
                        "[The result was cut at {} KiB. ruimte-context read {} shows the rest once a line runs from that node into you; ruimte-context link new --to {} draws it.]",
                        RESULT_PREVIEW_BYTES / 1024,
                        task["childId"].as_str().unwrap_or_default(),
                        task["childId"].as_str().unwrap_or_default()
                    ),
                ]);
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>();
    if tasks.iter().any(|task| task.get("batchId").is_some()) {
        sections.push(
            "The tasks of one team call come in together, once every one of them has settled."
                .to_owned(),
        );
    }
    if teams_out > 0 {
        sections.push(if teams_out == 1 {
            "A team you gave is still out: you are woken with all of a team's results once its last task settles."
                .to_owned()
        } else {
            format!(
                "{teams_out} teams you gave are still out: you are woken with all of a team's results once its last task settles."
            )
        });
    }
    std::iter::once(head)
        .chain(sections)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn cut_utf8(text: &str, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text.to_owned(), false);
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_reconciliation_only_reads_fork_threads() {
        assert_eq!(
            summary_source(&json!({ "relation": "fork", "openedBy": "source" })),
            Some("source")
        );
        assert_eq!(
            summary_source(&json!({ "relation": "task", "openedBy": "source" })),
            None
        );
        assert_eq!(summary_source(&json!({ "openedBy": "person" })), None);
    }

    #[test]
    fn wake_prompt_matches_task_batch_and_keeps_utf8_whole() {
        let long = format!("{}é", "a".repeat(RESULT_PREVIEW_BYTES - 1));
        let tasks = vec![json!({
            "id": "task-1",
            "childId": "child",
            "title": "Compile",
            "status": "done",
            "batchId": "batch",
            "result": { "text": long }
        })];
        let prompt = wake_prompt(&tasks, 1);
        assert!(prompt.contains("## Compile (node child, task task-1): done"));
        assert!(prompt.contains("cut at 8 KiB"));
        assert!(prompt.contains("A team you gave is still out"));
        assert!(!prompt.contains('\u{fffd}'));
    }

    fn entry(id: &str, target: &str, kind: &str, due: u64, children: &[&str]) -> Value {
        json!({
            "id": id,
            "projectId": "project",
            "target": target,
            "createdAt": 0,
            "attempts": 0,
            "notBefore": due,
            "kind": kind,
            "payload": if kind == "end-children" {
                json!({ "nodeIds": children })
            } else {
                json!({ "node": "chat", "provider": "codex", "cwd": null })
            }
        })
    }

    fn ids(selected: &[(Value, Vec<String>)]) -> Vec<&str> {
        selected
            .iter()
            .filter_map(|(entry, _)| entry["id"].as_str())
            .collect()
    }

    #[test]
    fn due_work_is_oldest_first_per_lane_and_parallel_between_targets() {
        let entries = vec![
            entry("first-a", "a", "start-agent", 0, &[]),
            entry("second-a", "a", "start-agent", 0, &[]),
            entry("first-b", "b", "start-agent", 0, &[]),
        ];
        let (selected, next) = due_entries(&entries, &HashSet::new(), &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["first-a", "first-b"]);
        assert_eq!(next, None);
    }

    #[test]
    fn retry_delay_blocks_younger_work_on_the_same_target() {
        let entries = vec![
            entry("retry", "a", "start-agent", 20, &[]),
            entry("younger", "a", "start-agent", 0, &[]),
            entry("beside", "b", "start-agent", 0, &[]),
        ];
        let (selected, next) = due_entries(&entries, &HashSet::new(), &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["beside"]);
        assert_eq!(next, Some(20));
    }

    #[test]
    fn waiting_work_holds_no_lane() {
        let entries = vec![
            entry("waiting", "a", "wake-parent", 0, &[]),
            entry("resume", "a", "resume-run", 0, &[]),
        ];
        let waiting = HashSet::from(["waiting".to_owned()]);
        let (selected, _) = due_entries(&entries, &HashSet::new(), &waiting, 10);
        assert_eq!(ids(&selected), ["resume"]);
    }

    #[test]
    fn end_children_reserves_every_child_lane() {
        let entries = vec![
            entry("end", "parent", "end-children", 0, &["a", "b"]),
            entry("start-a", "a", "start-agent", 0, &[]),
            entry("start-c", "c", "start-agent", 0, &[]),
        ];
        let (selected, _) = due_entries(&entries, &HashSet::new(), &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["end", "start-c"]);
    }

    #[test]
    fn running_child_holds_an_end_children_cascade() {
        let entries = vec![
            entry("end", "parent", "end-children", 0, &["a", "b"]),
            entry("other", "c", "start-agent", 0, &[]),
        ];
        let running = HashSet::from(["a".to_owned()]);
        let (selected, _) = due_entries(&entries, &running, &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["other"]);
    }

    #[test]
    fn overlapping_cascades_reserve_children_atomically() {
        let entries = vec![
            entry("first", "parent-a", "end-children", 0, &["shared", "a"]),
            entry("second", "parent-b", "end-children", 0, &["shared", "b"]),
            entry("start-b", "b", "start-agent", 0, &[]),
            entry("unrelated", "c", "start-agent", 0, &[]),
        ];
        let (selected, _) = due_entries(&entries, &HashSet::new(), &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["first", "start-b", "unrelated"]);
    }

    #[test]
    fn delayed_work_blocks_its_target_but_does_not_reserve_child_lanes() {
        let entries = vec![
            entry("delayed", "parent", "end-children", 20, &["child"]),
            entry("younger", "parent", "start-agent", 0, &[]),
            entry("child", "child", "start-agent", 0, &[]),
        ];
        let (selected, next) = due_entries(&entries, &HashSet::new(), &HashSet::new(), 10);
        assert_eq!(ids(&selected), ["child"]);
        assert_eq!(next, Some(20));
    }

    #[tokio::test]
    async fn wake_while_handler_decides_to_wait_is_not_lost() {
        let state = Arc::new(Mutex::new(WaitState {
            waiting: HashSet::new(),
            generations: HashMap::from([("parent".to_owned(), 4)]),
        }));
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let waking_state = state.clone();
        let waking_barrier = barrier.clone();
        let waking = tokio::spawn(async move {
            waking_barrier.wait().await;
            wake_wait_state(&waking_state, "parent", &["wake-entry"]).await;
        });
        barrier.wait().await;
        waking.await.unwrap();
        assert!(!park_wait(&state, "parent", "wake-entry", 4, true).await);
        assert!(!state.lock().await.waiting.contains("wake-entry"));

        assert!(park_wait(&state, "parent", "still-waiting", 5, true).await);
        wake_wait_state(&state, "parent", &["still-waiting"]).await;
        assert!(!state.lock().await.waiting.contains("still-waiting"));
    }

    #[tokio::test]
    async fn panicking_worker_releases_shutdown_count() {
        let state = Arc::new(StdMutex::new(TaskState {
            accepting: false,
            active: 1,
        }));
        let done = Arc::new(Notify::new());
        let worker_state = state.clone();
        let worker_done = done.clone();
        let worker = tokio::spawn(async move {
            let _completion = TaskCompletion {
                state: worker_state,
                done: worker_done,
            };
            panic!("worker panic fixture");
        });
        assert!(worker.await.is_err());
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let notified = done.notified();
                if state.lock().unwrap().active == 0 {
                    break;
                }
                notified.await;
            }
        })
        .await
        .unwrap();
    }
}
