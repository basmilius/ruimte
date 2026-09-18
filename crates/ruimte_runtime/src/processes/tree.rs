use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};

use crate::sessions::ProcessRoot;

use super::sampler::{ProcessRate, RawProcess, RawSample, identity};

const AI_FAMILIES: &[&str] = &[
    "claude", "codex", "gemini", "copilot", "opencode", "ollama", "cursor", "aider",
];

pub fn groups(
    sample: &RawSample,
    rates: &HashMap<(u32, u64), ProcessRate>,
    roots: &[ProcessRoot],
    daemon_pid: u32,
    scope: &str,
    sort: &str,
) -> Vec<Value> {
    let by_pid = sample
        .processes
        .iter()
        .map(|process| (process.pid, process))
        .collect::<HashMap<_, _>>();
    let mut children: HashMap<u32, Vec<&RawProcess>> = HashMap::new();
    for process in &sample.processes {
        children.entry(process.ppid).or_default().push(process);
    }
    for siblings in children.values_mut() {
        siblings.sort_by_key(|process| process.pid);
    }
    let mut claimed = HashSet::new();
    let mut result = Vec::new();
    let node_pids = roots
        .iter()
        .filter(|root| !root.exited)
        .map(|root| root.pid)
        .collect::<HashSet<_>>();
    for root in roots.iter().filter(|root| !root.exited) {
        if let Some(process) = by_pid.get(&root.pid) {
            let entries = walk(process, &children, 0, &mut claimed, None, &HashSet::new());
            result.push(group_json(
                format!("terminal:{}", root.id),
                "terminal",
                Some(&root.id),
                entries,
                rates,
                sort,
                0,
            ));
        }
    }
    if let Some(process) = by_pid.get(&daemon_pid) {
        let entries = walk(process, &children, 0, &mut claimed, None, &node_pids);
        result.push(group_json(
            "daemon".into(),
            "daemon",
            None,
            entries,
            rates,
            sort,
            0,
        ));
    }
    if scope == "all" {
        let mut remaining = sample
            .processes
            .iter()
            .filter(|process| !claimed.contains(&identity(process)))
            .map(|process| Entry {
                process,
                depth: 0,
                family: own_family(process, &[]),
            })
            .collect::<Vec<_>>();
        let hidden = remaining.len().saturating_sub(50);
        remaining.sort_by(|left, right| {
            rate_value(rates.get(&identity(right.process)), sort)
                .total_cmp(&rate_value(rates.get(&identity(left.process)), sort))
        });
        remaining.truncate(50);
        result.push(group_json(
            "other".into(),
            "other",
            None,
            remaining,
            rates,
            sort,
            hidden,
        ));
    }
    result
}

struct Entry<'a> {
    process: &'a RawProcess,
    depth: usize,
    family: Option<String>,
}

fn walk<'a>(
    root: &'a RawProcess,
    children: &HashMap<u32, Vec<&'a RawProcess>>,
    depth: usize,
    claimed: &mut HashSet<(u32, u64)>,
    inherited: Option<String>,
    excluded: &HashSet<u32>,
) -> Vec<Entry<'a>> {
    let family = own_family(root, &[]).or(inherited);
    claimed.insert(identity(root));
    let mut entries = vec![Entry {
        process: root,
        depth,
        family: family.clone(),
    }];
    for child in children.get(&root.pid).into_iter().flatten() {
        if !excluded.contains(&child.pid) {
            entries.extend(walk(
                child,
                children,
                depth + 1,
                claimed,
                family.clone(),
                excluded,
            ));
        }
    }
    entries
}

pub(super) fn own_family(process: &RawProcess, args: &[String]) -> Option<String> {
    let haystack = format!(
        "{} {} {}",
        process.name,
        process.path.as_deref().unwrap_or_default(),
        args.iter().take(2).cloned().collect::<Vec<_>>().join(" ")
    )
    .to_ascii_lowercase();
    AI_FAMILIES
        .iter()
        .find(|family| {
            haystack
                .split(|character: char| "/ ._@-".contains(character))
                .any(|word| word == **family)
        })
        .map(|family| (*family).to_owned())
}

