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
        Client::start_in(capabilities, options, Value::Null)
    }

    fn start_in(capabilities: Value, options: Value, root_uri: Value) -> (Client, Value) {
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
            json!({ "processId": null, "rootUri": root_uri, "capabilities": capabilities, "initializationOptions": options }),
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

    /// The message of the error a request answers with.
    fn request_error(&mut self, method: &str, params: Value) -> String {
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
                    return response.response_result.expect_err("the request fails").message;
                }
                other => self.backlog.push(other),
            }
        }
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
        "textDocument/linkedEditingRange".to_string(),
        json!({}),
    ));
    let response = client.connection.receiver.recv_timeout(TIMEOUT).expect("an answer");
    let Message::Response(response) = response else {
        panic!("expected a response");
    };
    assert_eq!(response.response_result.expect_err("unsupported").code, -32601);
    client.shutdown();
}

// An index over a real folder ------------------------------------------------------------------

struct Disk {
    dir: tempfile::TempDir,
}

impl Disk {
    /// A project with Composer metadata and one installed package, a storage folder and a few stubs.
    fn new() -> Disk {
        let disk = Disk {
            dir: tempfile::tempdir().expect("a temp dir"),
        };
        disk.write(
            "project/composer.json",
            r#"{
  "require": { "php": "^8.1", "ext-redis": "*" },
  "config": { "platform": { "php": "8.1" } },
  "autoload": { "psr-4": { "App\\": "src/" } }
}"#,
        );
        disk.write(
            "project/src/Models/User.php",
            "<?php\nnamespace App\\Models;\n\n/** A person who can log in. */\nclass User\n{\n    public string $name = '';\n\n    /** Finds a user. */\n    public static function find(int $id): ?static\n    {\n        return null;\n    }\n\n    public function posts(): array\n    {\n        return [];\n    }\n}\n",
        );
        disk.write(
            "project/vendor/composer/installed.json",
            r#"{"packages":[{"name":"acme/lib","install-path":"../acme/lib","autoload":{"psr-4":{"Acme\\Lib\\":"src/"}}}]}"#,
        );
        disk.write(
            "project/vendor/acme/lib/src/Widget.php",
            "<?php\nnamespace Acme\\Lib;\n\nclass Widget\n{\n    public function render(): string\n    {\n        return '';\n    }\n}\n",
        );
        disk.write(
            "stubs/standard/basic.php",
            "<?php\nfunction strlen(string $string): int {}\n\n/** @since 8.4 */\nfunction array_find(array $array, callable $callback): mixed {}\n",
        );
        disk.write(
            "stubs/redis/redis.php",
            "<?php\nclass Redis { public function get(string $key): mixed {} }\n",
        );
        disk.write("stubs/swoole/swoole.php", "<?php\nclass SwooleServer {}\n");
        disk
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.dir.path().join(relative);
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("created");
        std::fs::write(path, text).expect("written");
    }

    fn path(&self, relative: &str) -> std::path::PathBuf {
        self.dir.path().join(relative)
    }

    fn uri(&self, relative: &str) -> String {
        format!("file://{}", self.path(relative).display())
    }

    fn options(&self) -> Value {
        json!({
            "storagePath": self.path("storage"),
            "stubsPath": self.path("stubs"),
        })
    }
}

const PROGRESS_CAPABILITIES: fn() -> Value = || json!({ "window": { "workDoneProgress": true } });

