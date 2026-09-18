use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

use ruimte_server::{
    chat::{ChatConfig, ChatService},
    events::{EventBus, EventSubscription},
    rpc::{ClientAccess, RequestContext},
};
use serde_json::{Value, json};

fn context(events: &EventBus) -> RequestContext {
    RequestContext {
        client_id: "client".to_owned(),
        access: ClientAccess {
            reachability: "loopback".to_owned(),
            session_id: None,
        },
        events: events.clone(),
    }
}

fn fake(name: &str) -> Vec<String> {
    vec![
        "bun".to_owned(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/providers")
            .join(name)
            .to_string_lossy()
            .into_owned(),
    ]
}

async fn request(
    service: &ChatService,
    method: &str,
    payload: Value,
    context: &RequestContext,
) -> Value {
    service
        .dispatch(method, payload, context)
        .await
        .unwrap_or_else(|| panic!("{method} was not handled"))
        .unwrap_or_else(|error| panic!("{method} failed: {error}"))
}

async fn wait_until_idle(subscription: &mut EventSubscription, chat_id: &str) -> Vec<Value> {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut transcript = Vec::new();
        loop {
            let frame = subscription.recv_value().await.unwrap();
            transcript.push(frame.clone());
            if frame.pointer("/payload/chatId").and_then(Value::as_str) == Some(chat_id)
                && frame.pointer("/payload/event/type").and_then(Value::as_str) == Some("info")
                && frame
                    .pointer("/payload/event/info/status")
                    .and_then(Value::as_str)
                    == Some("idle")
                && frame
                    .pointer("/payload/event/info/activeTurnId")
                    .is_some_and(Value::is_null)
            {
                return transcript;
            }
        }
    })
    .await
    .expect("the fake CLI turn should finish")
}

async fn wait_for_item(
    subscription: &mut EventSubscription,
    chat_id: &str,
    kind: &str,
) -> (Value, Vec<Value>) {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut transcript = Vec::new();
        loop {
            let frame = subscription.recv_value().await.unwrap();
            transcript.push(frame.clone());
            let item = frame.pointer("/payload/event/item");
            if frame.pointer("/payload/chatId").and_then(Value::as_str) == Some(chat_id)
                && item
                    .and_then(|item| item.get("kind"))
                    .and_then(Value::as_str)
                    == Some(kind)
                && (kind != "approval"
                    || item
                        .and_then(|item| item.get("decision"))
                        .and_then(Value::as_str)
                        == Some("pending"))
                && (kind != "question"
                    || item
                        .and_then(|item| item.get("state"))
                        .and_then(Value::as_str)
                        == Some("pending"))
            {
                return (item.unwrap().clone(), transcript);
            }
        }
    })
    .await
    .expect("the requested chat item should arrive")
}

async fn wait_for_assistant_text(
    subscription: &mut EventSubscription,
    chat_id: &str,
    expected: &str,
) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let frame = subscription.recv_value().await.unwrap();
            if frame.pointer("/payload/chatId").and_then(Value::as_str) == Some(chat_id)
                && frame
                    .pointer("/payload/event/item/kind")
                    .and_then(Value::as_str)
                    == Some("assistant")
                && frame
                    .pointer("/payload/event/item/text")
                    .and_then(Value::as_str)
                    == Some(expected)
            {
                return;
            }
        }
    })
    .await
    .expect("the configured provider should answer");
}

