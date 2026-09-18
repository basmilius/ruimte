use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[cfg(test)]
use percent_encoding::percent_decode_str;
use serde_json::{Value, json};
#[cfg(test)]
use std::collections::HashSet;
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

pub struct ChatStore {
    directory: PathBuf,
}

pub struct StoredChat {
    pub info: Value,
    pub items: Vec<Value>,
    pub seq: u64,
    pub reset_seq: u64,
    pub events: Vec<(u64, Value)>,
    pub log_bytes: usize,
    pub preambles: Vec<String>,
    pub preamble_operations: Vec<String>,
}

impl ChatStore {
    pub fn new(home: &Path) -> Self {
        Self {
            directory: home.join("chats"),
        }
    }

    pub async fn read(&self, chat_id: &str) -> anyhow::Result<Option<StoredChat>> {
        let path = self.snapshot_path(chat_id);
        let snapshot = match fs::read(&path).await {
            Ok(raw) => serde_json::from_slice::<Value>(&raw)
                .ok()
                .filter(valid_snapshot),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let log = match fs::read(self.log_path(chat_id)).await {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        if snapshot.is_none() && log.is_empty() {
            return Ok(None);
        }
        let seq = snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.get("seq"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let mut events = Vec::new();
        let mut newest = seq;
        let mut reset_seq = snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.get("resetSeq"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        for line in log.split(|byte| *byte == b'\n') {
            let Ok(line) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let Some(line_seq) = line.get("seq").and_then(Value::as_u64) else {
                continue;
            };
            if line_seq > newest
                && let Some(event) = line.get("event").filter(|event| valid_event(event))
            {
                if event.get("type").and_then(Value::as_str) == Some("reset") {
                    reset_seq = line_seq;
                }
                events.push((line_seq, event.clone()));
                newest = line_seq;
            }
        }
        if snapshot.is_none()
            && (events.first().map(|(seq, _)| *seq) != Some(1)
                || !events.iter().any(|(_, event)| {
                    matches!(
                        event.get("type").and_then(Value::as_str),
                        Some("info" | "reset")
                    )
                }))
        {
            return Ok(None);
        }
        let snapshot = snapshot.unwrap_or_else(|| json!({}));
        Ok(Some(StoredChat {
            info: snapshot.get("info").cloned().unwrap_or_else(|| json!({})),
            items: snapshot
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            seq,
            reset_seq,
            events,
            log_bytes: log.len(),
            preambles: snapshot
                .get("preambles")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            preamble_operations: snapshot
                .get("preambleOperations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
        }))
    }

    #[cfg(test)]
    pub async fn list(&self) -> anyhow::Result<Vec<String>> {
        let mut entries = match fs::read_dir(&self.directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut ids = HashSet::new();
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let encoded = name
                .strip_suffix(".json")
                .or_else(|| name.strip_suffix(".log"));
            if let Some(encoded) = encoded
                && !encoded.ends_with(".plans")
                && let Ok(decoded) = percent_decode_str(encoded).decode_utf8()
            {
                ids.insert(decoded.into_owned());
            }
        }
        let mut ids = ids.into_iter().collect::<Vec<_>>();
        ids.sort();
        Ok(ids)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn write_snapshot(
        &self,
        chat_id: &str,
        info: &Value,
        items: &[Value],
        seq: u64,
        reset_seq: u64,
        preambles: &[String],
        preamble_operations: &BTreeSet<String>,
    ) -> anyhow::Result<()> {
        self.prepare().await?;
        let target = self.snapshot_path(chat_id);
        let temporary = target.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
        let body = serde_json::to_vec(&json!({
            "info": info,
            "items": items,
            "seq": seq,
            "resetSeq": reset_seq,
            "preambles": preambles,
            "preambleOperations": preamble_operations,
        }))?;
        let result = async {
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary).await?;
            file.write_all(&body).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary, &target).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&temporary).await;
        }
        result
    }

    pub async fn append(&self, chat_id: &str, seq: u64, event: &Value) -> anyhow::Result<usize> {
        self.prepare().await?;
        let mut options = fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(self.log_path(chat_id)).await?;
        let mut line = serde_json::to_vec(&json!({
            "seq": seq,
            "at": now(),
            "event": event,
        }))?;
        line.push(b'\n');
        file.write_all(&line).await?;
        file.flush().await?;
        Ok(line.len())
    }

    pub async fn compact_log(&self, chat_id: &str, through_seq: u64) -> anyhow::Result<()> {
        let target = self.log_path(chat_id);
        let log = match fs::read(&target).await {
            Ok(log) => log,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let mut retained = Vec::new();
        for line in log.split(|byte| *byte == b'\n') {
            if line.is_empty() {
                continue;
            }
            let Ok(record) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            if record.get("seq").and_then(Value::as_u64) > Some(through_seq) {
                retained.extend_from_slice(line);
                retained.push(b'\n');
            }
        }

        self.prepare().await?;
        let temporary = target.with_extension(format!("log.{}.tmp", Uuid::new_v4()));
        let result = async {
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary).await?;
            file.write_all(&retained).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary, &target).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&temporary).await;
        }
        result
    }

    pub async fn write_record(
        &self,
        chat_id: &str,
        info: &Value,
        items: &[Value],
        preambles: &[String],
    ) -> anyhow::Result<()> {
        self.write_snapshot(chat_id, info, items, 0, 0, preambles, &BTreeSet::new())
            .await
    }

    pub async fn remove(&self, chat_id: &str) -> anyhow::Result<()> {
        for path in [self.snapshot_path(chat_id), self.log_path(chat_id)] {
            match fs::remove_file(path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    async fn prepare(&self) -> anyhow::Result<()> {
        fs::create_dir_all(&self.directory).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, std::fs::Permissions::from_mode(0o700)).await?;
        }
        Ok(())
    }

    fn snapshot_path(&self, chat_id: &str) -> PathBuf {
        self.directory
            .join(format!("{}.json", encode_component(chat_id)))
    }

    fn log_path(&self, chat_id: &str) -> PathBuf {
        self.directory
            .join(format!("{}.log", encode_component(chat_id)))
    }
}

fn valid_snapshot(snapshot: &Value) -> bool {
    snapshot.get("info").is_some_and(valid_info)
        && snapshot
            .get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().all(valid_item))
}

fn valid_info(info: &Value) -> bool {
    nonempty(info.get("chatId"))
        && enum_string(
            info.get("provider"),
            &["claude", "codex", "gemini", "copilot"],
        )
        && info.get("cwd").is_some_and(Value::is_string)
        && nullable_string(info.get("agentSessionId"))
        && nullable_string(info.get("model"))
        && info.get("selection").is_some_and(valid_selection)
        && enum_string(
            info.get("runtimeMode"),
            &["supervised", "auto-accept-edits", "auto", "full-access"],
        )
        && enum_string(
            info.get("status"),
            &["running", "needs-you", "idle", "error", "exited"],
        )
        && info.get("running").is_some_and(Value::is_boolean)
        && nullable_string(info.get("activeTurnId"))
        && string_array(info.get("slashCommands"))
        && info.get("usage").is_some_and(valid_usage)
        && info.get("createdAt").is_some_and(Value::is_number)
        && info.get("queue").is_none_or(|queue| {
            queue
                .as_array()
                .is_some_and(|messages| messages.iter().all(valid_queue_message))
        })
}

fn valid_selection(selection: &Value) -> bool {
    nonempty(selection.get("model"))
        && selection
            .get("options")
            .and_then(Value::as_object)
            .is_some_and(|options| {
                options
                    .values()
                    .all(|value| value.is_string() || value.is_boolean())
            })
}

fn valid_usage(usage: &Value) -> bool {
    nonnegative_integer(usage.get("contextTokens"))
        && usage.get("contextWindow").is_some_and(|window| {
            window.is_null() || window.as_u64().is_some_and(|window| window > 0)
        })
        && nonnegative_number(usage.get("costUsd"))
        && nonnegative_integer(usage.get("turns"))
}

fn valid_queue_message(message: &Value) -> bool {
    nonempty(message.get("id"))
        && message.get("text").is_some_and(Value::is_string)
        && message.get("createdAt").is_some_and(Value::is_number)
        && message
            .get("turnId")
            .is_none_or(|turn_id| nonempty(Some(turn_id)))
        && message.get("mentions").is_none_or(string_array_value)
        && message.get("skills").is_none_or(string_array_value)
        && message.get("attachments").is_none_or(valid_attachments)
}

fn valid_item(item: &Value) -> bool {
    if !nonempty(item.get("id"))
        || !item.get("createdAt").is_some_and(Value::is_number)
        || !nullable_string(item.get("turnId"))
    {
        return false;
    }
    match item.get("kind").and_then(Value::as_str) {
        Some("user") => {
            item.get("text").is_some_and(Value::is_string)
                && item.get("mentions").is_none_or(string_array_value)
                && item.get("skills").is_none_or(string_array_value)
                && item.get("attachments").is_none_or(valid_attachments)
        }
        Some("assistant") => {
            item.get("text").is_some_and(Value::is_string)
                && item.get("streaming").is_some_and(Value::is_boolean)
                && item
                    .get("parentToolUseId")
                    .is_none_or(nullable_string_value)
        }
        Some("thinking") => {
            item.get("text").is_some_and(Value::is_string)
                && item.get("streaming").is_some_and(Value::is_boolean)
                && nullable_number(item.get("endedAt"))
        }
        Some("tool") => {
            item.get("toolUseId").is_some_and(Value::is_string)
                && item.get("name").is_some_and(Value::is_string)
                && item.get("input").is_some()
                && nullable_string(item.get("output"))
                && enum_string(item.get("state"), &["running", "done", "error"])
                && nullable_string(item.get("parentToolUseId"))
        }
        Some("subagent") => valid_subagent(item),
        Some("approval") => {
            item.get("requestId").is_some_and(Value::is_string)
                && nullable_string(item.get("toolUseId"))
                && item.get("toolName").is_some_and(Value::is_string)
                && item.get("input").is_some()
                && nullable_string(item.get("description"))
                && item.get("canAllowAlways").is_some_and(Value::is_boolean)
                && enum_string(
                    item.get("decision"),
                    &["pending", "allow", "allow-always", "deny", "cancelled"],
                )
        }
        Some("question") => {
            item.get("requestId").is_some_and(Value::is_string)
                && item
                    .get("questions")
                    .and_then(Value::as_array)
                    .is_some_and(|questions| {
                        !questions.is_empty() && questions.iter().all(valid_question)
                    })
                && item.get("answers").is_some_and(|answers| {
                    answers.is_null()
                        || answers
                            .as_object()
                            .is_some_and(|answers| answers.values().all(Value::is_string))
                })
                && enum_string(
                    item.get("state"),
                    &["pending", "answered", "cancelled", "dismissed"],
                )
        }
        Some("turn") => {
            enum_string(item.get("state"), &["running", "done", "aborted", "error"])
                && nullable_number(item.get("endedAt"))
                && nonnegative_number(item.get("costUsd"))
                && item
                    .get("attempt")
                    .is_none_or(|attempt| attempt.as_u64().is_some_and(|attempt| attempt > 0))
        }
        Some("note") => {
            enum_string(item.get("level"), &["info", "warning", "error"])
                && item.get("text").is_some_and(Value::is_string)
        }
        Some("compaction") => nullable_nonnegative_integer(item.get("preTokens")),
        _ => false,
    }
}

fn valid_subagent(item: &Value) -> bool {
    item.get("toolUseId").is_some_and(Value::is_string)
        && item.get("description").is_some_and(Value::is_string)
        && nullable_string(item.get("subagentType"))
        && nullable_string(item.get("prompt"))
        && item.get("background").is_some_and(Value::is_boolean)
        && enum_string(item.get("status"), &["running", "done", "failed"])
        && item.get("startedAt").is_some_and(Value::is_number)
        && nullable_number(item.get("finishedAt"))
        && nullable_string(item.get("summary"))
        && nullable_string(item.get("result"))
        && item.get("usage").is_some_and(|usage| {
            usage.is_null()
                || (nonnegative_integer(usage.get("totalTokens"))
                    && nonnegative_integer(usage.get("toolUses"))
                    && nonnegative_integer(usage.get("durationMs")))
        })
        && nullable_string(item.get("lastTool"))
        && item.get("itemsTruncated").is_some_and(Value::is_boolean)
}

fn valid_question(question: &Value) -> bool {
    question.get("id").is_some_and(Value::is_string)
        && question.get("header").is_some_and(Value::is_string)
        && question.get("question").is_some_and(Value::is_string)
        && question.get("multiSelect").is_some_and(Value::is_boolean)
        && question
            .get("choices")
            .and_then(Value::as_array)
            .is_some_and(|choices| {
                choices.iter().all(|choice| {
                    choice.get("label").is_some_and(Value::is_string)
                        && choice.get("description").is_some_and(Value::is_string)
                })
            })
}

fn valid_attachments(value: &Value) -> bool {
    value.as_array().is_some_and(|attachments| {
        attachments.iter().all(|attachment| {
            nonempty(attachment.get("id"))
                && nonempty(attachment.get("name"))
                && attachment.get("mime").is_some_and(Value::is_string)
                && nonnegative_integer(attachment.get("size"))
                && attachment.get("path").is_some_and(Value::is_string)
        })
    })
}

fn enum_string(value: Option<&Value>, choices: &[&str]) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| choices.contains(&value))
}

