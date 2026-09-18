use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use crate::rpc::RpcError;

// Claude Code's transcript is undocumented; this shape is pinned to 2.1.273.
const CHECKED_VERSION: &str = "2.1.273";

pub enum CutPoint<'a> {
    LastUuid(&'a str),
    Turns(usize),
    Whole,
}

pub async fn fork_transcript(
    projects_dir: &Path,
    cwd: &str,
    session_id: &str,
    at: CutPoint<'_>,
    fork_cwd: &str,
    new_session_id: &str,
) -> Result<PathBuf, RpcError> {
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err(RpcError::new(
            "transcript-missing",
            "Claude Code keeps no conversation for this chat",
        ));
    }
    let source = find_transcript(projects_dir, cwd, session_id)
        .await?
        .ok_or_else(|| {
            RpcError::new(
                "transcript-missing",
                format!("Claude Code's conversation file for {session_id} is not there"),
            )
        })?;
    let text = fs::read_to_string(&source)
        .await
        .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
    let copy = cut_transcript(&text, at, session_id, new_session_id)?;
    let directory = projects_dir.join(project_slug(fork_cwd));
    fs::create_dir_all(&directory)
        .await
        .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
    }
    let path = directory.join(format!("{new_session_id}.jsonl"));
    let temporary = directory.join(format!(".{new_session_id}.{}.tmp", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary)
        .await
        .map_err(|error| RpcError::new("fork-failed", error.to_string()))?;
    if let Err(error) = file.write_all(copy.as_bytes()).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(RpcError::new("fork-failed", error.to_string()));
    }
    if let Err(error) = file.sync_all().await {
        let _ = fs::remove_file(&temporary).await;
        return Err(RpcError::new("fork-failed", error.to_string()));
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, &path).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(RpcError::new("fork-failed", error.to_string()));
    }
    Ok(path)
}

pub fn cut_transcript(
    text: &str,
    at: CutPoint<'_>,
    session_id: &str,
    new_session_id: &str,
) -> Result<String, RpcError> {
    let mut lines = Vec::<Map<String, Value>>::new();
    for raw in text.lines().filter(|line| !line.trim().is_empty()) {
        let line = serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .filter(|line| line.get("type").is_some_and(Value::is_string))
            .ok_or_else(|| format_refusal("a line is not a typed JSON object"))?;
        lines.push(line);
    }
    let messages = lines.iter().filter(|line| {
        matches!(
            line.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        )
    });
    if messages.clone().next().is_none()
        || messages.clone().any(|line| {
            !line.get("uuid").is_some_and(Value::is_string)
                || line.get("sessionId").and_then(Value::as_str) != Some(session_id)
                || !line.get("message").is_some_and(Value::is_object)
        })
    {
        return Err(format_refusal(
            "its messages lack a uuid, a message or this session id",
        ));
    }
    let end = match at {
        CutPoint::Whole => lines.len(),
        CutPoint::LastUuid(uuid) => {
            let start = lines
                .iter()
                .position(|line| line.get("uuid").and_then(Value::as_str) == Some(uuid))
                .ok_or_else(|| {
                    format_refusal(&format!(
                        "no line carries the uuid {uuid} the turn ended on"
                    ))
                })?;
            next_prompt(&lines, start).unwrap_or(lines.len())
        }
        CutPoint::Turns(turns) => {
            let mut seen = 0;
            let start = lines
                .iter()
                .position(|line| {
                    if spoken_prompt(line) {
                        seen += 1;
                    }
                    seen == turns && spoken_prompt(line)
                })
                .ok_or_else(|| {
                    RpcError::new(
                        "turn-not-found",
                        format!(
                            "Claude Code keeps fewer than {turns} prompts, so the turn could not be found"
                        ),
                    )
                })?;
            next_prompt(&lines, start).unwrap_or(lines.len())
        }
    };
    let last_message = lines[..end]
        .iter()
        .rposition(|line| line.get("uuid").is_some_and(Value::is_string));
    let mut output = String::new();
    for (index, mut line) in lines.into_iter().take(end).enumerate() {
        if last_message.is_some_and(|last| index > last)
            && line.get("type").and_then(Value::as_str) == Some("queue-operation")
        {
            continue;
        }
        if line.contains_key("sessionId") {
            line.insert("sessionId".into(), Value::String(new_session_id.into()));
        }
        output.push_str(&serde_json::to_string(&line).expect("JSON object serialization"));
        output.push('\n');
    }
    Ok(output)
}

