use std::path::{Path, PathBuf};

use serde_json::Value;
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

pub struct AgentStore {
    directory: PathBuf,
}

impl AgentStore {
    pub fn new(home: &Path) -> Self {
        Self {
            directory: home.join("sessions"),
        }
    }

    pub async fn read(&self, session_id: &str) -> anyhow::Result<Option<Value>> {
        match fs::read(self.path(session_id)).await {
            Ok(raw) => Ok(serde_json::from_slice(&raw).ok().filter(valid_agent)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn write(&self, session_id: &str, agent: &Value) -> anyhow::Result<()> {
        fs::create_dir_all(&self.directory).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, std::fs::Permissions::from_mode(0o700)).await?;
        }
        let target = self.path(session_id);
        let temporary = target.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
        let result = async {
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary).await?;
            file.write_all(&serde_json::to_vec(agent)?).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary, &target).await?;
            anyhow::Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&temporary).await;
        }
        result
    }

    pub async fn delete(&self, session_id: &str) -> anyhow::Result<()> {
        match fs::remove_file(self.path(session_id)).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn path(&self, session_id: &str) -> PathBuf {
        self.directory
            .join(format!("{}.agent.json", encode_component(session_id)))
    }
}

fn valid_agent(agent: &Value) -> bool {
    matches!(
        agent.get("kind").and_then(Value::as_str),
        Some("claude" | "codex" | "gemini" | "copilot")
    ) && agent.get("agentSessionId").is_some_and(Value::is_string)
        && agent.get("status").is_some_and(Value::is_string)
        && agent.get("live").is_some_and(Value::is_boolean)
}

fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("writing to a string cannot fail");
        }
    }
    encoded
}
