#![allow(clippy::collapsible_if)]

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};

use serde_json::Value;
use tokio::sync::Mutex;

use crate::{
    rpc::RpcError,
    runtime::{RuntimeAuthority, RuntimeHost, RuntimeTarget, RuntimeTargetKind},
};

use super::{
    plan_store::PlanStore, plans::render_plan_text, project::ProjectStore, views::ViewStores,
    workflow_store::WorkflowStore,
};

const MAX_SCREEN_LINES: usize = 2_000;

pub(crate) enum TerminalNoticeDelivery {
    Immediate(String),
    WaitingAgent,
    Absent,
}

#[derive(Clone)]
pub(crate) struct ContextStore {
    inner: Arc<ContextInner>,
}

struct ContextInner {
    projects: Arc<ProjectStore>,
    views: Arc<ViewStores>,
    workflow: WorkflowStore,
    plans: PlanStore,
    runtime: RwLock<Option<Arc<dyn RuntimeHost>>>,
    told: Mutex<HashMap<String, Vec<Value>>>,
}

impl ContextStore {
    pub fn new(
        projects: Arc<ProjectStore>,
        views: Arc<ViewStores>,
        workflow: WorkflowStore,
        plans: PlanStore,
    ) -> Self {
        Self {
            inner: Arc::new(ContextInner {
                projects,
                views,
                workflow,
                plans,
                runtime: RwLock::new(None),
                told: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn install_runtime(&self, runtime: Arc<dyn RuntimeHost>) {
        *self
            .inner
            .runtime
            .write()
            .expect("runtime host lock poisoned") = Some(runtime);
    }

    pub async fn authority_for_bearer(
        &self,
        token: &str,
    ) -> Result<Option<RuntimeAuthority>, RpcError> {
        let Some(runtime) = self.runtime() else {
            return Err(RpcError::new(
                "runtime-unavailable",
                "The runtime host is not installed",
            ));
        };
        let Some(identity) = runtime.resolve_bearer(token).await? else {
            return Ok(None);
        };
        let Some(place) = self.inner.projects.locate(&identity.node_id).await else {
            return Ok(None);
        };
        let Some(project_id) = place["projectId"].as_str() else {
            return Ok(None);
        };
        Ok(Some(
            self.inner
                .workflow
                .authority(identity, project_id.to_owned())
                .await,
        ))
    }

    pub async fn has(&self, target_id: &str) -> bool {
        !self.inner.projects.sources_for(target_id).await.is_empty()
    }

    pub async fn list(&self, target_id: &str) -> Vec<Value> {
        self.inner
            .projects
            .sources_for(target_id)
            .await
            .into_iter()
            .map(|mut source| {
                if let Some(source) = source.as_object_mut() {
                    source.remove("text");
                    source.remove("nodeId");
                }
                source
            })
            .collect()
    }

    pub async fn change_since(&self, target_id: &str) -> Option<String> {
        let current = self.inner.projects.sources_for(target_id).await;
        let previous = self
            .inner
            .told
            .lock()
            .await
            .insert(target_id.to_owned(), current.clone());
        previous.and_then(|previous| context_change_note(&previous, &current))
    }

    pub async fn drop_unspoken_fork(&self, fork_id: &str) -> Result<bool, RpcError> {
        let Some(runtime) = self.runtime() else {
            return Ok(false);
        };
        runtime.drop_unspoken_fork(fork_id).await
    }

    pub async fn deliver_terminal_notice(
        &self,
        target_id: &str,
        text: &str,
    ) -> Result<TerminalNoticeDelivery, RpcError> {
        let Some(runtime) = self.runtime() else {
            return Ok(TerminalNoticeDelivery::Absent);
        };
        let target = RuntimeTarget {
            kind: RuntimeTargetKind::Terminal,
            id: target_id.to_owned(),
        };
        let Some(view) = runtime.inspect(&target).await? else {
            return Ok(TerminalNoticeDelivery::Absent);
        };
        if view.info.get("exited").and_then(Value::as_bool) == Some(true) {
            return Ok(TerminalNoticeDelivery::Absent);
        }
        let agent_live = view.info.pointer("/agent/live").and_then(Value::as_bool) == Some(true);
        let agent_kind = view.info.pointer("/agent/kind").and_then(Value::as_str);
        if agent_live && matches!(agent_kind, Some("claude" | "codex")) {
            return Ok(TerminalNoticeDelivery::WaitingAgent);
        }
        if !runtime.screen_notice(&target, text).await? {
            return Ok(TerminalNoticeDelivery::Absent);
        }
        Ok(TerminalNoticeDelivery::Immediate(if agent_live {
            format!(
                "printed on its screen; {} takes nothing between its turns, so its agent may not read it",
                agent_kind.unwrap_or("this agent")
            )
        } else {
            "printed on the screen of that terminal".to_owned()
        }))
    }

    pub async fn read(
        &self,
        authority: &RuntimeAuthority,
        source_id: &str,
        tail: Option<usize>,
        subagent: Option<&str>,
    ) -> Result<Option<String>, RpcError> {
        let source = self
            .inner
            .projects
            .sources_for(&authority.identity.node_id)
            .await
            .into_iter()
            .find(|source| {
                source["id"] == source_id
                    || source.get("nodeId").and_then(Value::as_str) == Some(source_id)
            });
        let Some(source) = source else {
            return Ok(None);
        };
        if let Some(tool_use_id) = subagent {
            return self
                .read_subagent(authority, &source, tool_use_id, tail)
                .await;
        }
        match source["kind"].as_str().unwrap_or_default() {
            "text" => Ok(Some(tail_text(
                source["text"].as_str().unwrap_or_default(),
                tail,
            ))),
            "file" => Ok(source["text"].as_str().map(|path| {
                format!("This is a file on disk. Read it with your own tools.\n\n{path}")
            })),
            "terminal" => {
                let Some(runtime) = self.runtime() else {
                    return Err(runtime_unavailable());
                };
                let target = RuntimeTarget {
                    kind: RuntimeTargetKind::Terminal,
                    id: source["id"].as_str().unwrap().to_owned(),
                };
                let Some(view) = runtime.read(authority, &target).await? else {
                    return Ok(None);
                };
                let Some(text) = view.text else {
                    return Ok(None);
                };
                Ok(Some(last_lines(
                    &text,
                    tail.unwrap_or(MAX_SCREEN_LINES).min(MAX_SCREEN_LINES),
                )))
            }
            "chat" => {
                let Some(runtime) = self.runtime() else {
                    return Err(runtime_unavailable());
                };
                let chat_id = source["id"].as_str().unwrap();
                let target = RuntimeTarget {
                    kind: RuntimeTargetKind::Chat,
                    id: chat_id.to_owned(),
                };
                let Some(view) = runtime.read(authority, &target).await? else {
                    return Ok(None);
                };
                let transcript = render_transcript(&view.items);
                let thread = tail.map_or_else(
                    || transcript.clone(),
                    |count| last_lines(&transcript, count),
                );
                let plans = self.inner.plans.read(chat_id).await.unwrap_or_default();
                if plans.is_empty() {
                    Ok(Some(thread))
                } else {
                    Ok(Some(format!(
                        "{}\n\n{thread}",
                        plans
                            .iter()
                            .map(render_plan_text)
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    )))
                }
            }
            "drawing" => {
                let Some(document) = self
                    .inner
                    .views
                    .read_drawing(&authority.project_id, source["id"].as_str().unwrap())
                    .await?
                else {
                    return Ok(None);
                };
                let list = drawing_reading_order(&document["elements"]);
                let svg = self.inner.views.render_drawing_svg(document).await?;
                Ok(Some(render_visual("Drawing", &list, tail, || Ok(svg))?))
            }
            "diagram" => {
                let Some(document) = self
                    .inner
                    .views
                    .read_diagram(&authority.project_id, source["id"].as_str().unwrap())
                    .await?
                else {
                    return Ok(None);
                };
                let list = diagram_reading_order(&document);
                let title = document["meta"]["title"]
                    .as_str()
                    .filter(|title| !title.trim().is_empty())
                    .map_or_else(|| "Diagram".to_owned(), |title| format!("Diagram: {title}"));
                let svg = self.inner.views.render_diagram_svg(document).await?;
                Ok(Some(render_visual(&title, &list, tail, || Ok(svg))?))
            }
            _ => Ok(None),
        }
    }

    async fn read_subagent(
        &self,
        authority: &RuntimeAuthority,
        source: &Value,
        tool_use_id: &str,
        tail: Option<usize>,
    ) -> Result<Option<String>, RpcError> {
        if source["kind"] != "chat" {
            return Err(RpcError::new(
                "subagent-unreadable",
                format!(
                    "{} is a {}, and only a chat has subagents",
                    source["id"].as_str().unwrap_or_default(),
                    source["kind"].as_str().unwrap_or_default()
                ),
            ));
        }
        let Some(runtime) = self.runtime() else {
            return Err(runtime_unavailable());
        };
        let target = RuntimeTarget {
            kind: RuntimeTargetKind::Chat,
            id: source["id"].as_str().unwrap().to_owned(),
        };
        let Some(items) = runtime
            .read_subagent(authority, &target, tool_use_id)
            .await?
        else {
            return Err(RpcError::new(
                "subagent-unreadable",
                format!("No conversation for subagent {tool_use_id}"),
            ));
        };
        let transcript = render_transcript(&items);
        Ok(Some(tail.map_or(transcript.clone(), |count| {
            last_lines(&transcript, count)
        })))
    }

    fn runtime(&self) -> Option<Arc<dyn RuntimeHost>> {
        self.inner
            .runtime
            .read()
            .expect("runtime host lock poisoned")
            .clone()
    }
}

fn runtime_unavailable() -> RpcError {
    RpcError::new("runtime-unavailable", "The runtime host is not installed")
}

pub(crate) fn render_transcript(items: &[Value]) -> String {
    let mut lines = Vec::new();
    for item in items {
        if matches!(item["kind"].as_str(), Some("tool" | "assistant"))
            && item
                .get("parentToolUseId")
                .is_some_and(|value| !value.is_null())
        {
            continue;
        }
        match item["kind"].as_str().unwrap_or_default() {
            "subagent" => {
                let report = first_line(
                    item.get("result")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("summary").and_then(Value::as_str)),
                );
                let suffix = if report.is_empty() {
                    String::new()
                } else {
                    format!(": {report}")
                };
                lines.extend([
                    format!(
                        "> Subagent \"{}\" ({}, {}){suffix}",
                        item["description"].as_str().unwrap_or_default(),
                        item["status"].as_str().unwrap_or_default(),
                        item["toolUseId"].as_str().unwrap_or_default()
                    ),
                    String::new(),
                ]);
            }
            "user" => lines.extend([
                "## User".to_owned(),
                String::new(),
                item["text"].as_str().unwrap_or_default().to_owned(),
                String::new(),
            ]),
            "assistant" => {
                let text = item["text"].as_str().unwrap_or_default();
                if !text.trim().is_empty() {
                    lines.extend([
                        "## Assistant".to_owned(),
                        String::new(),
                        text.to_owned(),
                        String::new(),
                    ]);
                }
            }
            "tool" => {
                let input = item.get("input").map_or_else(String::new, |input| {
                    if input.is_object() {
                        serde_json::to_string(input).unwrap_or_default()
                    } else {
                        input
                            .as_str()
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| input.to_string())
                    }
                });
                lines.push(format!(
                    "> Tool {} ({}): {}",
                    item["name"].as_str().unwrap_or_default(),
                    item["state"].as_str().unwrap_or_default(),
                    input.chars().take(300).collect::<String>()
                ));
                if let Some(output) = item.get("output").and_then(Value::as_str) {
                    if !output.is_empty() {
                        lines.extend([
                            String::new(),
                            "```".to_owned(),
                            output.chars().take(2_000).collect(),
                            "```".to_owned(),
                            String::new(),
                        ]);
                    }
                }
            }
            "question" => {
                let questions = item["questions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|question| question["question"].as_str())
                    .collect::<Vec<_>>()
                    .join(" / ");
                let answers = item["answers"].as_object().map(|answers| {
                    answers
                        .values()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                });
                lines.extend([
                    format!(
                        "> Question: {questions}{}",
                        answers.map_or_else(String::new, |answers| format!(" -> {answers}"))
                    ),
                    String::new(),
                ]);
            }
            "note" => lines.extend([
                format!("> {}", item["text"].as_str().unwrap_or_default()),
                String::new(),
            ]),
            _ => {}
        }
    }
    lines.join("\n").trim().to_owned()
}

fn render_visual(
    title: &str,
    lines: &[String],
    tail: Option<usize>,
    svg: impl FnOnce() -> Result<String, RpcError>,
) -> Result<String, RpcError> {
    let fallback = if title.starts_with("Drawing") {
        "This drawing has no text in it."
    } else {
        "This diagram has no nodes in it."
    };
    let list = if lines.is_empty() {
        vec![fallback.to_owned()]
    } else {
        lines.to_vec()
    };
    if let Some(tail) = tail {
        return Ok(list
            .iter()
            .skip(list.len().saturating_sub(tail))
            .cloned()
            .collect::<Vec<_>>()
            .join("\n"));
    }
    Ok(format!(
        "# {title}\n\n{}\n\n## SVG\n\n{}",
        list.join("\n"),
        svg()?
    ))
}

fn drawing_label_order(
    left: &(f64, f64, String),
    right: &(f64, f64, String),
) -> std::cmp::Ordering {
    if (left.1 - right.1).abs() <= 24.0 {
        left.0.total_cmp(&right.0)
    } else {
        left.1.total_cmp(&right.1)
    }
}

fn sort_drawing_labels(labels: &mut Vec<(f64, f64, String)>) {
    let mut width = 1;
    let mut buffer = labels.clone();
    while width < labels.len() {
        for start in (0..labels.len()).step_by(width * 2) {
            let middle = (start + width).min(labels.len());
            let end = (start + width * 2).min(labels.len());
            let (mut left, mut right) = (start, middle);
            for slot in &mut buffer[start..end] {
                let take_left = right == end
                    || (left < middle
                        && drawing_label_order(&labels[left], &labels[right])
                            != std::cmp::Ordering::Greater);
                if take_left {
                    *slot = labels[left].clone();
                    left += 1;
                } else {
                    *slot = labels[right].clone();
                    right += 1;
                }
            }
        }
        std::mem::swap(labels, &mut buffer);
        width *= 2;
    }
}

fn drawing_reading_order(elements: &Value) -> Vec<String> {
    let elements = elements.as_array().cloned().unwrap_or_default();
    let mut labels = elements
        .iter()
        .filter_map(|element| {
            if !matches!(element["kind"].as_str(), Some("text" | "note")) {
                return None;
            }
            let text = element["text"].as_str().unwrap_or_default().trim();
            (!text.is_empty()).then(|| {
                (
                    element["x"].as_f64().unwrap_or(0.0),
                    element["y"].as_f64().unwrap_or(0.0),
                    text.to_owned(),
                )
            })
        })
        .collect::<Vec<_>>();
    sort_drawing_labels(&mut labels);
    let mut result = labels
        .into_iter()
        .map(|(_, _, text)| text)
        .collect::<Vec<_>>();
    for arrow in elements
        .iter()
        .filter(|element| element["kind"] == "line")
        .filter(|element| element["arrowStart"] == true || element["arrowEnd"] == true)
    {
        let Some(points) = arrow["points"].as_array() else {
            continue;
        };
        let Some(first) = points.first().and_then(Value::as_array) else {
            continue;
        };
        let Some(last) = points.last().and_then(Value::as_array) else {
            continue;
        };
        let x = arrow["x"].as_f64().unwrap_or(0.0);
        let y = arrow["y"].as_f64().unwrap_or(0.0);
        let from = nearest_label(
            &elements,
            x + first.first().and_then(Value::as_f64).unwrap_or(0.0),
            y + first.get(1).and_then(Value::as_f64).unwrap_or(0.0),
            arrow["id"].as_str().unwrap_or_default(),
        );
        let to = nearest_label(
            &elements,
            x + last.first().and_then(Value::as_f64).unwrap_or(0.0),
            y + last.get(1).and_then(Value::as_f64).unwrap_or(0.0),
            arrow["id"].as_str().unwrap_or_default(),
        );
        if let (Some(from), Some(to)) = (from, to)
            && from != to
        {
            result.push(if arrow["arrowEnd"] == true {
                format!("{from} -> {to}")
            } else {
                format!("{to} -> {from}")
            });
        }
    }
    result
}

fn nearest_label(elements: &[Value], x: f64, y: f64, ignored: &str) -> Option<String> {
    elements
        .iter()
        .filter(|element| element["id"] != ignored)
        .filter_map(|element| {
            let text = match element["kind"].as_str() {
                Some("text" | "note") => element["text"].as_str(),
                _ => None,
            }?
            .trim();
            if text.is_empty() {
                return None;
            }
            let center_x =
                element["x"].as_f64().unwrap_or(0.0) + element["w"].as_f64().unwrap_or(0.0) / 2.0;
            let center_y =
                element["y"].as_f64().unwrap_or(0.0) + element["h"].as_f64().unwrap_or(0.0) / 2.0;
            let distance = (center_x - x).hypot(center_y - y);
            (distance <= 48.0).then(|| (distance, text.to_owned()))
        })
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .map(|(_, text)| text)
}

fn diagram_reading_order(document: &Value) -> Vec<String> {
    let nodes = document["nodes"].as_array().cloned().unwrap_or_default();
    let edges = document["edges"].as_array().cloned().unwrap_or_default();
    let groups = document["groups"].as_array().cloned().unwrap_or_default();
    let layers = diagram_layers(&nodes, &edges);
    let by_id = nodes
        .iter()
        .filter_map(|node| Some((node["id"].as_str()?.to_owned(), node)))
        .collect::<HashMap<_, _>>();
    let mut ordered = nodes.iter().enumerate().collect::<Vec<_>>();
    ordered.sort_by_key(|(index, node)| {
        (
            layers
                .get(node["id"].as_str().unwrap_or_default())
                .copied()
                .unwrap_or(0),
            *index,
        )
    });
    let name = |id: &str| {
        by_id
            .get(id)
            .and_then(|node| node["label"].as_str())
            .filter(|label| !label.trim().is_empty())
            .unwrap_or(id)
            .to_owned()
    };
    let mut result = ordered
        .into_iter()
        .map(|(_, node)| {
            let id = node["id"].as_str().unwrap_or_default();
            let name = name(id);
            node.get("sub")
                .and_then(Value::as_str)
                .map_or(name.clone(), |sub| format!("{name} ({sub})"))
        })
        .collect::<Vec<_>>();
    result.extend(edges.iter().map(|edge| {
        let from = name(edge["from"].as_str().unwrap_or_default());
        let to = name(edge["to"].as_str().unwrap_or_default());
        edge.get("label").and_then(Value::as_str).map_or_else(
            || format!("{from} -> {to}"),
            |label| format!("{from} -> {to}: {label}"),
        )
    }));
    result.extend(groups.iter().map(|group| {
        let id = group["id"].as_str().unwrap_or_default();
        let label = group["label"]
            .as_str()
            .filter(|label| !label.is_empty())
            .unwrap_or(id);
        let wraps = group["wraps"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(&name)
            .collect::<Vec<_>>()
            .join(", ");
        format!("{label} wraps: {wraps}")
    }));
    result
}

fn diagram_layers(nodes: &[Value], edges: &[Value]) -> HashMap<String, usize> {
    let known = nodes
        .iter()
        .filter_map(|node| node["id"].as_str().map(ToOwned::to_owned))
        .collect::<HashSet<_>>();
    let mut outgoing = known
        .iter()
        .map(|id| (id.clone(), Vec::<String>::new()))
        .collect::<HashMap<_, _>>();
    let mut incoming = known
        .iter()
        .map(|id| (id.clone(), 0_usize))
        .collect::<HashMap<_, _>>();
    for edge in edges {
        let from = edge["from"].as_str().unwrap_or_default();
        let to = edge["to"].as_str().unwrap_or_default();
        if from == to || !known.contains(from) || !known.contains(to) {
            continue;
        }
        outgoing.get_mut(from).unwrap().push(to.to_owned());
        *incoming.get_mut(to).unwrap() += 1;
    }
    let mut state = HashMap::<String, u8>::new();
    let mut forward = known
        .iter()
        .map(|id| (id.clone(), Vec::<String>::new()))
        .collect::<HashMap<_, _>>();
    let roots = nodes
        .iter()
        .filter(|node| incoming[node["id"].as_str().unwrap_or_default()] == 0)
        .chain(nodes.iter())
        .filter_map(|node| node["id"].as_str());
    for root in roots {
        if state.contains_key(root) {
            continue;
        }
        let mut stack = vec![(root.to_owned(), 0_usize)];
        state.insert(root.to_owned(), 1);
        while let Some((id, next)) = stack.last_mut() {
            let targets = &outgoing[id];
            if *next == targets.len() {
                state.insert(id.clone(), 2);
                stack.pop();
                continue;
            }
            let target = targets[*next].clone();
            *next += 1;
            if state.get(&target) == Some(&1) {
                continue;
            }
            forward.get_mut(id).unwrap().push(target.clone());
            if !state.contains_key(&target) {
                state.insert(target.clone(), 1);
                stack.push((target, 0));
            }
        }
    }
    let mut remaining = known
        .iter()
        .map(|id| (id.clone(), 0_usize))
        .collect::<HashMap<_, _>>();
    for targets in forward.values() {
        for target in targets {
            *remaining.get_mut(target).unwrap() += 1;
        }
    }
    let mut layers = known
        .iter()
        .map(|id| (id.clone(), 0_usize))
        .collect::<HashMap<_, _>>();
    let mut ready = nodes
        .iter()
        .filter_map(|node| node["id"].as_str())
        .filter(|id| remaining[*id] == 0)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut cursor = 0;
    while cursor < ready.len() {
        let id = ready[cursor].clone();
        cursor += 1;
        for target in &forward[&id] {
            layers.insert(target.clone(), layers[target].max(layers[&id] + 1));
            *remaining.get_mut(target).unwrap() -= 1;
            if remaining[target] == 0 {
                ready.push(target.clone());
            }
        }
    }
    layers
}

fn context_change_note(previous: &[Value], current: &[Value]) -> Option<String> {
    let before = previous
        .iter()
        .filter_map(|source| source["id"].as_str())
        .collect::<HashSet<_>>();
    let after = current
        .iter()
        .filter_map(|source| source["id"].as_str())
        .collect::<HashSet<_>>();
    let added = current
        .iter()
        .filter(|source| !before.contains(source["id"].as_str().unwrap_or_default()))
        .collect::<Vec<_>>();
    let removed = previous
        .iter()
        .filter(|source| !after.contains(source["id"].as_str().unwrap_or_default()))
        .collect::<Vec<_>>();
    if added.is_empty() && removed.is_empty() {
        return None;
    }
    let mut parts = vec!["Ruimte: the linked context changed since your last turn.".to_owned()];
    if !added.is_empty() {
        parts.push(format!("Added: {}.", name_sources(&added)));
    }
    if !removed.is_empty() {
        parts.push(format!("Removed: {}.", name_sources(&removed)));
    }
    parts.push(if current.is_empty() {
        "Nothing is linked now.".to_owned()
    } else {
        "Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item."
            .to_owned()
    });
    Some(parts.join(" "))
}

fn name_sources(sources: &[&Value]) -> String {
    let named = sources
        .iter()
        .take(5)
        .map(|source| {
            format!(
                "\"{}\" ({})",
                source["title"].as_str().unwrap_or_default(),
                source["kind"].as_str().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();
    if sources.len() > named.len() {
        format!(
            "{} and {} more",
            named.join(", "),
            sources.len() - named.len()
        )
    } else {
        named.join(", ")
    }
}

fn first_line(text: Option<&str>) -> String {
    text.unwrap_or_default()
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or_default()
        .to_owned()
}

fn tail_text(text: &str, tail: Option<usize>) -> String {
    tail.map_or_else(|| text.to_owned(), |count| last_lines(text, count))
}

fn last_lines(text: &str, count: usize) -> String {
    let lines = text.split('\n').collect::<Vec<_>>();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn transcript_skips_nested_agent_work_and_bounds_tool_output() {
        let items = vec![
            json!({ "kind": "user", "text": "Question" }),
            json!({ "kind": "assistant", "text": "nested", "parentToolUseId": "tool" }),
            json!({ "kind": "tool", "name": "shell", "state": "done", "input": { "cmd": "pwd" }, "output": "ok" }),
            json!({ "kind": "assistant", "text": "Answer" }),
        ];
        assert_eq!(
            render_transcript(&items),
            "## User\n\nQuestion\n\n> Tool shell (done): {\"cmd\":\"pwd\"}\n\n```\nok\n```\n\n## Assistant\n\nAnswer"
        );
    }

    #[test]
    fn diagram_order_breaks_cycles_deterministically() {
        let document = json!({
            "nodes": [
                { "id": "a", "label": "A" },
                { "id": "b", "label": "B", "sub": "detail" }
            ],
            "edges": [
                { "from": "a", "to": "b", "label": "next" },
                { "from": "b", "to": "a" }
            ],
            "groups": [{ "id": "g", "label": "Group", "wraps": ["a", "b"] }]
        });
        assert_eq!(
            diagram_reading_order(&document),
            [
                "A",
                "B (detail)",
                "A -> B: next",
                "B -> A",
                "Group wraps: A, B"
            ]
        );
    }
}
