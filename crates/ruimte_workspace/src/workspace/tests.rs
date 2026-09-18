use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use async_trait::async_trait;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::{process::Command, sync::Mutex};
use uuid::Uuid;

use crate::{
    events::EventBus,
    rpc::{ClientAccess, RequestContext, RpcError},
    runtime::{
        AgentKind, RuntimeAuthority, RuntimeFactSink, RuntimeHost, RuntimeIdentity, RuntimeMode,
        RuntimeNote, RuntimeOperation, RuntimePreamble, RuntimeStart, RuntimeTarget,
        RuntimeTargetKind, RuntimeVersion, RuntimeView, RuntimeWake,
    },
};

use super::WorkspaceService;

#[derive(Default)]
struct HeadlessRuntime {
    calls: Mutex<Vec<String>>,
    views: Mutex<HashMap<String, RuntimeView>>,
    fail_stop_once: AtomicBool,
}

impl HeadlessRuntime {
    fn view(target: &RuntimeTarget) -> RuntimeView {
        RuntimeView {
            identity: RuntimeIdentity {
                node_id: target.id.clone(),
                target: target.clone(),
                provider: Some(AgentKind::Codex),
                mode: RuntimeMode::Auto,
                generation: 1,
            },
            version: RuntimeVersion {
                epoch: Uuid::nil(),
                revision: 1,
            },
            process_generation: Some(1),
            chat_seq: Some(1),
            info: json!({ "running": false, "activeTurnId": null }),
            text: None,
            items: Vec::new(),
        }
    }

    async fn record(&self, call: String) {
        self.calls.lock().await.push(call);
    }
}

#[async_trait]
impl RuntimeHost for HeadlessRuntime {
    async fn resolve_bearer(&self, _token: &str) -> Result<Option<RuntimeIdentity>, RpcError> {
        Ok(None)
    }

    async fn inspect(&self, target: &RuntimeTarget) -> Result<Option<RuntimeView>, RpcError> {
        if let Some(view) = self.views.lock().await.get(&target.id).cloned() {
            return Ok(Some(view));
        }
        Ok((target.id != "deleted-parent").then(|| Self::view(target)))
    }

    async fn start(
        &self,
        operation: RuntimeOperation<RuntimeStart>,
    ) -> Result<RuntimeView, RpcError> {
        let target = operation.input.target.clone();
        self.record(format!("start:{}", target.id)).await;
        Ok(Self::view(&target))
    }

    async fn stop(&self, operation: RuntimeOperation<RuntimeTarget>) -> Result<(), RpcError> {
        self.record(format!("stop:{}", operation.input.id)).await;
        if self.fail_stop_once.swap(false, Ordering::AcqRel) {
            return Err(RpcError::new("stop-failed", "injected stop failure"));
        }
        Ok(())
    }

    async fn wake(
        &self,
        operation: RuntimeOperation<RuntimeWake>,
    ) -> Result<RuntimeView, RpcError> {
        let target = operation.input.target.clone();
        self.record(format!("wake:{}", target.id)).await;
        Ok(Self::view(&target))
    }

    async fn note(
        &self,
        operation: RuntimeOperation<RuntimeNote>,
    ) -> Result<RuntimeView, RpcError> {
        let target = operation.input.target.clone();
        self.record(format!("note:{}", target.id)).await;
        Ok(Self::view(&target))
    }

    async fn preamble(
        &self,
        operation: RuntimeOperation<RuntimePreamble>,
    ) -> Result<RuntimeView, RpcError> {
        Ok(Self::view(&operation.input.target))
    }

    async fn read(
        &self,
        _authority: &RuntimeAuthority,
        target: &RuntimeTarget,
    ) -> Result<Option<RuntimeView>, RpcError> {
        Ok(Some(Self::view(target)))
    }

    async fn read_subagent(
        &self,
        _authority: &RuntimeAuthority,
        _chat: &RuntimeTarget,
        _tool_use_id: &str,
    ) -> Result<Option<Vec<Value>>, RpcError> {
        Ok(None)
    }

    async fn drop_unspoken_fork(&self, fork_id: &str) -> Result<bool, RpcError> {
        self.record(format!("drop-fork:{fork_id}")).await;
        Ok(true)
    }

    async fn screen_notice(&self, target: &RuntimeTarget, text: &str) -> Result<bool, RpcError> {
        self.record(format!("screen:{}:{text}", target.id)).await;
        Ok(true)
    }
}

fn context(events: &EventBus, client_id: &str) -> RequestContext {
    RequestContext {
        client_id: client_id.to_owned(),
        access: ClientAccess {
            reachability: "local".to_owned(),
            session_id: None,
        },
        events: events.clone(),
    }
}

async fn request(
    service: &WorkspaceService,
    method: &str,
    payload: Value,
    context: &RequestContext,
) -> Result<Value, RpcError> {
    service
        .dispatch(method, payload, context)
        .await
        .expect("workspace request")
}

