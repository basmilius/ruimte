use std::{collections::HashMap, io::ErrorKind, path::PathBuf, sync::Arc};

use serde_json::{Value, json};
use tokio::{fs, sync::Mutex};

use crate::rpc::RpcError;

use super::util::{encode_component, io_error, now_ms, write_atomic};

const MAX_NOTICES: usize = 10;
const MAX_NOTICE_LENGTH: usize = 500;
const NOTICE_MAX_AGE_MS: u64 = 6 * 60 * 60 * 1000;

#[derive(Clone)]
pub(crate) struct NoticeStore {
    inner: Arc<NoticeInner>,
}

struct NoticeInner {
    directory: PathBuf,
    queues: Mutex<HashMap<String, Vec<Value>>>,
    target_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
}

impl NoticeStore {
    pub async fn load(home: PathBuf) -> Result<Self, RpcError> {
        Self::with_clock(home, Arc::new(now_ms)).await
    }

    async fn with_clock(
        home: PathBuf,
        clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Result<Self, RpcError> {
        let directory = home.join("notices");
        let queues = load_queues(&directory, clock()).await?;
        Ok(Self {
            inner: Arc::new(NoticeInner {
                directory,
                queues: Mutex::new(queues),
                target_locks: Mutex::new(HashMap::new()),
                clock,
            }),
        })
    }

    pub async fn put(&self, mut notice: Value) -> Result<usize, RpcError> {
        validate_notice(&notice, false)?;
        let target_id = notice["targetId"].as_str().unwrap().to_owned();
        let lock = self.target_lock(&target_id).await;
        let _guard = lock.lock().await;
        notice
            .as_object_mut()
            .unwrap()
            .insert("createdAt".to_owned(), json!((self.inner.clock)()));
        let mut queue = self.fresh_queue(&target_id).await;
        queue.push(notice);
        if queue.len() > MAX_NOTICES {
            queue.drain(..queue.len() - MAX_NOTICES);
        }
        self.persist(&target_id, &queue).await?;
        self.inner
            .queues
            .lock()
            .await
            .insert(target_id, queue.clone());
        Ok(queue.len())
    }

    pub async fn take(&self, target_id: &str) -> Result<Vec<Value>, RpcError> {
        let lock = self.target_lock(target_id).await;
        let _guard = lock.lock().await;
        let queue = self.fresh_queue(target_id).await;
        if queue.is_empty() {
            return Ok(Vec::new());
        }
        self.persist(target_id, &[]).await?;
        self.inner.queues.lock().await.remove(target_id);
        Ok(queue)
    }

    #[cfg(test)]
    pub async fn waiting(&self, target_id: &str) -> Vec<Value> {
        self.fresh_queue(target_id).await
    }

    pub async fn prune(
        &self,
        project_id: &str,
        existing_ids: &std::collections::HashSet<String>,
    ) -> Result<(), RpcError> {
        let targets = self
            .inner
            .queues
            .lock()
            .await
            .iter()
            .filter(|(target, queue)| {
                queue
                    .first()
                    .is_some_and(|notice| notice["projectId"] == project_id)
                    && !existing_ids.contains(*target)
            })
            .map(|(target, _)| target.clone())
            .collect::<Vec<_>>();
        for target in targets {
            let lock = self.target_lock(&target).await;
            let _guard = lock.lock().await;
            self.persist(&target, &[]).await?;
            self.inner.queues.lock().await.remove(&target);
        }
        Ok(())
    }

    pub(crate) fn render(notice: &Value) -> String {
        let from = notice["from"].as_str().unwrap_or_default();
        let title = notice["fromTitle"].as_str().unwrap_or_default();
        let label = if title.is_empty() {
            String::new()
        } else {
            format!(" (\"{title}\")")
        };
        format!(
            "Ruimte: node {from}{label} sent you a message: {}",
            notice["text"].as_str().unwrap_or_default()
        )
    }

    async fn fresh_queue(&self, target_id: &str) -> Vec<Value> {
        let now = (self.inner.clock)();
        self.inner
            .queues
            .lock()
            .await
            .get(target_id)
            .into_iter()
            .flatten()
            .filter(|notice| {
                now.saturating_sub(notice["createdAt"].as_u64().unwrap_or(0)) < NOTICE_MAX_AGE_MS
            })
            .cloned()
            .collect()
    }

    async fn persist(&self, target_id: &str, queue: &[Value]) -> Result<(), RpcError> {
        let path = self.path(target_id);
        if queue.is_empty() {
            match fs::remove_file(path).await {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(io_error(error)),
            }
        }
        let bytes = serde_json::to_vec(&json!({ "notices": queue }))
            .map_err(|error| RpcError::new("internal-error", error.to_string()))?;
        write_atomic(&path, &bytes).await.map_err(io_error)
    }

    async fn target_lock(&self, target_id: &str) -> Arc<Mutex<()>> {
        self.inner
            .target_locks
            .lock()
            .await
            .entry(target_id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn path(&self, target_id: &str) -> PathBuf {
        self.inner
            .directory
            .join(format!("{}.json", encode_component(target_id)))
    }
}

async fn load_queues(
    directory: &PathBuf,
    now: u64,
) -> Result<HashMap<String, Vec<Value>>, RpcError> {
    let mut queues = HashMap::new();
    let mut files = match fs::read_dir(directory).await {
        Ok(files) => files,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(queues),
        Err(error) => return Err(io_error(error)),
    };
    while let Some(file) = files.next_entry().await.map_err(io_error)? {
        if file.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(file.path()).await else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let Some(notices) = value["notices"].as_array() else {
            continue;
        };
        let fresh = notices
            .iter()
            .filter(|notice| validate_notice(notice, true).is_ok())
            .filter(|notice| {
                now.saturating_sub(notice["createdAt"].as_u64().unwrap_or(0)) < NOTICE_MAX_AGE_MS
            })
            .cloned()
            .collect::<Vec<_>>();
        if let Some(target_id) = fresh.first().and_then(|notice| notice["targetId"].as_str()) {
            queues.insert(target_id.to_owned(), fresh);
        } else {
            let _ = fs::remove_file(file.path()).await;
        }
    }
    Ok(queues)
}

fn validate_notice(notice: &Value, stored: bool) -> Result<(), RpcError> {
    let object = notice
        .as_object()
        .ok_or_else(|| RpcError::new("notice-invalid", "A notice must be an object"))?;
    for field in ["projectId", "targetId", "from"] {
        if object
            .get(field)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(RpcError::new(
                "notice-invalid",
                format!("A notice needs {field}"),
            ));
        }
    }
    if object.get("fromTitle").and_then(Value::as_str).is_none() {
        return Err(RpcError::new("notice-invalid", "A notice needs fromTitle"));
    }
    let text = object
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| RpcError::new("notice-invalid", "A notice needs text"))?;
    if text.chars().count() > MAX_NOTICE_LENGTH {
        return Err(RpcError::new(
            "notice-invalid",
            format!("A notice holds at most {MAX_NOTICE_LENGTH} characters"),
        ));
    }
    if stored && object.get("createdAt").and_then(Value::as_u64).is_none() {
        return Err(RpcError::new(
            "notice-invalid",
            "A stored notice needs createdAt",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn notice(target: &str, text: &str) -> Value {
        json!({
            "projectId": "project",
            "targetId": target,
            "from": "sender",
            "fromTitle": "Sender",
            "text": text
        })
    }

    #[tokio::test]
    async fn bounds_expires_and_delivers_notices_once_across_restart() {
        let temporary = TempDir::new().unwrap();
        let home = temporary.path().to_path_buf();
        let clock = Arc::new(|| 10_000);
        let store = NoticeStore::with_clock(home.clone(), clock).await.unwrap();
        for index in 0..12 {
            store
                .put(notice("receiver", &format!("message {index}")))
                .await
                .unwrap();
        }
        assert_eq!(store.waiting("receiver").await.len(), 10);
        drop(store);

        let restarted = NoticeStore::with_clock(home, Arc::new(|| 10_001))
            .await
            .unwrap();
        let delivered = restarted.take("receiver").await.unwrap();
        assert_eq!(delivered.len(), 10);
        assert_eq!(delivered[0]["text"], "message 2");
        assert!(NoticeStore::render(&delivered[0]).contains("Sender"));
        assert!(restarted.take("receiver").await.unwrap().is_empty());
    }
}
