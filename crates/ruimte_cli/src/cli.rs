use std::{
    collections::HashMap,
    env,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::config::ServerConfig;

const ADDRESS_BOOK_URL: &str = "https://pulsar.ruimte.app";
const SERVICE_LABEL: &str = "app.ruimte.daemon";
const SYSTEMD_UNIT: &str = "ruimte-daemon.service";

#[derive(Clone, Copy)]
enum ServiceKind {
    Launchd,
    Systemd,
}

#[derive(Debug, PartialEq, Eq)]
struct Health {
    version: String,
    build: Option<String>,
}

pub async fn run_service(config: ServerConfig, action: String, flags: Vec<String>) -> i32 {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        eprintln!("The background service needs HOME.");
        return 1;
    };
    let Some((kind, definition_path)) = service_location(&home) else {
        eprintln!("The background service runs on macOS and Linux only.");
        return 1;
    };
    let bin_dir = config.home.join("bin");
    let program = bin_dir.join("ruimte");
    let existing = tokio::fs::read_to_string(&definition_path).await.ok();
    let owned = existing
        .as_deref()
        .is_some_and(|definition| definition_runs_program(definition, &program));
    let other = existing.is_some() && !owned;
    if other && action != "status" {
        eprintln!(
            "The background service on this machine runs another Ruimte, most likely the desktop app. Turn it off there (Settings, This machine) before changing this one."
        );
        return 1;
    }
    match action.as_str() {
        "install" => {
            if let Err(error) = install_service(
                &config,
                &home,
                kind,
                &definition_path,
                &bin_dir,
                &program,
                &flags,
                owned,
            )
            .await
            {
                eprintln!("{error:#}");
                return 1;
            }
            println!(
                "Installed the background service: {}",
                definition_path.display()
            );
            println!(
                "It runs {} and starts with your session.",
                program.display()
            );
            if let Some(notice) = deferred_update_notice(
                health(config.port).await.as_ref(),
                read_build(&bin_dir).await.as_deref(),
            ) {
                println!("{notice}");
            }
            if matches!(kind, ServiceKind::Systemd)
                && let Some((user, false)) = systemd_linger().await
            {
                for line in linger_install_lines(&user) {
                    println!("{line}");
                }
            }
            println!(
                "\nNext: `ruimte pair` for a pairing link, or `ruimte login` to add this machine to your account."
            );
            0
        }
        "uninstall" => {
            if existing.is_none() {
                println!("No background service is installed.");
                return 0;
            }
            if let Err(error) = stop_service(kind, &definition_path).await {
                eprintln!("{error:#}");
                return 1;
            }
            let _ = tokio::fs::remove_file(&definition_path).await;
            for name in [
                "ruimte",
                "ruimte-context",
                "ruimte-simulator-helper",
                "ruimte.build",
            ] {
                let _ = tokio::fs::remove_file(bin_dir.join(name)).await;
            }
            let _ = tokio::fs::remove_dir_all(bin_dir.join("native")).await;
            println!(
                "Stopped and removed the background service. Your projects and pairings stay where they were."
            );
            0
        }
        "status" => {
            if existing.is_none() {
                println!("Not installed. `ruimte service install` sets it up.");
            } else if other {
                println!(
                    "Installed by another Ruimte, most likely the desktop app: {}",
                    definition_path.display()
                );
            } else {
                println!("Installed: {}", definition_path.display());
                let build = read_build(&bin_dir)
                    .await
                    .unwrap_or_else(|| "unknown".to_owned());
                println!("Binary: {} (build {build})", program.display());
            }
            let running = health(config.port).await;
            match &running {
                Some(health) => println!(
                    "Running: version {} on port {}",
                    health.version, config.port
                ),
                None => println!("Not running on port {}", config.port),
            }
            if matches!(kind, ServiceKind::Systemd)
                && let Some((user, enabled)) = systemd_linger().await
            {
                println!("{}", linger_status_line(&user, enabled));
            }
            i32::from(existing.is_none() || running.is_none())
        }
        _ => {
            eprintln!("Usage: ruimte service install|uninstall|status [daemon flags]");
            1
        }
    }
}

fn service_location(home: &Path) -> Option<(ServiceKind, PathBuf)> {
    if cfg!(target_os = "macos") {
        Some((
            ServiceKind::Launchd,
            home.join("Library/LaunchAgents")
                .join(format!("{SERVICE_LABEL}.plist")),
        ))
    } else if cfg!(target_os = "linux") {
        let config_home = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        Some((
            ServiceKind::Systemd,
            config_home.join("systemd/user").join(SYSTEMD_UNIT),
        ))
    } else {
        None
    }
}

fn definition_runs_program(definition: &str, program: &Path) -> bool {
    let program = program.to_string_lossy();
    definition.contains(&format!("<string>{}</string>", xml_text(&program)))
        || definition.contains(&format!("ExecStart={} ", unit_word(&program, true)))
        || definition.contains(&format!("ExecStart={}\n", unit_word(&program, true)))
}

