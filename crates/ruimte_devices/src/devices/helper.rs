use std::{
    io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

#[cfg(target_os = "macos")]
use std::path::PathBuf;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::{
    fs::File,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};

use super::{
    DeviceError,
    backend::{DeviceSource, FramePublisher},
    model::DeviceInput,
};
use crate::streams::{LiveFormat, LiveFrame};

const MAGIC: [u8; 8] = [0x52, 0x44, 0x45, 0x56, 0x01, 0x00, 0x00, 0x00];
const HEADER_BYTES: usize = 5;
const FRAME_HEADER_BYTES: usize = 12;
const MAX_CONTROL_BYTES: usize = 64 * 1024;
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(20);
type ReadySender = oneshot::Sender<Result<(), DeviceError>>;

pub struct HelperSource {
    command: Vec<String>,
    device_id: String,
    format: LiveFormat,
    stop_grace: Duration,
    state: Mutex<Option<HelperRun>>,
}

struct HelperRun {
    input: mpsc::Sender<Vec<u8>>,
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl HelperSource {
    pub fn new(
        command: Vec<String>,
        device_id: String,
        format: LiveFormat,
        stop_grace: Duration,
    ) -> Self {
        Self {
            command,
            device_id,
            format,
            stop_grace,
            state: Mutex::new(None),
        }
    }

    fn launch(
        &self,
        publish: FramePublisher,
    ) -> Result<(HelperRun, oneshot::Receiver<Result<(), DeviceError>>), DeviceError> {
        let (read_fd, write_fd) = protocol_pipe()?;
        let write_raw = write_fd.as_raw_fd();
        let mut command = Command::new(&self.command[0]);
        command
            .args(&self.command[1..])
            .arg(&self.device_id)
            .env("RUIMTE_DEVICE_HELPER_PROTOCOL_FD", "3")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // A dedicated process group lets shutdown clean up descendants started by an adapter.
        unsafe {
            command.pre_exec(move || {
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::dup2(write_raw, 3) < 0 {
                    return Err(io::Error::last_os_error());
                }
                if write_raw == 3 {
                    if libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                        return Err(io::Error::last_os_error());
                    }
                } else {
                    libc::close(write_raw);
                }
                Ok(())
            });
        }
        let spawned = command.spawn();
        // The child owns the duplicated writer after spawn; retaining this end prevents EOF.
        drop(write_fd);
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                return Err(DeviceError::new(
                    "device-helper-unavailable",
                    error.to_string(),
                ));
            }
        };
        let pid = child.id().ok_or_else(|| {
            DeviceError::new(
                "device-helper-unavailable",
                "The device helper did not start",
            )
        })? as i32;
        let mut stdin = child.stdin.take().ok_or_else(|| {
            DeviceError::new(
                "device-helper-unavailable",
                "The device helper input could not be opened",
            )
        })?;
        let protocol = File::from_std(std::fs::File::from(read_fd));
        let stderr = child.stderr.take();
        let stderr_tail = Arc::new(StdMutex::new(String::new()));
        let mut stderr_task = if let Some(mut stderr) = stderr {
            let tail = stderr_tail.clone();
            Some(tokio::spawn(async move {
                read_stderr_tail(&mut stderr, tail).await
            }))
        } else {
            None
        };

        let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(64);
        let mut writer = tokio::spawn(async move {
            stdin.write_all(&MAGIC).await?;
            stdin.flush().await?;
            while let Some(message) = input_rx.recv().await {
                stdin.write_all(&message).await?;
                stdin.flush().await?;
            }
            Ok::<(), io::Error>(())
        });
        let (ready_tx, ready_rx) = oneshot::channel();
        let ready = Arc::new(StdMutex::new(Some(ready_tx)));
        let output_ready = ready.clone();
        let format = self.format;
        let mut output =
            tokio::spawn(
                async move { read_protocol(protocol, format, publish, output_ready).await },
            );
        let task_ready = ready.clone();
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let grace = self.stop_grace;
        let task = tokio::spawn(async move {
            let mut protocol_result;
            let mut output_finished = false;
            let mut writer_finished = false;
            tokio::select! {
                result = &mut output => {
                    output_finished = true;
                    protocol_result = result.unwrap_or_else(|error| Err(DeviceError::new("device-helper-protocol", error.to_string())));
                    let status = terminate_helper_group(&mut child, pid).await;
                    if protocol_result.is_ok() && !status.is_some_and(|status| status.success()) {
                        protocol_result = Err(DeviceError::new("device-helper-exited", format!("The device capture helper exited with code {}", status.and_then(|value| value.code()).unwrap_or(-1))));
                    }
                }
                result = &mut writer => {
                    writer_finished = true;
                    protocol_result = match result {
                        Ok(Ok(())) => Ok(()),
                        Ok(Err(error)) => Err(DeviceError::new("device-helper-unavailable", error.to_string())),
                        Err(error) => Err(DeviceError::new("device-helper-unavailable", error.to_string())),
                    };
                    terminate_helper_group(&mut child, pid).await;
                }
                _ = &mut stop_rx => {
                    protocol_result = Ok(());
                    if timeout(grace, &mut output).await.is_ok() {
                        output_finished = true;
                        terminate_group(pid, libc::SIGKILL);
                        let _ = child.wait().await;
                    } else {
                        terminate_helper_group(&mut child, pid).await;
                    }
                }
            }
            if !writer_finished {
                writer.abort();
                let _ = writer.await;
            }
            if !output_finished {
                output.abort();
                let _ = output.await;
            }
            if let Some(task) = stderr_task.as_mut()
                && timeout(Duration::from_millis(500), &mut *task)
                    .await
                    .is_err()
            {
                task.abort();
                let _ = task.await;
            }
            if let Err(mut error) = protocol_result {
                let detail = stderr_tail
                    .lock()
                    .expect("device stderr lock poisoned")
                    .trim()
                    .to_owned();
                if error.code == "device-helper-exited" && !detail.is_empty() {
                    error.message = detail;
                }
                if let Some(sender) = task_ready
                    .lock()
                    .expect("device ready lock poisoned")
                    .take()
                {
                    let _ = sender.send(Err(error));
                }
            }
        });

        Ok((
            HelperRun {
                input: input_tx,
                stop: Some(stop_tx),
                task,
            },
            ready_rx,
        ))
    }
}

