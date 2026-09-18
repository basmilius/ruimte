use std::process::{Child, Command, Stdio};

use ruimte_server::{
    events::EventBus,
    processes::ProcessesService,
    rpc::{ClientAccess, RequestContext},
    sessions::SessionsService,
};
use serde_json::{Value, json};

fn context(events: &EventBus, client_id: &str) -> RequestContext {
    RequestContext {
        client_id: client_id.into(),
        access: ClientAccess {
            reachability: "loopback".into(),
            session_id: None,
        },
        events: events.clone(),
    }
}

async fn dispatch(
    service: &SessionsService,
    method: &str,
    payload: Value,
    context: &RequestContext,
) -> Value {
    service
        .dispatch(method, payload, context)
        .await
        .expect("session method")
        .expect("successful session request")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real PTY integration"]
async fn shell_output_resize_and_snapshot_restart() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let mut subscription = events.subscribe("viewer");
    let context = context(&events, "viewer");
    let service = SessionsService::new(temporary.path().to_owned(), events.clone())
        .await
        .unwrap();

    dispatch(
        &service,
        "session.create",
        json!({ "sessionId": "terminal", "shell": "/bin/sh", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.attach",
        json!({ "sessionId": "terminal", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.write",
        json!({ "sessionId": "terminal", "data": "stty -echo; printf '%s%s\\n' 'echo-' 'off'\n" }),
        &context,
    )
    .await;

    let mut output = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut output = String::new();
        while !output.contains("echo-off") {
            let event = subscription.recv_value().await.expect("session event");
            if event["event"] == "session.output" {
                output.push_str(event["payload"]["data"].as_str().unwrap());
            }
        }
        output
    })
    .await
    .expect("shell setup timeout");
    dispatch(
        &service,
        "session.resize",
        json!({ "sessionId": "terminal", "cols": 52, "rows": 11 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.write",
        json!({ "sessionId": "terminal", "data": "printf '%s' 'ready-'; printf '%b\\n' '\\347\\225\\214'; printf '%s' 'size-'; stty size; printf '%s%s\\n' 'last-' 'line'; exit\n" }),
        &context,
    )
    .await;

    let saw_exit = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut saw_exit = false;
        while !saw_exit {
            let event = subscription.recv_value().await.expect("session event");
            if event["event"] == "session.output" {
                output.push_str(event["payload"]["data"].as_str().unwrap());
            } else if event["event"] == "session.exit" {
                assert!(
                    output.contains("last-line"),
                    "exit arrived before trailing output"
                );
                saw_exit = true;
            }
        }
        saw_exit
    })
    .await
    .expect("shell output timeout");
    assert_eq!(output.matches("ready-界").count(), 1, "{output:?}");
    assert!(output.contains("size-11 52"), "{output:?}");
    assert!(saw_exit);
    let attached = dispatch(
        &service,
        "session.attach",
        json!({ "sessionId": "terminal", "follow": true }),
        &context,
    )
    .await;
    assert_eq!(
        (attached["cols"].as_u64(), attached["rows"].as_u64()),
        (Some(52), Some(11))
    );

    service.shutdown().await;
    let restarted = SessionsService::new(temporary.path().to_owned(), events.clone())
        .await
        .unwrap();
    dispatch(
        &restarted,
        "session.create",
        json!({ "sessionId": "terminal", "shell": "/bin/sh", "cols": 52, "rows": 11 }),
        &context,
    )
    .await;
    let restored = dispatch(
        &restarted,
        "session.attach",
        json!({ "sessionId": "terminal", "follow": true }),
        &context,
    )
    .await;
    let restored_screen = restored["screen"].as_str().unwrap();
    assert!(restored_screen.contains("ready-"));
    assert!(restored_screen.contains('界'));
    assert!(
        restored["screen"]
            .as_str()
            .unwrap()
            .contains("session restored")
    );
    restarted.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real PTY integration"]
async fn blocked_pty_writer_does_not_block_kill_or_shutdown() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let mut subscription = events.subscribe("viewer");
    let context = context(&events, "viewer");
    let service = SessionsService::new(temporary.path().to_owned(), events)
        .await
        .unwrap();
    dispatch(
        &service,
        "session.create",
        json!({ "sessionId": "blocked", "shell": "/bin/sh", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.attach",
        json!({ "sessionId": "blocked", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.write",
        json!({ "sessionId": "blocked", "data": "stty raw -echo; printf '%s%s\\n' 'stopped-' 'soon'; trap '' HUP; kill -STOP $$\n" }),
        &context,
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut output = String::new();
        while !output.contains("stopped-soon") {
            let event = subscription.recv_value().await.expect("session event");
            if event["event"] == "session.output" {
                output.push_str(event["payload"]["data"].as_str().unwrap());
            }
        }
    })
    .await
    .expect("stopped shell marker timeout");

    let writing_service = service.clone();
    let writing_context = context.clone();
    let write = tokio::spawn(async move {
        writing_service
            .dispatch(
                "session.write",
                json!({ "sessionId": "blocked", "data": "x".repeat(4 * 1024 * 1024) }),
                &writing_context,
            )
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!write.is_finished());

    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        service.dispatch("session.kill", json!({ "sessionId": "blocked" }), &context),
    )
    .await
    .expect("kill was blocked by PTY writer")
    .unwrap()
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(4), service.shutdown())
        .await
        .expect("shutdown did not escalate a blocked shell");
    tokio::time::timeout(std::time::Duration::from_secs(1), write)
        .await
        .expect("blocked write did not settle after shell exit")
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real PTY integration"]
async fn shutdown_gate_interrupts_an_accepted_blocked_write() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let mut subscription = events.subscribe("viewer");
    let context = context(&events, "viewer");
    let service = SessionsService::new(temporary.path().to_owned(), events)
        .await
        .unwrap();
    dispatch(
        &service,
        "session.create",
        json!({ "sessionId": "draining", "shell": "/bin/sh", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.attach",
        json!({ "sessionId": "draining", "cols": 40, "rows": 8 }),
        &context,
    )
    .await;
    dispatch(
        &service,
        "session.write",
        json!({ "sessionId": "draining", "data": "stty raw -echo; printf '%s%s\\n' 'drain-' 'ready'; trap '' HUP; kill -STOP $$\n" }),
        &context,
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut output = String::new();
        while !output.contains("drain-ready") {
            let event = subscription.recv_value().await.expect("session event");
            if event["event"] == "session.output" {
                output.push_str(event["payload"]["data"].as_str().unwrap());
            }
        }
    })
    .await
    .expect("stopped shell marker timeout");

    let writing_service = service.clone();
    let writing_context = context.clone();
    let write = tokio::spawn(async move {
        writing_service
            .dispatch(
                "session.write",
                json!({ "sessionId": "draining", "data": "x".repeat(4 * 1024 * 1024) }),
                &writing_context,
            )
            .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!write.is_finished());

    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        service.begin_shutdown(),
    )
    .await
    .expect("shutdown gate was blocked by the PTY writer");
    let error = service
        .dispatch(
            "session.create",
            json!({ "sessionId": "too-late", "shell": "/bin/sh", "cols": 40, "rows": 8 }),
            &context,
        )
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, "daemon-shutting-down");
    tokio::time::timeout(std::time::Duration::from_secs(4), write)
        .await
        .expect("accepted write did not settle after shutdown cancellation")
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), service.shutdown())
        .await
        .expect("final snapshot shutdown did not settle");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real PTY integration"]
async fn shutdown_gate_catches_a_create_blocked_on_its_initial_write() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let context = context(&events, "viewer");
    let service = SessionsService::new(temporary.path().to_owned(), events)
        .await
        .unwrap();
    let creating_service = service.clone();
    let creating_context = context.clone();
    let create = tokio::spawn(async move {
        creating_service
            .dispatch(
                "session.create",
                json!({
                    "sessionId": "creating",
                    "shell": "/bin/sh",
                    "cols": 40,
                    "rows": 8,
                    "command": format!(
                        "stty raw -echo; printf '\\r\\033[2K%s%s\\r\\n' 'create-' 'admitted'; trap '' HUP; kill -STOP $$\n#{}",
                        "x".repeat(4 * 1024 * 1024)
                    ),
                }),
                &creating_context,
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if service
                .screen("creating")
                .await
                .is_some_and(|screen| screen.contains("create-admitted"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("create admission marker timeout");
    assert!(!create.is_finished());

    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        service.begin_shutdown(),
    )
    .await
    .expect("shutdown did not find the actor registered during create");
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(4), create)
        .await
        .expect("create did not settle after its PTY was cancelled")
        .unwrap()
        .expect("session.create method was not handled");
    if let Err(error) = outcome {
        assert!(
            error.code == "internal" || error.code == "daemon-shutting-down",
            "unexpected cancellation error: {error:?}"
        );
    }
    tokio::time::timeout(std::time::Duration::from_secs(2), service.shutdown())
        .await
        .expect("final shutdown did not settle");
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real process-table integration"]
async fn process_signal_rechecks_pid_identity() {
    let temporary = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let context = context(&events, "viewer");
    let service = ProcessesService::new(temporary.path().to_owned(), events)
        .await
        .unwrap();
    let mut child = ChildGuard(
        Command::new("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );

    let subscribed = service
        .dispatch(
            "processes.subscribe",
            json!({ "scope": "all", "sort": "cpu" }),
            &context,
        )
        .await
        .unwrap()
        .unwrap();
    let rows = subscribed["sample"]["groups"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|group| group["processes"].as_array().unwrap())
        .collect::<Vec<_>>();
    let row = rows
        .into_iter()
        .find(|row| row["pid"].as_u64() == Some(child.0.id() as u64))
        .expect("sleep process in sample");
    let start_time = row["startTime"].as_u64().unwrap();

    let stale = service
        .dispatch(
            "processes.signal",
            json!({ "pid": child.0.id(), "startTime": start_time + 1, "signal": "SIGTERM" }),
            &context,
        )
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(stale.code, "process-gone");
    assert!(child.0.try_wait().unwrap().is_none());

    service
        .dispatch(
            "processes.signal",
            json!({ "pid": child.0.id(), "startTime": start_time, "signal": "SIGTERM" }),
            &context,
        )
        .await
        .unwrap()
        .unwrap();
    tokio::task::spawn_blocking(move || child.0.wait())
        .await
        .unwrap()
        .unwrap();
    service.shutdown().await;
}
