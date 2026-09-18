use std::{collections::HashMap, path::Path, sync::Arc};

#[derive(Clone, Debug, Default)]
pub struct CommandLine {
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Clone, Debug)]
pub struct RawProcess {
    pub pid: u32,
    pub ppid: u32,
    pub uid: u32,
    pub start_time: u64,
    pub name: String,
    pub path: Option<String>,
    pub readable: bool,
    pub cpu_ns: Option<u64>,
    pub memory: Option<u64>,
    pub disk_read: Option<u64>,
    pub disk_write: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct MachineCounters {
    pub cores: usize,
    pub cpu_busy: Option<u64>,
    pub cpu_total: Option<u64>,
    pub memory_used: Option<u64>,
    pub memory_total: u64,
    pub disk_free: Option<u64>,
    pub disk_total: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct RawSample {
    pub at: u64,
    pub awake_ms: u64,
    pub asleep_ms: u64,
    pub processes: Vec<RawProcess>,
    pub machine: MachineCounters,
}

pub trait ProcessSampler: Send + Sync {
    fn sample(&self) -> anyhow::Result<RawSample>;
    fn inspect(&self, pid: u32) -> anyhow::Result<Option<(u64, u32)>>;
    fn command_line(&self, pid: u32) -> Option<CommandLine>;
}

pub fn parse_nul_command_line(bytes: &[u8], argc: Option<usize>) -> CommandLine {
    let values = bytes
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .map(|value| String::from_utf8_lossy(value).into_owned())
        .collect::<Vec<_>>();
    let argc = argc.unwrap_or(values.len()).min(values.len());
    let args = values[..argc].to_vec();
    let env = values[argc..]
        .iter()
        .filter_map(|entry| entry.split_once('='))
        .filter(|(key, _)| !key.is_empty())
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect();
    CommandLine { args, env }
}

#[derive(Clone, Debug)]
pub struct ProcessRate {
    pub cpu: Option<f64>,
    pub memory: Option<u64>,
    pub disk_read: Option<f64>,
    pub disk_write: Option<f64>,
}

pub fn create(home: &Path) -> Option<Arc<dyn ProcessSampler>> {
    #[cfg(target_os = "macos")]
    {
        return Some(Arc::new(super::darwin::DarwinSampler::new(home.to_owned())));
    }
    #[cfg(target_os = "linux")]
    {
        return Some(Arc::new(super::linux::LinuxSampler::new(home.to_owned())));
    }
    #[allow(unreachable_code)]
    None
}

pub fn identity(process: &RawProcess) -> (u32, u64) {
    (process.pid, process.start_time)
}

pub fn rates(
    before: Option<&RawSample>,
    after: &RawSample,
) -> std::collections::HashMap<(u32, u64), ProcessRate> {
    let previous: std::collections::HashMap<(u32, u64), &RawProcess> = before
        .map(|sample| {
            sample
                .processes
                .iter()
                .map(|process| (identity(process), process))
                .collect()
        })
        .unwrap_or_default();
    let elapsed_ms = before
        .map(|sample| after.awake_ms.saturating_sub(sample.awake_ms))
        .unwrap_or(0);
    let mut rates = std::collections::HashMap::new();
    for process in &after.processes {
        let seen = previous.get(&identity(process)).copied();
        let born_inside =
            before.is_some_and(|sample| seen.is_none() && process.start_time >= sample.at * 1000);
        let base = if seen.is_some_and(|process| process.readable) {
            seen
        } else {
            None
        };
        let measurable = elapsed_ms > 0 && (base.is_some() || born_inside);
        let base_cpu = base.and_then(|process| process.cpu_ns).unwrap_or(0);
        let base_read = base.and_then(|process| process.disk_read).unwrap_or(0);
        let base_write = base.and_then(|process| process.disk_write).unwrap_or(0);
        rates.insert(
            identity(process),
            ProcessRate {
                cpu: (process.readable && measurable)
                    .then(|| {
                        process.cpu_ns.map(|now| {
                            now.saturating_sub(base_cpu) as f64 / 1_000_000. / elapsed_ms as f64
                                * 100.
                        })
                    })
                    .flatten(),
                memory: process.readable.then_some(process.memory).flatten(),
                disk_read: (process.readable && measurable)
                    .then(|| {
                        process.disk_read.map(|now| {
                            now.saturating_sub(base_read) as f64 * 1000. / elapsed_ms as f64
                        })
                    })
                    .flatten(),
                disk_write: (process.readable && measurable)
                    .then(|| {
                        process.disk_write.map(|now| {
                            now.saturating_sub(base_write) as f64 * 1000. / elapsed_ms as f64
                        })
                    })
                    .flatten(),
            },
        );
    }
    rates
}

pub fn machine_cpu(before: Option<&RawSample>, after: &RawSample) -> Option<f64> {
    let before = before?;
    let busy = after
        .machine
        .cpu_busy?
        .saturating_sub(before.machine.cpu_busy?);
    let total = after
        .machine
        .cpu_total?
        .saturating_sub(before.machine.cpu_total?);
    (total > 0).then_some(busy as f64 / total as f64 * 100.)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(start_time: u64, cpu_ns: u64) -> RawProcess {
        RawProcess {
            pid: 7,
            ppid: 1,
            uid: 1,
            start_time,
            name: "test".into(),
            path: None,
            readable: true,
            cpu_ns: Some(cpu_ns),
            memory: Some(12),
            disk_read: Some(0),
            disk_write: Some(0),
        }
    }

    fn sample(at: u64, awake_ms: u64, processes: Vec<RawProcess>) -> RawSample {
        RawSample {
            at,
            awake_ms,
            asleep_ms: 0,
            processes,
            machine: MachineCounters {
                cores: 4,
                cpu_busy: None,
                cpu_total: None,
                memory_used: None,
                memory_total: 1,
                disk_free: None,
                disk_total: None,
            },
        }
    }

    #[test]
    fn pid_reuse_does_not_mix_counters() {
        let before = sample(1000, 1000, vec![process(900_000, 500_000_000)]);
        let after = sample(2000, 2000, vec![process(1_500_000, 100_000_000)]);
        let rate = rates(Some(&before), &after)
            .remove(&(7, 1_500_000))
            .unwrap();
        assert_eq!(rate.cpu, Some(10.0));
    }

    #[test]
    fn nul_command_line_separates_arguments_and_environment() {
        let line = parse_nul_command_line(
            b"node\0agent.js\0RUIMTE_SESSION_ID=session\0EMPTY=\0",
            Some(2),
        );

        assert_eq!(line.args, ["node", "agent.js"]);
        assert_eq!(line.env["RUIMTE_SESSION_ID"], "session");
        assert_eq!(line.env["EMPTY"], "");
    }
}
