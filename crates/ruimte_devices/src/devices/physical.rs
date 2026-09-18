use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

use async_trait::async_trait;
use serde::Deserialize;

use super::{
    DeviceError,
    backend::{DeviceBackend, DeviceSource},
    command,
    helper::{HelperSource, physical_command},
    model::{DeviceCapabilities, DeviceInfo, DeviceKind, DeviceState, Platform},
};
use crate::streams::LiveFormat;

pub struct PhysicalBackend {
    _home: PathBuf,
    udids: StdMutex<std::collections::HashMap<String, String>>,
}

impl PhysicalBackend {
    pub fn new(home: PathBuf) -> Self {
        Self {
            _home: home,
            udids: StdMutex::new(std::collections::HashMap::new()),
        }
    }

    async fn devicectl(&self, arguments: &[String]) -> Result<command::CommandOutput, DeviceError> {
        let mut command = vec!["devicectl".to_owned()];
        command.extend_from_slice(arguments);
        command::run(
            Path::new("/usr/bin/xcrun"),
            &command,
            None,
            "devicectl-unavailable",
            "Xcode and devicectl are required for physical iOS devices",
            "devicectl-failed",
            "devicectl failed",
        )
        .await
    }
}

#[async_trait]
impl DeviceBackend for PhysicalBackend {
    fn id(&self) -> &'static str {
        "coredevice"
    }
    fn platform(&self) -> Platform {
        Platform::Ios
    }

    async fn list(&self) -> Result<Vec<DeviceInfo>, DeviceError> {
        let output = self
            .devicectl(&strings(&[
                "list",
                "devices",
                "--filter",
                "properties.hardware.platform = 'iOS' AND properties.hardware.reality = 'physical'",
                "--json-output",
                "-",
                "--omit-deprecated-fields-in-json",
                "--quiet",
                "--timeout",
                "10",
            ]))
            .await?;
        let parsed: PhysicalList = serde_json::from_str(&output.stdout).map_err(|_| {
            DeviceError::new(
                "invalid-devicectl-output",
                "devicectl returned a device list Ruimte could not read",
            )
        })?;
        validate_physical_list(&parsed)?;
        let helper = physical_command().is_ok();
        let mut udids = self
            .udids
            .lock()
            .expect("physical device map lock poisoned");
        udids.clear();
        Ok(parsed
            .result
            .devices
            .into_iter()
            .map(|device| {
                let properties = device.properties;
                let udid = properties.hardware.udid.clone();
                if let Some(udid) = udid.as_ref() {
                    udids.insert(device.identifier.clone(), udid.clone());
                }
                let paired = properties
                    .connection
                    .as_ref()
                    .and_then(|value| value.pairing_state.as_deref())
                    == Some("paired");
                let developer = properties
                    .state
                    .developer_mode_status
                    .as_ref()
                    .and_then(|value| value.enabled.as_ref())
                    .is_some_and(|value| value.mode == 1);
                let booted = paired && properties.state.boot_state.as_deref() == Some("booted");
                let capabilities = physical_capabilities(paired, developer, udid.is_some(), helper);
                DeviceInfo {
                    device_id: device.identifier,
                    backend_id: self.id().into(),
                    platform: Platform::Ios,
                    kind: DeviceKind::Physical,
                    name: properties
                        .state
                        .name
                        .or(properties.hardware.marketing_name)
                        .unwrap_or_else(|| "iOS Device".into()),
                    runtime: properties
                        .software
                        .and_then(|value| value.os_version_number)
                        .map(|value| format!("iOS {}", value.string_value))
                        .unwrap_or_else(|| "iOS".into()),
                    state: if booted {
                        DeviceState::Booted
                    } else {
                        DeviceState::Shutdown
                    },
                    capabilities,
                }
            })
            .collect())
    }

    fn create_source(&self, device_id: &str) -> Result<Arc<dyn DeviceSource>, DeviceError> {
        let udid = self
            .udids
            .lock()
            .expect("physical device map lock poisoned")
            .get(device_id)
            .cloned()
            .ok_or_else(|| {
                DeviceError::new(
                    "physical-device-unavailable",
                    "The physical iOS device did not expose a hardware UDID; refresh the device list and reconnect or pair the device",
                )
            })?;
        let mut command = physical_command()?;
        command.extend(["--udid".into(), udid]);
        Ok(Arc::new(HelperSource::new(
            command,
            device_id.into(),
            LiveFormat::Hevc,
            Duration::from_millis(1500),
        )))
    }
}