fn validate_contract(value: &Value) {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let script = r#"
        import {
            ChatAttachResultSchema,
            ChatEventEnvelopeSchema,
            ChatInfoSchema,
            ChatSendResultSchema,
        } from './packages/contracts/src/index.ts';
        const input = JSON.parse(await Bun.stdin.text());
        const checks = [
            ['create', ChatInfoSchema, input.create],
            ['send', ChatSendResultSchema, input.send],
            ['attach', ChatAttachResultSchema, input.attach],
            ...input.events.map((event, index) => [`event ${index}`, ChatEventEnvelopeSchema, event]),
        ];
        for (const [name, schema, candidate] of checks) {
            const result = schema.safeParse(candidate);
            if (!result.success) {
                console.error(`${name}: ${JSON.stringify(result.error.issues)}`);
                process.exit(1);
            }
        }
    "#;
    let mut child = Command::new("bun")
        .args(["-e", script])
        .current_dir(repository)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(value).unwrap().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "contract validation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn exercise(provider: &str, expected: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::new(512);
    let mut subscription = events.subscribe("client");
    let mut environment = HashMap::new();
    environment.insert("PATH".to_owned(), std::env::var("PATH").unwrap_or_default());
    environment.insert(
        "HOME".to_owned(),
        temporary.path().to_string_lossy().into_owned(),
    );
    let config = ChatConfig::default()
        .with_command("claude", fake("fake-claude.ts"))
        .with_command("codex", fake("fake-codex.ts"))
        .with_environment(environment);
    let service = ChatService::new_with_config(
        temporary.path().to_path_buf(),
        events.clone(),
        config.clone(),
    )
    .await
    .unwrap();
    let request_context = context(&events);

    let created = request(
        &service,
        "chat.create",
        json!({ "chatId": format!("chat-{provider}"), "provider": provider, "cwd": temporary.path() }),
        &request_context,
    )
    .await;
    request(
        &service,
        "chat.attach",
        json!({ "chatId": format!("chat-{provider}") }),
        &request_context,
    )
    .await;
    let sent = request(
        &service,
        "chat.send",
        json!({ "chatId": format!("chat-{provider}"), "text": "hello there" }),
        &request_context,
    )
    .await;
    assert_eq!(sent["queued"], false);
    assert!(sent.get("turnId").is_some());
    let frames = wait_until_idle(&mut subscription, &format!("chat-{provider}")).await;

    let attached = request(
        &service,
        "chat.attach",
        json!({ "chatId": format!("chat-{provider}") }),
        &request_context,
    )
    .await;
    let answers = attached["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "assistant")
        .filter_map(|item| item["text"].as_str())
        .collect::<Vec<_>>();
    assert_eq!(answers, [expected]);
    assert!(attached["seq"].as_u64().unwrap() > 0);
    let transcript = json!({
        "create": created,
        "send": sent,
        "attach": attached,
        "events": frames.into_iter().map(|frame| frame["payload"].clone()).collect::<Vec<_>>(),
    });
    std::fs::write(
        temporary.path().join(format!("{provider}-wire.json")),
        serde_json::to_vec_pretty(&transcript).unwrap(),
    )
    .unwrap();
    validate_contract(&transcript);
    service.shutdown().await;

    let snapshot = std::fs::read_to_string(
        temporary
            .path()
            .join("chats")
            .join(format!("chat-{provider}.json")),
    )
    .unwrap();
    let snapshot: Value = serde_json::from_str(&snapshot).unwrap();
    assert_eq!(snapshot["seq"], attached["seq"]);
    let log = std::fs::read_to_string(
        temporary
            .path()
            .join("chats")
            .join(format!("chat-{provider}.log")),
    )
    .unwrap();
    let sequences = log
        .lines()
        .map(|line| {
            serde_json::from_str::<Value>(line).unwrap()["seq"]
                .as_u64()
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert!(sequences.windows(2).all(|pair| pair[1] == pair[0] + 1));

    let restarted_events = EventBus::new(512);
    let restarted = ChatService::new_with_config(
        temporary.path().to_path_buf(),
        restarted_events.clone(),
        config,
    )
    .await
    .unwrap();
    let restarted_context = context(&restarted_events);
    request(
        &restarted,
        "chat.create",
        json!({ "chatId": format!("chat-{provider}") }),
        &restarted_context,
    )
    .await;
    let restored = request(
        &restarted,
        "chat.attach",
        json!({ "chatId": format!("chat-{provider}") }),
        &restarted_context,
    )
    .await;
    assert_eq!(restored["seq"], attached["seq"]);
    assert!(
        restored["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "assistant" && item["text"] == expected)
    );
    restarted.shutdown().await;
}

#[tokio::test]
#[ignore = "requires Bun and the real fake Claude child process"]
async fn claude_fake_cli_turn_is_streamed_and_durable() {
    exercise("claude", "echo: hello there").await;
}

#[tokio::test]
#[ignore = "requires Bun and the real fake Codex app-server child process"]
async fn codex_fake_cli_turn_is_streamed_and_durable() {
    exercise("codex", "echo: hello there (medium)").await;
}

#[tokio::test]
#[ignore = "requires Bun and the real fake Claude and Codex child processes"]
async fn configure_restarts_provider_and_resumes_the_same_session() {
    for (provider, model, effort, expected) in [
        ("claude", "opus", "max", "echo: second"),
        ("codex", "sol", "xhigh", "echo: second (xhigh)"),
    ] {
        let temporary = tempfile::tempdir().unwrap();
        let events = EventBus::new(512);
        let mut subscription = events.subscribe("client");
        let service = ChatService::new_with_config(
            temporary.path().to_path_buf(),
            events.clone(),
            ChatConfig::default()
                .with_command("claude", fake("fake-claude.ts"))
                .with_command("codex", fake("fake-codex.ts"))
                .with_environment(HashMap::from([
                    ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
                    (
                        "HOME".to_owned(),
                        temporary.path().to_string_lossy().into_owned(),
                    ),
                ])),
        )
        .await
        .unwrap();
        let request_context = context(&events);
        let chat_id = format!("configure-{provider}");
        request(
            &service,
            "chat.create",
            json!({ "chatId": chat_id, "provider": provider, "cwd": temporary.path() }),
            &request_context,
        )
        .await;
        request(
            &service,
            "chat.attach",
            json!({ "chatId": chat_id }),
            &request_context,
        )
        .await;
        request(
            &service,
            "chat.send",
            json!({ "chatId": chat_id, "text": "first" }),
            &request_context,
        )
        .await;
        wait_until_idle(&mut subscription, &chat_id).await;
        let first = request(
            &service,
            "chat.attach",
            json!({ "chatId": chat_id }),
            &request_context,
        )
        .await;
        let session_id = first["info"]["agentSessionId"].clone();
        request(
            &service,
            "chat.configure",
            json!({
                "chatId": chat_id,
                "selection": { "model": model, "options": { "effort": effort } },
                "runtimeMode": "supervised",
            }),
            &request_context,
        )
        .await;
        request(
            &service,
            "chat.send",
            json!({ "chatId": chat_id, "text": "second" }),
            &request_context,
        )
        .await;
        wait_for_assistant_text(&mut subscription, &chat_id, expected).await;
        wait_until_idle(&mut subscription, &chat_id).await;
        let second = request(
            &service,
            "chat.attach",
            json!({ "chatId": chat_id }),
            &request_context,
        )
        .await;
        assert_eq!(second["info"]["agentSessionId"], session_id);
        assert_eq!(second["info"]["runtimeMode"], "supervised");
        assert!(
            second["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| { item["kind"] == "assistant" && item["text"] == expected }),
            "{provider} did not emit {expected}: {}",
            second["items"]
        );
        service.shutdown().await;
    }
}

#[tokio::test]
#[ignore = "requires Bun and the real fake Claude child process"]
async fn claude_approval_and_question_round_trip() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::new(512);
    let mut subscription = events.subscribe("client");
    let config = ChatConfig::default()
        .with_command("claude", fake("fake-claude.ts"))
        .with_environment(HashMap::from([
            ("PATH".to_owned(), std::env::var("PATH").unwrap_or_default()),
            (
                "HOME".to_owned(),
                temporary.path().to_string_lossy().into_owned(),
            ),
        ]));
    let service =
        ChatService::new_with_config(temporary.path().to_path_buf(), events.clone(), config)
            .await
            .unwrap();
    let request_context = context(&events);
    let chat_id = "chat-claude-actions";
    let created = request(
        &service,
        "chat.create",
        json!({ "chatId": chat_id, "provider": "claude", "cwd": temporary.path() }),
        &request_context,
    )
    .await;
    request(
        &service,
        "chat.attach",
        json!({ "chatId": chat_id }),
        &request_context,
    )
    .await;

    let sent = request(
        &service,
        "chat.send",
        json!({ "chatId": chat_id, "text": "tool: echo hello" }),
        &request_context,
    )
    .await;
    let (approval, mut frames) = wait_for_item(&mut subscription, chat_id, "approval").await;
    request(
        &service,
        "chat.approve",
        json!({ "chatId": chat_id, "requestId": approval["requestId"], "decision": "allow" }),
        &request_context,
    )
    .await;
    frames.extend(wait_until_idle(&mut subscription, chat_id).await);

    request(
        &service,
        "chat.send",
        json!({ "chatId": chat_id, "text": "ask: Pick a color" }),
        &request_context,
    )
    .await;
    let (question, question_frames) = wait_for_item(&mut subscription, chat_id, "question").await;
    frames.extend(question_frames);
    request(
        &service,
        "chat.answer",
        json!({ "chatId": chat_id, "requestId": question["requestId"], "answers": { "0": "Blue" } }),
        &request_context,
    )
    .await;
    frames.extend(wait_until_idle(&mut subscription, chat_id).await);

    let attached = request(
        &service,
        "chat.attach",
        json!({ "chatId": chat_id }),
        &request_context,
    )
    .await;
    assert!(
        attached["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "tool"
                && item["state"] == "done"
                && item["output"] == "ran: echo hello")
    );
    assert!(
        attached["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "assistant" && item["text"] == "you chose Blue")
    );
    validate_contract(&json!({
        "create": created,
        "send": sent,
        "attach": attached,
        "events": frames.into_iter().map(|frame| frame["payload"].clone()).collect::<Vec<_>>(),
    }));
    service.shutdown().await;
}
