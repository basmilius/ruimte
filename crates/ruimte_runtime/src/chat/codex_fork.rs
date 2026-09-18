use std::{collections::HashMap, io, path::Path, process::Stdio, time::Duration};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

use super::framing::read_bounded_line;
use crate::rpc::RpcError;

const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

pub enum CutPoint<'a> {
    Turn(&'a str),
    Turns(usize),
    Whole,
}

pub async fn fork_thread(
    command: &[String],
    cwd: &Path,
    environment: &HashMap<String, String>,
    thread_id: &str,
    at: CutPoint<'_>,
    options: Value,
) -> Result<String, RpcError> {
    let work = async {
        let mut server = AppServer::spawn(command, cwd, environment)?;
        server
            .request(
                1,
                "initialize",
                json!({
                    "clientInfo": { "name": "ruimte", "title": "Ruimte", "version": crate::VERSION },
                    "capabilities": { "experimentalApi": true, "requestAttestation": false },
                }),
            )
            .await?;
        server.notify("initialized", json!({})).await?;
        let last_turn_id = match at {
            CutPoint::Turn(turn_id) => Some(turn_id.to_owned()),
            CutPoint::Whole => None,
            CutPoint::Turns(turns) => {
                Some(server.nth_turn(thread_id, turns).await?.ok_or_else(|| {
                    RpcError::new(
                        "turn-not-found",
                        "Codex keeps fewer turns than the chat shows",
                    )
                })?)
            }
        };
        let mut params = options.as_object().cloned().unwrap_or_default();
        params.insert("threadId".into(), json!(thread_id));
        params.insert("excludeTurns".into(), json!(true));
        if let Some(last_turn_id) = last_turn_id {
            params.insert("lastTurnId".into(), json!(last_turn_id));
        }
        let result = server
            .request(10_000, "thread/fork", Value::Object(params))
            .await?;
        server.stop().await;
        result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| RpcError::new("fork-failed", "Codex answered the fork without a thread"))
    };
    tokio::time::timeout(Duration::from_secs(30), work)
        .await
        .map_err(|_| RpcError::new("fork-failed", "Codex did not answer the fork"))?
}

pub async fn request_once(
    command: &[String],
    cwd: &Path,
    environment: &HashMap<String, String>,
    method: &str,
    params: Value,
) -> Result<Value, RpcError> {
    let work = async {
        let mut server = AppServer::spawn(command, cwd, environment)?;
        server
            .request(
                1,
                "initialize",
                json!({
                    "clientInfo": { "name": "ruimte", "title": "Ruimte", "version": crate::VERSION },
                    "capabilities": { "experimentalApi": true, "requestAttestation": false },
                }),
            )
            .await?;
        server.notify("initialized", json!({})).await?;
        let result = server.request(2, method, params).await;
        server.stop().await;
        result
    };
    tokio::time::timeout(Duration::from_secs(30), work)
        .await
        .map_err(|_| RpcError::new("chat-process", "Codex did not answer the request"))?
}

struct AppServer {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl AppServer {
    fn spawn(
        command: &[String],
        cwd: &Path,
        environment: &HashMap<String, String>,
    ) -> Result<Self, RpcError> {
        let (program, arguments) = command
            .split_first()
            .ok_or_else(|| RpcError::new("fork-failed", "The Codex command is empty"))?;
        let mut builder = Command::new(program);
        builder
            .args(arguments)
            .current_dir(cwd)
            .envs(environment)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        for key in [
            "RUIMTE_HOOK_URL",
            "RUIMTE_HOOK_TOKEN",
            "RUIMTE_CONTEXT_URL",
            "RUIMTE_CONTEXT_TOKEN",
            "RUIMTE_SESSION_ID",
        ] {
            builder.env_remove(key);
        }
        #[cfg(unix)]
        unsafe {
            builder.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(io::Error::last_os_error())
                }
            });
        }
        let mut child = builder
            .spawn()
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| RpcError::new("fork-failed", "Codex has no stdin"))?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| RpcError::new("fork-failed", "Codex has no stdout"))?;
        Ok(Self {
            child,
            input,
            output: BufReader::new(output),
        })
    }

    async fn request(&mut self, id: u64, method: &str, params: Value) -> Result<Value, RpcError> {
        self.write(&json!({ "id": id, "method": method, "params": params }))
            .await?;
        loop {
            let frame = self.read().await?;
            if frame.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = frame.get("error") {
                return Err(RpcError::new(
                    "fork-failed",
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex refused the fork"),
                ));
            }
            return Ok(frame.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), RpcError> {
        self.write(&json!({ "method": method, "params": params }))
            .await
    }

    async fn nth_turn(
        &mut self,
        thread_id: &str,
        wanted: usize,
    ) -> Result<Option<String>, RpcError> {
        let mut cursor = None::<String>;
        let mut seen = 0;
        let mut id = 100_u64;
        loop {
            let result = self
                .request(
                    id,
                    "thread/turns/list",
                    json!({
                        "threadId": thread_id,
                        "limit": 100,
                        "sortDirection": "asc",
                        "cursor": cursor,
                    }),
                )
                .await?;
            for turn in result
                .get("data")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                seen += 1;
                if seen == wanted {
                    return Ok(turn.get("id").and_then(Value::as_str).map(str::to_owned));
                }
            }
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .filter(|cursor| !cursor.is_empty())
                .map(str::to_owned);
            let Some(_) = cursor else {
                return Ok(None);
            };
            id += 1;
        }
    }

    async fn write(&mut self, frame: &Value) -> Result<(), RpcError> {
        let mut line = serde_json::to_vec(frame)
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
        line.push(b'\n');
        self.input
            .write_all(&line)
            .await
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
        self.input
            .flush()
            .await
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))
    }

    async fn read(&mut self) -> Result<Value, RpcError> {
        let mut line = Vec::new();
        let bytes = read_bounded_line(&mut self.output, &mut line, MAX_FRAME_BYTES)
            .await
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
        if bytes == 0 {
            return Err(RpcError::new(
                "fork-failed",
                "Codex closed before answering",
            ));
        }
        serde_json::from_slice(&line)
            .map_err(|error| RpcError::new("fork-failed", format!("Invalid Codex JSON: {error}")))
    }

    async fn stop(&mut self) {
        signal_group(&self.child, libc::SIGTERM);
        if tokio::time::timeout(Duration::from_secs(2), self.child.wait())
            .await
            .is_err()
        {
            signal_group(&self.child, libc::SIGKILL);
            let _ = self.child.wait().await;
        }
    }
}

impl Drop for AppServer {
    fn drop(&mut self) {
        signal_group(&self.child, libc::SIGKILL);
        let _ = self.child.start_kill();
    }
}

fn signal_group(child: &Child, signal: i32) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(-(pid as i32), signal);
        }
    }
    #[cfg(not(unix))]
    let _ = (child, signal);
}
