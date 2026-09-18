use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

const LAUNCHD_PID: u32 = 1;
const IDLE_BASELINE_POINTS: usize = 30;
const AGENT_KINDS: [&str; 4] = ["claude", "codex", "gemini", "copilot"];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StuckThresholds {
    pub silent_after_ms: u64,
    pub silent_cpu_floor: f64,
    pub silent_baseline_margin: f64,
    pub silent_disk_bytes: f64,
    pub busy_cpu: f64,
    pub busy_for_ms: u64,
    pub memory_bytes: f64,
    pub memory_growth_bytes: f64,
    pub memory_growth_window_ms: u64,
    pub agent_gone_grace_ms: u64,
    pub hung_git_ms: u64,
    pub hung_agent_ms: u64,
    pub coverage_slack_ms: u64,
}

impl Default for StuckThresholds {
    fn default() -> Self {
        Self {
            silent_after_ms: 10 * 60_000,
            silent_cpu_floor: 5.,
            silent_baseline_margin: 1.5,
            silent_disk_bytes: 1024. * 1024.,
            busy_cpu: 80.,
            busy_for_ms: 60_000,
            memory_bytes: 2. * 1024. * 1024. * 1024.,
            memory_growth_bytes: 512. * 1024. * 1024.,
            memory_growth_window_ms: 60_000,
            agent_gone_grace_ms: 5_000,
            hung_git_ms: 2 * 120_000,
            hung_agent_ms: 2 * 60_000,
            coverage_slack_ms: 2_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentState {
    pub kind: String,
    pub status: String,
    pub updated_at: u64,
    pub reports_end: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ObservedProcess {
    pub identity: String,
    pub pid: u32,
    pub start_time: u64,
    pub name: String,
    pub own_family: Option<String>,
    pub readable: bool,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub disk: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ObservedGroup {
    pub node_id: String,
    pub kind: String,
    pub agent: Option<AgentState>,
    pub processes: Vec<ObservedProcess>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StrayProcess {
    pub process: ObservedProcess,
    pub node_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Observation {
    pub at: u64,
    pub duration_ms: Option<u64>,
    pub groups: Vec<ObservedGroup>,
    pub daemon_pid: u32,
    pub daemon: Vec<ObservedProcess>,
    #[serde(deserialize_with = "deserialize_alive")]
    pub alive: HashMap<String, u32>,
    pub strays: Vec<StrayProcess>,
}

fn deserialize_alive<'de, D>(deserializer: D) -> Result<HashMap<String, u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct MapEncoding {
        #[serde(rename = "__map")]
        entries: Vec<(String, u32)>,
    }

    let encoding = MapEncoding::deserialize(deserializer)?;
    Ok(encoding.entries.into_iter().collect())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProcessAlert {
    pub id: String,
    pub kind: String,
    pub node_id: Option<String>,
    pub pid: Option<u32>,
    pub start_time: Option<u64>,
    pub name: Option<String>,
    pub since: f64,
    pub value: Option<f64>,
}

#[derive(Clone)]
struct NodePoint {
    at: u64,
    duration_ms: u64,
    cpu: Option<f64>,
    disk: Option<f64>,
    spawned: bool,
}

#[derive(Clone)]
struct WeightedPoint {
    duration_ms: u64,
    value: f64,
}

#[derive(Clone)]
struct ProcessPoint {
    at: u64,
    duration_ms: u64,
    cpu: Option<f64>,
    memory: Option<f64>,
}

#[derive(Clone)]
struct LeftBehind {
    process: ObservedProcess,
    node_id: String,
    since: Option<u64>,
}

pub(super) struct StuckJudge {
    thresholds: StuckThresholds,
    node_series: HashMap<String, Vec<NodePoint>>,
    idle_series: HashMap<String, Vec<WeightedPoint>>,
    process_series: HashMap<String, Vec<ProcessPoint>>,
    members: HashMap<String, HashMap<String, ObservedProcess>>,
    left_behind: HashMap<String, LeftBehind>,
    memory_since: HashMap<String, u64>,
    dismissed: HashMap<String, Option<u64>>,
    stamps: HashMap<String, Option<u64>>,
}

impl Default for StuckJudge {
    fn default() -> Self {
        Self::new(StuckThresholds::default())
    }
}

impl StuckJudge {
    pub(super) fn new(thresholds: StuckThresholds) -> Self {
        Self {
            thresholds,
            node_series: HashMap::new(),
            idle_series: HashMap::new(),
            process_series: HashMap::new(),
            members: HashMap::new(),
            left_behind: HashMap::new(),
            memory_since: HashMap::new(),
            dismissed: HashMap::new(),
            stamps: HashMap::new(),
        }
    }

    pub(super) fn reset(&mut self) {
        self.node_series.clear();
        self.idle_series.clear();
        self.process_series.clear();
        self.memory_since.clear();
    }

    pub(super) fn dismiss(&mut self, id: &str) {
        if let Some(stamp) = self.stamps.get(id) {
            self.dismissed.insert(id.to_owned(), *stamp);
        }
    }

    pub(super) fn observe(&mut self, observation: &Observation) -> Vec<ProcessAlert> {
        let mut alerts = Vec::<(ProcessAlert, Option<u64>)>::new();
        self.collect_left_behind(observation);
        for group in &observation.groups {
            self.record(observation, group);
            self.judge_group(observation, group, &mut alerts);
        }
        for process in &observation.daemon {
            self.record_process(observation, process);
            self.judge_memory(observation, process, None, None, &mut alerts);
            self.judge_hung(observation, process, &mut alerts);
        }
        self.judge_orphans(observation, &mut alerts);
        self.prune(observation);

        self.stamps.clear();
        let mut visible = Vec::new();
        for (alert, stamp) in alerts {
            self.stamps.insert(alert.id.clone(), stamp);
            if self.dismissed.get(&alert.id) == Some(&stamp) {
                continue;
            }
            self.dismissed.remove(&alert.id);
            visible.push(alert);
        }
        self.dismissed.retain(|id, _| self.stamps.contains_key(id));
        visible.sort_by(|left, right| left.id.cmp(&right.id));
        visible
    }

    fn collect_left_behind(&mut self, observation: &Observation) {
        let live = observation
            .groups
            .iter()
            .map(|group| group.node_id.as_str())
            .collect::<HashSet<_>>();
        let ended = self
            .members
            .keys()
            .filter(|node_id| !live.contains(node_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        for node_id in ended {
            if let Some(processes) = self.members.remove(&node_id) {
                for (identity, process) in processes {
                    self.left_behind.insert(
                        identity,
                        LeftBehind {
                            process,
                            node_id: node_id.clone(),
                            since: None,
                        },
                    );
                }
            }
        }
    }

    fn record(&mut self, observation: &Observation, group: &ObservedGroup) {
        let previous = self.members.get(&group.node_id);
        let spawned = previous.is_some_and(|previous| {
            group
                .processes
                .iter()
                .any(|process| !previous.contains_key(&process.identity))
        });
        self.members.insert(
            group.node_id.clone(),
            group
                .processes
                .iter()
                .cloned()
                .map(|process| (process.identity.clone(), process))
                .collect(),
        );
        for process in &group.processes {
            self.record_process(observation, process);
        }
        let Some(duration_ms) = observation.duration_ms else {
            return;
        };
        let measured = group
            .processes
            .iter()
            .all(|process| process.readable && process.cpu.is_some() && process.disk.is_some());
        let point = NodePoint {
            at: observation.at,
            duration_ms,
            cpu: measured.then(|| {
                group
                    .processes
                    .iter()
                    .map(|process| process.cpu.unwrap_or(0.))
                    .sum()
            }),
            disk: measured.then(|| {
                group
                    .processes
                    .iter()
                    .map(|process| process.disk.unwrap_or(0.))
                    .sum()
            }),
            spawned,
        };
        self.node_series
            .entry(group.node_id.clone())
            .or_default()
            .push(point.clone());
        if group.agent.as_ref().is_some_and(|agent| {
            agent.status == "idle"
                && point.cpu.is_some()
                && !spawned
                && agent.updated_at <= observation.at.saturating_sub(duration_ms)
        }) {
            let idle = self.idle_series.entry(group.node_id.clone()).or_default();
            idle.push(WeightedPoint {
                duration_ms,
                value: point.cpu.unwrap_or(0.),
            });
            if idle.len() > IDLE_BASELINE_POINTS {
                idle.drain(..idle.len() - IDLE_BASELINE_POINTS);
            }
        }
    }

    fn record_process(&mut self, observation: &Observation, process: &ObservedProcess) {
        let Some(duration_ms) = observation.duration_ms else {
            return;
        };
        self.process_series
            .entry(process.identity.clone())
            .or_default()
            .push(ProcessPoint {
                at: observation.at,
                duration_ms,
                cpu: process.cpu,
                memory: process.memory,
            });
    }

    fn judge_group(
        &mut self,
        observation: &Observation,
        group: &ObservedGroup,
        alerts: &mut Vec<(ProcessAlert, Option<u64>)>,
    ) {
        let at = observation.at;
        let agent = group.agent.as_ref();
        let stamp = agent.map(|agent| agent.updated_at);
        let agent_process = agent.and_then(|agent| {
            group
                .processes
                .iter()
                .find(|process| process.own_family.as_deref() == Some(agent.kind.as_str()))
        });

        if let Some(agent) = agent.filter(|agent| {
            agent.status == "running"
                && at.saturating_sub(agent.updated_at) >= self.thresholds.silent_after_ms
        }) && let Some(points) = covering(
            self.node_series
                .get(&group.node_id)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            at,
            self.thresholds.silent_after_ms,
            self.thresholds.coverage_slack_ms,
            |point| (point.at, point.duration_ms),
        ) && points
            .iter()
            .all(|point| point.cpu.is_some() && point.disk.is_some() && !point.spawned)
        {
            let cpu = weighted(points.iter().map(|point| WeightedPoint {
                duration_ms: point.duration_ms,
                value: point.cpu.unwrap_or(0.),
            }));
            let disk_bytes = points
                .iter()
                .map(|point| point.disk.unwrap_or(0.) * point.duration_ms as f64 / 1000.)
                .sum::<f64>();
            let ceiling = self
                .idle_series
                .get(&group.node_id)
                .filter(|points| !points.is_empty())
                .map(|points| {
                    (weighted(points.iter().cloned()) * self.thresholds.silent_baseline_margin)
                        .max(1.)
                })
                .unwrap_or(self.thresholds.silent_cpu_floor);
            if cpu <= ceiling && disk_bytes <= self.thresholds.silent_disk_bytes {
                let target = agent_process.or_else(|| group.processes.first());
                alerts.push((
                    alert(
                        "silent",
                        Some(&group.node_id),
                        None,
                        target,
                        agent.updated_at as f64,
                        Some(cpu),
                    ),
                    stamp,
                ));
            }
        }

        if let Some(agent) =
            agent.filter(|agent| matches!(agent.status.as_str(), "idle" | "needs-you"))
        {
            for process in &group.processes {
                let Some(points) = covering(
                    self.process_series
                        .get(&process.identity)
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                    at,
                    self.thresholds.busy_for_ms,
                    self.thresholds.coverage_slack_ms,
                    |point| (point.at, point.duration_ms),
                ) else {
                    continue;
                };
                if !points
                    .iter()
                    .all(|point| point.cpu.is_some_and(|cpu| cpu >= self.thresholds.busy_cpu))
                {
                    continue;
                }
                let start = points[0].at.saturating_sub(points[0].duration_ms);
                if start.saturating_add(self.thresholds.coverage_slack_ms) < agent.updated_at {
                    continue;
                }
                let cpu = weighted(points.iter().map(|point| WeightedPoint {
                    duration_ms: point.duration_ms,
                    value: point.cpu.unwrap_or(0.),
                }));
                alerts.push((
                    alert(
                        "busy-after-turn",
                        Some(&group.node_id),
                        Some(&process.identity),
                        Some(process),
                        start.max(agent.updated_at) as f64,
                        Some(cpu),
                    ),
                    stamp,
                ));
            }
        }

        for process in &group.processes {
            self.judge_memory(observation, process, Some(&group.node_id), stamp, alerts);
        }

        if group.kind == "terminal"
            && agent.is_some_and(|agent| {
                agent.reports_end
                    && matches!(agent.status.as_str(), "running" | "needs-you")
                    && at.saturating_sub(agent.updated_at) >= self.thresholds.agent_gone_grace_ms
            })
            && !group.processes.is_empty()
            && group.processes.iter().all(|process| process.readable)
            && agent_process.is_none()
        {
            let agent = agent.expect("agent predicate passed");
            alerts.push((
                alert_named(
                    "agent-gone",
                    Some(&group.node_id),
                    None,
                    None,
                    None,
                    Some(&agent.kind),
                    agent.updated_at as f64,
                    None,
                ),
                stamp,
            ));
        }
    }

    fn judge_memory(
        &mut self,
        observation: &Observation,
        process: &ObservedProcess,
        node_id: Option<&str>,
        stamp: Option<u64>,
        alerts: &mut Vec<(ProcessAlert, Option<u64>)>,
    ) {
        let Some(memory) = process.memory else {
            return;
        };
        if memory >= self.thresholds.memory_bytes {
            let since = *self
                .memory_since
                .entry(process.identity.clone())
                .or_insert(observation.at);
            alerts.push((
                alert(
                    "memory",
                    node_id,
                    Some(&process.identity),
                    Some(process),
                    since as f64,
                    Some(memory),
                ),
                stamp,
            ));
            return;
        }
        self.memory_since.remove(&process.identity);
        let earlier = self
            .process_series
            .get(&process.identity)
            .and_then(|points| {
                points.iter().find(|point| {
                    point.at < observation.at
                        && point.at
                            >= observation
                                .at
                                .saturating_sub(self.thresholds.memory_growth_window_ms)
                        && point.memory.is_some()
                })
            });
        if let Some(earlier) = earlier.filter(|earlier| {
            memory - earlier.memory.unwrap_or(memory) >= self.thresholds.memory_growth_bytes
        }) {
            alerts.push((
                alert(
                    "memory",
                    node_id,
                    Some(&process.identity),
                    Some(process),
                    earlier.at as f64,
                    Some(memory),
                ),
                stamp,
            ));
        }
    }

    fn judge_hung(
        &self,
        observation: &Observation,
        process: &ObservedProcess,
        alerts: &mut Vec<(ProcessAlert, Option<u64>)>,
    ) {
        if process.pid == observation.daemon_pid || process.start_time == 0 {
            return;
        }
        let limit = if process.name == "git" {
            Some(self.thresholds.hung_git_ms)
        } else if process
            .own_family
            .as_deref()
            .is_some_and(|family| AGENT_KINDS.contains(&family))
        {
            Some(self.thresholds.hung_agent_ms)
        } else {
            None
        };
        let age = observation.at.saturating_sub(process.start_time / 1000);
        if limit.is_some_and(|limit| age > limit) {
            alerts.push((
                alert(
                    "probe-hung",
                    None,
                    Some(&process.identity),
                    Some(process),
                    process.start_time as f64 / 1000.,
                    Some(age as f64),
                ),
                None,
            ));
        }
    }

    fn judge_orphans(
        &mut self,
        observation: &Observation,
        alerts: &mut Vec<(ProcessAlert, Option<u64>)>,
    ) {
        let gone = self
            .left_behind
            .keys()
            .filter(|identity| !observation.alive.contains_key(*identity))
            .cloned()
            .collect::<Vec<_>>();
        for identity in gone {
            self.left_behind.remove(&identity);
        }
        for (identity, entry) in &mut self.left_behind {
            if observation.alive.get(identity) != Some(&LAUNCHD_PID) {
                continue;
            }
            let since = *entry.since.get_or_insert(observation.at);
            alerts.push((
                alert(
                    "orphan",
                    Some(&entry.node_id),
                    Some(identity),
                    Some(&entry.process),
                    since as f64,
                    None,
                ),
                None,
            ));
        }
        for stray in &observation.strays {
            if self.left_behind.contains_key(&stray.process.identity) {
                continue;
            }
            alerts.push((
                alert(
                    "orphan",
                    Some(&stray.node_id),
                    Some(&stray.process.identity),
                    Some(&stray.process),
                    stray.process.start_time as f64 / 1000.,
                    None,
                ),
                None,
            ));
        }
    }

    fn prune(&mut self, observation: &Observation) {
        let keep_ms = self
            .thresholds
            .silent_after_ms
            .max(self.thresholds.busy_for_ms)
            .max(self.thresholds.memory_growth_window_ms)
            + 10 * 60_000;
        let horizon = observation.at.saturating_sub(keep_ms);
        self.process_series.retain(|identity, series| {
            series.retain(|point| point.at > horizon);
            observation.alive.contains_key(identity) && !series.is_empty()
        });
        let live = observation
            .groups
            .iter()
            .map(|group| group.node_id.as_str())
            .collect::<HashSet<_>>();
        self.node_series.retain(|node_id, series| {
            if !live.contains(node_id.as_str()) {
                return false;
            }
            series.retain(|point| point.at > horizon);
            true
        });
        self.idle_series
            .retain(|node_id, _| live.contains(node_id.as_str()));
        self.memory_since
            .retain(|identity, _| observation.alive.contains_key(identity));
    }
}

fn covering<T>(
    points: &[T],
    at: u64,
    window_ms: u64,
    slack_ms: u64,
    bounds: impl Fn(&T) -> (u64, u64),
) -> Option<&[T]> {
    let start = at.saturating_sub(window_ms);
    let first_index = points.iter().position(|point| bounds(point).0 > start)?;
    let inside = &points[first_index..];
    let (first_at, first_duration) = bounds(&inside[0]);
    (first_at.saturating_sub(first_duration) <= start.saturating_add(slack_ms)).then_some(inside)
}

fn weighted(points: impl IntoIterator<Item = WeightedPoint>) -> f64 {
    let points = points.into_iter().collect::<Vec<_>>();
    let total = points.iter().map(|point| point.duration_ms).sum::<u64>();
    if total == 0 {
        return 0.;
    }
    points
        .iter()
        .map(|point| point.value * point.duration_ms as f64)
        .sum::<f64>()
        / total as f64
}

fn alert(
    kind: &str,
    node_id: Option<&str>,
    identity: Option<&str>,
    process: Option<&ObservedProcess>,
    since: f64,
    value: Option<f64>,
) -> ProcessAlert {
    alert_named(
        kind,
        node_id,
        identity,
        process.map(|process| process.pid),
        process.map(|process| process.start_time),
        process.map(|process| process.name.as_str()),
        since,
        value,
    )
}

#[allow(clippy::too_many_arguments)]
fn alert_named(
    kind: &str,
    node_id: Option<&str>,
    identity: Option<&str>,
    pid: Option<u32>,
    start_time: Option<u64>,
    name: Option<&str>,
    since: f64,
    value: Option<f64>,
) -> ProcessAlert {
    ProcessAlert {
        id: format!(
            "{kind}:{}:{}",
            node_id.unwrap_or_default(),
            identity.unwrap_or_default()
        ),
        kind: kind.to_owned(),
        node_id: node_id.map(ToOwned::to_owned),
        pid,
        start_time,
        name: name.map(ToOwned::to_owned),
        since,
        value,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::Value;

    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        scenarios: Vec<Scenario>,
    }

    #[derive(Deserialize)]
    struct Scenario {
        thresholds: StuckThresholds,
        steps: Vec<Step>,
    }

    #[derive(Deserialize)]
    struct Step {
        method: String,
        args: Vec<Value>,
        result: Option<Value>,
    }

    #[test]
    fn matches_typescript_alert_oracle() {
        let fixture: Fixture = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/process-alert-oracle.json"
        )))
        .unwrap();
        let mut calls = 0;
        for (scenario_index, scenario) in fixture.scenarios.into_iter().enumerate() {
            let mut judge = StuckJudge::new(scenario.thresholds);
            for (step_index, step) in scenario.steps.into_iter().enumerate() {
                match step.method.as_str() {
                    "observe" => {
                        let observation = serde_json::from_value(step.args[0].clone()).unwrap();
                        let actual = serde_json::to_value(judge.observe(&observation)).unwrap();
                        assert_json_numbers(
                            &actual,
                            step.result.as_ref().unwrap(),
                            &format!("scenario {scenario_index}, step {step_index}"),
                        );
                    }
                    "dismiss" => judge.dismiss(step.args[0].as_str().unwrap()),
                    "reset" => judge.reset(),
                    method => panic!("unknown oracle method {method}"),
                }
                calls += 1;
            }
        }
        assert_eq!(calls, 129);
    }

    fn assert_json_numbers(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(left), Value::Number(right)) => {
                let left = left.as_f64().unwrap();
                let right = right.as_f64().unwrap();
                assert!((left - right).abs() < 1e-9, "{path}: {left} != {right}");
            }
            (Value::Array(left), Value::Array(right)) => {
                assert_eq!(left.len(), right.len(), "{path}: array length");
                for (index, (left, right)) in left.iter().zip(right).enumerate() {
                    assert_json_numbers(left, right, &format!("{path}[{index}]"));
                }
            }
            (Value::Object(left), Value::Object(right)) => {
                let left = left.iter().collect::<BTreeMap<_, _>>();
                let right = right.iter().collect::<BTreeMap<_, _>>();
                assert_eq!(
                    left.keys().collect::<Vec<_>>(),
                    right.keys().collect::<Vec<_>>(),
                    "{path}: object keys"
                );
                for (key, left) in left {
                    assert_json_numbers(left, right[key], &format!("{path}.{key}"));
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }
}