#[allow(clippy::too_many_arguments)]
async fn install_service(
    config: &ServerConfig,
    home: &Path,
    kind: ServiceKind,
    definition_path: &Path,
    bin_dir: &Path,
    program: &Path,
    flags: &[String],
    already_owned: bool,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(bin_dir).await?;
    let executable = env::current_exe()?;
    let source_dir = executable
        .parent()
        .ok_or_else(|| anyhow::anyhow!("The running executable has no parent directory"))?;
    let context_source = source_dir.join("ruimte-context");
    anyhow::ensure!(
        context_source.is_file(),
        "ruimte-context is missing beside {}; build both native binaries before installing",
        executable.display()
    );
    let source_build = source_dir.join("ruimte.build");
    if let Some(build_id) = crate::BUILD_ID {
        validate_release_marker(&source_build, build_id).await?;
    }
    if cfg!(target_os = "macos") {
        copy_simulator_helpers(source_dir, bin_dir, crate::BUILD_ID.is_some()).await?;
    }
    if executable != program {
        atomic_copy(&executable, program, 0o755).await?;
    }
    if context_source != bin_dir.join("ruimte-context") {
        atomic_copy(&context_source, &bin_dir.join("ruimte-context"), 0o755).await?;
    }
    if source_build.is_file() {
        atomic_copy(&source_build, &bin_dir.join("ruimte.build"), 0o644).await?;
    } else {
        atomic_write(
            &bin_dir.join("ruimte.build"),
            crate::VERSION.as_bytes(),
            0o644,
        )
        .await?;
    }

    let path = service_path(env::var("PATH").ok().as_deref());
    let log = home.join("Library/Logs/Ruimte/daemon.log");
    if matches!(kind, ServiceKind::Launchd)
        && let Some(parent) = log.parent()
    {
        tokio::fs::create_dir_all(parent).await?;
    }
    let definition = service_definition(
        kind,
        program,
        flags,
        config.home.as_path(),
        home,
        &path,
        &log,
    );
    let previous = tokio::fs::read_to_string(definition_path).await.ok();
    atomic_write(definition_path, definition.as_bytes(), 0o644).await?;

    match kind {
        ServiceKind::Launchd => {
            let domain = format!("gui/{}", unsafe { libc::getuid() });
            let target = format!("{domain}/{SERVICE_LABEL}");
            let loaded = command_ok("/bin/launchctl", &["print", &target]).await;
            if loaded && already_owned && previous.as_deref() != Some(&definition) {
                let _ = run_command("/bin/launchctl", &["bootout", &target]).await;
                for _ in 0..25 {
                    if !command_ok("/bin/launchctl", &["print", &target]).await {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                run_command(
                    "/bin/launchctl",
                    &["bootstrap", &domain, &definition_path.to_string_lossy()],
                )
                .await?;
            } else if loaded {
                run_command("/bin/launchctl", &["kickstart", &target]).await?;
            } else {
                run_command(
                    "/bin/launchctl",
                    &["bootstrap", &domain, &definition_path.to_string_lossy()],
                )
                .await?;
            }
        }
        ServiceKind::Systemd => {
            run_command("systemctl", &["--user", "daemon-reload"]).await?;
            run_command("systemctl", &["--user", "enable", SYSTEMD_UNIT]).await?;
            let verb = if already_owned { "restart" } else { "start" };
            run_command("systemctl", &["--user", verb, SYSTEMD_UNIT]).await?;
        }
    }
    Ok(())
}

async fn validate_release_marker(path: &Path, expected: &str) -> anyhow::Result<()> {
    let found = tokio::fs::read_to_string(path)
        .await
        .map_err(|_| anyhow::anyhow!("ruimte.build is missing beside the release binary"))?;
    anyhow::ensure!(
        found.trim() == expected,
        "ruimte.build does not match the embedded release build id"
    );
    Ok(())
}

async fn copy_simulator_helpers(
    source_dir: &Path,
    bin_dir: &Path,
    required: bool,
) -> anyhow::Result<()> {
    let files = [
        ("ruimte-simulator-helper", "ruimte-simulator-helper", 0o755),
        (
            "native/serve-sim-native.node",
            "native/serve-sim-native.node",
            0o755,
        ),
        (
            "native/serve-sim-ax-settings",
            "native/serve-sim-ax-settings",
            0o755,
        ),
    ];
    if required {
        for (source, _, _) in files {
            anyhow::ensure!(
                source_dir.join(source).is_file(),
                "{source} is missing from the release bundle"
            );
        }
    }
    for (source, target, mode) in files {
        let source = source_dir.join(source);
        if source.is_file() {
            atomic_copy(&source, &bin_dir.join(target), mode).await?;
        }
    }
    let legacy_bridge = bin_dir.join("native/ios-device-bridge");
    if let Err(error) = tokio::fs::remove_file(&legacy_bridge).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        return Err(error.into());
    }
    Ok(())
}

async fn stop_service(kind: ServiceKind, definition_path: &Path) -> anyhow::Result<()> {
    match kind {
        ServiceKind::Launchd => {
            let target = format!("gui/{}/{}", unsafe { libc::getuid() }, SERVICE_LABEL);
            if command_ok("/bin/launchctl", &["print", &target]).await {
                run_command("/bin/launchctl", &["bootout", &target]).await?;
            }
        }
        ServiceKind::Systemd => {
            let _ = run_command("systemctl", &["--user", "stop", SYSTEMD_UNIT]).await;
            let _ = run_command("systemctl", &["--user", "disable", SYSTEMD_UNIT]).await;
            tokio::fs::remove_file(definition_path).await.ok();
            run_command("systemctl", &["--user", "daemon-reload"]).await?;
        }
    }
    Ok(())
}

async fn health(port: u16) -> Option<Health> {
    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    let value = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    Some(Health {
        version: value.get("version")?.as_str()?.to_owned(),
        build: value
            .get("build")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

async fn read_build(bin_dir: &Path) -> Option<String> {
    tokio::fs::read_to_string(bin_dir.join("ruimte.build"))
        .await
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn deferred_update_notice<'a>(health: Option<&Health>, on_disk: Option<&str>) -> Option<&'a str> {
    let health = health?;
    let running = health.build.as_deref()?;
    let on_disk = on_disk?;
    (running != on_disk).then_some(
        "A daemon from an earlier install is still running; it switches to this one as soon as nothing is running on it.",
    )
}

fn linger_install_lines(user: &str) -> [String; 4] {
    [
        String::new(),
        "systemd stops your services when you log out, and starts this one again at your next login."
            .to_owned(),
        "To keep the machine running while nobody is logged in, allow lingering for your user:"
            .to_owned(),
        format!("  loginctl enable-linger {user}"),
    ]
}

fn linger_status_line(user: &str, enabled: bool) -> String {
    if enabled {
        "Lingering: on, it keeps running after you log out".to_owned()
    } else {
        format!("Lingering: off, it stops when you log out (loginctl enable-linger {user})")
    }
}

async fn systemd_linger() -> Option<(String, bool)> {
    let user = match env::var("USER").ok().filter(|value| !value.is_empty()) {
        Some(user) => user,
        None => {
            let output = tokio::time::timeout(
                Duration::from_secs(2),
                tokio::process::Command::new("id")
                    .arg("-un")
                    .stdin(Stdio::null())
                    .stderr(Stdio::null())
                    .output(),
            )
            .await
            .ok()?
            .ok()?;
            let user = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            (!user.is_empty()).then_some(user)?
        }
    };
    let enabled = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new("loginctl")
            .args(["show-user", &user, "--property=Linger", "--value"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .is_some_and(|output| {
        output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "yes"
    });
    Some((user, enabled))
}

fn service_definition(
    kind: ServiceKind,
    program: &Path,
    flags: &[String],
    ruimte_home: &Path,
    working_directory: &Path,
    path: &str,
    log: &Path,
) -> String {
    let program = program.to_string_lossy();
    match kind {
        ServiceKind::Launchd => {
            let mut lines = vec![
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_owned(),
                "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">".to_owned(),
                "<plist version=\"1.0\">".to_owned(),
                "<dict>".to_owned(),
                "    <key>Label</key>".to_owned(),
                format!("    <string>{SERVICE_LABEL}</string>"),
                "    <key>ProgramArguments</key>".to_owned(),
                "    <array>".to_owned(),
                format!("        <string>{}</string>", xml_text(&program)),
            ];
            lines.extend(
                flags
                    .iter()
                    .map(|flag| format!("        <string>{}</string>", xml_text(flag))),
            );
            lines.extend([
                "    </array>".to_owned(),
                "    <key>EnvironmentVariables</key>".to_owned(),
                "    <dict>".to_owned(),
                "        <key>RUIMTE_HOME</key>".to_owned(),
                format!(
                    "        <string>{}</string>",
                    xml_text(&ruimte_home.to_string_lossy())
                ),
                "        <key>PATH</key>".to_owned(),
                format!("        <string>{}</string>", xml_text(path)),
                "        <key>RUIMTE_SERVICE</key>".to_owned(),
                "        <string>1</string>".to_owned(),
                "    </dict>".to_owned(),
                "    <key>WorkingDirectory</key>".to_owned(),
                format!(
                    "    <string>{}</string>",
                    xml_text(&working_directory.to_string_lossy())
                ),
                "    <key>RunAtLoad</key>".to_owned(),
                "    <true/>".to_owned(),
                "    <key>KeepAlive</key>".to_owned(),
                "    <true/>".to_owned(),
                "    <key>ProcessType</key>".to_owned(),
                "    <string>Interactive</string>".to_owned(),
                "    <key>StandardOutPath</key>".to_owned(),
                format!("    <string>{}</string>", xml_text(&log.to_string_lossy())),
                "    <key>StandardErrorPath</key>".to_owned(),
                format!("    <string>{}</string>", xml_text(&log.to_string_lossy())),
                "</dict>".to_owned(),
                "</plist>".to_owned(),
                String::new(),
            ]);
            lines.join("\n")
        }
        ServiceKind::Systemd => {
            let mut command = vec![unit_word(&program, true)];
            command.extend(flags.iter().map(|flag| unit_word(flag, true)));
            format!(
                "[Unit]\nDescription=Ruimte machine\n\n[Service]\nType=simple\nExecStart={}\nEnvironment={}\nEnvironment={}\nEnvironment={}\nWorkingDirectory={}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n",
                command.join(" "),
                unit_word(
                    &format!("RUIMTE_HOME={}", ruimte_home.to_string_lossy()),
                    false
                ),
                unit_word(&format!("PATH={path}"), false),
                unit_word("RUIMTE_SERVICE=1", false),
                working_directory.to_string_lossy().replace('%', "%%")
            )
        }
    }
}

fn service_path(path: Option<&str>) -> String {
    let mut kept = Vec::new();
    for entry in path.unwrap_or_default().split(':') {
        if entry.is_empty() || entry.contains("node_modules/.bin") || entry.contains("/_npx/") {
            continue;
        }
        if !kept.contains(&entry) {
            kept.push(entry);
        }
    }
    if kept.is_empty() {
        "/usr/local/bin:/usr/bin:/bin".to_owned()
    } else {
        kept.join(":")
    }
}

fn xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn unit_word(value: &str, command: bool) -> String {
    let mut escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('%', "%%");
    if command {
        escaped = escaped.replace('$', "$$$$");
    }
    format!("\"{escaped}\"")
}

async fn atomic_copy(source: &Path, target: &Path, mode: u32) -> anyhow::Result<()> {
    let bytes = tokio::fs::read(source).await?;
    atomic_write(target, &bytes, mode).await
}

async fn atomic_write(target: &Path, bytes: &[u8], mode: u32) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let temporary = target.with_extension(format!("{}.tmp", std::process::id()));
    tokio::fs::write(&temporary, bytes).await?;
    tokio::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(mode)).await?;
    tokio::fs::rename(&temporary, target).await?;
    Ok(())
}

async fn command_ok(command: &str, args: &[&str]) -> bool {
    tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .is_some_and(|status| status.success())
}

async fn run_command(command: &str, args: &[&str]) -> anyhow::Result<()> {
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("{command} timed out"))??;
    anyhow::ensure!(
        output.status.success(),
        "{} failed ({}): {}",
        command,
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(if output.stderr.is_empty() {
            &output.stdout
        } else {
            &output.stderr
        })
        .trim()
    );
    Ok(())
}

pub async fn run_login(config: ServerConfig) -> i32 {
    let cancel = CancellationToken::new();
    let signal_cancel = cancel.clone();
    let signal = tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            signal_cancel.cancel();
        }
    });
    let result = run_login_with_cancel(config, cancel, Duration::from_secs(1), None).await;
    signal.abort();
    let _ = signal.await;
    result
}

async fn run_login_with_cancel(
    config: ServerConfig,
    cancel: CancellationToken,
    second: Duration,
    address_book_override: Option<String>,
) -> i32 {
    let secret = match tokio::fs::read_to_string(config.home.join("local.key")).await {
        Ok(secret) => secret.trim().to_owned(),
        Err(_) => {
            eprintln!(
                "No daemon has started with {} as its home; start one first.",
                config.home.display()
            );
            return 1;
        }
    };
    let client = match Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let daemon = format!("http://127.0.0.1:{}", config.port);
    let address_book = address_book_override
        .or_else(|| env::var("RUIMTE_PULSAR_URL").ok())
        .unwrap_or_else(|| ADDRESS_BOOK_URL.to_owned())
        .trim_end_matches('/')
        .to_owned();
    let request = match daemon_json(&client, &daemon, &secret, "/machine/link-request", None).await
    {
        Ok(value) if valid_link_request(&value) => value,
        Ok(_) => {
            eprintln!(
                "The daemon on port {} answered with something this command cannot read.",
                config.port
            );
            return 1;
        }
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let link_value = match post_json(
        &client,
        &format!("{address_book}/v1/device/start"),
        &request,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            eprintln!("The address book refused: {error}");
            return 1;
        }
    };
    let Some(link) = parse_link_start(&link_value) else {
        eprintln!("The address book answered with something this command cannot read.");
        return 1;
    };
    if cancel.is_cancelled() {
        return withdraw_login(&client, &address_book, &link.device_code).await;
    }
    println!(
        "Linking {} to a Ruimte account.",
        request
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("this machine")
    );
    println!(
        "Key fingerprint: {}",
        request
            .get("publicKey")
            .and_then(Value::as_str)
            .map(key_fingerprint)
            .unwrap_or_default()
    );
    println!("\nOn any device, open this page and sign in:");
    println!("  {}", link.verification_uri_complete);
    println!("Check that it shows this code and this machine:");
    println!("  {}", link.user_code);
    let minutes = link
        .expires_at
        .saturating_sub(now_ms_i64())
        .saturating_add(30_000)
        / 60_000;
    let minutes = minutes.max(1);
    println!("\nThe code works for {minutes} minutes. Waiting for approval (Ctrl+C to stop)...");

    let give_up_at = link.expires_at.saturating_add(120_000);
    let mut failures = 0;
    let mut poll_interval = link.interval;
    while now_ms_i64() < give_up_at {
        tokio::select! {
            () = cancel.cancelled() => return withdraw_login(&client, &address_book, &link.device_code).await,
            () = tokio::time::sleep(second.saturating_mul(poll_interval.try_into().unwrap_or(u32::MAX))) => {}
        }
        let poll_url = format!("{address_book}/v1/device/poll");
        let poll_body = json!({ "deviceCode": link.device_code });
        let poll_request = post_json(&client, &poll_url, &poll_body);
        let poll_value = match tokio::select! {
            () = cancel.cancelled() => return withdraw_login(&client, &address_book, &link.device_code).await,
            result = poll_request => result,
        } {
            Ok(value) => {
                failures = 0;
                value
            }
            Err(error) if error.retryable && failures < 4 => {
                failures += 1;
                continue;
            }
            Err(error) => {
                eprintln!("The address book refused: {error}");
                return 1;
            }
        };
        let Some(poll) = parse_link_poll(&poll_value) else {
            eprintln!("The address book answered with something this command cannot read.");
            return 1;
        };
        poll_interval = poll.interval;
        match poll.status.as_str() {
            "pending" => continue,
            "denied" => {
                eprintln!("Someone denied this machine on the approval page. Nothing was added.");
                return 1;
            }
            "cancelled" => {
                eprintln!("The code was withdrawn. Run `ruimte login` again for a new one.");
                return 1;
            }
            "expired" => break,
            "approved" => {
                let Some(account_id) = poll.account_id else {
                    continue;
                };
                let registration_request = daemon_json(
                    &client,
                    &daemon,
                    &secret,
                    "/machine/registration",
                    Some(json!({ "accountId": account_id })),
                );
                let registration = match tokio::select! {
                    () = cancel.cancelled() => return withdraw_login(&client, &address_book, &link.device_code).await,
                    result = registration_request => result,
                } {
                    Ok(value) if valid_registration(&value) => value,
                    Ok(_) => {
                        eprintln!(
                            "The daemon on port {} answered with something this command cannot read.",
                            config.port
                        );
                        return 1;
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        return 1;
                    }
                };
                let complete_url = format!("{address_book}/v1/device/complete");
                let complete_body = json!({
                    "deviceCode": link.device_code,
                    "issuedAt": registration["issuedAt"],
                    "signature": registration["signature"],
                });
                let complete_request = post_json(&client, &complete_url, &complete_body);
                let result = match tokio::select! {
                    () = cancel.cancelled() => return withdraw_login(&client, &address_book, &link.device_code).await,
                    result = complete_request => result,
                } {
                    Ok(value) if valid_link_complete(&value) => value,
                    Ok(_) => {
                        eprintln!(
                            "The address book answered with something this command cannot read."
                        );
                        return 1;
                    }
                    Err(error) => {
                        eprintln!("The address book refused: {error}");
                        return 1;
                    }
                };
                let account = result.pointer("/account/login").and_then(Value::as_str);
                let machine = result
                    .pointer("/machine/name")
                    .and_then(Value::as_str)
                    .unwrap_or("this machine");
                println!(
                    "Added to {} account. Clients signed in to it can open {machine} now.",
                    account.map_or_else(|| "your".to_owned(), |login| format!("{login}'s"))
                );
                return 0;
            }
            _ => unreachable!(),
        }
    }
    eprintln!(
        "The code expired before anyone approved it. Run `ruimte login` again for a new one."
    );
    1
}

struct LinkStart {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    expires_at: i64,
    interval: u64,
}

struct LinkPoll {
    status: String,
    interval: u64,
    account_id: Option<String>,
}

fn parse_link_start(value: &Value) -> Option<LinkStart> {
    let object = value.as_object()?;
    let device_code = object.get("deviceCode")?.as_str()?;
    let user_code = object.get("userCode")?.as_str()?;
    let verification_uri = object.get("verificationUri")?.as_str()?;
    let verification_uri_complete = object.get("verificationUriComplete")?.as_str()?;
    let expires_at = object.get("expiresAt")?.as_i64()?;
    let interval = object.get("interval")?.as_u64()?;
    (token(device_code)
        && !user_code.is_empty()
        && user_code.encode_utf16().count() <= 16
        && url::Url::parse(verification_uri).is_ok()
        && url::Url::parse(verification_uri_complete).is_ok()
        && interval >= 1)
        .then(|| LinkStart {
            device_code: device_code.to_owned(),
            user_code: user_code.to_owned(),
            verification_uri_complete: verification_uri_complete.to_owned(),
            expires_at,
            interval,
        })
}

fn parse_link_poll(value: &Value) -> Option<LinkPoll> {
    let object = value.as_object()?;
    let status = object.get("status")?.as_str()?;
    let interval = object.get("interval")?.as_u64()?;
    if interval == 0
        || !matches!(
            status,
            "pending" | "approved" | "denied" | "expired" | "cancelled"
        )
    {
        return None;
    }
    let account = object.get("account")?;
    let account_id = if account.is_null() {
        None
    } else {
        Some(valid_account(account).then(|| account["id"].as_str().unwrap().to_owned())?)
    };
    Some(LinkPoll {
        status: status.to_owned(),
        interval,
        account_id,
    })
}

async fn withdraw_login(client: &Client, address_book: &str, device_code: &str) -> i32 {
    let _ = post_json(
        client,
        &format!("{address_book}/v1/device/cancel"),
        &json!({ "deviceCode": device_code }),
    )
    .await;
    eprintln!("Stopped. The code no longer works.");
    130
}

pub async fn run_context(args: Vec<String>) -> i32 {
    const READ_USAGE: &str = "usage\tread\t<id> [--tail N] [--subagent T]";
    const READ_DETAIL: &str = "detail\truimte-context help read";
    let Some(url) = env::var("RUIMTE_CONTEXT_URL")
        .ok()
        .filter(|value| !value.is_empty())
    else {
        eprintln!("Not inside a Ruimte session: RUIMTE_CONTEXT_URL and a token are missing.");
        return 2;
    };
    let Some(token) = env::var("RUIMTE_CONTEXT_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            env::var("RUIMTE_HOOK_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
        })
    else {
        eprintln!("Not inside a Ruimte session: RUIMTE_CONTEXT_URL and a token are missing.");
        return 2;
    };
    let client = Client::new();
    let command = args.first().map(String::as_str).unwrap_or("list");
    if command == "list" {
        return match fetch_sources(&client, &url, &token).await {
            Ok(sources) => {
                if sources.is_empty() {
                    println!("Nothing is linked to this session.");
                }
                for source in sources {
                    println!(
                        "{}\t{}\t{}",
                        source["id"].as_str().unwrap_or_default(),
                        source["kind"].as_str().unwrap_or_default(),
                        source["title"].as_str().unwrap_or_default()
                    );
                }
                0
            }
            Err((code, message)) => {
                eprintln!("{message}");
                code
            }
        };
    }
    if command == "read" {
        let Some(id) = args.get(1) else {
            let mut lines = vec![READ_USAGE.to_owned(), READ_DETAIL.to_owned()];
            lines.extend(linked_context_lines(&client, &url, &token).await);
            return context_refusal(
                "bad-arguments",
                "read takes the id of a linked source",
                &lines,
            );
        };
        let flags = flag_values(&args[2..]);
        if flags.get("tail").is_some_and(|value| {
            value
                .parse::<usize>()
                .ok()
                .filter(|value| *value > 0)
                .is_none()
        }) {
            return context_refusal(
                "bad-arguments",
                "--tail needs a positive whole number of lines",
                &[READ_USAGE.to_owned(), READ_DETAIL.to_owned()],
            );
        }
        if flags.get("subagent").is_some_and(String::is_empty) {
            return context_refusal(
                "bad-arguments",
                "--subagent needs the id from a > Subagent line of the chat",
                &[READ_USAGE.to_owned(), READ_DETAIL.to_owned()],
            );
        }
        let mut request = client
            .get(format!("{}/{}", url.trim_end_matches('/'), urlencoding(id)))
            .bearer_auth(&token);
        if let Some(tail) = flags.get("tail") {
            request = request.query(&[("tail", tail)]);
        }
        if let Some(subagent) = flags.get("subagent") {
            request = request.query(&[("subagent", subagent)]);
        }
        return match request.send().await {
            Ok(response) if response.status().is_success() => {
                println!("{}", response.text().await.unwrap_or_default());
                0
            }
            Ok(response) if response.status() == StatusCode::UNAUTHORIZED => {
                eprintln!(
                    "Not inside a live Ruimte session: the daemon answered 401 {}",
                    response.text().await.unwrap_or_default().trim()
                );
                2
            }
            Ok(response) if response.status() == StatusCode::NOT_FOUND => {
                let lines = linked_context_lines(&client, &url, &token).await;
                context_refusal(
                    "unknown-source",
                    &format!("{id} is not linked to this session"),
                    &lines,
                )
            }
            Ok(response) if response.status() == StatusCode::UNPROCESSABLE_ENTITY => {
                let body = response.text().await.unwrap_or_default();
                context_refusal(
                    "unknown-subagent",
                    body.trim(),
                    &[READ_USAGE.to_owned(), READ_DETAIL.to_owned()],
                )
            }
            Ok(response) => {
                eprintln!("The daemon answered {}", response.status());
                1
            }
            Err(error) => {
                eprintln!("{}", unreachable(&error));
                1
            }
        };
    }

    let mut argv = args[1..].to_vec();
    match prepare_stdin(command, &mut argv) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    }
    let canvas_url = if let Some(prefix) = url.strip_suffix("/context") {
        format!("{prefix}/canvas")
    } else {
        format!("{}/canvas", url.trim_end_matches('/'))
    };
    match client
        .post(format!("{canvas_url}/{}", urlencoding(command)))
        .bearer_auth(token)
        .json(&json!({ "argv": argv }))
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.is_success() {
                print!("{body}");
                0
            } else if status == StatusCode::UNAUTHORIZED {
                eprintln!(
                    "Not inside a live Ruimte session: the daemon answered 401 {}",
                    body.trim()
                );
                2
            } else if matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::UNPROCESSABLE_ENTITY
            ) {
                eprint!("{body}");
                3
            } else {
                eprintln!(
                    "The daemon answered {status}{}",
                    if body.is_empty() {
                        String::new()
                    } else {
                        format!(": {}", body.trim())
                    }
                );
                1
            }
        }
        Err(error) => {
            eprintln!("{}", unreachable(&error));
            1
        }
    }
}

