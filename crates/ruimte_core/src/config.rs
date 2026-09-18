use std::{env, ffi::OsString, net::IpAddr, path::PathBuf};

use clap::{Parser, Subcommand};

use crate::BUILD_ID;

pub const PHYSICAL_HELPER_COMMAND: &str = "__physical-device-helper";

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub host: IpAddr,
    pub port: u16,
    pub home: PathBuf,
    pub label: String,
    pub allowed_origins: Vec<String>,
    pub serve: Option<PathBuf>,
    pub under_service: bool,
    pub interactive: bool,
    pub build: Option<String>,
    pub install_hooks: bool,
    pub broker: BrokerOverride,
    pub broker_advertise: Option<String>,
    pub price_fetch: bool,
    pub approvals: bool,
    pub stun: Vec<String>,
    pub direct_ports: Option<(u16, u16)>,
    pub direct_host_addresses: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BrokerOverride {
    Inherit,
    Off,
    Custom(String),
}

#[derive(Debug, Parser)]
#[command(name = "ruimte", disable_version_flag = true)]
struct Arguments {
    #[arg(long, default_value = "127.0.0.1", global = true)]
    host: IpAddr,
    #[arg(long, default_value_t = 4210, global = true)]
    port: u16,
    #[arg(long, global = true)]
    label: Option<String>,
    #[arg(long = "allow-origin", global = true)]
    allowed_origins: Vec<String>,
    #[arg(long, global = true)]
    serve: Option<PathBuf>,
    #[arg(long, default_value_t = false, global = true)]
    no_hooks: bool,
    #[arg(long, default_value_t = false, global = true)]
    no_broker: bool,
    #[arg(long, global = true)]
    broker: Option<String>,
    #[arg(long = "broker-advertise", global = true)]
    broker_advertise: Option<String>,
    #[arg(long, default_value_t = false, global = true)]
    no_price_fetch: bool,
    #[arg(long, default_value_t = false, global = true)]
    no_approvals: bool,
    #[arg(long, default_value_t = false, global = true)]
    no_stun: bool,
    #[arg(long, global = true)]
    stun: Vec<String>,
    #[arg(long = "direct-ports", global = true)]
    direct_ports: Option<String>,
    #[arg(long = "direct-host-address", global = true)]
    direct_host_addresses: Vec<String>,
    #[arg(short = 'v', long, global = true)]
    version: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve,
    Pair,
    Login,
    Version,
}

#[derive(Clone, Debug)]
pub enum RunMode {
    Serve(ServerConfig),
    Pair(ServerConfig),
    Login(ServerConfig),
    Context(Vec<String>),
    Service {
        config: ServerConfig,
        action: String,
        flags: Vec<String>,
    },
    PhysicalDeviceHelper {
        udid: String,
        device_id: String,
    },
    Version,
}

impl RunMode {
    pub fn parse() -> anyhow::Result<Self> {
        let argv = env::args_os().collect::<Vec<_>>();
        Self::parse_from(argv)
    }

