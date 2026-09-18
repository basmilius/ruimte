use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde_json::{Value, json};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, BufReader},
};

use crate::rpc::RpcError;

use super::{
    apply_event, backend::BackendNormalizer, codex_fork, framing::read_bounded_line,
    projector::ThreadProjector,
};

const MAX_TRANSCRIPT_LINE: usize = 16 * 1024 * 1024;
const SETTLEMENT_TAIL_BYTES: u64 = 1024 * 1024;

pub struct ClaudeTranscript {
    pub path: PathBuf,
    pub agent_id: String,
}

pub struct ClaudeSettlement {
    pub finished_at: Option<u64>,
    pub report: Option<String>,
}

pub async fn read_claude_settlement(path: &Path) -> Option<ClaudeSettlement> {
    let before = fs::metadata(path).await.ok()?;
    let from = before.len().saturating_sub(SETTLEMENT_TAIL_BYTES);
    let mut file = fs::File::open(path).await.ok()?;
    file.seek(std::io::SeekFrom::Start(from)).await.ok()?;
    let mut bytes = Vec::with_capacity((before.len() - from) as usize);
    file.read_to_end(&mut bytes).await.ok()?;
    let after = fs::metadata(path).await.ok()?;
    if before.len() != after.len() || before.modified().ok()? != after.modified().ok()? {
        return None;
    }
    if from > 0 {
        let line = bytes.iter().position(|byte| *byte == b'\n')?;
        bytes.drain(..=line);
    }
    settlement_of(&bytes)
}

fn settlement_of(bytes: &[u8]) -> Option<ClaudeSettlement> {
    if bytes.last() != Some(&b'\n') {
        return None;
    }
    let lines = bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.iter().all(u8::is_ascii_whitespace))
        .map(serde_json::from_slice::<Value>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    for (index, entry) in lines.iter().enumerate().rev() {
        if !matches!(
            entry.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        ) {
            continue;
        }
        let message = entry.get("message")?;
        let content = message.get("content").and_then(Value::as_array)?;
        if entry.get("type").and_then(Value::as_str) != Some("assistant")
            || message.get("stop_reason").and_then(Value::as_str) != Some("end_turn")
            || content
                .iter()
                .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        {
            return None;
        }
        let report = handback_before(&lines, index).or_else(|| {
            let report = content
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            (!report.is_empty()).then_some(report)
        });
        let finished_at = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).ok())
            .map(|time| time.timestamp_millis().max(0) as u64);
        return Some(ClaudeSettlement {
            finished_at,
            report,
        });
    }
    None
}

fn handback_before(lines: &[Value], end: usize) -> Option<String> {
    lines[..end].iter().rev().find_map(|entry| {
        let blocks = entry.pointer("/message/content")?.as_array()?;
        blocks.iter().find_map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("tool_use")
                && block.get("name").and_then(Value::as_str) == Some("SubagentHandback"))
            .then(|| block.pointer("/input/message").and_then(Value::as_str))
            .flatten()
            .filter(|message| !message.trim().is_empty())
            .map(str::to_owned)
        })
    })
}

pub async fn find_claude_transcript(
    projects: &Path,
    info: &Value,
    tool_use_id: &str,
) -> Option<ClaudeTranscript> {
    let cwd = info.get("cwd")?.as_str()?;
    let session_id = info.get("agentSessionId")?.as_str()?;
    if session_id.contains('/') || session_id.contains("..") {
        return None;
    }
    let own = projects
        .join(claude_project_slug(cwd))
        .join(session_id)
        .join("subagents");
    if let Some(transcript) = transcript_in(&own, tool_use_id).await {
        return Some(transcript);
    }
    let mut entries = fs::read_dir(projects).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let directory = entry.path().join(session_id).join("subagents");
        if let Some(transcript) = transcript_in(&directory, tool_use_id).await {
            return Some(transcript);
        }
    }
    None
}

