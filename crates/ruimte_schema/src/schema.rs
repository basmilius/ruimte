use std::{collections::HashMap, sync::OnceLock};

use serde_json::Value;

use crate::rpc::RpcError;

static CONTRACTS: OnceLock<Value> = OnceLock::new();
static VALIDATORS: OnceLock<HashMap<String, jsonschema::Validator>> = OnceLock::new();
static ENDPOINT_ICON_VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();

fn contracts() -> &'static Value {
    CONTRACTS.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/schema/contracts.json"
        )))
        .expect("generated contract schema must be valid JSON")
    })
}

pub fn is_endpoint_icon(value: &Value) -> bool {
    ENDPOINT_ICON_VALIDATOR
        .get_or_init(|| {
            let schema = contracts()
                .pointer("/requests/endpoint.setIdentity/payload/properties/icon")
                .expect("generated endpoint icon schema");
            jsonschema::validator_for(schema).expect("generated endpoint icon schema compiles")
        })
        .is_valid(value)
}

pub fn normalize_request(method: &str, mut payload: Value) -> Result<Value, RpcError> {
    let schema = contracts()
        .get("requests")
        .and_then(|requests| requests.get(method))
        .and_then(|request| request.get("payload"))
        .ok_or_else(|| {
            RpcError::new("unknown-request", format!("Unknown request type: {method}"))
        })?;
    preprocess(method, &mut payload);
    normalize(schema, schema, &mut payload);
    let validator = validators().get(method).ok_or_else(|| {
        RpcError::new("unknown-request", format!("Unknown request type: {method}"))
    })?;
    if validator.is_valid(&payload)
        && zod_string_lengths_hold(schema, schema, &payload)
        && refinements_hold(method, &payload)
    {
        Ok(payload)
    } else {
        Err(RpcError::new(
            "bad-request",
            format!("Invalid payload for {method}"),
        ))
    }
}

fn zod_string_lengths_hold(root: &Value, schema: &Value, value: &Value) -> bool {
    let schema = resolve(root, schema);
    if let Some(branches) = schema
        .get("anyOf")
        .or_else(|| schema.get("oneOf"))
        .and_then(Value::as_array)
    {
        return branches.iter().any(|branch| {
            shape_matches(resolve(root, branch), value)
                && zod_string_lengths_hold(root, branch, value)
        });
    }
    if let Some(text) = value.as_str() {
        let length = text.encode_utf16().count() as u64;
        if schema
            .get("x-zod-minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| length < minimum)
            || schema
                .get("x-zod-maxLength")
                .and_then(Value::as_u64)
                .is_some_and(|maximum| length > maximum)
        {
            return false;
        }
    }
    match value {
        Value::Object(object) => {
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                for (key, property) in properties {
                    if let Some(value) = object.get(key)
                        && !zod_string_lengths_hold(root, property, value)
                    {
                        return false;
                    }
                }
            }
            if let Some(additional) = schema
                .get("additionalProperties")
                .filter(|value| value.is_object())
            {
                for (key, value) in object {
                    if schema
                        .get("properties")
                        .and_then(Value::as_object)
                        .is_none_or(|properties| !properties.contains_key(key))
                        && !zod_string_lengths_hold(root, additional, value)
                    {
                        return false;
                    }
                }
            }
        }
        Value::Array(values) => {
            if let Some(items) = schema.get("items") {
                return values
                    .iter()
                    .all(|value| zod_string_lengths_hold(root, items, value));
            }
        }
        _ => {}
    }
    true
}

fn refinements_hold(method: &str, payload: &Value) -> bool {
    match method {
        "session.attach" => {
            let has_cols = payload.get("cols").is_some();
            let has_rows = payload.get("rows").is_some();
            has_cols == has_rows && (payload.get("follow") == Some(&Value::Bool(true)) || has_cols)
        }
        "chat.send" => {
            payload
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| !text.trim().is_empty())
                || payload
                    .get("attachments")
                    .and_then(Value::as_array)
                    .is_some_and(|attachments| !attachments.is_empty())
        }
        _ => true,
    }
}

