//! Talks to the server over an in-memory connection, the way an editor talks to it over stdio.

use std::thread::JoinHandle;
use std::time::Duration;

use lsp_server::{Connection, Message, Notification, Request, RequestId, Response};
use serde_json::{Value, json};

const TIMEOUT: Duration = Duration::from_secs(10);

struct Client {
    connection: Connection,
    server: Option<JoinHandle<()>>,
    next_id: i32,
    /// Notifications and requests seen while waiting for something else.
    backlog: Vec<Message>,
}

impl Client {
    fn start(capabilities: Value, options: Value) -> (Client, Value) {
        let (server_side, client_side) = Connection::memory();
        let server = std::thread::spawn(move || {
            php_language_server::run(server_side).expect("the server runs to the end");
        });
        let mut client = Client {
            connection: client_side,
            server: Some(server),
            next_id: 0,
            backlog: Vec::new(),
        };
        let result = client.request(
            "initialize",
            json!({ "processId": null, "rootUri": null, "capabilities": capabilities, "initializationOptions": options }),
        );
        client.notify("initialized", json!({}));
        (client, result)
    }

    fn send(&self, message: impl Into<Message>) {
        self.connection
            .sender
            .send(message.into())
            .expect("the server is listening");
    }

    fn notify(&self, method: &str, params: Value) {
        self.send(Notification::new(method.to_string(), params));
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = RequestId::from(self.next_id);
        self.send(Request::new(id.clone(), method.to_string(), params));
        loop {
            match self
                .connection
                .receiver
                .recv_timeout(TIMEOUT)
                .expect("the server answers")
            {
                Message::Response(response) if response.id == id => {
                    return response.response_result.expect("the request succeeds");
                }
                other => self.backlog.push(other),
            }
        }
    }

    /// The next message that `pick` accepts, from the backlog first.
    fn wait_for<T>(&mut self, mut pick: impl FnMut(&Message) -> Option<T>) -> T {
        if let Some(position) = self.backlog.iter().position(|message| pick(message).is_some()) {
            let message = self.backlog.remove(position);
            return pick(&message).expect("picked above");
        }
        loop {
            let message = self
                .connection
                .receiver
                .recv_timeout(TIMEOUT)
                .expect("a message arrives");
            if let Some(found) = pick(&message) {
                return found;
            }
            self.backlog.push(message);
        }
    }

    fn open(&self, uri: &str, text: &str) {
        self.notify(
            "textDocument/didOpen",
            json!({ "textDocument": { "uri": uri, "languageId": "php", "version": 1, "text": text } }),
        );
    }

    /// The next diagnostics published for a document.
    fn diagnostics(&mut self, uri: &str) -> Vec<Value> {
        self.wait_for(|message| match message {
            Message::Notification(notification) if notification.method == "textDocument/publishDiagnostics" => {
                (notification.params["uri"] == uri).then(|| {
                    notification.params["diagnostics"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                })
            }
            _ => None,
        })
    }

    fn shutdown(mut self) {
        self.request("shutdown", Value::Null);
        self.notify("exit", Value::Null);
        self.server
            .take()
            .expect("started")
            .join()
            .expect("the server stops cleanly");
    }
}

fn messages(diagnostics: &[Value]) -> Vec<String> {
    diagnostics
        .iter()
        .map(|found| found["message"].as_str().unwrap_or_default().to_string())
        .collect()
}

const URI: &str = "file:///project/a.php";

#[test]
fn initializes_with_the_capabilities_it_has() {
    let (client, result) = Client::start(json!({}), Value::Null);
    let capabilities = &result["capabilities"];
    assert_eq!(capabilities["textDocumentSync"]["change"], 2);
    assert_eq!(capabilities["documentSymbolProvider"], true);
    assert_eq!(capabilities["foldingRangeProvider"], true);
    assert_eq!(capabilities["selectionRangeProvider"], true);
    assert_eq!(capabilities["positionEncoding"], "utf-16");
    assert!(
        capabilities["diagnosticProvider"].is_null(),
        "no pull diagnostics for a client that cannot pull"
    );
    assert_eq!(result["serverInfo"]["name"], "php-language-server");
    client.shutdown();
}

#[test]
fn negotiates_utf8_positions() {
    let (client, result) = Client::start(
        json!({ "general": { "positionEncodings": ["utf-16", "utf-8"] } }),
        Value::Null,
    );
    assert_eq!(result["capabilities"]["positionEncoding"], "utf-8");
    client.shutdown();
}

#[test]
fn publishes_syntax_errors_and_fixes_them_after_an_incremental_change() {
    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, "<?php\n$a = ;\n");
    let found = client.diagnostics(URI);
    assert_eq!(messages(&found), ["Expression expected"]);
    assert_eq!(found[0]["severity"], 1);
    assert_eq!(found[0]["source"], "php");
    assert_eq!(
        found[0]["range"]["start"],
        json!({ "line": 1, "character": 3 }),
        "an empty range widens to the character before it"
    );
    client.notify(
        "textDocument/didChange",
        json!({
            "textDocument": { "uri": URI, "version": 2 },
            "contentChanges": [{ "range": { "start": { "line": 1, "character": 5 }, "end": { "line": 1, "character": 5 } }, "text": "1" }]
        }),
    );
    assert!(client.diagnostics(URI).is_empty());
    client.notify("textDocument/didClose", json!({ "textDocument": { "uri": URI } }));
    assert!(client.diagnostics(URI).is_empty(), "closing clears the diagnostics");
    client.shutdown();
}

