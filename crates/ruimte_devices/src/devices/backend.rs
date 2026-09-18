use std::{path::PathBuf, sync::Arc};

use async_trait::async_trait;
use serde_json::Value;

use super::{
    DeviceError,
    model::{DeviceAction, DeviceInfo, DeviceInput, Platform},
};
use crate::streams::{LiveFormat, LiveFrame};

pub type FramePublisher = Arc<dyn Fn(LiveFrame) + Send + Sync>;

#[async_trait]
pub trait DeviceSource: Send + Sync {
    fn format(&self) -> LiveFormat {
        LiveFormat::Jpeg
    }
    async fn start(&self, publish: FramePublisher) -> Result<(), DeviceError>;
    async fn input(&self, input: DeviceInput) -> Result<(), DeviceError>;
    async fn stop(&self);
}

#[async_trait]
pub trait DeviceBackend: Send + Sync {
    fn id(&self) -> &'static str;
    fn platform(&self) -> Platform;
    async fn list(&self) -> Result<Vec<DeviceInfo>, DeviceError>;

    async fn boot(&self, _device_id: &str) -> Result<DeviceInfo, DeviceError> {
        Err(DeviceError::new(
            "device-action-unavailable",
            "This device cannot be started by Ruimte",
        ))
    }

    async fn shutdown(&self, _device_id: &str) -> Result<DeviceInfo, DeviceError> {
        Err(DeviceError::new(
            "device-action-unavailable",
            "This device cannot be shut down by Ruimte",
        ))
    }

    async fn detail(&self, _device_id: &str) -> Result<Value, DeviceError> {
        Err(DeviceError::new(
            "device-tools-unavailable",
            "This device does not expose simulator tools",
        ))
    }

    async fn action(&self, _action: &DeviceAction) -> Result<Value, DeviceError> {
        Err(DeviceError::new(
            "device-tools-unavailable",
            "This device does not expose simulator tools",
        ))
    }

    fn create_source(&self, _device_id: &str) -> Result<Arc<dyn DeviceSource>, DeviceError> {
        Err(DeviceError::new(
            "device-capture-unavailable",
            "Device capture is not installed on this machine",
        ))
    }
}

pub fn system_backends(home: PathBuf) -> Vec<Arc<dyn DeviceBackend>> {
    #[cfg(target_os = "macos")]
    {
        let backends: Vec<Arc<dyn DeviceBackend>> = vec![
            Arc::new(super::simulator::SimulatorBackend::new(home.clone())),
            Arc::new(super::physical::PhysicalBackend::new(home)),
        ];
        #[cfg(debug_assertions)]
        let backends = {
            let mut backends = backends;
            if let Ok(command) = std::env::var("RUIMTE_DEVICE_TEST_BACKEND")
                && !command.is_empty()
            {
                backends.push(Arc::new(super::test_backend::TestBackend::new(command)));
            }
            backends
        };
        backends
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home;
        #[cfg(debug_assertions)]
        {
            if let Ok(command) = std::env::var("RUIMTE_DEVICE_TEST_BACKEND")
                && !command.is_empty()
            {
                return vec![Arc::new(super::test_backend::TestBackend::new(command))];
            }
        }
        Vec::new()
    }
}