fn nonempty(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
}

fn nullable_string(value: Option<&Value>) -> bool {
    value.is_some_and(nullable_string_value)
}

fn nullable_string_value(value: &Value) -> bool {
    value.is_null() || value.is_string()
}

fn nullable_number(value: Option<&Value>) -> bool {
    value.is_some_and(|value| value.is_null() || value.is_number())
}

fn nullable_nonnegative_integer(value: Option<&Value>) -> bool {
    value.is_some_and(|value| value.is_null() || value.as_u64().is_some())
}

fn nonnegative_integer(value: Option<&Value>) -> bool {
    value.and_then(Value::as_u64).is_some()
}

fn nonnegative_number(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|value| value >= 0.0)
}

fn string_array(value: Option<&Value>) -> bool {
    value.is_some_and(string_array_value)
}

fn string_array_value(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|values| values.iter().all(Value::is_string))
}

fn valid_event(event: &Value) -> bool {
    match event.get("type").and_then(Value::as_str) {
        Some("info") => event.get("info").is_some_and(valid_info),
        Some("item") => event.get("item").is_some_and(valid_item),
        Some("delta") => {
            event.get("itemId").is_some_and(Value::is_string)
                && event.get("text").is_some_and(Value::is_string)
        }
        Some("reset") => {
            event.get("info").is_some_and(valid_info)
                && event
                    .get("items")
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.iter().all(valid_item))
        }
        _ => false,
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recovery_matches_typescript_store_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/chat-store.json"
        )))
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let temporary = tempfile::tempdir().unwrap();
            let chats = temporary.path().join("chats");
            fs::create_dir(&chats).await.unwrap();
            if let Some(snapshot) = case["snapshot"].as_str() {
                fs::write(chats.join("chat.json"), snapshot).await.unwrap();
            }
            if let Some(log) = case["log"].as_str() {
                fs::write(chats.join("chat.log"), log).await.unwrap();
            }

            let store = ChatStore::new(temporary.path());
            let read = store.read("chat").await.unwrap();
            let expected = &case["result"];
            assert_eq!(read.is_some(), !expected.is_null(), "{}", case["name"]);
            if let Some(read) = read {
                let mut info = read.info;
                let mut items = read.items;
                for (_, event) in &read.events {
                    super::super::apply_event(&mut info, &mut items, event);
                }
                if let Some(info) = info.as_object_mut() {
                    info.remove("extra");
                }
                assert_eq!(info, expected["info"], "info in {}", case["name"]);
                assert_eq!(json!(items), expected["items"], "items in {}", case["name"]);
                assert_eq!(read.seq, expected["seq"], "seq in {}", case["name"]);
                assert_eq!(
                    read.reset_seq, expected["resetSeq"],
                    "resetSeq in {}",
                    case["name"]
                );
                assert_eq!(
                    json!(read.preambles),
                    expected["preambles"],
                    "preambles in {}",
                    case["name"]
                );
            }
            assert_eq!(
                json!(store.list().await.unwrap()),
                case["list"],
                "{}",
                case["name"]
            );
        }
    }

    #[tokio::test]
    async fn rejects_contract_invalid_info_and_nested_items() {
        let temporary = tempfile::tempdir().unwrap();
        let chats = temporary.path().join("chats");
        fs::create_dir(&chats).await.unwrap();
        let base = json!({
            "info": {
                "chatId": "chat", "provider": "claude", "cwd": "/tmp",
                "agentSessionId": null, "model": null,
                "selection": { "model": "claude-sonnet-5", "options": {} },
                "runtimeMode": "full-access", "status": "idle", "running": false,
                "activeTurnId": null, "slashCommands": [],
                "usage": { "contextTokens": 0, "contextWindow": 200000, "costUsd": 0, "turns": 0 },
                "createdAt": 1,
            },
            "items": [],
        });
        let store = ChatStore::new(temporary.path());

        let mut invalid_window = base.clone();
        invalid_window["info"]["usage"]["contextWindow"] = json!(0);
        fs::write(
            chats.join("chat.json"),
            serde_json::to_vec(&invalid_window).unwrap(),
        )
        .await
        .unwrap();
        assert!(store.read("chat").await.unwrap().is_none());

        let mut invalid_item = base;
        invalid_item["items"] = json!([{
            "id": "answer", "createdAt": 1, "turnId": null,
            "kind": "assistant", "text": "hello", "streaming": "no",
        }]);
        fs::write(
            chats.join("chat.json"),
            serde_json::to_vec(&invalid_item).unwrap(),
        )
        .await
        .unwrap();
        assert!(store.read("chat").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn compaction_keeps_only_events_newer_than_the_snapshot() {
        let temporary = tempfile::tempdir().unwrap();
        let store = ChatStore::new(temporary.path());
        let info = json!({
            "chatId": "chat", "provider": "claude", "cwd": "/tmp",
            "agentSessionId": null, "model": null,
            "selection": { "model": "claude-sonnet-5", "options": {} },
            "runtimeMode": "full-access", "status": "idle", "running": false,
            "activeTurnId": null, "slashCommands": [],
            "usage": { "contextTokens": 0, "contextWindow": 200000, "costUsd": 0, "turns": 0 },
            "createdAt": 1,
        });
        let snapshot_item = json!({
            "id": "note", "createdAt": 1, "turnId": null,
            "kind": "note", "level": "info", "text": "snapshot",
        });
        store
            .write_snapshot(
                "chat",
                &info,
                std::slice::from_ref(&snapshot_item),
                3,
                0,
                &[],
                &BTreeSet::new(),
            )
            .await
            .unwrap();
        for (seq, text) in [(2, "old"), (4, "new"), (5, "newest")] {
            store
                .append(
                    "chat",
                    seq,
                    &json!({
                        "type": "item",
                        "item": {
                            "id": "note", "createdAt": 1, "turnId": null,
                            "kind": "note", "level": "info", "text": text,
                        },
                    }),
                )
                .await
                .unwrap();
        }

        store.compact_log("chat", 3).await.unwrap();

        let stored = store.read("chat").await.unwrap().unwrap();
        assert_eq!(stored.seq, 3);
        assert_eq!(stored.events.len(), 2);
        assert_eq!(stored.events[0].0, 4);
        assert_eq!(stored.events[1].0, 5);
    }
}
