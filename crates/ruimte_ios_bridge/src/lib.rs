use std::time::Duration;

#[cfg(not(target_os = "macos"))]
use anyhow::{Result, bail};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeTransport {
    Wireless,
    Usb,
}

#[derive(Clone, Debug)]
pub struct ProbeOptions {
    pub udid: Option<String>,
    pub timeout: Duration,
    pub transport: ProbeTransport,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeResult {
    pub transport: &'static str,
    pub codec: &'static str,
    pub packets: u64,
    pub frame_bytes: usize,
}

#[cfg(target_os = "macos")]
mod platform;

#[cfg(target_os = "macos")]
pub use platform::{probe, run_physical_helper};

#[cfg(not(target_os = "macos"))]
pub async fn run_physical_helper(_udid: Option<String>) -> Result<()> {
    bail!("physical iOS streaming is only supported on macOS")
}

#[cfg(not(target_os = "macos"))]
pub async fn probe(_options: ProbeOptions) -> Result<ProbeResult> {
    bail!("physical iOS probing is only supported on macOS")
}