fn preprocess(method: &str, payload: &mut Value) {
    if method == "device.action"
        && let Some(object) = payload.as_object_mut()
    {
        for key in ["appId", "url"] {
            if let Some(Value::String(value)) = object.get_mut(key) {
                *value = value.trim().to_owned();
            }
        }
    }
    if method != "project.save" {
        return;
    }
    let Some(views) = payload
        .pointer_mut("/content/views")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for view in views {
        preprocess_view(view);
    }
}

fn preprocess_view(view: &mut Value) {
    const KNOWN_VIEWS: &[&str] = &[
        "canvas",
        "chat",
        "terminal",
        "browser",
        "device",
        "drawing",
        "diagram",
        "file",
        "separator",
    ];
    let Some(object) = view.as_object_mut() else {
        return;
    };
    let Some(kind) = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    if kind == "unknown" {
        if let Some(raw) = object.get("raw").cloned() {
            *view = raw;
            preprocess_view(view);
        }
        return;
    }
    if !KNOWN_VIEWS.contains(&kind.as_str()) {
        let raw = Value::Object(object.clone());
        let Some(id) = object
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
        else {
            return;
        };
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or(&kind)
            .to_owned();
        let created_by = object
            .get("createdBy")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        *view = json_object([
            ("kind", Value::String("unknown".to_owned())),
            ("id", Value::String(id)),
            ("name", Value::String(name)),
            ("raw", raw),
        ]);
        if let Some(created_by) = created_by {
            view.as_object_mut()
                .expect("unknown view object")
                .insert("createdBy".to_owned(), Value::String(created_by));
        }
        return;
    }
    if kind == "canvas"
        && let Some(nodes) = object.get_mut("nodes").and_then(Value::as_array_mut)
    {
        for node in nodes {
            preprocess_node(node);
        }
    }
}

fn preprocess_node(node: &mut Value) {
    const KNOWN_NODES: &[&str] = &[
        "terminal", "chat", "browser", "device", "group", "note", "drawing", "diagram", "file",
    ];
    let Some(object) = node.as_object_mut() else {
        return;
    };
    let Some(kind) = object
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    if kind == "unknown" {
        if let Some(raw) = object.get("raw").cloned() {
            *node = raw;
            preprocess_node(node);
        }
        return;
    }
    if KNOWN_NODES.contains(&kind.as_str()) {
        return;
    }
    let raw = Value::Object(object.clone());
    let Some(id) = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
    else {
        return;
    };
    let finite = |key: &str, fallback: f64| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
            .unwrap_or(fallback)
    };
    let positive = |key: &str, fallback: f64| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .unwrap_or(fallback)
    };
    *node = json_object([
        ("id", Value::String(id)),
        ("kind", Value::String("unknown".to_owned())),
        (
            "title",
            Value::String(
                object
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(&kind)
                    .to_owned(),
            ),
        ),
        ("x", json_number(finite("x", 0.0))),
        ("y", json_number(finite("y", 0.0))),
        ("w", json_number(positive("w", 320.0))),
        ("h", json_number(positive("h", 200.0))),
        ("raw", raw),
    ]);
}