#[async_trait]
impl DeviceSource for HelperSource {
    fn format(&self) -> LiveFormat {
        self.format
    }

    async fn start(&self, publish: FramePublisher) -> Result<(), DeviceError> {
        let finished = self
            .state
            .lock()
            .await
            .as_ref()
            .is_some_and(|run| run.task.is_finished());
        if finished {
            self.stop().await;
        }
        let ready_rx = {
            let mut state = self.state.lock().await;
            if state.is_some() {
                return Err(DeviceError::new(
                    "device-helper-running",
                    "The device capture helper is already running",
                ));
            }
            let (run, ready_rx) = self.launch(publish)?;
            *state = Some(run);
            ready_rx
        };
        let result = match timeout(READY_TIMEOUT, ready_rx).await {
            Ok(Ok(Ok(()))) => return Ok(()),
            Ok(Ok(Err(error))) => error,
            Ok(Err(_)) => DeviceError::new(
                "device-helper-exited",
                "The device capture helper exited before it became ready",
            ),
            Err(_) => DeviceError::new(
                "device-helper-timeout",
                "The device capture helper did not become ready",
            ),
        };
        self.stop().await;
        Err(result)
    }

    async fn input(&self, input: DeviceInput) -> Result<(), DeviceError> {
        let message = encode_control(17, &serde_json::to_vec(&input).map_err(protocol_error)?)?;
        let state = self.state.lock().await;
        let run = state.as_ref().ok_or_else(|| {
            DeviceError::new(
                "device-not-streaming",
                "Open the device stream before sending input",
            )
        })?;
        run.input.try_send(message).map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => DeviceError::new(
                "device-helper-busy",
                "The device helper input queue is full",
            ),
            mpsc::error::TrySendError::Closed(_) => {
                DeviceError::new("device-not-streaming", "The device helper has stopped")
            }
        })
    }

    async fn stop(&self) {
        if let Some(run) = self.state.lock().await.take() {
            stop_run(run, self.stop_grace).await;
        }
    }
}

