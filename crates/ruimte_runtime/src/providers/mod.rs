use std::{collections::HashMap, process::Command, sync::Arc, time::Duration};

use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

use crate::rpc::RpcResult;

const DETECTION_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct ProvidersService {
    cache: Arc<Mutex<HashMap<String, CachedDetection>>>,
}

struct CachedDetection {
    at: tokio::time::Instant,
    installed: bool,
    version: Option<String>,
}

struct Provider {
    kind: &'static str,
    name: &'static str,
    command: &'static str,
    resume_command: &'static str,
    manifest: Option<&'static str>,
    capabilities: Value,
}

impl ProvidersService {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn dispatch(&self, method: &str, _payload: Value) -> Option<RpcResult> {
        if method == "provider.list" {
            Some(Ok(self.list().await))
        } else {
            None
        }
    }

    pub async fn list(&self) -> Value {
        let mut result = Vec::new();
        for provider in providers() {
            let (installed, version) = self.detect(provider.command).await;
            let (models, default_model) = provider
                .manifest
                .map(catalog)
                .unwrap_or_else(|| (Vec::new(), None));
            result.push(json!({
                "kind": provider.kind,
                "name": provider.name,
                "installed": installed,
                "version": version,
                "models": models,
                "defaultModel": default_model,
                "capabilities": provider.capabilities,
                "resumeCommand": provider.resume_command,
            }));
        }
        json!({ "providers": result })
    }

    pub fn normalize_selection(&self, provider: &str, selection: Option<&Value>) -> Value {
        let manifest = match provider {
            "codex" => serde_json::from_str::<Value>(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/codex-models.json"
            )))
            .expect("Codex model manifest"),
            _ => serde_json::from_str::<Value>(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/claude-models.json"
            )))
            .expect("Claude model manifest"),
        };
        normalize(&manifest, selection)
    }

    pub fn context_window(&self, provider: &str, selection: &Value) -> Option<u64> {
        let manifest = match provider {
            "codex" => serde_json::from_str::<Value>(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/codex-models.json"
            )))
            .ok()?,
            _ => serde_json::from_str::<Value>(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/claude-models.json"
            )))
            .ok()?,
        };
        let model = selection.get("model")?.as_str()?;
        let profile = profile(&manifest, model)?;
        let selected = selection
            .pointer("/options/contextWindow")
            .and_then(Value::as_str);
        selected
            .and_then(|value| profile.pointer(&format!("/contextWindowTokens/{value}")))
            .or_else(|| profile.pointer("/contextWindowTokens/*"))
            .and_then(Value::as_u64)
    }

    async fn detect(&self, command: &str) -> (bool, Option<String>) {
        if let Some(cached) = self.cache.lock().await.get(command)
            && cached.at.elapsed() < DETECTION_TTL
        {
            return (cached.installed, cached.version.clone());
        }
        let executable = command.to_owned();
        let detection = tokio::task::spawn_blocking(move || {
            let output = Command::new(executable)
                .arg("--version")
                .env_remove("RUIMTE_HOOK_URL")
                .env_remove("RUIMTE_HOOK_TOKEN")
                .env_remove("RUIMTE_CONTEXT_URL")
                .env_remove("RUIMTE_CONTEXT_TOKEN")
                .env_remove("RUIMTE_SESSION_ID")
                .output();
            match output {
                Ok(output) if output.status.success() => {
                    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                    let version = text
                        .split(|character: char| !character.is_ascii_digit() && character != '.')
                        .find(|part| {
                            part.split('.').count() >= 3
                                && part
                                    .chars()
                                    .all(|character| character.is_ascii_digit() || character == '.')
                        })
                        .filter(|part| !part.is_empty())
                        .map(str::to_owned)
                        .or_else(|| (!text.is_empty()).then_some(text));
                    (true, version)
                }
                _ => (false, None),
            }
        })
        .await
        .unwrap_or((false, None));
        let (installed, version) = detection;
        self.cache.lock().await.insert(
            command.to_owned(),
            CachedDetection {
                at: tokio::time::Instant::now(),
                installed,
                version: version.clone(),
            },
        );
        (installed, version)
    }
}

impl Default for ProvidersService {
    fn default() -> Self {
        Self::new()
    }
}

fn catalog(raw: &str) -> (Vec<Value>, Option<String>) {
    let manifest: Value = serde_json::from_str(raw).expect("model manifest");
    let default_model = manifest
        .get("defaultModel")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let models = manifest
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|model| {
            let slug = model
                .get("slug")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let mut entry = Map::from_iter([
                ("slug".to_owned(), json!(slug)),
                (
                    "name".to_owned(),
                    json!(
                        model
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    ),
                ),
                (
                    "legacy".to_owned(),
                    json!(
                        model
                            .get("legacy")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    ),
                ),
                (
                    "isDefault".to_owned(),
                    json!(default_model.as_deref() == Some(slug)),
                ),
                (
                    "options".to_owned(),
                    profile(&manifest, slug)
                        .and_then(|profile| profile.get("options"))
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                ),
            ]);
            if let Some(badge) = model.get("badge") {
                entry.insert("badge".to_owned(), badge.clone());
            }
            Value::Object(entry)
        })
        .collect();
    (models, default_model)
}