    fn parse_from(argv: Vec<OsString>) -> anyhow::Result<Self> {
        let words = argv
            .iter()
            .skip(1)
            .map(|word| word.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if words
            .first()
            .is_some_and(|word| word == PHYSICAL_HELPER_COMMAND)
        {
            let [_, udid_flag, udid, device_id] = words.as_slice() else {
                anyhow::bail!(
                    "The internal physical device helper requires --udid <udid> <device-id>"
                );
            };
            anyhow::ensure!(
                udid_flag == "--udid" && !udid.is_empty() && !device_id.is_empty(),
                "The internal physical device helper requires --udid <udid> <device-id>"
            );
            return Ok(Self::PhysicalDeviceHelper {
                udid: udid.clone(),
                device_id: device_id.clone(),
            });
        }
        if words.first().is_some_and(|word| word == "context") {
            return Ok(Self::Context(words[1..].to_vec()));
        }
        if words.first().is_some_and(|word| word == "service") {
            let Some(action) = words
                .get(1)
                .filter(|action| matches!(action.as_str(), "install" | "uninstall" | "status"))
            else {
                anyhow::bail!("Usage: ruimte service install|uninstall|status [daemon flags]");
            };
            let mut service_argv = vec![OsString::from("ruimte")];
            service_argv.extend(argv.iter().skip(3).cloned());
            let arguments = Arguments::try_parse_from(service_argv)?;
            anyhow::ensure!(
                arguments.command.is_none(),
                "Usage: ruimte service install|uninstall|status [daemon flags]"
            );
            return Ok(Self::Service {
                config: server_config(arguments)?,
                action: action.clone(),
                flags: words[2..].to_vec(),
            });
        }
        let arguments = Arguments::try_parse_from(argv)?;
        if arguments.version || matches!(arguments.command, Some(Command::Version)) {
            return Ok(Self::Version);
        }
        let command = arguments.command.as_ref().map(std::mem::discriminant);
        let config = server_config(arguments)?;
        Ok(match command {
            Some(value) if value == std::mem::discriminant(&Command::Pair) => Self::Pair(config),
            Some(value) if value == std::mem::discriminant(&Command::Login) => Self::Login(config),
            _ => Self::Serve(config),
        })
    }
}

fn server_config(arguments: Arguments) -> anyhow::Result<ServerConfig> {
    let home = env::var_os("RUIMTE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_home(".ruimte"));
    let label = arguments
        .label
        .or_else(|| env::var("RUIMTE_LABEL").ok())
        .unwrap_or_else(host_name);
    let broker_value = arguments
        .broker
        .or_else(|| env::var("RUIMTE_BROKER_URL").ok())
        .unwrap_or_default();
    let broker = if arguments.no_broker || broker_value.trim().eq_ignore_ascii_case("off") {
        BrokerOverride::Off
    } else if broker_value.trim().is_empty() {
        BrokerOverride::Inherit
    } else {
        validate_broker_url(broker_value.trim())?;
        BrokerOverride::Custom(broker_value.trim().to_owned())
    };
    let broker_advertise = arguments
        .broker_advertise
        .or_else(|| env::var("RUIMTE_BROKER_ADVERTISE_URL").ok())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            validate_broker_url(value.trim())?;
            Ok::<_, anyhow::Error>(value.trim().to_owned())
        })
        .transpose()?;
    let direct_ports = arguments
        .direct_ports
        .as_deref()
        .map(parse_port_range)
        .transpose()?;
    let under_service = env::var("RUIMTE_SERVICE").as_deref() == Ok("1");
    let interactive = !under_service && unsafe { libc::isatty(libc::STDOUT_FILENO) } == 1;
    let build = BUILD_ID.map(ToOwned::to_owned).or_else(|| {
        env::current_exe()
            .ok()
            .and_then(|executable| {
                executable
                    .parent()
                    .map(|parent| parent.join("ruimte.build"))
            })
            .and_then(|path| std::fs::read_to_string(path).ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    });
    Ok(ServerConfig {
        host: arguments.host,
        port: arguments.port,
        home,
        label,
        allowed_origins: arguments.allowed_origins,
        serve: arguments.serve,
        under_service,
        interactive,
        build,
        install_hooks: !arguments.no_hooks,
        broker,
        broker_advertise,
        price_fetch: !arguments.no_price_fetch,
        approvals: !arguments.no_approvals,
        stun: if arguments.no_stun {
            Vec::new()
        } else if arguments.stun.is_empty() {
            vec!["stun:turn.ruimte.app:3478".to_owned()]
        } else {
            arguments.stun
        },
        direct_ports,
        direct_host_addresses: arguments.direct_host_addresses,
    })
}

fn parse_port_range(value: &str) -> anyhow::Result<(u16, u16)> {
    let (first, last) = value.split_once('-').unwrap_or((value, value));
    let first = first.trim().parse::<u16>()?;
    let last = last.trim().parse::<u16>()?;
    anyhow::ensure!(
        first > 0 && last >= first,
        "Invalid --direct-ports: {value}"
    );
    Ok((first, last))
}

pub fn validate_broker_url(value: &str) -> anyhow::Result<()> {
    anyhow::ensure!(value.len() <= 512, "A broker URL is at most 512 characters");
    let url = url::Url::parse(value).map_err(|_| anyhow::anyhow!("Not a URL"))?;
    anyhow::ensure!(url.host_str().is_some(), "A broker URL names a host");
    anyhow::ensure!(
        matches!(url.scheme(), "ws" | "wss"),
        "A broker URL starts with wss://"
    );
    if url.scheme() == "ws" {
        let host = url
            .host_str()
            .unwrap_or_default()
            .trim_matches(['[', ']'])
            .to_ascii_lowercase();
        let local = host == "localhost"
            || host.ends_with(".localhost")
            || host.ends_with(".local")
            || host == "host.docker.internal"
            || host == "::1"
            || host.parse::<std::net::Ipv4Addr>().is_ok_and(|address| {
                let [first, second, ..] = address.octets();
                first == 10
                    || first == 127
                    || first == 192 && second == 168
                    || first == 172 && (16..=31).contains(&second)
            });
        anyhow::ensure!(
            local,
            "Plain ws:// is only for a broker on this machine or the local network; use wss://"
        );
    }
    Ok(())
}

fn default_home(suffix: &str) -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(suffix)
}