#[test]
fn a_burst_of_changes_ends_in_the_diagnostics_of_the_last_text() {
    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, "<?php\n$a = 1;\n");
    assert!(client.diagnostics(URI).is_empty());
    for version in 2..30 {
        let text = if version % 2 == 0 {
            "<?php\n$a = ;\n"
        } else {
            "<?php\n$a = 1;\n"
        };
        client.notify(
            "textDocument/didChange",
            json!({ "textDocument": { "uri": URI, "version": version }, "contentChanges": [{ "text": text }] }),
        );
    }
    let mut last = Vec::new();
    // The final version is 29, which is valid; keep reading until the server has gone quiet.
    while let Ok(Message::Notification(notification)) =
        client.connection.receiver.recv_timeout(Duration::from_millis(300))
    {
        last = notification.params["diagnostics"]
            .as_array()
            .cloned()
            .unwrap_or_default();
    }
    assert!(last.is_empty());
    client.shutdown();
}

#[test]
fn reports_syntax_newer_than_the_language_level() {
    let text = "<?php\nclass A { public int $x { get => 1; } }\n";
    let (mut client, _) = Client::start(json!({}), json!({ "phpVersion": "8.3" }));
    client.open(URI, text);
    assert_eq!(
        messages(&client.diagnostics(URI)),
        ["Property hooks are only available since PHP 8.4"]
    );
    client.shutdown();

    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, text);
    assert!(client.diagnostics(URI).is_empty(), "the newest level is the default");
    client.shutdown();
}

#[test]
fn a_pushed_setting_changes_the_level_of_open_documents() {
    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, "<?php\n$a = $b |> strlen(...);\n");
    assert!(client.diagnostics(URI).is_empty());
    client.notify(
        "workspace/didChangeConfiguration",
        json!({ "settings": { "phpLanguageServer": { "phpVersion": "8.4" } } }),
    );
    assert_eq!(
        messages(&client.diagnostics(URI)),
        ["The pipe operator is only available since PHP 8.5"]
    );
    client.shutdown();
}

