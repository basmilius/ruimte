use std::{
    fs,
    io::Read,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, anyhow};

use super::sampler::{
    CommandLine, MachineCounters, ProcessSampler, RawProcess, RawSample, parse_nul_command_line,
};

const MAX_COMMAND_LINE_BYTES: u64 = 1024 * 1024;

pub struct LinuxSampler {
    home: PathBuf,
    clock_ticks: u64,
    page_size: u64,
}

impl LinuxSampler {
    pub fn new(home: PathBuf) -> Self {
        let clock_ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) }.max(1) as u64;
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(1) as u64;
        Self {
            home,
            clock_ticks,
            page_size,
        }
    }

    fn read_process(&self, pid: u32, boot_seconds: u64) -> anyhow::Result<RawProcess> {
        let base = PathBuf::from("/proc").join(pid.to_string());
        let stat = fs::read_to_string(base.join("stat"))?;
        let (name, fields) = split_process_stat(&stat)?;
        let value = |index: usize| {
            fields
                .get(index)
                .ok_or_else(|| anyhow!("missing proc stat field {index}"))
        };
        let ppid = value(1)?.parse()?;
        let user_ticks: u64 = value(11)?.parse()?;
        let system_ticks: u64 = value(12)?.parse()?;
        let start_ticks: u64 = value(19)?.parse()?;
        let rss_pages: i64 = value(21)?.parse()?;
        let status = fs::read_to_string(base.join("status")).unwrap_or_default();
        let uid = status
            .lines()
            .find_map(|line| line.strip_prefix("Uid:"))
            .and_then(|line| line.split_whitespace().next())
            .and_then(|uid| uid.parse().ok())
            .unwrap_or(u32::MAX);
        let io = fs::read_to_string(base.join("io")).unwrap_or_default();
        let counter = |key: &str| {
            io.lines()
                .find_map(|line| line.strip_prefix(key))
                .and_then(|value| value.trim().parse().ok())
        };
        Ok(RawProcess {
            pid,
            ppid,
            uid,
            start_time: boot_seconds * 1_000_000 + start_ticks * 1_000_000 / self.clock_ticks,
            name,
            path: fs::read_link(base.join("exe"))
                .ok()
                .map(|path| path.to_string_lossy().into_owned()),
            readable: true,
            cpu_ns: Some((user_ticks + system_ticks) * 1_000_000_000 / self.clock_ticks),
            memory: (rss_pages >= 0).then_some(rss_pages as u64 * self.page_size),
            disk_read: counter("read_bytes:"),
            disk_write: counter("write_bytes:"),
        })
    }

    fn boot_seconds() -> anyhow::Result<u64> {
        fs::read_to_string("/proc/stat")?
            .lines()
            .find_map(|line| line.strip_prefix("btime "))
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| anyhow!("missing kernel boot time"))
    }
}

impl ProcessSampler for LinuxSampler {
    fn sample(&self) -> anyhow::Result<RawSample> {
        let at = now_ms();
        let boot = Self::boot_seconds()?;
        let boottime = fs::read_to_string("/proc/uptime")?
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.);
        let awake_ms = monotonic_ms().unwrap_or((boottime * 1000.) as u64);
        let processes = fs::read_dir("/proc")?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().to_string_lossy().parse::<u32>().ok())
            .filter_map(|pid| self.read_process(pid, boot).ok())
            .collect();
        let cpu_line = fs::read_to_string("/proc/stat")?;
        let (total, idle) = cpu_counters(cpu_line.lines().next().unwrap_or_default());
        let memory = fs::read_to_string("/proc/meminfo")?;
        let mem = |key: &str| {
            memory
                .lines()
                .find_map(|line| line.strip_prefix(key))
                .and_then(|line| line.split_whitespace().next())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|value| value * 1024)
        };
        let (disk_free, disk_total) = statvfs(&self.home).unwrap_or((None, None));
        Ok(RawSample {
            at,
            awake_ms,
            asleep_ms: (boottime * 1000.) as u64 - awake_ms.min((boottime * 1000.) as u64),
            processes,
            machine: MachineCounters {
                cores: std::thread::available_parallelism()
                    .map(usize::from)
                    .unwrap_or(1),
                cpu_busy: Some(total.saturating_sub(idle)),
                cpu_total: Some(total),
                memory_used: mem("MemTotal:")
                    .zip(mem("MemAvailable:"))
                    .map(|(total, available)| total.saturating_sub(available)),
                memory_total: mem("MemTotal:").unwrap_or(0),
                disk_free,
                disk_total,
            },
        })
    }

    fn inspect(&self, pid: u32) -> anyhow::Result<Option<(u64, u32)>> {
        match self.read_process(pid, Self::boot_seconds()?) {
            Ok(process) => Ok(Some((process.start_time, process.uid))),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
            {
                Ok(None)
            }
            Err(error) => Err(error).context("inspect process"),
        }
    }

    fn command_line(&self, pid: u32) -> Option<CommandLine> {
        let base = PathBuf::from("/proc").join(pid.to_string());
        let mut args = Vec::new();
        fs::File::open(base.join("cmdline"))
            .ok()?
            .take(MAX_COMMAND_LINE_BYTES)
            .read_to_end(&mut args)
            .ok()?;
        let mut environment = Vec::new();
        fs::File::open(base.join("environ"))
            .ok()?
            .take(MAX_COMMAND_LINE_BYTES)
            .read_to_end(&mut environment)
            .ok()?;
        let mut line = parse_nul_command_line(&args, None);
        line.env = parse_nul_command_line(&environment, Some(0)).env;
        Some(line)
    }
}

fn split_process_stat(stat: &str) -> anyhow::Result<(String, Vec<&str>)> {
    let open = stat.find('(').ok_or_else(|| anyhow!("invalid proc stat"))?;
    let close = stat
        .rfind(')')
        .ok_or_else(|| anyhow!("invalid proc stat"))?;
    Ok((
        stat.get(open + 1..close).unwrap_or_default().to_owned(),
        stat.get(close + 2..)
            .unwrap_or_default()
            .split_whitespace()
            .collect(),
    ))
}

fn cpu_counters(line: &str) -> (u64, u64) {
    let fields = line
        .split_whitespace()
        .skip(1)
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    let total = fields.iter().take(8).sum();
    let idle = fields.get(3).copied().unwrap_or(0) + fields.get(4).copied().unwrap_or(0);
    (total, idle)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn monotonic_ms() -> anyhow::Result<u64> {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut time) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(time.tv_sec as u64 * 1000 + time.tv_nsec as u64 / 1_000_000)
}

fn statvfs(path: &std::path::Path) -> anyhow::Result<(Option<u64>, Option<u64>)> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes())?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let stat = unsafe { stat.assume_init() };
    Ok((
        Some(stat.f_bavail * stat.f_frsize),
        Some(stat.f_blocks * stat.f_frsize),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_without_pid_prefix_and_keeps_embedded_parentheses() {
        let (name, fields) = split_process_stat(
            "321 (worker (batch)) S 11 0 0 0 0 0 0 0 0 0 7 8 0 0 0 0 0 0 900 0 42",
        )
        .unwrap();

        assert_eq!(name, "worker (batch)");
        assert_eq!(fields[1], "11");
        assert_eq!(fields[11], "7");
        assert_eq!(fields[12], "8");
        assert_eq!(fields[19], "900");
        assert_eq!(fields[21], "42");
    }

    #[test]
    fn cpu_total_uses_host_fields_once() {
        let (total, idle) = cpu_counters("cpu 1 2 3 4 5 6 7 8 900 1000");

        assert_eq!(total, 36);
        assert_eq!(idle, 9);
    }
}
