use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};

pub struct ThreadProjector {
    info: Value,
    items: Vec<Value>,
    indices: HashMap<String, usize>,
    provider_name: String,
    next_time: u64,
    fixed_time: Option<u64>,
    suffix: String,
    task_summary: Option<String>,
    task_tool_use_id: Option<String>,
    thinking: Option<Thinking>,
}

struct Thinking {
    id: String,
    refs: HashSet<String>,
    last: Option<String>,
}

impl ThreadProjector {
    #[cfg(test)]
    fn fixture(info: Value, items: Vec<Value>, provider_name: &str, clock: u64) -> Self {
        Self::new(info, items, provider_name, clock, "f4bipx".to_owned())
    }

    pub fn new(
        info: Value,
        items: Vec<Value>,
        provider_name: &str,
        clock: u64,
        suffix: String,
    ) -> Self {
        let indices = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                item.get("id")
                    .and_then(Value::as_str)
                    .map(|id| (id.to_owned(), index))
            })
            .collect();
        Self {
            info,
            items,
            indices,
            provider_name: provider_name.to_owned(),
            next_time: clock,
            fixed_time: None,
            suffix,
            task_summary: None,
            task_tool_use_id: None,
            thinking: None,
        }
    }

    #[cfg(test)]
    pub fn info(&self) -> &Value {
        &self.info
    }

    #[cfg(test)]
    pub fn items(&self) -> &[Value] {
        &self.items
    }

    pub fn sync_thread(&mut self, info: &Value, items: &[Value]) {
        self.info = info.clone();
        self.items = items.to_vec();
        self.indices = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                item.get("id")
                    .and_then(Value::as_str)
                    .map(|id| (id.to_owned(), index))
            })
            .collect();
        if self.thinking.as_ref().is_some_and(|thinking| {
            self.indices
                .get(&thinking.id)
                .and_then(|index| self.items.get(*index))
                .and_then(|item| item.get("streaming"))
                .and_then(Value::as_bool)
                != Some(true)
        }) {
            self.thinking = None;
        }
    }

    pub fn project(&mut self, generation: u64, event: &Value) -> Vec<Value> {
        let mut output = Vec::new();
        if self.active_turn().is_none() && starts_agent_turn(event) {
            self.open_agent_turn(&mut output);
        }
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "session" => {
                let mut patch = Map::new();
                for key in ["agentSessionId", "model"] {
                    if event.get(key).is_some_and(|value| !value.is_null()) {
                        patch.insert(key.to_owned(), event[key].clone());
                    }
                }
                for key in ["slashCommands", "skills"] {
                    if event
                        .get(key)
                        .and_then(Value::as_array)
                        .is_some_and(|values| !values.is_empty())
                    {
                        patch.insert(key.to_owned(), event[key].clone());
                    }
                }
                patch.insert("running".to_owned(), json!(true));
                output.push(self.patch_info(patch));
            }
            "model" => output.push(self.patch_info(Map::from_iter([(
                "model".to_owned(),
                event.get("model").cloned().unwrap_or(Value::Null),
            )]))),
            "thinking.delta" | "thinking.done" => self.append_thinking(
                generation,
                string(event, "ref"),
                string(event, "text"),
                event["type"] == "thinking.done",
                &mut output,
            ),
            "text.delta" => {
                self.close_thinking(&mut output);
                let id = self.item_id(generation, string(event, "ref"));
                self.append_assistant(&id, string(event, "text"), &mut output);
            }
            "text.done" => {
                if let Some(parent) = event.get("parentRef").and_then(Value::as_str) {
                    self.append_subagent_text(
                        generation,
                        parent,
                        string(event, "ref"),
                        string(event, "text"),
                        &mut output,
                    );
                } else {
                    self.close_thinking(&mut output);
                    let id = self.item_id(generation, string(event, "ref"));
                    let existing = self.get(&id).cloned();
                    let item = json!({
                        "id": id,
                        "kind": "assistant",
                        "createdAt": existing.as_ref().and_then(|item| item.get("createdAt")).cloned().unwrap_or_else(|| json!(self.now())),
                        "turnId": existing.as_ref().and_then(|item| item.get("turnId")).cloned().unwrap_or_else(|| self.info.get("activeTurnId").cloned().unwrap_or(Value::Null)),
                        "text": string(event, "text"),
                        "streaming": false,
                    });
                    output.push(self.upsert(item));
                }
            }
            "tool.started" => {
                if event.get("parentRef").is_some_and(Value::is_null) {
                    self.close_thinking(&mut output);
                }
                if event.get("parentRef").is_some_and(Value::is_null)
                    && matches!(
                        event.get("name").and_then(Value::as_str),
                        Some("Agent" | "Task")
                    )
                {
                    self.start_subagent(generation, event, &mut output);
                } else {
                    self.start_tool(generation, event, &mut output);
                }
            }
            "tool.progress" => self.patch_tool_progress(generation, event, &mut output),
            "tool.output" => {
                let id = self.item_id(generation, string(event, "ref"));
                if let Some(delta) = self.append_text(&id, string(event, "text")) {
                    output.push(delta);
                }
            }
            "tool.done" => {
                let id = self.item_id(generation, string(event, "ref"));
                if self
                    .get(&id)
                    .and_then(|item| item.get("kind"))
                    .and_then(Value::as_str)
                    == Some("subagent")
                {
                    self.settle_subagent(&id, event, &mut output);
                } else {
                    self.settle_tool(&id, event, &mut output);
                }
            }
            "approval.requested" => {
                self.close_thinking(&mut output);
                let request_id = string(event, "requestId");
                let mut item = json!({
                    "id": format!("approval-{request_id}"),
                    "kind": "approval",
                    "createdAt": self.now(),
                    "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null),
                    "requestId": request_id,
                    "toolUseId": event.get("ref").cloned().unwrap_or(Value::Null),
                    "toolName": string(event, "toolName"),
                    "input": event.get("input").cloned().unwrap_or_else(|| json!({})),
                    "description": event.get("description").cloned().unwrap_or(Value::Null),
                    "canAllowAlways": event.get("canAllowAlways").and_then(Value::as_bool).unwrap_or(false),
                    "decision": "pending",
                });
                if let Some(always) = event.get("allowAlways") {
                    insert(&mut item, "allowAlways", always.clone());
                }
                output.push(self.upsert(item));
                output.push(self.status("needs-you"));
            }
            "question.requested" => {
                self.close_thinking(&mut output);
                let request_id = string(event, "requestId");
                let mut item = json!({
                    "id": format!("question-{request_id}"),
                    "kind": "question",
                    "createdAt": self.now(),
                    "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null),
                    "requestId": request_id,
                    "questions": event.get("questions").cloned().unwrap_or_else(|| json!([])),
                    "answers": null,
                    "state": "pending",
                });
                if let Some(value) = event.get("async") {
                    insert(&mut item, "async", value.clone());
                }
                output.push(self.upsert(item));
                output.push(self.status("needs-you"));
            }
            "request.withdrawn" => self.withdraw(string(event, "requestId"), &mut output),
            "usage" => {
                let mut usage = self.info.get("usage").cloned().unwrap_or_else(|| json!({}));
                for key in ["contextTokens", "contextWindow"] {
                    if event.get(key).is_some_and(|value| !value.is_null()) {
                        insert(&mut usage, key, event[key].clone());
                    }
                }
                output.push(self.patch_info(Map::from_iter([("usage".to_owned(), usage)])));
            }
            "compaction" => {
                let id_time = self.now();
                let created_at = self.now();
                let pre_tokens = event
                    .get("preTokens")
                    .cloned()
                    .filter(|value| !value.is_null())
                    .unwrap_or_else(|| {
                        let tokens = self
                            .info
                            .pointer("/usage/contextTokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        if tokens > 0 {
                            json!(tokens)
                        } else {
                            Value::Null
                        }
                    });
                output.push(self.upsert(json!({
                    "id": format!("compaction-{id_time}"), "kind": "compaction", "createdAt": created_at,
                    "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null), "preTokens": pre_tokens,
                })));
            }
            "task.started" => self.patch_subagent_start(generation, event, &mut output),
            "task.progress" => self.patch_subagent_progress(generation, event, &mut output),
            "task.done" => self.task_done(generation, event, &mut output),
            "note" => {
                let level = string(event, "level");
                let text = string(event, "text");
                output.push(self.note(level, text));
            }
            "turn.done" => self.finish_turn(event, &mut output),
            "failed" => {
                output.push(self.note("error", string(event, "message")));
                self.settle_open(&mut output, true);
                self.close_turn("error", 0.0, None, &mut output);
                output.push(self.patch_info(Map::from_iter([
                    ("status".to_owned(), json!("error")),
                    ("activeTurnId".to_owned(), Value::Null),
                ])));
            }
            "exit" => {
                self.finish_process(event.get("exitCode").and_then(Value::as_i64), &mut output)
            }
            _ => {}
        }
        output
    }

    pub fn project_at(&mut self, generation: u64, event: &Value, at: u64) -> Vec<Value> {
        self.fixed_time = Some(at);
        let output = self.project(generation, event);
        self.fixed_time = None;
        output
    }

    fn now(&mut self) -> u64 {
        if let Some(now) = self.fixed_time {
            return now;
        }
        let now = self.next_time;
        self.next_time += 1;
        now
    }

    fn active_turn(&self) -> Option<&str> {
        self.info.get("activeTurnId").and_then(Value::as_str)
    }

    fn get(&self, id: &str) -> Option<&Value> {
        self.indices
            .get(id)
            .and_then(|index| self.items.get(*index))
    }

    fn upsert(&mut self, item: Value) -> Value {
        let id = string(&item, "id").to_owned();
        let index = if let Some(index) = self.indices.get(&id).copied() {
            self.items[index] = item.clone();
            index
        } else {
            let index = self.items.len();
            self.items.push(item.clone());
            self.indices.insert(id, index);
            index
        };
        json!({ "type": "item", "item": item, "historyIndex": index })
    }

    fn patch_info(&mut self, patch: Map<String, Value>) -> Value {
        self.info.as_object_mut().unwrap().extend(patch);
        json!({ "type": "info", "info": self.info })
    }

    fn status(&mut self, status: &str) -> Value {
        self.patch_info(Map::from_iter([("status".to_owned(), json!(status))]))
    }

    fn append_text(&mut self, id: &str, text: &str) -> Option<Value> {
        let index = *self.indices.get(id)?;
        let item = &mut self.items[index];
        match item.get("kind").and_then(Value::as_str) {
            Some("assistant" | "thinking") => {
                let next = format!(
                    "{}{}",
                    item.get("text").and_then(Value::as_str).unwrap_or(""),
                    text
                );
                insert(item, "text", json!(next));
            }
            Some("tool") if item.get("state").and_then(Value::as_str) == Some("running") => {
                if item.get("progress").is_none() {
                    insert(
                        item,
                        "progress",
                        json!({ "startedAt": null, "description": null, "output": null }),
                    );
                }
                let progress = item.get_mut("progress").unwrap();
                let next = format!(
                    "{}{}",
                    progress.get("output").and_then(Value::as_str).unwrap_or(""),
                    text
                );
                insert(progress, "output", json!(next));
            }
            _ => return None,
        }
        Some(json!({ "type": "delta", "itemId": id, "text": text }))
    }

    fn item_id(&self, generation: u64, reference: &str) -> String {
        format!("{generation}:{reference}")
    }

    fn open_agent_turn(&mut self, output: &mut Vec<Value>) {
        let now = self.now();
        let turn_id = format!("turn-{now}-{}", self.suffix);
        let mut turn = json!({
            "id": turn_id, "kind": "turn", "createdAt": now, "turnId": turn_id,
            "state": "running", "origin": "agent", "endedAt": null, "costUsd": 0,
        });
        if let Some(label) = self.task_summary.take().filter(|label| !label.is_empty()) {
            insert(&mut turn, "label", json!(label));
        }
        if let Some(tool) = self.task_tool_use_id.take() {
            insert(&mut turn, "taskToolUseId", json!(tool));
        }
        output.push(self.upsert(turn));
        output.push(self.patch_info(Map::from_iter([
            ("status".to_owned(), json!("running")),
            ("activeTurnId".to_owned(), json!(turn_id)),
        ])));
    }

    fn append_assistant(&mut self, id: &str, text: &str, output: &mut Vec<Value>) {
        if self.get(id).is_none() {
            let now = self.now();
            output.push(self.upsert(json!({
                "id": id, "kind": "assistant", "createdAt": now,
                "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null),
                "text": text, "streaming": true,
            })));
        } else if !text.is_empty()
            && let Some(delta) = self.append_text(id, text)
        {
            output.push(delta);
        }
    }

    fn append_thinking(
        &mut self,
        generation: u64,
        reference: &str,
        text: &str,
        done: bool,
        output: &mut Vec<Value>,
    ) {
        let key = self.item_id(generation, reference);
        if self
            .thinking
            .as_ref()
            .is_some_and(|open| open.refs.contains(&key))
            && done
        {
            return;
        }
        if self.thinking.is_none() && text.trim().is_empty() {
            return;
        }
        if self.thinking.is_none() {
            let id = format!("{key}:think");
            let now = self.now();
            self.thinking = Some(Thinking {
                id: id.clone(),
                refs: HashSet::from([key.clone()]),
                last: Some(key),
            });
            output.push(self.upsert(json!({
                "id": id, "kind": "thinking", "createdAt": now,
                "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null),
                "text": text, "streaming": true, "endedAt": null,
            })));
            return;
        }
        let open = self.thinking.as_mut().unwrap();
        let separator = if open.last.as_deref().is_some_and(|last| last != key) {
            "\n\n"
        } else {
            ""
        };
        open.refs.insert(key.clone());
        open.last = Some(key);
        let id = open.id.clone();
        if let Some(delta) = self.append_text(&id, &format!("{separator}{text}")) {
            output.push(delta);
        }
    }

    fn close_thinking(&mut self, output: &mut Vec<Value>) {
        let Some(open) = self.thinking.take() else {
            return;
        };
        let Some(mut item) = self.get(&open.id).cloned() else {
            return;
        };
        if item.get("kind").and_then(Value::as_str) == Some("thinking")
            && item.get("streaming").and_then(Value::as_bool) == Some(true)
        {
            insert(&mut item, "streaming", json!(false));
            let ended = self.now();
            insert(&mut item, "endedAt", json!(ended));
            output.push(self.upsert(item));
        }
    }

    fn start_tool(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        let reference = string(event, "ref");
        let id = self.item_id(generation, reference);
        let existing = self.get(&id).cloned();
        let created = existing
            .as_ref()
            .and_then(|item| item.get("createdAt"))
            .cloned()
            .unwrap_or_else(|| json!(self.now()));
        let turn = existing
            .as_ref()
            .and_then(|item| item.get("turnId"))
            .cloned()
            .unwrap_or_else(|| {
                self.info
                    .get("activeTurnId")
                    .cloned()
                    .unwrap_or(Value::Null)
            });
        let mut item = json!({
            "id": id, "kind": "tool", "createdAt": created, "turnId": turn,
            "toolUseId": reference, "name": string(event, "name"),
            "input": event.get("input").cloned().unwrap_or_else(|| json!({})),
            "output": existing.as_ref().and_then(|item| item.get("output")).cloned().unwrap_or(Value::Null),
            "state": existing.as_ref().and_then(|item| item.get("state")).cloned().unwrap_or_else(|| json!("running")),
            "parentToolUseId": event.get("parentRef").cloned().unwrap_or(Value::Null),
        });
        for key in ["progress", "changes"] {
            if let Some(value) = event
                .get(key)
                .or_else(|| existing.as_ref().and_then(|item| item.get(key)))
            {
                insert(&mut item, key, value.clone());
            }
        }
        output.push(self.upsert(item));
    }

    fn patch_tool_progress(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        let id = self.item_id(generation, string(event, "ref"));
        let Some(mut item) = self.get(&id).cloned() else {
            return;
        };
        if item.get("kind").and_then(Value::as_str) != Some("tool")
            || item.get("state").and_then(Value::as_str) != Some("running")
        {
            return;
        }
        let prior = item.get("progress").cloned().unwrap_or_else(|| json!({}));
        let progress = json!({
            "startedAt": event.get("startedAt").cloned().filter(|value| !value.is_null()).or_else(|| prior.get("startedAt").cloned()).unwrap_or(Value::Null),
            "description": event.get("description").cloned().filter(|value| !value.is_null()).or_else(|| prior.get("description").cloned()).unwrap_or(Value::Null),
            "output": prior.get("output").cloned().unwrap_or(Value::Null),
        });
        insert(&mut item, "progress", progress);
        output.push(self.upsert(item));
    }

    fn settle_tool(&mut self, id: &str, event: &Value, output: &mut Vec<Value>) {
        let Some(mut item) = self.get(id).cloned() else {
            return;
        };
        if item.get("kind").and_then(Value::as_str) != Some("tool") {
            return;
        }
        if event.get("output").is_some_and(|value| !value.is_null()) {
            insert(&mut item, "output", event["output"].clone());
        }
        insert(
            &mut item,
            "state",
            event.get("state").cloned().unwrap_or_else(|| json!("done")),
        );
        item.as_object_mut().unwrap().remove("progress");
        if let Some(changes) = event.get("changes") {
            insert(&mut item, "changes", changes.clone());
        }
        output.push(self.upsert(item));
    }

    fn start_subagent(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        let reference = string(event, "ref");
        let id = self.item_id(generation, reference);
        let previous = self.get(&id).cloned();
        let input = event.get("input").cloned().unwrap_or_else(|| json!({}));
        let now = previous
            .as_ref()
            .and_then(|item| item.get("createdAt"))
            .and_then(Value::as_u64)
            .unwrap_or_else(|| self.now());
        output.push(self.upsert(json!({
            "id": id, "kind": "subagent", "createdAt": now,
            "turnId": previous.as_ref().and_then(|item| item.get("turnId")).cloned().unwrap_or_else(|| self.info.get("activeTurnId").cloned().unwrap_or(Value::Null)),
            "toolUseId": reference,
            "description": previous.as_ref().and_then(|item| item.get("description")).and_then(Value::as_str).filter(|text| !text.is_empty()).or_else(|| input.get("description").and_then(Value::as_str)).unwrap_or(""),
            "subagentType": previous.as_ref().and_then(|item| item.get("subagentType")).cloned().unwrap_or_else(|| input.get("subagent_type").cloned().unwrap_or(Value::Null)),
            "prompt": previous.as_ref().and_then(|item| item.get("prompt")).cloned().unwrap_or_else(|| input.get("prompt").cloned().unwrap_or(Value::Null)),
            "background": previous.as_ref().and_then(|item| item.get("background")).and_then(Value::as_bool).unwrap_or_else(|| input.get("run_in_background").and_then(Value::as_bool).unwrap_or(false)),
            "status": previous.as_ref().and_then(|item| item.get("status")).cloned().unwrap_or_else(|| json!("running")),
            "startedAt": previous.as_ref().and_then(|item| item.get("startedAt")).cloned().unwrap_or_else(|| json!(now)),
            "finishedAt": previous.as_ref().and_then(|item| item.get("finishedAt")).cloned().unwrap_or(Value::Null),
            "summary": previous.as_ref().and_then(|item| item.get("summary")).cloned().unwrap_or(Value::Null),
            "result": previous.as_ref().and_then(|item| item.get("result")).cloned().unwrap_or(Value::Null),
            "usage": previous.as_ref().and_then(|item| item.get("usage")).cloned().unwrap_or(Value::Null),
            "lastTool": previous.as_ref().and_then(|item| item.get("lastTool")).cloned().unwrap_or(Value::Null),
            "itemsTruncated": previous.as_ref().and_then(|item| item.get("itemsTruncated")).and_then(Value::as_bool).unwrap_or(false),
        })));
    }

    fn append_subagent_text(
        &mut self,
        generation: u64,
        parent_ref: &str,
        reference: &str,
        text: &str,
        output: &mut Vec<Value>,
    ) {
        let parent_id = self.item_id(generation, parent_ref);
        let Some(parent) = self.get(&parent_id).cloned() else {
            return;
        };
        if parent.get("kind").and_then(Value::as_str) != Some("subagent") {
            return;
        }
        let id = self.item_id(generation, reference);
        let existing = self.get(&id).cloned();
        let created = existing
            .as_ref()
            .and_then(|item| item.get("createdAt"))
            .cloned()
            .unwrap_or_else(|| json!(self.now()));
        output.push(self.upsert(json!({
            "id": id, "kind": "assistant", "createdAt": created,
            "turnId": parent.get("turnId").cloned().unwrap_or(Value::Null), "text": text,
            "streaming": false, "parentToolUseId": parent_ref,
        })));
        if !text.trim().is_empty() {
            let mut next = self.get(&parent_id).cloned().unwrap();
            insert(&mut next, "result", json!(text));
            output.push(self.upsert(next));
        }
    }

    fn settle_subagent(&mut self, id: &str, event: &Value, output: &mut Vec<Value>) {
        let Some(mut item) = self.get(id).cloned() else {
            return;
        };
        let raw = event.get("output").and_then(Value::as_str).unwrap_or("");
        if raw.starts_with("Async agent launched successfully") {
            insert(&mut item, "background", json!(true));
            if let Some(path) = raw
                .split("output_file:")
                .nth(1)
                .map(str::trim)
                .filter(|path| !path.is_empty())
            {
                insert(&mut item, "outputFile", json!(path));
            }
            output.push(self.upsert(item));
            return;
        }
        let (report, usage) = strip_agent_footer(raw);
        insert(
            &mut item,
            "status",
            json!(
                if event.get("state").and_then(Value::as_str) == Some("error") {
                    "failed"
                } else {
                    "done"
                }
            ),
        );
        let finished = self.now();
        insert(&mut item, "finishedAt", json!(finished));
        if let Some(report) = report {
            insert(&mut item, "result", json!(report));
        }
        if let Some(usage) = usage {
            insert(&mut item, "usage", usage);
        }
        output.push(self.upsert(item));
    }

    fn patch_subagent_start(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        let id = self.item_id(generation, string(event, "ref"));
        if self.get(&id).is_none() {
            let synthetic = json!({ "ref": string(event, "ref"), "input": {}, "parentRef": null });
            self.start_subagent(generation, &synthetic, output);
        }
        let Some(mut item) = self.get(&id).cloned() else {
            return;
        };
        for (field, event_field) in [
            ("description", "description"),
            ("subagentType", "subagentType"),
            ("prompt", "prompt"),
        ] {
            let absent = item.get(field).is_none_or(Value::is_null)
                || item.get(field).and_then(Value::as_str) == Some("");
            if absent && event.get(event_field).is_some() {
                insert(&mut item, field, event[event_field].clone());
            }
        }
        insert(
            &mut item,
            "background",
            event.get("background").cloned().unwrap_or(json!(false)),
        );
        if let Some(thread_id) = event.get("threadId") {
            insert(&mut item, "native", json!({ "threadId": thread_id }));
        }
        output.push(self.upsert(item));
    }

    fn patch_subagent_progress(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        let id = self.item_id(generation, string(event, "ref"));
        let Some(mut item) = self.get(&id).cloned() else {
            return;
        };
        if item.get("status").and_then(Value::as_str) != Some("running") {
            return;
        }
        for key in ["summary", "lastTool", "usage"] {
            if event.get(key).is_some_and(|value| !value.is_null()) {
                insert(&mut item, key, event[key].clone());
            }
        }
        output.push(self.upsert(item));
    }

    fn task_done(&mut self, generation: u64, event: &Value, output: &mut Vec<Value>) {
        if let Some(summary) = event.get("summary").and_then(Value::as_str) {
            let line = summary_line(summary);
            if !line.is_empty() {
                self.task_summary = Some(line);
            }
        }
        let Some(reference) = event.get("ref").and_then(Value::as_str) else {
            return;
        };
        let id = self.item_id(generation, reference);
        let Some(mut item) = self.get(&id).cloned() else {
            return;
        };
        self.task_tool_use_id = item
            .get("toolUseId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let full = event
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let line = (!full.is_empty()).then(|| summary_line(full));
        let result = item
            .get("result")
            .cloned()
            .filter(|value| !value.is_null())
            .or_else(|| {
                line.as_ref()
                    .filter(|line| full != line.as_str())
                    .map(|_| json!(full))
            });
        if item.get("status").and_then(Value::as_str) == Some("running") {
            insert(
                &mut item,
                "status",
                json!(if event.get("ok").and_then(Value::as_bool) == Some(true) {
                    "done"
                } else {
                    "failed"
                }),
            );
            let finished = self.now();
            insert(&mut item, "finishedAt", json!(finished));
        }
        if let Some(line) = line {
            insert(&mut item, "summary", json!(line));
        }
        if let Some(result) = result {
            insert(&mut item, "result", result);
        }
        for key in ["usage", "outputFile"] {
            if event.get(key).is_some_and(|value| !value.is_null()) {
                insert(&mut item, key, event[key].clone());
            }
        }
        output.push(self.upsert(item));
    }

    fn withdraw(&mut self, request_id: &str, output: &mut Vec<Value>) {
        for (prefix, kind, field) in [
            ("approval", "approval", "decision"),
            ("question", "question", "state"),
        ] {
            let id = format!("{prefix}-{request_id}");
            let Some(mut item) = self.get(&id).cloned() else {
                continue;
            };
            if item.get("kind").and_then(Value::as_str) == Some(kind)
                && item.get(field).and_then(Value::as_str) == Some("pending")
            {
                insert(&mut item, field, json!("cancelled"));
                output.push(self.upsert(item));
                output.push(self.status("running"));
            }
        }
    }

    fn finish_turn(&mut self, event: &Value, output: &mut Vec<Value>) {
        if let Some(error) = event.get("error").and_then(Value::as_str) {
            output.push(self.note("error", error));
        }
        self.settle_open(output, false);
        self.close_turn(
            event.get("state").and_then(Value::as_str).unwrap_or("done"),
            event.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0),
            event.get("native").cloned(),
            output,
        );
        let mut usage = self.info.get("usage").cloned().unwrap();
        let total = event.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0);
        if total != 0.0 {
            insert(&mut usage, "costUsd", js_number(total));
        }
        let turns = usage.get("turns").and_then(Value::as_u64).unwrap_or(0) + 1;
        insert(&mut usage, "turns", json!(turns));
        output.push(self.patch_info(Map::from_iter([
            ("status".to_owned(), json!("idle")),
            ("activeTurnId".to_owned(), Value::Null),
            ("usage".to_owned(), usage),
        ])));
    }

    fn settle_open(&mut self, output: &mut Vec<Value>, process_gone: bool) {
        self.thinking = None;
        for mut item in self.items.clone() {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let settle = match kind {
                "assistant" if item.get("streaming").and_then(Value::as_bool) == Some(true) => {
                    insert(&mut item, "streaming", json!(false));
                    true
                }
                "thinking" if item.get("streaming").and_then(Value::as_bool) == Some(true) => {
                    insert(&mut item, "streaming", json!(false));
                    let ended = self.now();
                    insert(&mut item, "endedAt", json!(ended));
                    true
                }
                "approval" if item.get("decision").and_then(Value::as_str) == Some("pending") => {
                    insert(&mut item, "decision", json!("cancelled"));
                    true
                }
                "question" if item.get("state").and_then(Value::as_str) == Some("pending") => {
                    insert(&mut item, "state", json!("cancelled"));
                    true
                }
                "tool" if item.get("state").and_then(Value::as_str) == Some("running") => {
                    insert(&mut item, "state", json!("error"));
                    true
                }
                "subagent"
                    if item.get("status").and_then(Value::as_str) == Some("running")
                        && (process_gone
                            || item.get("background").and_then(Value::as_bool) != Some(true)) =>
                {
                    insert(&mut item, "status", json!("failed"));
                    let finished = self.now();
                    insert(&mut item, "finishedAt", json!(finished));
                    true
                }
                _ => false,
            };
            if settle {
                output.push(self.upsert(item));
            }
        }
    }

    fn close_turn(
        &mut self,
        state: &str,
        total_cost: f64,
        native: Option<Value>,
        output: &mut Vec<Value>,
    ) {
        let Some(turn_id) = self.active_turn().map(str::to_owned) else {
            return;
        };
        let Some(mut turn) = self.get(&turn_id).cloned() else {
            return;
        };
        if turn.get("kind").and_then(Value::as_str) != Some("turn") {
            return;
        }
        insert(&mut turn, "state", json!(state));
        let ended = self.now();
        insert(&mut turn, "endedAt", json!(ended));
        let prior = self
            .info
            .pointer("/usage/costUsd")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        insert(
            &mut turn,
            "costUsd",
            js_number((total_cost - prior).max(0.0)),
        );
        if let Some(native) = native {
            insert(&mut turn, "native", native);
        }
        output.push(self.upsert(turn));
    }

    fn finish_process(&mut self, exit_code: Option<i64>, output: &mut Vec<Value>) {
        self.settle_open(output, true);
        let busy = matches!(
            self.info.get("status").and_then(Value::as_str),
            Some("running" | "needs-you")
        );
        if busy || exit_code.is_some_and(|code| code != 0) {
            let text = exit_code
                .map(|code| format!("{} exited with code {code}", self.provider_name))
                .unwrap_or_else(|| format!("{} stopped", self.provider_name));
            output.push(self.note("error", &text));
        }
        self.close_turn(if busy { "error" } else { "done" }, 0.0, None, output);
        output.push(self.patch_info(Map::from_iter([
            ("running".to_owned(), json!(false)),
            (
                "status".to_owned(),
                json!(if busy { "error" } else { "idle" }),
            ),
            ("activeTurnId".to_owned(), Value::Null),
        ])));
    }

    fn note(&mut self, level: &str, text: &str) -> Value {
        let id_time = self.now();
        let created = self.now();
        self.upsert(json!({
            "id": format!("note-{id_time}-{}", self.suffix), "kind": "note", "createdAt": created,
            "turnId": self.info.get("activeTurnId").cloned().unwrap_or(Value::Null), "level": level, "text": text,
        }))
    }
}