#[tokio::test]
async fn terminal_notices_use_the_screen_or_one_shot_turn_context() {
    let temporary = TempDir::new().unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events)
        .await
        .unwrap();
    let runtime = Arc::new(HeadlessRuntime::default());
    runtime.views.lock().await.insert(
        "shell".to_owned(),
        RuntimeView {
            info: json!({ "exited": false, "agent": null }),
            ..HeadlessRuntime::view(&RuntimeTarget {
                kind: RuntimeTargetKind::Terminal,
                id: "shell".to_owned(),
            })
        },
    );
    runtime.views.lock().await.insert(
        "claude".to_owned(),
        RuntimeView {
            info: json!({ "exited": false, "agent": { "kind": "claude", "live": true } }),
            ..HeadlessRuntime::view(&RuntimeTarget {
                kind: RuntimeTargetKind::Terminal,
                id: "claude".to_owned(),
            })
        },
    );
    service.install_runtime_host(runtime.clone());

    let immediate = service
        .inner
        .context
        .deliver_terminal_notice("shell", "hello")
        .await
        .unwrap();
    assert!(matches!(
        immediate,
        super::context::TerminalNoticeDelivery::Immediate(_)
    ));
    let waiting = service
        .inner
        .context
        .deliver_terminal_notice("claude", "later")
        .await
        .unwrap();
    assert!(matches!(
        waiting,
        super::context::TerminalNoticeDelivery::WaitingAgent
    ));
    assert_eq!(
        runtime.calls.lock().await.as_slice(),
        ["screen:shell:hello"]
    );

    service
        .inner
        .workflow
        .notices()
        .put(json!({
            "projectId": "project",
            "targetId": "claude",
            "from": "source",
            "fromTitle": "Source",
            "text": "the build is green"
        }))
        .await
        .unwrap();
    let turn = service.take_terminal_turn_context("claude").await.unwrap();
    assert_eq!(turn.notices.len(), 1);
    assert!(turn.notices[0].contains("the build is green"));
    assert!(
        service
            .take_terminal_turn_context("claude")
            .await
            .unwrap()
            .notices
            .is_empty()
    );
    service.shutdown().await;
}