fn host_name() -> String {
    let mut bytes = [0_u8; 256];
    let result = unsafe { libc::gethostname(bytes.as_mut_ptr().cast(), bytes.len()) };
    if result != 0 {
        return "Ruimte".to_owned();
    }
    let length = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..length]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_is_never_empty() {
        assert!(!host_name().is_empty());
    }

    fn parse(words: &[&str]) -> RunMode {
        let mut argv = vec![OsString::from("ruimte")];
        argv.extend(words.iter().map(OsString::from));
        RunMode::parse_from(argv).unwrap()
    }

    #[test]
    fn command_flags_and_raw_context_arguments_are_preserved() {
        match parse(&["pair", "--port", "4300", "--no-broker"]) {
            RunMode::Pair(config) => {
                assert_eq!(config.port, 4300);
                assert_eq!(config.broker, BrokerOverride::Off);
            }
            _ => panic!("expected pair"),
        }
        match parse(&["context", "node", "note", "--text=--literal"]) {
            RunMode::Context(args) => {
                assert_eq!(args, ["node", "note", "--text=--literal"]);
            }
            _ => panic!("expected context"),
        }
        match parse(&["service", "install", "--port", "4400", "--no-hooks"]) {
            RunMode::Service {
                config,
                action,
                flags,
            } => {
                assert_eq!(action, "install");
                assert_eq!(config.port, 4400);
                assert!(!config.install_hooks);
                assert_eq!(flags, ["--port", "4400", "--no-hooks"]);
            }
            _ => panic!("expected service"),
        }
    }

    #[test]
    fn physical_helper_arguments_are_strict_and_bypass_server_configuration() {
        match parse(&[
            PHYSICAL_HELPER_COMMAND,
            "--udid",
            "hardware-phone-1",
            "coredevice-phone-1",
        ]) {
            RunMode::PhysicalDeviceHelper { udid, device_id } => {
                assert_eq!(udid, "hardware-phone-1");
                assert_eq!(device_id, "coredevice-phone-1");
            }
            _ => panic!("expected physical device helper"),
        }

        for words in [
            vec![PHYSICAL_HELPER_COMMAND],
            vec![PHYSICAL_HELPER_COMMAND, "--udid", "hardware-phone-1"],
            vec![
                PHYSICAL_HELPER_COMMAND,
                "--udid",
                "hardware-phone-1",
                "coredevice-phone-1",
                "--port",
            ],
            vec![
                PHYSICAL_HELPER_COMMAND,
                "--device",
                "hardware-phone-1",
                "coredevice-phone-1",
            ],
        ] {
            let mut argv = vec![OsString::from("ruimte")];
            argv.extend(words.into_iter().map(OsString::from));
            assert!(RunMode::parse_from(argv).is_err());
        }
    }
}