pub async fn read_claude(
    path: &Path,
    cursor: Option<&str>,
    limit: usize,
    live: bool,
) -> Result<Value, RpcError> {
    let file = fs::File::open(path).await.map_err(|_| {
        RpcError::new(
            "subagent-not-found",
            "Claude has not written a transcript for this sub-agent",
        )
    })?;
    let mut lines = BufReader::new(file);
    let mut line = Vec::new();
    let mut info = reading_info("claude");
    let mut items = Vec::new();
    let mut normalizer = BackendNormalizer::new("claude");
    let mut projector = ThreadProjector::new(
        info.clone(),
        Vec::new(),
        "Claude Code",
        0,
        "reader".to_owned(),
    );
    let mut line_number = 0_u64;
    loop {
        let bytes = read_bounded_line(&mut lines, &mut line, MAX_TRANSCRIPT_LINE)
            .await
            .map_err(|error| RpcError::new("chat-storage", error.to_string()))?;
        if bytes == 0 {
            break;
        }
        let Ok(entry) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if !matches!(
            entry.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        ) {
            continue;
        }
        line_number += 1;
        let at = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).ok())
            .map(|time| time.timestamp_millis().max(0) as u64)
            .unwrap_or(line_number);
        if entry.get("type").and_then(Value::as_str) == Some("user")
            && let Some(text) = spoken_user_text(entry.pointer("/message/content"))
        {
            if entry.get("isMeta").and_then(Value::as_bool) != Some(true) && !text.trim().is_empty()
            {
                items.push(json!({
                    "id": format!("user-{}", entry.get("uuid").and_then(Value::as_str).unwrap_or("line")),
                    "kind": "user", "createdAt": at, "turnId": null, "text": text,
                }));
                projector.sync_thread(&info, &items);
            }
            continue;
        }
        let output = normalizer.handle_at(&entry, at);
        for event in output.events {
            projector.sync_thread(&info, &items);
            for projected in projector.project_at(0, &event, at) {
                apply_event(&mut info, &mut items, &projected);
            }
        }
    }
    settle_reading(&mut items);
    let prefix = format!(
        "claude-{:016x}",
        stable_hash(path.to_string_lossy().as_bytes())
    );
    page(items, cursor, limit, &prefix, "claude-transcript", live)
}

pub async fn read_codex(
    command: &[String],
    cwd: &Path,
    environment: &HashMap<String, String>,
    thread_id: &str,
    cursor: Option<&str>,
    limit: usize,
    live: bool,
) -> Result<Value, RpcError> {
    let native_cursor = match cursor {
        Some(cursor) => Some(cursor.strip_prefix("codex:").ok_or_else(|| {
            RpcError::new(
                "history-expired",
                "The conversation changed. Reload its history.",
            )
        })?),
        None => None,
    };
    let result = codex_fork::request_once(
        command,
        cwd,
        environment,
        "thread/items/list",
        json!({
            "threadId": thread_id,
            "limit": limit,
            "sortDirection": "desc",
            "cursor": native_cursor,
        }),
    )
    .await
    .map_err(|error| RpcError::new("subagent-not-found", error.message))?;
    let mut entries = result
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    entries.reverse();
    let mut info = reading_info("codex");
    let mut items = Vec::new();
    for entry in entries {
        let Some(item) = entry.get("item").filter(|item| item.is_object()) else {
            continue;
        };
        if item.get("type").and_then(Value::as_str) == Some("userMessage") {
            let text = item
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            if !text.is_empty() {
                items.push(json!({
                    "id": format!("user-{}", item.get("id").and_then(Value::as_str).unwrap_or("item")),
                    "kind": "user", "createdAt": 0, "turnId": null, "text": text,
                }));
            }
            continue;
        }
        let mut normalizer = BackendNormalizer::new("codex");
        let mut projector =
            ThreadProjector::new(info.clone(), items.clone(), "Codex", 0, "reader".to_owned());
        let frame = json!({ "method": "item/completed", "params": { "item": item } });
        for event in normalizer.handle_at(&frame, 0).events {
            for projected in projector.project(0, &event) {
                apply_event(&mut info, &mut items, &projected);
            }
        }
    }
    settle_reading(&mut items);
    let next = result
        .get("nextCursor")
        .and_then(Value::as_str)
        .filter(|cursor| !cursor.is_empty())
        .map(|cursor| format!("codex:{cursor}"));
    Ok(json!({
        "items": items,
        "history": { "cursor": next },
        "source": "codex-thread",
        "live": live,
    }))
}

pub fn page(
    items: Vec<Value>,
    cursor: Option<&str>,
    limit: usize,
    prefix: &str,
    source: &str,
    live: bool,
) -> Result<Value, RpcError> {
    let end = match cursor {
        Some(cursor) => {
            let parsed = cursor
                .strip_prefix(&format!("{prefix}:"))
                .and_then(|value| value.split_once(':'))
                .and_then(|(end, digest)| Some((end.parse::<usize>().ok()?, digest)))
                .filter(|(end, digest)| {
                    *end <= items.len()
                        && digest.as_bytes() == item_digest(&items[..*end]).as_bytes()
                })
                .map(|(end, _)| end);
            parsed.ok_or_else(|| {
                RpcError::new(
                    "history-expired",
                    "The conversation changed. Reload its history.",
                )
            })?
        }
        None => items.len(),
    };
    let start = end.saturating_sub(limit);
    Ok(json!({
        "items": items[start..end],
        "history": { "start": start, "cursor": (start > 0).then(|| format!("{prefix}:{start}:{}", item_digest(&items[..start]))) },
        "source": source,
        "live": live,
    }))
}