#[tokio::test]
async fn project_revisions_and_unknown_kinds_round_trip() {
    let temporary = TempDir::new().unwrap();
    let home = temporary.path().join("home");
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(home, events.clone()).await.unwrap();
    let client = context(&events, "client-a");

    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &client,
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap().to_owned();
    let mut content = opened["document"].clone();
    content.as_object_mut().unwrap().remove("version");
    content.as_object_mut().unwrap().remove("rev");
    content["views"][0]["nodes"] = json!([{
        "id": "future-node", "kind": "unknown", "title": "Hologram", "x": 24, "y": 0, "w": 320, "h": 200,
        "raw": { "id": "future-node", "kind": "hologram", "title": "Hologram", "beam": { "color": "violet" } }
    }]);
    let saved = request(
        &service,
        "project.save",
        json!({ "projectId": project_id, "baseRev": 0, "content": content }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(saved["rev"], 1);
    let conflict = request(
        &service,
        "project.save",
        json!({ "projectId": project_id, "baseRev": 0, "content": opened["document"] }),
        &client,
    )
    .await
    .unwrap_err();
    assert_eq!(conflict.code, "rev-conflict");

    let disk: Value = serde_json::from_slice(
        &tokio::fs::read(folder.join(".ruimte/project.json"))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(disk["views"][0]["nodes"][0]["kind"], "hologram");
    assert_eq!(disk["views"][0]["nodes"][0]["beam"]["color"], "violet");
    assert_eq!(disk["views"][0]["nodes"][0]["x"], 24);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = tokio::fs::metadata(folder.join(".ruimte/project.json"))
            .await
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o644);
    }

    request(
        &service,
        "project.release",
        json!({ "projectId": project_id }),
        &client,
    )
    .await
    .unwrap();
    let reopened = request(
        &service,
        "project.open",
        json!({ "projectId": project_id }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(
        reopened["document"]["views"][0]["nodes"][0]["kind"],
        "unknown"
    );
    assert_eq!(
        reopened["document"]["views"][0]["nodes"][0]["raw"]["kind"],
        "hologram"
    );
    service.shutdown().await;
}

#[tokio::test]
async fn project_place_changes_owe_child_shutdown_and_prune_removed_agent_state() {
    let temporary = TempDir::new().unwrap();
    let home = temporary.path().join("home");
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(home, events.clone()).await.unwrap();
    let client = context(&events, "client-a");
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &client,
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap().to_owned();
    service
        .mutate_project(&project_id, |content| {
            content["views"][0]["nodes"] = json!([
                { "id": "parent", "kind": "chat", "title": "Parent", "x": 0, "y": 0, "w": 480, "h": 520 },
                { "id": "child", "kind": "chat", "title": "Child", "x": 520, "y": 0, "w": 480, "h": 520 },
                { "id": "fork", "kind": "chat", "title": "Fork", "x": 1040, "y": 0, "w": 480, "h": 520 }
            ]);
            Ok(())
        })
        .await
        .unwrap();
    service
        .inner
        .workflow
        .record_lineage(&project_id, "child", "parent", 1, true, None)
        .await
        .unwrap();
    service
        .inner
        .workflow
        .record_lineage(&project_id, "fork", "parent", 1, true, Some("fork"))
        .await
        .unwrap();
    service
        .inner
        .workflow
        .prompts()
        .put(&project_id, "fork", "continue")
        .await
        .unwrap();

    service
        .mutate_project(&project_id, |content| {
            content["views"][0]["nodes"]
                .as_array_mut()
                .unwrap()
                .retain(|node| node["id"] == "child");
            Ok(())
        })
        .await
        .unwrap();

    let ending = service
        .inner
        .workflow
        .outbox()
        .list()
        .await
        .into_iter()
        .find(|entry| entry["kind"] == "end-children" && entry["target"] == "parent")
        .unwrap();
    assert_eq!(ending["payload"]["nodeIds"], json!(["child"]));
    assert!(service.inner.workflow.lineage_entry("fork").await.is_none());
    assert!(
        service
            .inner
            .workflow
            .lineage_entry("child")
            .await
            .is_some()
    );
    assert_eq!(
        service.inner.workflow.prompts().take("fork").await.unwrap(),
        None
    );
    service.shutdown().await;
}

#[tokio::test]
async fn interrupted_person_chat_resume_is_owed_once_from_project_placement() {
    let temporary = TempDir::new().unwrap();
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &context(&events, "client-a"),
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap().to_owned();
    service
        .mutate_project(&project_id, |content| {
            content["views"][0]["nodes"]
                .as_array_mut()
                .unwrap()
                .push(json!({
                    "id": "chat",
                    "kind": "chat",
                    "title": "Person chat",
                    "x": 0,
                    "y": 0,
                    "w": 480,
                    "h": 520
                }));
            Ok(())
        })
        .await
        .unwrap();
    let (first, second) = tokio::join!(
        service
            .inner
            .coordinator
            .owe_interrupted_run("chat", "turn", 2, 10),
        service
            .inner
            .coordinator
            .owe_interrupted_run("chat", "turn", 2, 10)
    );
    assert!(first.unwrap());
    assert!(second.unwrap());
    let entries = service.inner.workflow.outbox().list().await;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["kind"], "resume-run");
    assert_eq!(
        entries[0]["payload"],
        json!({ "turnId": "turn", "attempt": 2 })
    );
    assert!(
        !service
            .inner
            .coordinator
            .owe_interrupted_run("unknown", "turn", 2, 10)
            .await
            .unwrap()
    );
    service.shutdown().await;
}

#[tokio::test]
async fn completed_summary_turn_is_delivered_without_an_open_task() {
    let temporary = TempDir::new().unwrap();
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &context(&events, "client-a"),
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap().to_owned();
    service
        .mutate_project(&project_id, |content| {
            content["views"][0]["nodes"] = json!([
                { "id": "original", "kind": "chat", "title": "Original", "x": 0, "y": 0, "w": 480, "h": 520 },
                { "id": "fork", "kind": "chat", "title": "Fork", "x": 520, "y": 0, "w": 480, "h": 520 }
            ]);
            Ok(())
        })
        .await
        .unwrap();
    service
        .inner
        .workflow
        .record_lineage_with_ceiling(
            &project_id,
            "fork",
            "original",
            1,
            true,
            Some("fork"),
            RuntimeMode::Auto,
        )
        .await
        .unwrap();
    let target = RuntimeTarget {
        kind: RuntimeTargetKind::Chat,
        id: "fork".to_owned(),
    };
    let mut view = HeadlessRuntime::view(&target);
    view.items = vec![
        json!({
            "id": "summary-turn",
            "kind": "turn",
            "state": "done",
            "summaryFor": "original",
            "createdAt": 1
        }),
        json!({
            "id": "answer",
            "kind": "assistant",
            "turnId": "summary-turn",
            "text": "The native summary"
        }),
    ];
    let runtime = Arc::new(HeadlessRuntime {
        views: Mutex::new(HashMap::from([("fork".to_owned(), view)])),
        ..HeadlessRuntime::default()
    });
    service.install_runtime_host(runtime.clone());
    RuntimeFactSink::mark_dirty(service.inner.coordinator.as_ref(), target);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let delivered = runtime
                .calls
                .lock()
                .await
                .iter()
                .any(|call| call == "note:original");
            if delivered && service.inner.workflow.outbox().list().await.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("summary delivered to original chat");
    service.shutdown().await;
}

#[tokio::test]
async fn typescript_shaped_outbox_runs_headlessly_after_workspace_restart() {
    let temporary = TempDir::new().unwrap();
    let home = temporary.path().join("home");
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(home.clone(), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &client,
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap().to_owned();
    service
        .mutate_project(&project_id, |content| {
            let nodes = content["views"][0]["nodes"].as_array_mut().unwrap();
            for id in ["parent", "starter", "resumee", "fork"] {
                nodes.push(json!({
                    "id": id,
                    "kind": "chat",
                    "title": id,
                    "x": nodes.len() as i64 * 520,
                    "y": 0,
                    "w": 480,
                    "h": 520,
                    "provider": "codex",
                    "providerFixed": true
                }));
            }
            Ok(())
        })
        .await
        .unwrap();
    for (node, opener, depth) in [
        ("starter", "parent", 1),
        ("resumee", "parent", 1),
        ("fork", "parent", 1),
        ("deleted-parent", "parent", 1),
        ("cascade-child", "deleted-parent", 2),
    ] {
        service
            .inner
            .workflow
            .record_lineage_with_ceiling(
                &project_id,
                node,
                opener,
                depth,
                true,
                None,
                RuntimeMode::Auto,
            )
            .await
            .unwrap();
    }
    let task = service
        .inner
        .workflow
        .open_task(
            &project_id,
            "parent",
            "starter",
            "Compile",
            "Compile it",
            None,
        )
        .await
        .unwrap();
    service
        .inner
        .workflow
        .settle_task(
            task["id"].as_str().unwrap(),
            "done",
            Some(json!({ "text": "compiled", "source": "done", "at": 1 })),
            1,
        )
        .await
        .unwrap();
    let authority = RuntimeAuthority {
        identity: HeadlessRuntime::view(&RuntimeTarget {
            kind: RuntimeTargetKind::Chat,
            id: "parent".to_owned(),
        })
        .identity,
        project_id: project_id.clone(),
        lineage_depth: 0,
        mode_ceiling: RuntimeMode::Auto,
    };
    let outbox = service.inner.workflow.outbox();
    outbox
        .put(
            &project_id,
            "starter",
            json!({ "kind": "start-agent", "payload": { "node": "chat", "provider": "codex", "cwd": null, "ceiling": "auto" } }),
            Some(json!(authority)),
            1,
        )
        .await
        .unwrap();
    outbox
        .put(
            &project_id,
            "resumee",
            json!({ "kind": "resume-run", "payload": { "turnId": "turn-1", "attempt": 2 } }),
            None,
            2,
        )
        .await
        .unwrap();
    outbox
        .put(
            &project_id,
            "parent",
            json!({ "kind": "wake-parent", "payload": { "taskId": task["id"] } }),
            None,
            3,
        )
        .await
        .unwrap();
    outbox
        .put(
            &project_id,
            "deleted-parent",
            json!({ "kind": "end-children", "payload": { "nodeIds": ["cascade-child"] } }),
            None,
            4,
        )
        .await
        .unwrap();
    outbox
        .put(
            &project_id,
            "parent",
            json!({ "kind": "deliver-summary", "payload": { "forkId": "fork", "turnId": "turn-2", "text": "summary" } }),
            None,
            5,
        )
        .await
        .unwrap();
    service.shutdown().await;

    let restarted = WorkspaceService::new(home.clone(), EventBus::default())
        .await
        .unwrap();
    let runtime = Arc::new(HeadlessRuntime {
        fail_stop_once: AtomicBool::new(true),
        ..HeadlessRuntime::default()
    });
    restarted.install_runtime_host(runtime.clone());
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if restarted
                .inner
                .workflow
                .outbox()
                .list()
                .await
                .iter()
                .any(|entry| entry["kind"] == "end-children" && entry["attempts"] == 1)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    restarted.shutdown().await;

    let resumed = WorkspaceService::new(home, EventBus::default())
        .await
        .unwrap();
    let resumed_runtime = Arc::new(HeadlessRuntime::default());
    resumed.install_runtime_host(resumed_runtime.clone());
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if resumed.inner.workflow.outbox().list().await.is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut calls = runtime.calls.lock().await.clone();
    calls.extend(resumed_runtime.calls.lock().await.clone());
    assert!(calls.contains(&"start:starter".to_owned()));
    assert!(calls.contains(&"start:resumee".to_owned()));
    assert!(calls.contains(&"wake:parent".to_owned()));
    assert!(calls.contains(&"stop:cascade-child".to_owned()));
    assert!(calls.contains(&"note:parent".to_owned()));
    assert_eq!(
        calls
            .iter()
            .filter(|call| call.as_str() == "stop:cascade-child")
            .count(),
        2
    );
    resumed.shutdown().await;
}

#[tokio::test]
async fn checkpoint_diff_includes_modified_and_untracked_files() {
    let temporary = TempDir::new().unwrap();
    let repository = temporary.path().join("repo");
    tokio::fs::create_dir_all(&repository).await.unwrap();
    for arguments in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Test"],
        vec!["config", "user.email", "test@example.com"],
    ] {
        assert!(
            Command::new("git")
                .args(arguments)
                .current_dir(&repository)
                .status()
                .await
                .unwrap()
                .success()
        );
    }
    tokio::fs::write(repository.join("tracked.txt"), "before\n")
        .await
        .unwrap();
    assert!(
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repository)
            .status()
            .await
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repository)
            .status()
            .await
            .unwrap()
            .success()
    );
    let service = WorkspaceService::new(temporary.path().join("home"), EventBus::default())
        .await
        .unwrap();
    let tree = service
        .inner
        .git
        .checkpoint_take(&repository)
        .await
        .unwrap()
        .unwrap();
    tokio::fs::write(repository.join("tracked.txt"), "after\n")
        .await
        .unwrap();
    tokio::fs::write(repository.join("new.txt"), "new\n")
        .await
        .unwrap();
    let diff = service
        .inner
        .git
        .checkpoint_diff(&repository, &tree)
        .await
        .unwrap()
        .unwrap();
    let files = diff["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert!(
        files
            .iter()
            .any(|file| file["path"] == "new.txt" && file["kind"] == "add")
    );
    assert!(
        files
            .iter()
            .any(|file| file["path"] == "tracked.txt" && file["kind"] == "update")
    );
    service.shutdown().await;
}

