use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context, anyhow};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::mpsc;

pub struct SpawnOptions {
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub env: HashMap<String, String>,
}

pub struct SpawnedPty {
    pub pid: u32,
    pub writer: Option<mpsc::Sender<WriterCommand>>,
    pub master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    writer_cancelled: Arc<AtomicBool>,
}

impl SpawnedPty {
    pub fn cancel_writer(&self) {
        self.writer_cancelled.store(true, Ordering::Release);
        if let Some(writer) = &self.writer {
            let _ = writer.try_send(WriterCommand {
                id: None,
                data: Vec::new(),
            });
        }
    }

    pub fn release(&mut self) {
        self.cancel_writer();
        self.writer.take();
        self.master.take();
    }
}

pub struct WriterCommand {
    pub id: Option<u64>,
    pub data: Vec<u8>,
}

#[derive(Debug)]
pub enum PtyEvent {
    Output(Vec<u8>),
    ReaderClosed,
    Exited(i32),
    DrainElapsed,
    WriterStopped,
    WriteCompleted { id: u64, result: Result<(), String> },
}

pub fn spawn(options: SpawnOptions, events: mpsc::Sender<PtyEvent>) -> anyhow::Result<SpawnedPty> {
    let system = native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows: options.rows,
            cols: options.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("open PTY")?;
    let mut command = CommandBuilder::new(&options.shell);
    command.args(&options.args);
    command.cwd(options.cwd);
    command.env_clear();
    for (key, value) in options.env {
        command.env(key, value);
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .context("spawn shell in PTY")?;
    let pid = child
        .process_id()
        .ok_or_else(|| anyhow!("spawned shell has no process id"))?;
    let mut reader = pair.master.try_clone_reader().context("clone PTY reader")?;
    let mut writer = pair.master.take_writer().context("take PTY writer")?;
    #[cfg(unix)]
    let writer_fd = pair.master.as_raw_fd();
    let (writer_sender, mut writer_receiver) = mpsc::channel::<WriterCommand>(64);
    let writer_cancelled = Arc::new(AtomicBool::new(false));
    let master = Arc::new(Mutex::new(pair.master));

    let writer_events = events.clone();
    let writer_worker_cancelled = writer_cancelled.clone();
    std::thread::Builder::new()
        .name(format!("ruimte-pty-write-{pid}"))
        .spawn(move || {
            while let Some(command) = writer_receiver.blocking_recv() {
                let result = write_interruptibly(
                    writer.as_mut(),
                    &command.data,
                    #[cfg(unix)]
                    writer_fd,
                    &writer_worker_cancelled,
                )
                .and_then(|_| writer.flush())
                .map_err(|error| error.to_string());
                if let Some(id) = command.id
                    && writer_events
                        .blocking_send(PtyEvent::WriteCompleted { id, result })
                        .is_err()
                {
                    break;
                }
                if writer_worker_cancelled.load(Ordering::Acquire) {
                    break;
                }
            }
            let _ = writer_events.blocking_send(PtyEvent::WriterStopped);
        })?;

    let reader_events = events.clone();
    std::thread::Builder::new()
        .name(format!("ruimte-pty-read-{pid}"))
        .spawn(move || {
            let mut buffer = vec![0; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(length) => {
                        if reader_events
                            .blocking_send(PtyEvent::Output(buffer[..length].to_vec()))
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let _ = reader_events.blocking_send(PtyEvent::ReaderClosed);
        })?;

    std::thread::Builder::new()
        .name(format!("ruimte-pty-wait-{pid}"))
        .spawn(move || {
            let exit_code = child.wait().map(exit_code).unwrap_or(1);
            let _ = events.blocking_send(PtyEvent::Exited(exit_code));
            std::thread::sleep(std::time::Duration::from_millis(250));
            let _ = events.blocking_send(PtyEvent::DrainElapsed);
        })?;

    Ok(SpawnedPty {
        pid,
        writer: Some(writer_sender),
        master: Some(master),
        writer_cancelled,
    })
}

#[cfg(unix)]
fn write_interruptibly(
    writer: &mut dyn Write,
    data: &[u8],
    fd: Option<libc::c_int>,
    cancelled: &AtomicBool,
) -> std::io::Result<()> {
    let fd = fd.ok_or_else(|| std::io::Error::other("PTY has no file descriptor"))?;
    let mut offset = 0;
    while offset < data.len() {
        if cancelled.load(Ordering::Acquire) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "PTY writer cancelled",
            ));
        }
        let mut descriptor = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut descriptor, 1, 100) };
        if ready < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        if ready == 0 {
            continue;
        }
        if descriptor.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "PTY writer closed",
            ));
        }
        if descriptor.revents & libc::POLLOUT != 0 {
            let end = (offset + 1024).min(data.len());
            let written = writer.write(&data[offset..end])?;
            if written == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "PTY writer made no progress",
                ));
            }
            offset += written;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn write_interruptibly(
    writer: &mut dyn Write,
    data: &[u8],
    cancelled: &AtomicBool,
) -> std::io::Result<()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "PTY writer cancelled",
        ));
    }
    writer.write_all(data)
}

pub fn resize(
    master: &Arc<Mutex<Box<dyn MasterPty + Send>>>,
    cols: u16,
    rows: u16,
) -> anyhow::Result<()> {
    master
        .lock()
        .map_err(|_| anyhow!("PTY master lock poisoned"))?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
    Ok(())
}

#[cfg(unix)]
pub fn signal(pid: u32, signal: i32) -> std::io::Result<()> {
    let result = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
pub fn signal(_pid: u32, _signal: i32) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "signals are unavailable",
    ))
}

fn exit_code(status: portable_pty::ExitStatus) -> i32 {
    let signal = status.signal().map(str::to_ascii_lowercase);
    match signal.as_deref() {
        Some(name) if name.contains("hangup") || name == "sighup" => 129,
        Some(name) if name.contains("interrupt") || name == "sigint" => 130,
        Some(name) if name.contains("kill") || name == "sigkill" => 137,
        Some(name) if name.contains("term") || name == "sigterm" => 143,
        _ => status.exit_code() as i32,
    }
}