impl Client {
    /// Answers the request to create a progress and waits until the progress ends, which is when the
    /// project and the stubs are indexed.
    fn wait_for_indexing(&mut self) -> Vec<String> {
        let mut kinds = Vec::new();
        loop {
            let message = self.wait_for(|message| match message {
                Message::Request(request) if request.method == "window/workDoneProgress/create" => {
                    Some(Message::Request(request.clone()))
                }
                Message::Notification(notification) if notification.method == "$/progress" => {
                    Some(Message::Notification(notification.clone()))
                }
                _ => None,
            });
            match message {
                Message::Request(request) => self.send(Response::new_ok(request.id, Value::Null)),
                Message::Notification(notification) => {
                    let kind = notification.params["value"]["kind"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let done = kind == "end";
                    kinds.push(kind);
                    if done {
                        return kinds;
                    }
                }
                Message::Response(_) => {}
            }
        }
    }

    fn at(&mut self, method: &str, uri: &str, line: u32, character: u32) -> Value {
        self.request(
            method,
            json!({ "textDocument": { "uri": uri }, "position": { "line": line, "character": character } }),
        )
    }
}

fn indexed_server(disk: &Disk) -> Client {
    let (mut client, _) = Client::start_in(PROGRESS_CAPABILITIES(), disk.options(), json!(disk.uri("project")));
    let kinds = client.wait_for_indexing();
    assert_eq!(kinds.first().map(String::as_str), Some("begin"), "{kinds:?}");
    client
}

#[test]
fn indexes_a_project_and_reports_progress() {
    let disk = Disk::new();
    let client = indexed_server(&disk);
    assert!(
        std::fs::read_dir(disk.path("storage/cache"))
            .expect("a cache folder")
            .count()
            >= 2,
        "the project and the stubs are cached"
    );
    client.shutdown();
}

#[test]
fn a_second_run_reads_the_cache() {
    let disk = Disk::new();
    indexed_server(&disk).shutdown();
    let mut client = indexed_server(&disk);
    let log = client.wait_for(|message| match message {
        Message::Notification(notification)
            if notification.method == "window/logMessage"
                && notification.params["message"]
                    .as_str()
                    .is_some_and(|text| text.starts_with("Indexed ")) =>
        {
            notification.params["message"].as_str().map(str::to_string)
        }
        _ => None,
    });
    assert!(log.contains("0 parsed"), "{log}");
    client.shutdown();
}

#[test]
fn completes_a_vendor_class_with_an_import_and_hides_newer_stubs() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    let text =
        "<?php\nnamespace App;\n\nclass Page\n{\n    public function show()\n    {\n        $w = new Wid\n    }\n}\n";
    client.open(&uri, text);
    let result = client.at("textDocument/completion", &uri, 7, 20);
    let items = result["items"].as_array().expect("items");
    let widget = items.iter().find(|item| item["label"] == "Widget").expect("Widget");
    assert_eq!(widget["kind"], 7);
    assert_eq!(widget["labelDetails"]["description"], "Acme\\Lib");
    assert_eq!(widget["textEdit"]["newText"], "Widget");
    assert_eq!(
        widget["additionalTextEdits"][0]["newText"],
        "\nuse Acme\\Lib\\Widget;\n"
    );
    assert_eq!(
        widget["additionalTextEdits"][0]["range"]["start"],
        json!({ "line": 2, "character": 0 })
    );

    let resolved = client.request("completionItem/resolve", widget.clone());
    assert_eq!(resolved["documentation"]["kind"], "markdown");

    let text = "<?php\nnamespace App;\nfunction f() {\n    array_\n}\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 2 }, "contentChanges": [{ "text": text }] }),
    );
    let result = client.at("textDocument/completion", &uri, 3, 10);
    let labels: Vec<&str> = result["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["label"].as_str())
        .collect();
    assert!(
        !labels.contains(&"array_find"),
        "an 8.1 project is not offered 8.4 functions: {labels:?}"
    );

    let text = "<?php\nnamespace App;\nfunction f() {\n    strl\n}\n";
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 3 }, "contentChanges": [{ "text": text }] }),
    );
    let result = client.at("textDocument/completion", &uri, 3, 8);
    let strlen = result["items"]
        .as_array()
        .expect("items")
        .iter()
        .find(|item| item["label"] == "strlen")
        .cloned()
        .expect("strlen");
    assert_eq!(strlen["detail"], "(string $string): int");
    assert!(
        strlen["additionalTextEdits"].is_null(),
        "global functions need no import"
    );
    client.shutdown();
}

#[test]
fn stubs_follow_the_extensions_the_project_requires() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    client.open(&uri, "<?php\nnew Redi\n");
    let result = client.at("textDocument/completion", &uri, 1, 8);
    let labels: Vec<&str> = result["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["label"].as_str())
        .collect();
    assert!(labels.contains(&"Redis"), "ext-redis is required: {labels:?}");
    client.notify(
        "textDocument/didChange",
        json!({ "textDocument": { "uri": uri, "version": 2 }, "contentChanges": [{ "text": "<?php\nnew Swoo\n" }] }),
    );
    let result = client.at("textDocument/completion", &uri, 1, 8);
    assert!(
        result["items"].as_array().expect("items").is_empty(),
        "ext-swoole is not"
    );
    client.shutdown();
}