#[tokio::test]
async fn drawing_and_diagram_files_enforce_their_own_revisions() {
    let temporary = TempDir::new().unwrap();
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &client,
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap();
    let content = json!({ "name": opened["document"]["name"], "color": opened["document"]["color"], "views": [
        opened["document"]["views"][0].clone(),
        { "kind": "drawing", "id": "sketch", "name": "Sketch" },
        { "kind": "diagram", "id": "map", "name": "Map" }
    ]});
    request(
        &service,
        "project.save",
        json!({ "projectId": project_id, "baseRev": 0, "content": content }),
        &client,
    )
    .await
    .unwrap();
    request(
        &service,
        "drawing.open",
        json!({ "projectId": project_id, "viewId": "sketch" }),
        &client,
    )
    .await
    .unwrap();
    assert!(
        tokio::fs::metadata(folder.join(".ruimte/drawings/sketch.json"))
            .await
            .is_err()
    );
    let mut subscription = events.subscribe("view-watcher");
    let saved = request(&service, "drawing.save", json!({ "projectId": project_id, "viewId": "sketch", "baseRev": 0, "content": { "elements": [{ "id": "one", "x": 0, "y": 0, "w": 80, "h": 24, "stroke": "ink", "strokeWidth": 1, "seed": 3, "kind": "text", "text": "hello", "size": 16, "font": "sans" }] } }), &client).await.unwrap();
    assert_eq!(saved["rev"], 1);
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(300),
            subscription.recv_value()
        )
        .await
        .is_err(),
        "a drawing save was reported back as an outside edit"
    );
    let drawing_text = tokio::fs::read_to_string(folder.join(".ruimte/drawings/sketch.json"))
        .await
        .unwrap();
    assert!(drawing_text.contains("    {\"id\":\"one\",\"x\":0,\"y\":0"));
    assert!(!drawing_text.contains("\n      \"id\""));
    let conflict = request(&service, "drawing.save", json!({ "projectId": project_id, "viewId": "sketch", "baseRev": 0, "content": { "elements": [] } }), &client).await.unwrap_err();
    assert_eq!(conflict.code, "rev-conflict");

    let first = request(
        &service,
        "drawing.save",
        json!({ "projectId": project_id, "viewId": "sketch", "baseRev": 1, "content": { "elements": [{ "id": "first", "x": 0, "y": 0, "w": 80, "h": 24, "stroke": "ink", "strokeWidth": 1, "seed": 4, "kind": "text", "text": "first", "size": 16, "font": "sans" }] } }),
        &client,
    );
    let second = request(
        &service,
        "drawing.save",
        json!({ "projectId": project_id, "viewId": "sketch", "baseRev": 1, "content": { "elements": [{ "id": "second", "x": 0, "y": 0, "w": 80, "h": 24, "stroke": "ink", "strokeWidth": 1, "seed": 5, "kind": "text", "text": "second", "size": 16, "font": "sans" }] } }),
        &client,
    );
    let (first, second) = tokio::join!(first, second);
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    let concurrent_conflict = first.err().or_else(|| second.err()).unwrap();
    assert_eq!(concurrent_conflict.code, "rev-conflict");

    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let external = json!({
        "version": 1,
        "rev": 3,
        "elements": [{
            "id": "external",
            "x": 12,
            "y": 18,
            "w": 96,
            "h": 24,
            "stroke": "ink",
            "strokeWidth": 1,
            "seed": 6,
            "kind": "text",
            "text": "atomic replacement",
            "size": 16,
            "font": "sans"
        }]
    });
    let drawing_path = folder.join(".ruimte/drawings/sketch.json");
    let replacement_path = folder.join(".ruimte/drawings/sketch.next");
    tokio::fs::write(&replacement_path, serde_json::to_vec(&external).unwrap())
        .await
        .unwrap();
    tokio::fs::rename(&replacement_path, &drawing_path)
        .await
        .unwrap();
    let changed =
        tokio::time::timeout(std::time::Duration::from_secs(3), subscription.recv_value())
            .await
            .expect("external drawing change event")
            .expect("view watcher remained subscribed");
    assert_eq!(changed["event"], "drawing.changed");
    assert_eq!(changed["payload"]["document"], external);
    let after_external = request(&service, "drawing.save", json!({ "projectId": project_id, "viewId": "sketch", "baseRev": 3, "content": { "elements": [] } }), &client).await.unwrap();
    assert_eq!(after_external["rev"], 4);

    request(
        &service,
        "diagram.open",
        json!({ "projectId": project_id, "viewId": "map" }),
        &client,
    )
    .await
    .unwrap();
    assert!(
        tokio::fs::metadata(folder.join(".ruimte/diagrams/map.json"))
            .await
            .is_err()
    );
    let invalid = request(&service, "diagram.save", json!({ "projectId": project_id, "viewId": "map", "baseRev": 0, "content": { "meta": { "title": "", "direction": "right" }, "nodes": [{ "id": "a", "label": "A" }], "groups": [], "edges": [{ "from": "a", "to": "missing" }] } }), &client).await.unwrap_err();
    assert_eq!(invalid.code, "diagram-invalid");
    request(&service, "diagram.save", json!({ "projectId": project_id, "viewId": "map", "baseRev": 0, "content": { "meta": { "title": "Graph", "direction": "right" }, "nodes": [{ "id": "a", "label": "A" }], "groups": [], "edges": [] } }), &client).await.unwrap();
    let diagram_text = tokio::fs::read_to_string(folder.join(".ruimte/diagrams/map.json"))
        .await
        .unwrap();
    assert!(diagram_text.contains("  \"meta\": {\"title\":\"Graph\",\"direction\":\"right\"},"));
    assert!(diagram_text.contains("    {\"id\":\"a\",\"label\":\"A\"}"));
    service.shutdown().await;
}