#[test]
fn asks_the_client_for_the_level_of_each_document() {
    let (mut client, _) = Client::start(json!({ "workspace": { "configuration": true } }), Value::Null);
    client.open(URI, "<?php\n$a = match (1) { default => 2 };\n");
    let (id, params) = client.wait_for(|message| match message {
        Message::Request(request) if request.method == "workspace/configuration" => {
            Some((request.id.clone(), request.params.clone()))
        }
        _ => None,
    });
    assert_eq!(params["items"][0]["scopeUri"], URI);
    assert_eq!(params["items"][0]["section"], "phpLanguageServer");
    client.send(Response::new_ok(id, json!([{ "phpVersion": "7.4" }])));
    let found = messages(&client.wait_for(|message| {
        match message {
            Message::Notification(notification)
                if notification.method == "textDocument/publishDiagnostics"
                    && notification.params["diagnostics"]
                        .as_array()
                        .is_some_and(|items| !items.is_empty()) =>
            {
                Some(
                    notification.params["diagnostics"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default(),
                )
            }
            _ => None,
        }
    }));
    assert_eq!(found, ["Match expressions are only available since PHP 8.0"]);
    client.shutdown();
}

#[test]
fn answers_with_pulled_diagnostics_for_a_client_that_pulls() {
    let (mut client, result) = Client::start(json!({ "textDocument": { "diagnostic": {} } }), Value::Null);
    assert_eq!(
        result["capabilities"]["diagnosticProvider"]["interFileDependencies"],
        false
    );
    client.open(URI, "<?php\n$a = ;\n");
    let report = client.request("textDocument/diagnostic", json!({ "textDocument": { "uri": URI } }));
    assert_eq!(report["kind"], "full");
    assert_eq!(
        messages(report["items"].as_array().expect("items")),
        ["Expression expected"]
    );
    assert!(
        !client.backlog.iter().any(
            |message| matches!(message, Message::Notification(n) if n.method == "textDocument/publishDiagnostics")
        ),
        "a client that pulls is not sent diagnostics"
    );
    client.shutdown();
}

const SOURCE: &str = "<?php\nnamespace App;\n\nuse A\\B;\nuse A\\C;\n\n/** Doc\n * more */\nfinal class User\n{\n    public const X = 1;\n    public function name(): string\n    {\n        return [\n            1,\n        ][0];\n    }\n}\n";

#[test]
fn lists_document_symbols_as_a_tree_or_flat() {
    let (mut client, _) = Client::start(
        json!({ "textDocument": { "documentSymbol": { "hierarchicalDocumentSymbolSupport": true } } }),
        Value::Null,
    );
    client.open(URI, SOURCE);
    let symbols = client.request("textDocument/documentSymbol", json!({ "textDocument": { "uri": URI } }));
    let namespace = &symbols[0];
    assert_eq!(namespace["name"], "App");
    assert_eq!(namespace["kind"], 3);
    let class = &namespace["children"][0];
    assert_eq!(class["name"], "User");
    assert_eq!(class["kind"], 5);
    assert_eq!(class["children"][0]["name"], "X");
    assert_eq!(class["children"][1]["name"], "name");
    assert_eq!(class["children"][1]["detail"], "(): string");
    assert_eq!(class["selectionRange"]["start"], json!({ "line": 8, "character": 12 }));
    client.shutdown();

    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, SOURCE);
    let symbols = client.request("textDocument/documentSymbol", json!({ "textDocument": { "uri": URI } }));
    let names: Vec<_> = symbols
        .as_array()
        .expect("a list")
        .iter()
        .map(|symbol| {
            (
                symbol["name"].as_str().unwrap_or_default(),
                symbol["containerName"].as_str(),
            )
        })
        .collect();
    assert_eq!(
        names,
        [
            ("App", None),
            ("User", Some("App")),
            ("X", Some("User")),
            ("name", Some("User"))
        ]
    );
    client.shutdown();
}

#[test]
fn answers_folding_and_selection_ranges() {
    let (mut client, _) = Client::start(json!({}), Value::Null);
    client.open(URI, SOURCE);
    let folds = client.request("textDocument/foldingRange", json!({ "textDocument": { "uri": URI } }));
    let folds: Vec<(i64, i64, Option<&str>)> = folds
        .as_array()
        .expect("a list")
        .iter()
        .map(|fold| {
            (
                fold["startLine"].as_i64().unwrap_or(-1),
                fold["endLine"].as_i64().unwrap_or(-1),
                fold["kind"].as_str(),
            )
        })
        .collect();
    assert!(folds.contains(&(3, 4, Some("imports"))), "{folds:?}");
    assert!(folds.contains(&(6, 7, Some("comment"))), "{folds:?}");
    assert!(folds.contains(&(9, 16, None)), "{folds:?}");
    assert!(folds.contains(&(12, 15, None)), "{folds:?}");

    let ranges = client.request(
        "textDocument/selectionRange",
        json!({ "textDocument": { "uri": URI }, "positions": [{ "line": 11, "character": 21 }] }),
    );
    let mut depth = 0;
    let mut link = &ranges[0];
    let innermost = link["range"].clone();
    while !link["parent"].is_null() {
        link = &link["parent"];
        depth += 1;
    }
    assert!(depth >= 3);
    assert_eq!(innermost["start"]["line"], 11);
    assert_eq!(link["range"]["start"], json!({ "line": 0, "character": 0 }));
    client.shutdown();
}

#[test]
fn rejects_what_it_does_not_know() {
    let (client, _) = Client::start(json!({}), Value::Null);
    client.send(Request::new(
        RequestId::from(99),
        "textDocument/hover".to_string(),
        json!({}),
    ));
    let response = client.connection.receiver.recv_timeout(TIMEOUT).expect("an answer");
    let Message::Response(response) = response else {
        panic!("expected a response");
    };
    assert_eq!(response.response_result.expect_err("unsupported").code, -32601);
    client.shutdown();
}