async fn stop_run(mut run: HelperRun, _grace: Duration) {
    let _ = run
        .input
        .try_send(encode_control(18, &[]).expect("empty stop message is valid"));
    drop(run.input);
    if let Some(stop) = run.stop.take() {
        let _ = stop.send(());
    }
    let _ = timeout(Duration::from_secs(3), &mut run.task).await;
}

fn terminate_group(pid: i32, signal: i32) {
    unsafe {
        libc::kill(-pid, signal);
    }
}

async fn terminate_helper_group(
    child: &mut tokio::process::Child,
    pid: i32,
) -> Option<std::process::ExitStatus> {
    terminate_group(pid, libc::SIGTERM);
    // Reap only after the final group signal, keeping the group identity owned throughout cleanup.
    tokio::time::sleep(Duration::from_millis(500)).await;
    terminate_group(pid, libc::SIGKILL);
    child.wait().await.ok()
}

fn protocol_pipe() -> Result<(OwnedFd, OwnedFd), DeviceError> {
    let mut descriptors = [0_i32; 2];
    let result = unsafe { libc::pipe(descriptors.as_mut_ptr()) };
    if result != 0 {
        return Err(DeviceError::new(
            "device-helper-unavailable",
            io::Error::last_os_error().to_string(),
        ));
    }
    for descriptor in descriptors {
        if unsafe { libc::fcntl(descriptor, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
            unsafe {
                libc::close(descriptors[0]);
                libc::close(descriptors[1]);
            }
            return Err(DeviceError::new(
                "device-helper-unavailable",
                io::Error::last_os_error().to_string(),
            ));
        }
    }
    // Safety: pipe returned two new owned descriptors.
    Ok(unsafe {
        (
            OwnedFd::from_raw_fd(descriptors[0]),
            OwnedFd::from_raw_fd(descriptors[1]),
        )
    })
}

async fn read_stderr_tail(input: &mut (impl AsyncRead + Unpin), tail: Arc<StdMutex<String>>) {
    let mut retained = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 1024];
    loop {
        let count = match input.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if retained.len() + count > 4096 {
            let discard = retained.len() + count - 4096;
            retained.drain(..discard.min(retained.len()));
        }
        retained.extend_from_slice(&buffer[..count]);
    }
    *tail.lock().expect("device stderr lock poisoned") =
        String::from_utf8_lossy(&retained).into_owned();
}

async fn read_protocol(
    mut input: impl AsyncRead + Unpin,
    format: LiveFormat,
    publish: FramePublisher,
    ready: Arc<StdMutex<Option<ReadySender>>>,
) -> Result<(), DeviceError> {
    let mut magic = [0_u8; MAGIC.len()];
    input.read_exact(&mut magic).await.map_err(protocol_error)?;
    if magic != MAGIC {
        return Err(DeviceError::new(
            "device-helper-protocol",
            "Unknown device helper protocol",
        ));
    }
    let mut became_ready = false;
    loop {
        let mut header = [0_u8; HEADER_BYTES];
        match input.read_exact(&mut header).await {
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(protocol_error(error)),
        }
        let kind = header[0];
        let length = u32::from_be_bytes(header[1..5].try_into().expect("fixed header")) as usize;
        let maximum = if kind == 2 {
            FRAME_HEADER_BYTES + MAX_FRAME_BYTES
        } else {
            MAX_CONTROL_BYTES
        };
        if length > maximum {
            return Err(DeviceError::new(
                "device-helper-protocol",
                "Device helper message is too large",
            ));
        }
        let mut payload = vec![0_u8; length];
        input
            .read_exact(&mut payload)
            .await
            .map_err(protocol_error)?;
        match kind {
            1 => {
                if became_ready {
                    return Err(DeviceError::new(
                        "device-helper-protocol",
                        "The device capture helper became ready more than once",
                    ));
                }
                let dimensions: Dimensions =
                    serde_json::from_slice(&payload).map_err(protocol_error)?;
                if dimensions.width == 0 || dimensions.height == 0 {
                    return Err(DeviceError::new(
                        "device-helper-protocol",
                        "Invalid device helper dimensions",
                    ));
                }
                became_ready = true;
                if let Some(sender) = ready.lock().expect("device ready lock poisoned").take() {
                    let _ = sender.send(Ok(()));
                }
            }
            2 if became_ready => publish(decode_frame(&payload, format)?),
            2 => {
                return Err(DeviceError::new(
                    "device-helper-protocol",
                    "The device capture helper sent a frame before it was ready",
                ));
            }
            3 => {
                let error: HelperError =
                    serde_json::from_slice(&payload).map_err(protocol_error)?;
                if error.code.is_empty()
                    || error.code.len() > 128
                    || error.message.is_empty()
                    || error.message.len() > 4096
                {
                    return Err(DeviceError::new(
                        "device-helper-protocol",
                        "Invalid device helper error",
                    ));
                }
                return Err(DeviceError::new(error.code, error.message));
            }
            _ => {
                return Err(DeviceError::new(
                    "device-helper-protocol",
                    "The device capture helper sent a command on its output stream",
                ));
            }
        }
    }
}