fn starts_agent_turn(event: &Value) -> bool {
    match event.get("type").and_then(Value::as_str) {
        Some("text.done") => event.get("parentRef").is_none_or(Value::is_null),
        Some(
            "text.delta" | "thinking.delta" | "thinking.done" | "approval.requested"
            | "question.requested",
        ) => true,
        Some("tool.started") => event.get("parentRef").is_some_and(Value::is_null),
        _ => false,
    }
}

fn summary_line(summary: &str) -> String {
    let text = summary
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.chars().count() <= 80 {
        return text;
    }
    let cut = text.chars().take(80).collect::<String>();
    let place = cut
        .rfind(' ')
        .filter(|place| *place > 40)
        .unwrap_or(cut.len());
    format!("{}...", cut[..place].trim_end())
}

fn strip_agent_footer(output: &str) -> (Option<String>, Option<Value>) {
    let marker = output.rfind("\nagentId:");
    let report = marker
        .map(|index| &output[..index])
        .unwrap_or(output)
        .trim();
    let usage = output
        .find("<usage>")
        .and_then(|start| output.find("</usage>").map(|end| &output[start + 7..end]))
        .map(|block| {
            json!({
                "totalTokens": usage_field(block, "subagent_tokens"),
                "toolUses": usage_field(block, "tool_uses"),
                "durationMs": usage_field(block, "duration_ms"),
            })
        });
    (
        (!report.is_empty() && report != "(Subagent completed but returned no output.)")
            .then(|| report.to_owned()),
        usage,
    )
}