#[test]
fn completes_members_of_an_inferred_type() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f() {\n    $user = User::find(1);\n    $user->\n}\n",
    );
    let result = client.at("textDocument/completion", &uri, 4, 11);
    let items = result["items"].as_array().expect("items");
    let posts = items.iter().find(|item| item["label"] == "posts").expect("posts");
    assert_eq!(posts["kind"], 2);
    assert_eq!(posts["detail"], "(): array");
    assert!(items.iter().any(|item| item["label"] == "name" && item["kind"] == 10));
    client.shutdown();
}

#[test]
fn hovers_and_navigates_across_files() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f() {\n    $user = User::find(1);\n    $user->posts();\n}\n",
    );
    let hover = client.at("textDocument/hover", &uri, 3, 20);
    let text = hover["contents"]["value"].as_str().expect("markdown");
    assert!(
        text.starts_with(
            "**App\\Models\\User::find**\n\n```php\npublic static function find(int $id): ?static\n```\n\nFinds a user."
        ),
        "{text}"
    );
    assert!(text.contains("_Defined in `src/Models/User.php`_"), "{text}");
    assert_eq!(hover["range"]["start"]["line"], 3);

    let definition = client.at("textDocument/definition", &uri, 3, 20);
    assert_eq!(definition[0]["uri"], disk.uri("project/src/Models/User.php"));
    assert_eq!(definition[0]["range"]["start"], json!({ "line": 9, "character": 27 }));

    let type_definition = client.at("textDocument/typeDefinition", &uri, 4, 6);
    assert_eq!(type_definition[0]["uri"], disk.uri("project/src/Models/User.php"));

    let class_definition = client.at("textDocument/definition", &uri, 3, 14);
    assert_eq!(
        class_definition[0]["range"]["start"],
        json!({ "line": 4, "character": 6 })
    );
    client.shutdown();
}

#[test]
fn finds_implementations_and_workspace_symbols() {
    let disk = Disk::new();
    disk.write(
        "project/src/Shapes.php",
        "<?php\nnamespace App;\ninterface Shape { public function area(): float; }\nclass Circle implements Shape { public function area(): float { return 1.0; } }\nclass Square implements Shape { public function area(): float { return 2.0; } }\n",
    );
    let mut client = indexed_server(&disk);
    let shapes = disk.uri("project/src/Shapes.php");
    client.open(
        &shapes,
        &std::fs::read_to_string(disk.path("project/src/Shapes.php")).expect("read"),
    );
    let implementations = client.at("textDocument/implementation", &shapes, 2, 12);
    assert_eq!(implementations.as_array().map(Vec::len), Some(2));
    let methods = client.at("textDocument/implementation", &shapes, 2, 36);
    assert_eq!(methods.as_array().map(Vec::len), Some(2));

    let symbols = client.request("workspace/symbol", json!({ "query": "Circ" }));
    assert_eq!(symbols[0]["name"], "Circle");
    assert_eq!(symbols[0]["containerName"], "App");
    assert_eq!(symbols[0]["location"]["uri"], shapes);
    let widget = client.request("workspace/symbol", json!({ "query": "Widget" }));
    assert_eq!(
        widget[0]["location"]["uri"],
        disk.uri("project/vendor/acme/lib/src/Widget.php")
    );
    client.shutdown();
}

#[test]
fn the_language_level_follows_composer() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Hooks.php");
    client.open(&uri, "<?php\nclass A { public int $x { get => 1; } }\n");
    assert_eq!(
        messages(&client.diagnostics(&uri)),
        ["Property hooks are only available since PHP 8.4"],
        "composer.json says 8.1 and the server's default is the newest"
    );
    client.shutdown();
}

#[test]
fn watched_files_update_the_index() {
    let disk = Disk::new();
    let (mut client, _) = Client::start_in(
        json!({ "window": { "workDoneProgress": true }, "workspace": { "didChangeWatchedFiles": { "dynamicRegistration": true } } }),
        disk.options(),
        json!(disk.uri("project")),
    );
    let registration = client.wait_for(|message| match message {
        Message::Request(request) if request.method == "client/registerCapability" => Some(request.clone()),
        _ => None,
    });
    assert_eq!(
        registration.params["registrations"][0]["method"],
        "workspace/didChangeWatchedFiles"
    );
    client.send(Response::new_ok(registration.id, Value::Null));
    client.wait_for_indexing();

    disk.write("project/src/Fresh.php", "<?php\nnamespace App;\nclass Freshly {}\n");
    client.notify(
        "workspace/didChangeWatchedFiles",
        json!({ "changes": [{ "uri": disk.uri("project/src/Fresh.php"), "type": 1 }] }),
    );
    let found = client.request("workspace/symbol", json!({ "query": "Freshly" }));
    assert_eq!(found[0]["name"], "Freshly");

    std::fs::remove_file(disk.path("project/src/Fresh.php")).expect("removed");
    client.notify(
        "workspace/didChangeWatchedFiles",
        json!({ "changes": [{ "uri": disk.uri("project/src/Fresh.php"), "type": 3 }] }),
    );
    let gone = client.request("workspace/symbol", json!({ "query": "Freshly" }));
    assert_eq!(gone.as_array().map(Vec::len), Some(0));
    client.shutdown();
}