async fn find_transcript(
    projects_dir: &Path,
    cwd: &str,
    session_id: &str,
) -> Result<Option<PathBuf>, RpcError> {
    let own = projects_dir
        .join(project_slug(cwd))
        .join(format!("{session_id}.jsonl"));
    if fs::try_exists(&own).await.unwrap_or(false) {
        return Ok(Some(own));
    }
    let mut entries = match fs::read_dir(projects_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(RpcError::new("fork-failed", error.to_string())),
    };
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| RpcError::new("fork-failed", error.to_string()))?
    {
        let candidate = entry.path().join(format!("{session_id}.jsonl"));
        if fs::try_exists(&candidate).await.unwrap_or(false) {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

fn project_slug(cwd: &str) -> String {
    cwd.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn next_prompt(lines: &[Map<String, Value>], start: usize) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| spoken_prompt(line).then_some(index))
}

fn spoken_prompt(line: &Map<String, Value>) -> bool {
    if line.get("type").and_then(Value::as_str) != Some("user")
        || line.get("isSidechain").and_then(Value::as_bool) == Some(true)
        || line.get("isMeta").and_then(Value::as_bool) == Some(true)
        || line.get("isCompactSummary").and_then(Value::as_bool) == Some(true)
    {
        return false;
    }
    let Some(content) = line
        .get("message")
        .and_then(|message| message.get("content"))
    else {
        return false;
    };
    if content.as_str().is_some_and(|text| !text.is_empty()) {
        return true;
    }
    let Some(blocks) = content.as_array() else {
        return false;
    };
    blocks
        .iter()
        .any(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        && !blocks
            .iter()
            .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
}

fn format_refusal(detail: &str) -> RpcError {
    RpcError::new(
        "transcript-format",
        format!(
            "Claude Code's conversation file has a shape this machine does not know ({detail}; checked against Claude Code {CHECKED_VERSION}), so it cannot be forked"
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuts_after_named_turn_and_rewrites_session() {
        let line = |value: Value| format!("{}\n", serde_json::to_string(&value).unwrap());
        let transcript = [
            line(serde_json::json!({"type":"user","uuid":"u1","sessionId":"old","message":{"content":"one"}})),
            line(serde_json::json!({"type":"assistant","uuid":"a1","sessionId":"old","message":{"content":[]}})),
            line(serde_json::json!({"type":"queue-operation","operation":"keep"})),
            line(serde_json::json!({"type":"user","uuid":"u2","sessionId":"old","message":{"content":"two"}})),
            line(serde_json::json!({"type":"assistant","uuid":"a2","sessionId":"old","message":{"content":[]}})),
        ]
        .concat();
        let cut = cut_transcript(&transcript, CutPoint::LastUuid("a1"), "old", "new").unwrap();
        let lines = cut.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"sessionId\":\"new\""));
        assert!(!cut.contains("queue-operation"));
        assert!(!cut.contains("a2"));
    }

    #[test]
    fn drops_trailing_queue_operations() {
        let transcript = [
            serde_json::json!({"type":"user","uuid":"u1","sessionId":"old","message":{"content":"one"}}),
            serde_json::json!({"type":"assistant","uuid":"a1","sessionId":"old","message":{"content":[]}}),
            serde_json::json!({"type":"queue-operation","operation":"drop"}),
        ]
        .into_iter()
        .map(|value| format!("{}\n", serde_json::to_string(&value).unwrap()))
        .collect::<String>();
        let cut = cut_transcript(&transcript, CutPoint::Whole, "old", "new").unwrap();
        assert!(!cut.contains("queue-operation"));
    }
}