async fn fetch_sources(
    client: &Client,
    url: &str,
    token: &str,
) -> Result<Vec<Value>, (i32, String)> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| (1, unreachable(&error)))?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err((
            2,
            format!(
                "Not inside a live Ruimte session: the daemon answered 401 {}",
                response.text().await.unwrap_or_default().trim()
            ),
        ));
    }
    if !response.status().is_success() {
        return Err((1, format!("The daemon answered {}", response.status())));
    }
    let value = response.json::<Value>().await.map_err(|_| {
        (
            1,
            "The daemon answered with something this command cannot read.".to_owned(),
        )
    })?;
    Ok(value["sources"].as_array().cloned().unwrap_or_default())
}

async fn linked_context_lines(client: &Client, url: &str, token: &str) -> Vec<String> {
    match fetch_sources(client, url, token).await {
        Ok(sources) if sources.is_empty() => {
            vec!["note\tNothing is linked to this session".to_owned()]
        }
        Ok(sources) => sources
            .into_iter()
            .map(|source| {
                format!(
                    "{}\t{}\t{}",
                    source["id"].as_str().unwrap_or_default(),
                    source["kind"].as_str().unwrap_or_default(),
                    source["title"].as_str().unwrap_or_default()
                )
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn prepare_stdin(command: &str, argv: &mut Vec<String>) -> std::io::Result<()> {
    let document = command == "view" && argv.first().is_some_and(|word| word == "diagram");
    let plan = command == "plan" && argv.first().is_some_and(|word| word == "new");
    let mut needs_stdin = false;
    for index in 0..argv.len() {
        let word = &argv[index];
        needs_stdin |= matches!(word.as_str(), "--text=-" | "--result=-")
            || matches!(word.as_str(), "--text" | "--result")
                && argv.get(index + 1).is_some_and(|value| value == "-")
            || plan
                && (word == "--markdown=-"
                    || word == "--markdown"
                        && argv.get(index + 1).is_some_and(|value| value == "-"));
    }
    if document
        && !argv
            .iter()
            .any(|word| word == "--document" || word.starts_with("--document="))
    {
        needs_stdin = true;
    }
    if plan
        && !argv
            .iter()
            .any(|word| word.starts_with("--markdown") || word.starts_with("--document"))
    {
        needs_stdin = true;
    }
    if !needs_stdin {
        return Ok(());
    }
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let mut output = Vec::new();
    let mut replaced = false;
    let mut index = 0;
    while index < argv.len() {
        let word = &argv[index];
        if matches!(word.as_str(), "--text=-" | "--result=-") {
            let flag = word.split('=').next().unwrap_or_default();
            output.push(format!("{flag}={}", input.replace('\\', "\\\\")));
            replaced = true;
        } else if matches!(word.as_str(), "--text" | "--result")
            && argv.get(index + 1).is_some_and(|value| value == "-")
        {
            output.push(format!("{word}={}", input.replace('\\', "\\\\")));
            replaced = true;
            index += 1;
        } else if plan
            && (word == "--markdown=-"
                || word == "--markdown" && argv.get(index + 1).is_some_and(|value| value == "-"))
        {
            output.push(format!("--markdown={input}"));
            replaced = true;
            if word == "--markdown" {
                index += 1;
            }
        } else {
            output.push(word.clone());
        }
        index += 1;
    }
    if !replaced && (document || plan) {
        output.push(format!("--document={input}"));
    }
    *argv = output;
    Ok(())
}

fn flag_values(args: &[String]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let mut index = 0;
    while index < args.len() {
        let word = &args[index];
        if let Some(flag) = word.strip_prefix("--") {
            if let Some((name, value)) = flag.split_once('=') {
                values.insert(name.to_owned(), value.to_owned());
            } else {
                values.insert(
                    flag.to_owned(),
                    args.get(index + 1).cloned().unwrap_or_default(),
                );
                index += 1;
            }
        }
        index += 1;
    }
    values
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn context_refusal(code: &str, message: &str, lines: &[String]) -> i32 {
    eprintln!(
        "refused\t{code}\t{}",
        message.replace(['\t', '\r', '\n'], " ")
    );
    for line in lines {
        eprintln!("{line}");
    }
    3
}

fn unreachable(error: &reqwest::Error) -> String {
    let reason = format!("Could not reach the daemon: {error}");
    let retry = "run the same command again with network access or escalated permissions";
    if env::var("CODEX_SANDBOX_NETWORK_DISABLED").as_deref() == Ok("1") {
        format!(
            "{reason}. This command runs in a sandbox without network access, which blocks the daemon's local address; {retry}."
        )
    } else if env::var_os("CODEX_SANDBOX").is_some() {
        format!(
            "{reason}. This command runs in a sandbox, which may block the daemon's local address; if so, {retry}."
        )
    } else {
        format!(
            "{reason}. A sandbox without network access is a common cause; if this command runs in one, {retry}."
        )
    }
}

async fn daemon_json(
    client: &Client,
    daemon: &str,
    secret: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut request = client.post(format!("{daemon}{path}")).bearer_auth(secret);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| format!("No daemon answers on {}; start one first.", &daemon[7..]))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Err("The daemon is older than `ruimte login`; update it first.".to_owned());
    }
    if !response.status().is_success() {
        return Err("The daemon does not use this RUIMTE_HOME; start the matching daemon or set RUIMTE_HOME.".to_owned());
    }
    response
        .json()
        .await
        .map_err(|_| "The daemon answered with something this command cannot read.".to_owned())
}

#[derive(Debug)]
struct AddressBookError {
    message: String,
    retryable: bool,
}

impl std::fmt::Display for AddressBookError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

async fn post_json(client: &Client, url: &str, body: &Value) -> Result<Value, AddressBookError> {
    let response = client
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|error| AddressBookError {
            message: format!("The address book could not be reached: {error}"),
            retryable: true,
        })?;
    let status = response.status();
    let value = response.json::<Value>().await.unwrap_or(Value::Null);
    if status.is_success() {
        Ok(value)
    } else {
        let code = value.pointer("/error/code").and_then(Value::as_str);
        Err(AddressBookError {
            message: value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or_else(|| {
                    if value.is_null() {
                        "The address book answered with something this client cannot read"
                    } else {
                        "request failed"
                    }
                })
                .to_owned(),
            retryable: matches!(code, Some("internal" | "rate-limited")),
        })
    }
}

fn base64url(value: &str, length: std::ops::RangeInclusive<usize>) -> bool {
    length.contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn token(value: &str) -> bool {
    base64url(value, 43..=43)
}

fn string_length(value: Option<&Value>, min: usize, max: usize) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| (min..=max).contains(&value.encode_utf16().count()))
}

fn valid_account(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    string_length(object.get("id"), 1, 64)
        && matches!(
            object.get("provider").and_then(Value::as_str),
            Some("github" | "apple")
        )
        && object
            .get("login")
            .is_some_and(|login| login.is_null() || login.is_string())
}

fn valid_icon(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return false;
    };
    if value.is_null() {
        return true;
    }
    let Some(icon) = value.as_object() else {
        return false;
    };
    matches!(
        icon.get("kind").and_then(Value::as_str),
        Some("emoji" | "lucide")
    ) && string_length(icon.get("value"), 1, 64)
}

