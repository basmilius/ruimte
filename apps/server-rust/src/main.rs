use std::net::{IpAddr, Ipv4Addr};

use anyhow::{Context, Result};
use ruimte_server::{VERSION, config::RunMode, router};
use serde_json::Value;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    match RunMode::parse()? {
        RunMode::Version => println!("{VERSION}"),
        RunMode::Serve(config) => router::serve(config).await?,
        RunMode::Pair(config) => print_pairing_url(config).await?,
        RunMode::Context(args) => std::process::exit(ruimte_server::cli::run_context(args).await),
        RunMode::Login(config) => std::process::exit(ruimte_server::cli::run_login(config).await),
        RunMode::Service {
            config,
            action,
            flags,
        } => std::process::exit(ruimte_server::cli::run_service(config, action, flags).await),
        RunMode::PhysicalDeviceHelper { udid, device_id } => {
            run_physical_device_helper(udid, device_id).await?
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn run_physical_device_helper(udid: String, _device_id: String) -> Result<()> {
    ruimte_ios_bridge::run_physical_helper(Some(udid)).await
}

#[cfg(not(target_os = "macos"))]
async fn run_physical_device_helper(_udid: String, _device_id: String) -> Result<()> {
    anyhow::bail!("Physical iOS device streaming is only available on macOS")
}

async fn print_pairing_url(config: ruimte_server::config::ServerConfig) -> Result<()> {
    let secret_path = config.home.join("local.key");
    let secret = tokio::fs::read_to_string(&secret_path)
        .await
        .with_context(|| {
            format!(
                "No daemon has started with {} as its home; start one first.",
                config.home.display()
            )
        })?;
    let host = if config.host.is_unspecified() {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    } else {
        config.host
    };
    let mut stream = TcpStream::connect((host, config.port))
        .await
        .with_context(|| {
            format!(
                "No daemon answers on port {}; start one first.",
                config.port
            )
        })?;
    let request = format!(
        "POST /auth/pairing-token HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        config.port,
        secret.trim()
    );
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    let response = String::from_utf8(response)?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .context("The daemon returned an invalid response")?;
    if !head.starts_with("HTTP/1.1 200") {
        anyhow::bail!(
            "The daemon on port {} does not use {}; set RUIMTE_HOME to the home it was started with.",
            config.port,
            config.home.display()
        );
    }
    let value: Value = serde_json::from_str(body)?;
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .context("The daemon returned no pairing URL")?;
    println!("Open this in the Ruimte app on the other machine within ten minutes:\n{url}");
    Ok(())
}
