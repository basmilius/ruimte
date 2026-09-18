use std::{io, path::Path, process::Stdio, time::Duration};

use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::timeout,
};

use super::DeviceError;

#[cfg(target_os = "macos")]
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(target_os = "macos")]
const STDOUT_LIMIT: usize = 16 * 1024 * 1024;
#[cfg(target_os = "macos")]
const STDERR_LIMIT: usize = 1024 * 1024;

#[derive(Debug)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct CommandOutput {
    pub stdout: String,
}

#[cfg(target_os = "macos")]
pub async fn run(
    program: &Path,
    arguments: &[String],
    stdin: Option<&str>,
    unavailable_code: &'static str,
    unavailable_message: &'static str,
    failed_code: &'static str,
    failed_message: &'static str,
) -> Result<CommandOutput, DeviceError> {
    run_with_limits(
        program,
        arguments,
        stdin,
        unavailable_code,
        unavailable_message,
        failed_code,
        failed_message,
        CommandLimits::default(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn run_with_limits(
    program: &Path,
    arguments: &[String],
    stdin: Option<&str>,
    unavailable_code: &'static str,
    unavailable_message: &'static str,
    failed_code: &'static str,
    failed_message: &'static str,
    limits: CommandLimits,
) -> Result<CommandOutput, DeviceError> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Command-line adapters may launch descendants, so cancellation owns a whole process group.
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        });
    }
    let mut child = command
        .spawn()
        .map_err(|_| DeviceError::new(unavailable_code, unavailable_message))?;
    let pid = child
        .id()
        .ok_or_else(|| DeviceError::new(unavailable_code, unavailable_message))?
        as i32;
    let mut guard = ProcessGroupGuard { pid, armed: true };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| DeviceError::new(failed_code, failed_message))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| DeviceError::new(failed_code, failed_message))?;
    let mut input_pipe = child.stdin.take();
    let operation = async {
        let write_input = async {
            if let Some(input) = stdin {
                let pipe = input_pipe
                    .as_mut()
                    .ok_or_else(|| DeviceError::new(failed_code, failed_message))?;
                pipe.write_all(input.as_bytes())
                    .await
                    .map_err(|_| DeviceError::new(failed_code, failed_message))?;
                pipe.shutdown()
                    .await
                    .map_err(|_| DeviceError::new(failed_code, failed_message))?;
            }
            Ok::<(), DeviceError>(())
        };
        let (written, stdout, stderr) = tokio::join!(
            write_input,
            read_bounded(stdout, limits.stdout),
            read_bounded(stderr, limits.stderr),
        );
        written?;
        let stdout = stdout
            .map_err(|_| DeviceError::new(failed_code, "Command output exceeded its size limit"))?;
        let stderr = stderr
            .map_err(|_| DeviceError::new(failed_code, "Command output exceeded its size limit"))?;
        let status = child
            .wait()
            .await
            .map_err(|_| DeviceError::new(failed_code, failed_message))?;
        Ok::<_, DeviceError>((status, stdout, stderr))
    };
    let (status, stdout, stderr) = match timeout(limits.timeout, operation).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            cleanup_group(&mut child, pid).await;
            guard.armed = false;
            return Err(error);
        }
        Err(_) => {
            cleanup_group(&mut child, pid).await;
            guard.armed = false;
            return Err(DeviceError::new(
                failed_code,
                format!("{failed_message}: command timed out"),
            ));
        }
    };
    let stdout = String::from_utf8_lossy(&stdout).into_owned();
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    guard.armed = false;
    if !status.success() {
        return Err(DeviceError::new(
            failed_code,
            if stderr.trim().is_empty() {
                failed_message.to_owned()
            } else {
                stderr.trim().to_owned()
            },
        ));
    }
    Ok(CommandOutput { stdout })
}

async fn read_bounded(mut reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>, ()> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await.map_err(|_| ())?;
        if count == 0 {
            return Ok(bytes);
        }
        if bytes.len().saturating_add(count) > limit {
            return Err(());
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

fn terminate_group(pid: i32, signal: i32) {
    unsafe {
        libc::kill(-pid, signal);
    }
}

async fn cleanup_group(child: &mut tokio::process::Child, pid: i32) {
    terminate_group(pid, libc::SIGTERM);
    // Keep the root unreaped until descendants have received the final signal, so the
    // process-group identity cannot be reused between cleanup signals.
    tokio::time::sleep(Duration::from_millis(500)).await;
    terminate_group(pid, libc::SIGKILL);
    let _ = child.wait().await;
}

#[derive(Clone, Copy)]
struct CommandLimits {
    timeout: Duration,
    stdout: usize,
    stderr: usize,
}

#[cfg(target_os = "macos")]
impl Default for CommandLimits {
    fn default() -> Self {
        Self {
            timeout: COMMAND_TIMEOUT,
            stdout: STDOUT_LIMIT,
            stderr: STDERR_LIMIT,
        }
    }
}

struct ProcessGroupGuard {
    pid: i32,
    armed: bool,
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        if self.armed {
            terminate_group(self.pid, libc::SIGKILL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "spawns real process groups"]
    async fn timeout_kills_a_descendant_that_keeps_stdout_open() {
        let directory = tempfile::tempdir().unwrap();
        let pid_file = directory.path().join("pid");
        let script = format!(
            "(trap '' TERM; sleep 30) & child=$!; echo $child > {}; exit 0",
            pid_file.display()
        );
        let started = std::time::Instant::now();
        let error = run_with_limits(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            None,
            "missing",
            "missing",
            "failed",
            "failed",
            CommandLimits {
                timeout: Duration::from_millis(200),
                stdout: 1024,
                stderr: 1024,
            },
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
        let pid: i32 = std::fs::read_to_string(pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        for _ in 0..20 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("descendant {pid} survived command cleanup");
    }

    #[tokio::test]
    #[ignore = "spawns a real output-flooding process"]
    async fn oversized_output_fails_without_retaining_the_process() {
        let error = run_with_limits(
            Path::new("/usr/bin/yes"),
            &[],
            None,
            "missing",
            "missing",
            "failed",
            "failed",
            CommandLimits {
                timeout: Duration::from_secs(2),
                stdout: 1024,
                stderr: 1024,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.message, "Command output exceeded its size limit");
    }
}