fn decode_frame(payload: &[u8], format: LiveFormat) -> Result<LiveFrame, DeviceError> {
    if payload.len() < FRAME_HEADER_BYTES {
        return Err(DeviceError::new(
            "device-helper-protocol",
            "Invalid device helper frame",
        ));
    }
    let length = u32::from_be_bytes(payload[0..4].try_into().expect("frame header")) as usize;
    let sequence = u32::from_be_bytes(payload[4..8].try_into().expect("frame header"));
    let width = u16::from_be_bytes(payload[8..10].try_into().expect("frame header"));
    let height = u16::from_be_bytes(payload[10..12].try_into().expect("frame header"));
    if length > MAX_FRAME_BYTES
        || payload.len() != FRAME_HEADER_BYTES + length
        || width == 0
        || height == 0
        || width > 8192
        || height > 8192
    {
        return Err(DeviceError::new(
            "device-helper-protocol",
            "Invalid device helper frame",
        ));
    }
    Ok(LiveFrame {
        sequence,
        width,
        height,
        data: Arc::new(payload[12..].to_vec()),
        format,
    })
}

fn encode_control(kind: u8, payload: &[u8]) -> Result<Vec<u8>, DeviceError> {
    if payload.len() > MAX_CONTROL_BYTES {
        return Err(DeviceError::new(
            "device-helper-protocol",
            "Device helper control message is too large",
        ));
    }
    let mut result = Vec::with_capacity(HEADER_BYTES + payload.len());
    result.push(kind);
    result.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    result.extend_from_slice(payload);
    Ok(result)
}

fn protocol_error(error: impl std::fmt::Display) -> DeviceError {
    DeviceError::new("device-helper-protocol", error.to_string())
}

#[derive(Deserialize)]
struct Dimensions {
    width: u16,
    height: u16,
}

#[derive(Deserialize)]
struct HelperError {
    code: String,
    message: String,
}

