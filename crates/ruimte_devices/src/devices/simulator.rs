use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;

use super::{
    DeviceError,
    backend::{DeviceBackend, DeviceSource},
    command,
    helper::{HelperSource, simulator_command},
    model::{
        DeviceAction, DeviceCapabilities, DeviceInfo, DeviceKind, DeviceState, Platform,
        settings_from_outputs,
    },
};
use crate::streams::LiveFormat;

pub struct SimulatorBackend {
    home: PathBuf,
}

impl SimulatorBackend {
    pub fn new(home: PathBuf) -> Self {
        Self { home }
    }

    async fn simctl(
        &self,
        arguments: &[String],
        stdin: Option<&str>,
    ) -> Result<command::CommandOutput, DeviceError> {
        let mut command = vec!["simctl".to_owned()];
        command.extend_from_slice(arguments);
        command::run(
            Path::new("/usr/bin/xcrun"),
            &command,
            stdin,
            "simctl-unavailable",
            "Xcode and simctl are required for iOS simulators",
            "simctl-failed",
            "simctl failed",
        )
        .await
    }

    async fn find(&self, device_id: &str) -> Result<DeviceInfo, DeviceError> {
        self.list()
            .await?
            .into_iter()
            .find(|device| device.device_id == device_id)
            .ok_or_else(|| {
                DeviceError::new(
                    "device-not-found",
                    "The iOS simulator is no longer available",
                )
            })
    }

    fn ax_helper(&self) -> Option<PathBuf> {
        let executable = std::env::current_exe().ok()?;
        let release = executable.parent()?.join("native/serve-sim-ax-settings");
        if release.is_file() {
            return Some(release);
        }
        if cfg!(debug_assertions) {
            let modules = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/.bun");
            let entries = std::fs::read_dir(modules).ok()?;
            for entry in entries.flatten() {
                if !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("serve-sim@")
                {
                    continue;
                }
                let candidate = entry
                    .path()
                    .join("node_modules/serve-sim/dist/simax/serve-sim-ax-settings");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        None
    }
}

#[async_trait]
impl DeviceBackend for SimulatorBackend {
    fn id(&self) -> &'static str {
        "simctl"
    }
    fn platform(&self) -> Platform {
        Platform::Ios
    }

    async fn list(&self) -> Result<Vec<DeviceInfo>, DeviceError> {
        let output = self
            .simctl(&strings(&["list", "devices", "available", "--json"]), None)
            .await?;
        let parsed: SimulatorList = serde_json::from_str(&output.stdout).map_err(|_| {
            DeviceError::new(
                "invalid-simctl-output",
                "simctl returned a device list Ruimte could not read",
            )
        })?;
        if parsed
            .devices
            .values()
            .flatten()
            .any(|device| device.udid.is_empty() || device.name.is_empty())
        {
            return Err(DeviceError::new(
                "invalid-simctl-output",
                "simctl returned a device list Ruimte could not read",
            ));
        }
        let available = simulator_command(&self.home).is_some();
        let mut result = Vec::new();
        for (runtime, devices) in parsed.devices {
            if !runtime.contains(".iOS-") {
                continue;
            }
            for device in devices.into_iter().filter(|device| device.is_available) {
                result.push(DeviceInfo {
                    device_id: device.udid,
                    backend_id: self.id().into(),
                    platform: Platform::Ios,
                    kind: DeviceKind::Simulator,
                    name: device.name,
                    runtime: runtime_name(&runtime),
                    state: state_of(&device.state),
                    capabilities: DeviceCapabilities {
                        boot: true,
                        shutdown: true,
                        stream: available,
                        input: available,
                        screenshot: true,
                    },
                });
            }
        }
        Ok(result)
    }

    async fn boot(&self, device_id: &str) -> Result<DeviceInfo, DeviceError> {
        let current = self.find(device_id).await?;
        if current.state != DeviceState::Booted {
            self.simctl(&strings(&["boot", device_id]), None).await?;
        }
        self.find(device_id).await
    }

    async fn shutdown(&self, device_id: &str) -> Result<DeviceInfo, DeviceError> {
        let current = self.find(device_id).await?;
        if current.state != DeviceState::Shutdown {
            self.simctl(&strings(&["shutdown", device_id]), None)
                .await?;
        }
        self.find(device_id).await
    }

    async fn detail(&self, device_id: &str) -> Result<Value, DeviceError> {
        let read = |arguments: Vec<String>| async move {
            self.simctl(&arguments, None)
                .await
                .ok()
                .map(|output| output.stdout.trim().to_lowercase())
        };
        let ax_helper = self.ax_helper();
        let (appearance, content_size, contrast, ax) = tokio::join!(
            read(strings(&["ui", device_id, "appearance"])),
            read(strings(&["ui", device_id, "content_size"])),
            read(strings(&["ui", device_id, "increase_contrast"])),
            async {
                match ax_helper.as_ref() {
                    Some(helper) => {
                        read(strings(&[
                            "spawn",
                            device_id,
                            &helper.to_string_lossy(),
                            "status",
                        ]))
                        .await
                    }
                    None => None,
                }
            }
        );
        let ax_value = ax
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok());
        Ok(settings_from_outputs(
            appearance.as_deref(),
            content_size.as_deref(),
            contrast.as_deref(),
            ax_value.as_ref(),
        ))
    }

    async fn action(&self, action: &DeviceAction) -> Result<Value, DeviceError> {
        let helper = self.ax_helper();
        let (arguments, stdin) = action
            .simulator_arguments(
                helper
                    .as_deref()
                    .map(|path| path.to_string_lossy())
                    .as_deref(),
            )
            .map_err(|reason| {
                if reason == "accessibility helper unavailable" {
                    DeviceError::new(
                        "device-action-unavailable",
                        "The simulator accessibility helper is not installed",
                    )
                } else {
                    DeviceError::new(
                        "device-action-unavailable",
                        "This setting is not available for iOS simulators",
                    )
                }
            })?;
        self.simctl(&arguments, stdin.as_deref()).await?;
        self.detail(&action.target().device_id).await
    }

    fn create_source(&self, device_id: &str) -> Result<Arc<dyn DeviceSource>, DeviceError> {
        let command = simulator_command(&self.home).ok_or_else(|| {
            DeviceError::new(
                "device-capture-unavailable",
                "The native iOS simulator helper is not installed",
            )
        })?;
        Ok(Arc::new(HelperSource::new(
            command,
            device_id.into(),
            LiveFormat::Jpeg,
            Duration::from_millis(500),
        )))
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn state_of(value: &str) -> DeviceState {
    match value {
        "Booted" => DeviceState::Booted,
        "Shutdown" => DeviceState::Shutdown,
        _ => DeviceState::Transitioning,
    }
}

fn runtime_name(identifier: &str) -> String {
    let value = identifier.trim_start_matches("com.apple.CoreSimulator.SimRuntime.");
    let mut parts = value.rsplitn(3, '-');
    let minor = parts.next();
    let major = parts.next();
    let name = parts.next();
    match (name, major, minor) {
        (Some(name), Some(major), Some(minor))
            if major.chars().all(|value| value.is_ascii_digit())
                && minor.chars().all(|value| value.is_ascii_digit()) =>
        {
            format!("{} {}.{}", name.replace('-', " "), major, minor)
        }
        _ => value.to_owned(),
    }
}

#[derive(Deserialize)]
struct SimulatorList {
    devices: std::collections::HashMap<String, Vec<SimulatorDevice>>,
}

#[derive(Deserialize)]
struct SimulatorDevice {
    udid: String,
    #[serde(rename = "isAvailable")]
    is_available: bool,
    state: String,
    name: String,
}