#[test]
fn open_documents_win_over_the_disk() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Models/User.php");
    client.open(
        &uri,
        "<?php\nnamespace App\\Models;\nclass User { public function brandNew(): int {} }\n",
    );
    let page = disk.uri("project/src/Page.php");
    client.open(
        &page,
        "<?php\nuse App\\Models\\User;\nfunction f(User $u) {\n    $u->\n}\n",
    );
    let result = client.at("textDocument/completion", &page, 3, 8);
    let labels: Vec<&str> = result["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["label"].as_str())
        .collect();
    assert!(labels.contains(&"brandNew") && !labels.contains(&"posts"), "{labels:?}");
    client.shutdown();
}

#[test]
fn reads_a_class_that_composer_points_at_but_the_index_skipped() {
    let disk = Disk::new();
    disk.write(
        "project/composer.json",
        r#"{"autoload":{"psr-4":{"App\\":"src/","Hidden\\":".hidden/src/"}}}"#,
    );
    disk.write(
        "project/.hidden/src/Thing.php",
        "<?php\nnamespace Hidden;\n/** Found through the autoload map. */\nclass Thing {}\n",
    );
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    client.open(&uri, "<?php\nnew \\Hidden\\Thing();\n");
    let hover = client.at("textDocument/hover", &uri, 1, 12);
    let text = hover["contents"]["value"].as_str().expect("markdown");
    assert!(text.contains("Found through the autoload map."), "{text}");
    let definition = client.at("textDocument/definition", &uri, 1, 12);
    assert_eq!(definition[0]["uri"], disk.uri("project/.hidden/src/Thing.php"));
    client.shutdown();
}

#[test]
fn finds_usages_and_highlights_across_the_project() {
    let disk = Disk::new();
    disk.write(
        "project/src/Controller.php",
        "<?php\nnamespace App;\n\nuse App\\Models\\User;\n\nclass Controller\n{\n    public function show(int $id): ?User\n    {\n        $user = User::find($id);\n        return $user;\n    }\n}\n",
    );
    let mut client = indexed_server(&disk);
    let page = disk.uri("project/src/Page.php");
    client.open(
        &page,
        "<?php\nuse App\\Models\\User;\nfunction f(User $u) { return $u->name; }\n",
    );
    let found = client.request(
        "textDocument/references",
        json!({
            "textDocument": { "uri": page },
            "position": { "line": 2, "character": 12 },
            "context": { "includeDeclaration": true }
        }),
    );
    let mut places: Vec<String> = found
        .as_array()
        .expect("locations")
        .iter()
        .map(|location| {
            format!(
                "{}:{}",
                location["uri"]
                    .as_str()
                    .unwrap_or_default()
                    .rsplit('/')
                    .next()
                    .unwrap_or_default(),
                location["range"]["start"]["line"]
            )
        })
        .collect();
    places.sort();
    assert_eq!(
        places,
        [
            "Controller.php:3",
            "Controller.php:7",
            "Controller.php:9",
            "Page.php:1",
            "Page.php:2",
            "User.php:4"
        ]
    );
    let without = client.request(
        "textDocument/references",
        json!({
            "textDocument": { "uri": page },
            "position": { "line": 2, "character": 12 },
            "context": { "includeDeclaration": false }
        }),
    );
    assert_eq!(without.as_array().map(Vec::len), Some(5));

    let highlights = client.at("textDocument/documentHighlight", &page, 2, 12);
    let kinds: Vec<(i64, i64)> = highlights
        .as_array()
        .expect("highlights")
        .iter()
        .map(|item| {
            (
                item["range"]["start"]["line"].as_i64().unwrap_or(-1),
                item["kind"].as_i64().unwrap_or(-1),
            )
        })
        .collect();
    assert_eq!(kinds, [(1, 1), (2, 1)]);
    let variable = client.at("textDocument/documentHighlight", &page, 2, 14);
    assert_eq!(variable.as_array().map(Vec::len), Some(2));
    client.shutdown();
}