fn json_object<const N: usize>(entries: [(&str, Value); N]) -> Value {
    Value::Object(
        entries
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

fn json_number(value: f64) -> Value {
    if value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64 {
        return Value::Number((value as i64).into());
    }
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn validators() -> &'static HashMap<String, jsonschema::Validator> {
    VALIDATORS.get_or_init(|| {
        contracts()
            .get("requests")
            .and_then(Value::as_object)
            .expect("generated request schemas")
            .iter()
            .map(|(method, request)| {
                let schema = request.get("payload").expect("generated payload schema");
                let validator =
                    jsonschema::validator_for(schema).expect("generated payload schema compiles");
                (method.clone(), validator)
            })
            .collect()
    })
}

fn normalize(root: &Value, schema: &Value, value: &mut Value) {
    let schema = resolve(root, schema);
    if let Some(branches) = schema
        .get("anyOf")
        .or_else(|| schema.get("oneOf"))
        .and_then(Value::as_array)
    {
        for branch in branches {
            let mut candidate = value.clone();
            normalize(root, branch, &mut candidate);
            if shape_matches(resolve(root, branch), &candidate) {
                *value = candidate;
                break;
            }
        }
        return;
    }
    match value {
        Value::Object(object) => {
            let properties = schema.get("properties").and_then(Value::as_object);
            if let Some(properties) = properties {
                if schema.get("additionalProperties").is_none() {
                    object.retain(|key, _| properties.contains_key(key));
                }
                for (key, property) in properties {
                    if let Some(value) = object.get_mut(key) {
                        normalize(root, property, value);
                    } else if let Some(default) = resolve(root, property).get("default") {
                        object.insert(key.clone(), default.clone());
                    }
                }
            } else if let Some(additional) = schema
                .get("additionalProperties")
                .filter(|value| value.is_object())
            {
                for value in object.values_mut() {
                    normalize(root, additional, value);
                }
            }
        }
        Value::Array(values) => {
            if let Some(items) = schema.get("items") {
                for value in values {
                    normalize(root, items, value);
                }
            }
        }
        _ => {}
    }
}

fn shape_matches(schema: &Value, value: &Value) -> bool {
    if let Some(expected) = schema.get("const") {
        return expected == value;
    }
    if let Some(expected) = schema.get("type").and_then(Value::as_str) {
        let matches = match expected {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "number" | "integer" => value.is_number(),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            _ => true,
        };
        if !matches {
            return false;
        }
    }
    if let (Some(required), Some(object)) = (
        schema.get("required").and_then(Value::as_array),
        value.as_object(),
    ) {
        if !required
            .iter()
            .filter_map(Value::as_str)
            .all(|key| object.contains_key(key))
        {
            return false;
        }
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            for (key, property) in properties {
                if let Some(value) = object.get(key)
                    && (property
                        .get("const")
                        .is_some_and(|expected| expected != value)
                        || property
                            .get("enum")
                            .and_then(Value::as_array)
                            .is_some_and(|values| !values.contains(value)))
                {
                    return false;
                }
            }
        }
    }
    true
}

fn resolve<'a>(root: &'a Value, schema: &'a Value) -> &'a Value {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return schema;
    };
    reference
        .strip_prefix("#/")
        .and_then(|path| {
            path.split('/').try_fold(root, |value, part| {
                value.get(part.replace("~1", "/").replace("~0", "~"))
            })
        })
        .unwrap_or(schema)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn rejects_unknown_method_and_invalid_payload() {
        assert_eq!(
            normalize_request("missing", json!({})).unwrap_err().code,
            "unknown-request"
        );
        assert_eq!(
            normalize_request("session.resize", json!({}))
                .unwrap_err()
                .code,
            "bad-request"
        );
    }

    #[test]
    fn strips_unknown_object_keys_like_zod_objects() {
        assert_eq!(
            normalize_request("server.hello", json!({ "extra": true })).unwrap(),
            json!({})
        );
    }

    #[test]
    fn explicit_null_does_not_trigger_a_default() {
        assert_eq!(
            normalize_request(
                "session.attach",
                json!({ "sessionId": "one", "cols": null })
            )
            .unwrap_err()
            .code,
            "bad-request"
        );
    }

    #[test]
    fn generated_schema_matches_the_zod_oracle() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/schema-oracle.json"
        )))
        .unwrap();
        for case in cases {
            let method = case["method"].as_str().unwrap();
            let result = normalize_request(method, case["input"].clone());
            if case["ok"] == Value::Bool(true) {
                let actual = result.unwrap_or_else(|error| {
                    panic!(
                        "accepted case failed for {method}: {} ({error})",
                        case["input"]
                    )
                });
                assert_eq!(
                    actual, case["output"],
                    "accepted case for {method}: {}",
                    case["input"]
                );
            } else {
                assert!(
                    result.is_err(),
                    "rejected case for {method}: {}",
                    case["input"]
                );
            }
        }
    }
}