fn valid_broker(value: Option<&Value>, optional: bool) -> bool {
    let Some(value) = value else {
        return optional;
    };
    value.is_null()
        || value.as_str().is_some_and(|url| {
            let address = url
                .strip_prefix("ws://")
                .or_else(|| url.strip_prefix("wss://"));
            url.encode_utf16().count() <= 512
                && address.is_some_and(|address| !address.is_empty())
                && !url.chars().any(char::is_whitespace)
        })
}

fn valid_machine_identity(value: &Value, registration: bool) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    string_length(object.get("id"), 1, 128)
        && string_length(object.get("name"), 1, 80)
        && valid_icon(object.get("icon"))
        && valid_broker(object.get("brokerUrl"), registration)
        && object
            .get("publicKey")
            .and_then(Value::as_str)
            .is_some_and(|value| base64url(value, 43..=43))
}

fn valid_link_request(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    valid_machine_identity(value, false)
        && object.get("issuedAt").and_then(Value::as_u64).is_some()
        && object
            .get("signature")
            .and_then(Value::as_str)
            .is_some_and(|value| base64url(value, 86..=86))
}

fn valid_registration(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    valid_machine_identity(value, true)
        && object.get("issuedAt").and_then(Value::as_u64).is_some()
        && object
            .get("signature")
            .and_then(Value::as_str)
            .is_some_and(|value| base64url(value, 86..=86))
        && object
            .get("automatic")
            .is_none_or(|value| value.is_boolean())
}

