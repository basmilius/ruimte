use std::{
    collections::HashMap,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
};

use percent_encoding::percent_decode_str;
use serde_json::{Value, json};
use time::OffsetDateTime;
use tokio::{fs, sync::Mutex};

use crate::{
    events::EventBus,
    rpc::{RpcError, RpcResult},
};

use super::{
    plans::{apply_plan_ops, create_plan, random_item_id, validate_plan},
    util::{encode_component, io_error, now_ms, string_field, write_atomic},
};

#[cfg(test)]
use super::plans::plan_progress;

const PLAN_SUFFIX: &str = ".plans.json";

#[derive(Clone)]
pub(crate) struct PlanStore {
    inner: Arc<PlanStoreInner>,
}

struct PlanStoreInner {
    directory: PathBuf,
    events: EventBus,
    chat_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl PlanStore {
    pub fn new(home: &Path, events: EventBus) -> Self {
        Self::with_clock(home, events, Arc::new(now_ms))
    }

    fn with_clock(
        home: &Path,
        events: EventBus,
        clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self {
            inner: Arc::new(PlanStoreInner {
                directory: home.join("chats"),
                events,
                chat_locks: Mutex::new(HashMap::new()),
                clock,
            }),
        }
    }

    pub async fn dispatch(&self, method: &str, payload: Value) -> Option<RpcResult> {
        Some(match method {
            "plan.list" => self.list_request(payload).await,
            "plan.apply" => self.apply_request(payload).await,
            _ => return None,
        })
    }

    pub async fn read(&self, chat_id: &str) -> Result<Vec<Value>, RpcError> {
        let lock = self.chat_lock(chat_id).await;
        let _guard = lock.lock().await;
        self.read_file(chat_id).await
    }

    pub async fn list(&self, chat_ids: Option<&[Value]>) -> Result<Vec<Value>, RpcError> {
        let ids = if let Some(chat_ids) = chat_ids {
            chat_ids
                .iter()
                .map(|id| {
                    id.as_str()
                        .map(ToOwned::to_owned)
                        .ok_or_else(|| RpcError::new("bad-request", "chatIds must be strings."))
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            self.chats_with_plans().await?
        };
        let mut result = Vec::new();
        for chat_id in ids {
            match self.read(&chat_id).await {
                Ok(plans) => result.extend(
                    plans
                        .into_iter()
                        .map(|plan| json!({ "chatId": chat_id, "plan": plan })),
                ),
                Err(error) => {
                    eprintln!("The plans of chat {chat_id} could not be read: {error}");
                }
            }
        }
        Ok(result)
    }

    pub async fn create(
        &self,
        chat_id: &str,
        draft: &Value,
        meta: Option<&Value>,
        dry_run: bool,
    ) -> Result<Value, RpcError> {
        let lock = self.chat_lock(chat_id).await;
        let _guard = lock.lock().await;
        let plans = self.read_file(chat_id).await?;
        if plans.len() >= 20 {
            return Err(RpcError::new(
                "too-many-plans",
                "This chat already keeps 20 plans, which is all a chat may keep; delete one first",
            ));
        }
        let mut id = format!("plan-{}", &random_item_id()[..4]);
        while plans.iter().any(|plan| plan["id"] == id) {
            id = format!("plan-{}", random_item_id());
        }
        let created = create_plan(draft, &id, &self.iso_now(), meta)
            .map_err(|error| RpcError::new(error.code, error.message))?;
        if dry_run {
            return Ok(created);
        }
        let plan = created["plan"].clone();
        let mut next = plans;
        next.push(plan.clone());
        self.write_file(chat_id, &next).await?;
        self.inner
            .events
            .broadcast("plan.changed", json!({ "chatId": chat_id, "plan": plan }));
        self.inner
            .events
            .broadcast("plan.created", json!({ "chatId": chat_id, "planId": id }));
        Ok(created)
    }

    pub async fn apply(
        &self,
        chat_id: &str,
        plan_id: Option<&str>,
        ops: &[Value],
        actor: &str,
    ) -> Result<Value, RpcError> {
        let lock = self.chat_lock(chat_id).await;
        let _guard = lock.lock().await;
        let mut plans = self.read_file(chat_id).await?;
        let index = match plan_id {
            Some(plan_id) => plans.iter().position(|plan| plan["id"] == plan_id),
            None => plans.len().checked_sub(1),
        }
        .ok_or_else(|| missing_plan(plan_id))?;
        let applied = apply_plan_ops(&plans[index], ops, actor, &self.iso_now())
            .map_err(|error| RpcError::new(error.code, error.message))?;
        let plan = applied["plan"].clone();
        plans[index] = plan.clone();
        self.write_file(chat_id, &plans).await?;
        self.inner
            .events
            .broadcast("plan.changed", json!({ "chatId": chat_id, "plan": plan }));
        Ok(applied)
    }

    pub async fn delete(&self, chat_id: &str, plan_id: &str) -> Result<Value, RpcError> {
        let lock = self.chat_lock(chat_id).await;
        let _guard = lock.lock().await;
        let mut plans = self.read_file(chat_id).await?;
        let index = plans
            .iter()
            .position(|plan| plan["id"] == plan_id)
            .ok_or_else(|| missing_plan(Some(plan_id)))?;
        let plan = plans.remove(index);
        self.write_file(chat_id, &plans).await?;
        self.inner.events.broadcast(
            "plan.removed",
            json!({ "chatId": chat_id, "planId": plan_id }),
        );
        Ok(json!({ "ok": true, "plan": plan }))
    }

    pub async fn remove_chat(&self, chat_id: &str) -> Result<(), RpcError> {
        let lock = self.chat_lock(chat_id).await;
        let _guard = lock.lock().await;
        let plans = self.read_file(chat_id).await.unwrap_or_default();
        match fs::remove_file(self.path(chat_id)).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        for plan in plans {
            if let Some(plan_id) = plan["id"].as_str() {
                self.inner.events.broadcast(
                    "plan.removed",
                    json!({ "chatId": chat_id, "planId": plan_id }),
                );
            }
        }
        Ok(())
    }

    pub async fn copy_chat(&self, from_chat_id: &str, to_chat_id: &str) -> Result<(), RpcError> {
        let plans = self.read(from_chat_id).await?;
        if plans.is_empty() {
            return Ok(());
        }
        let lock = self.chat_lock(to_chat_id).await;
        let _guard = lock.lock().await;
        self.write_file(to_chat_id, &plans).await?;
        for plan in plans {
            self.inner.events.broadcast(
                "plan.changed",
                json!({ "chatId": to_chat_id, "plan": plan }),
            );
        }
        Ok(())
    }

    #[cfg(test)]
    pub async fn has_open_steps(&self, chat_id: &str) -> Result<bool, RpcError> {
        Ok(self.read(chat_id).await?.iter().any(|plan| {
            let progress = plan_progress(&plan["items"]);
            progress["finished"].as_u64() < progress["total"].as_u64()
        }))
    }

    async fn list_request(&self, payload: Value) -> RpcResult {
        let ids = payload
            .get("chatIds")
            .and_then(Value::as_array)
            .map(Vec::as_slice);
        Ok(json!({ "plans": self.list(ids).await? }))
    }

    async fn apply_request(&self, payload: Value) -> RpcResult {
        let chat_id = string_field(&payload, "chatId")?;
        let plan_id = string_field(&payload, "planId")?;
        let ops = payload
            .get("ops")
            .and_then(Value::as_array)
            .ok_or_else(|| RpcError::new("bad-request", "ops must be an array."))?;
        let applied = self.apply(&chat_id, Some(&plan_id), ops, "person").await?;
        Ok(json!({ "plan": applied["plan"] }))
    }

    async fn chat_lock(&self, chat_id: &str) -> Arc<Mutex<()>> {
        self.inner
            .chat_locks
            .lock()
            .await
            .entry(chat_id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn chats_with_plans(&self) -> Result<Vec<String>, RpcError> {
        let mut entries = match fs::read_dir(&self.inner.directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io_error(error)),
        };
        let mut ids = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(encoded) = name.strip_suffix(PLAN_SUFFIX) else {
                continue;
            };
            if let Ok(decoded) = percent_decode_str(encoded).decode_utf8() {
                ids.push(decoded.into_owned());
            }
        }
        ids.sort();
        Ok(ids)
    }

    async fn read_file(&self, chat_id: &str) -> Result<Vec<Value>, RpcError> {
        let bytes = match fs::read(self.path(chat_id)).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io_error(error)),
        };
        let value: Value = serde_json::from_slice(&bytes).map_err(|error| {
            RpcError::new(
                "plan-invalid",
                format!("The plans file of chat {chat_id} is not valid: {error}"),
            )
        })?;
        if value["version"] != 1 {
            return Err(RpcError::new(
                "plan-invalid",
                format!("The plans file of chat {chat_id} is not valid: unknown version"),
            ));
        }
        let plans = value["plans"].as_array().ok_or_else(|| {
            RpcError::new(
                "plan-invalid",
                format!("The plans file of chat {chat_id} is not valid: plans is not an array"),
            )
        })?;
        for plan in plans {
            validate_plan(plan).map_err(|error| {
                RpcError::new(
                    "plan-invalid",
                    format!(
                        "The plans file of chat {chat_id} is not valid: {}",
                        error.message
                    ),
                )
            })?;
        }
        Ok(plans.clone())
    }

    async fn write_file(&self, chat_id: &str, plans: &[Value]) -> Result<(), RpcError> {
        let path = self.path(chat_id);
        if plans.is_empty() {
            match fs::remove_file(path).await {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(io_error(error)),
            }
        }
        let bytes = serde_json::to_vec(&json!({ "version": 1, "plans": plans }))
            .map_err(|error| RpcError::new("internal-error", error.to_string()))?;
        write_atomic(&path, &bytes).await.map_err(io_error)
    }

    fn path(&self, chat_id: &str) -> PathBuf {
        self.inner
            .directory
            .join(format!("{}{PLAN_SUFFIX}", encode_component(chat_id)))
    }

    fn iso_now(&self) -> String {
        iso_timestamp((self.inner.clock)())
    }
}

fn missing_plan(plan_id: Option<&str>) -> RpcError {
    match plan_id {
        Some(plan_id) => {
            RpcError::new("plan-not-found", format!("This chat has no plan {plan_id}"))
        }
        None => RpcError::new("plan-not-found", "This chat has no plan yet"),
    }
}

fn iso_timestamp(milliseconds: u64) -> String {
    let timestamp = OffsetDateTime::from_unix_timestamp_nanos(i128::from(milliseconds) * 1_000_000)
        .unwrap_or(OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        timestamp.year(),
        timestamp.month() as u8,
        timestamp.day(),
        timestamp.hour(),
        timestamp.minute(),
        timestamp.second(),
        timestamp.millisecond()
    )
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn draft() -> Value {
        json!({
            "meta": { "title": "Ship", "checks": "anyone" },
            "items": [
                { "type": "step", "id": "build", "title": "Build" },
                { "type": "step", "id": "check", "title": "Check", "checks": "person" }
            ]
        })
    }

    #[tokio::test]
    async fn persists_serial_person_and_agent_changes_and_refuses_invalid_disk_state() {
        let temporary = TempDir::new().unwrap();
        let clock = Arc::new(|| 1_789_560_000_000);
        let store = PlanStore::with_clock(temporary.path(), EventBus::default(), clock);
        let created = store.create("chat/a", &draft(), None, false).await.unwrap();
        let plan_id = created["plan"]["id"].as_str().unwrap().to_owned();
        let person_ops = [json!({ "op": "set", "ids": ["check"], "state": "done" })];
        let agent_ops = [json!({ "op": "set", "ids": ["build"], "state": "active" })];
        let person = store.apply("chat/a", Some(&plan_id), &person_ops, "person");
        let agent = store.apply("chat/a", Some(&plan_id), &agent_ops, "agent");
        let (person, agent) = tokio::join!(person, agent);
        person.unwrap();
        agent.unwrap();
        let stored = store.read("chat/a").await.unwrap();
        assert_eq!(stored[0]["rev"], 2);
        assert_eq!(stored[0]["createdAt"], "2026-09-16T12:00:00.000Z");
        assert_eq!(stored[0]["items"][0]["state"], "active");
        assert_eq!(stored[0]["items"][1]["by"], "person");

        fs::write(store.path("broken"), b"{\"version\":1,\"plans\":[{}]}")
            .await
            .unwrap();
        let error = store.read("broken").await.unwrap_err();
        assert_eq!(error.code, "plan-invalid");
    }

    #[tokio::test]
    async fn dry_run_and_copy_keep_source_isolated() {
        let temporary = TempDir::new().unwrap();
        let store = PlanStore::with_clock(
            temporary.path(),
            EventBus::default(),
            Arc::new(|| 1_789_560_000_000),
        );
        store.create("source", &draft(), None, true).await.unwrap();
        assert!(store.read("source").await.unwrap().is_empty());
        let created = store.create("source", &draft(), None, false).await.unwrap();
        store.copy_chat("source", "fork").await.unwrap();
        let id = created["plan"]["id"].as_str().unwrap();
        store
            .apply(
                "fork",
                Some(id),
                &[json!({ "op": "set", "ids": ["build"], "state": "done" })],
                "agent",
            )
            .await
            .unwrap();
        assert_eq!(store.read("source").await.unwrap()[0]["rev"], 0);
        assert_eq!(store.read("fork").await.unwrap()[0]["rev"], 1);
        assert!(store.has_open_steps("fork").await.unwrap());
    }
}
