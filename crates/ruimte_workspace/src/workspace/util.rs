use std::{io::ErrorKind, path::Path};

use serde_json::Value;
use tokio::fs::{self, OpenOptions};

use crate::rpc::RpcError;

pub fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value, RpcError> {
    value
        .get(name)
        .ok_or_else(|| RpcError::new("bad-request", format!("Missing {name}.")))
}

pub fn string_field(value: &Value, name: &str) -> Result<String, RpcError> {
    field(value, name)?
        .as_str()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| RpcError::new("bad-request", format!("{name} must be a non-empty string.")))
}

pub fn u64_field(value: &Value, name: &str) -> Result<u64, RpcError> {
    field(value, name)?.as_u64().ok_or_else(|| {
        RpcError::new(
            "bad-request",
            format!("{name} must be a non-negative integer."),
        )
    })
}

pub async fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    write_atomic_mode(path, bytes, 0o600).await
}

pub async fn write_atomic_mode(path: &Path, bytes: &[u8], mode: u32) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let temp = path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(mode);
    let mut file = options.open(&temp).await?;
    tokio::io::AsyncWriteExt::write_all(&mut file, bytes).await?;
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);
    if let Err(error) = fs::rename(&temp, path).await {
        let _ = fs::remove_file(&temp).await;
        return Err(error);
    }
    Ok(())
}

pub async fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, std::io::Error> {
    match fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub fn io_error(error: std::io::Error) -> RpcError {
    RpcError::new("io-error", error.to_string())
}

pub fn encode_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        let safe = byte.is_ascii_alphanumeric()
            || matches!(
                *byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if safe {
            encoded.push(char::from(*byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