fn normalize(manifest: &Value, selection: Option<&Value>) -> Value {
    let requested = selection
        .and_then(|selection| selection.get("model"))
        .and_then(Value::as_str);
    let models = manifest.get("models").and_then(Value::as_array);
    let model = models
        .into_iter()
        .flatten()
        .find(|entry| {
            entry.get("slug").and_then(Value::as_str) == requested
                || entry
                    .get("aliases")
                    .and_then(Value::as_array)
                    .is_some_and(|aliases| aliases.iter().any(|alias| alias.as_str() == requested))
        })
        .and_then(|entry| entry.get("slug"))
        .and_then(Value::as_str)
        .or_else(|| manifest.get("defaultModel").and_then(Value::as_str))
        .unwrap_or_default();
    let given = selection
        .and_then(|selection| selection.get("options"))
        .and_then(Value::as_object);
    let mut options = Map::new();
    for descriptor in profile(manifest, model)
        .and_then(|profile| profile.get("options"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = descriptor.get("id").and_then(Value::as_str) else {
            continue;
        };
        let selected = given.and_then(|given| given.get(id));
        let value = if descriptor.get("type").and_then(Value::as_str) == Some("select") {
            selected
                .filter(|value| {
                    descriptor
                        .get("choices")
                        .and_then(Value::as_array)
                        .is_some_and(|choices| {
                            choices.iter().any(|choice| choice.get("id") == Some(value))
                        })
                })
                .cloned()
                .or_else(|| descriptor.get("defaultChoice").cloned())
        } else {
            selected
                .filter(|value| value.is_boolean())
                .cloned()
                .or_else(|| descriptor.get("defaultValue").cloned())
        };
        if let Some(value) = value {
            options.insert(id.to_owned(), value);
        }
    }
    json!({ "model": model, "options": options })
}

fn profile<'a>(manifest: &'a Value, model: &str) -> Option<&'a Value> {
    let profile = manifest
        .get("models")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("slug").and_then(Value::as_str) == Some(model))?
        .get("profile")?
        .as_str()?;
    manifest.get("profiles")?.get(profile)
}

fn providers() -> Vec<Provider> {
    let terminal = json!({
        "chat": false, "terminal": true, "hooks": false, "streamsToolOutput": false,
        "diffs": "none", "attachments": false, "mentions": false, "denyReason": false,
        "allowAlways": false, "asyncQuestions": false, "compaction": "none",
        "reportsCost": false, "reportsContextWindow": false, "reportsThinking": false,
        "slashCommands": false,
    });
    vec![
        Provider {
            kind: "claude",
            name: "Claude Code",
            command: "claude",
            resume_command: "claude {flags} --resume {id}",
            manifest: Some(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/claude-models.json"
            ))),
            capabilities: json!({
                "chat": true, "terminal": true, "hooks": true, "streamsToolOutput": false,
                "diffs": "before-after", "attachments": true, "mentions": true,
                "denyReason": true, "allowAlways": true, "asyncQuestions": false,
                "compaction": "prompt", "reportsCost": true, "reportsContextWindow": true,
                "reportsThinking": true, "slashCommands": true,
            }),
        },
        Provider {
            kind: "codex",
            name: "Codex",
            command: "codex",
            resume_command: "codex resume {flags} {id}",
            manifest: Some(include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/data/codex-models.json"
            ))),
            capabilities: json!({
                "chat": true, "terminal": true, "hooks": true, "streamsToolOutput": true,
                "diffs": "unified", "attachments": true, "mentions": true,
                "denyReason": false, "allowAlways": true, "asyncQuestions": true,
                "compaction": "native", "reportsCost": false, "reportsContextWindow": true,
                "reportsThinking": true, "slashCommands": false,
            }),
        },
        Provider {
            kind: "gemini",
            name: "Gemini",
            command: "gemini",
            resume_command: "gemini {flags} --resume {id}",
            manifest: None,
            capabilities: terminal.clone(),
        },
        Provider {
            kind: "copilot",
            name: "GitHub Copilot",
            command: "copilot",
            resume_command: "copilot {flags} --resume={id}",
            manifest: None,
            capabilities: terminal,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aliases_and_defaults_normalize_from_checked_in_catalogs() {
        let service = ProvidersService::new();
        assert_eq!(
            service.normalize_selection("codex", Some(&json!({ "model": "sol", "options": {} })))["model"],
            "gpt-5.6-sol"
        );
        assert_eq!(
            service.normalize_selection("claude", None)["model"],
            "claude-sonnet-5"
        );
    }
}
