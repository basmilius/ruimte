use std::collections::HashMap;

use serde_json::{Value, json};

pub struct BackendOutput {
    pub events: Vec<Value>,
    pub ready: bool,
}

pub struct BackendNormalizer {
    provider: String,
    generation: u64,
    claude: ClaudeState,
    codex_turn_id: Option<String>,
    codex_pending: HashMap<String, CodexPending>,
    codex_tool_inputs: HashMap<String, (Value, Vec<Value>)>,
}

#[derive(Default)]
struct ClaudeState {
    stream_message_id: Option<String>,
    stream_text_count: u64,
    stream_thinking_count: u64,
    stream_blocks: HashMap<u64, (String, &'static str)>,
    frame_text_count: HashMap<String, u64>,
    frame_thinking_count: HashMap<String, u64>,
    model: Option<String>,
    last_uuid: Option<String>,
    pending: HashMap<String, ClaudePending>,
}

enum ClaudePending {
    Approval {
        tool_use_id: Option<String>,
        input: Value,
        suggestions: Vec<Value>,
    },
    Question {
        tool_use_id: Option<String>,
        input: Value,
        questions: Vec<Value>,
    },
}

enum CodexPending {
    Approval {
        rpc_id: Value,
        kind: &'static str,
        amendment: Option<Vec<String>>,
        decisions: Vec<String>,
    },
    Question {
        rpc_id: Option<Value>,
        question_ids: Vec<String>,
    },
}

impl BackendNormalizer {
    pub fn new(provider: &str) -> Self {
        Self::with_generation(provider, 0)
    }

    pub fn with_generation(provider: &str, generation: u64) -> Self {
        Self {
            provider: provider.to_owned(),
            generation,
            claude: ClaudeState::default(),
            codex_turn_id: None,
            codex_pending: HashMap::new(),
            codex_tool_inputs: HashMap::new(),
        }
    }

    pub fn handle(&mut self, frame: &Value) -> BackendOutput {
        self.handle_at(frame, now())
    }

    pub(crate) fn handle_at(&mut self, frame: &Value, at: u64) -> BackendOutput {
        if self.provider == "claude" {
            BackendOutput {
                events: self.handle_claude(frame, at),
                ready: false,
            }
        } else {
            self.handle_codex(frame)
        }
    }