#[cfg(target_os = "macos")]
pub fn simulator_command(home: &std::path::Path) -> Option<Vec<String>> {
    let executable = std::env::current_exe().ok()?;
    let release = executable.parent()?.join("ruimte-simulator-helper");
    if release.is_file() {
        return Some(vec![release.to_string_lossy().into_owned()]);
    }
    if cfg!(debug_assertions) {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/server-rust/helpers/simulator.ts");
        if source.is_file() {
            return Some(vec!["bun".into(), source.to_string_lossy().into_owned()]);
        }
        let home_source = home.join("apps/server-rust/helpers/simulator.ts");
        if home_source.is_file() {
            return Some(vec![
                "bun".into(),
                home_source.to_string_lossy().into_owned(),
            ]);
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn physical_command() -> Result<Vec<String>, DeviceError> {
    let executable = std::env::current_exe().map_err(|error| {
        DeviceError::new(
            "device-helper-unavailable",
            format!("The Ruimte executable could not be located: {error}"),
        )
    })?;
    Ok(vec![
        executable.to_string_lossy().into_owned(),
        crate::config::PHYSICAL_HELPER_COMMAND.into(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn physical_capture_uses_the_running_daemon_instead_of_an_external_bridge() {
        let command = physical_command().unwrap();
        assert_eq!(command.len(), 2);
        assert_eq!(
            command[0],
            std::env::current_exe().unwrap().to_string_lossy()
        );
        assert_eq!(command[1], crate::config::PHYSICAL_HELPER_COMMAND);
        assert!(
            !command
                .iter()
                .any(|part| part.contains("ios-device-bridge"))
        );
    }

    #[tokio::test]
    async fn protocol_accepts_fragmented_ready_and_frame_records() {
        let mut bytes = MAGIC.to_vec();
        bytes.extend(encode_control(1, br#"{"width":320,"height":640}"#).unwrap());
        let mut frame = Vec::new();
        frame.extend_from_slice(&4_u32.to_be_bytes());
        frame.extend_from_slice(&7_u32.to_be_bytes());
        frame.extend_from_slice(&320_u16.to_be_bytes());
        frame.extend_from_slice(&640_u16.to_be_bytes());
        frame.extend_from_slice(&[0xff, 0xd8, 0xff, 0xd9]);
        bytes.extend(encode_control(2, &frame).unwrap());
        let (mut writer, reader) = tokio::io::duplex(32);
        tokio::spawn(async move {
            for chunk in bytes.chunks(3) {
                writer.write_all(chunk).await.unwrap();
            }
        });
        let (ready_tx, ready_rx) = oneshot::channel();
        let frames = Arc::new(StdMutex::new(Vec::new()));
        let output = frames.clone();
        read_protocol(
            reader,
            LiveFormat::Jpeg,
            Arc::new(move |frame| output.lock().unwrap().push(frame)),
            Arc::new(StdMutex::new(Some(ready_tx))),
        )
        .await
        .unwrap();
        ready_rx.await.unwrap().unwrap();
        let frames = frames.lock().unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(
            (frames[0].sequence, frames[0].width, frames[0].height),
            (7, 320, 640)
        );
        assert_eq!(frames[0].data.as_slice(), [0xff, 0xd8, 0xff, 0xd9]);
    }

    #[tokio::test]
    async fn protocol_rejects_frames_before_ready_and_oversized_controls() {
        let frame_before_ready = {
            let mut bytes = MAGIC.to_vec();
            let mut frame = vec![0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1];
            bytes.extend(encode_control(2, &frame).unwrap());
            frame.clear();
            bytes
        };
        let oversized = {
            let mut bytes = MAGIC.to_vec();
            bytes.push(1);
            bytes.extend_from_slice(&((MAX_CONTROL_BYTES + 1) as u32).to_be_bytes());
            bytes
        };
        for bytes in [frame_before_ready, oversized] {
            let (mut writer, reader) = tokio::io::duplex(bytes.len());
            writer.write_all(&bytes).await.unwrap();
            drop(writer);
            let (ready_tx, _ready_rx) = oneshot::channel();
            let error = read_protocol(
                reader,
                LiveFormat::Jpeg,
                Arc::new(|_| {}),
                Arc::new(StdMutex::new(Some(ready_tx))),
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, "device-helper-protocol");
        }
    }

    #[tokio::test]
    async fn stderr_drain_retains_only_the_last_four_kibibytes() {
        let (mut writer, mut reader) = tokio::io::duplex(1024);
        let tail = Arc::new(StdMutex::new(String::new()));
        let output = tail.clone();
        let task = tokio::spawn(async move { read_stderr_tail(&mut reader, output).await });
        writer.write_all(&vec![b'a'; 5000]).await.unwrap();
        writer.write_all(&[b'b'; 100]).await.unwrap();
        drop(writer);
        task.await.unwrap();
        let tail = tail.lock().unwrap();
        assert_eq!(tail.len(), 4096);
        assert!(tail.ends_with(&"b".repeat(100)));
    }
}
