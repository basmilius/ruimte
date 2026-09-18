use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    DeviceError,
    backend::{DeviceBackend, DeviceSource},
    helper::HelperSource,
    model::{DeviceAction, DeviceCapabilities, DeviceInfo, DeviceKind, DeviceState, Platform},
};
use crate::streams::LiveFormat;

pub struct TestBackend {
    command: String,
    booted: AtomicBool,
}

impl TestBackend {
    pub fn new(command: String) -> Self {
        Self {
            command,
            booted: AtomicBool::new(true),
        }
    }

    fn info(&self) -> DeviceInfo {
        DeviceInfo {
            device_id: "fake-ios-1".into(),
            backend_id: "test-device".into(),
            platform: Platform::Ios,
            kind: DeviceKind::Simulator,
            name: "Fake iPhone".into(),
            runtime: "iOS Test".into(),
            state: if self.booted.load(Ordering::Acquire) {
                DeviceState::Booted
            } else {
                DeviceState::Shutdown
            },
            capabilities: DeviceCapabilities {
                boot: true,
                shutdown: true,
                stream: true,
                input: true,
                screenshot: true,
            },
        }
    }
}

#[async_trait]
impl DeviceBackend for TestBackend {
    fn id(&self) -> &'static str {
        "test-device"
    }
    fn platform(&self) -> Platform {
        Platform::Ios
    }
    async fn list(&self) -> Result<Vec<DeviceInfo>, DeviceError> {
        Ok(vec![self.info()])
    }
    async fn boot(&self, _device_id: &str) -> Result<DeviceInfo, DeviceError> {
        self.booted.store(true, Ordering::Release);
        Ok(self.info())
    }
    async fn shutdown(&self, _device_id: &str) -> Result<DeviceInfo, DeviceError> {
        self.booted.store(false, Ordering::Release);
        Ok(self.info())
    }
    async fn detail(&self, _device_id: &str) -> Result<Value, DeviceError> {
        Ok(json!({ "appearance": "light", "textSize": "default" }))
    }
    async fn action(&self, action: &DeviceAction) -> Result<Value, DeviceError> {
        Ok(
            json!({ "appearance": if matches!(action, DeviceAction::SetAppearance { value, .. } if value == "dark") { "dark" } else { "light" } }),
        )
    }
    fn create_source(&self, device_id: &str) -> Result<Arc<dyn DeviceSource>, DeviceError> {
        let format = match std::env::var("RUIMTE_DEVICE_TEST_FORMAT").as_deref() {
            Ok("hevc") => LiveFormat::Hevc,
            _ => LiveFormat::Jpeg,
        };
        Ok(Arc::new(HelperSource::new(
            vec![self.command.clone()],
            device_id.into(),
            format,
            Duration::from_millis(500),
        )))
    }
}