fn group_json(
    id: String,
    kind: &str,
    node_id: Option<&str>,
    mut entries: Vec<Entry<'_>>,
    rates: &HashMap<(u32, u64), ProcessRate>,
    sort: &str,
    hidden: usize,
) -> Value {
    entries.sort_by(|left, right| {
        left.depth.cmp(&right.depth).then_with(|| {
            rate_value(rates.get(&identity(right.process)), sort)
                .total_cmp(&rate_value(rates.get(&identity(left.process)), sort))
        })
    });
    let readable = entries
        .iter()
        .filter_map(|entry| rates.get(&identity(entry.process)))
        .collect::<Vec<_>>();
    let sum = |field: fn(&ProcessRate) -> Option<f64>| {
        let values = readable
            .iter()
            .filter_map(|rate| field(rate))
            .collect::<Vec<_>>();
        (!values.is_empty()).then(|| values.into_iter().sum::<f64>())
    };
    let memory = readable
        .iter()
        .filter_map(|rate| rate.memory)
        .collect::<Vec<_>>();
    json!({
        "id": id,
        "kind": kind,
        "nodeId": node_id,
        "cpu": sum(|rate| rate.cpu),
        "memory": (!memory.is_empty()).then(|| memory.into_iter().sum::<u64>()),
        "diskRead": sum(|rate| rate.disk_read),
        "diskWrite": sum(|rate| rate.disk_write),
        "processes": entries.into_iter().map(|entry| row_json(entry, rates)).collect::<Vec<_>>(),
        "hidden": hidden,
    })
}

fn row_json(entry: Entry<'_>, rates: &HashMap<(u32, u64), ProcessRate>) -> Value {
    let process = entry.process;
    let rate = rates.get(&identity(process));
    json!({
        "pid": process.pid,
        "startTime": process.start_time,
        "ppid": process.ppid,
        "name": process.name,
        "path": process.path,
        "readable": process.readable,
        "cpu": rate.and_then(|rate| rate.cpu),
        "memory": rate.and_then(|rate| rate.memory),
        "diskRead": rate.and_then(|rate| rate.disk_read),
        "diskWrite": rate.and_then(|rate| rate.disk_write),
        "family": entry.family,
        "depth": entry.depth,
    })
}

fn rate_value(rate: Option<&ProcessRate>, sort: &str) -> f64 {
    match sort {
        "memory" => rate.and_then(|rate| rate.memory).unwrap_or(0) as f64,
        "disk" => rate
            .map(|rate| rate.disk_read.unwrap_or(0.) + rate.disk_write.unwrap_or(0.))
            .unwrap_or(0.),
        _ => rate.and_then(|rate| rate.cpu).unwrap_or(0.),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, ppid: u32, name: &str) -> RawProcess {
        RawProcess {
            pid,
            ppid,
            uid: 501,
            start_time: pid as u64,
            name: name.into(),
            path: None,
            readable: true,
            cpu_ns: None,
            memory: None,
            disk_read: None,
            disk_write: None,
        }
    }

    #[test]
    fn session_processes_are_not_duplicated_under_the_daemon() {
        let sample = RawSample {
            at: 0,
            awake_ms: 0,
            asleep_ms: 0,
            processes: vec![
                process(10, 1, "daemon"),
                process(20, 10, "shell"),
                process(21, 20, "claude"),
            ],
            machine: super::super::sampler::MachineCounters {
                cores: 1,
                cpu_busy: None,
                cpu_total: None,
                memory_used: None,
                memory_total: 0,
                disk_free: None,
                disk_total: None,
            },
        };
        let roots = vec![ProcessRoot {
            id: "terminal".into(),
            pid: 20,
            exited: false,
        }];

        let result = groups(&sample, &HashMap::new(), &roots, 10, "ruimte", "cpu");

        assert_eq!(result[0]["processes"].as_array().unwrap().len(), 2);
        assert_eq!(result[1]["processes"].as_array().unwrap().len(), 1);
        assert_eq!(result[0]["processes"][1]["family"], "claude");
        assert!(result[0]["cpu"].is_null());
    }
}