fn usage_field(block: &str, name: &str) -> u64 {
    block
        .lines()
        .find_map(|line| line.trim().strip_prefix(&format!("{name}:")))
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0)
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn insert(value: &mut Value, key: &str, next: Value) {
    value.as_object_mut().unwrap().insert(key.to_owned(), next);
}

fn js_number(value: f64) -> Value {
    if value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_typescript_projector_fixture() {
        let cases: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/chat-projector.json"
        )))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let mut projector = ThreadProjector::fixture(
                case["initialInfo"].clone(),
                case["initialItems"].as_array().unwrap().clone(),
                "Test CLI",
                case["clockStart"].as_u64().unwrap(),
            );
            let generation = case["generation"].as_u64().unwrap();
            for (index, step) in case["steps"].as_array().unwrap().iter().enumerate() {
                let events = projector.project(generation, &step["input"]);
                assert_eq!(
                    Value::Array(events),
                    step["events"],
                    "{} step {index} events",
                    case["name"]
                );
                assert_eq!(
                    projector.info(),
                    &step["info"],
                    "{} step {index} info",
                    case["name"]
                );
                assert_eq!(
                    projector.items(),
                    step["items"].as_array().unwrap(),
                    "{} step {index} items",
                    case["name"]
                );
            }
        }
    }
}
