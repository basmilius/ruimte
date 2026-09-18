use std::{collections::HashMap, io::ErrorKind, path::PathBuf, sync::Arc};

use serde_json::{Value, json};
use tokio::{fs, sync::Mutex};

use crate::rpc::RpcError;

use super::util::{encode_component, io_error, now_ms, write_atomic};

#[derive(Clone)]
pub(crate) struct PromptStore {
    inner: Arc<PromptInner>,
}

struct PromptInner {
    directory: PathBuf,
    pending: Mutex<HashMap<String, Value>>,
}

impl PromptStore {
    pub(crate) async fn load(home: PathBuf) -> Result<Self, RpcError> {
        let directory = home.join("prompts");
        let mut pending = HashMap::new();
        let mut files = match fs::read_dir(&directory).await {
            Ok(files) => Some(files),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(io_error(error)),
        };
        while let Some(file) = match files.as_mut() {
            Some(files) => files.next_entry().await.map_err(io_error)?,
            None => None,
        } {
            let Ok(bytes) = fs::read(file.path()).await else {
                continue;
            };
            let Ok(entry) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            if valid(&entry)
                && let Some(node_id) = entry["nodeId"].as_str()
            {
                pending.insert(node_id.to_owned(), entry);
            }
        }
        Ok(Self {
            inner: Arc::new(PromptInner {
                directory,
                pending: Mutex::new(pending),
            }),
        })
    }

    pub(crate) async fn put(
        &self,
        project_id: &str,
        node_id: &str,
        prompt: &str,
    ) -> Result<(), RpcError> {
        let entry = json!({
            "projectId": project_id,
            "nodeId": node_id,
            "prompt": prompt,
            "createdAt": now_ms()
        });
        fs::create_dir_all(&self.inner.directory)
            .await
            .map_err(io_error)?;
        #[cfg(unix)]
        fs::set_permissions(
            &self.inner.directory,
            <std::fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o700),
        )
        .await
        .map_err(io_error)?;
        write_atomic(&self.path(node_id), &serde_json::to_vec(&entry).unwrap())
            .await
            .map_err(io_error)?;
        self.inner
            .pending
            .lock()
            .await
            .insert(node_id.to_owned(), entry);
        Ok(())
    }

    pub(crate) async fn take(&self, node_id: &str) -> Result<Option<String>, RpcError> {
        let entry = self.inner.pending.lock().await.remove(node_id);
        let Some(entry) = entry else {
            return Ok(None);
        };
        match fs::remove_file(self.path(node_id)).await {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        Ok(entry["prompt"].as_str().map(ToOwned::to_owned))
    }

    pub(crate) async fn remove(&self, node_id: &str) -> Result<(), RpcError> {
        self.inner.pending.lock().await.remove(node_id);
        match fs::remove_file(self.path(node_id)).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error(error)),
        }
    }

    fn path(&self, node_id: &str) -> PathBuf {
        self.inner
            .directory
            .join(format!("{}.json", encode_component(node_id)))
    }
}

fn valid(entry: &Value) -> bool {
    entry["projectId"]
        .as_str()
        .is_some_and(|value| !value.is_empty())
        && entry["nodeId"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
        && entry["prompt"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
        && entry["createdAt"].as_u64().is_some()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn prompt_is_compatible_and_consumed_once_across_restart() {
        let temporary = TempDir::new().unwrap();
        let first = PromptStore::load(temporary.path().to_path_buf())
            .await
            .unwrap();
        first.put("project", "node/%", "Do it").await.unwrap();
        drop(first);
        let second = PromptStore::load(temporary.path().to_path_buf())
            .await
            .unwrap();
        assert_eq!(
            second.take("node/%").await.unwrap().as_deref(),
            Some("Do it")
        );
        assert_eq!(second.take("node/%").await.unwrap(), None);
    }
}
