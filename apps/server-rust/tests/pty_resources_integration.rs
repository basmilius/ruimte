#![cfg(target_os = "linux")]

use ruimte_server::{
    events::EventBus,
    rpc::{ClientAccess, RequestContext},
    sessions::SessionsService,
};
use serde_json::json;
use std::time::Duration;

fn writer_threads() -> usize {
    std::fs::read_dir("/proc/self/task")
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            std::fs::read_to_string(entry.path().join("comm"))
                .is_ok_and(|name| name.starts_with("ruimte-pty-writ"))
        })
        .count()
}

fn pty_descriptors() -> usize {
    std::fs::read_dir("/proc/self/fd")
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            std::fs::read_link(entry.path())
                .is_ok_and(|path| path.to_string_lossy().contains("/ptmx"))
        })
        .count()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real Linux PTY resource integration"]
async fn exited_sessions_release_writer_threads_while_history_remains() {
    let home = tempfile::tempdir().unwrap();
    let events = EventBus::default();
    let service = SessionsService::new(home.path().to_owned(), events.clone())
        .await
        .unwrap();
    let context = RequestContext {
        client_id: "resource-test".into(),
        access: ClientAccess {
            reachability: "loopback".into(),
            session_id: None,
        },
        events,
    };
    let before = (writer_threads(), pty_descriptors());
    for index in 0..8 {
        let id = format!("exited-{index}");
        service.dispatch("session.create", json!({"sessionId":id,"shell":"/bin/sh","cols":80,"rows":24,"command":"printf 'history survives\\n'; exit"}), &context).await.unwrap().unwrap();
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if service.process_roots().await.iter().all(|root| root.exited) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("shells should exit");
    tokio::time::sleep(Duration::from_millis(500)).await;
    let remaining = (writer_threads(), pty_descriptors());
    let screen = service.screen("exited-0").await.unwrap();
    service.shutdown().await;
    assert!(screen.contains("history survives"));
    assert_eq!(
        remaining, before,
        "exited terminal histories retained PTY writer threads or descriptors"
    );
}