#[test]
fn renames_a_class_and_moves_its_file() {
    let disk = Disk::new();
    let mut client = {
        let capabilities = json!({
            "window": { "workDoneProgress": true },
            "workspace": { "workspaceEdit": { "documentChanges": true, "resourceOperations": ["rename"] } }
        });
        let (mut client, _) = Client::start_in(capabilities, disk.options(), json!(disk.uri("project")));
        client.wait_for_indexing();
        client
    };
    let page = disk.uri("project/src/Page.php");
    client.open(&page, "<?php\nuse App\\Models\\User;\nfunction f(User $u) {}\n");
    let prepared = client.at("textDocument/prepareRename", &page, 2, 12);
    assert_eq!(prepared["placeholder"], "User");
    let edit = client.request(
        "textDocument/rename",
        json!({ "textDocument": { "uri": page }, "position": { "line": 2, "character": 12 }, "newName": "Member" }),
    );
    let changes = edit["documentChanges"].as_array().expect("document changes");
    let rename = changes
        .iter()
        .find(|change| change["kind"] == "rename")
        .expect("a file rename");
    assert_eq!(rename["oldUri"], disk.uri("project/src/Models/User.php"));
    assert_eq!(rename["newUri"], disk.uri("project/src/Models/Member.php"));
    let page_edit = changes
        .iter()
        .find(|change| change["textDocument"]["uri"] == page)
        .expect("edits of the open page");
    assert_eq!(page_edit["textDocument"]["version"], 1);
    assert_eq!(page_edit["edits"].as_array().map(Vec::len), Some(2));
    assert_eq!(page_edit["edits"][0]["newText"], "Member");
    let user_edit = changes
        .iter()
        .find(|change| change["textDocument"]["uri"] == disk.uri("project/src/Models/User.php"))
        .expect("edits of the declaring file");
    assert!(user_edit["textDocument"]["version"].is_null());
    assert_eq!(rename_order(changes), "edits first");

    let refused = client.request_error(
        "textDocument/rename",
        json!({ "textDocument": { "uri": page }, "position": { "line": 2, "character": 12 }, "newName": "class" }),
    );
    assert_eq!(refused, "'class' is a reserved word");
    client.shutdown();
}

fn rename_order(changes: &[Value]) -> &'static str {
    let last_edit = changes.iter().rposition(|change| change.get("textDocument").is_some());
    let rename = changes.iter().position(|change| change["kind"] == "rename");
    match (last_edit, rename) {
        (Some(edit), Some(rename)) if edit < rename => "edits first",
        _ => "wrong order",
    }
}

#[test]
fn a_client_without_documentchanges_gets_plain_changes() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let page = disk.uri("project/src/Page.php");
    client.open(
        &page,
        "<?php\nuse App\\Models\\User;\nfunction f(User $u) { return $u->name; }\n",
    );
    let edit = client.request(
        "textDocument/rename",
        json!({ "textDocument": { "uri": page }, "position": { "line": 2, "character": 34 }, "newName": "length" }),
    );
    assert!(edit["documentChanges"].is_null());
    let changes = edit["changes"].as_object().expect("changes");
    assert_eq!(changes.len(), 2);
    assert_eq!(
        changes[&disk.uri("project/src/Models/User.php")][0]["newText"],
        "$length"
    );
    assert_eq!(changes[&page][0]["newText"], "length");
    client.shutdown();
}

#[test]
fn offers_signature_help_for_the_call_under_the_cursor() {
    let disk = Disk::new();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/src/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f() {\n    User::find(1);\n    strlen('');\n}\n",
    );
    let help = client.at("textDocument/signatureHelp", &uri, 3, 15);
    assert_eq!(help["signatures"][0]["label"], "find(int $id): ?static");
    assert_eq!(help["signatures"][0]["parameters"][0]["label"], "int $id");
    assert_eq!(help["activeParameter"], 0);
    assert_eq!(help["signatures"][0]["documentation"]["value"], "Finds a user.");
    let outside = client.at("textDocument/signatureHelp", &uri, 2, 5);
    assert!(outside.is_null());
    let builtin = client.at("textDocument/signatureHelp", &uri, 4, 11);
    assert_eq!(builtin["signatures"][0]["label"], "strlen(string $string): int");
    client.shutdown();
}

