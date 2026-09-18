use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "macos", test))]
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Ios,
    Android,
}

impl Platform {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Ios => "iOS",
            Self::Android => "Android",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub backend_id: String,
    pub platform: Platform,
    pub kind: DeviceKind,
    pub name: String,
    pub runtime: String,
    pub state: DeviceState,
    pub capabilities: DeviceCapabilities,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Simulator,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Physical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceState {
    Booted,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Shutdown,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Transitioning,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCapabilities {
    pub boot: bool,
    pub shutdown: bool,
    pub stream: bool,
    pub input: bool,
    pub screenshot: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub device_id: String,
    pub backend_id: String,
    pub platform: Platform,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPayload {
    #[serde(flatten)]
    pub target: Target,
    #[serde(default = "default_stream")]
    pub stream: StreamKind,
}

fn default_stream() -> StreamKind {
    StreamKind::Http
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StreamKind {
    Http,
    Events,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPayload {
    #[serde(flatten)]
    pub target: Target,
    pub input: DeviceInput,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DeviceInput {
    Pointer {
        phase: PointerPhase,
        x: f64,
        y: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        edge: Option<String>,
    },
    MultiPointer {
        phase: PointerPhase,
        first: InputPoint,
        second: InputPoint,
    },
    Scroll {
        delta_x: f64,
        delta_y: f64,
        x: f64,
        y: f64,
    },
    Button {
        button: String,
    },
    Rotate {
        direction: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PointerPhase {
    Down,
    Move,
    Up,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InputPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DeviceAction {
    SetAppearance {
        #[serde(flatten)]
        target: Target,
        value: String,
    },
    SetTextSize {
        #[serde(flatten)]
        target: Target,
        value: String,
    },
    SetToggle {
        #[serde(flatten)]
        target: Target,
        setting: String,
        value: bool,
    },
    SetLiquidGlass {
        #[serde(flatten)]
        target: Target,
        value: String,
    },
    SetColorFilter {
        #[serde(flatten)]
        target: Target,
        value: String,
    },
    SetLocation {
        #[serde(flatten)]
        target: Target,
        latitude: f64,
        longitude: f64,
    },
    ClearLocation {
        #[serde(flatten)]
        target: Target,
    },
    SetPermission {
        #[serde(flatten)]
        target: Target,
        app_id: String,
        permission: String,
        decision: String,
    },
    OpenUrl {
        #[serde(flatten)]
        target: Target,
        url: String,
    },
    LaunchApp {
        #[serde(flatten)]
        target: Target,
        app_id: String,
    },
    TerminateApp {
        #[serde(flatten)]
        target: Target,
        app_id: String,
    },
    SendPush {
        #[serde(flatten)]
        target: Target,
        app_id: String,
        payload: String,
    },
}

impl DeviceAction {
    pub fn target(&self) -> &Target {
        match self {
            Self::SetAppearance { target, .. }
            | Self::SetTextSize { target, .. }
            | Self::SetToggle { target, .. }
            | Self::SetLiquidGlass { target, .. }
            | Self::SetColorFilter { target, .. }
            | Self::SetLocation { target, .. }
            | Self::ClearLocation { target }
            | Self::SetPermission { target, .. }
            | Self::OpenUrl { target, .. }
            | Self::LaunchApp { target, .. }
            | Self::TerminateApp { target, .. }
            | Self::SendPush { target, .. } => target,
        }
    }

    #[cfg(any(target_os = "macos", test))]
    pub fn simulator_arguments(
        &self,
        ax_helper: Option<&str>,
    ) -> Result<(Vec<String>, Option<String>), &'static str> {
        let device = &self.target().device_id;
        let plain = |values: &[&str]| values.iter().map(|value| (*value).to_owned()).collect();
        let result = match self {
            Self::SetAppearance { value, .. } => {
                (plain(&["ui", device, "appearance", value]), None)
            }
            Self::SetTextSize { value, .. } => {
                let value = match value.as_str() {
                    "small" => "small",
                    "default" => "large",
                    "large" => "extra-extra-large",
                    "extra-large" => "accessibility-large",
                    _ => return Err("invalid text size"),
                };
                (plain(&["ui", device, "content_size", value]), None)
            }
            Self::SetToggle { setting, value, .. } if setting == "increaseContrast" => (
                plain(&[
                    "ui",
                    device,
                    "increase_contrast",
                    if *value { "enabled" } else { "disabled" },
                ]),
                None,
            ),
            Self::SetToggle { setting, value, .. } => {
                let option = match setting.as_str() {
                    "reduceMotion" => "reduce-motion",
                    "reduceTransparency" => "reduce-transparency",
                    "showBorders" => "show-borders",
                    "voiceOver" => "voiceover",
                    _ => return Err("unsupported simulator setting"),
                };
                (
                    ax_arguments(
                        device,
                        ax_helper,
                        &["set", option, if *value { "on" } else { "off" }],
                    )?,
                    None,
                )
            }
            Self::SetLiquidGlass { value, .. } => (
                ax_arguments(device, ax_helper, &["set", "liquid-glass", value])?,
                None,
            ),
            Self::SetColorFilter { value, .. } => (
                ax_arguments(device, ax_helper, &["set", "color-filter", value])?,
                None,
            ),
            Self::SetLocation {
                latitude,
                longitude,
                ..
            } => (
                plain(&[
                    "location",
                    device,
                    "set",
                    &format!("{latitude},{longitude}"),
                ]),
                None,
            ),
            Self::ClearLocation { .. } => (plain(&["location", device, "clear"]), None),
            Self::SetPermission {
                app_id,
                permission,
                decision,
                ..
            } => (
                plain(&["privacy", device, decision, permission, app_id.trim()]),
                None,
            ),
            Self::OpenUrl { url, .. } => (plain(&["openurl", device, url.trim()]), None),
            Self::LaunchApp { app_id, .. } => (plain(&["launch", device, app_id.trim()]), None),
            Self::TerminateApp { app_id, .. } => {
                (plain(&["terminate", device, app_id.trim()]), None)
            }
            Self::SendPush {
                app_id, payload, ..
            } => (
                plain(&["push", device, app_id.trim(), "-"]),
                Some(serde_json::json!({ "aps": { "alert": payload } }).to_string()),
            ),
        };
        Ok(result)
    }
}

#[cfg(any(target_os = "macos", test))]
fn ax_arguments(
    device: &str,
    helper: Option<&str>,
    arguments: &[&str],
) -> Result<Vec<String>, &'static str> {
    let helper = helper.ok_or("accessibility helper unavailable")?;
    Ok(["spawn", device, helper]
        .into_iter()
        .chain(arguments.iter().copied())
        .map(str::to_owned)
        .collect())
}

#[cfg(any(target_os = "macos", test))]
pub fn settings_from_outputs(
    appearance: Option<&str>,
    content_size: Option<&str>,
    contrast: Option<&str>,
    ax: Option<&Value>,
) -> Value {
    let mut result = serde_json::Map::new();
    if matches!(appearance, Some("light" | "dark")) {
        result.insert(
            "appearance".into(),
            Value::String(appearance.unwrap().into()),
        );
    }
    if let Some(size) = content_size.filter(|value| !value.is_empty()) {
        let value = if size.starts_with("accessibility") {
            "extra-large"
        } else if size.contains("extra") {
            "large"
        } else if matches!(size, "extra-small" | "small" | "medium") {
            "small"
        } else {
            "default"
        };
        result.insert("textSize".into(), Value::String(value.into()));
    }
    if let Some(value) = contrast.filter(|value| !value.is_empty()) {
        result.insert("increaseContrast".into(), Value::Bool(value == "enabled"));
    }
    if let Some(ax) = ax
        .and_then(Value::as_object)
        .filter(|values| values.values().all(Value::is_string))
    {
        for (source, target) in [
            ("reduce-motion", "reduceMotion"),
            ("reduce-transparency", "reduceTransparency"),
            ("show-borders", "showBorders"),
            ("voiceover", "voiceOver"),
        ] {
            if let Some(value) = ax.get(source).and_then(Value::as_str)
                && matches!(value, "on" | "off")
            {
                result.insert(target.into(), Value::Bool(value == "on"));
            }
        }
        if let Some(value @ ("clear" | "tinted")) = ax.get("liquid-glass").and_then(Value::as_str) {
            result.insert("liquidGlass".into(), Value::String(value.into()));
        }
        if let Some(value @ ("none" | "grayscale" | "red-green" | "green-red" | "blue-yellow")) =
            ax.get("color-filter").and_then(Value::as_str)
        {
            result.insert("colorFilter".into(), Value::String(value.into()));
        }
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulator_settings_and_actions_match_the_typescript_oracle() {
        let oracle: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/device-settings-oracle.json"
        )))
        .expect("oracle is valid JSON");
        for case in oracle["settings"].as_array().expect("settings cases") {
            let input = &case["input"];
            let normalized = |key: &str| {
                input
                    .get(key)
                    .and_then(Value::as_str)
                    .map(|value| value.trim().to_lowercase())
            };
            let actual = settings_from_outputs(
                normalized("appearance").as_deref(),
                normalized("size").as_deref(),
                normalized("contrast").as_deref(),
                input.get("ax"),
            );
            assert_eq!(actual, case["output"], "settings input {input}");
        }

        for case in oracle["actions"].as_array().expect("action cases") {
            let action: DeviceAction =
                serde_json::from_value(case["input"].clone()).expect("valid action");
            let (arguments, stdin) = action
                .simulator_arguments(Some("<AX>"))
                .expect("supported action");
            let mut actual = serde_json::Map::from_iter([(
                "args".into(),
                serde_json::to_value(arguments).expect("arguments serialize"),
            )]);
            if let Some(stdin) = stdin {
                actual.insert("stdin".into(), Value::String(stdin));
            }
            assert_eq!(
                Value::Object(actual),
                case["output"],
                "action input {}",
                case["input"]
            );
        }
    }

    #[test]
    fn device_input_uses_camel_case_wire_fields() {
        let input: DeviceInput = serde_json::from_value(serde_json::json!({
            "kind": "scroll",
            "deltaX": 1.5,
            "deltaY": -2.0,
            "x": 0.25,
            "y": 0.75
        }))
        .expect("camel case input");
        assert_eq!(
            serde_json::to_value(input).expect("input serializes")["deltaX"],
            1.5
        );
    }
}