async fn transcript_in(directory: &Path, tool_use_id: &str) -> Option<ClaudeTranscript> {
    let mut entries = fs::read_dir(directory).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(agent_id) = name
            .strip_prefix("agent-")
            .and_then(|name| name.strip_suffix(".meta.json"))
        else {
            continue;
        };
        let Ok(raw) = fs::read(entry.path()).await else {
            continue;
        };
        let Ok(meta) = serde_json::from_slice::<Value>(&raw) else {
            continue;
        };
        if meta.get("toolUseId").and_then(Value::as_str) == Some(tool_use_id) {
            return Some(ClaudeTranscript {
                path: directory.join(format!("agent-{agent_id}.jsonl")),
                agent_id: agent_id.to_owned(),
            });
        }
    }
    None
}

fn item_digest(items: &[Value]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for item in items {
        if let Ok(encoded) = serde_json::to_vec(item) {
            for byte in encoded {
                hash ^= u64::from(byte);
                hash = hash.wrapping_mul(0x100000001b3);
            }
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn stable_hash(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn spoken_user_text(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks)
            if !blocks
                .iter()
                .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_result")) =>
        {
            let texts = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>();
            (!texts.is_empty()).then(|| texts.join("\n"))
        }
        _ => None,
    }
}

fn settle_reading(items: &mut [Value]) {
    for item in items {
        item["turnId"] = Value::Null;
        if matches!(
            item.get("kind").and_then(Value::as_str),
            Some("assistant" | "thinking")
        ) {
            item["streaming"] = json!(false);
        }
        if item.get("kind").and_then(Value::as_str) == Some("thinking")
            && item.get("endedAt").is_none_or(Value::is_null)
        {
            item["endedAt"] = item.get("createdAt").cloned().unwrap_or_else(|| json!(0));
        }
    }
}

fn reading_info(provider: &str) -> Value {
    json!({
        "chatId": "subagent", "provider": provider, "cwd": "", "agentSessionId": null,
        "selection": { "model": "", "options": {} }, "runtimeMode": "full-access",
        "status": "running", "running": true, "activeTurnId": "subagent-reading",
        "slashCommands": [], "usage": { "contextTokens": 0, "contextWindow": 0, "costUsd": 0, "turns": 0 }, "createdAt": 0,
    })
}

pub(crate) fn claude_project_slug(cwd: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(count: usize) -> Vec<Value> {
        (0..count)
            .map(|index| json!({ "id": format!("row-{index}"), "kind": "note", "text": index }))
            .collect()
    }

    #[test]
    fn cursor_is_scoped_to_one_conversation() {
        let first = page(rows(5), None, 2, "child-a", "chat", false).unwrap();
        let cursor = first.pointer("/history/cursor").unwrap().as_str().unwrap();
        let error = page(rows(5), Some(cursor), 2, "child-b", "chat", false).unwrap_err();
        assert_eq!(error.code, "history-expired");
    }

    #[test]
    fn cursor_survives_append_but_rejects_rewritten_history() {
        let first = page(rows(5), None, 2, "claude-file", "chat", true).unwrap();
        let cursor = first.pointer("/history/cursor").unwrap().as_str().unwrap();
        let older = page(rows(7), Some(cursor), 2, "claude-file", "chat", true).unwrap();
        assert_eq!(older["items"][0]["id"], "row-1");

        let mut rewritten = rows(7);
        rewritten[0]["text"] = json!("changed");
        let error = page(rewritten, Some(cursor), 2, "claude-file", "chat", true).unwrap_err();
        assert_eq!(error.code, "history-expired");
    }

    #[test]
    fn settlement_requires_a_complete_final_end_turn() {
        let handback = json!({
            "type": "assistant",
            "message": { "content": [{ "type": "tool_use", "name": "SubagentHandback", "input": { "message": "The report" } }], "stop_reason": "tool_use" }
        });
        let done = json!({
            "type": "assistant", "timestamp": "2026-09-16T09:12:12.045Z",
            "message": { "content": [{ "type": "text", "text": "See above" }], "stop_reason": "end_turn" }
        });
        let transcript = format!("{handback}\n{done}\n");
        let settlement = settlement_of(transcript.as_bytes()).unwrap();
        assert_eq!(settlement.report.as_deref(), Some("The report"));
        assert_eq!(settlement.finished_at, Some(1_789_549_932_045));
        assert!(settlement_of(transcript.trim_end().as_bytes()).is_none());

        let running = json!({
            "type": "assistant",
            "message": { "content": [{ "type": "tool_use", "name": "Bash" }], "stop_reason": "tool_use" }
        });
        assert!(settlement_of(format!("{running}\n").as_bytes()).is_none());
    }
}