fn physical_capabilities(
    paired: bool,
    developer: bool,
    has_udid: bool,
    helper: bool,
) -> DeviceCapabilities {
    let streaming = paired && developer && has_udid && helper;
    DeviceCapabilities {
        boot: false,
        shutdown: false,
        stream: streaming,
        input: streaming,
        screenshot: streaming,
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[derive(Deserialize)]
struct PhysicalList {
    result: PhysicalResult,
}
#[derive(Deserialize)]
struct PhysicalResult {
    devices: Vec<PhysicalDevice>,
}
#[derive(Deserialize)]
struct PhysicalDevice {
    identifier: String,
    properties: PhysicalProperties,
}
#[derive(Deserialize)]
struct PhysicalProperties {
    connection: Option<Connection>,
    hardware: Hardware,
    software: Option<Software>,
    state: PhysicalState,
}
#[derive(Deserialize)]
struct Connection {
    #[serde(rename = "pairingState")]
    pairing_state: Option<String>,
}
#[derive(Deserialize)]
struct Hardware {
    udid: Option<String>,
    #[serde(rename = "marketingName")]
    marketing_name: Option<String>,
}
#[derive(Deserialize)]
struct Software {
    #[serde(rename = "osVersionNumber")]
    os_version_number: Option<VersionNumber>,
}
#[derive(Deserialize)]
struct VersionNumber {
    #[serde(rename = "stringValue")]
    string_value: String,
}
#[derive(Deserialize)]
struct PhysicalState {
    #[serde(rename = "bootState")]
    boot_state: Option<String>,
    name: Option<String>,
    #[serde(rename = "developerModeStatus")]
    developer_mode_status: Option<DeveloperMode>,
}
#[derive(Deserialize)]
struct DeveloperMode {
    enabled: Option<Enabled>,
}
#[derive(Deserialize)]
struct Enabled {
    mode: u8,
}
fn validate_physical_list(list: &PhysicalList) -> Result<(), DeviceError> {
    let valid = list.result.devices.iter().all(|device| {
        !device.identifier.is_empty()
            && device
                .properties
                .hardware
                .udid
                .as_ref()
                .is_none_or(|value| !value.is_empty())
            && device
                .properties
                .hardware
                .marketing_name
                .as_ref()
                .is_none_or(|value| !value.is_empty())
            && device
                .properties
                .state
                .name
                .as_ref()
                .is_none_or(|value| !value.is_empty())
            && device
                .properties
                .software
                .as_ref()
                .and_then(|value| value.os_version_number.as_ref())
                .is_none_or(|value| !value.string_value.is_empty())
    });
    if valid {
        Ok(())
    } else {
        Err(DeviceError::new(
            "invalid-devicectl-output",
            "devicectl returned a device list Ruimte could not read",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_capabilities_require_a_streamable_mapped_device() {
        let available = physical_capabilities(true, true, true, true);
        assert!(available.stream);
        assert!(available.input);
        assert!(available.screenshot);

        for unavailable in [
            physical_capabilities(false, true, true, true),
            physical_capabilities(true, false, true, true),
            physical_capabilities(true, true, false, true),
            physical_capabilities(true, true, true, false),
        ] {
            assert!(!unavailable.stream);
            assert!(!unavailable.input);
            assert!(!unavailable.screenshot);
        }
    }

    #[test]
    fn source_requires_the_hardware_udid_instead_of_falling_back_to_screenshots() {
        let backend = PhysicalBackend::new(PathBuf::from("unused"));
        let error = match backend.create_source("coredevice-phone-1") {
            Ok(_) => panic!("a physical source without a hardware UDID must be refused"),
            Err(error) => error,
        };
        assert_eq!(error.code, "physical-device-unavailable");
        assert!(error.message.contains("hardware UDID"));
    }

    #[test]
    fn mapped_physical_source_uses_the_built_in_helper() {
        let backend = PhysicalBackend::new(PathBuf::from("unused"));
        backend
            .udids
            .lock()
            .unwrap()
            .insert("coredevice-phone-1".into(), "hardware-phone-1".into());
        assert!(backend.create_source("coredevice-phone-1").is_ok());
    }
}