    pub fn claude_approval_response(
        &mut self,
        request_id: &str,
        decision: &str,
        message: Option<&str>,
    ) -> Option<Value> {
        if !matches!(
            self.claude.pending.get(request_id),
            Some(ClaudePending::Approval { .. })
        ) {
            return None;
        }
        let ClaudePending::Approval {
            tool_use_id,
            input,
            suggestions,
        } = self.claude.pending.remove(request_id)?
        else {
            return None;
        };
        let response = if decision == "deny" {
            json!({
                "behavior": "deny",
                "message": message.filter(|text| !text.trim().is_empty()).unwrap_or("The user declined this action"),
                "toolUseID": tool_use_id,
            })
        } else {
            let mut response = json!({
                "behavior": "allow",
                "updatedInput": input,
                "toolUseID": tool_use_id,
            });
            if decision == "allow-always" && !suggestions.is_empty() {
                response["updatedPermissions"] = Value::Array(suggestions);
            }
            response
        };
        Some(json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request_id, "response": response },
        }))
    }

    pub fn claude_question_response(
        &mut self,
        request_id: &str,
        answers: &serde_json::Map<String, Value>,
    ) -> Option<Value> {
        if !matches!(
            self.claude.pending.get(request_id),
            Some(ClaudePending::Question { .. })
        ) {
            return None;
        }
        let ClaudePending::Question {
            tool_use_id,
            input,
            questions,
        } = self.claude.pending.remove(request_id)?
        else {
            return None;
        };
        let mut by_text = serde_json::Map::new();
        for question in questions {
            let Some(id) = question.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(prompt) = question.get("question").and_then(Value::as_str) else {
                continue;
            };
            if let Some(answer) = answers.get(id).and_then(Value::as_str) {
                by_text.insert(prompt.to_owned(), json!(answer));
            }
        }
        let mut updated = input.as_object().cloned().unwrap_or_default();
        updated.insert("answers".into(), Value::Object(by_text));
        Some(json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": { "behavior": "allow", "updatedInput": updated, "toolUseID": tool_use_id },
            },
        }))
    }

    fn handle_claude(&mut self, frame: &Value, at: u64) -> Vec<Value> {
        let mut events = Vec::new();
        match string(frame, "type") {
            "system" => self.claude_system(frame, &mut events),
            "stream_event" => self.claude_stream(frame, &mut events),
            "assistant" => self.claude_assistant(frame, &mut events),
            "user" => self.claude_user(frame, &mut events),
            "result" => self.claude_result(frame, &mut events),
            "control_request" => self.claude_request(frame, &mut events),
            "control_cancel_request" => {
                if let Some(request_id) = frame.get("request_id").and_then(Value::as_str) {
                    self.claude.pending.remove(request_id);
                    events.push(json!({ "type": "request.withdrawn", "requestId": request_id }));
                }
            }
            "tool_progress" => {
                let reference = frame.get("tool_use_id").and_then(Value::as_str);
                let elapsed = frame.get("elapsed_time_seconds").and_then(Value::as_f64);
                if let (Some(reference), Some(elapsed)) = (reference, elapsed)
                    && elapsed.is_finite()
                    && elapsed >= 0.0
                {
                    let started_at = at.saturating_sub((elapsed * 1000.0).round() as u64);
                    events.push(json!({
                        "type": "tool.progress", "ref": reference,
                        "startedAt": started_at, "description": null,
                    }));
                }
            }
            "rate_limit_event" => {
                if let Some(update) = claude_limits(frame.get("rate_limit_info")) {
                    events.push(json!({ "type": "limits", "update": update }));
                }
            }
            _ => {}
        }
        events
    }

    fn claude_system(&mut self, frame: &Value, events: &mut Vec<Value>) {
        match string(frame, "subtype") {
            "init" => {
                self.claude.model = frame
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| self.claude.model.take());
                events.push(json!({
                    "type": "session",
                    "agentSessionId": frame.get("session_id").cloned().unwrap_or(Value::Null),
                    "model": frame.get("model").cloned().unwrap_or(Value::Null),
                    "slashCommands": strings(frame.get("slash_commands")),
                    "skills": strings(frame.get("skills")),
                }));
            }
            "compact_boundary" => {
                let tokens = frame
                    .pointer("/compact_metadata/pre_tokens")
                    .and_then(Value::as_u64)
                    .filter(|tokens| *tokens > 0);
                events.push(json!({ "type": "compaction", "preTokens": tokens }));
            }
            "task_started" => {
                let Some(reference) = frame.get("tool_use_id").and_then(Value::as_str) else {
                    return;
                };
                if string(frame, "task_type") == "local_agent" {
                    events.push(json!({
                        "type": "task.started", "ref": reference,
                        "description": frame.get("description").cloned().unwrap_or(Value::Null),
                        "subagentType": frame.get("subagent_type").cloned().unwrap_or(Value::Null),
                        "prompt": frame.get("prompt").cloned().unwrap_or(Value::Null),
                        "background": frame.get("is_backgrounded").and_then(Value::as_bool).unwrap_or(false),
                    }));
                } else if let Some(description) = frame.get("description").and_then(Value::as_str) {
                    events.push(json!({
                        "type": "tool.progress", "ref": reference,
                        "startedAt": null, "description": description,
                    }));
                }
            }
            "task_progress" => {
                let Some(reference) = frame.get("tool_use_id").and_then(Value::as_str) else {
                    return;
                };
                if string(frame, "task_type") == "local_agent"
                    || frame.get("subagent_type").and_then(Value::as_str).is_some()
                {
                    events.push(json!({
                        "type": "task.progress", "ref": reference,
                        "summary": frame.get("description").cloned().unwrap_or(Value::Null),
                        "lastTool": frame.get("last_tool_name").cloned().unwrap_or(Value::Null),
                        "usage": task_usage(frame.get("usage")),
                    }));
                } else if let Some(description) = frame.get("description").and_then(Value::as_str) {
                    events.push(json!({
                        "type": "tool.progress", "ref": reference,
                        "startedAt": null, "description": description,
                    }));
                }
            }
            "task_notification" => {
                let output_file = frame
                    .get("output_file")
                    .and_then(Value::as_str)
                    .filter(|path| !path.is_empty());
                events.push(json!({
                    "type": "task.done",
                    "ref": frame.get("tool_use_id").and_then(Value::as_str),
                    "summary": frame.get("summary").and_then(Value::as_str),
                    "ok": string(frame, "status") == "completed",
                    "usage": task_usage(frame.get("usage")),
                    "outputFile": output_file,
                }));
            }
            _ => {}
        }
    }

    fn claude_stream(&mut self, frame: &Value, events: &mut Vec<Value>) {
        if frame
            .get("parent_tool_use_id")
            .and_then(Value::as_str)
            .is_some()
        {
            return;
        }
        let event = frame.get("event").unwrap_or(&Value::Null);
        match string(event, "type") {
            "message_start" => {
                self.claude.stream_message_id = event
                    .pointer("/message/id")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                self.claude.stream_text_count = 0;
                self.claude.stream_thinking_count = 0;
                self.claude.stream_blocks.clear();
            }
            "content_block_start" => {
                let Some(message_id) = self.claude.stream_message_id.as_deref() else {
                    return;
                };
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
                match event.pointer("/content_block/type").and_then(Value::as_str) {
                    Some("text") => {
                        let reference = format!("{message_id}:t{}", self.claude.stream_text_count);
                        self.claude.stream_text_count += 1;
                        self.claude
                            .stream_blocks
                            .insert(index, (reference.clone(), "text.delta"));
                        events.push(json!({
                            "type": "text.delta", "ref": reference,
                            "text": event.pointer("/content_block/text").and_then(Value::as_str).unwrap_or(""),
                        }));
                    }
                    Some("thinking") => {
                        let reference =
                            format!("{message_id}:k{}", self.claude.stream_thinking_count);
                        self.claude.stream_thinking_count += 1;
                        self.claude
                            .stream_blocks
                            .insert(index, (reference.clone(), "thinking.delta"));
                        events.push(json!({
                            "type": "thinking.delta", "ref": reference,
                            "text": event.pointer("/content_block/thinking").and_then(Value::as_str).unwrap_or(""),
                        }));
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
                let Some((reference, event_type)) = self.claude.stream_blocks.get(&index) else {
                    return;
                };
                let text = event
                    .pointer("/delta/text")
                    .or_else(|| event.pointer("/delta/thinking"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if !text.is_empty() {
                    events.push(json!({ "type": event_type, "ref": reference, "text": text }));
                }
            }
            _ => {}
        }
    }

    fn claude_assistant(&mut self, frame: &Value, events: &mut Vec<Value>) {
        let message = frame.get("message").unwrap_or(&Value::Null);
        let message_id = message
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("message")
            .to_owned();
        let parent = frame.get("parent_tool_use_id").and_then(Value::as_str);
        if parent.is_none()
            && let Some(uuid) = frame.get("uuid").and_then(Value::as_str)
        {
            self.claude.last_uuid = Some(uuid.to_owned());
        }
        for block in message
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            match string(block, "type") {
                "text" => {
                    let ordinal = self
                        .claude
                        .frame_text_count
                        .entry(message_id.clone())
                        .or_default();
                    let reference = format!("{message_id}:t{ordinal}");
                    *ordinal += 1;
                    let mut event = json!({
                        "type": "text.done", "ref": reference,
                        "text": block.get("text").and_then(Value::as_str).unwrap_or(""),
                    });
                    if let Some(parent) = parent {
                        event["parentRef"] = json!(parent);
                    }
                    events.push(event);
                }
                "thinking" if parent.is_none() => {
                    let ordinal = self
                        .claude
                        .frame_thinking_count
                        .entry(message_id.clone())
                        .or_default();
                    let reference = format!("{message_id}:k{ordinal}");
                    *ordinal += 1;
                    events.push(json!({
                        "type": "thinking.done", "ref": reference,
                        "text": block.get("thinking").and_then(Value::as_str).unwrap_or(""),
                    }));
                }
                "tool_use" => events.push(json!({
                    "type": "tool.started",
                    "ref": block.get("id").and_then(Value::as_str).unwrap_or("tool"),
                    "name": block.get("name").and_then(Value::as_str).unwrap_or("tool"),
                    "input": block.get("input").cloned().unwrap_or_else(|| json!({})),
                    "parentRef": parent,
                })),
                _ => {}
            }
        }
        if parent.is_none() {
            let tokens = [
                "input_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
            ]
            .iter()
            .filter_map(|key| {
                message
                    .pointer(&format!("/usage/{key}"))
                    .and_then(Value::as_u64)
            })
            .sum::<u64>();
            if tokens > 0 {
                events.push(json!({ "type": "usage", "contextTokens": tokens }));
            }
        }
        if let Some(error) = frame.get("error").and_then(Value::as_str) {
            events.push(json!({
                "type": "note", "level": "error",
                "text": format!("The request failed: {}", error.replace('_', " ")),
            }));
        }
    }

    fn claude_user(&mut self, frame: &Value, events: &mut Vec<Value>) {
        for block in frame
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if string(block, "type") != "tool_result" {
                continue;
            }
            let Some(reference) = block.get("tool_use_id").and_then(Value::as_str) else {
                continue;
            };
            events.push(json!({
                "type": "tool.done", "ref": reference,
                "output": text_content(block.get("content")),
                "state": if block.get("is_error").and_then(Value::as_bool) == Some(true) { "error" } else { "done" },
            }));
        }
    }

    fn claude_result(&mut self, frame: &Value, events: &mut Vec<Value>) {
        let context_window = self
            .claude
            .model
            .as_deref()
            .and_then(|model| frame.pointer("/modelUsage")?.get(model))
            .and_then(|usage| usage.get("contextWindow"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if context_window > 0 {
            events.push(json!({ "type": "usage", "contextWindow": context_window }));
        }
        let failed = frame.get("is_error").and_then(Value::as_bool) == Some(true)
            || string(frame, "subtype").starts_with("error");
        let error = frame
            .get("errors")
            .and_then(Value::as_array)
            .and_then(|errors| errors.iter().find_map(Value::as_str))
            .map(str::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "The turn ended with {}",
                    frame
                        .get("subtype")
                        .and_then(Value::as_str)
                        .unwrap_or("an error")
                )
            });
        let mut event = json!({
            "type": "turn.done",
            "state": if failed { "error" } else { "done" },
            "costUsd": frame.get("total_cost_usd").filter(|value| value.is_number()).cloned().unwrap_or_else(|| json!(0)),
        });
        if failed {
            event["error"] = json!(error);
        }
        if let Some(last_uuid) = self.claude.last_uuid.take() {
            event["native"] = json!({ "lastUuid": last_uuid });
        }
        events.push(event);
    }

    fn claude_request(&mut self, frame: &Value, events: &mut Vec<Value>) {
        let Some(request_id) = frame.get("request_id").and_then(Value::as_str) else {
            return;
        };
        let request = frame.get("request").unwrap_or(&Value::Null);
        if string(request, "subtype") != "can_use_tool" {
            return;
        }
        if string(request, "tool_name") == "AskUserQuestion" {
            let questions = contract_questions(request.pointer("/input/questions"));
            if !questions.is_empty() {
                self.claude.pending.insert(
                    request_id.to_owned(),
                    ClaudePending::Question {
                        tool_use_id: request
                            .get("tool_use_id")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        input: request.get("input").cloned().unwrap_or_else(|| json!({})),
                        questions: questions.clone(),
                    },
                );
                events.push(json!({
                    "type": "question.requested", "requestId": request_id,
                    "questions": questions,
                }));
            }
        } else {
            let suggestions = request
                .get("permission_suggestions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            self.claude.pending.insert(
                request_id.to_owned(),
                ClaudePending::Approval {
                    tool_use_id: request
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    input: request.get("input").cloned().unwrap_or_else(|| json!({})),
                    suggestions: suggestions.clone(),
                },
            );
            let mut event = json!({
                "type": "approval.requested", "requestId": request_id,
                "ref": request.get("tool_use_id").and_then(Value::as_str),
                "toolName": request.get("tool_name").and_then(Value::as_str).unwrap_or("tool"),
                "input": request.get("input").cloned().unwrap_or_else(|| json!({})),
                "description": request.get("description").and_then(Value::as_str),
                "canAllowAlways": !suggestions.is_empty(),
            });
            if !suggestions.is_empty() {
                event["allowAlways"] = json!({
                    "label": "Allow with these rules",
                    "description": permission_suggestions_description(&suggestions),
                });
            }
            events.push(event);
        }
    }

    fn handle_codex(&mut self, frame: &Value) -> BackendOutput {
        let mut events = Vec::new();
        let mut ready = false;
        if frame.get("method").and_then(Value::as_str).is_some()
            && frame
                .get("id")
                .is_some_and(|id| id.is_number() || id.is_string())
        {
            self.codex_server_request(frame, &mut events);
            return BackendOutput { events, ready };
        }
        if frame.get("id").and_then(Value::as_u64) == Some(2) {
            if let Some(result) = frame.get("result") {
                events.extend(self.codex_thread_ready(result));
                ready = true;
            } else if let Some(error) = frame.pointer("/error/message").and_then(Value::as_str) {
                events.push(json!({ "type": "failed", "message": error }));
            }
            return BackendOutput { events, ready };
        }
        let params = frame.get("params").unwrap_or(&Value::Null);
        match string(frame, "method") {
            "thread/started" => events.push(json!({
                "type": "session",
                "agentSessionId": params.pointer("/thread/id").and_then(Value::as_str),
                "model": null,
            })),
            "thread/name/updated" => {
                if let Some(title) = clean_title(params.get("threadName")) {
                    events.push(json!({ "type": "title", "title": title }));
                }
            }
            "turn/started" => {
                self.codex_turn_id = params
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            "item/started" | "item/completed" => {
                let completed = string(frame, "method") == "item/completed";
                self.codex_item(params.get("item").unwrap_or(&Value::Null), completed, &mut events);
            }
            "item/agentMessage/delta" => {
                if let (Some(reference), Some(text)) = (
                    params.get("itemId").and_then(Value::as_str),
                    params.get("delta").and_then(Value::as_str),
                ) {
                    events.push(json!({ "type": "text.delta", "ref": reference, "text": text }));
                }
            }
            "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                if let (Some(reference), Some(text)) = (
                    params.get("itemId").and_then(Value::as_str),
                    params.get("delta").and_then(Value::as_str),
                ) {
                    events
                        .push(json!({ "type": "thinking.delta", "ref": reference, "text": text }));
                }
            }
            "item/reasoning/summaryPartAdded" => {
                if let Some(reference) = params.get("itemId").and_then(Value::as_str)
                    && params.get("summaryIndex").and_then(Value::as_u64).unwrap_or(0) > 0
                {
                    events.push(json!({ "type": "thinking.delta", "ref": reference, "text": "\n\n" }));
                }
            }
            "item/commandExecution/outputDelta" => {
                if let Some(reference) = params.get("itemId").and_then(Value::as_str)
                    && let Some(text) = output_chunk(params)
                    && !text.is_empty()
                {
                    events.push(json!({ "type": "tool.output", "ref": reference, "text": text }));
                }
            }
            "thread/tokenUsage/updated" => {
                let tokens = params.pointer("/tokenUsage/last/totalTokens");
                let mut usage = json!({
                    "type": "usage",
                    "contextTokens": tokens.and_then(Value::as_u64).unwrap_or(0),
                });
                if let Some(window) = params.pointer("/tokenUsage/modelContextWindow").and_then(Value::as_u64).filter(|window| *window > 0) {
                    usage["contextWindow"] = json!(window);
                }
                events.push(usage);
            }
            "serverRequest/resolved" => {
                if let Some(rpc_id) = params.get("requestId").filter(|id| id.is_number() || id.is_string()) {
                    let request_id = self.codex_request_id(rpc_id);
                    self.codex_pending.remove(&request_id);
                    events.push(json!({ "type": "request.withdrawn", "requestId": request_id }));
                }
            }
            "error" => events.push(json!({
                "type": "note",
                "level": if params.get("willRetry").and_then(Value::as_bool) == Some(true) { "warning" } else { "error" },
                "text": params.pointer("/error/message").and_then(Value::as_str).unwrap_or("Codex reported an error"),
            })),
            "model/rerouted" => {
                if let Some(model) = params.get("toModel").and_then(Value::as_str) {
                    events.push(json!({ "type": "model", "model": model }));
                }
            }
            "account/rateLimits/updated" => {
                if let Some(update) = codex_limits(params.get("rateLimits").unwrap_or(params)) {
                    events.push(json!({ "type": "limits", "update": update }));
                }
            }
            "turn/completed" => {
                let status = params
                    .pointer("/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed");
                let mut event = json!({
                    "type": "turn.done",
                    "state": match status { "interrupted" => "aborted", "failed" => "error", _ => "done" },
                    "costUsd": 0,
                });
                if let Some(error) = params
                    .pointer("/turn/error/message")
                    .and_then(Value::as_str)
                {
                    event["error"] = json!(error);
                }
                let turn_id = params.pointer("/turn/id").and_then(Value::as_str).map(str::to_owned).or_else(|| self.codex_turn_id.take());
                self.codex_pending.clear();
                if let Some(turn_id) = turn_id {
                    event["native"] = json!({ "turnId": turn_id });
                }
                events.push(event);
            }
            _ => {}
        }
        BackendOutput { events, ready }
    }

    pub fn codex_thread_ready(&self, result: &Value) -> Vec<Value> {
        let thread = result.get("thread").unwrap_or(&Value::Null);
        vec![json!({
            "type": "session",
            "agentSessionId": thread.get("id").and_then(Value::as_str),
            "model": result.get("model").and_then(Value::as_str).or_else(|| thread.get("model").and_then(Value::as_str)),
            "title": clean_title(thread.get("name")),
        })]
    }

    fn codex_request_id(&self, rpc_id: &Value) -> String {
        let id = rpc_id
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| rpc_id.to_string());
        format!("{}-{id}", self.generation)
    }

    fn codex_server_request(&mut self, frame: &Value, events: &mut Vec<Value>) {
        let method = string(frame, "method");
        let rpc_id = frame.get("id").cloned().unwrap_or(Value::Null);
        let request_id = self.codex_request_id(&rpc_id);
        let params = frame.get("params").unwrap_or(&Value::Null);
        if method == "item/tool/requestUserInput" || method == "thread/requestUserInput" {
            if self
                .codex_pending
                .values()
                .any(|pending| matches!(pending, CodexPending::Question { .. }))
            {
                return;
            }
            let questions = blocking_questions(params.get("questions"));
            if questions.is_empty() {
                return;
            }
            let question_ids = questions
                .iter()
                .filter_map(|question| {
                    question
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect();
            self.codex_pending.insert(
                request_id.clone(),
                CodexPending::Question {
                    rpc_id: Some(rpc_id),
                    question_ids,
                },
            );
            events.push(json!({
                "type": "question.requested", "requestId": request_id, "questions": questions,
            }));
            return;
        }
        let kind = match method {
            "item/commandExecution/requestApproval" => "command",
            "item/fileChange/requestApproval" => "fileChange",
            _ => return,
        };
        let item_id = params.get("itemId").and_then(Value::as_str);
        let known = item_id.and_then(|id| self.codex_tool_inputs.get(id));
        let decisions = strings(params.get("availableDecisions"));
        let amendment = strings(params.get("proposedExecpolicyAmendment"));
        let amendment = (!amendment.is_empty()).then_some(amendment);
        let input = if kind == "command" {
            let mut input = serde_json::Map::new();
            input.insert(
                "command".into(),
                json!(unwrap_command(
                    params.get("command").and_then(Value::as_str).unwrap_or("")
                )),
            );
            if let Some(cwd) = params.get("cwd").and_then(Value::as_str) {
                input.insert("cwd".into(), json!(cwd));
            }
            Value::Object(input)
        } else if let Some((input, changes)) = known {
            let mut input = input.as_object().cloned().unwrap_or_default();
            input.insert("changes".into(), Value::Array(changes.clone()));
            Value::Object(input)
        } else {
            json!({ "itemId": item_id, "changes": [] })
        };
        let can_always =
            amendment.is_some() || decisions.iter().any(|value| value == "acceptForSession");
        self.codex_pending.insert(
            request_id.clone(),
            CodexPending::Approval {
                rpc_id,
                kind,
                amendment: amendment.clone(),
                decisions: decisions.clone(),
            },
        );
        let mut event = json!({
            "type": "approval.requested", "requestId": request_id, "ref": item_id,
            "toolName": if kind == "command" { "Bash" } else { "ApplyPatch" },
            "input": input, "description": params.get("reason").and_then(Value::as_str),
            "canAllowAlways": can_always,
        });
        if let Some(amendment) = amendment {
            event["allowAlways"] = json!({
                "label": "Allow this command prefix",
                "description": format!("Allow future commands matching this prefix: {}", serde_json::to_string(&amendment).unwrap()),
            });
        } else if can_always {
            event["allowAlways"] = json!({
                "label": "Allow for this session",
                "description": "Allow this provider permission for the rest of the session.",
            });
        }
        events.push(event);
    }

    fn codex_item(&mut self, item: &Value, completed: bool, events: &mut Vec<Value>) {
        let Some(reference) = item.get("id").and_then(Value::as_str) else {
            return;
        };
        match string(item, "type") {
            "agentMessage" => {
                let questions = async_questions(item.get("questions"));
                if !questions.is_empty() {
                    if !completed || self.codex_pending.contains_key(reference) {
                        return;
                    }
                    let question_ids = questions
                        .iter()
                        .filter_map(|question| {
                            question
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_owned)
                        })
                        .collect();
                    self.codex_pending.insert(
                        reference.to_owned(),
                        CodexPending::Question {
                            rpc_id: None,
                            question_ids,
                        },
                    );
                    events.push(json!({
                        "type": "question.requested", "requestId": reference,
                        "questions": questions, "async": true,
                    }));
                } else {
                    events.push(json!({
                        "type": if completed { "text.done" } else { "text.delta" },
                        "ref": reference,
                        "text": item.get("text").and_then(Value::as_str).unwrap_or(""),
                    }));
                }
            }
            "plan" => events.push(json!({
                "type": if completed { "text.done" } else { "text.delta" },
                "ref": format!("plan-{reference}"),
                "text": item.get("text").and_then(Value::as_str).unwrap_or(""),
            })),
            "reasoning" => {
                let text = [item.get("summary"), item.get("content")]
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_array)
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(|line| !line.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                if completed && !text.is_empty() {
                    events.push(json!({ "type": "thinking.done", "ref": reference, "text": text }));
                }
            }
            "commandExecution" => {
                let mut input = serde_json::Map::new();
                input.insert(
                    "command".into(),
                    json!(unwrap_command(
                        item.get("command").and_then(Value::as_str).unwrap_or("")
                    )),
                );
                if let Some(cwd) = item.get("cwd").and_then(Value::as_str) {
                    input.insert("cwd".into(), json!(cwd));
                }
                self.codex_tool(
                    reference,
                    "Bash",
                    Value::Object(input),
                    completed,
                    item.get("aggregatedOutput")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    string(item, "status") == "completed",
                    Vec::new(),
                    events,
                );
            }
            "fileChange" => {
                let changes = normalize_changes(item.get("changes"));
                let summary = changes
                    .iter()
                    .filter_map(|change| change.get("path").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ");
                let output = changes
                    .iter()
                    .filter_map(|change| change.get("diff").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.codex_tool(
                    reference,
                    "ApplyPatch",
                    json!({ "summary": summary }),
                    completed,
                    &output,
                    string(item, "status") == "completed",
                    changes,
                    events,
                );
            }
            "collabAgentToolCall" => self.codex_collab(reference, item, completed, events),
            "contextCompaction" if completed => {
                events.push(json!({ "type": "compaction", "preTokens": null }));
            }
            _ => {}
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn codex_tool(
        &mut self,
        reference: &str,
        name: &str,
        input: Value,
        completed: bool,
        output: &str,
        succeeded: bool,
        changes: Vec<Value>,
        events: &mut Vec<Value>,
    ) {
        self.codex_tool_inputs
            .insert(reference.to_owned(), (input.clone(), changes.clone()));
        let mut started = json!({
            "type": "tool.started", "ref": reference, "name": name,
            "input": input, "parentRef": null,
        });
        if !changes.is_empty() {
            started["changes"] = Value::Array(changes.clone());
        }
        events.push(started);
        if completed {
            let mut done = json!({
                "type": "tool.done", "ref": reference, "output": output,
                "state": if succeeded { "done" } else { "error" },
            });
            if !changes.is_empty() {
                done["changes"] = Value::Array(changes);
            }
            events.push(done);
        }
    }

    fn codex_collab(
        &mut self,
        reference: &str,
        item: &Value,
        completed: bool,
        events: &mut Vec<Value>,
    ) {
        let tool = item
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("collabAgent");
        let input = json!({
            "tool": tool,
            "prompt": item.get("prompt").and_then(Value::as_str),
            "model": item.get("model").and_then(Value::as_str),
            "threads": item.get("receiverThreadIds").cloned().unwrap_or_else(|| json!([])),
        });
        if tool != "spawnAgent" {
            let output = collab_output(item.get("agentsStates"));
            self.codex_tool(
                reference,
                tool,
                input,
                completed,
                &output,
                string(item, "status") == "completed",
                Vec::new(),
                events,
            );
            return;
        }
        events.push(json!({ "type": "tool.started", "ref": reference, "name": "Agent", "input": input, "parentRef": null }));
        let prompt = item.get("prompt").and_then(Value::as_str);
        let mut started = json!({
            "type": "task.started", "ref": reference,
            "description": prompt.unwrap_or("").lines().next().unwrap_or(""),
            "subagentType": null, "prompt": prompt, "background": true,
        });
        if let Some(thread_id) = item.pointer("/receiverThreadIds/0").and_then(Value::as_str) {
            started["threadId"] = json!(thread_id);
        }
        events.push(started);
        let summary = collab_output(item.get("agentsStates"));
        if !completed
            || matches!(
                item.get("status").and_then(Value::as_str),
                None | Some("inProgress")
            )
        {
            events.push(json!({
                "type": "task.progress", "ref": reference,
                "summary": (!summary.is_empty()).then_some(summary), "lastTool": null, "usage": null,
            }));
        } else {
            events.push(json!({
                "type": "task.done", "ref": reference,
                "summary": (!summary.is_empty()).then_some(summary),
                "ok": string(item, "status") == "completed",
            }));
        }
    }

    pub fn codex_approval_decision(&mut self, request_id: &str, decision: &str) -> Option<Value> {
        if !matches!(
            self.codex_pending.get(request_id),
            Some(CodexPending::Approval { .. })
        ) {
            return None;
        }
        let CodexPending::Approval {
            rpc_id,
            kind,
            amendment,
            decisions,
        } = self.codex_pending.remove(request_id)?
        else {
            unreachable!();
        };
        let decision = match decision {
            "deny" => json!("decline"),
            "allow" => json!("accept"),
            _ if amendment.is_some() => json!({
                "acceptWithExecpolicyAmendment": { "execpolicy_amendment": amendment.unwrap() },
            }),
            _ if kind == "fileChange"
                || decisions.iter().any(|value| value == "acceptForSession") =>
            {
                json!("acceptForSession")
            }
            _ => json!("accept"),
        };
        Some(json!({ "rpcId": rpc_id, "result": { "decision": decision } }))
    }

    pub fn codex_question_answer(
        &mut self,
        request_id: &str,
        answers: &serde_json::Map<String, Value>,
    ) -> Option<Value> {
        if !matches!(
            self.codex_pending.get(request_id),
            Some(CodexPending::Question { .. })
        ) {
            return None;
        }
        let CodexPending::Question {
            rpc_id,
            question_ids,
        } = self.codex_pending.remove(request_id)?
        else {
            unreachable!();
        };
        if let Some(rpc_id) = rpc_id {
            let by_id = question_ids
                .into_iter()
                .filter_map(|id| {
                    answers
                        .get(&id)
                        .and_then(Value::as_str)
                        .map(|answer| (id, json!({ "answers": [answer] })))
                })
                .collect::<serde_json::Map<_, _>>();
            Some(json!({ "kind": "respond", "rpcId": rpc_id, "result": { "answers": by_id } }))
        } else {
            let text = question_ids
                .iter()
                .filter_map(|id| answers.get(id).and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            Some(json!({ "kind": "steer", "text": text }))
        }
    }

    pub fn codex_dismiss_question(&mut self, request_id: &str) -> bool {
        let dismissible = matches!(
            self.codex_pending.get(request_id),
            Some(CodexPending::Question { rpc_id: None, .. })
        );
        if dismissible {
            self.codex_pending.remove(request_id);
        }
        dismissible
    }

    pub fn codex_turn_id(&self) -> Option<&str> {
        self.codex_turn_id.as_deref()
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn permission_suggestions_description(suggestions: &[Value]) -> String {
    fn write(value: &Value, depth: usize, output: &mut String) {
        match value {
            Value::Array(values) if values.is_empty() => output.push_str("[]"),
            Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    output.push('\n');
                    output.push_str(&"  ".repeat(depth + 1));
                    write(value, depth + 1, output);
                    if index + 1 < values.len() {
                        output.push(',');
                    }
                }
                output.push('\n');
                output.push_str(&"  ".repeat(depth));
                output.push(']');
            }
            Value::Object(values) if values.is_empty() => output.push_str("{}"),
            Value::Object(values) => {
                const ORDER: [&str; 4] = ["type", "rules", "toolName", "ruleContent"];
                let mut keys = ORDER
                    .iter()
                    .copied()
                    .filter(|key| values.contains_key(*key))
                    .chain(
                        values
                            .keys()
                            .map(String::as_str)
                            .filter(|key| !ORDER.contains(key)),
                    )
                    .peekable();
                output.push('{');
                while let Some(key) = keys.next() {
                    output.push('\n');
                    output.push_str(&"  ".repeat(depth + 1));
                    output.push_str(&serde_json::to_string(key).unwrap());
                    output.push_str(": ");
                    write(&values[key], depth + 1, output);
                    if keys.peek().is_some() {
                        output.push(',');
                    }
                }
                output.push('\n');
                output.push_str(&"  ".repeat(depth));
                output.push('}');
            }
            _ => output.push_str(&serde_json::to_string(value).unwrap()),
        }
    }

    let mut output = String::new();
    write(&Value::Array(suggestions.to_vec()), 0, &mut output);
    output
}

fn clean_title(value: Option<&Value>) -> Option<String> {
    let title = value?.as_str()?;
    let cleaned = title.split_whitespace().collect::<Vec<_>>().join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

fn unwrap_command(command: &str) -> String {
    let Some((shell, inner)) = command.split_once(" -lc ") else {
        return command.to_owned();
    };
    if !matches!(shell.rsplit('/').next(), Some("zsh" | "bash" | "sh")) {
        return command.to_owned();
    }
    let bytes = inner.as_bytes();
    if bytes.len() >= 2 && matches!(bytes[0], b'\'' | b'"') && bytes[0] == bytes[bytes.len() - 1] {
        inner[1..inner.len() - 1].to_owned()
    } else {
        inner.to_owned()
    }
}

fn output_chunk(params: &Value) -> Option<String> {
    if let Some(text) = params
        .get("delta")
        .or_else(|| params.get("chunk"))
        .and_then(Value::as_str)
    {
        return Some(text.to_owned());
    }
    let bytes = params
        .get("chunk")
        .or_else(|| params.get("delta"))?
        .as_array()?
        .iter()
        .filter_map(Value::as_u64)
        .map(|byte| byte as u8)
        .collect::<Vec<_>>();
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn blocking_questions(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, question)| {
            question.as_object()?;
            Some(json!({
                "id": question.get("id").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| index.to_string()),
                "header": question.get("header").and_then(Value::as_str).unwrap_or(""),
                "question": question.get("question").and_then(Value::as_str).unwrap_or(""),
                "choices": question.get("options").and_then(Value::as_array).into_iter().flatten().filter_map(|option| {
                    option.as_object()?;
                    Some(json!({
                        "label": option.get("label").and_then(Value::as_str).unwrap_or(""),
                        "description": option.get("description").and_then(Value::as_str).unwrap_or(""),
                    }))
                }).collect::<Vec<_>>(),
                "multiSelect": false,
            }))
        })
        .collect()
}

fn async_questions(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, question)| {
            question.as_object()?;
            Some(json!({
                "id": index.to_string(), "header": "",
                "question": question.get("title").and_then(Value::as_str).unwrap_or(""),
                "choices": question.get("options").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(|option| json!({ "label": option, "description": "" })).collect::<Vec<_>>(),
                "multiSelect": false,
            }))
        })
        .collect()
}

fn normalize_changes(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|change| {
            change.as_object()?;
            let kind = change
                .pointer("/kind/type")
                .or_else(|| change.get("kind"))
                .and_then(Value::as_str)
                .filter(|kind| matches!(*kind, "add" | "update" | "delete"))
                .unwrap_or("update");
            Some(json!({
                "path": change.get("path").and_then(Value::as_str).unwrap_or(""),
                "kind": kind,
                "diff": change.get("diff").and_then(Value::as_str).unwrap_or(""),
            }))
        })
        .collect()
}

fn collab_output(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|states| states.iter())
        .map(|(thread, state)| {
            let status = state
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            match state.get("message").and_then(Value::as_str) {
                Some(message) => format!("{thread}: {status}, {message}"),
                None => format!("{thread}: {status}"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn claude_limits(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    let kind = value.get("rateLimitType")?.as_str()?;
    let used = value.get("utilization")?.as_f64()?.clamp(0.0, 1.0);
    let known = match kind {
        "five_hour" => Some(("Session", "session", 18_000_000u64)),
        "seven_day" => Some(("Weekly", "weekly", 604_800_000)),
        "seven_day_opus" => Some(("Weekly · Opus", "weekly", 604_800_000)),
        "seven_day_sonnet" => Some(("Weekly · Sonnet", "weekly", 604_800_000)),
        _ => None,
    };
    let mut window = json!({ "id": kind, "used": used });
    if let Some((label, window_kind, duration)) = known {
        window["label"] = json!(label);
        window["kind"] = json!(window_kind);
        window["durationMs"] = json!(duration);
    }
    if let Some(reset) = value.get("resetsAt").and_then(Value::as_f64) {
        window["resetsAt"] = json!((reset * 1000.0).round() as u64);
    }
    Some(json!({ "kind": "claude", "windows": [window] }))
}

fn codex_limits(value: &Value) -> Option<Value> {
    if value
        .get("limitId")
        .and_then(Value::as_str)
        .is_some_and(|id| id != "codex")
    {
        return None;
    }
    let mut windows = Vec::new();
    for position in ["primary", "secondary"] {
        let Some(window) = value.get(position) else {
            continue;
        };
        let Some(percent) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        let duration = window
            .get("windowDurationMins")
            .and_then(Value::as_f64)
            .map(|minutes| (minutes * 60_000.0).round() as u64);
        let kind = match duration {
            Some(duration) if duration >= 2_592_000_000 => "monthly",
            Some(duration) if duration >= 604_800_000 => "weekly",
            Some(_) => "session",
            None => "other",
        };
        let label = match kind {
            "monthly" => "Monthly",
            "weekly" => "Weekly",
            "session" => "Session",
            _ => "Usage",
        };
        windows.push(json!({
            "id": position, "kind": kind, "label": label,
            "used": (percent / 100.0).clamp(0.0, 1.0),
            "resetsAt": window.get("resetsAt").and_then(Value::as_f64).map(|reset| (reset * 1000.0).round() as u64),
            "durationMs": duration,
        }));
    }
    (!windows.is_empty()).then(|| json!({
        "kind": "codex", "plan": value.get("planType").and_then(Value::as_str), "windows": windows,
    }))
}

fn text_content(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if let Some(text) = value.as_str() {
        return text.to_owned();
    }
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn contract_questions(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, question)| {
            let prompt = question.get("question").and_then(Value::as_str)?;
            let choices = question
                .get("options")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|option| {
                    json!({
                        "label": option.get("label").and_then(Value::as_str).unwrap_or_default(),
                        "description": option.get("description").and_then(Value::as_str).unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>();
            Some(json!({
                "id": index.to_string(),
                "header": question.get("header").and_then(Value::as_str).unwrap_or_default(),
                "question": prompt,
                "choices": choices,
                "multiSelect": question.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
            }))
        })
        .collect()
}

fn task_usage(value: Option<&Value>) -> Value {
    let Some(value) = value.filter(|value| value.is_object()) else {
        return Value::Null;
    };
    json!({
        "totalTokens": value.get("total_tokens").and_then(Value::as_u64).unwrap_or(0),
        "toolUses": value.get("tool_uses").and_then(Value::as_u64).unwrap_or(0),
        "durationMs": value.get("duration_ms").and_then(Value::as_u64).unwrap_or(0),
    })
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_frames_match_typescript_protocol_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/chat-protocol.json"
        )))
        .unwrap();
        for (scenario_index, scenario) in
            fixture["scenarios"].as_array().unwrap().iter().enumerate()
        {
            let provider = scenario["provider"].as_str().unwrap();
            let generation = scenario["generation"].as_u64().unwrap_or(0);
            let mut backend = BackendNormalizer::with_generation(provider, generation);
            for (step_index, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
                let args = step["args"].as_array().unwrap();
                let actual = match step["method"].as_str().unwrap() {
                    "handle" => Value::Array(
                        backend
                            .handle_at(&args[0], step["now"].as_u64().unwrap())
                            .events,
                    ),
                    "threadReady" => Value::Array(backend.codex_thread_ready(&args[0])),
                    "approvalResponse" => backend
                        .claude_approval_response(
                            args[0].as_str().unwrap(),
                            args[1].as_str().unwrap(),
                            args.get(2).and_then(Value::as_str),
                        )
                        .unwrap_or(Value::Null),
                    "questionResponse" => backend
                        .claude_question_response(
                            args[0].as_str().unwrap(),
                            args[1].as_object().unwrap(),
                        )
                        .unwrap_or(Value::Null),
                    "approvalDecision" => backend
                        .codex_approval_decision(
                            args[0].as_str().unwrap(),
                            args[1].as_str().unwrap(),
                        )
                        .unwrap_or(Value::Null),
                    "questionAnswer" => backend
                        .codex_question_answer(
                            args[0].as_str().unwrap(),
                            args[1].as_object().unwrap(),
                        )
                        .unwrap_or(Value::Null),
                    "dismissQuestion" => {
                        Value::Bool(backend.codex_dismiss_question(args[0].as_str().unwrap()))
                    }
                    method => panic!("unknown protocol fixture method {method}"),
                };
                assert_eq!(
                    actual, step["result"],
                    "scenario {scenario_index} step {step_index}"
                );
            }
        }
    }
}
