//! `ruimte-context.exe`, the way cmd and PowerShell on Windows reach `ruimte.exe context`. A batch file
//! would hand the words on through `%*`, which cmd reads a second time for `%`, `^`, `&`, `|`, `<` and `>`;
//! this passes them on as they came.

use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, exit};

const DAEMON: &str = if cfg!(windows) {
    "ruimte.exe"
} else {
    "ruimte"
};

/// The daemon's binary, which ships in the same folder as this launcher.
fn daemon_beside(launcher: &Path) -> PathBuf {
    launcher.with_file_name(DAEMON)
}

fn arguments(words: impl Iterator<Item = OsString>) -> Vec<OsString> {
    std::iter::once(OsString::from("context"))
        .chain(words)
        .collect()
}

/// Ctrl+C reaches every process on the console: the daemon's CLI decides what it means, and this one
/// waits for it, so the prompt does not come back before the command is done. A handler rather than
/// ignoring the event, since ignoring it is inherited by the child.
#[cfg(windows)]
fn outlast_interrupts() {
    const CTRL_C_EVENT: u32 = 0;
    const CTRL_BREAK_EVENT: u32 = 1;

    unsafe extern "system" fn handle(event: u32) -> i32 {
        i32::from(event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT)
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetConsoleCtrlHandler(
            handler: Option<unsafe extern "system" fn(u32) -> i32>,
            add: i32,
        ) -> i32;
    }

    unsafe {
        SetConsoleCtrlHandler(Some(handle), 1);
    }
}

#[cfg(not(windows))]
fn outlast_interrupts() {}

fn main() {
    outlast_interrupts();
    let launcher = match env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("ruimte-context: cannot find where it runs from: {error}");
            exit(1);
        }
    };
    let daemon = daemon_beside(&launcher);
    match Command::new(&daemon)
        .args(arguments(env::args_os().skip(1)))
        .status()
    {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("ruimte-context: cannot start {}: {error}", daemon.display());
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_the_words_to_context_as_they_came() {
        let words = [
            "alert",
            "--text",
            "100% done ^ really %USERPROFILE% a&b|c<d>e \"quoted\"",
        ]
        .map(OsString::from);
        let mut expected = vec![OsString::from("context")];
        expected.extend(words.iter().cloned());
        assert_eq!(arguments(words.into_iter()), expected);
    }

    #[test]
    fn finds_the_daemon_in_its_own_folder() {
        let folder = Path::new("bin");
        let daemon = daemon_beside(&folder.join("ruimte-context.exe"));
        assert_eq!(daemon.parent(), Some(folder));
        assert_eq!(
            daemon.file_name().and_then(|name| name.to_str()),
            Some(DAEMON)
        );
    }
}