#[test]
fn walks_call_and_type_hierarchies() {
    let disk = Disk::new();
    disk.write(
        "project/src/Controller.php",
        "<?php\nnamespace App;\n\nuse App\\Models\\User;\n\nclass Controller\n{\n    public function show(int $id): ?User\n    {\n        return User::find($id);\n    }\n}\n",
    );
    disk.write(
        "project/src/Admin.php",
        "<?php\nnamespace App;\n\nuse App\\Models\\User;\n\nclass Admin extends User {}\n",
    );
    let mut client = indexed_server(&disk);
    let user = disk.uri("project/src/Models/User.php");
    client.open(
        &user,
        &std::fs::read_to_string(disk.path("project/src/Models/User.php")).expect("read"),
    );

    let prepared = client.at("textDocument/prepareCallHierarchy", &user, 9, 30);
    let item = prepared[0].clone();
    assert_eq!(item["name"], "find");
    assert_eq!(item["detail"], "App\\Models\\User");
    let incoming = client.request("callHierarchy/incomingCalls", json!({ "item": item }));
    assert_eq!(incoming[0]["from"]["name"], "show");
    assert_eq!(incoming[0]["from"]["detail"], "App\\Controller");
    assert_eq!(
        incoming[0]["fromRanges"][0]["start"],
        json!({ "line": 9, "character": 21 })
    );

    let show = client.request("callHierarchy/outgoingCalls", json!({ "item": incoming[0]["from"] }));
    assert_eq!(show[0]["to"]["name"], "find");
    assert_eq!(show[0]["to"]["uri"], user);

    let types = client.at("textDocument/prepareTypeHierarchy", &user, 4, 8);
    assert_eq!(types[0]["name"], "User");
    let subtypes = client.request("typeHierarchy/subtypes", json!({ "item": types[0] }));
    assert_eq!(subtypes[0]["name"], "Admin");
    let supertypes = client.request("typeHierarchy/supertypes", json!({ "item": subtypes[0] }));
    assert_eq!(supertypes[0]["name"], "User");
    client.shutdown();
}

#[test]
fn serves_semantic_tokens_in_the_delta_encoding_of_its_legend() {
    let disk = Disk::new();
    let (mut client, result) = Client::start_in(PROGRESS_CAPABILITIES(), disk.options(), json!(disk.uri("project")));
    client.wait_for_indexing();
    let legend = &result["capabilities"]["semanticTokensProvider"]["legend"];
    let types: Vec<&str> = legend["tokenTypes"]
        .as_array()
        .expect("types")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let modifiers: Vec<&str> = legend["tokenModifiers"]
        .as_array()
        .expect("modifiers")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(result["capabilities"]["semanticTokensProvider"]["range"], true);
    assert_eq!(result["capabilities"]["semanticTokensProvider"]["full"], true);
    assert!(types.contains(&"class") && types.contains(&"method") && types.contains(&"parameter"));
    assert!(modifiers.contains(&"static") && modifiers.contains(&"defaultLibrary"));

    let uri = disk.uri("project/src/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f(User $u) {\n    return User::find(1);\n}\n",
    );
    let tokens = client.request(
        "textDocument/semanticTokens/full",
        json!({ "textDocument": { "uri": uri } }),
    );
    let data: Vec<u64> = tokens["data"]
        .as_array()
        .expect("data")
        .iter()
        .filter_map(Value::as_u64)
        .collect();
    let mut decoded = Vec::new();
    let (mut line, mut start) = (0, 0);
    for token in data.chunks(5) {
        line += token[0];
        start = if token[0] == 0 { start + token[1] } else { token[1] };
        let mods: Vec<&str> = modifiers
            .iter()
            .enumerate()
            .filter(|(bit, _)| token[4] & (1 << bit) != 0)
            .map(|(_, name)| *name)
            .collect();
        decoded.push(format!(
            "{line}:{start}+{} {} {}",
            token[2],
            types[token[3] as usize],
            mods.join(",")
        ));
    }
    assert_eq!(
        decoded,
        [
            "1:4+10 namespace ",
            "1:15+4 class ",
            "2:9+1 function declaration",
            "2:11+4 class ",
            "2:16+2 parameter declaration",
            "3:11+4 class ",
            "3:17+4 method static",
        ]
    );
    let ranged = client.request(
        "textDocument/semanticTokens/range",
        json!({
            "textDocument": { "uri": uri },
            "range": { "start": { "line": 3, "character": 0 }, "end": { "line": 4, "character": 0 } }
        }),
    );
    assert_eq!(ranged["data"].as_array().map(Vec::len), Some(10));
    client.shutdown();
}
