//! Refactors through the protocol: the code actions with their edits, the late resolve of the
//! expensive ones, the rename that follows an extract, and the edits that follow a renamed file.

mod common;

use common::*;
use serde_json::{Value, json};

fn range_at(line: u32, from: u32, to: u32) -> Value {
    json!({ "start": { "line": line, "character": from }, "end": { "line": line, "character": to } })
}

fn action<'a>(actions: &'a Value, title: &str) -> &'a Value {
    actions
        .as_array()
        .expect("a list of actions")
        .iter()
        .find(|action| action["title"] == title)
        .unwrap_or_else(|| panic!("no action '{title}' in {actions}"))
}

const PAGE: &str = "<?php\nclass Page\n{\n    public function total(int $a, int $b): int\n    {\n        return ($a + $b) * 2;\n    }\n}\n";

#[test]
fn extracts_a_variable_and_points_at_its_name() {
    let (mut client, _) = Client::start(
        json!({ "workspace": { "workspaceEdit": { "documentChanges": true } } }),
        Value::Null,
    );
    let uri = "file:///project/page.php";
    client.open(uri, PAGE);
    client.diagnostics(uri);
    let actions = client.request(
        "textDocument/codeAction",
        json!({ "textDocument": { "uri": uri }, "range": range_at(5, 16, 23), "context": { "diagnostics": [] } }),
    );
    let extract = action(&actions, "Extract variable");
    assert_eq!(extract["kind"], "refactor.extract");
    let edits = &extract["edit"]["documentChanges"][0]["edits"];
    assert_eq!(edits[0]["newText"], "        $int = $a + $b;\n");
    assert_eq!(edits[0]["range"]["start"], json!({ "line": 5, "character": 0 }));
    assert_eq!(edits[1]["newText"], "$int");
    assert_eq!(extract["command"]["command"], "php.rename");
    assert_eq!(
        extract["command"]["arguments"][0]["position"],
        json!({ "line": 5, "character": 9 }),
        "after the edit the name sits on the line of the declaration"
    );
    client.shutdown();
}

#[test]
fn a_client_with_snippets_gets_the_name_as_a_placeholder() {
    let (mut client, _) = Client::start(
        json!({ "workspace": { "workspaceEdit": { "documentChanges": true, "snippetEditSupport": true } } }),
        Value::Null,
    );
    let uri = "file:///project/page.php";
    client.open(uri, PAGE);
    client.diagnostics(uri);
    let actions = client.request(
        "textDocument/codeAction",
        json!({ "textDocument": { "uri": uri }, "range": range_at(5, 16, 23), "context": { "diagnostics": [] } }),
    );
    let extract = action(&actions, "Extract variable");
    let first = &extract["edit"]["documentChanges"][0]["edits"][0];
    assert_eq!(first["snippet"]["kind"], "snippet");
    assert_eq!(first["snippet"]["value"], "        \\$${1:int} = \\$a + \\$b;\n");
    assert!(extract["command"].is_null(), "the cursor is in the placeholder");
    client.shutdown();
}

#[test]
fn a_client_that_resolves_gets_the_edit_of_a_refactor_late() {
    let (mut client, _) = Client::start(
        json!({ "textDocument": { "codeAction": { "resolveSupport": { "properties": ["edit"] } } } }),
        Value::Null,
    );
    let uri = "file:///project/page.php";
    client.open(uri, PAGE);
    client.diagnostics(uri);
    let actions = client.request(
        "textDocument/codeAction",
        json!({ "textDocument": { "uri": uri }, "range": range_at(5, 16, 23), "context": { "diagnostics": [], "only": ["refactor.extract"] } }),
    );
    let extract = action(&actions, "Extract variable").clone();
    assert!(extract["edit"].is_null(), "the edit waits for the resolve");
    let resolved = client.request("codeAction/resolve", extract);
    assert_eq!(
        resolved["edit"]["changes"][uri][0]["newText"],
        "        $int = $a + $b;\n"
    );
    assert!(resolved["data"].is_null());
    client.shutdown();
}

#[test]
fn a_refusal_comes_back_as_an_error_with_its_reason() {
    let (mut client, _) = Client::start(
        json!({ "textDocument": { "codeAction": { "resolveSupport": { "properties": ["edit"] } } } }),
        Value::Null,
    );
    let uri = "file:///project/page.php";
    client.open(
        uri,
        "<?php\nfunction f($a, $b)\n{\n    return $a && strlen($b) > 1;\n}\n",
    );
    client.diagnostics(uri);
    let actions = client.request(
        "textDocument/codeAction",
        json!({ "textDocument": { "uri": uri }, "range": range_at(3, 17, 31), "context": { "diagnostics": [] } }),
    );
    let extract = action(&actions, "Extract variable").clone();
    let reason = client.request_error("codeAction/resolve", extract);
    assert_eq!(reason, "The expression only runs when the left side allows it");
    client.shutdown();
}
