#![allow(clippy::too_many_arguments)]

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::{Map, Value, json};
use tokio::{fs, sync::Mutex};

use crate::{
    events::EventBus,
    rpc::{RpcError, RpcResult},
    runtime::{RuntimeAuthority, RuntimeIdentity, RuntimeMode},
};

use super::{
    notice_store::NoticeStore,
    outbox_store::OutboxStore,
    plan_store::PlanStore,
    prompt_store::PromptStore,
    util::{encode_component, io_error, now_ms, string_field, write_atomic},
};

#[derive(Clone)]
pub(crate) struct WorkflowStore {
    inner: Arc<WorkflowInner>,
}

struct WorkflowInner {
    home: PathBuf,
    events: EventBus,
    notices: NoticeStore,
    outbox: OutboxStore,
    plans: PlanStore,
    prompts: PromptStore,
    lineage: Mutex<HashMap<String, Value>>,
    tasks: Mutex<HashMap<String, Value>>,
    lineage_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    task_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl WorkflowStore {
    pub async fn new(home: PathBuf, events: EventBus) -> Result<Self, RpcError> {
        let lineage = load_objects(&home.join("lineage"), valid_lineage).await?;
        let tasks = load_objects(&home.join("tasks"), valid_task).await?;
        let notices = NoticeStore::load(home.clone()).await?;
        let outbox = OutboxStore::load(home.clone()).await?;
        let prompts = PromptStore::load(home.clone()).await?;
        Ok(Self {
            inner: Arc::new(WorkflowInner {
                notices,
                outbox,
                plans: PlanStore::new(&home, events.clone()),
                prompts,
                home,
                events,
                lineage: Mutex::new(lineage),
                tasks: Mutex::new(tasks),
                lineage_locks: Mutex::new(HashMap::new()),
                task_locks: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub async fn dispatch(&self, method: &str, payload: Value) -> Option<RpcResult> {
        if let Some(result) = self.inner.plans.dispatch(method, payload.clone()).await {
            return Some(result);
        }
        Some(match method {
            "task.list" => self.task_list(payload).await,
            "agent.children" => self.agent_children(payload).await,
            _ => return None,
        })
    }

    pub(crate) fn plans(&self) -> &PlanStore {
        &self.inner.plans
    }

    pub(crate) fn prompts(&self) -> &PromptStore {
        &self.inner.prompts
    }

    pub(crate) fn notices(&self) -> &NoticeStore {
        &self.inner.notices
    }

    pub(crate) fn outbox(&self) -> &OutboxStore {
        &self.inner.outbox
    }

    pub async fn record_lineage(
        &self,
        project_id: &str,
        node_id: &str,
        opened_by: &str,
        depth: u64,
        agent: bool,
        relation: Option<&str>,
    ) -> Result<(), RpcError> {
        let mut entry = json!({
            "projectId": project_id,
            "nodeId": node_id,
            "openedBy": opened_by,
            "depth": depth,
            "agent": agent,
            "createdAt": now_ms()
        });
        if let Some(relation) = relation {
            entry
                .as_object_mut()
                .unwrap()
                .insert("relation".to_owned(), json!(relation));
        }
        self.write_lineage(entry).await
    }

    pub async fn record_lineage_with_ceiling(
        &self,
        project_id: &str,
        node_id: &str,
        opened_by: &str,
        depth: u64,
        agent: bool,
        relation: Option<&str>,
        mode_ceiling: RuntimeMode,
    ) -> Result<(), RpcError> {
        let mut entry = json!({
            "projectId": project_id,
            "nodeId": node_id,
            "openedBy": opened_by,
            "depth": depth,
            "agent": agent,
            "createdAt": now_ms(),
            "modeCeiling": mode_ceiling
        });
        if let Some(relation) = relation {
            entry
                .as_object_mut()
                .unwrap()
                .insert("relation".to_owned(), json!(relation));
        }
        self.write_lineage(entry).await
    }

    pub async fn authority(
        &self,
        identity: RuntimeIdentity,
        project_id: String,
    ) -> RuntimeAuthority {
        let lineage = self.inner.lineage.lock().await;
        let entry = lineage.get(&identity.node_id);
        RuntimeAuthority {
            lineage_depth: entry.and_then(|entry| entry["depth"].as_u64()).unwrap_or(0) as u32,
            mode_ceiling: entry
                .and_then(|entry| entry.get("modeCeiling"))
                .and_then(|mode| serde_json::from_value(mode.clone()).ok())
                .unwrap_or(identity.mode),
            identity,
            project_id,
        }
    }

    pub async fn depth_of(&self, node_id: &str) -> u64 {
        self.inner
            .lineage
            .lock()
            .await
            .get(node_id)
            .and_then(|entry| entry["depth"].as_u64())
            .unwrap_or(0)
    }

    pub async fn opened_count(&self, caller_id: &str) -> usize {
        self.inner
            .lineage
            .lock()
            .await
            .values()
            .filter(|entry| {
                entry["openedBy"] == caller_id
                    && entry["agent"].as_bool().unwrap_or(true)
                    && entry.get("relation").and_then(Value::as_str) != Some("fork")
            })
            .count()
    }

    pub async fn made_by(&self, node_id: &str) -> Option<String> {
        let lineage = self.inner.lineage.lock().await;
        let entry = lineage.get(node_id)?;
        if entry.get("relation").and_then(Value::as_str) == Some("fork") {
            None
        } else {
            entry["openedBy"].as_str().map(ToOwned::to_owned)
        }
    }

    pub async fn lineage_entry(&self, node_id: &str) -> Option<Value> {
        self.inner.lineage.lock().await.get(node_id).cloned()
    }

    pub async fn orphan_openers(
        &self,
        project_id: &str,
        existing_ids: &HashSet<String>,
    ) -> Vec<String> {
        let lineage = self.inner.lineage.lock().await;
        let mut openers = lineage
            .values()
            .filter(|entry| {
                entry["projectId"] == project_id
                    && entry["agent"].as_bool().unwrap_or(true)
                    && entry.get("endedAt").is_none()
                    && entry["nodeId"]
                        .as_str()
                        .is_some_and(|node_id| existing_ids.contains(node_id))
                    && entry["openedBy"]
                        .as_str()
                        .is_some_and(|opened_by| !existing_ids.contains(opened_by))
            })
            .filter_map(|entry| entry["openedBy"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        openers.sort();
        openers.dedup();
        openers
    }

    pub async fn prune_project(
        &self,
        project_id: &str,
        existing_ids: &HashSet<String>,
    ) -> Result<(Vec<String>, Vec<Value>), RpcError> {
        let leaving = self
            .inner
            .lineage
            .lock()
            .await
            .values()
            .filter(|entry| {
                entry["projectId"] == project_id
                    && entry["nodeId"]
                        .as_str()
                        .is_some_and(|node_id| !existing_ids.contains(node_id))
            })
            .cloned()
            .collect::<Vec<_>>();
        let forks = leaving
            .iter()
            .filter(|entry| entry["relation"] == "fork")
            .filter_map(|entry| entry["nodeId"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        for entry in leaving {
            if let Some(node_id) = entry["nodeId"].as_str() {
                self.inner.prompts.remove(node_id).await?;
                self.remove_lineage(node_id).await?;
            }
        }
        self.inner.notices.prune(project_id, existing_ids).await?;
        self.inner.outbox.prune(project_id, existing_ids).await?;
        let cancelled = self.prune_tasks(project_id, existing_ids, now_ms()).await?;
        Ok((forks, cancelled))
    }

    pub async fn project_of(&self, node_id: &str) -> Option<String> {
        self.inner
            .lineage
            .lock()
            .await
            .get(node_id)
            .and_then(|entry| entry["projectId"].as_str())
            .map(ToOwned::to_owned)
    }

    pub async fn remove_lineage(&self, node_id: &str) -> Result<(), RpcError> {
        let lock = self.lineage_lock(node_id).await;
        let _guard = lock.lock().await;
        let path = self
            .inner
            .home
            .join("lineage")
            .join(format!("{}.json", encode_component(node_id)));
        match fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        self.inner.lineage.lock().await.remove(node_id);
        Ok(())
    }

    pub async fn mark_ended(&self, node_ids: &[String], at: u64) -> Result<(), RpcError> {
        for node_id in node_ids {
            let lock = self.lineage_lock(node_id).await;
            let _guard = lock.lock().await;
            let entry = {
                let lineage = self.inner.lineage.lock().await;
                let Some(current) = lineage.get(node_id) else {
                    continue;
                };
                if current.get("endedAt").is_some() {
                    continue;
                }
                let mut entry = current.clone();
                entry
                    .as_object_mut()
                    .unwrap()
                    .insert("endedAt".to_owned(), json!(at));
                entry
            };
            persist_object(&self.inner.home.join("lineage"), node_id, &entry).await?;
            self.inner
                .lineage
                .lock()
                .await
                .insert(node_id.clone(), entry);
        }
        Ok(())
    }

    #[cfg(test)]
    pub async fn open_task(
        &self,
        project_id: &str,
        parent_id: &str,
        child_id: &str,
        title: &str,
        prompt: &str,
        batch_id: Option<&str>,
    ) -> Result<Value, RpcError> {
        let mut task = json!({
            "id": format!("task-{}", random_hex(6)),
            "projectId": project_id,
            "parentId": parent_id,
            "childId": child_id,
            "title": title,
            "prompt": prompt,
            "status": "open",
            "result": null,
            "createdAt": now_ms(),
            "settledAt": null,
            "wake": "pending"
        });
        if let Some(batch_id) = batch_id {
            task.as_object_mut()
                .unwrap()
                .insert("batchId".to_owned(), json!(batch_id));
        }
        self.write_task(task.clone()).await?;
        Ok(task)
    }

    pub async fn open_task_authorized(
        &self,
        project_id: &str,
        parent_id: &str,
        child_id: &str,
        title: &str,
        prompt: &str,
        batch_id: Option<&str>,
        _authority: &RuntimeAuthority,
    ) -> Result<Value, RpcError> {
        let mut task = json!({
            "id": format!("task-{}", random_hex(6)),
            "projectId": project_id,
            "parentId": parent_id,
            "childId": child_id,
            "title": title,
            "prompt": prompt,
            "status": "open",
            "result": null,
            "createdAt": now_ms(),
            "settledAt": null,
            "wake": "pending"
        });
        if let Some(batch_id) = batch_id {
            task.as_object_mut()
                .unwrap()
                .insert("batchId".to_owned(), json!(batch_id));
        }
        self.write_task(task.clone()).await?;
        Ok(task)
    }

    pub async fn settle_task(
        &self,
        task_id: &str,
        status: &str,
        result: Option<Value>,
        at: u64,
    ) -> Result<Option<Value>, RpcError> {
        let lock = self.task_lock(task_id).await;
        let _guard = lock.lock().await;
        let task = {
            let tasks = self.inner.tasks.lock().await;
            let Some(current) = tasks.get(task_id) else {
                return Ok(None);
            };
            if current["status"] != "open" {
                return Ok(None);
            }
            let mut task = current.clone();
            let object = task.as_object_mut().unwrap();
            object.insert("status".to_owned(), json!(status));
            object.insert("result".to_owned(), result.unwrap_or(Value::Null));
            object.insert("settledAt".to_owned(), json!(at));
            if status == "cancelled" {
                object.insert("wake".to_owned(), json!("none"));
            }
            task
        };
        self.persist_task(&task).await?;
        self.inner
            .tasks
            .lock()
            .await
            .insert(task_id.to_owned(), task.clone());
        self.broadcast_task(&task);
        Ok(Some(task))
    }

    pub async fn involving(&self, node_id: &str) -> Vec<Value> {
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .filter(|task| task["parentId"] == node_id || task["childId"] == node_id)
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| task["createdAt"].as_u64().unwrap_or(0));
        tasks
    }

    pub async fn all_tasks(&self) -> Vec<Value> {
        self.inner.tasks.lock().await.values().cloned().collect()
    }

    pub async fn open_for(&self, child_id: &str) -> Option<Value> {
        self.inner
            .tasks
            .lock()
            .await
            .values()
            .find(|task| task["childId"] == child_id && task["status"] == "open")
            .cloned()
    }

    pub async fn cancel_open(
        &self,
        child_ids: &HashSet<String>,
        reason: &str,
        at: u64,
    ) -> Result<Vec<Value>, RpcError> {
        let ids = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .filter(|task| {
                task["status"] == "open"
                    && task["childId"]
                        .as_str()
                        .is_some_and(|child| child_ids.contains(child))
            })
            .filter_map(|task| task["id"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        let mut cancelled = Vec::new();
        for id in ids {
            if let Some(task) = self
                .settle_task(
                    &id,
                    "cancelled",
                    Some(json!({ "text": reason, "source": "exit", "at": at })),
                    at,
                )
                .await?
            {
                cancelled.push(task);
            }
        }
        Ok(cancelled)
    }

    pub async fn ready_wake(&self, parent_id: &str) -> Vec<Value> {
        let tasks = self.tasks_of_parent(parent_id).await;
        let open_batches = tasks
            .iter()
            .filter(|task| task["status"] == "open")
            .filter_map(|task| task.get("batchId").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        tasks
            .into_iter()
            .filter(|task| task["status"] != "open" && task["wake"] == "pending")
            .filter(|task| {
                task.get("batchId")
                    .and_then(Value::as_str)
                    .is_none_or(|batch| !open_batches.contains(batch))
            })
            .collect()
    }

    pub async fn mark_woken(&self, ids: &[String]) -> Result<(), RpcError> {
        for id in ids {
            let lock = self.task_lock(id).await;
            let _guard = lock.lock().await;
            let task = {
                let tasks = self.inner.tasks.lock().await;
                let Some(current) = tasks.get(id) else {
                    continue;
                };
                if current["wake"] != "pending" {
                    continue;
                }
                let mut task = current.clone();
                task.as_object_mut()
                    .unwrap()
                    .insert("wake".to_owned(), json!("sent"));
                task
            };
            self.persist_task(&task).await?;
            self.inner
                .tasks
                .lock()
                .await
                .insert(id.clone(), task.clone());
            self.broadcast_task(&task);
        }
        Ok(())
    }

    pub async fn drop_wake(&self, parent_id: &str) -> Result<(), RpcError> {
        let ids = self
            .tasks_of_parent(parent_id)
            .await
            .into_iter()
            .filter(|task| task["wake"] == "pending")
            .filter_map(|task| task["id"].as_str().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        for id in ids {
            let lock = self.task_lock(&id).await;
            let _guard = lock.lock().await;
            let task = {
                let tasks = self.inner.tasks.lock().await;
                let Some(current) = tasks.get(&id) else {
                    continue;
                };
                if current["wake"] != "pending" {
                    continue;
                }
                let mut task = current.clone();
                task.as_object_mut()
                    .unwrap()
                    .insert("wake".to_owned(), json!("none"));
                task
            };
            self.persist_task(&task).await?;
            self.inner.tasks.lock().await.insert(id, task.clone());
            self.broadcast_task(&task);
        }
        Ok(())
    }

    pub async fn prune_tasks(
        &self,
        project_id: &str,
        existing_ids: &HashSet<String>,
        at: u64,
    ) -> Result<Vec<Value>, RpcError> {
        let candidates = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .filter(|task| task["projectId"] == project_id)
            .cloned()
            .collect::<Vec<_>>();
        let mut cancelled = Vec::new();
        for task in candidates {
            let id = task["id"].as_str().unwrap().to_owned();
            let parent_exists = task["parentId"]
                .as_str()
                .is_some_and(|parent| existing_ids.contains(parent));
            if !parent_exists {
                let lock = self.task_lock(&id).await;
                let _guard = lock.lock().await;
                match fs::remove_file(
                    self.inner
                        .home
                        .join("tasks")
                        .join(format!("{}.json", encode_component(&id))),
                )
                .await
                {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(io_error(error)),
                }
                self.inner.tasks.lock().await.remove(&id);
                continue;
            }
            let child_exists = task["childId"]
                .as_str()
                .is_some_and(|child| existing_ids.contains(child));
            if !child_exists
                && task["status"] == "open"
                && let Some(task) = self.settle_task(&id, "cancelled", None, at).await?
            {
                cancelled.push(task);
            }
        }
        Ok(cancelled)
    }

    async fn task_list(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .filter(|task| task["projectId"] == project_id)
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| task["createdAt"].as_u64().unwrap_or(0));
        Ok(json!({ "tasks": tasks }))
    }

    async fn agent_children(&self, payload: Value) -> RpcResult {
        let node_id = string_field(&payload, "nodeId")?;
        Ok(json!({ "nodeIds": self.descendants(&node_id).await }))
    }

    pub async fn descendants(&self, node_id: &str) -> Vec<String> {
        self.descendants_with_ended(node_id, false).await
    }

    pub async fn descendants_including_ended(&self, node_id: &str) -> Vec<String> {
        self.descendants_with_ended(node_id, true).await
    }

    async fn descendants_with_ended(&self, node_id: &str, include_ended: bool) -> Vec<String> {
        let lineage = self.inner.lineage.lock().await;
        let mut found = Vec::<String>::new();
        let mut seen = HashSet::from([node_id.to_owned()]);
        let mut cursor = 0;
        loop {
            let parent = if cursor == 0 {
                node_id.to_owned()
            } else if let Some(parent) = found.get(cursor - 1) {
                parent.clone()
            } else {
                break;
            };
            for entry in lineage.values() {
                let child = entry["nodeId"].as_str().unwrap_or_default();
                if entry["openedBy"] == parent
                    && entry["agent"].as_bool().unwrap_or(true)
                    && entry.get("relation").and_then(Value::as_str) != Some("fork")
                    && (include_ended || entry.get("endedAt").is_none())
                    && seen.insert(child.to_owned())
                {
                    found.push(child.to_owned());
                }
            }
            cursor += 1;
        }
        found
    }

    pub async fn tasks_of_parent(&self, parent_id: &str) -> Vec<Value> {
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .await
            .values()
            .filter(|task| task["parentId"] == parent_id)
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| task["createdAt"].as_u64().unwrap_or(0));
        tasks
    }

    async fn write_lineage(&self, entry: Value) -> Result<(), RpcError> {
        let node_id = entry["nodeId"].as_str().unwrap().to_owned();
        let lock = self.lineage_lock(&node_id).await;
        let _guard = lock.lock().await;
        persist_object(&self.inner.home.join("lineage"), &node_id, &entry).await?;
        self.inner.lineage.lock().await.insert(node_id, entry);
        Ok(())
    }

    async fn write_task(&self, task: Value) -> Result<(), RpcError> {
        let id = task["id"].as_str().unwrap().to_owned();
        let lock = self.task_lock(&id).await;
        let _guard = lock.lock().await;
        self.persist_task(&task).await?;
        self.inner.tasks.lock().await.insert(id, task.clone());
        self.broadcast_task(&task);
        Ok(())
    }

    async fn persist_task(&self, task: &Value) -> Result<(), RpcError> {
        let id = task["id"].as_str().unwrap();
        persist_object(&self.inner.home.join("tasks"), id, task).await
    }

    fn broadcast_task(&self, task: &Value) {
        self.inner
            .events
            .broadcast("task.changed", json!({ "task": task }));
    }

    async fn task_lock(&self, id: &str) -> Arc<Mutex<()>> {
        entity_lock(&self.inner.task_locks, id).await
    }

    async fn lineage_lock(&self, id: &str) -> Arc<Mutex<()>> {
        entity_lock(&self.inner.lineage_locks, id).await
    }
}

async fn entity_lock(locks: &Mutex<HashMap<String, Arc<Mutex<()>>>>, id: &str) -> Arc<Mutex<()>> {
    locks
        .lock()
        .await
        .entry(id.to_owned())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

async fn load_objects(
    directory: &Path,
    valid: fn(&Map<String, Value>) -> bool,
) -> Result<HashMap<String, Value>, RpcError> {
    let mut result = HashMap::new();
    let mut entries = match fs::read_dir(directory).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(io_error(error)),
    };
    while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()).await else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let Some(object) = value.as_object().filter(|object| valid(object)) else {
            continue;
        };
        result.insert(
            object
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| object.get("nodeId").and_then(Value::as_str))
                .unwrap()
                .to_owned(),
            value,
        );
    }
    Ok(result)
}

async fn persist_object(directory: &Path, id: &str, value: &Value) -> Result<(), RpcError> {
    fs::create_dir_all(directory).await.map_err(io_error)?;
    let bytes = serde_json::to_vec(value)
        .map_err(|error| RpcError::new("internal-error", error.to_string()))?;
    write_atomic(
        &directory.join(format!("{}.json", encode_component(id))),
        &bytes,
    )
    .await
    .map_err(io_error)
}

fn valid_lineage(value: &Map<String, Value>) -> bool {
    value.get("projectId").and_then(Value::as_str).is_some()
        && value.get("nodeId").and_then(Value::as_str).is_some()
        && value.get("openedBy").and_then(Value::as_str).is_some()
        && value.get("depth").and_then(Value::as_u64).is_some()
}

fn valid_task(value: &Map<String, Value>) -> bool {
    value.get("id").and_then(Value::as_str).is_some()
        && value.get("projectId").and_then(Value::as_str).is_some()
        && value.get("parentId").and_then(Value::as_str).is_some()
        && value.get("childId").and_then(Value::as_str).is_some()
        && matches!(
            value.get("status").and_then(Value::as_str),
            Some("open" | "done" | "failed" | "cancelled")
        )
}

fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut value = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn lineage_and_tasks_survive_restart_and_keep_batch_wakes_atomic() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let events = EventBus::default();
        let store = WorkflowStore::new(home.clone(), events.clone())
            .await
            .unwrap();
        store
            .record_lineage("project", "child", "parent", 1, true, None)
            .await
            .unwrap();
        store
            .record_lineage("project", "grandchild", "child", 2, true, None)
            .await
            .unwrap();
        assert_eq!(store.descendants("parent").await, ["child", "grandchild"]);
        let first = store
            .open_task("project", "parent", "child", "One", "Do one", Some("batch"))
            .await
            .unwrap();
        let second = store
            .open_task(
                "project",
                "parent",
                "grandchild",
                "Two",
                "Do two",
                Some("batch"),
            )
            .await
            .unwrap();
        store
            .settle_task(
                first["id"].as_str().unwrap(),
                "done",
                Some(json!({ "text": "done", "source": "done", "at": 1 })),
                1,
            )
            .await
            .unwrap();
        assert!(store.ready_wake("parent").await.is_empty());
        store
            .settle_task(
                second["id"].as_str().unwrap(),
                "failed",
                Some(json!({ "text": "failed", "source": "exit", "at": 2 })),
                2,
            )
            .await
            .unwrap();
        assert_eq!(store.ready_wake("parent").await.len(), 2);
        drop(store);

        let restarted = WorkflowStore::new(home, events).await.unwrap();
        assert_eq!(restarted.depth_of("grandchild").await, 2);
        assert_eq!(restarted.ready_wake("parent").await.len(), 2);
    }

    #[tokio::test]
    async fn task_mutations_persist_in_order_before_memory_changes() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let store = WorkflowStore::new(home.clone(), EventBus::default())
            .await
            .unwrap();
        let task = store
            .open_task("project", "parent", "child", "Work", "Do it", None)
            .await
            .unwrap();
        let id = task["id"].as_str().unwrap().to_owned();
        let settle = store.settle_task(
            &id,
            "done",
            Some(json!({ "text": "done", "source": "done", "at": 1 })),
            1,
        );
        let ids = [id.clone()];
        let wake = store.mark_woken(&ids);
        let (settled, woken) = tokio::join!(settle, wake);
        settled.unwrap();
        woken.unwrap();
        drop(store);

        let restarted = WorkflowStore::new(home, EventBus::default()).await.unwrap();
        let persisted = restarted.involving("parent").await;
        assert_eq!(persisted[0]["status"], "done");
        assert_eq!(persisted[0]["wake"], "sent");
    }

    #[tokio::test]
    async fn failed_task_write_does_not_publish_memory_state() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let store = WorkflowStore::new(home.clone(), EventBus::default())
            .await
            .unwrap();
        fs::write(home.join("tasks"), b"blocks the task directory")
            .await
            .unwrap();
        assert!(
            store
                .open_task("project", "parent", "child", "Work", "Do it", None)
                .await
                .is_err()
        );
        assert!(store.involving("parent").await.is_empty());
        fs::remove_file(home.join("tasks")).await.unwrap();
        assert!(
            store
                .open_task("project", "parent", "child", "Work", "Do it", None)
                .await
                .is_ok()
        );
    }
}
