use std::{collections::HashMap, io::ErrorKind, path::PathBuf, sync::Arc};

use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

use crate::rpc::RpcError;

use super::util::{encode_component, io_error, write_atomic};

#[derive(Clone)]
pub(crate) struct OutboxStore {
    inner: Arc<OutboxInner>,
}

struct OutboxInner {
    directory: PathBuf,
    entries: Mutex<HashMap<String, Value>>,
    entry_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl OutboxStore {
    pub async fn load(home: PathBuf) -> Result<Self, RpcError> {
        let directory = home.join("outbox");
        let entries = load_entries(&directory).await?;
        Ok(Self {
            inner: Arc::new(OutboxInner {
                directory,
                entries: Mutex::new(entries),
                entry_locks: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub async fn put(
        &self,
        project_id: &str,
        target: &str,
        work: Value,
        _authority: Option<Value>,
        now: u64,
    ) -> Result<Value, RpcError> {
        validate_work(&work)?;
        let kind = work["kind"].as_str().unwrap();
        let id = format!("{kind}-{}", random_hex(6));
        let entry = json!({
            "id": id,
            "projectId": project_id,
            "target": target,
            "createdAt": now,
            "attempts": 0,
            "notBefore": now,
            "kind": kind,
            "payload": work["payload"]
        });
        self.persist(&entry).await?;
        self.inner.entries.lock().await.insert(id, entry.clone());
        Ok(entry)
    }

    pub async fn update(&self, entry: Value) -> Result<(), RpcError> {
        validate_entry(&entry)?;
        let id = entry["id"].as_str().unwrap().to_owned();
        let lock = self.entry_lock(&id).await;
        let _guard = lock.lock().await;
        if !self.inner.entries.lock().await.contains_key(&id) {
            return Ok(());
        }
        self.persist(&entry).await?;
        self.inner.entries.lock().await.insert(id, entry);
        Ok(())
    }

    pub async fn remove(&self, id: &str) -> Result<(), RpcError> {
        let lock = self.entry_lock(id).await;
        let _guard = lock.lock().await;
        let path = self.path(id);
        match fs::remove_file(path).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        self.inner.entries.lock().await.remove(id);
        Ok(())
    }

    pub async fn list(&self) -> Vec<Value> {
        let mut entries = self
            .inner
            .entries
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry["createdAt"].as_u64().unwrap_or(0));
        entries
    }

    pub async fn has(&self, id: &str) -> bool {
        self.inner.entries.lock().await.contains_key(id)
    }

    pub async fn prune(
        &self,
        project_id: &str,
        existing_ids: &std::collections::HashSet<String>,
    ) -> Result<(), RpcError> {
        let entries = self.list().await;
        for entry in entries {
            if entry["projectId"] == project_id
                && entry["kind"] != "end-children"
                && !existing_ids.contains(entry["target"].as_str().unwrap_or_default())
            {
                self.remove(entry["id"].as_str().unwrap()).await?;
            }
        }
        Ok(())
    }

    pub(crate) fn operation_id(entry: &Value) -> Uuid {
        operation_uuid(entry["id"].as_str().unwrap_or_default())
    }

    pub(crate) fn operation_id_for(entry: &Value, part: &str) -> Uuid {
        operation_uuid(&format!(
            "{}:{part}",
            entry["id"].as_str().unwrap_or_default()
        ))
    }

    pub(crate) fn lanes(entry: &Value) -> Vec<String> {
        let mut lanes = vec![entry["target"].as_str().unwrap_or_default().to_owned()];
        if entry["kind"] == "end-children" {
            lanes.extend(
                entry["payload"]["nodeIds"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned),
            );
        }
        lanes
    }

    async fn persist(&self, entry: &Value) -> Result<(), RpcError> {
        let bytes = serde_json::to_vec(entry)
            .map_err(|error| RpcError::new("internal-error", error.to_string()))?;
        write_atomic(&self.path(entry["id"].as_str().unwrap()), &bytes)
            .await
            .map_err(io_error)
    }

    async fn entry_lock(&self, id: &str) -> Arc<Mutex<()>> {
        self.inner
            .entry_locks
            .lock()
            .await
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn path(&self, id: &str) -> PathBuf {
        self.inner
            .directory
            .join(format!("{}.json", encode_component(id)))
    }
}

fn operation_uuid(id: &str) -> Uuid {
    const NAMESPACE: [u8; 16] = [
        0x79, 0x64, 0x5b, 0x9a, 0x21, 0x8b, 0x5e, 0x86, 0xb7, 0x5b, 0x39, 0xdf, 0x4d, 0xca, 0x7d,
        0x55,
    ];
    let mut digest = Sha1::new();
    digest.update(NAMESPACE);
    digest.update(id.as_bytes());
    let digest = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

async fn load_entries(directory: &PathBuf) -> Result<HashMap<String, Value>, RpcError> {
    let mut entries = HashMap::new();
    let mut files = match fs::read_dir(directory).await {
        Ok(files) => files,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(io_error(error)),
    };
    while let Some(file) = files.next_entry().await.map_err(io_error)? {
        if file.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(file.path()).await else {
            continue;
        };
        let Ok(entry) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        if validate_entry(&entry).is_ok() {
            entries.insert(entry["id"].as_str().unwrap().to_owned(), entry);
        }
    }
    Ok(entries)
}

fn validate_entry(entry: &Value) -> Result<(), RpcError> {
    let object = entry
        .as_object()
        .ok_or_else(|| RpcError::new("outbox-invalid", "An outbox entry must be an object"))?;
    for field in ["id", "projectId", "target", "kind"] {
        if object
            .get(field)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(RpcError::new(
                "outbox-invalid",
                format!("An outbox entry needs {field}"),
            ));
        }
    }
    for field in ["createdAt", "attempts", "notBefore"] {
        if object.get(field).and_then(Value::as_u64).is_none() {
            return Err(RpcError::new(
                "outbox-invalid",
                format!("An outbox entry needs {field}"),
            ));
        }
    }
    validate_work(entry)
}

fn validate_work(work: &Value) -> Result<(), RpcError> {
    let kind = work["kind"]
        .as_str()
        .ok_or_else(|| RpcError::new("outbox-invalid", "Outbox work needs a kind"))?;
    if !matches!(
        kind,
        "start-agent" | "resume-run" | "wake-parent" | "end-children" | "deliver-summary"
    ) {
        return Err(RpcError::new(
            "outbox-invalid",
            format!("Unknown outbox work kind {kind}"),
        ));
    }
    if !work["payload"].is_object() {
        return Err(RpcError::new(
            "outbox-invalid",
            "Outbox work needs a payload",
        ));
    }
    Ok(())
}

fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut value = vec![0_u8; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn operation_id_and_updates_survive_restart_without_private_schema_fields() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let store = OutboxStore::load(home.clone()).await.unwrap();
        let entry = store
            .put(
                "project",
                "child",
                json!({ "kind": "start-agent", "payload": { "node": "chat", "provider": "codex", "cwd": null } }),
                Some(json!({ "identity": { "nodeId": "parent" }, "lineageDepth": 1, "modeCeiling": "auto" })),
                10,
            )
            .await
            .unwrap();
        let operation_id = OutboxStore::operation_id(&entry);
        assert!(entry.get("authority").is_none());
        let mut updated = entry.clone();
        updated["attempts"] = json!(1);
        updated["notBefore"] = json!(20);
        store.update(updated.clone()).await.unwrap();
        drop(store);

        let restarted = OutboxStore::load(home).await.unwrap();
        assert_eq!(restarted.list().await, [updated.clone()]);
        assert_eq!(OutboxStore::operation_id(&updated), operation_id);
        assert_eq!(OutboxStore::lanes(&updated), ["child"]);
        restarted
            .remove(updated["id"].as_str().unwrap())
            .await
            .unwrap();
        assert!(restarted.list().await.is_empty());
    }

    #[tokio::test]
    async fn loads_every_typescript_outbox_shape_without_rust_only_fields() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let directory = home.join("outbox");
        fs::create_dir_all(&directory).await.unwrap();
        let shapes = [
            json!({ "kind": "start-agent", "payload": { "node": "chat", "provider": "codex", "cwd": null, "runtimeMode": "auto", "ceiling": "full-access" } }),
            json!({ "kind": "resume-run", "payload": { "turnId": "turn-1", "attempt": 2 } }),
            json!({ "kind": "wake-parent", "payload": { "taskId": "task-1" } }),
            json!({ "kind": "end-children", "payload": { "nodeIds": ["child", "grandchild"] } }),
            json!({ "kind": "deliver-summary", "payload": { "forkId": "fork", "turnId": "turn-2", "text": "Summary" } }),
        ];
        for (index, shape) in shapes.into_iter().enumerate() {
            let id = format!("{}-fixture", shape["kind"].as_str().unwrap());
            let entry = json!({
                "id": id,
                "projectId": "project",
                "target": if index == 3 { "deleted-parent" } else { "chat" },
                "createdAt": index as u64,
                "attempts": 0,
                "notBefore": 0,
                "kind": shape["kind"],
                "payload": shape["payload"]
            });
            fs::write(
                directory.join(format!("{}.json", encode_component(&id))),
                serde_json::to_vec(&entry).unwrap(),
            )
            .await
            .unwrap();
        }

        let store = OutboxStore::load(home).await.unwrap();
        let entries = store.list().await;
        assert_eq!(entries.len(), 5);
        assert_eq!(
            entries
                .iter()
                .filter_map(|entry| entry["kind"].as_str())
                .collect::<HashSet<_>>(),
            HashSet::from([
                "start-agent",
                "resume-run",
                "wake-parent",
                "end-children",
                "deliver-summary"
            ])
        );
        assert!(entries.iter().all(|entry| entry.get("authority").is_none()));
        let end = entries
            .iter()
            .find(|entry| entry["kind"] == "end-children")
            .unwrap();
        assert_eq!(
            OutboxStore::lanes(end),
            ["deleted-parent", "child", "grandchild"]
        );
    }
}