fn valid_machine(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    valid_machine_identity(value, false)
        && object
            .get("lastSeenAt")
            .is_some_and(|value| value.is_null() || value.as_i64().is_some())
}

fn valid_link_complete(value: &Value) -> bool {
    value.get("machine").is_some_and(valid_machine)
        && value.get("account").is_some_and(valid_account)
}

fn key_fingerprint(public_key: &str) -> String {
    let bytes = URL_SAFE_NO_PAD.decode(public_key).unwrap_or_default();
    let hex = bytes
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    hex.as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn now_ms_i64() -> i64 {
    now_ms().try_into().unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use std::{
        net::{IpAddr, Ipv4Addr},
        sync::{
            Arc,
            atomic::{AtomicU8, AtomicUsize, Ordering},
        },
    };

    use axum::{
        Json, Router,
        extract::{Request, State},
        http::StatusCode as HttpStatus,
        response::{IntoResponse, Response},
        routing::post,
    };
    use tokio::sync::Notify;

    use super::*;
    use crate::config::BrokerOverride;

    #[test]
    fn service_path_drops_ephemeral_and_duplicate_entries() {
        assert_eq!(
            service_path(Some(
                "/tmp/node_modules/.bin:/usr/bin:/tmp/_npx/1/bin:/usr/bin:/bin"
            )),
            "/usr/bin:/bin"
        );
        assert_eq!(service_path(Some("")), "/usr/local/bin:/usr/bin:/bin");
    }

    #[test]
    fn service_guidance_reports_linger_and_deferred_update() {
        assert_eq!(
            linger_install_lines("bas"),
            [
                "",
                "systemd stops your services when you log out, and starts this one again at your next login.",
                "To keep the machine running while nobody is logged in, allow lingering for your user:",
                "  loginctl enable-linger bas",
            ]
            .map(str::to_owned)
        );
        assert_eq!(
            linger_status_line("bas", false),
            "Lingering: off, it stops when you log out (loginctl enable-linger bas)"
        );
        assert_eq!(
            linger_status_line("bas", true),
            "Lingering: on, it keeps running after you log out"
        );
        let old = Health {
            version: "1.0.0".to_owned(),
            build: Some("old".to_owned()),
        };
        assert!(deferred_update_notice(Some(&old), Some("new")).is_some());
        assert!(deferred_update_notice(Some(&old), Some("old")).is_none());
        assert!(deferred_update_notice(Some(&old), None).is_none());
    }

    #[test]
    fn login_schemas_reject_partial_or_mistyped_answers() {
        let valid = valid_link();
        assert!(parse_link_start(&valid).is_some());
        assert!(parse_link_start(&json!({ "deviceCode": "d".repeat(43) })).is_none());
        let mut no_interval = valid.clone();
        no_interval["interval"] = json!(0);
        assert!(parse_link_start(&no_interval).is_none());
        assert!(
            parse_link_poll(&json!({
                "status": "pending",
                "interval": 5,
                "account": null,
            }))
            .is_some()
        );
        assert!(
            parse_link_poll(&json!({
                "status": "surprise",
                "interval": 5,
                "account": null,
            }))
            .is_none()
        );
        assert!(!valid_link_complete(&json!({
            "machine": { "name": "missing fields" },
            "account": null,
        })));
    }

    #[derive(Default)]
    struct LoginFixture {
        mode: AtomicU8,
        starts: AtomicUsize,
        polls: AtomicUsize,
        cancels: AtomicUsize,
        start_entered: Notify,
        poll_entered: Notify,
        registration_entered: Notify,
        complete_entered: Notify,
    }

    async fn login_fixture(State(state): State<Arc<LoginFixture>>, request: Request) -> Response {
        match request.uri().path() {
            "/machine/link-request" => Json(json!({
                "id": "machine-1",
                "name": "Fixture",
                "icon": null,
                "brokerUrl": null,
                "publicKey": "A".repeat(43),
                "issuedAt": 1,
                "signature": "s".repeat(86),
            }))
            .into_response(),
            "/machine/registration" => {
                if state.mode.load(Ordering::SeqCst) == 5 {
                    state.registration_entered.notify_one();
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                Json(json!({
                    "id": "machine-1",
                    "name": "Fixture",
                    "icon": null,
                    "brokerUrl": null,
                    "publicKey": "A".repeat(43),
                    "issuedAt": 2,
                    "signature": "s".repeat(86),
                }))
                .into_response()
            }
            "/v1/device/start" => {
                state.starts.fetch_add(1, Ordering::SeqCst);
                if state.mode.load(Ordering::SeqCst) == 1 {
                    state.start_entered.notify_one();
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                if state.mode.load(Ordering::SeqCst) == 3 {
                    Json(json!({ "deviceCode": "d".repeat(43) })).into_response()
                } else {
                    Json(valid_link()).into_response()
                }
            }
            "/v1/device/poll" => {
                let poll = state.polls.fetch_add(1, Ordering::SeqCst) + 1;
                if state.mode.load(Ordering::SeqCst) == 2 {
                    state.poll_entered.notify_one();
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    return Json(json!({ "status": "pending", "interval": 1, "account": null }))
                        .into_response();
                }
                if matches!(state.mode.load(Ordering::SeqCst), 5 | 6) {
                    return Json(json!({
                        "status": "approved",
                        "interval": 1,
                        "account": { "id": "account-1", "provider": "github", "login": "octo" },
                    }))
                    .into_response();
                }
                if state.mode.load(Ordering::SeqCst) == 4 && poll <= 2 {
                    return (
                        HttpStatus::TOO_MANY_REQUESTS,
                        Json(
                            json!({ "error": { "code": "rate-limited", "message": "slow down" } }),
                        ),
                    )
                        .into_response();
                }
                if state.mode.load(Ordering::SeqCst) == 4 {
                    return Json(json!({ "status": "denied", "interval": 1, "account": null }))
                        .into_response();
                }
                (
                    HttpStatus::BAD_REQUEST,
                    Json(json!({ "error": { "code": "not-found", "message": "gone" } })),
                )
                    .into_response()
            }
            "/v1/device/complete" => {
                if state.mode.load(Ordering::SeqCst) == 6 {
                    state.complete_entered.notify_one();
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                Json(json!({
                    "machine": {
                        "id": "machine-1",
                        "name": "Fixture",
                        "icon": null,
                        "publicKey": "A".repeat(43),
                        "brokerUrl": null,
                        "lastSeenAt": 2,
                    },
                    "account": { "id": "account-1", "provider": "github", "login": "octo" },
                }))
                .into_response()
            }
            "/v1/device/cancel" => {
                state.cancels.fetch_add(1, Ordering::SeqCst);
                HttpStatus::NO_CONTENT.into_response()
            }
            _ => HttpStatus::NOT_FOUND.into_response(),
        }
    }

    fn valid_link() -> Value {
        json!({
            "deviceCode": "d".repeat(43),
            "userCode": "BCDF-GHJK",
            "verificationUri": "https://station.ruimte.app/link",
            "verificationUriComplete": "https://station.ruimte.app/link?code=BCDF-GHJK",
            "expiresAt": now_ms() + 600_000,
            "interval": 1,
        })
    }

    fn login_config(home: PathBuf, port: u16) -> ServerConfig {
        ServerConfig {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port,
            home,
            label: "Fixture".to_owned(),
            allowed_origins: Vec::new(),
            serve: None,
            under_service: false,
            interactive: false,
            build: None,
            install_hooks: false,
            broker: BrokerOverride::Off,
            broker_advertise: None,
            price_fetch: false,
            approvals: false,
            stun: Vec::new(),
            direct_ports: None,
            direct_host_addresses: Vec::new(),
        }
    }

    async fn start_login_fixture() -> (Arc<LoginFixture>, String, u16, tokio::task::JoinHandle<()>)
    {
        let state = Arc::new(LoginFixture::default());
        let app = Router::new()
            .fallback(post(login_fixture))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (state, format!("http://127.0.0.1:{port}"), port, server)
    }

    #[tokio::test]
    async fn login_withdraws_when_stopped_anytime_after_a_code_is_issued() {
        let (state, base, port, server) = start_login_fixture().await;
        let home = tempfile::tempdir().unwrap();
        tokio::fs::write(home.path().join("local.key"), "secret")
            .await
            .unwrap();

        state.mode.store(1, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        let run = tokio::spawn(run_login_with_cancel(
            login_config(home.path().to_owned(), port),
            cancel.clone(),
            Duration::ZERO,
            Some(base.clone()),
        ));
        state.start_entered.notified().await;
        cancel.cancel();
        assert_eq!(run.await.unwrap(), 130);
        assert_eq!(state.cancels.load(Ordering::SeqCst), 1);

        state.mode.store(2, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        let run = tokio::spawn(run_login_with_cancel(
            login_config(home.path().to_owned(), port),
            cancel.clone(),
            Duration::ZERO,
            Some(base.clone()),
        ));
        state.poll_entered.notified().await;
        cancel.cancel();
        assert_eq!(run.await.unwrap(), 130);
        assert_eq!(state.cancels.load(Ordering::SeqCst), 2);

        state.mode.store(5, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        let run = tokio::spawn(run_login_with_cancel(
            login_config(home.path().to_owned(), port),
            cancel.clone(),
            Duration::ZERO,
            Some(base.clone()),
        ));
        state.registration_entered.notified().await;
        cancel.cancel();
        assert_eq!(run.await.unwrap(), 130);
        assert_eq!(state.cancels.load(Ordering::SeqCst), 3);

        state.mode.store(6, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        let run = tokio::spawn(run_login_with_cancel(
            login_config(home.path().to_owned(), port),
            cancel.clone(),
            Duration::ZERO,
            Some(base.clone()),
        ));
        state.complete_entered.notified().await;
        cancel.cancel();
        assert_eq!(run.await.unwrap(), 130);
        assert_eq!(state.cancels.load(Ordering::SeqCst), 4);
        server.abort();
    }

    #[tokio::test]
    async fn login_rejects_bad_schema_and_does_not_retry_permanent_errors() {
        let (state, base, port, server) = start_login_fixture().await;
        let home = tempfile::tempdir().unwrap();
        tokio::fs::write(home.path().join("local.key"), "secret")
            .await
            .unwrap();

        state.mode.store(3, Ordering::SeqCst);
        assert_eq!(
            run_login_with_cancel(
                login_config(home.path().to_owned(), port),
                CancellationToken::new(),
                Duration::ZERO,
                Some(base.clone()),
            )
            .await,
            1
        );
        assert_eq!(state.polls.load(Ordering::SeqCst), 0);

        state.mode.store(0, Ordering::SeqCst);
        assert_eq!(
            run_login_with_cancel(
                login_config(home.path().to_owned(), port),
                CancellationToken::new(),
                Duration::ZERO,
                Some(base.clone()),
            )
            .await,
            1
        );
        assert_eq!(state.polls.load(Ordering::SeqCst), 1);

        state.polls.store(0, Ordering::SeqCst);
        state.mode.store(4, Ordering::SeqCst);
        assert_eq!(
            run_login_with_cancel(
                login_config(home.path().to_owned(), port),
                CancellationToken::new(),
                Duration::ZERO,
                Some(base),
            )
            .await,
            1
        );
        assert_eq!(state.polls.load(Ordering::SeqCst), 3);
        server.abort();
    }

    #[test]
    fn launchd_definition_escapes_values_and_recognizes_owner() {
        let program = Path::new("/Users/a & b/bin/ruimte");
        let definition = service_definition(
            ServiceKind::Launchd,
            program,
            &["--label".to_owned(), "A < B".to_owned()],
            Path::new("/Users/a & b/.ruimte"),
            Path::new("/Users/a & b"),
            "/usr/bin:/bin",
            Path::new("/Users/a & b/Library/Logs/Ruimte/daemon.log"),
        );
        assert!(definition.contains("<string>/Users/a &amp; b/bin/ruimte</string>"));
        assert!(definition.contains("<string>A &lt; B</string>"));
        assert!(definition_runs_program(&definition, program));
        assert!(!definition_runs_program(
            &definition,
            Path::new("/Users/a & b/bin/other")
        ));
    }

    #[test]
    fn systemd_definition_matches_word_escaping_contract() {
        let program = Path::new("/home/a space/$bin/ruimte");
        let definition = service_definition(
            ServiceKind::Systemd,
            program,
            &["--label=100% $ready".to_owned()],
            Path::new("/home/a space/.ruimte"),
            Path::new("/home/a space"),
            "/usr/bin:/bin",
            Path::new("/unused"),
        );
        assert!(
            definition
                .contains("ExecStart=\"/home/a space/$$$$bin/ruimte\" \"--label=100%% $$$$ready\"")
        );
        assert!(definition.contains("Environment=\"RUIMTE_SERVICE=1\""));
        assert!(definition_runs_program(&definition, program));
    }

    #[tokio::test]
    async fn service_simulator_helpers_replace_the_legacy_physical_artifact() {
        let source = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        tokio::fs::create_dir(source.path().join("native"))
            .await
            .unwrap();
        tokio::fs::create_dir(target.path().join("native"))
            .await
            .unwrap();
        tokio::fs::write(target.path().join("native/ios-device-bridge"), "legacy")
            .await
            .unwrap();
        for path in [
            "ruimte-simulator-helper",
            "native/serve-sim-native.node",
            "native/serve-sim-ax-settings",
        ] {
            tokio::fs::write(source.path().join(path), path)
                .await
                .unwrap();
        }
        copy_simulator_helpers(source.path(), target.path(), true)
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(target.path().join("native/serve-sim-ax-settings"))
                .await
                .unwrap(),
            "native/serve-sim-ax-settings"
        );
        assert!(!target.path().join("native/ios-device-bridge").exists());

        tokio::fs::remove_file(source.path().join("native/serve-sim-native.node"))
            .await
            .unwrap();
        let error = copy_simulator_helpers(source.path(), target.path(), true)
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("serve-sim-native.node is missing")
        );

        let marker = source.path().join("ruimte.build");
        tokio::fs::write(&marker, "build-one\n").await.unwrap();
        validate_release_marker(&marker, "build-one").await.unwrap();
        let error = validate_release_marker(&marker, "build-two")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("does not match"));
    }

    #[tokio::test]
    async fn atomic_write_replaces_complete_file_with_requested_mode() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("nested/ruimte.build");
        atomic_write(&target, b"first", 0o644).await.unwrap();
        atomic_write(&target, b"second", 0o600).await.unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"second");
        assert_eq!(
            tokio::fs::metadata(&target)
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