#[tokio::test]
async fn filesystem_search_read_and_chunked_bytes_use_real_files() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path().join("tree");
    tokio::fs::create_dir_all(root.join("src")).await.unwrap();
    tokio::fs::write(
        root.join("src/alpha.rs"),
        "fn alpha() {\n    println!(\"needle\");\n}\n",
    )
    .await
    .unwrap();
    tokio::fs::write(
        root.join("src/unicode.rs"),
        "const TREE: &str = \"🌱 seedling\";\n",
    )
    .await
    .unwrap();
    tokio::fs::write(root.join("src/literal.txt"), "spawn([\"bash\"])\n")
        .await
        .unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let searched = request(
        &service,
        "fs.search",
        json!({ "cwd": root, "query": "alp" }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(searched["files"][0], "src/alpha.rs");
    let read = request(
        &service,
        "fs.read",
        json!({ "path": root.join("src/alpha.rs") }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(read["kind"], "text");
    assert_eq!(read["language"], "rust");
    let grep = request(
        &service,
        "fs.grep",
        json!({ "cwd": root, "query": "needle" }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(grep["matches"][0]["line"], 2);
    let literal = request(
        &service,
        "fs.grep",
        json!({ "cwd": root, "query": "spawn([\"bash\"])" }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(literal["matches"].as_array().unwrap().len(), 1);
    let unicode = request(
        &service,
        "fs.grep",
        json!({ "cwd": root, "query": "seedling" }),
        &client,
    )
    .await
    .unwrap();
    let hit = &unicode["matches"][0];
    let text = hit["text"].as_str().unwrap();
    let column = hit["column"].as_u64().unwrap() as usize;
    let length = hit["length"].as_u64().unwrap() as usize;
    let units = text.encode_utf16().collect::<Vec<_>>();
    assert_eq!(
        String::from_utf16(&units[column..column + length]).unwrap(),
        "seedling"
    );

    tokio::fs::create_dir_all(root.join("ignored/deep"))
        .await
        .unwrap();
    tokio::fs::write(root.join("ignored/deep/hidden.txt"), "hidden")
        .await
        .unwrap();
    tokio::fs::write(root.join(".gitignore"), "ignored/\n")
        .await
        .unwrap();
    git(&root, &["init", "-b", "main"]).await;
    let listed = request(
        &service,
        "fs.list",
        json!({ "path": root, "depth": 3, "hidden": true }),
        &client,
    )
    .await
    .unwrap();
    let entries = listed["entries"].as_array().unwrap();
    assert!(
        entries
            .iter()
            .any(|entry| entry["name"] == "ignored" && entry["ignored"] == true)
    );
    assert!(
        entries
            .iter()
            .any(|entry| entry["name"] == ".git" && entry["ignored"] == true)
    );
    assert!(!entries.iter().any(|entry| entry["name"] == "hidden.txt"));

    let png = root.join("pixel.png");
    tokio::fs::write(&png, b"\x89PNG\r\n\x1a\nabc")
        .await
        .unwrap();
    let bytes = request(
        &service,
        "bytes.read",
        json!({ "resource": { "kind": "file", "path": png }, "offset": 0, "length": 8 }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(bytes["mime"], "image/png");
    assert_eq!(bytes["offset"], 0);

    let disguised = root.join("not-an-image.png");
    tokio::fs::write(&disguised, "plain text").await.unwrap();
    assert!(
        service
            .resolve_file_media(&disguised)
            .await
            .unwrap()
            .is_none()
    );
    let extensionless = root.join("extensionless");
    tokio::fs::write(&extensionless, b"\x89PNG\r\n\x1a\ncontent")
        .await
        .unwrap();
    assert_eq!(
        service
            .resolve_file_media(&extensionless)
            .await
            .unwrap()
            .unwrap()
            .mime,
        "image/png"
    );
    let empty_video = root.join("empty.mp4");
    tokio::fs::write(&empty_video, []).await.unwrap();
    assert!(
        service
            .resolve_file_media(&empty_video)
            .await
            .unwrap()
            .is_none()
    );
    service.shutdown().await;
}

#[tokio::test]
async fn git_status_stage_and_log_run_against_a_temporary_repository() {
    let temporary = TempDir::new().unwrap();
    let repo = temporary.path().join("repo");
    tokio::fs::create_dir_all(&repo).await.unwrap();
    git(&repo, &["init", "-b", "main"]).await;
    git(&repo, &["config", "user.name", "Test User"]).await;
    git(&repo, &["config", "user.email", "test@example.com"]).await;
    tokio::fs::write(repo.join("tracked.txt"), "first\nthird\nfourth\nfifth\n")
        .await
        .unwrap();
    git(&repo, &["add", "tracked.txt"]).await;
    git(&repo, &["commit", "-m", "initial"]).await;
    tokio::fs::write(
        repo.join("tracked.txt"),
        "first\nsecond\nthird\nfourth\nfifth\n",
    )
    .await
    .unwrap();
    tokio::fs::write(repo.join("fresh.txt"), "one\ntwo\n")
        .await
        .unwrap();

    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let status = request(&service, "git.status", json!({ "cwd": repo }), &client)
        .await
        .unwrap();
    assert_eq!(status["repo"], true);
    assert!(
        status["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == "tracked.txt" && file["state"] == "unstaged")
    );
    let unstaged = status["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "tracked.txt" && file["state"] == "unstaged")
        .unwrap();
    assert_eq!(unstaged["added"], 1);
    assert_eq!(unstaged["deleted"], 0);
    let untracked = status["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "fresh.txt")
        .unwrap();
    assert_eq!(untracked["state"], "untracked");
    assert_eq!(untracked["added"], 2);
    let fresh_diff = request(
        &service,
        "git.diff",
        json!({ "cwd": repo, "scope": "worktree", "path": "fresh.txt", "staged": false, "ignoreWhitespace": false }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(fresh_diff["added"], 2);
    assert!(fresh_diff["diff"].as_str().unwrap().contains("+one"));
    request(
        &service,
        "git.stage",
        json!({ "cwd": repo, "paths": ["tracked.txt"], "staged": true }),
        &client,
    )
    .await
    .unwrap();
    let staged = request(&service, "git.status", json!({ "cwd": repo }), &client)
        .await
        .unwrap();
    assert!(
        staged["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == "tracked.txt" && file["state"] == "staged")
    );
    git(&repo, &["mv", "tracked.txt", "renamed.txt"]).await;
    let renamed = request(&service, "git.status", json!({ "cwd": repo }), &client)
        .await
        .unwrap();
    assert!(renamed["files"].as_array().unwrap().iter().any(|file| {
        file["path"] == "renamed.txt"
            && file["oldPath"] == "tracked.txt"
            && file["state"] == "staged"
    }));
    let log = request(&service, "git.log", json!({ "cwd": repo }), &client)
        .await
        .unwrap();
    assert_eq!(log["commits"][0]["subject"], "initial");
    service.shutdown().await;
}

#[tokio::test]
async fn worktree_register_counts_work_and_protects_daemon_created_branches() {
    let temporary = TempDir::new().unwrap();
    let repo = temporary.path().join("repo");
    tokio::fs::create_dir_all(&repo).await.unwrap();
    git(&repo, &["init", "-b", "main"]).await;
    git(&repo, &["config", "user.name", "Test User"]).await;
    git(&repo, &["config", "user.email", "test@example.com"]).await;
    tokio::fs::write(repo.join("README.md"), "hello\n")
        .await
        .unwrap();
    git(&repo, &["add", "README.md"]).await;
    git(&repo, &["commit", "-m", "initial"]).await;

    let home = temporary.path().join("home");
    let events = EventBus::default();
    let service = WorkspaceService::new(home.clone(), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let added = request(
        &service,
        "git.worktree-add",
        json!({ "repo": repo, "branch": "feature/x" }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(added["created"], true);
    assert_eq!(added["worktree"]["from"]["branch"], "main");
    let worktree = Path::new(added["worktree"]["path"].as_str().unwrap());
    tokio::fs::write(worktree.join("new.txt"), "new\n")
        .await
        .unwrap();
    assert!(
        service
            .inner
            .git
            .checkpoint_take(worktree)
            .await
            .unwrap()
            .is_some()
    );
    let checkpoint = find_suffix(&home.join("checkpoints"), ".index").await;
    assert!(checkpoint.exists());
    let listed = request(
        &service,
        "git.worktree-list",
        json!({ "repo": repo, "inspect": true }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(listed["worktrees"][0]["work"]["untracked"], 1);
    let refused = request(
        &service,
        "git.worktree-remove",
        json!({ "repo": repo, "path": worktree }),
        &client,
    )
    .await
    .unwrap_err();
    assert_eq!(refused.code, "worktree-has-work");
    let removed = request(
        &service,
        "git.worktree-remove",
        json!({ "repo": repo, "path": worktree, "force": true }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(removed["branchDeleted"], true);
    assert!(
        !git_output(&repo, &["branch", "--list", "feature/x"])
            .await
            .contains("feature/x")
    );
    assert!(!checkpoint.exists());
    let register = find_named(&home.join("worktrees"), "worktrees.json").await;
    let register_document: Value =
        serde_json::from_slice(&tokio::fs::read(&register).await.unwrap()).unwrap();
    assert_eq!(register_document["version"], 1);
    assert_eq!(register_document["worktrees"].as_object().unwrap().len(), 0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = tokio::fs::metadata(register)
            .await
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    git(&repo, &["branch", "existing"]).await;
    let existing = request(
        &service,
        "git.worktree-add",
        json!({ "repo": repo, "branch": "existing" }),
        &client,
    )
    .await
    .unwrap();
    let existing_path = existing["worktree"]["path"].as_str().unwrap();
    let removed = request(
        &service,
        "git.worktree-remove",
        json!({ "repo": repo, "path": existing_path }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(removed["branchDeleted"], false);
    assert!(
        git_output(&repo, &["branch", "--list", "existing"])
            .await
            .contains("existing")
    );

    let kept = request(
        &service,
        "git.worktree-add",
        json!({ "repo": repo, "branch": "feature/kept" }),
        &client,
    )
    .await
    .unwrap();
    let kept_path = kept["worktree"]["path"].as_str().unwrap();
    let removed = request(
        &service,
        "git.worktree-remove",
        json!({ "repo": repo, "path": kept_path, "keepBranch": true }),
        &client,
    )
    .await
    .unwrap();
    assert_eq!(removed["branchDeleted"], false);
    assert!(
        git_output(&repo, &["branch", "--list", "feature/kept"])
            .await
            .contains("feature/kept")
    );
    service.shutdown().await;
}

#[cfg(unix)]
#[tokio::test]
async fn project_icons_keep_failed_replacements_and_jail_symlinks() {
    use std::os::unix::fs::symlink;

    let temporary = TempDir::new().unwrap();
    let folder = temporary.path().join("project");
    tokio::fs::create_dir_all(&folder).await.unwrap();
    let events = EventBus::default();
    let service = WorkspaceService::new(temporary.path().join("home"), events.clone())
        .await
        .unwrap();
    let client = context(&events, "client-a");
    let opened = request(
        &service,
        "project.open",
        json!({ "folder": folder }),
        &client,
    )
    .await
    .unwrap();
    let project_id = opened["summary"]["projectId"].as_str().unwrap();
    request(
        &service,
        "project.setIcon",
        json!({ "projectId": project_id, "image": { "mime": "image/png", "base64": "iVBORw0KGgpyZXN0" } }),
        &client,
    )
    .await
    .unwrap();
    let icon_path = folder.join(".ruimte/icon.png");
    let before = tokio::fs::read(&icon_path).await.unwrap();
    let invalid = request(
        &service,
        "project.setIcon",
        json!({ "projectId": project_id, "image": { "mime": "image/png", "base64": "not base64" } }),
        &client,
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.code, "bad-icon");
    assert_eq!(tokio::fs::read(&icon_path).await.unwrap(), before);
    let asset = service
        .resolve_project_icon(project_id, Some("light"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(asset.mime, "image/png");
    assert_eq!(asset.len, before.len() as u64);
    assert!(asset.etag.starts_with('"'));

    tokio::fs::remove_file(&icon_path).await.unwrap();
    let outside = temporary.path().join("outside.png");
    tokio::fs::write(&outside, &before).await.unwrap();
    symlink(&outside, &icon_path).unwrap();
    assert!(
        service
            .resolve_project_icon(project_id, Some("light"))
            .await
            .unwrap()
            .is_none()
    );
    service.shutdown().await;
}

async fn git(cwd: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .status()
        .await
        .unwrap();
    assert!(status.success(), "git {arguments:?}");
}

async fn git_output(cwd: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "git {arguments:?}");
    String::from_utf8(output.stdout).unwrap()
}

async fn find_named(root: &Path, name: &str) -> std::path::PathBuf {
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        let mut entries = tokio::fs::read_dir(directory).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            if entry.file_name() == name {
                return entry.path();
            }
            if entry.file_type().await.unwrap().is_dir() {
                directories.push(entry.path());
            }
        }
    }
    panic!("missing {name}");
}

async fn find_suffix(root: &Path, suffix: &str) -> std::path::PathBuf {
    let mut entries = tokio::fs::read_dir(root).await.unwrap();
    while let Some(entry) = entries.next_entry().await.unwrap() {
        if entry.file_name().to_string_lossy().ends_with(suffix) {
            return entry.path();
        }
    }
    panic!("missing *{suffix}");
}
