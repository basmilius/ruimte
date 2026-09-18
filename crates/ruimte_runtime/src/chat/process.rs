use std::{collections::HashMap, io, path::Path, process::Stdio};

use serde_json::Value;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Semaphore, mpsc},
};

const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const WRITE_BYTES: usize = 8 * 1024 * 1024;
const STDERR_BYTES: usize = 64 * 1024;
const WRITE_QUEUE: usize = 64;

struct InputFrame {
    bytes: Vec<u8>,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

#[derive(Debug)]
pub enum ProcessEvent {
    Frame {
        generation: u64,
        frame: Value,
    },
    ProtocolError {
        generation: u64,
        message: String,
    },
    StdoutClosed {
        generation: u64,
    },
    Exited {
        generation: u64,
        code: Option<i32>,
    },
    InterruptTimeout {
        generation: u64,
        turn_id: String,
    },
    SuggestedTitle {
        generation: u64,
        agent_session_id: String,
        title: Option<String>,
        only_if_absent: bool,
        set_backend: bool,
    },
}

pub struct ChatProcess {
    pub pid: u32,
    input: mpsc::Sender<InputFrame>,
    input_bytes: std::sync::Arc<Semaphore>,
}

impl ChatProcess {
    pub fn send(&self, frame: &Value) -> anyhow::Result<()> {
        let mut line = serde_json::to_vec(frame)?;
        line.push(b'\n');
        let bytes = u32::try_from(line.len())
            .map_err(|_| anyhow::anyhow!("The agent input frame is too large"))?;
        let permit = self
            .input_bytes
            .clone()
            .try_acquire_many_owned(bytes)
            .map_err(|_| anyhow::anyhow!("The agent input byte budget is full"))?;
        self.input
            .try_send(InputFrame {
                bytes: line,
                _permit: permit,
            })
            .map_err(|_| anyhow::anyhow!("The agent input queue is full"))
    }

    pub fn terminate(&self, signal: i32) {
        #[cfg(unix)]
        // SAFETY: the pid is returned by the child we placed in its own process group.
        unsafe {
            libc::kill(-(self.pid as i32), signal);
        }
        #[cfg(not(unix))]
        let _ = signal;
    }
}

pub fn spawn(
    command: &[String],
    cwd: &Path,
    environment: &HashMap<String, String>,
    generation: u64,
    events: mpsc::Sender<ProcessEvent>,
) -> anyhow::Result<ChatProcess> {
    let (program, arguments) = command
        .split_first()
        .ok_or_else(|| anyhow::anyhow!("The agent command is empty"))?;
    let mut child_command = Command::new(program);
    child_command
        .args(arguments)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in [
        "RUIMTE_HOOK_URL",
        "RUIMTE_HOOK_TOKEN",
        "RUIMTE_CONTEXT_URL",
        "RUIMTE_CONTEXT_TOKEN",
        "RUIMTE_SESSION_ID",
    ] {
        child_command.env_remove(key);
    }
    child_command.envs(environment);
    #[cfg(unix)]
    // SAFETY: pre_exec only calls the async-signal-safe setpgid syscall before exec.
    unsafe {
        child_command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        });
    }
    let mut child = child_command.spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| anyhow::anyhow!("The agent process has no pid"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("The agent process has no stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("The agent process has no stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("The agent process has no stderr"))?;
    let input_bytes = std::sync::Arc::new(Semaphore::new(WRITE_BYTES));
    let (input, mut input_rx) = mpsc::channel::<InputFrame>(WRITE_QUEUE);
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(frame) = input_rx.recv().await {
            if stdin.write_all(&frame.bytes).await.is_err() || stdin.flush().await.is_err() {
                break;
            }
        }
    });
    let stdout_events = events.clone();
    tokio::spawn(async move {
        let fatal = read_frames(stdout, generation, stdout_events.clone()).await;
        if fatal {
            terminate_group(pid, libc::SIGKILL);
        }
        let _ = stdout_events
            .send(ProcessEvent::StdoutClosed { generation })
            .await;
    });
    let stderr = tokio::spawn(capture_stderr(stderr));
    tokio::spawn(async move {
        let code = child.wait().await.ok().and_then(|status| status.code());
        let diagnostics = stderr.await.unwrap_or_default();
        if code.is_some_and(|code| code != 0) && !diagnostics.is_empty() {
            let _ = events
                .send(ProcessEvent::ProtocolError {
                    generation,
                    message: format!(
                        "Agent stderr: {}",
                        String::from_utf8_lossy(&diagnostics).trim()
                    ),
                })
                .await;
        }
        let _ = events.send(ProcessEvent::Exited { generation, code }).await;
    });
    Ok(ChatProcess {
        pid,
        input,
        input_bytes,
    })
}

async fn read_frames(
    mut reader: impl AsyncRead + Unpin,
    generation: u64,
    events: mpsc::Sender<ProcessEvent>,
) -> bool {
    let mut chunk = [0_u8; 16 * 1024];
    let mut buffered = Vec::new();
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(read) => read,
            Err(error) => {
                let _ = events
                    .send(ProcessEvent::ProtocolError {
                        generation,
                        message: format!("Could not read agent output: {error}"),
                    })
                    .await;
                return true;
            }
        };
        if read == 0 {
            break;
        }
        buffered.extend_from_slice(&chunk[..read]);
        while let Some(newline) = buffered.iter().position(|byte| *byte == b'\n') {
            let line = buffered.drain(..=newline).collect::<Vec<_>>();
            if line.len() > MAX_FRAME_BYTES {
                protocol_error(&events, generation, "Agent output frame exceeds 1 MiB").await;
                return true;
            }
            if !decode_frame(&line[..line.len() - 1], generation, &events).await {
                return true;
            }
        }
        if buffered.len() > MAX_FRAME_BYTES {
            protocol_error(&events, generation, "Agent output frame exceeds 1 MiB").await;
            return true;
        }
    }
    if !buffered.is_empty() {
        return !decode_frame(&buffered, generation, &events).await;
    }
    false
}

async fn decode_frame(line: &[u8], generation: u64, events: &mpsc::Sender<ProcessEvent>) -> bool {
    if line.iter().all(u8::is_ascii_whitespace) {
        return true;
    }
    match serde_json::from_slice(line) {
        Ok(frame) => {
            let _ = events.send(ProcessEvent::Frame { generation, frame }).await;
            true
        }
        Err(error) => {
            protocol_error(events, generation, &format!("Invalid agent JSON: {error}")).await;
            false
        }
    }
}

async fn protocol_error(events: &mpsc::Sender<ProcessEvent>, generation: u64, message: &str) {
    let _ = events
        .send(ProcessEvent::ProtocolError {
            generation,
            message: message.to_owned(),
        })
        .await;
}

async fn capture_stderr(mut stderr: impl AsyncRead + Unpin) -> Vec<u8> {
    let mut buffer = [0_u8; 4096];
    let mut retained = Vec::with_capacity(STDERR_BYTES);
    loop {
        let Ok(read) = stderr.read(&mut buffer).await else {
            return retained;
        };
        if read == 0 {
            return retained;
        }
        let room = STDERR_BYTES.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..read.min(room)]);
    }
}

fn terminate_group(pid: u32, signal: i32) {
    #[cfg(unix)]
    // SAFETY: the pid is returned by the child process group created during spawn.
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
    #[cfg(not(unix))]
    let _ = (pid, signal);
}
