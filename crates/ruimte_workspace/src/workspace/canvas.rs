#![allow(clippy::collapsible_if, clippy::unnecessary_unwrap)]

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use rand::RngCore;
use serde_json::{Value, json};

use crate::runtime::{RuntimeAuthority, RuntimeMode, RuntimeTargetKind};

use super::{
    WorkspaceService,
    fork_host::{free_position, fresh_id, project_has_id},
    plans::{parse_plan_markdown, plan_progress, progress_text, render_plan_text},
    workflow::depth_for_opening,
};

const MAX_RESULT_LENGTH: usize = 32_000;
const NODE_ACCENT_NAMES: &[&str] = &[
    "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
    "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

#[derive(Clone)]
struct TeamRole {
    title: String,
    prompt: String,
    provider: String,
    terminal: bool,
}

struct TeamMember {
    id: String,
    edge_id: Option<String>,
    role: TeamRole,
    chat: bool,
    cwd: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanvasRefusal {
    pub code: String,
    pub message: String,
    pub lines: Vec<String>,
    pub status: u16,
}

impl CanvasRefusal {
    fn invalid(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            lines: Vec::new(),
            status: 422,
        }
    }
}

impl WorkspaceService {
    pub async fn canvas_verb(
        &self,
        authority: &RuntimeAuthority,
        name: &str,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        match name {
            "help" => help(argv),
            "done" => self.canvas_done(authority, argv).await,
            "notify" => self.canvas_notify(authority, argv).await,
            "agent" => self.canvas_agent(authority, argv).await,
            "team" => self.canvas_team(authority, argv).await,
            "worktree" => self.canvas_worktree(authority, argv).await,
            "task" => self.canvas_task(authority, argv).await,
            "node" => self.canvas_node(authority, argv).await,
            "link" => self.canvas_link(authority, argv).await,
            "view" => self.canvas_view(authority, argv).await,
            "plan" => self.canvas_plan(authority, argv).await,
            _ => Err(CanvasRefusal {
                code: "unknown-verb".to_owned(),
                message: format!("No verb {name}; ruimte-context help lists every verb and noun"),
                lines: help(&[]).unwrap_or_default(),
                status: 404,
            }),
        }
    }

    async fn canvas_worktree(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "worktree needs an action: list, diff or merge",
            ));
        };
        let folder = self
            .inner
            .projects
            .folder_of(&authority.project_id)
            .await
            .map_err(rpc_refusal)?
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-a-repository",
                    "This project has no folder, so it has no worktrees",
                )
            })?;
        let worktrees = self
            .inner
            .git
            .canvas_worktrees(&folder)
            .await
            .map_err(|error| {
                if error.code == "not-a-repo" || error.code == "git-failed" {
                    CanvasRefusal::invalid(
                        "not-a-repository",
                        format!("{} is not in a git repository", folder.display()),
                    )
                } else {
                    rpc_refusal(error)
                }
            })?;
        match action {
            "list" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "worktree list takes no arguments",
                    ));
                }
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                if worktrees.is_empty() {
                    return Ok(vec!["note\tThis repository has no worktrees".to_owned()]);
                }
                Ok(worktrees
                    .iter()
                    .map(|worktree| {
                        let nodes = nodes_in_worktree(&content, worktree);
                        [
                            field(worktree["branch"].as_str().unwrap_or_default()),
                            if worktree["missing"] == true {
                                "missing".to_owned()
                            } else {
                                worktree["path"].as_str().unwrap_or_default().to_owned()
                            },
                            if nodes.is_empty() {
                                "-".to_owned()
                            } else {
                                nodes.join(",")
                            },
                            field(
                                worktree
                                    .pointer("/from/branch")
                                    .and_then(Value::as_str)
                                    .unwrap_or("-"),
                            ),
                            worktree
                                .pointer("/work/changed")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                .to_string(),
                            worktree
                                .pointer("/work/untracked")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                .to_string(),
                            worktree
                                .pointer("/work/ahead")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                .to_string(),
                        ]
                        .join("\t")
                    })
                    .collect())
            }
            "diff" => {
                let parsed = Arguments::parse(&argv[1..], &["tail"], &["stat"])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        if parsed.positionals.is_empty() {
                            "worktree diff needs the branch of a worktree"
                        } else {
                            "worktree diff takes one branch and nothing else"
                        },
                    ));
                }
                let worktree = named_worktree(&worktrees, &parsed.positionals[0])?;
                if worktree["missing"] == true {
                    return Err(CanvasRefusal::invalid(
                        "worktree-missing",
                        format!(
                            "The folder of {} is gone, so there is nothing to diff",
                            parsed.positionals[0]
                        ),
                    ));
                }
                let tail = parsed
                    .flags
                    .get("tail")
                    .map(|value| {
                        value
                            .parse::<usize>()
                            .ok()
                            .filter(|value| *value > 0)
                            .ok_or_else(|| {
                                CanvasRefusal::invalid(
                                    "bad-arguments",
                                    "--tail needs a positive whole number",
                                )
                            })
                    })
                    .transpose()?;
                let base = worktree
                    .pointer("/from/branch")
                    .or_else(|| worktree.pointer("/from/commit"))
                    .and_then(Value::as_str);
                let value = self
                    .inner
                    .git
                    .canvas_worktree_diff(
                        Path::new(worktree["path"].as_str().unwrap_or_default()),
                        base,
                    )
                    .await
                    .map_err(rpc_refusal)?;
                let files = value["files"].as_array().cloned().unwrap_or_default();
                if parsed.switches.contains("stat") {
                    if files.is_empty() {
                        return Ok(vec![format!(
                            "note\t{} changed nothing since {}",
                            parsed.positionals[0],
                            worktree
                                .pointer("/from/branch")
                                .and_then(Value::as_str)
                                .unwrap_or("the base branch")
                        )]);
                    }
                    return Ok(files
                        .iter()
                        .map(|file| {
                            format!(
                                "file\t{}\t{}\t{}",
                                field(file["path"].as_str().unwrap_or_default()),
                                file["added"].as_u64().unwrap_or(0),
                                file["deleted"].as_u64().unwrap_or(0)
                            )
                        })
                        .collect());
                }
                let mut lines = files
                    .iter()
                    .flat_map(|file| {
                        let text = file["diff"].as_str().unwrap_or_default();
                        if text.is_empty() {
                            vec![format!(
                                "# {}: {}",
                                file["path"].as_str().unwrap_or_default(),
                                if file["omitted"] == "binary" {
                                    "binary"
                                } else {
                                    "too large to show"
                                }
                            )]
                        } else {
                            text.trim_end_matches('\n')
                                .lines()
                                .map(ToOwned::to_owned)
                                .collect()
                        }
                    })
                    .collect::<Vec<_>>();
                if lines.is_empty() {
                    lines.push(format!(
                        "note\t{} changed nothing since {}",
                        parsed.positionals[0],
                        worktree
                            .pointer("/from/branch")
                            .and_then(Value::as_str)
                            .unwrap_or("the base branch")
                    ));
                } else if let Some(tail) = tail
                    && lines.len() > tail
                {
                    lines.drain(..lines.len() - tail);
                }
                Ok(lines)
            }
            "merge" => {
                let parsed = Arguments::parse(&argv[1..], &["message"], &["squash", "rebase"])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        if parsed.positionals.is_empty() {
                            "worktree merge needs the branch of a worktree"
                        } else {
                            "worktree merge takes one branch and nothing else"
                        },
                    ));
                }
                if parsed.switches.contains("squash") && parsed.switches.contains("rebase") {
                    return Err(CanvasRefusal::invalid(
                        "two-strategies",
                        "worktree merge takes --squash or --rebase, not both",
                    ));
                }
                let worktree = named_worktree(&worktrees, &parsed.positionals[0])?;
                let owner = worktree["nodeId"].as_str();
                if !self.opened_by(&authority.identity.node_id, owner).await {
                    return Err(CanvasRefusal {
                        code: "not-yours".to_owned(),
                        message: format!(
                            "{} was made for {}, and worktree merge only merges the worktree of an agent you opened",
                            parsed.positionals[0],
                            owner.unwrap_or("no agent")
                        ),
                        lines: vec![
                            format!("made for\t{}", owner.unwrap_or("-")),
                            format!("you\t{}", authority.identity.node_id),
                            "person\tA person merges any worktree from the git panel".to_owned(),
                        ],
                        status: 422,
                    });
                }
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let working = self
                    .inner
                    .coordinator
                    .working_nodes(&nodes_in_worktree(&content, worktree))
                    .await
                    .map_err(rpc_refusal)?;
                if !working.is_empty() {
                    return Err(CanvasRefusal {
                        code: "agent-working".to_owned(),
                        message: format!(
                            "{} {} still working in {}. Stop {} first.",
                            working.len(),
                            if working.len() == 1 {
                                "agent is"
                            } else {
                                "agents are"
                            },
                            parsed.positionals[0],
                            if working.len() == 1 { "it" } else { "them" }
                        ),
                        lines: working
                            .iter()
                            .map(|node_id| format!("working\t{node_id}"))
                            .collect(),
                        status: 422,
                    });
                }
                let strategy = if parsed.switches.contains("squash") {
                    "squash"
                } else if parsed.switches.contains("rebase") {
                    "rebase"
                } else {
                    "merge"
                };
                let title = if let Some(owner) = owner {
                    self.inner.projects.title_for(owner).await
                } else {
                    None
                }
                .unwrap_or_else(|| parsed.positionals[0].clone());
                let subject = parsed
                    .flags
                    .get("message")
                    .map(|message| message.trim())
                    .filter(|message| !message.is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("{title}: work of the agent"));
                let result = self
                    .inner
                    .git
                    .canvas_worktree_merge(
                        &folder,
                        Path::new(worktree["path"].as_str().unwrap_or_default()),
                        strategy,
                        &subject,
                    )
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![
                    format!(
                        "merged\t{}\t{}\t{strategy}",
                        field(&parsed.positionals[0]),
                        field(result["into"].as_str().unwrap_or("-"))
                    ),
                    format!(
                        "summary\t{}",
                        field(result["summary"].as_str().unwrap_or_default())
                    ),
                    "kept\tthe worktree and its branch stay until a person removes them".to_owned(),
                ])
            }
            _ => Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("worktree has no {action} action"),
            )),
        }
    }

    async fn opened_by(&self, caller_id: &str, node_id: Option<&str>) -> bool {
        let mut current = node_id.map(ToOwned::to_owned);
        for _ in 0..64 {
            let Some(node_id) = current else {
                return false;
            };
            current = self.inner.workflow.made_by(&node_id).await;
            if current.as_deref() == Some(caller_id) {
                return true;
            }
        }
        false
    }

    async fn canvas_agent(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let parsed = Arguments::parse(
            argv,
            &[
                "prompt",
                "prompt-file",
                "cwd",
                "view",
                "beside",
                "group",
                "title",
                "task",
                "mode",
                "branch",
            ],
            &["terminal", "worktree", "dry-run"],
        )?;
        if parsed.positionals.len() != 1 {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "agent needs one CLI: claude, codex, gemini or copilot",
            ));
        }
        let provider = parsed.positionals[0].as_str();
        if !matches!(provider, "claude" | "codex" | "gemini" | "copilot") {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "agent needs a CLI: claude, codex, gemini, copilot",
            ));
        }
        if parsed.flags.contains_key("prompt") && parsed.flags.contains_key("prompt-file") {
            return Err(CanvasRefusal::invalid(
                "prompt-twice",
                "--prompt and --prompt-file both say what to start on; give one of them",
            ));
        }
        if parsed.flags.contains_key("group") && parsed.flags.contains_key("beside") {
            return Err(CanvasRefusal::invalid(
                "two-places",
                "--beside and --group both say where the node goes; give one of them",
            ));
        }
        if parsed.switches.contains("worktree") && parsed.flags.contains_key("cwd") {
            return Err(CanvasRefusal::invalid(
                "worktree-and-cwd",
                "--worktree and --cwd both say where the agent starts; give one of them",
            ));
        }
        if parsed.flags.contains_key("branch") && !parsed.switches.contains("worktree") {
            return Err(CanvasRefusal::invalid(
                "branch-needs-worktree",
                "--branch names the branch of a worktree; add --worktree",
            ));
        }
        let mut prompt = match parsed.flags.get("prompt-file") {
            Some(path) => Some(
                self.read_canvas_file(
                    &authority.project_id,
                    path,
                    "--prompt-file",
                    "bad-prompt-file",
                    "prompt-file-outside-project",
                )
                .await?,
            ),
            None => parsed.flags.get("prompt").map(|value| unescape_text(value)),
        };
        if let Some(value) = &mut prompt {
            *value = value.trim().to_owned();
            if value.is_empty() {
                return Err(CanvasRefusal::invalid(
                    "empty-prompt",
                    "The prompt is empty; leave the flag out to open an agent that waits for its person",
                ));
            }
            if value.chars().count() > 2_000 {
                return Err(CanvasRefusal::invalid(
                    "prompt-too-long",
                    format!(
                        "The prompt is {} characters and at most 2000 fit",
                        value.chars().count()
                    ),
                ));
            }
        }
        let task_title = parsed
            .flags
            .get("task")
            .map(|title| title.trim().to_owned());
        if task_title.is_some() && authority.identity.target.kind != RuntimeTargetKind::Chat {
            return Err(CanvasRefusal::invalid(
                "not-a-chat-parent",
                "Only a chat can give a task: a task wakes the chat that gave it with the result",
            ));
        }
        if task_title.is_some() && prompt.is_none() {
            return Err(CanvasRefusal::invalid(
                "task-needs-prompt",
                "--task needs --prompt or --prompt-file with the assignment",
            ));
        }
        let requested_mode = parsed
            .flags
            .get("mode")
            .map(|mode| parse_mode(mode))
            .transpose()?;
        if requested_mode.is_some_and(|mode| mode_rank(mode) > mode_rank(authority.identity.mode)) {
            return Err(CanvasRefusal::invalid(
                "mode-above-parent",
                format!(
                    "You run in {} and --mode {} is wider; an agent you open runs in your mode or a narrower one",
                    mode_name(authority.identity.mode),
                    parsed.flags["mode"]
                ),
            ));
        }
        let already = self
            .inner
            .workflow
            .opened_count(&authority.identity.node_id)
            .await as u64;
        let depth = depth_for_opening(authority.lineage_depth as u64, already, "agent", 1)
            .map_err(workflow_refusal)?;
        let content = self
            .inner
            .projects
            .read_project(&authority.project_id)
            .await
            .map_err(rpc_refusal)?;
        let caller_place = self
            .inner
            .projects
            .locate(&authority.identity.node_id)
            .await;
        if caller_place
            .as_ref()
            .and_then(|place| place["projectId"].as_str())
            != Some(authority.project_id.as_str())
        {
            return Err(CanvasRefusal::invalid(
                "not-in-project",
                "The caller is no longer a node or view of this project",
            ));
        }
        let canvas_id = parsed
            .flags
            .get("view")
            .cloned()
            .or_else(|| {
                caller_place
                    .as_ref()
                    .and_then(|place| place["canvasId"].as_str().map(ToOwned::to_owned))
            })
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-on-a-canvas",
                    "You are a view of your own; name a canvas with --view",
                )
            })?;
        let canvas = canvas_by_id(&content, &canvas_id)?;
        let canvas_nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
        if canvas_nodes.len() >= 500 {
            return Err(CanvasRefusal::invalid(
                "canvas-full",
                format!(
                    "{} holds {} nodes and this would add 1 more; a canvas holds at most 500",
                    canvas["name"]
                        .as_str()
                        .unwrap_or_else(|| canvas["id"].as_str().unwrap_or_default()),
                    canvas_nodes.len()
                ),
            ));
        }
        if let Some(beside) = parsed.flags.get("beside")
            && !canvas_nodes.iter().any(|node| node["id"] == *beside)
        {
            return Err(CanvasRefusal {
                code: "unknown-node".to_owned(),
                message: format!("{beside} is not a node on {canvas_id}"),
                lines: node_rows(canvas),
                status: 422,
            });
        }
        if let Some(group) = parsed.flags.get("group")
            && !canvas_nodes
                .iter()
                .any(|node| node["id"] == *group && node["kind"] == "group")
        {
            return Err(CanvasRefusal {
                code: "unknown-group".to_owned(),
                message: format!("{group} is not a group on {canvas_id}"),
                lines: group_rows(canvas),
                status: 422,
            });
        }
        let node_id = fresh_id(
            if chat_provider(provider) && !parsed.switches.contains("terminal") {
                "chat"
            } else {
                "terminal"
            },
            &content,
        );
        let edge_id = fresh_id("edge", &content);
        let chat = chat_provider(provider) && !parsed.switches.contains("terminal");
        let title = parsed
            .flags
            .get("title")
            .cloned()
            .or_else(|| task_title.clone())
            .unwrap_or_else(|| provider_name(provider).to_owned());
        if title.chars().count() > 120 {
            return Err(CanvasRefusal::invalid(
                "title-too-long",
                "A title is at most 120 characters",
            ));
        }
        if parsed.switches.contains("dry-run") {
            return Ok(vec![
                format!(
                    "dry-run\t{node_id}\t{}\t{canvas_id}\t{provider}\t{edge_id}\t-",
                    if chat { "chat" } else { "terminal" }
                ),
                "note\tNothing was changed".to_owned(),
            ]);
        }
        let project_folder = self
            .inner
            .projects
            .folder_of(&authority.project_id)
            .await
            .map_err(rpc_refusal)?;
        let mut cwd = match parsed.flags.get("cwd") {
            Some(cwd) => Some(
                self.resolve_canvas_path(
                    &authority.project_id,
                    cwd,
                    "--cwd",
                    "bad-cwd",
                    "cwd-outside-project",
                    true,
                )
                .await?,
            ),
            None => None,
        };
        let mut worktree: Option<Value> = None;
        if parsed.switches.contains("worktree") {
            let folder = project_folder.as_ref().ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-a-repository",
                    "This project has no local folder for a worktree",
                )
            })?;
            let branch = parsed
                .flags
                .get("branch")
                .cloned()
                .unwrap_or_else(|| branch_slug(&title));
            let (record, path) = self
                .inner
                .git
                .fork_add_worktree(folder, &branch, &authority.project_id, &node_id)
                .await
                .map_err(rpc_refusal)?;
            cwd = Some(path);
            worktree = Some(record);
        }
        let node_cwd = cwd.as_ref().map(|path| path.to_string_lossy().into_owned());
        let placed = self
            .mutate_project(&authority.project_id, |content| {
                add_agent_node(
                    content,
                    &canvas_id,
                    &authority.identity.node_id,
                    parsed.flags.get("beside").map(String::as_str),
                    parsed.flags.get("group").map(String::as_str),
                    &node_id,
                    &edge_id,
                    provider,
                    chat,
                    &title,
                    node_cwd.as_deref(),
                    requested_mode,
                )
            })
            .await;
        let view_id = match placed {
            Ok((_, view_id)) => view_id,
            Err(error) => {
                if let Some(worktree) = &worktree {
                    let _ = self.inner.git.fork_remove_worktree(worktree).await;
                }
                return Err(rpc_refusal(error));
            }
        };
        let setup = async {
            self.inner
                .workflow
                .record_lineage_with_ceiling(
                    &authority.project_id,
                    &node_id,
                    &authority.identity.node_id,
                    depth,
                    true,
                    None,
                    authority.identity.mode,
                )
                .await?;
            let delivered_prompt = prompt.as_ref().map(|prompt| {
                format!(
                    "{prompt}{}",
                    task_title.as_ref().map_or("", |_| if chat {
                        "\n\n(This is a task from the agent that opened you. End this turn with the result as your last message; that is reported back to it, so no ruimte-context call is needed.)"
                    } else {
                        "\n\n(This is a task from the agent that opened you. When it is finished, run ruimte-context done --result '...'.)"
                    })
                )
            });
            if let Some(prompt) = &delivered_prompt {
                self.inner
                    .workflow
                    .prompts()
                    .put(&authority.project_id, &node_id, prompt)
                    .await?;
            }
            let task = if let Some(task_title) = &task_title {
                Some(
                    self.inner
                        .workflow
                        .open_task_authorized(
                            &authority.project_id,
                            &authority.identity.node_id,
                            &node_id,
                            task_title,
                            prompt.as_deref().unwrap_or_default(),
                            None,
                            authority,
                        )
                        .await?,
                )
            } else {
                None
            };
            if let Some(task) = &task {
                self.inner.coordinator.sync_task(task).await;
            }
            self.inner
                .coordinator
                .enqueue(
                    &authority.project_id,
                    &node_id,
                    json!({
                        "kind": "start-agent",
                        "payload": {
                            "node": if chat { "chat" } else { "terminal" },
                            "provider": provider,
                            "cwd": node_cwd,
                            "runtimeMode": mode_name(requested_mode.unwrap_or(authority.identity.mode)),
                            "ceiling": mode_name(authority.identity.mode)
                        }
                    }),
                    authority,
                )
                .await?;
            Ok::<_, crate::rpc::RpcError>(task)
        }
        .await;
        let task = match setup {
            Ok(task) => task,
            Err(error) => {
                self.rollback_agent(&authority.project_id, &node_id).await;
                if let Some(worktree) = &worktree {
                    let _ = self.inner.git.fork_remove_worktree(worktree).await;
                }
                return Err(rpc_refusal(error));
            }
        };
        let mut fields = vec![
            node_id,
            if chat { "chat" } else { "terminal" }.to_owned(),
            view_id,
            provider.to_owned(),
            edge_id,
        ];
        if let Some(task_id) = task.as_ref().and_then(|task| task["id"].as_str()) {
            fields.push(task_id.to_owned());
        }
        let mut lines = vec![fields.join("\t")];
        if task.is_some() {
            lines.push("next\tEnd your turn once you gave every task you mean to give: the result arrives as your next message once this task settled. Do not poll task list, run link new or read the agent for it.".to_owned());
        }
        Ok(lines)
    }

    async fn canvas_team(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let parsed = Arguments::parse(
            argv,
            &["label", "roles", "cwd", "view", "mode"],
            &["task", "worktree", "dry-run"],
        )?;
        if !parsed.positionals.is_empty() {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "team takes no arguments, only flags; the agents go in --roles",
            ));
        }
        let label = required_flag(&parsed, "label", "--label needs a name for the group")?
            .trim()
            .to_owned();
        if label.is_empty() || label.chars().count() > 120 {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                if label.is_empty() {
                    "--label needs a name for the group".to_owned()
                } else {
                    format!(
                        "--label is {} characters and at most 120 fit in a name on the canvas",
                        label.chars().count()
                    )
                },
            ));
        }
        let raw_roles = required_flag(
            &parsed,
            "roles",
            "--roles needs the roles as JSON, [{\"title\": \"Lexer\", \"prompt\": \"Fix the tokenizer\", \"provider\": \"claude\"}]",
        )?;
        let roles = parse_team_roles(raw_roles)?;
        for (index, role) in roles.iter().enumerate() {
            if parsed.switches.contains("task") && role.prompt.chars().count() > 1_760 {
                return Err(CanvasRefusal::invalid(
                    "prompt-too-long",
                    format!(
                        "role {index} (prompt): {} characters, and a task takes at most 1760, since the child is also told how to report back",
                        role.prompt.chars().count()
                    ),
                ));
            }
        }
        if parsed.switches.contains("worktree") && parsed.flags.contains_key("cwd") {
            return Err(CanvasRefusal::invalid(
                "worktree-and-cwd",
                "--worktree and --cwd both say where the agents start; give one of them",
            ));
        }
        if parsed.switches.contains("task")
            && authority.identity.target.kind != RuntimeTargetKind::Chat
        {
            return Err(CanvasRefusal::invalid(
                "not-a-chat-parent",
                "Only a chat can give a task: a task wakes the chat that gave it with the result",
            ));
        }
        let requested_mode = parsed
            .flags
            .get("mode")
            .map(|mode| parse_mode(mode))
            .transpose()?;
        if requested_mode.is_some_and(|mode| mode_rank(mode) > mode_rank(authority.identity.mode)) {
            return Err(CanvasRefusal::invalid(
                "mode-above-parent",
                format!(
                    "You run in {} and --mode {} is wider; an agent you open runs in your mode or a narrower one",
                    mode_name(authority.identity.mode),
                    parsed.flags["mode"]
                ),
            ));
        }
        let already = self
            .inner
            .workflow
            .opened_count(&authority.identity.node_id)
            .await as u64;
        let depth = depth_for_opening(
            authority.lineage_depth as u64,
            already,
            "team",
            roles.len() as u64,
        )
        .map_err(workflow_refusal)?;
        for (index, role) in roles.iter().enumerate() {
            if !provider_available(&role.provider).await {
                return Err(CanvasRefusal::invalid(
                    "cli-not-installed",
                    format!(
                        "role {index} ({}): {} is not installed on this machine",
                        role.provider,
                        provider_name(&role.provider)
                    ),
                ));
            }
        }
        let content = self
            .inner
            .projects
            .read_project(&authority.project_id)
            .await
            .map_err(rpc_refusal)?;
        let caller_place = self
            .inner
            .projects
            .locate(&authority.identity.node_id)
            .await;
        if caller_place
            .as_ref()
            .and_then(|place| place["projectId"].as_str())
            != Some(authority.project_id.as_str())
        {
            return Err(CanvasRefusal::invalid(
                "not-in-project",
                "The caller is no longer a node or view of this project",
            ));
        }
        let canvas_id = parsed
            .flags
            .get("view")
            .cloned()
            .or_else(|| {
                caller_place
                    .as_ref()
                    .and_then(|place| place["canvasId"].as_str().map(ToOwned::to_owned))
            })
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-on-a-canvas",
                    "You are a view of your own; name a canvas with --view",
                )
            })?;
        let canvas = canvas_by_id(&content, &canvas_id)?;
        let canvas_nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
        if canvas_nodes.len() + roles.len() + 1 > 500 {
            return Err(CanvasRefusal::invalid(
                "canvas-full",
                format!(
                    "{} holds {} nodes and this would add {} more; a canvas holds at most 500",
                    canvas["name"]
                        .as_str()
                        .unwrap_or_else(|| canvas["id"].as_str().unwrap_or_default()),
                    canvas_nodes.len(),
                    roles.len() + 1
                ),
            ));
        }
        let caller_on_canvas = canvas_nodes
            .iter()
            .any(|node| node["id"] == authority.identity.node_id);
        let project_folder = self
            .inner
            .projects
            .folder_of(&authority.project_id)
            .await
            .map_err(rpc_refusal)?;
        let shared_cwd = match parsed.flags.get("cwd") {
            Some(cwd) => Some(
                self.resolve_canvas_path(
                    &authority.project_id,
                    cwd,
                    "--cwd",
                    "bad-cwd",
                    "cwd-outside-project",
                    true,
                )
                .await?
                .to_string_lossy()
                .into_owned(),
            ),
            None => None,
        };
        let worktree_branches = if parsed.switches.contains("worktree") {
            let folder = project_folder.as_ref().ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-a-repository",
                    "This project has no local folder for a worktree",
                )
            })?;
            Some(
                self.inner
                    .git
                    .fork_branches(folder)
                    .await
                    .map_err(rpc_refusal)?
                    .ok_or_else(|| {
                        CanvasRefusal::invalid(
                            "not-a-repository",
                            "This project folder is not inside a Git repository",
                        )
                    })?,
            )
        } else {
            None
        };
        if parsed.switches.contains("dry-run") {
            let mut lines = vec![format!(
                "dry-run\tgroup\t{}\t{canvas_id}\t-\t-",
                field(&label)
            )];
            lines.extend(roles.iter().map(|role| {
                format!(
                    "dry-run\t{}\t{}\t{canvas_id}\t{}\t{}{}",
                    if chat_provider(&role.provider) && !role.terminal {
                        "chat"
                    } else {
                        "terminal"
                    },
                    field(role.title.trim()),
                    role.provider,
                    if caller_on_canvas {
                        format!(
                            "{} -> <{}>",
                            authority.identity.node_id,
                            field(role.title.trim())
                        )
                    } else {
                        "-".to_owned()
                    },
                    if parsed.switches.contains("task") {
                        "\t<new task>"
                    } else {
                        ""
                    }
                )
            }));
            return Ok(lines);
        }
        let mut taken_ids = HashSet::new();
        let group_id = fresh_distinct_id("group", &content, &mut taken_ids);
        let mut members = roles
            .into_iter()
            .map(|role| {
                let chat = chat_provider(&role.provider) && !role.terminal;
                TeamMember {
                    id: fresh_distinct_id(
                        if chat { "chat" } else { "terminal" },
                        &content,
                        &mut taken_ids,
                    ),
                    edge_id: caller_on_canvas
                        .then(|| fresh_distinct_id("edge", &content, &mut taken_ids)),
                    role,
                    chat,
                    cwd: shared_cwd.clone(),
                }
            })
            .collect::<Vec<_>>();
        let mut worktrees = Vec::new();
        if parsed.switches.contains("worktree") {
            let folder = project_folder.as_ref().unwrap();
            let mut taken = worktree_branches
                .unwrap()
                .into_iter()
                .collect::<HashSet<_>>();
            for member in &mut members {
                let branch = free_branch(&branch_slug(member.role.title.trim()), &mut taken);
                match self
                    .inner
                    .git
                    .fork_add_worktree(folder, &branch, &authority.project_id, &member.id)
                    .await
                {
                    Ok((record, path)) => {
                        member.cwd = Some(path.to_string_lossy().into_owned());
                        worktrees.push(record);
                    }
                    Err(error) => {
                        for record in &worktrees {
                            let _ = self.inner.git.fork_remove_worktree(record).await;
                        }
                        return Err(rpc_refusal(error));
                    }
                }
            }
        }
        let placed = self
            .mutate_project(&authority.project_id, |content| {
                add_team_nodes(
                    content,
                    &canvas_id,
                    &authority.identity.node_id,
                    &group_id,
                    &label,
                    &members,
                    requested_mode,
                )
            })
            .await;
        let mut lines = match placed {
            Ok((_, lines)) => lines,
            Err(error) => {
                for record in &worktrees {
                    let _ = self.inner.git.fork_remove_worktree(record).await;
                }
                return Err(rpc_refusal(error));
            }
        };
        let setup = async {
            for member in &members {
                self.inner
                    .workflow
                    .record_lineage_with_ceiling(
                        &authority.project_id,
                        &member.id,
                        &authority.identity.node_id,
                        depth,
                        true,
                        None,
                        authority.identity.mode,
                    )
                    .await?;
                let prompt = if parsed.switches.contains("task") {
                    format!(
                        "{}{}",
                        member.role.prompt.trim(),
                        if member.chat {
                            "\n\n(This is a task from the agent that opened you. End this turn with the result as your last message; that is reported back to it, so no ruimte-context call is needed.)"
                        } else {
                            "\n\n(This is a task from the agent that opened you. When it is finished, run ruimte-context done --result '...'.)"
                        }
                    )
                } else {
                    member.role.prompt.trim().to_owned()
                };
                self.inner
                    .workflow
                    .prompts()
                    .put(&authority.project_id, &member.id, &prompt)
                    .await?;
            }
            if parsed.switches.contains("task") {
                let batch_id = random_id("batch");
                for (index, member) in members.iter().enumerate() {
                    let task = self
                        .inner
                        .workflow
                        .open_task_authorized(
                            &authority.project_id,
                            &authority.identity.node_id,
                            &member.id,
                            member.role.title.trim(),
                            member.role.prompt.trim(),
                            Some(&batch_id),
                            authority,
                        )
                        .await?;
                    self.inner.coordinator.sync_task(&task).await;
                    lines[index + 1].push('\t');
                    lines[index + 1].push_str(task["id"].as_str().unwrap_or_default());
                }
            }
            for member in &members {
                self.inner
                    .coordinator
                    .enqueue(
                        &authority.project_id,
                        &member.id,
                        json!({
                            "kind": "start-agent",
                            "payload": {
                                "node": if member.chat { "chat" } else { "terminal" },
                                "provider": member.role.provider,
                                "cwd": member.cwd,
                                "runtimeMode": mode_name(requested_mode.unwrap_or(authority.identity.mode)),
                                "ceiling": mode_name(authority.identity.mode)
                            }
                        }),
                        authority,
                    )
                    .await?;
            }
            Ok::<(), crate::rpc::RpcError>(())
        }
        .await;
        if let Err(error) = setup {
            self.rollback_nodes(
                &authority.project_id,
                std::iter::once(group_id.as_str())
                    .chain(members.iter().map(|member| member.id.as_str())),
            )
            .await;
            for record in &worktrees {
                let _ = self.inner.git.fork_remove_worktree(record).await;
            }
            return Err(rpc_refusal(error));
        }
        if parsed.switches.contains("task") {
            lines.push("next\tEnd your turn now: the results arrive as your next message once every task settled. Do not poll task list, run link new or read the agents for them.".to_owned());
        }
        Ok(lines)
    }

    async fn rollback_nodes<'a>(
        &self,
        project_id: &str,
        node_ids: impl IntoIterator<Item = &'a str>,
    ) {
        let node_ids = node_ids
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<HashSet<_>>();
        let _ = self
            .mutate_project(project_id, |content| {
                if let Some(views) = content["views"].as_array_mut() {
                    for view in views {
                        if let Some(nodes) = view["nodes"].as_array_mut() {
                            nodes.retain(|node| {
                                !node["id"].as_str().is_some_and(|id| node_ids.contains(id))
                            });
                        }
                        if let Some(edges) = view["edges"].as_array_mut() {
                            edges.retain(|edge| {
                                !["from", "to"].iter().any(|field| {
                                    edge[*field]
                                        .as_str()
                                        .is_some_and(|id| node_ids.contains(id))
                                })
                            });
                        }
                    }
                }
                Ok(())
            })
            .await;
    }

    async fn rollback_agent(&self, project_id: &str, node_id: &str) {
        let _ = self
            .mutate_project(project_id, |content| {
                if let Some(views) = content["views"].as_array_mut() {
                    for view in views {
                        if let Some(nodes) = view["nodes"].as_array_mut() {
                            nodes.retain(|node| node["id"] != node_id);
                        }
                        if let Some(edges) = view["edges"].as_array_mut() {
                            edges.retain(|edge| edge["from"] != node_id && edge["to"] != node_id);
                        }
                    }
                }
                Ok(())
            })
            .await;
        let _ = self.inner.workflow.remove_lineage(node_id).await;
        let _ = self.inner.workflow.prompts().remove(node_id).await;
    }

    async fn canvas_done(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        if argv.iter().any(|word| word == "--text") {
            return Err(CanvasRefusal {
                code: "unknown-flag".to_owned(),
                message: "--text is not one of --result, --result-file".to_owned(),
                lines: vec![
                    "usage\tdone\t--result T | --result-file F".to_owned(),
                    "detail\truimte-context help done".to_owned(),
                ],
                status: 422,
            });
        }
        let parsed = Arguments::parse(argv, &["result", "result-file"], &[])?;
        if !parsed.positionals.is_empty() {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "done takes no arguments; the result goes in --result",
            ));
        }
        if parsed.flags.contains_key("result") && parsed.flags.contains_key("result-file") {
            return Err(CanvasRefusal::invalid(
                "result-twice",
                "--result and --result-file both carry the result; give one of them",
            ));
        }
        let mut text = match parsed.flags.get("result-file") {
            Some(path) => {
                self.read_canvas_file(
                    &authority.project_id,
                    path,
                    "--result-file",
                    "bad-result-file",
                    "result-file-outside-project",
                )
                .await?
            }
            None => parsed
                .flags
                .get("result")
                .map(|value| unescape_text(value))
                .ok_or_else(|| {
                    CanvasRefusal::invalid(
                        "empty-result",
                        "--result needs what came of the task, in quotes",
                    )
                })?,
        };
        text = text.trim().to_owned();
        if text.is_empty() {
            return Err(CanvasRefusal::invalid(
                "empty-result",
                "The result is empty; say what came of the task, even when that is that nothing could be done",
            ));
        }
        if text.chars().count() > MAX_RESULT_LENGTH {
            return Err(CanvasRefusal::invalid(
                "result-too-long",
                format!(
                    "The result is {} characters and at most {MAX_RESULT_LENGTH} fit; put the rest in a file and name it in the result",
                    text.chars().count()
                ),
            ));
        }
        let settled = self
            .inner
            .coordinator
            .done(authority, text)
            .await
            .map_err(rpc_refusal)?;
        let Some(task) = settled else {
            let lines = self
                .inner
                .workflow
                .involving(&authority.identity.node_id)
                .await
                .into_iter()
                .filter(|task| task["childId"] == authority.identity.node_id)
                .map(|task| task_line(&task, &authority.identity.node_id))
                .collect();
            return Err(CanvasRefusal {
                code: "no-open-task".to_owned(),
                message: "You have no open task to report on: done is for a node another chat opened with --task, until that task settles".to_owned(),
                lines,
                status: 422,
            });
        };
        Ok(vec![format!(
            "done\t{}\t{}",
            task["id"].as_str().unwrap_or_default(),
            task["parentId"].as_str().unwrap_or_default()
        )])
    }

    async fn canvas_notify(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let parsed = Arguments::parse(argv, &["text"], &[])?;
        if parsed.positionals.is_empty() {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "notify takes the id of the node to notify",
            ));
        }
        if parsed.positionals.len() != 1 {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "notify takes one id and nothing else; the message goes in --text",
            ));
        }
        let target_id = &parsed.positionals[0];
        let text = parsed
            .flags
            .get("text")
            .map(|text| unescape_text(text))
            .filter(|text| !text.is_empty())
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "bad-arguments",
                    "--text needs the message to leave, in quotes",
                )
            })?;
        if text.chars().count() > 500 {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                format!(
                    "--text is {} characters and a message is at most 500; anything longer belongs in a note on the canvas, which you can link to that node",
                    text.chars().count()
                ),
            ));
        }
        if target_id == &authority.identity.node_id {
            return Err(CanvasRefusal::invalid(
                "self-notify",
                format!("{target_id} is you; a node needs no message to itself"),
            ));
        }
        let place = self
            .inner
            .projects
            .locate(&authority.identity.node_id)
            .await
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-on-a-canvas",
                    "You are a view of your own, not a node on a canvas, so no line runs from you into anything",
                )
            })?;
        let Some(canvas_id) = place["canvasId"].as_str() else {
            return Err(CanvasRefusal::invalid(
                "not-on-a-canvas",
                "You are a view of your own, not a node on a canvas, so no line runs from you into anything",
            ));
        };
        let content = self
            .inner
            .projects
            .read_project(&authority.project_id)
            .await
            .map_err(rpc_refusal)?;
        let canvas = canvas_by_id(&content, canvas_id)?;
        let nodes = canvas["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let edges = canvas["edges"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        let reachable = nodes
            .iter()
            .filter(|node| matches!(node["kind"].as_str(), Some("chat" | "terminal")))
            .filter(|node| {
                edges.iter().any(|edge| {
                    edge["from"] == authority.identity.node_id && edge["to"] == node["id"]
                })
            })
            .collect::<Vec<_>>();
        let alternatives = || {
            if reachable.is_empty() {
                vec![format!(
                    "note\tNothing on {canvas_id} has a line from you into it yet; ruimte-context link new --to {target_id} draws the one this call needs"
                )]
            } else {
                reachable
                    .iter()
                    .map(|node| {
                        format!(
                            "node\t{}\t{}\t{}",
                            node["id"].as_str().unwrap_or_default(),
                            node["kind"].as_str().unwrap_or_default(),
                            field(node["title"].as_str().unwrap_or_default())
                        )
                    })
                    .collect()
            }
        };
        let Some(target) = nodes.iter().find(|node| node["id"] == *target_id) else {
            return Err(CanvasRefusal {
                code: "unknown-node".to_owned(),
                message: format!("{target_id} is not a node on {canvas_id}"),
                lines: alternatives(),
                status: 422,
            });
        };
        let kind = target["kind"].as_str().unwrap_or_default();
        if !matches!(kind, "chat" | "terminal") {
            return Err(CanvasRefusal {
                code: "not-an-agent".to_owned(),
                message: format!(
                    "{target_id} is a {kind} node; only a terminal or a chat has an agent that could read a message"
                ),
                lines: alternatives(),
                status: 422,
            });
        }
        if !reachable.iter().any(|node| node["id"] == *target_id) {
            let mut lines = alternatives();
            lines.push(format!(
                "see\truimte-context link new --to {target_id}\tdraws the line this needs"
            ));
            return Err(CanvasRefusal {
                code: "not-linked".to_owned(),
                message: format!(
                    "{target_id} is a {kind} node on {canvas_id}, but no line runs from you into it: draw that line and it can be notified"
                ),
                lines,
                status: 422,
            });
        }
        let from_title = nodes
            .iter()
            .find(|node| node["id"] == authority.identity.node_id)
            .and_then(|node| node["title"].as_str())
            .unwrap_or_default();
        let notice = json!({
            "projectId": authority.project_id,
            "targetId": target_id,
            "from": authority.identity.node_id,
            "fromTitle": field(from_title),
            "text": text
        });
        let mut waits_for_agent = false;
        if kind == "terminal" {
            match self
                .inner
                .context
                .deliver_terminal_notice(
                    target_id,
                    &super::notice_store::NoticeStore::render(&notice),
                )
                .await
                .map_err(rpc_refusal)?
            {
                super::context::TerminalNoticeDelivery::Immediate(detail) => {
                    return Ok(vec![format!("notified\t{target_id}\tnow\t{detail}")]);
                }
                super::context::TerminalNoticeDelivery::WaitingAgent => {
                    waits_for_agent = true;
                }
                super::context::TerminalNoticeDelivery::Absent => {}
            }
        }
        let waiting = self
            .inner
            .workflow
            .notices()
            .put(notice)
            .await
            .map_err(rpc_refusal)?;
        let detail = if kind == "chat" {
            format!("the chat reads it in front of its next prompt ({waiting} waiting)")
        } else if waits_for_agent {
            format!("its agent reads it at the start of its next turn ({waiting} waiting)")
        } else {
            format!(
                "nothing runs in that node yet; it reads the message when it starts ({waiting} waiting)"
            )
        };
        Ok(vec![format!("notified\t{target_id}\twaiting\t{detail}")])
    }

    async fn canvas_task(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "task needs an action: list",
            ));
        };
        if action != "list" {
            return Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("task has no {action} action; pick list"),
            ));
        }
        let parsed = Arguments::parse(&argv[1..], &[], &["all"])?;
        if !parsed.positionals.is_empty() {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "task list takes no arguments",
            ));
        }
        let tasks = self
            .inner
            .workflow
            .involving(&authority.identity.node_id)
            .await;
        if tasks.is_empty() {
            return Ok(vec![
                "note\tYou have given no task and were given none; ruimte-context agent --task gives one"
                    .to_owned(),
            ]);
        }
        if parsed.switches.contains("all") {
            return Ok(tasks
                .iter()
                .map(|task| task_line(task, &authority.identity.node_id))
                .collect());
        }
        let current = tasks
            .iter()
            .filter(|task| {
                task["status"] == "open"
                    || (task["parentId"] == authority.identity.node_id && task["wake"] == "pending")
            })
            .collect::<Vec<_>>();
        let older = tasks.len() - current.len();
        let mut lines = current
            .iter()
            .map(|task| task_line(task, &authority.identity.node_id))
            .collect::<Vec<_>>();
        if older > 0 {
            let hidden = if older == 1 {
                "1 older task is hidden, settled and already reported; ruimte-context task list --all lists it".to_owned()
            } else {
                format!(
                    "{older} older tasks are hidden, settled and already reported; ruimte-context task list --all lists them"
                )
            };
            lines.push(if current.is_empty() {
                format!("note\tNo task is open or waiting to wake you; {hidden}")
            } else {
                format!("note\t{hidden}")
            });
        }
        Ok(lines)
    }

    async fn canvas_node(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "node needs an action: list, new, rename, delete, group or arrange",
            ));
        };
        if action != "new" && argv[1..].iter().any(|word| word == "--dry-run") {
            return Err(CanvasRefusal {
                code: "no-dry-run".to_owned(),
                message: format!(
                    "node {action} takes no --dry-run; only the verbs that make something do"
                ),
                lines: vec![
                    "verb\tnode new\ttakes --dry-run".to_owned(),
                    "verb\tagent\ttakes --dry-run".to_owned(),
                    "verb\tplan new\ttakes --dry-run".to_owned(),
                    "verb\tteam\ttakes --dry-run".to_owned(),
                ],
                status: 422,
            });
        }
        match action {
            "list" => {
                let parsed = Arguments::parse(&argv[1..], &["view"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node list takes no arguments, only flags",
                    ));
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let canvas = canvas_by_id(&content, &canvas_id)?;
                let nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
                let mut lines = nodes
                    .iter()
                    .map(|node| {
                        [
                            node["id"].as_str().unwrap_or_default().to_owned(),
                            node["kind"].as_str().unwrap_or_default().to_owned(),
                            field(node["title"].as_str().unwrap_or_default()),
                            rounded(node, "x"),
                            rounded(node, "y"),
                            rounded(node, "w"),
                            rounded(node, "h"),
                            containing_group(&nodes, node).unwrap_or_default(),
                        ]
                        .join("\t")
                    })
                    .collect::<Vec<_>>();
                lines.push(
                    if nodes
                        .iter()
                        .any(|node| node["id"] == authority.identity.node_id)
                    {
                        format!("self\t{}", authority.identity.node_id)
                    } else {
                        "self\t-\tyou are not a node on this canvas".to_owned()
                    },
                );
                Ok(lines)
            }
            "new" => {
                let parsed = Arguments::parse(
                    &argv[1..],
                    &[
                        "title", "text", "url", "path", "source", "cwd", "view", "beside",
                    ],
                    &["dry-run"],
                )?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node new takes one kind and nothing else; a title goes in --title",
                    ));
                }
                let kind = parsed.positionals[0].as_str();
                if !matches!(
                    kind,
                    "note" | "browser" | "drawing" | "diagram" | "file" | "terminal" | "chat"
                ) {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node new needs note, browser, drawing, diagram, file, terminal or chat",
                    ));
                }
                let required = match kind {
                    "browser" => Some("url"),
                    "file" => Some("path"),
                    "drawing" | "diagram" => Some("source"),
                    _ => None,
                };
                if required.is_some_and(|flag| !parsed.flags.contains_key(flag)) {
                    return Err(CanvasRefusal::invalid(
                        "missing-flag",
                        format!("A {kind} node needs --{}", required.unwrap()),
                    ));
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                if parsed.switches.contains("dry-run") {
                    return Ok(vec![format!("dry-run\t{kind}\t{canvas_id}")]);
                }
                let cwd = match parsed.flags.get("cwd") {
                    Some(path) => Some(
                        self.resolve_canvas_path(
                            &authority.project_id,
                            path,
                            "--cwd",
                            "bad-cwd",
                            "cwd-outside-project",
                            true,
                        )
                        .await?
                        .to_string_lossy()
                        .into_owned(),
                    ),
                    None => None,
                };
                let path = match parsed.flags.get("path") {
                    Some(path) => Some(self.resolve_node_file(&authority.project_id, path).await?),
                    None => None,
                };
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let node_id = fresh_id(kind, &content);
                self.inner
                    .workflow
                    .record_lineage(
                        &authority.project_id,
                        &node_id,
                        &authority.identity.node_id,
                        0,
                        false,
                        None,
                    )
                    .await
                    .map_err(rpc_refusal)?;
                let result = self
                    .mutate_project(&authority.project_id, |content| {
                        add_plain_node(
                            content,
                            &canvas_id,
                            &authority.identity.node_id,
                            parsed.flags.get("beside").map(String::as_str),
                            &node_id,
                            kind,
                            parsed.flags.get("title").map(String::as_str),
                            parsed.flags.get("text").map(|value| unescape_text(value)),
                            parsed.flags.get("url").map(String::as_str),
                            path.as_deref(),
                            parsed.flags.get("source").map(String::as_str),
                            cwd.as_deref(),
                        )
                    })
                    .await;
                if let Err(error) = result {
                    let _ = self.inner.workflow.remove_lineage(&node_id).await;
                    return Err(rpc_refusal(error));
                }
                Ok(vec![format!("{node_id}\t{kind}\t{canvas_id}")])
            }
            "rename" => {
                let parsed = Arguments::parse(&argv[1..], &["title", "view"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node rename takes one node id and nothing else; the title goes in --title",
                    ));
                }
                let title = parsed
                    .flags
                    .get("title")
                    .map(|title| title.trim())
                    .filter(|title| !title.is_empty())
                    .ok_or_else(|| {
                        CanvasRefusal::invalid("bad-arguments", "--title needs a title")
                    })?;
                if title.chars().count() > 120 {
                    return Err(CanvasRefusal::invalid(
                        "title-too-long",
                        "A title is at most 120 characters",
                    ));
                }
                let id = &parsed.positionals[0];
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let canvas = canvas_by_id(&content, &canvas_id)?;
                let Some(node) = canvas["nodes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|node| node["id"] == *id)
                else {
                    return Err(CanvasRefusal {
                        code: "unknown-node".to_owned(),
                        message: format!("{id} is not a node on {canvas_id}"),
                        lines: node_rows(canvas),
                        status: 422,
                    });
                };
                let kind = node["kind"].as_str().unwrap_or_default().to_owned();
                if node["title"].as_str() == Some(title) {
                    return Ok(vec![format!("{id}\t{kind}\t{}", field(title))]);
                }
                let (_, kind) = self
                    .mutate_project(&authority.project_id, |content| {
                        rename_node(content, &canvas_id, id, title)
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!("{id}\t{kind}\t{}", field(title))])
            }
            "delete" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node delete takes one node id and nothing else",
                    ));
                }
                let id = &parsed.positionals[0];
                if id == &authority.identity.node_id {
                    return Err(CanvasRefusal::invalid(
                        "deletes-caller",
                        format!("You are {id}, so removing it would end the session asking"),
                    ));
                }
                let maker = self.inner.workflow.made_by(id).await;
                if maker.as_deref() != Some(&authority.identity.node_id) {
                    return Err(CanvasRefusal {
                        code: "not-yours".to_owned(),
                        message: format!(
                            "{id} was made by {} and node delete only removes a node you made yourself",
                            maker.as_deref().unwrap_or("a person")
                        ),
                        lines: vec![
                            format!("made by\t{}", maker.as_deref().unwrap_or("a person")),
                            format!("you\t{}", authority.identity.node_id),
                            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view; a person turns it on from the Machines pane".to_owned(),
                        ],
                        status: 422,
                    });
                }
                let (_, lines) = self
                    .mutate_project(&authority.project_id, |content| delete_node(content, id))
                    .await
                    .map_err(rpc_refusal)?;
                Ok(lines)
            }
            "group" => {
                let parsed =
                    Arguments::parse(&argv[1..], &["nodes", "label", "color", "view"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node group takes no arguments, only flags; the nodes go in --nodes",
                    ));
                }
                let ids = comma_ids(parsed.flags.get("nodes"), "--nodes")?;
                let label = parsed
                    .flags
                    .get("label")
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Group");
                if label.chars().count() > 120 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        format!(
                            "--label is {} characters and at most 120 fit in a name on the canvas",
                            label.chars().count()
                        ),
                    ));
                }
                let accent = parsed.flags.get("color").map(String::as_str);
                if accent.is_some_and(|accent| !NODE_ACCENT_NAMES.contains(&accent)) {
                    return Err(CanvasRefusal {
                        code: "unknown-color".to_owned(),
                        message: format!(
                            "{} is not one of the {} colors a frame takes",
                            accent.unwrap(),
                            NODE_ACCENT_NAMES.len()
                        ),
                        lines: vec![format!("colors\t{}", NODE_ACCENT_NAMES.join("\t"))],
                        status: 422,
                    });
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let canvas = canvas_by_id(&content, &canvas_id)?;
                validate_group(canvas, &ids)?;
                let group_id = fresh_id("group", &content);
                self.inner
                    .workflow
                    .record_lineage(
                        &authority.project_id,
                        &group_id,
                        &authority.identity.node_id,
                        0,
                        false,
                        None,
                    )
                    .await
                    .map_err(rpc_refusal)?;
                let result = self
                    .mutate_project(&authority.project_id, |content| {
                        group_nodes(content, &canvas_id, &ids, &group_id, label, accent)
                    })
                    .await;
                match result {
                    Ok((_, lines)) => Ok(lines),
                    Err(error) => {
                        let _ = self.inner.workflow.remove_lineage(&group_id).await;
                        Err(rpc_refusal(error))
                    }
                }
            }
            "arrange" => {
                let parsed =
                    Arguments::parse(&argv[1..], &["nodes", "layout", "cols", "view"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "node arrange takes no arguments, only flags; the nodes go in --nodes",
                    ));
                }
                let ids = comma_ids(parsed.flags.get("nodes"), "--nodes")?;
                let layout = parsed
                    .flags
                    .get("layout")
                    .map(String::as_str)
                    .unwrap_or("grid");
                if !matches!(layout, "grid" | "row" | "column") {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "--layout takes one of grid, row, column",
                    ));
                }
                if layout != "grid" && parsed.flags.contains_key("cols") {
                    return Err(CanvasRefusal::invalid(
                        "flag-not-for-layout",
                        format!(
                            "--cols does not go with {layout}; a row is one row and a column is one column"
                        ),
                    ));
                }
                let cols = parsed
                    .flags
                    .get("cols")
                    .map(|value| {
                        value
                            .parse::<usize>()
                            .ok()
                            .filter(|value| *value > 0)
                            .ok_or_else(|| {
                                CanvasRefusal::invalid(
                                    "bad-arguments",
                                    "--cols needs a whole number of columns, 1 or more",
                                )
                            })
                    })
                    .transpose()?;
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let (_, lines) = self
                    .mutate_project(&authority.project_id, |content| {
                        arrange_nodes(content, &canvas_id, &ids, layout, cols)
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(lines)
            }
            _ => Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("node has no {action} action yet"),
            )),
        }
    }

    async fn canvas_link(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "link needs an action: list, new or delete",
            ));
        };
        match action {
            "list" => {
                let parsed = Arguments::parse(&argv[1..], &["view"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "link list takes no arguments, only flags",
                    ));
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let canvas = canvas_by_id(&content, &canvas_id)?;
                Ok(canvas["edges"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|edge| {
                        [
                            edge["id"].as_str().unwrap_or_default(),
                            edge["from"].as_str().unwrap_or_default(),
                            edge["to"].as_str().unwrap_or_default(),
                            &field(edge["label"].as_str().unwrap_or_default()),
                        ]
                        .join("\t")
                    })
                    .collect())
            }
            "new" => {
                let parsed = Arguments::parse(&argv[1..], &["to", "from", "label", "view"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "link new takes no arguments, only flags; the nodes go in --to",
                    ));
                }
                let targets = comma_ids(parsed.flags.get("to"), "--to")?;
                if targets.len() > 20 {
                    return Err(CanvasRefusal::invalid(
                        "too-many-links",
                        format!(
                            "--to names {} nodes and at most 20 may be linked at once",
                            targets.len()
                        ),
                    ));
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let from = parsed
                    .flags
                    .get("from")
                    .cloned()
                    .unwrap_or_else(|| authority.identity.node_id.clone());
                let label = parsed.flags.get("label").cloned();
                let (_, lines) = self
                    .mutate_project(&authority.project_id, |content| {
                        add_links(content, &canvas_id, &from, &targets, label.as_deref())
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(lines)
            }
            "delete" => {
                let parsed = Arguments::parse(&argv[1..], &["view"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "link delete takes one line id and nothing else",
                    ));
                }
                let canvas_id = self
                    .canvas_id(authority, parsed.flags.get("view").map(String::as_str))
                    .await?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let canvas = canvas_by_id(&content, &canvas_id)?;
                let edge_id = &parsed.positionals[0];
                let edge = canvas["edges"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|edge| edge["id"].as_str() == Some(edge_id.as_str()))
                    .cloned()
                    .ok_or_else(|| {
                        CanvasRefusal::invalid(
                            "unknown-edge",
                            format!("{edge_id} is not a line on {canvas_id}"),
                        )
                    })?;
                for end in [
                    edge["from"].as_str().unwrap_or_default(),
                    edge["to"].as_str().unwrap_or_default(),
                ] {
                    if end != authority.identity.node_id
                        && self.inner.workflow.made_by(end).await.as_deref()
                            != Some(&authority.identity.node_id)
                    {
                        return Err(CanvasRefusal::invalid(
                            "not-yours",
                            format!("{edge_id} touches {end}, which you did not make"),
                        ));
                    }
                }
                let (_, removed) = self
                    .mutate_project(&authority.project_id, |content| {
                        delete_link(content, &canvas_id, edge_id)
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!(
                    "deleted\t{edge_id}\t{}\t{}\t{}",
                    removed["from"].as_str().unwrap_or_default(),
                    removed["to"].as_str().unwrap_or_default(),
                    field(removed["label"].as_str().unwrap_or_default())
                )])
            }
            _ => Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("link has no {action} action yet"),
            )),
        }
    }

    async fn canvas_view(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "view needs an action: list, new, rename, icon, move, delete, open or diagram",
            ));
        };
        match action {
            "list" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view list takes no arguments",
                    ));
                }
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let place = self
                    .inner
                    .projects
                    .locate(&authority.identity.node_id)
                    .await;
                let self_view = place
                    .as_ref()
                    .and_then(|place| place["canvasId"].as_str())
                    .unwrap_or(&authority.identity.node_id);
                let mut lines = content["views"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|view| {
                        let id = view["id"].as_str().unwrap_or_default();
                        let created_by = view["createdBy"].as_str();
                        let current = id == self_view;
                        let may = !current && created_by == Some(&authority.identity.node_id);
                        let why = if current {
                            "you are in it".to_owned()
                        } else if may {
                            "yours".to_owned()
                        } else {
                            created_by.map_or_else(
                                || "a person made it".to_owned(),
                                |maker| format!("{maker} made it"),
                            )
                        };
                        format!(
                            "{id}\t{}\t{}\t{}\t{why}",
                            view["kind"].as_str().unwrap_or_default(),
                            field(view["name"].as_str().unwrap_or_default()),
                            if may { "yes" } else { "no" }
                        )
                    })
                    .collect::<Vec<_>>();
                lines.push(format!("self\t{self_view}"));
                Ok(lines)
            }
            "new" => {
                let parsed = Arguments::parse(&argv[1..], &["kind", "path", "url", "after"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view new takes one name and nothing else; a name with spaces in it is one argument",
                    ));
                }
                let name = parsed.positionals[0].trim();
                if name.is_empty() || name.chars().count() > 120 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "A view name is between 1 and 120 characters",
                    ));
                }
                let kind = parsed
                    .flags
                    .get("kind")
                    .map(String::as_str)
                    .unwrap_or("canvas");
                if !matches!(
                    kind,
                    "canvas"
                        | "chat"
                        | "terminal"
                        | "browser"
                        | "drawing"
                        | "diagram"
                        | "file"
                        | "separator"
                ) {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "--kind takes one of canvas, chat, terminal, browser, drawing, diagram, file, separator",
                    ));
                }
                for (flag, accepted) in [("path", kind == "file"), ("url", kind == "browser")] {
                    if parsed.flags.contains_key(flag) && !accepted {
                        return Err(CanvasRefusal::invalid(
                            "flag-not-for-kind",
                            format!("--{flag} does not go with a {kind} view"),
                        ));
                    }
                }
                if kind == "file" && !parsed.flags.contains_key("path") {
                    return Err(CanvasRefusal::invalid(
                        "missing-flag",
                        "A file view needs --path",
                    ));
                }
                if kind == "browser" && !parsed.flags.contains_key("url") {
                    return Err(CanvasRefusal::invalid(
                        "missing-flag",
                        "A browser view needs --url",
                    ));
                }
                let url = parsed.flags.get("url").map(String::as_str);
                if url
                    .is_some_and(|url| !(url.starts_with("http://") || url.starts_with("https://")))
                {
                    return Err(CanvasRefusal::invalid(
                        "bad-url",
                        format!(
                            "{} is not an http or https address; a browser view opens nothing else",
                            url.unwrap()
                        ),
                    ));
                }
                let path = match parsed.flags.get("path") {
                    Some(path) => Some(self.resolve_node_file(&authority.project_id, path).await?),
                    None => None,
                };
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                if content["views"].as_array().map_or(0, Vec::len) >= 100 {
                    return Err(CanvasRefusal::invalid(
                        "too-many-views",
                        "This project has 100 views and a project holds at most 100",
                    ));
                }
                if let Some(after) = parsed.flags.get("after")
                    && !content["views"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|view| view["id"] == *after)
                {
                    return Err(CanvasRefusal::invalid(
                        "unknown-view",
                        format!("{after} is not a view of this project"),
                    ));
                }
                let prefix = if matches!(kind, "chat" | "terminal" | "browser" | "separator") {
                    kind
                } else {
                    "view"
                };
                let id = fresh_id(prefix, &content);
                let (_, ()) = self
                    .mutate_project(&authority.project_id, |content| {
                        add_view(
                            content,
                            &id,
                            kind,
                            name,
                            &authority.identity.node_id,
                            path.as_deref(),
                            url,
                            parsed.flags.get("after").map(String::as_str),
                        )
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!("{id}\t{kind}\t{}", field(name))])
            }
            "icon" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if parsed.positionals.len() != 2 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view icon needs the id of a view and a Lucide name or an emoji",
                    ));
                }
                let id = &parsed.positionals[0];
                let value = &parsed.positionals[1];
                let icon_kind = if value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
                {
                    "lucide"
                } else {
                    "emoji"
                };
                if icon_kind == "emoji" && value.chars().count() > 8 {
                    return Err(CanvasRefusal::invalid(
                        "unknown-icon",
                        "That emoji has more than 8 code points",
                    ));
                }
                let (_, kind) = self
                    .mutate_project(&authority.project_id, |content| {
                        set_view_icon(content, id, icon_kind, value)
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!("{id}\t{kind}\t{icon_kind}\t{}", field(value))])
            }
            "rename" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if parsed.positionals.len() != 2 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view rename needs the id of a view and a name",
                    ));
                }
                let id = &parsed.positionals[0];
                let name = parsed.positionals[1].trim();
                if name.is_empty() || name.chars().count() > 120 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "A view name is between 1 and 120 characters",
                    ));
                }
                let (_, kind) = self
                    .mutate_project(&authority.project_id, |content| {
                        rename_view(content, id, name)
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!("{id}\t{kind}\t{}", field(name))])
            }
            "move" => {
                let parsed = Arguments::parse(&argv[1..], &["after"], &["first"])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view move takes one view id; where it goes is a flag",
                    ));
                }
                let first = parsed.switches.contains("first");
                if first == parsed.flags.contains_key("after") {
                    return Err(CanvasRefusal::invalid(
                        "two-places",
                        "view move takes exactly one of --after and --first",
                    ));
                }
                let id = &parsed.positionals[0];
                let (_, (kind, index)) = self
                    .mutate_project(&authority.project_id, |content| {
                        move_view(
                            content,
                            id,
                            if first {
                                None
                            } else {
                                parsed.flags.get("after").map(String::as_str)
                            },
                        )
                    })
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!("{id}\t{kind}\t{index}")])
            }
            "delete" => {
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "view delete takes one view id and nothing else",
                    ));
                }
                let id = &parsed.positionals[0];
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let view = content["views"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|view| view["id"] == *id)
                    .ok_or_else(|| {
                        CanvasRefusal::invalid(
                            "unknown-view",
                            format!("{id} is not a view of this project"),
                        )
                    })?;
                let place = self
                    .inner
                    .projects
                    .locate(&authority.identity.node_id)
                    .await;
                let current = place
                    .as_ref()
                    .and_then(|place| place["canvasId"].as_str())
                    .unwrap_or(&authority.identity.node_id);
                if id == &authority.identity.node_id || id == current {
                    return Err(CanvasRefusal::invalid(
                        "deletes-caller",
                        format!("You are in {id}, so removing it would end the session asking"),
                    ));
                }
                let maker = view["createdBy"].as_str();
                if maker != Some(&authority.identity.node_id) {
                    return Err(CanvasRefusal {
                        code: "not-yours".to_owned(),
                        message: format!(
                            "{id} was made by {} and view delete only removes a view you made yourself",
                            maker.unwrap_or("a person")
                        ),
                        lines: vec![
                            format!("made by\t{}", maker.unwrap_or("a person")),
                            format!("you\t{}", authority.identity.node_id),
                            "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every view; a person turns it on from the Machines pane".to_owned(),
                        ],
                        status: 422,
                    });
                }
                let (_, lines) = self
                    .mutate_project(&authority.project_id, |content| delete_view(content, id))
                    .await
                    .map_err(rpc_refusal)?;
                Ok(lines)
            }
            "open" => {
                if argv[1..].iter().any(|word| word == "--dry-run") {
                    return Err(CanvasRefusal::invalid(
                        "no-dry-run",
                        "view open takes no --dry-run; it writes nothing",
                    ));
                }
                let parsed = Arguments::parse(&argv[1..], &[], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        if parsed.positionals.is_empty() {
                            "view open needs the id of a view"
                        } else {
                            "view open takes one view id and nothing else"
                        },
                    ));
                }
                let id = &parsed.positionals[0];
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                let view = content["views"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|view| view["id"] == *id)
                    .ok_or_else(|| CanvasRefusal {
                        code: "unknown-view".to_owned(),
                        message: format!("{id} is not a view of this project"),
                        lines: openable_view_rows(&content),
                        status: 422,
                    })?;
                if view["kind"] == "separator" {
                    return Err(CanvasRefusal {
                        code: "never-opens".to_owned(),
                        message: format!(
                            "{id} is a separator, a line in the sidebar with nothing to show"
                        ),
                        lines: openable_view_rows(&content),
                        status: 422,
                    });
                }
                let delivered = self
                    .inner
                    .projects
                    .show_view(&authority.project_id, id, &authority.identity.node_id)
                    .await;
                Ok(vec![
                    format!(
                        "showing\t{id}\t{}\t{}",
                        view["kind"].as_str().unwrap_or_default(),
                        field(view["name"].as_str().unwrap_or(id))
                    ),
                    if delivered {
                        "sent\tyes\tEveryone with this project on screen was told".to_owned()
                    } else {
                        "sent\tno\tNobody has this project on screen right now, so nothing was showing it".to_owned()
                    },
                ])
            }
            "diagram" => {
                let parsed = Arguments::parse(&argv[1..], &["document"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        if parsed.positionals.is_empty() {
                            "view diagram needs the id of a diagram view"
                        } else {
                            "view diagram takes one view id and nothing else; the document goes on stdin"
                        },
                    ));
                }
                let view_id = &parsed.positionals[0];
                let document = parsed
                    .flags
                    .get("document")
                    .filter(|document| !document.trim().is_empty())
                    .ok_or_else(|| {
                        CanvasRefusal::invalid(
                            "no-document",
                            "view diagram reads the document on stdin and got nothing: ruimte-context view diagram <viewId> <<'EOF' ... EOF",
                        )
                    })?;
                let document: Value = serde_json::from_str(document).map_err(|error| {
                    CanvasRefusal::invalid("bad-json", format!("The document is not JSON: {error}"))
                })?;
                validate_agent_diagram(&document)?;
                let content = self
                    .inner
                    .projects
                    .read_project(&authority.project_id)
                    .await
                    .map_err(rpc_refusal)?;
                if !content["views"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|view| view["id"] == *view_id && view["kind"] == "diagram")
                {
                    return Err(CanvasRefusal::invalid(
                        "not-a-diagram",
                        format!("{view_id} is not a diagram view of this project"),
                    ));
                }
                let nodes = document["nodes"].as_array().map_or(0, Vec::len);
                let groups = document["groups"].as_array().map_or(0, Vec::len);
                let edges = document["edges"].as_array().map_or(0, Vec::len);
                let rev = self
                    .inner
                    .views
                    .write_diagram(&authority.project_id, view_id, document)
                    .await
                    .map_err(rpc_refusal)?;
                Ok(vec![format!(
                    "{view_id}\t{rev}\t{nodes}\t{groups}\t{edges}"
                )])
            }
            _ => Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("view has no {action} action yet"),
            )),
        }
    }

    async fn canvas_plan(
        &self,
        authority: &RuntimeAuthority,
        argv: &[String],
    ) -> Result<Vec<String>, CanvasRefusal> {
        if authority.identity.target.kind != RuntimeTargetKind::Chat {
            return Err(CanvasRefusal::invalid(
                "plan-needs-chat",
                "A plan belongs to a chat, and you are a terminal: only a chat has a record to keep a plan beside",
            ));
        }
        let Some(action) = argv.first().map(String::as_str) else {
            return Err(CanvasRefusal::invalid(
                "bad-arguments",
                "plan needs an action: new, read, set, note, add, edit, move, remove, status or delete",
            ));
        };
        let chat_id = &authority.identity.node_id;
        let store = self.inner.workflow.plans();
        match action {
            "new" => {
                let parsed = Arguments::parse(
                    &argv[1..],
                    &["document", "markdown", "title", "kind", "checks"],
                    &["dry-run"],
                )?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan new takes no arguments; the plan goes on stdin",
                    ));
                }
                if parsed.flags.contains_key("document") && parsed.flags.contains_key("markdown") {
                    return Err(CanvasRefusal::invalid(
                        "two-documents",
                        "plan new takes the JSON document or --markdown, not both",
                    ));
                }
                let source = parsed
                    .flags
                    .get("markdown")
                    .or_else(|| parsed.flags.get("document"))
                    .map(String::as_str)
                    .unwrap_or("");
                if source.trim().is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "no-document",
                        "plan new reads the plan on stdin and got nothing: pass the JSON document in --document",
                    ));
                }
                let draft: Value = if parsed.flags.contains_key("markdown") {
                    parse_plan_markdown(source)
                        .map_err(|error| CanvasRefusal::invalid(error.code, error.message))?
                } else {
                    serde_json::from_str(source).map_err(|error| {
                        CanvasRefusal::invalid(
                            "bad-json",
                            format!("The document is not JSON: {error}"),
                        )
                    })?
                };
                let mut meta = serde_json::Map::new();
                for key in ["title", "kind", "checks"] {
                    if let Some(value) = parsed.flags.get(key) {
                        meta.insert(key.to_owned(), json!(value));
                    }
                }
                let created = store
                    .create(
                        chat_id,
                        &draft,
                        (!meta.is_empty()).then_some(&Value::Object(meta)),
                        parsed.switches.contains("dry-run"),
                    )
                    .await
                    .map_err(rpc_refusal)?;
                let plan = &created["plan"];
                let mut lines = vec![format!(
                    "{}\t{}\trev {}\t{}\t{}",
                    if parsed.switches.contains("dry-run") {
                        "dry run"
                    } else {
                        "plan"
                    },
                    plan["id"].as_str().unwrap_or_default(),
                    plan["rev"].as_u64().unwrap_or(0),
                    plan["meta"]["kind"].as_str().unwrap_or_default(),
                    field(plan["meta"]["title"].as_str().unwrap_or_default())
                )];
                plan_item_lines(&plan["items"], "-", &mut lines);
                let first = first_leaf_step(&plan["items"]);
                lines.push(first.map_or_else(
                    || {
                        "example\truimte-context plan add --type step --title \"The first step\""
                            .to_owned()
                    },
                    |id| format!("example\truimte-context plan set {id} --state done"),
                ));
                lines.push("ids\tIds are for your commands. When you talk to the person, name the plan and its steps by their title, never by id".to_owned());
                if parsed.switches.contains("dry-run") {
                    lines.push("note\tNothing was written; run it again without --dry-run to make the plan".to_owned());
                }
                Ok(lines)
            }
            "read" => {
                let parsed = Arguments::parse(&argv[1..], &["plan"], &["all"])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan read takes no arguments; --plan names a plan",
                    ));
                }
                let plans = store.read(chat_id).await.map_err(rpc_refusal)?;
                if plans.is_empty() {
                    return Ok(vec![
                        "note\tThis chat has no plan; ruimte-context plan new makes one".to_owned(),
                    ]);
                }
                if parsed.switches.contains("all") {
                    let mut lines = Vec::new();
                    for (index, plan) in plans.iter().enumerate() {
                        if index > 0 {
                            lines.push(String::new());
                        }
                        lines.extend(render_plan_text(plan).lines().map(ToOwned::to_owned));
                    }
                    return Ok(lines);
                }
                let selected = parsed.flags.get("plan").map_or_else(
                    || plans.last(),
                    |id| plans.iter().find(|plan| plan["id"] == *id),
                );
                let Some(plan) = selected else {
                    let id = &parsed.flags["plan"];
                    return Err(CanvasRefusal {
                        code: "plan-not-found".to_owned(),
                        message: format!("This chat has no plan {id}"),
                        lines: plans.iter().map(plan_row).collect(),
                        status: 422,
                    });
                };
                Ok(render_plan_text(plan)
                    .lines()
                    .map(ToOwned::to_owned)
                    .collect())
            }
            "set" => {
                let parsed = Arguments::parse(&argv[1..], &["state", "note", "next", "plan"], &[])?;
                if parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan set needs the id of at least one step",
                    ));
                }
                let state = required_flag(&parsed, "state", "plan set needs --state")?;
                if !matches!(
                    state,
                    "open"
                        | "active"
                        | "done"
                        | "failed"
                        | "skipped"
                        | "blocked"
                        | "warning"
                        | "info"
                ) {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "--state takes one of open, active, done, failed, skipped, blocked, warning, info",
                    ));
                }
                let mut op = json!({ "op": "set", "ids": parsed.positionals, "state": state });
                copy_unescaped_flag(&mut op, &parsed, "note", "note");
                copy_flag(&mut op, &parsed, "next", "next");
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "note" => {
                let parsed = Arguments::parse(&argv[1..], &["text", "plan"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan note needs the id of a step",
                    ));
                }
                let text = required_flag(
                    &parsed,
                    "text",
                    "plan note needs --text with the note, or an empty one to clear it",
                )?;
                let op = json!({ "op": "note", "id": parsed.positionals[0], "text": unescape_text(text) });
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "add" => {
                let parsed = Arguments::parse(
                    &argv[1..],
                    &[
                        "type",
                        "title",
                        "description",
                        "under",
                        "after",
                        "checks",
                        "id",
                        "plan",
                    ],
                    &[],
                )?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan add takes no arguments, only flags",
                    ));
                }
                let kind = required_flag(&parsed, "type", "--type takes step, text or section")?;
                if !matches!(kind, "step" | "text" | "section") {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "--type takes step, text or section",
                    ));
                }
                let title = required_flag(&parsed, "title", "plan add needs --title")?;
                let mut op = json!({ "op": "add", "type": kind, "title": title });
                copy_unescaped_flag(&mut op, &parsed, "description", "description");
                for key in ["under", "after", "checks", "id"] {
                    copy_flag(&mut op, &parsed, key, key);
                }
                let requested_id = parsed.flags.get("id").cloned();
                let applied = store
                    .apply(
                        chat_id,
                        parsed.flags.get("plan").map(String::as_str),
                        &[op],
                        "agent",
                    )
                    .await
                    .map_err(rpc_refusal)?;
                let mut lines = changed_plan_lines(&applied);
                let id = requested_id
                    .or_else(|| {
                        applied["minted"]
                            .as_array()
                            .and_then(|ids| ids.first())
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_default();
                lines.push(format!("added\t{id}\t{kind}"));
                Ok(lines)
            }
            "edit" => {
                let parsed =
                    Arguments::parse(&argv[1..], &["title", "description", "checks", "plan"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan edit needs the id of an item",
                    ));
                }
                if !["title", "description", "checks"]
                    .iter()
                    .any(|key| parsed.flags.contains_key(*key))
                {
                    return Err(CanvasRefusal::invalid(
                        "nothing-to-edit",
                        "plan edit needs at least one of --title, --description and --checks",
                    ));
                }
                let mut op = json!({ "op": "edit", "id": parsed.positionals[0] });
                copy_flag(&mut op, &parsed, "title", "title");
                copy_unescaped_flag(&mut op, &parsed, "description", "description");
                copy_flag(&mut op, &parsed, "checks", "checks");
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "move" => {
                let parsed = Arguments::parse(&argv[1..], &["under", "after", "plan"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan move needs the id of an item",
                    ));
                }
                let mut op = json!({ "op": "move", "id": parsed.positionals[0] });
                copy_flag(&mut op, &parsed, "under", "under");
                copy_flag(&mut op, &parsed, "after", "after");
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "remove" => {
                let parsed = Arguments::parse(&argv[1..], &["plan"], &[])?;
                if parsed.positionals.len() != 1 {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan remove needs the id of an item",
                    ));
                }
                let op = json!({ "op": "remove", "id": parsed.positionals[0] });
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "status" => {
                let parsed = Arguments::parse(&argv[1..], &["text", "plan"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan status takes no arguments; the line goes in --text",
                    ));
                }
                let text = required_flag(
                    &parsed,
                    "text",
                    "plan status needs --text with the line, or an empty one to clear it",
                )?;
                let op = json!({ "op": "meta", "status": unescape_text(text) });
                self.apply_plan_canvas(chat_id, parsed.flags.get("plan"), vec![op])
                    .await
            }
            "delete" => {
                let parsed = Arguments::parse(&argv[1..], &["plan"], &[])?;
                if !parsed.positionals.is_empty() {
                    return Err(CanvasRefusal::invalid(
                        "bad-arguments",
                        "plan delete takes no arguments; --plan names the plan",
                    ));
                }
                let id = required_flag(
                    &parsed,
                    "plan",
                    "plan delete needs --plan with the id of the plan",
                )?;
                let deleted = store.delete(chat_id, id).await.map_err(rpc_refusal)?;
                Ok(vec![format!(
                    "deleted\t{id}\t{}",
                    field(
                        deleted["plan"]["meta"]["title"]
                            .as_str()
                            .unwrap_or_default()
                    )
                )])
            }
            _ => Err(CanvasRefusal::invalid(
                "unknown-action",
                format!("{action} is not an action of plan"),
            )),
        }
    }

    async fn apply_plan_canvas(
        &self,
        chat_id: &str,
        plan_id: Option<&String>,
        ops: Vec<Value>,
    ) -> Result<Vec<String>, CanvasRefusal> {
        let applied = self
            .inner
            .workflow
            .plans()
            .apply(chat_id, plan_id.map(String::as_str), &ops, "agent")
            .await
            .map_err(rpc_refusal)?;
        Ok(changed_plan_lines(&applied))
    }

    async fn canvas_id(
        &self,
        authority: &RuntimeAuthority,
        requested: Option<&str>,
    ) -> Result<String, CanvasRefusal> {
        if let Some(requested) = requested {
            let content = self
                .inner
                .projects
                .read_project(&authority.project_id)
                .await
                .map_err(rpc_refusal)?;
            canvas_by_id(&content, requested)?;
            return Ok(requested.to_owned());
        }
        self.inner
            .projects
            .locate(&authority.identity.node_id)
            .await
            .filter(|place| place["projectId"] == authority.project_id)
            .and_then(|place| place["canvasId"].as_str().map(ToOwned::to_owned))
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "not-on-a-canvas",
                    "You are a view of your own, not a node on a canvas; name one with --view",
                )
            })
    }

    async fn read_canvas_file(
        &self,
        project_id: &str,
        requested: &str,
        flag: &str,
        bad_code: &str,
        outside_code: &str,
    ) -> Result<String, CanvasRefusal> {
        let path = self
            .resolve_canvas_path(project_id, requested, flag, bad_code, outside_code, false)
            .await?;
        tokio::fs::read_to_string(&path).await.map_err(|error| {
            CanvasRefusal::invalid(
                bad_code,
                format!("{} could not be read as text: {error}", path.display()),
            )
        })
    }

    async fn resolve_node_file(
        &self,
        project_id: &str,
        requested: &str,
    ) -> Result<String, CanvasRefusal> {
        let folder = self
            .inner
            .projects
            .folder_of(project_id)
            .await
            .map_err(rpc_refusal)?;
        let path = if Path::new(requested).is_absolute() {
            PathBuf::from(requested)
        } else {
            folder
                .ok_or_else(|| {
                    CanvasRefusal::invalid(
                        "bad-path",
                        "This project has no folder, so --path has to be absolute",
                    )
                })?
                .join(requested)
        };
        if !tokio::fs::metadata(&path)
            .await
            .is_ok_and(|metadata| metadata.is_file())
        {
            return Err(CanvasRefusal::invalid(
                "bad-path",
                format!(
                    "{} is not a file; --path is resolved against the project folder unless it is absolute",
                    path.display()
                ),
            ));
        }
        Ok(path.to_string_lossy().into_owned())
    }

    async fn resolve_canvas_path(
        &self,
        project_id: &str,
        requested: &str,
        flag: &str,
        bad_code: &str,
        outside_code: &str,
        directory: bool,
    ) -> Result<PathBuf, CanvasRefusal> {
        let folder = self
            .inner
            .projects
            .folder_of(project_id)
            .await
            .map_err(rpc_refusal)?
            .ok_or_else(|| {
                CanvasRefusal::invalid(
                    "no-folder",
                    format!("This project has no folder, so {flag} has nothing to be inside of"),
                )
            })?;
        let resolved = if Path::new(requested).is_absolute() {
            PathBuf::from(requested)
        } else {
            folder.join(requested)
        };
        let real = resolved.canonicalize().map_err(|_| {
            CanvasRefusal::invalid(
                bad_code,
                format!(
                    "{} is not there; {flag} is resolved against the project folder unless it is absolute",
                    resolved.display()
                ),
            )
        })?;
        let mut roots = self
            .inner
            .git
            .fork_worktree_paths(&folder)
            .await
            .unwrap_or_else(|_| vec![folder.clone()]);
        if !roots.iter().any(|root| root == &folder) {
            roots.push(folder.clone());
        }
        let inside = roots.iter().any(|root| {
            root.canonicalize()
                .is_ok_and(|root| real == root || real.starts_with(root))
        });
        if !inside {
            return Err(CanvasRefusal {
                code: outside_code.to_owned(),
                message: format!(
                    "{} is outside {} and the worktrees of its repository",
                    resolved.display(),
                    folder.display()
                ),
                lines: std::iter::once(format!("folder\t{}", folder.display()))
                    .chain(
                        roots
                            .iter()
                            .filter(|root| *root != &folder)
                            .map(|root| format!("worktree\t{}", root.display())),
                    )
                    .collect(),
                status: 422,
            });
        }
        let metadata = tokio::fs::metadata(&real).await.map_err(|error| {
            CanvasRefusal::invalid(
                bad_code,
                format!("{} is unavailable: {error}", resolved.display()),
            )
        })?;
        if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
            return Err(CanvasRefusal::invalid(
                bad_code,
                format!(
                    "{} is not a {}; {flag} is resolved against the project folder unless it is absolute",
                    resolved.display(),
                    if directory { "folder" } else { "file" }
                ),
            ));
        }
        Ok(resolved)
    }
}

#[derive(Debug)]
struct Arguments {
    positionals: Vec<String>,
    flags: HashMap<String, String>,
    switches: HashSet<String>,
}

impl Arguments {
    fn parse(
        argv: &[String],
        flag_names: &[&str],
        switch_names: &[&str],
    ) -> Result<Self, CanvasRefusal> {
        let flags = flag_names.iter().copied().collect::<HashSet<_>>();
        let switches = switch_names.iter().copied().collect::<HashSet<_>>();
        let mut result = Self {
            positionals: Vec::new(),
            flags: HashMap::new(),
            switches: HashSet::new(),
        };
        let mut index = 0;
        while index < argv.len() {
            let word = &argv[index];
            let Some(name) = word.strip_prefix("--") else {
                result.positionals.push(word.clone());
                index += 1;
                continue;
            };
            if switches.contains(name) {
                result.switches.insert(name.to_owned());
                index += 1;
                continue;
            }
            if !flags.contains(name) {
                return Err(CanvasRefusal::invalid(
                    "unknown-flag",
                    format!("Unknown flag --{name}"),
                ));
            }
            let Some(value) = argv.get(index + 1) else {
                return Err(CanvasRefusal::invalid(
                    "bad-arguments",
                    format!("--{name} needs a value"),
                ));
            };
            result.flags.insert(name.to_owned(), value.clone());
            index += 2;
        }
        Ok(result)
    }
}

fn help(argv: &[String]) -> Result<Vec<String>, CanvasRefusal> {
    let oracle: Value = serde_json::from_str(include_str!("fixtures/canvas-help-oracle.json"))
        .expect("canvas help oracle is valid JSON");
    let words = Value::Array(argv.iter().cloned().map(Value::String).collect());
    let Some(case) = oracle["cases"]
        .as_array()
        .and_then(|cases| cases.iter().find(|case| case["argv"] == words))
    else {
        return Err(CanvasRefusal::invalid(
            "bad-arguments",
            "help takes a verb or a noun and optional action",
        ));
    };
    let lines = case["lines"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect();
    if case["ok"] == true {
        Ok(lines)
    } else {
        Err(CanvasRefusal {
            code: case["code"].as_str().unwrap_or("bad-arguments").to_owned(),
            message: case["message"].as_str().unwrap_or_default().to_owned(),
            lines,
            status: if case["code"] == "unknown-verb" {
                404
            } else {
                422
            },
        })
    }
}

fn task_line(task: &Value, node_id: &str) -> String {
    let gave = task["parentId"] == node_id;
    let result = task["result"]["text"]
        .as_str()
        .unwrap_or_default()
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect::<String>();
    [
        "task".to_owned(),
        task["id"].as_str().unwrap_or_default().to_owned(),
        if gave { "gave" } else { "given" }.to_owned(),
        task["status"].as_str().unwrap_or_default().to_owned(),
        task[if gave { "childId" } else { "parentId" }]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        field(task["title"].as_str().unwrap_or_default()),
        task["wake"].as_str().unwrap_or_default().to_owned(),
        field(&result),
        task["batchId"].as_str().unwrap_or("-").to_owned(),
    ]
    .join("\t")
}

fn field(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

fn canvas_by_id<'a>(content: &'a Value, id: &str) -> Result<&'a Value, CanvasRefusal> {
    content["views"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|view| view["kind"] == "canvas" && view["id"] == id)
        .ok_or_else(|| {
            CanvasRefusal::invalid(
                "not-a-canvas",
                format!("{id} is not a canvas of this project"),
            )
        })
}

fn rounded(node: &Value, field: &str) -> String {
    (node[field].as_f64().unwrap_or(0.0).round() as i64).to_string()
}

fn containing_group(nodes: &[Value], node: &Value) -> Option<String> {
    let center_x = node["x"].as_f64().unwrap_or(0.0) + node["w"].as_f64().unwrap_or(0.0) / 2.0;
    let center_y = node["y"].as_f64().unwrap_or(0.0) + node["h"].as_f64().unwrap_or(0.0) / 2.0;
    nodes
        .iter()
        .filter(|group| group["kind"] == "group" && group["id"] != node["id"])
        .filter(|group| {
            let x = group["x"].as_f64().unwrap_or(0.0);
            let y = group["y"].as_f64().unwrap_or(0.0);
            center_x >= x
                && center_x <= x + group["w"].as_f64().unwrap_or(0.0)
                && center_y >= y
                && center_y <= y + group["h"].as_f64().unwrap_or(0.0)
        })
        .min_by(|left, right| {
            let left_area = left["w"].as_f64().unwrap_or(0.0) * left["h"].as_f64().unwrap_or(0.0);
            let right_area =
                right["w"].as_f64().unwrap_or(0.0) * right["h"].as_f64().unwrap_or(0.0);
            left_area.total_cmp(&right_area)
        })
        .and_then(|group| group["id"].as_str().map(ToOwned::to_owned))
}

fn comma_ids(value: Option<&String>, flag: &str) -> Result<Vec<String>, CanvasRefusal> {
    let Some(value) = value else {
        return Err(CanvasRefusal::invalid(
            "bad-arguments",
            format!("{flag} needs one or more node ids, separated by commas"),
        ));
    };
    let mut seen = HashSet::new();
    let ids = value
        .split(',')
        .map(str::trim)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if ids.iter().any(String::is_empty) {
        return Err(CanvasRefusal::invalid(
            "bad-arguments",
            format!("{flag} has an empty id in it; write the ids separated by commas, as a,b,c"),
        ));
    }
    Ok(ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect())
}

fn add_links(
    content: &mut Value,
    canvas_id: &str,
    from: &str,
    targets: &[String],
    label: Option<&str>,
) -> Result<Vec<String>, crate::rpc::RpcError> {
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["kind"] == "canvas" && view["id"] == canvas_id)
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
    let source = nodes
        .iter()
        .find(|node| node["id"] == from)
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-node",
                format!("{from} is not a node on {canvas_id}"),
            )
        })?;
    if targets.iter().any(|id| id == from) {
        return Err(crate::rpc::RpcError::new(
            "self-link",
            format!("{from} is both ends of the line; a node reads itself without one"),
        ));
    }
    let missing = targets
        .iter()
        .filter(|id| {
            !nodes
                .iter()
                .any(|node| node["id"].as_str() == Some(id.as_str()))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(crate::rpc::RpcError::new(
            "unknown-node",
            format!("{} is not a node on {canvas_id}", missing.join(", ")),
        ));
    }
    let source_agent = matches!(source["kind"].as_str(), Some("chat" | "terminal"));
    let edges = canvas["edges"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no edges"))?;
    let mut lines = Vec::new();
    for target_id in targets {
        let target = nodes.iter().find(|node| node["id"] == *target_id).unwrap();
        draw_link(edges, from, target, label, "out", &mut lines);
        if source_agent && matches!(target["kind"].as_str(), Some("chat" | "terminal")) {
            draw_link(edges, target_id, source, label, "back", &mut lines);
        }
    }
    Ok(lines)
}

fn delete_link(
    content: &mut Value,
    canvas_id: &str,
    edge_id: &str,
) -> Result<Value, crate::rpc::RpcError> {
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["id"] == canvas_id && view["kind"] == "canvas")
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let edges = canvas["edges"].as_array_mut().unwrap();
    let index = edges
        .iter()
        .position(|edge| edge["id"] == edge_id)
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-edge",
                format!("{edge_id} is not a line on {canvas_id}"),
            )
        })?;
    Ok(edges.remove(index))
}

fn draw_link(
    edges: &mut Vec<Value>,
    from: &str,
    target: &Value,
    label: Option<&str>,
    way: &str,
    lines: &mut Vec<String>,
) {
    let to = target["id"].as_str().unwrap_or_default();
    if let Some(edge) = edges
        .iter()
        .find(|edge| edge["from"] == from && edge["to"] == to)
    {
        lines.push(format!(
            "{}\t{from}\t{to}\texisting\t{way}",
            edge["id"].as_str().unwrap_or_default()
        ));
        return;
    }
    let id = fresh_edge_id(edges);
    let edge_label = label.or_else(|| {
        matches!(target["kind"].as_str(), Some("chat" | "terminal")).then_some("context")
    });
    let mut edge = json!({ "id": id, "from": from, "to": to });
    if let Some(edge_label) = edge_label {
        edge["label"] = json!(edge_label);
    }
    edges.push(edge);
    lines.push(format!("{id}\t{from}\t{to}\tnew\t{way}"));
}

fn fresh_edge_id(edges: &[Value]) -> String {
    loop {
        let mut bytes = [0_u8; 8];
        rand::thread_rng().fill_bytes(&mut bytes);
        let suffix = bytes
            .iter()
            .map(|byte| char::from_digit((byte % 36) as u32, 36).unwrap())
            .collect::<String>();
        let id = format!("edge-{suffix}");
        if !edges.iter().any(|edge| edge["id"] == id) {
            return id;
        }
    }
}

fn unescape_text(value: &str) -> String {
    let mut result = String::new();
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            result.push(character);
            continue;
        }
        match chars.next() {
            Some('n') => result.push('\n'),
            Some('t') => result.push('\t'),
            Some('\\') => result.push('\\'),
            Some(other) => {
                result.push('\\');
                result.push(other);
            }
            None => result.push('\\'),
        }
    }
    result
}

fn rpc_refusal(error: crate::rpc::RpcError) -> CanvasRefusal {
    CanvasRefusal::invalid(&error.code, error.message)
}

fn workflow_refusal(error: super::workflow::WorkflowRefusal) -> CanvasRefusal {
    CanvasRefusal {
        code: error.code.to_owned(),
        message: error.message,
        lines: error.lines,
        status: 422,
    }
}

#[allow(clippy::too_many_arguments)]
fn add_team_nodes(
    content: &mut Value,
    canvas_id: &str,
    caller_id: &str,
    group_id: &str,
    label: &str,
    members: &[TeamMember],
    runtime_mode: Option<RuntimeMode>,
) -> Result<Vec<String>, crate::rpc::RpcError> {
    if std::iter::once(group_id)
        .chain(members.iter().flat_map(|member| {
            std::iter::once(member.id.as_str()).chain(member.edge_id.as_deref())
        }))
        .any(|id| project_has_id(content, id))
    {
        return Err(crate::rpc::RpcError::new(
            "id-taken",
            "An id was taken while the team was placed",
        ));
    }
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["id"] == canvas_id && view["kind"] == "canvas")
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let existing = canvas["nodes"].as_array().cloned().unwrap_or_default();
    if existing.len() + members.len() + 1 > 500 {
        return Err(crate::rpc::RpcError::new(
            "canvas-full",
            "The canvas cannot hold the whole team",
        ));
    }
    let widest = members
        .iter()
        .map(|member| if member.chat { 480.0_f64 } else { 560.0 })
        .fold(0.0, f64::max);
    let columns = members.len().min(4);
    let mut frame = json!({
        "id": group_id,
        "kind": "group",
        "title": label,
        "x": 0.0,
        "y": 0.0,
        "w": 64.0 + widest * columns as f64 + 40.0 * columns.saturating_sub(1) as f64,
        "h": 104.0
    });
    let mut relative_nodes = Vec::new();
    for member in members {
        let size = if member.chat {
            (480.0, 520.0)
        } else {
            (560.0, 360.0)
        };
        let placement = place_in_group(&frame, &relative_nodes, size);
        frame["w"] = json!(placement.grown_w);
        frame["h"] = json!(placement.grown_h);
        relative_nodes.push(json!({
            "id": member.id,
            "x": placement.x,
            "y": placement.y,
            "w": size.0,
            "h": size.1
        }));
    }
    let caller = existing
        .iter()
        .find(|node| node["id"] == caller_id)
        .cloned();
    let (origin_x, origin_y) = free_position(
        &existing,
        caller.as_ref(),
        node_number(&frame, "w"),
        node_number(&frame, "h"),
    );
    frame["x"] = json!(origin_x);
    frame["y"] = json!(origin_y);
    let mut added = vec![frame];
    let mut edges = Vec::new();
    let mut lines = vec![format!(
        "{group_id}\tgroup\t{}\t{canvas_id}\t-\t-",
        field(label)
    )];
    for (index, member) in members.iter().enumerate() {
        let relative = &relative_nodes[index];
        let mut node = json!({
            "id": member.id,
            "kind": if member.chat { "chat" } else { "terminal" },
            "title": member.role.title.trim(),
            "titleSource": "user",
            "x": origin_x as f64 + node_number(relative, "x"),
            "y": origin_y as f64 + node_number(relative, "y"),
            "w": node_number(relative, "w"),
            "h": node_number(relative, "h"),
            "provider": member.role.provider
        });
        if member.chat {
            node["providerFixed"] = json!(true);
        } else if let Some(mode) = runtime_mode {
            node["runtimeMode"] = json!(mode_name(mode));
        }
        if let Some(cwd) = &member.cwd {
            node["cwd"] = json!(cwd);
        }
        if let Some(edge_id) = &member.edge_id {
            edges.push(json!({
                "id": edge_id,
                "from": caller_id,
                "to": member.id,
                "label": "context"
            }));
        }
        lines.push(format!(
            "{}\t{}\t{}\t{canvas_id}\t{}\t{}",
            member.id,
            if member.chat { "chat" } else { "terminal" },
            field(member.role.title.trim()),
            member.role.provider,
            member.edge_id.as_deref().unwrap_or("-")
        ));
        added.push(node);
    }
    canvas["nodes"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no nodes"))?
        .extend(added);
    canvas["edges"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no edges"))?
        .extend(edges);
    Ok(lines)
}

#[allow(clippy::too_many_arguments)]
fn add_agent_node(
    content: &mut Value,
    canvas_id: &str,
    caller_id: &str,
    beside: Option<&str>,
    group_id: Option<&str>,
    node_id: &str,
    edge_id: &str,
    provider: &str,
    chat: bool,
    title: &str,
    cwd: Option<&str>,
    runtime_mode: Option<RuntimeMode>,
) -> Result<String, crate::rpc::RpcError> {
    if project_has_id(content, node_id) {
        return Err(crate::rpc::RpcError::new(
            "id-taken",
            format!("The id {node_id} was taken while the agent was placed"),
        ));
    }
    let views = content["views"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The project has no views"))?;
    let canvas = views
        .iter_mut()
        .find(|view| view["kind"] == "canvas" && view["id"] == canvas_id)
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "not-on-a-canvas",
                format!("{canvas_id} is not a canvas of this project"),
            )
        })?;
    let nodes = canvas["nodes"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no nodes"))?;
    if nodes.len() >= 500 {
        return Err(crate::rpc::RpcError::new(
            "canvas-full",
            "The canvas already holds the 500 nodes a canvas may hold",
        ));
    }
    let anchor = beside.and_then(|id| nodes.iter().find(|node| node["id"] == id).cloned());
    if beside.is_some() && anchor.is_none() {
        return Err(crate::rpc::RpcError::new(
            "node-not-found",
            format!("No node {} on {canvas_id}", beside.unwrap()),
        ));
    }
    let group_index = group_id.map(|id| {
        nodes
            .iter()
            .position(|node| node["id"] == id && node["kind"] == "group")
            .ok_or_else(|| {
                crate::rpc::RpcError::new(
                    "unknown-group",
                    format!("{id} is not a group on {canvas_id}"),
                )
            })
    });
    let group_index = group_index.transpose()?;
    let size = if chat { (480.0, 520.0) } else { (560.0, 360.0) };
    let caller = nodes.iter().find(|node| node["id"] == caller_id).cloned();
    let placement = group_index.map(|index| place_in_group(&nodes[index], nodes, size));
    let (x, y) = placement.map_or_else(
        || free_position(nodes, anchor.as_ref().or(caller.as_ref()), size.0, size.1),
        |placement| (placement.x as i64, placement.y as i64),
    );
    let mut node = json!({
        "id": node_id,
        "kind": if chat { "chat" } else { "terminal" },
        "title": title,
        "titleSource": "user",
        "x": x,
        "y": y,
        "w": size.0,
        "h": size.1,
        "provider": provider
    });
    if chat {
        node.as_object_mut()
            .unwrap()
            .insert("providerFixed".to_owned(), json!(true));
    } else if let Some(mode) = runtime_mode {
        node.as_object_mut()
            .unwrap()
            .insert("runtimeMode".to_owned(), json!(mode_name(mode)));
    }
    if let Some(cwd) = cwd {
        node.as_object_mut()
            .unwrap()
            .insert("cwd".to_owned(), json!(cwd));
    }
    if let Some(index) = group_index {
        let group = &mut nodes[index];
        let placement = placement.unwrap();
        group["w"] = json!(placement.grown_w);
        if group["collapsed"] == true {
            group["expandedHeight"] = json!(placement.grown_h);
            let member_ids = group
                .as_object_mut()
                .unwrap()
                .entry("memberIds")
                .or_insert_with(|| json!([]));
            member_ids
                .as_array_mut()
                .ok_or_else(|| {
                    crate::rpc::RpcError::new("project-invalid", "A group has invalid members")
                })?
                .push(json!(node_id));
        } else {
            group["h"] = json!(placement.grown_h);
        }
    }
    nodes.push(node);
    if caller.is_some() {
        canvas["edges"]
            .as_array_mut()
            .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no edges"))?
            .push(json!({ "id": edge_id, "from": caller_id, "to": node_id, "label": "context" }));
    }
    Ok(canvas_id.to_owned())
}

#[allow(clippy::too_many_arguments)]
fn add_plain_node(
    content: &mut Value,
    canvas_id: &str,
    caller_id: &str,
    beside: Option<&str>,
    node_id: &str,
    kind: &str,
    title: Option<&str>,
    text: Option<String>,
    url: Option<&str>,
    path: Option<&str>,
    source: Option<&str>,
    cwd: Option<&str>,
) -> Result<(), crate::rpc::RpcError> {
    if let Some(url) = url
        && !(url.starts_with("http://") || url.starts_with("https://"))
    {
        return Err(crate::rpc::RpcError::new(
            "bad-url",
            format!("{url} is not an http or https address; a browser node opens nothing else"),
        ));
    }
    if let Some(source) = source {
        let expected = kind;
        if !content["views"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|view| view["id"] == source && view["kind"] == expected)
        {
            return Err(crate::rpc::RpcError::new(
                format!("not-a-{expected}"),
                format!("{source} is not a {expected} view of this project"),
            ));
        }
    }
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["kind"] == "canvas" && view["id"] == canvas_id)
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let nodes = canvas["nodes"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The canvas has no nodes"))?;
    if nodes.len() >= 500 {
        return Err(crate::rpc::RpcError::new(
            "canvas-full",
            "The canvas already holds the 500 nodes a canvas may hold",
        ));
    }
    let anchor_id = beside.unwrap_or(caller_id);
    let anchor = nodes.iter().find(|node| node["id"] == anchor_id).cloned();
    if beside.is_some() && anchor.is_none() {
        return Err(crate::rpc::RpcError::new(
            "unknown-node",
            format!("{anchor_id} is not a node on {canvas_id}"),
        ));
    }
    let (width, height) = match kind {
        "terminal" => (560.0, 360.0),
        "chat" => (480.0, 520.0),
        "browser" => (720.0, 480.0),
        "note" => (320.0, 240.0),
        "file" => (520.0, 420.0),
        "drawing" | "diagram" => (480.0, 360.0),
        _ => (320.0, 240.0),
    };
    let (x, y) = free_position(nodes, anchor.as_ref(), width, height);
    let default_title = match kind {
        "terminal" => "Terminal",
        "chat" => "New chat",
        "browser" => "Browser",
        "note" => "Note",
        "file" => path
            .and_then(|path| Path::new(path).file_name())
            .and_then(|name| name.to_str())
            .unwrap_or("File"),
        "drawing" => "Drawing",
        "diagram" => "Diagram",
        _ => kind,
    };
    let mut node = json!({
        "id": node_id,
        "kind": kind,
        "title": title.unwrap_or(default_title),
        "x": x,
        "y": y,
        "w": width,
        "h": height
    });
    if title.is_some() {
        node["titleSource"] = json!("user");
    }
    for (key, value) in [
        ("body", text),
        ("url", url.map(ToOwned::to_owned)),
        ("path", path.map(ToOwned::to_owned)),
        ("viewId", source.map(ToOwned::to_owned)),
        ("cwd", cwd.map(ToOwned::to_owned)),
    ] {
        if let Some(value) = value {
            node[key] = json!(value);
        }
    }
    nodes.push(node);
    Ok(())
}

fn rename_node(
    content: &mut Value,
    canvas_id: &str,
    node_id: &str,
    title: &str,
) -> Result<String, crate::rpc::RpcError> {
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["id"] == canvas_id && view["kind"] == "canvas")
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let node = canvas["nodes"]
        .as_array_mut()
        .and_then(|nodes| nodes.iter_mut().find(|node| node["id"] == node_id))
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-node",
                format!("{node_id} is not a node on {canvas_id}"),
            )
        })?;
    let kind = node["kind"].as_str().unwrap_or_default().to_owned();
    node["title"] = json!(title);
    node["titleSource"] = json!("user");
    Ok(kind)
}

fn set_view_icon(
    content: &mut Value,
    view_id: &str,
    kind: &str,
    value: &str,
) -> Result<String, crate::rpc::RpcError> {
    let view = content["views"]
        .as_array_mut()
        .and_then(|views| views.iter_mut().find(|view| view["id"] == view_id))
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-view",
                format!("{view_id} is not a view of this project"),
            )
        })?;
    if view["kind"] == "separator" {
        return Err(crate::rpc::RpcError::new(
            "not-markable",
            format!("{view_id} is a separator, a line in the sidebar with no room for a mark"),
        ));
    }
    let view_kind = view["kind"].as_str().unwrap_or_default().to_owned();
    view["icon"] = json!({ "kind": kind, "value": value });
    Ok(view_kind)
}

#[allow(clippy::too_many_arguments)]
fn add_view(
    content: &mut Value,
    view_id: &str,
    kind: &str,
    name: &str,
    created_by: &str,
    path: Option<&str>,
    url: Option<&str>,
    after: Option<&str>,
) -> Result<(), crate::rpc::RpcError> {
    if project_has_id(content, view_id) {
        return Err(crate::rpc::RpcError::new(
            "id-taken",
            format!("The id {view_id} was taken while the view was placed"),
        ));
    }
    let views = content["views"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The project has no views"))?;
    if views.len() >= 100 {
        return Err(crate::rpc::RpcError::new(
            "too-many-views",
            format!(
                "This project has {} views and a project holds at most 100",
                views.len()
            ),
        ));
    }
    let mut view = match kind {
        "canvas" => json!({
            "kind": "canvas",
            "id": view_id,
            "name": name,
            "nodes": [],
            "texts": [],
            "edges": [],
            "layouts": []
        }),
        "chat" | "terminal" => json!({
            "kind": kind,
            "id": view_id,
            "name": name,
            "node": {}
        }),
        "browser" => json!({
            "kind": "browser",
            "id": view_id,
            "name": name,
            "url": url.unwrap_or_default()
        }),
        "file" => json!({
            "kind": "file",
            "id": view_id,
            "name": name,
            "path": path.unwrap_or_default()
        }),
        "separator" => json!({ "kind": "separator", "id": view_id, "name": name }),
        "drawing" | "diagram" => json!({ "kind": kind, "id": view_id, "name": name }),
        _ => {
            return Err(crate::rpc::RpcError::new(
                "bad-request",
                format!("Unknown view kind {kind}"),
            ));
        }
    };
    view.as_object_mut()
        .unwrap()
        .insert("createdBy".to_owned(), json!(created_by));
    let index = if let Some(after) = after {
        views
            .iter()
            .position(|view| view["id"] == after)
            .map(|index| index + 1)
            .ok_or_else(|| {
                crate::rpc::RpcError::new(
                    "unknown-view",
                    format!("{after} is not a view of this project"),
                )
            })?
    } else {
        views.len()
    };
    views.insert(index, view);
    Ok(())
}

fn rename_view(
    content: &mut Value,
    view_id: &str,
    name: &str,
) -> Result<String, crate::rpc::RpcError> {
    let view = content["views"]
        .as_array_mut()
        .and_then(|views| views.iter_mut().find(|view| view["id"] == view_id))
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-view",
                format!("{view_id} is not a view of this project"),
            )
        })?;
    let kind = view["kind"].as_str().unwrap_or_default().to_owned();
    view["name"] = json!(name);
    view["titleSource"] = json!("user");
    Ok(kind)
}

fn move_view(
    content: &mut Value,
    view_id: &str,
    after: Option<&str>,
) -> Result<(String, usize), crate::rpc::RpcError> {
    let views = content["views"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The project has no views"))?;
    let index = views
        .iter()
        .position(|view| view["id"] == view_id)
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-view",
                format!("{view_id} is not a view of this project"),
            )
        })?;
    if after == Some(view_id) {
        return Err(crate::rpc::RpcError::new(
            "two-places",
            "view move cannot put a view under itself",
        ));
    }
    if let Some(after) = after
        && !views.iter().any(|view| view["id"] == after)
    {
        return Err(crate::rpc::RpcError::new(
            "unknown-view",
            format!("{after} is not a view of this project"),
        ));
    }
    let view = views.remove(index);
    let kind = view["kind"].as_str().unwrap_or_default().to_owned();
    let to = after.map_or(0, |after| {
        views.iter().position(|view| view["id"] == after).unwrap() + 1
    });
    views.insert(to, view);
    Ok((kind, to))
}

fn delete_node(content: &mut Value, node_id: &str) -> Result<Vec<String>, crate::rpc::RpcError> {
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views.iter_mut().find(|view| {
                view["kind"] == "canvas"
                    && view["nodes"]
                        .as_array()
                        .is_some_and(|nodes| nodes.iter().any(|node| node["id"] == node_id))
            })
        })
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-node",
                format!("{node_id} is not a node on any canvas of this project"),
            )
        })?;
    let nodes = canvas["nodes"].as_array_mut().unwrap();
    let index = nodes.iter().position(|node| node["id"] == node_id).unwrap();
    let member_count =
        (nodes[index]["kind"] == "group").then(|| group_members(&nodes[index], nodes).len());
    let node = nodes.remove(index);
    for candidate in nodes.iter_mut() {
        if let Some(members) = candidate.get_mut("memberIds").and_then(Value::as_array_mut) {
            members.retain(|member| member != node_id);
        }
    }
    let edges = canvas["edges"].as_array_mut().unwrap();
    let before = edges.len();
    edges.retain(|edge| edge["from"] != node_id && edge["to"] != node_id);
    let mut lines = vec![format!(
        "deleted\t{node_id}\t{}\t{}",
        node["kind"].as_str().unwrap_or_default(),
        field(node["title"].as_str().unwrap_or_default())
    )];
    if matches!(node["kind"].as_str(), Some("chat" | "terminal")) {
        lines.push(format!(
            "ended\t{node_id}\t{}",
            node["kind"].as_str().unwrap_or_default()
        ));
    }
    lines.push(format!("edges\t{}", before - edges.len()));
    if let Some(member_count) = member_count {
        lines.push(format!("members\t{member_count}\tleft where they stand"));
    }
    Ok(lines)
}

fn delete_view(content: &mut Value, view_id: &str) -> Result<Vec<String>, crate::rpc::RpcError> {
    let views = content["views"]
        .as_array_mut()
        .ok_or_else(|| crate::rpc::RpcError::new("project-invalid", "The project has no views"))?;
    let index = views
        .iter()
        .position(|view| view["id"] == view_id)
        .ok_or_else(|| {
            crate::rpc::RpcError::new(
                "unknown-view",
                format!("{view_id} is not a view of this project"),
            )
        })?;
    let view = views.remove(index);
    let mut lines = vec![format!(
        "deleted\t{view_id}\t{}\t{}",
        view["kind"].as_str().unwrap_or_default(),
        field(view["name"].as_str().unwrap_or_default())
    )];
    if let Some(nodes) = view.get("nodes").and_then(Value::as_array)
        && !nodes.is_empty()
    {
        lines.push(format!("nodes\t{}", nodes.len()));
        lines.extend(nodes.iter().take(20).map(|node| {
            format!(
                "node\t{}\t{}\t{}",
                node["id"].as_str().unwrap_or_default(),
                node["kind"].as_str().unwrap_or_default(),
                field(node["title"].as_str().unwrap_or_default())
            )
        }));
    }
    Ok(lines)
}

fn node_rows(canvas: &Value) -> Vec<String> {
    canvas["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|node| {
            format!(
                "node\t{}\t{}\t{}",
                node["id"].as_str().unwrap_or_default(),
                node["kind"].as_str().unwrap_or_default(),
                field(node["title"].as_str().unwrap_or_default())
            )
        })
        .collect()
}

fn openable_view_rows(content: &Value) -> Vec<String> {
    let views = content["views"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|view| view["kind"] != "separator")
        .collect::<Vec<_>>();
    let mut lines = if views.is_empty() {
        vec!["note\tThis project has no view that opens".to_owned()]
    } else {
        views
            .into_iter()
            .map(|view| {
                format!(
                    "view\t{}\t{}\t{}",
                    view["id"].as_str().unwrap_or_default(),
                    view["kind"].as_str().unwrap_or_default(),
                    field(view["name"].as_str().unwrap_or_default())
                )
            })
            .collect()
    };
    lines.push("note\tview open takes a view id, never a name".to_owned());
    lines
}

fn named_worktree<'a>(worktrees: &'a [Value], branch: &str) -> Result<&'a Value, CanvasRefusal> {
    worktrees
        .iter()
        .find(|worktree| worktree["branch"] == branch)
        .ok_or_else(|| CanvasRefusal {
            code: "unknown-worktree".to_owned(),
            message: format!("{branch} is not the branch of a worktree of this repository"),
            lines: if worktrees.is_empty() {
                vec!["note\tThis repository has no worktrees".to_owned()]
            } else {
                worktrees
                    .iter()
                    .map(|worktree| {
                        format!(
                            "worktree\t{}",
                            field(worktree["branch"].as_str().unwrap_or_default())
                        )
                    })
                    .collect()
            },
            status: 422,
        })
}

fn nodes_in_worktree(content: &Value, worktree: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    if let Some(node_id) = worktree["nodeId"].as_str() {
        seen.insert(node_id.to_owned());
        ids.push(node_id.to_owned());
    }
    if worktree["missing"] != true
        && let Some(path) = worktree["path"].as_str()
    {
        let path = Path::new(path);
        for node in content["views"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|view| view["nodes"].as_array().into_iter().flatten())
        {
            if matches!(node["kind"].as_str(), Some("chat" | "terminal"))
                && node["cwd"]
                    .as_str()
                    .is_some_and(|cwd| Path::new(cwd).starts_with(path))
                && let Some(id) = node["id"].as_str()
            {
                if seen.insert(id.to_owned()) {
                    ids.push(id.to_owned());
                }
            }
        }
    }
    ids
}

fn validate_group(canvas: &Value, ids: &[String]) -> Result<(), CanvasRefusal> {
    let nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
    let missing = ids
        .iter()
        .filter(|id| {
            !nodes
                .iter()
                .any(|node| node["id"].as_str() == Some(id.as_str()))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        let message = if missing.len() == 1 {
            format!(
                "{} is not a node on {}",
                missing[0],
                canvas["id"].as_str().unwrap_or_default()
            )
        } else {
            format!(
                "{} are not a node on {}",
                missing.join(", "),
                canvas["id"].as_str().unwrap_or_default()
            )
        };
        return Err(CanvasRefusal {
            code: "unknown-node".to_owned(),
            message,
            lines: groupable_node_rows(canvas),
            status: 422,
        });
    }
    let members = ids
        .iter()
        .filter_map(|id| nodes.iter().find(|node| node["id"] == **id))
        .collect::<Vec<_>>();
    if let Some(group) = members.iter().find(|node| node["kind"] == "group") {
        let id = group["id"].as_str().unwrap_or_default();
        return Err(CanvasRefusal::invalid(
            "not-groupable",
            format!(
                "{id} is a group, and a frame is drawn around nodes; move it inside the frame instead and it goes in with them"
            ),
        ));
    }
    let containers = containers_of(&nodes);
    let first = &ids[0];
    let container = containers.get(first).cloned();
    if let Some(elsewhere) = ids
        .iter()
        .skip(1)
        .find(|id| containers.get(*id).cloned() != container)
    {
        return Err(CanvasRefusal::invalid(
            "different-groups",
            format!(
                "{first} stands {} and {elsewhere} stands {}; a frame goes around nodes that are already in the same place",
                place_name(container.as_deref()),
                place_name(containers.get(elsewhere).map(String::as_str))
            ),
        ));
    }
    if nodes.len() >= 500 {
        return Err(CanvasRefusal::invalid(
            "canvas-full",
            format!(
                "{} holds {} nodes and this would add 1 more; a canvas holds at most 500",
                canvas["name"]
                    .as_str()
                    .unwrap_or_else(|| canvas["id"].as_str().unwrap_or_default()),
                nodes.len()
            ),
        ));
    }
    Ok(())
}

fn group_nodes(
    content: &mut Value,
    canvas_id: &str,
    ids: &[String],
    group_id: &str,
    label: &str,
    accent: Option<&str>,
) -> Result<Vec<String>, crate::rpc::RpcError> {
    if project_has_id(content, group_id) {
        return Err(crate::rpc::RpcError::new(
            "id-taken",
            format!("The id {group_id} was taken while the group was placed"),
        ));
    }
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["id"] == canvas_id && view["kind"] == "canvas")
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let mut nodes = canvas["nodes"].as_array().cloned().unwrap_or_default();
    if nodes.len() >= 500 {
        return Err(crate::rpc::RpcError::new(
            "canvas-full",
            "The canvas already holds the 500 nodes a canvas may hold",
        ));
    }
    let members = ids
        .iter()
        .map(|id| {
            nodes
                .iter()
                .find(|node| node["id"] == *id)
                .cloned()
                .ok_or_else(|| {
                    crate::rpc::RpcError::new(
                        "unknown-node",
                        format!("{id} is not a node on {canvas_id}"),
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(group) = members.iter().find(|node| node["kind"] == "group") {
        return Err(crate::rpc::RpcError::new(
            "not-groupable",
            format!(
                "{} is a group, and a frame is drawn around nodes",
                group["id"].as_str().unwrap_or_default()
            ),
        ));
    }
    let containers = containers_of(&nodes);
    let container = containers.get(&ids[0]).cloned();
    if ids
        .iter()
        .any(|id| containers.get(id).cloned() != container)
    {
        return Err(crate::rpc::RpcError::new(
            "different-groups",
            "The nodes no longer stand in the same place",
        ));
    }
    let left = members
        .iter()
        .map(|node| node_number(node, "x"))
        .fold(f64::INFINITY, f64::min);
    let top = members
        .iter()
        .map(|node| node_number(node, "y"))
        .fold(f64::INFINITY, f64::min);
    let right = members
        .iter()
        .map(|node| node_number(node, "x") + node_number(node, "w"))
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = members
        .iter()
        .map(|node| node_number(node, "y") + node_number(node, "h"))
        .fold(f64::NEG_INFINITY, f64::max);
    let mut group = json!({
        "id": group_id,
        "kind": "group",
        "title": label,
        "x": snap_to_grid(left - 32.0),
        "y": snap_to_grid(top - 72.0),
        "w": snap_to_grid(right - left + 64.0),
        "h": snap_to_grid(bottom - top + 104.0)
    });
    if let Some(accent) = accent {
        group["accent"] = json!(accent);
    }
    let inside = group_members(&group, &nodes)
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    if let Some(container) = container
        && let Some(parent) = nodes.iter_mut().find(|node| node["id"] == container)
        && parent["collapsed"] == true
    {
        let member_ids = parent
            .as_object_mut()
            .unwrap()
            .entry("memberIds")
            .or_insert_with(|| json!([]));
        member_ids
            .as_array_mut()
            .ok_or_else(|| {
                crate::rpc::RpcError::new("project-invalid", "A group has invalid members")
            })?
            .push(json!(group_id));
    }
    nodes.push(group);
    canvas["nodes"] = json!(nodes);
    let named = ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut lines = vec![format!(
        "{group_id}\tgroup\t{}\t{canvas_id}\t{}",
        field(label),
        inside.len()
    )];
    lines.extend(
        inside
            .iter()
            .filter(|node| !named.contains(node["id"].as_str().unwrap_or_default()))
            .map(|node| {
                format!(
                    "also\t{}\t{}\t{}",
                    node["id"].as_str().unwrap_or_default(),
                    node["kind"].as_str().unwrap_or_default(),
                    field(node["title"].as_str().unwrap_or_default())
                )
            }),
    );
    Ok(lines)
}

fn groupable_node_rows(canvas: &Value) -> Vec<String> {
    let nodes = canvas["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|node| node["kind"] != "group")
        .collect::<Vec<_>>();
    if nodes.len() > 20 {
        return vec![format!(
            "detail\truimte-context node list\tthe {} nodes of {}",
            canvas["nodes"].as_array().map_or(0, Vec::len),
            canvas["id"].as_str().unwrap_or_default()
        )];
    }
    if nodes.is_empty() {
        return vec![
            "note\tThis canvas holds nothing but frames, and a frame is never one of --nodes"
                .to_owned(),
        ];
    }
    nodes
        .into_iter()
        .map(|node| {
            format!(
                "node\t{}\t{}\t{}",
                node["id"].as_str().unwrap_or_default(),
                node["kind"].as_str().unwrap_or_default(),
                field(node["title"].as_str().unwrap_or_default())
            )
        })
        .collect()
}

fn group_rows(canvas: &Value) -> Vec<String> {
    let groups = canvas["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|node| node["kind"] == "group")
        .collect::<Vec<_>>();
    if groups.is_empty() {
        return vec![format!(
            "note\t{} has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas",
            canvas["id"].as_str().unwrap_or_default()
        )];
    }
    groups
        .into_iter()
        .map(|node| {
            format!(
                "group\t{}\t{}",
                node["id"].as_str().unwrap_or_default(),
                field(node["title"].as_str().unwrap_or_default())
            )
        })
        .collect()
}

fn containers_of(nodes: &[Value]) -> HashMap<String, String> {
    let mut containers = HashMap::<String, (String, f64)>::new();
    for group in nodes.iter().filter(|node| node["kind"] == "group") {
        let id = group["id"].as_str().unwrap_or_default();
        let area = node_number(group, "w") * group_height(group);
        for member in group_members(group, nodes) {
            let member_id = member["id"].as_str().unwrap_or_default().to_owned();
            if containers
                .get(&member_id)
                .is_none_or(|(_, current_area)| area < *current_area)
            {
                containers.insert(member_id, (id.to_owned(), area));
            }
        }
    }
    containers
        .into_iter()
        .map(|(member, (group, _))| (member, group))
        .collect()
}

fn group_members<'a>(group: &Value, nodes: &'a [Value]) -> Vec<&'a Value> {
    if group["collapsed"] == true {
        let ids = group["memberIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>();
        return nodes
            .iter()
            .filter(|node| node["id"].as_str().is_some_and(|id| ids.contains(id)))
            .collect();
    }
    let x = node_number(group, "x");
    let y = node_number(group, "y");
    let right = x + node_number(group, "w");
    let bottom = y + group_height(group);
    nodes
        .iter()
        .filter(|node| node["id"] != group["id"])
        .filter(|node| {
            let center_x = node_number(node, "x") + node_number(node, "w") / 2.0;
            let center_y = node_number(node, "y") + node_number(node, "h") / 2.0;
            center_x >= x && center_x <= right && center_y >= y && center_y <= bottom
        })
        .collect()
}

fn group_height(group: &Value) -> f64 {
    if group["collapsed"] == true {
        group["expandedHeight"]
            .as_f64()
            .unwrap_or_else(|| node_number(group, "h"))
    } else {
        node_number(group, "h")
    }
}

fn node_number(node: &Value, key: &str) -> f64 {
    node[key].as_f64().unwrap_or(0.0)
}

fn snap_to_grid(value: f64) -> f64 {
    ((value / 8.0) + 0.5).floor() * 8.0
}

fn place_name(container: Option<&str>) -> String {
    container.map_or_else(
        || "on the canvas itself".to_owned(),
        |id| format!("in group {id}"),
    )
}

#[derive(Clone, Copy)]
struct GroupPlacement {
    x: f64,
    y: f64,
    grown_w: f64,
    grown_h: f64,
}

fn place_in_group(group: &Value, nodes: &[Value], size: (f64, f64)) -> GroupPlacement {
    let group_x = node_number(group, "x");
    let group_y = node_number(group, "y");
    let group_w = node_number(group, "w");
    let group_h = group_height(group);
    let left = js_round(group_x + 32.0);
    let right = group_x + group_w - 32.0;
    let mut x = left;
    let mut y = js_round(group_y + 72.0);
    let members = group_members(group, nodes);
    loop {
        let blocking = members
            .iter()
            .filter(|member| rectangles_overlap(x, y, size.0, size.1, member))
            .collect::<Vec<_>>();
        if blocking.is_empty() {
            break;
        }
        let beside = js_round(
            blocking
                .iter()
                .map(|member| node_number(member, "x") + node_number(member, "w"))
                .fold(f64::NEG_INFINITY, f64::max)
                + 40.0,
        );
        if beside + size.0 <= right {
            x = beside;
        } else {
            x = left;
            y = js_round(
                blocking
                    .iter()
                    .map(|member| node_number(member, "y") + node_number(member, "h"))
                    .fold(f64::NEG_INFINITY, f64::max)
                    + 40.0,
            );
        }
    }
    GroupPlacement {
        x,
        y,
        grown_w: group_w.max(x + size.0 + 32.0 - group_x),
        grown_h: group_h.max(y + size.1 + 32.0 - group_y),
    }
}

fn rectangles_overlap(x: f64, y: f64, w: f64, h: f64, other: &Value) -> bool {
    x < node_number(other, "x") + node_number(other, "w") + 40.0
        && node_number(other, "x") < x + w + 40.0
        && y < node_number(other, "y") + node_number(other, "h") + 40.0
        && node_number(other, "y") < y + h + 40.0
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn arrange_nodes(
    content: &mut Value,
    canvas_id: &str,
    ids: &[String],
    layout: &str,
    cols: Option<usize>,
) -> Result<Vec<String>, crate::rpc::RpcError> {
    let canvas = content["views"]
        .as_array_mut()
        .and_then(|views| {
            views
                .iter_mut()
                .find(|view| view["id"] == canvas_id && view["kind"] == "canvas")
        })
        .ok_or_else(|| crate::rpc::RpcError::new("not-a-canvas", "The canvas does not exist"))?;
    let nodes = canvas["nodes"].as_array_mut().unwrap();
    let mut moving = Vec::new();
    for id in ids {
        let node = nodes
            .iter()
            .find(|node| node["id"].as_str() == Some(id.as_str()))
            .cloned()
            .ok_or_else(|| {
                crate::rpc::RpcError::new(
                    "unknown-node",
                    format!("{id} is not a node on {canvas_id}"),
                )
            })?;
        if node["kind"] == "group" {
            return Err(crate::rpc::RpcError::new(
                "not-arrangeable",
                format!("{id} is a group and carries whatever stands inside it"),
            ));
        }
        moving.push(node);
    }
    let columns = match layout {
        "row" => moving.len().max(1),
        "column" => 1,
        _ => cols
            .unwrap_or_else(|| (moving.len() as f64).sqrt().ceil() as usize)
            .max(1),
    };
    if columns > moving.len().max(1) {
        return Err(crate::rpc::RpcError::new(
            "too-many-columns",
            format!("--cols is {columns} and you named {} nodes", moving.len()),
        ));
    }
    let left = moving
        .iter()
        .map(|node| node["x"].as_f64().unwrap_or(0.0))
        .fold(f64::INFINITY, f64::min);
    let top = moving
        .iter()
        .map(|node| node["y"].as_f64().unwrap_or(0.0))
        .fold(f64::INFINITY, f64::min);
    let rows = moving.len().div_ceil(columns);
    let column_widths = (0..columns)
        .map(|column| {
            moving
                .iter()
                .skip(column)
                .step_by(columns)
                .map(|node| node["w"].as_f64().unwrap_or(0.0))
                .fold(0.0, f64::max)
        })
        .collect::<Vec<_>>();
    let row_heights = (0..rows)
        .map(|row| {
            moving
                .iter()
                .skip(row * columns)
                .take(columns)
                .map(|node| node["h"].as_f64().unwrap_or(0.0))
                .fold(0.0, f64::max)
        })
        .collect::<Vec<_>>();
    let mut lines = Vec::new();
    for (index, moving_node) in moving.iter().enumerate() {
        let column = index % columns;
        let row = index / columns;
        let x = left + column_widths[..column].iter().sum::<f64>() + 40.0 * column as f64;
        let y = top + row_heights[..row].iter().sum::<f64>() + 40.0 * row as f64;
        let node = nodes
            .iter_mut()
            .find(|node| node["id"] == moving_node["id"])
            .unwrap();
        node["x"] = json!(x);
        node["y"] = json!(y);
        lines.push(format!(
            "{}\t{}\t{}",
            node["id"].as_str().unwrap_or_default(),
            x.round() as i64,
            y.round() as i64
        ));
    }
    Ok(lines)
}

fn required_flag<'a>(
    parsed: &'a Arguments,
    name: &str,
    message: &str,
) -> Result<&'a str, CanvasRefusal> {
    parsed
        .flags
        .get(name)
        .map(String::as_str)
        .ok_or_else(|| CanvasRefusal::invalid("bad-arguments", message))
}

fn copy_flag(op: &mut Value, parsed: &Arguments, flag: &str, key: &str) {
    if let Some(value) = parsed.flags.get(flag) {
        op.as_object_mut()
            .unwrap()
            .insert(key.to_owned(), json!(value));
    }
}

fn copy_unescaped_flag(op: &mut Value, parsed: &Arguments, flag: &str, key: &str) {
    if let Some(value) = parsed.flags.get(flag) {
        op.as_object_mut()
            .unwrap()
            .insert(key.to_owned(), json!(unescape_text(value)));
    }
}

fn plan_row(plan: &Value) -> String {
    let progress = plan_progress(&plan["items"]);
    format!(
        "plan\t{}\t{}\t{}\t{}",
        plan["id"].as_str().unwrap_or_default(),
        plan["meta"]["kind"].as_str().unwrap_or_default(),
        field(plan["meta"]["title"].as_str().unwrap_or_default()),
        field(&progress_text(plan, &progress))
    )
}

fn changed_plan_lines(applied: &Value) -> Vec<String> {
    let plan = &applied["plan"];
    let progress = plan_progress(&plan["items"]);
    let mut active = Vec::new();
    collect_active_steps(&plan["items"], &mut active);
    let mut lines = vec![format!(
        "plan\t{}\trev {}\t{}\t{}\t{}",
        plan["id"].as_str().unwrap_or_default(),
        plan["rev"].as_u64().unwrap_or(0),
        plan["meta"]["kind"].as_str().unwrap_or_default(),
        field(plan["meta"]["title"].as_str().unwrap_or_default()),
        field(&progress_text(plan, &progress))
    )];
    if !active.is_empty() {
        lines.push(format!("now\t{}", active.join("\t")));
    }
    lines.extend(
        applied["dropped"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|id| {
                format!(
                    "dropped\t{id}\tgot its first sub-step, so its own state is gone and follows from its sub-steps"
                )
            }),
    );
    lines
}

fn collect_active_steps(items: &Value, active: &mut Vec<String>) {
    for item in items.as_array().into_iter().flatten() {
        if item["type"] == "step" {
            if let Some(children) = item.get("steps") {
                collect_active_steps(children, active);
            } else if item["state"] == "active"
                && let Some(id) = item["id"].as_str()
            {
                active.push(id.to_owned());
            }
        } else if item["type"] == "section" {
            collect_active_steps(&item["items"], active);
        }
    }
}

fn plan_item_lines(items: &Value, under: &str, lines: &mut Vec<String>) {
    for item in items.as_array().into_iter().flatten() {
        lines.push(format!(
            "item\t{}\t{}\t{under}\t{}",
            item["id"].as_str().unwrap_or_default(),
            item["type"].as_str().unwrap_or_default(),
            field(item["title"].as_str().unwrap_or_default())
        ));
        if item["type"] == "section" {
            plan_item_lines(
                &item["items"],
                item["id"].as_str().unwrap_or_default(),
                lines,
            );
        } else if item["type"] == "step"
            && let Some(children) = item.get("steps")
        {
            plan_item_lines(children, item["id"].as_str().unwrap_or_default(), lines);
        }
    }
}

fn first_leaf_step(items: &Value) -> Option<&str> {
    for item in items.as_array().into_iter().flatten() {
        if item["type"] == "section" {
            if let Some(id) = first_leaf_step(&item["items"]) {
                return Some(id);
            }
        } else if item["type"] == "step" {
            if let Some(children) = item.get("steps") {
                if let Some(id) = first_leaf_step(children) {
                    return Some(id);
                }
            } else {
                return item["id"].as_str();
            }
        }
    }
    None
}

fn team_roles_refusal(code: &str, message: impl Into<String>) -> CanvasRefusal {
    let mut refusal = CanvasRefusal::invalid(code, message);
    refusal.lines = vec![
        "roles\tshape\t[{\"title\": \"Lexer\", \"prompt\": \"Fix the tokenizer\", \"provider\": \"claude\"}]".to_owned(),
        "roles\ttitle\trequired\tThe title of the node, at most 120 characters; the session never renames over it".to_owned(),
        "roles\tprompt\trequired\tWhat that agent starts working on, at most 2000 characters".to_owned(),
        "roles\tprovider\trequired\tclaude, codex, gemini, copilot".to_owned(),
        "roles\tterminal\toptional\ttrue opens a terminal node instead of a chat node; a CLI without a chat backend is a terminal anyway (only claude, codex have one)".to_owned(),
        "roles\tcount\tbetween 1 and 16".to_owned(),
    ];
    refusal
}

fn diagram_document_refusal(path: &str, text: impl Into<String>) -> CanvasRefusal {
    let text = text.into();
    CanvasRefusal {
        code: "bad-document".to_owned(),
        message: format!("{path} {text}"),
        lines: vec![
            format!("problem\t{path}\t{text}"),
            "detail\truimte-context help view diagram".to_owned(),
        ],
        status: 422,
    }
}

fn strict_object<'a>(
    value: &'a Value,
    path: &str,
    allowed: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, CanvasRefusal> {
    let object = value.as_object().ok_or_else(|| {
        diagram_document_refusal(
            path,
            if path == "document" {
                "needs to be one JSON object with meta, nodes, groups and edges"
            } else {
                "needs an object"
            },
        )
    })?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        let whose = if path.starts_with("edges[") {
            object
                .get("from")
                .and_then(Value::as_str)
                .zip(object.get("to").and_then(Value::as_str))
                .map(|(from, to)| format!(" (the edge from \"{from}\" to \"{to}\")"))
                .unwrap_or_default()
        } else {
            object
                .get("id")
                .and_then(Value::as_str)
                .map(|id| {
                    format!(
                        " ({} \"{id}\")",
                        if path.starts_with("groups[") {
                            "group"
                        } else {
                            "node"
                        }
                    )
                })
                .unwrap_or_default()
        };
        return Err(diagram_document_refusal(
            path,
            format!("has no field {key}{whose}"),
        ));
    }
    Ok(object)
}

fn required_string<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
    path: &str,
    nonempty: bool,
) -> Result<&'a str, CanvasRefusal> {
    let value = object
        .get(key)
        .ok_or_else(|| diagram_document_refusal(path, "is missing and needs a string"))?;
    let value = value
        .as_str()
        .ok_or_else(|| diagram_document_refusal(path, "needs a string"))?;
    if nonempty && value.is_empty() {
        return Err(diagram_document_refusal(path, "may not be empty"));
    }
    Ok(value)
}

fn optional_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<(), CanvasRefusal> {
    if object.get(key).is_some_and(|value| !value.is_string()) {
        return Err(diagram_document_refusal(path, "needs a string"));
    }
    Ok(())
}

fn diagram_enum(
    object: &serde_json::Map<String, Value>,
    key: &str,
    path: &str,
    allowed: &[&str],
    required: bool,
) -> Result<(), CanvasRefusal> {
    let Some(value) = object.get(key) else {
        return if required {
            Err(diagram_document_refusal(
                path,
                "is missing and needs a string",
            ))
        } else {
            Ok(())
        };
    };
    let value = value
        .as_str()
        .ok_or_else(|| diagram_document_refusal(path, "needs a string"))?;
    if !allowed.contains(&value) {
        return Err(diagram_document_refusal(
            path,
            format!("takes one of {}", allowed.join(", ")),
        ));
    }
    Ok(())
}

fn validate_agent_diagram(value: &Value) -> Result<(), CanvasRefusal> {
    let document = strict_object(
        value,
        "document",
        &["version", "rev", "meta", "nodes", "groups", "edges"],
    )?;
    let meta_value = document
        .get("meta")
        .ok_or_else(|| diagram_document_refusal("meta", "is missing and needs an object"))?;
    let meta = strict_object(meta_value, "meta", &["title", "direction"])?;
    required_string(meta, "title", "meta.title", false)?;
    diagram_enum(
        meta,
        "direction",
        "meta.direction",
        &["right", "down"],
        true,
    )?;

    let nodes = document
        .get("nodes")
        .ok_or_else(|| diagram_document_refusal("nodes", "is missing and needs an array"))?
        .as_array()
        .ok_or_else(|| diagram_document_refusal("nodes", "needs an array"))?;
    for (index, value) in nodes.iter().enumerate() {
        let path = format!("nodes[{index}]");
        let node = strict_object(
            value,
            &path,
            &["id", "label", "sub", "shape", "tone", "pos"],
        )?;
        required_string(node, "id", &format!("{path}.id"), true)?;
        required_string(node, "label", &format!("{path}.label"), false)?;
        optional_string(node, "sub", &format!("{path}.sub"))?;
        diagram_enum(
            node,
            "shape",
            &format!("{path}.shape"),
            &["rect", "round", "pill", "diamond", "cylinder"],
            false,
        )?;
        diagram_enum(
            node,
            "tone",
            &format!("{path}.tone"),
            &[
                "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple",
                "pink",
            ],
            false,
        )?;
        if let Some(pos) = node.get("pos") {
            let valid = pos
                .as_array()
                .is_some_and(|pos| pos.len() == 2 && pos.iter().all(Value::is_number));
            if !valid {
                return Err(diagram_document_refusal(
                    &format!("{path}.pos"),
                    "needs two numbers, [x, y]",
                ));
            }
        }
    }

    let groups = document
        .get("groups")
        .ok_or_else(|| diagram_document_refusal("groups", "is missing and needs an array"))?
        .as_array()
        .ok_or_else(|| diagram_document_refusal("groups", "needs an array"))?;
    for (index, value) in groups.iter().enumerate() {
        let path = format!("groups[{index}]");
        let group = strict_object(value, &path, &["id", "label", "wraps", "tone"])?;
        required_string(group, "id", &format!("{path}.id"), true)?;
        required_string(group, "label", &format!("{path}.label"), false)?;
        let wraps = group
            .get("wraps")
            .ok_or_else(|| {
                diagram_document_refusal(&format!("{path}.wraps"), "is missing and needs an array")
            })?
            .as_array()
            .ok_or_else(|| diagram_document_refusal(&format!("{path}.wraps"), "needs an array"))?;
        if wraps
            .iter()
            .any(|wrapped| wrapped.as_str().is_none_or(str::is_empty))
        {
            return Err(diagram_document_refusal(
                &format!("{path}.wraps"),
                "needs nonempty strings",
            ));
        }
        diagram_enum(
            group,
            "tone",
            &format!("{path}.tone"),
            &[
                "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple",
                "pink",
            ],
            false,
        )?;
    }

    let edges = document
        .get("edges")
        .ok_or_else(|| diagram_document_refusal("edges", "is missing and needs an array"))?
        .as_array()
        .ok_or_else(|| diagram_document_refusal("edges", "needs an array"))?;
    for (index, value) in edges.iter().enumerate() {
        let path = format!("edges[{index}]");
        let edge = strict_object(value, &path, &["from", "to", "label", "style", "tone"])?;
        required_string(edge, "from", &format!("{path}.from"), true)?;
        required_string(edge, "to", &format!("{path}.to"), true)?;
        optional_string(edge, "label", &format!("{path}.label"))?;
        diagram_enum(
            edge,
            "style",
            &format!("{path}.style"),
            &["solid", "dashed", "dotted"],
            false,
        )?;
        diagram_enum(
            edge,
            "tone",
            &format!("{path}.tone"),
            &[
                "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple",
                "pink",
            ],
            false,
        )?;
    }
    Ok(())
}

fn parse_team_roles(raw: &str) -> Result<Vec<TeamRole>, CanvasRefusal> {
    let value = serde_json::from_str::<Value>(raw).map_err(|error| {
        team_roles_refusal("bad-roles-json", format!("--roles is not JSON: {error}"))
    })?;
    let roles = value
        .as_array()
        .ok_or_else(|| team_roles_refusal("bad-roles", "--roles is a JSON array of roles"))?;
    if roles.is_empty() {
        return Err(team_roles_refusal(
            "bad-roles",
            "--roles has no roles in it; a team is between 1 and 16 of them",
        ));
    }
    if roles.len() > 16 {
        return Err(team_roles_refusal(
            "bad-roles",
            format!(
                "--roles has {} roles and a team takes at most 16",
                roles.len()
            ),
        ));
    }
    roles
        .iter()
        .enumerate()
        .map(|(index, role)| {
            let object = role.as_object().ok_or_else(|| {
                team_roles_refusal(
                    "bad-roles",
                    format!("role {index}: a role is a JSON object"),
                )
            })?;
            if let Some(key) = object
                .keys()
                .find(|key| !matches!(key.as_str(), "title" | "prompt" | "provider" | "terminal"))
            {
                return Err(team_roles_refusal(
                    "bad-roles",
                    format!("role {index}: Unrecognized key: \"{key}\""),
                ));
            }
            let title = object
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
                .ok_or_else(|| {
                    team_roles_refusal(
                        "bad-roles",
                        format!("role {index} (title): title needs a name for the node"),
                    )
                })?;
            if title.chars().count() > 120 {
                return Err(team_roles_refusal(
                    "bad-roles",
                    format!(
                        "role {index} (title): title is {} characters and at most 120 fit in a name on the canvas",
                        title.chars().count()
                    ),
                ));
            }
            let prompt = object
                .get("prompt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|prompt| !prompt.is_empty())
                .ok_or_else(|| {
                    team_roles_refusal(
                        "bad-roles",
                        format!(
                            "role {index} (prompt): prompt says what this agent starts working on"
                        ),
                    )
                })?;
            if prompt.chars().count() > 2_000 {
                return Err(team_roles_refusal(
                    "bad-roles",
                    format!(
                        "role {index} (prompt): prompt is {} characters and at most 2000 fit on the line a CLI is started with",
                        prompt.chars().count()
                    ),
                ));
            }
            let provider = object
                .get("provider")
                .and_then(Value::as_str)
                .filter(|provider| {
                    matches!(*provider, "claude" | "codex" | "gemini" | "copilot")
                })
                .ok_or_else(|| {
                    team_roles_refusal(
                        "bad-roles",
                        format!(
                            "role {index} (provider): provider needs a CLI: claude, codex, gemini, copilot"
                        ),
                    )
                })?;
            let terminal = match object.get("terminal") {
                None => false,
                Some(value) => value.as_bool().ok_or_else(|| {
                    team_roles_refusal(
                        "bad-roles",
                        format!("role {index} (terminal): terminal is true or false"),
                    )
                })?,
            };
            Ok(TeamRole {
                title: title.to_owned(),
                prompt: prompt.to_owned(),
                provider: provider.to_owned(),
                terminal,
            })
        })
        .collect()
}

fn parse_mode(mode: &str) -> Result<RuntimeMode, CanvasRefusal> {
    match mode {
        "supervised" => Ok(RuntimeMode::Supervised),
        "auto-accept-edits" => Ok(RuntimeMode::AutoAcceptEdits),
        "auto" => Ok(RuntimeMode::Auto),
        "full-access" => Ok(RuntimeMode::FullAccess),
        _ => Err(CanvasRefusal::invalid(
            "bad-mode",
            "--mode takes supervised, auto-accept-edits, auto or full-access",
        )),
    }
}

fn mode_rank(mode: RuntimeMode) -> u8 {
    match mode {
        RuntimeMode::Supervised => 0,
        RuntimeMode::AutoAcceptEdits => 1,
        RuntimeMode::Auto => 2,
        RuntimeMode::FullAccess => 3,
    }
}

fn mode_name(mode: RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Supervised => "supervised",
        RuntimeMode::AutoAcceptEdits => "auto-accept-edits",
        RuntimeMode::Auto => "auto",
        RuntimeMode::FullAccess => "full-access",
    }
}

fn chat_provider(provider: &str) -> bool {
    matches!(provider, "claude" | "codex")
}

fn provider_name(provider: &str) -> &str {
    match provider {
        "claude" => "Claude",
        "codex" => "Codex",
        "gemini" => "Gemini",
        "copilot" => "Copilot",
        _ => provider,
    }
}

fn branch_slug(title: &str) -> String {
    let slug = title
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "agent".to_owned()
    } else {
        slug.chars().take(48).collect()
    }
}

fn fresh_distinct_id(prefix: &str, content: &Value, taken: &mut HashSet<String>) -> String {
    loop {
        let id = fresh_id(prefix, content);
        if taken.insert(id.clone()) {
            return id;
        }
    }
}

fn random_id(prefix: &str) -> String {
    let mut bytes = [0_u8; 6];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!(
        "{prefix}-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn free_branch(base: &str, taken: &mut HashSet<String>) -> String {
    if taken.insert(base.to_owned()) {
        return base.to_owned();
    }
    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if taken.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

async fn provider_available(provider: &str) -> bool {
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new(provider)
            .arg("--version")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status(),
    )
    .await
    .is_ok_and(|result| result.is_ok_and(|status| status.success()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_matches_every_typescript_oracle_case() {
        let oracle: Value =
            serde_json::from_str(include_str!("fixtures/canvas-help-oracle.json")).unwrap();
        for case in oracle["cases"].as_array().unwrap() {
            let argv = case["argv"]
                .as_array()
                .unwrap()
                .iter()
                .map(|word| word.as_str().unwrap().to_owned())
                .collect::<Vec<_>>();
            let actual = help(&argv);
            if case["ok"] == true {
                assert_eq!(
                    actual.unwrap(),
                    serde_json::from_value::<Vec<String>>(case["lines"].clone()).unwrap()
                );
            } else {
                let refusal = actual.unwrap_err();
                assert_eq!(refusal.code, case["code"]);
                assert_eq!(refusal.message, case["message"]);
                assert_eq!(
                    refusal.lines,
                    serde_json::from_value::<Vec<String>>(case["lines"].clone()).unwrap()
                );
            }
        }
    }

    #[test]
    fn argument_parser_keeps_values_and_rejects_unknown_flags() {
        let parsed = Arguments::parse(
            &["--result".to_owned(), "a\\nb".to_owned()],
            &["result"],
            &[],
        )
        .unwrap();
        assert_eq!(unescape_text(&parsed.flags["result"]), "a\nb");
        assert_eq!(
            Arguments::parse(&["--wat".to_owned()], &[], &[])
                .unwrap_err()
                .code,
            "unknown-flag"
        );
    }

    #[test]
    fn deleting_a_node_does_not_add_member_lists_to_other_nodes() {
        let mut content = json!({
            "views": [{
                "kind": "canvas",
                "id": "main",
                "nodes": [
                    { "id": "keep", "kind": "note", "title": "Keep" },
                    { "id": "remove", "kind": "note", "title": "Remove" },
                    { "id": "group", "kind": "group", "title": "Group", "memberIds": ["keep", "remove"] }
                ],
                "edges": []
            }]
        });

        delete_node(&mut content, "remove").unwrap();

        let nodes = content["views"][0]["nodes"].as_array().unwrap();
        assert!(nodes[0].get("memberIds").is_none());
        assert_eq!(nodes[1]["memberIds"], json!(["keep"]));
    }

    #[test]
    fn grouping_matches_canvas_geometry_and_reports_caught_nodes() {
        let mut content = json!({
            "views": [{
                "kind": "canvas",
                "id": "main",
                "name": "Main",
                "nodes": [
                    { "id": "a", "kind": "note", "title": "a", "x": 400, "y": 400, "w": 200, "h": 100 },
                    { "id": "b", "kind": "note", "title": "b", "x": 800, "y": 600, "w": 200, "h": 100 },
                    { "id": "between", "kind": "note", "title": "between", "x": 600, "y": 500, "w": 200, "h": 100 }
                ],
                "edges": []
            }]
        });

        let lines = group_nodes(
            &mut content,
            "main",
            &["a".to_owned(), "b".to_owned()],
            "group-new",
            "Parser work",
            Some("violet"),
        )
        .unwrap();

        assert_eq!(
            lines,
            vec![
                "group-new\tgroup\tParser work\tmain\t3",
                "also\tbetween\tnote\tbetween"
            ]
        );
        let group = &content["views"][0]["nodes"][3];
        assert_eq!(
            group,
            &json!({
                "id": "group-new",
                "kind": "group",
                "title": "Parser work",
                "x": 368.0,
                "y": 328.0,
                "w": 664.0,
                "h": 408.0,
                "accent": "violet"
            })
        );
    }

    #[test]
    fn grouping_inside_a_collapsed_frame_records_the_new_member() {
        let mut content = json!({
            "views": [{
                "kind": "canvas",
                "id": "main",
                "nodes": [
                    { "id": "one", "kind": "note", "title": "one", "x": 400, "y": 400, "w": 200, "h": 100 },
                    { "id": "two", "kind": "note", "title": "two", "x": 700, "y": 400, "w": 200, "h": 100 },
                    { "id": "frame", "kind": "group", "title": "frame", "x": 300, "y": 300, "w": 800, "h": 39, "collapsed": true, "expandedHeight": 800, "memberIds": ["one", "two"] }
                ],
                "edges": []
            }]
        });

        group_nodes(
            &mut content,
            "main",
            &["one".to_owned(), "two".to_owned()],
            "group-new",
            "Group",
            None,
        )
        .unwrap();

        assert_eq!(
            content["views"][0]["nodes"][2]["memberIds"],
            json!(["one", "two", "group-new"])
        );
    }

    #[test]
    fn group_validation_excludes_frames_from_unknown_node_choices() {
        let canvas = json!({
            "kind": "canvas",
            "id": "main",
            "nodes": [
                { "id": "a", "kind": "note", "title": "a" },
                { "id": "frame", "kind": "group", "title": "frame" }
            ]
        });

        let error = validate_group(&canvas, &["a".to_owned(), "ghost".to_owned()]).unwrap_err();
        assert_eq!(error.code, "unknown-node");
        assert_eq!(error.lines, vec!["node\ta\tnote\ta"]);
    }

    #[test]
    fn agent_placement_grows_a_collapsed_group_and_records_membership() {
        let mut content = json!({
            "views": [{
                "kind": "canvas",
                "id": "main",
                "nodes": [
                    { "id": "caller", "kind": "terminal", "title": "caller", "x": 0, "y": 0, "w": 560, "h": 360 },
                    { "id": "frame", "kind": "group", "title": "frame", "x": 600, "y": 0, "w": 700, "h": 40, "collapsed": true, "expandedHeight": 200, "memberIds": [] }
                ],
                "edges": []
            }]
        });

        add_agent_node(
            &mut content,
            "main",
            "caller",
            None,
            Some("frame"),
            "chat-new",
            "edge-new",
            "claude",
            true,
            "Reviewer",
            None,
            None,
        )
        .unwrap();

        let frame = &content["views"][0]["nodes"][1];
        assert_eq!(frame["memberIds"], json!(["chat-new"]));
        assert_eq!(frame["expandedHeight"], json!(624.0));
        assert_eq!(content["views"][0]["nodes"][2]["x"], json!(632));
        assert_eq!(content["views"][0]["nodes"][2]["y"], json!(72));
        assert_eq!(
            content["views"][0]["edges"],
            json!([{ "id": "edge-new", "from": "caller", "to": "chat-new", "label": "context" }])
        );
    }

    #[test]
    fn team_placement_is_atomic_canvas_shape_with_one_way_edges() {
        let mut content = json!({
            "views": [{
                "kind": "canvas",
                "id": "main",
                "nodes": [
                    { "id": "caller", "kind": "chat", "title": "caller", "x": 0, "y": 0, "w": 480, "h": 520 }
                ],
                "edges": []
            }]
        });
        let members = vec![
            TeamMember {
                id: "chat-a".to_owned(),
                edge_id: Some("edge-a".to_owned()),
                role: TeamRole {
                    title: "Lexer".to_owned(),
                    prompt: "Fix lexer".to_owned(),
                    provider: "claude".to_owned(),
                    terminal: false,
                },
                chat: true,
                cwd: Some("/repo".to_owned()),
            },
            TeamMember {
                id: "terminal-b".to_owned(),
                edge_id: Some("edge-b".to_owned()),
                role: TeamRole {
                    title: "Tests".to_owned(),
                    prompt: "Run tests".to_owned(),
                    provider: "gemini".to_owned(),
                    terminal: true,
                },
                chat: false,
                cwd: Some("/repo".to_owned()),
            },
        ];

        let lines = add_team_nodes(
            &mut content,
            "main",
            "caller",
            "group-team",
            "Parser work",
            &members,
            Some(RuntimeMode::Auto),
        )
        .unwrap();

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "group-team\tgroup\tParser work\tmain\t-\t-");
        assert_eq!(content["views"][0]["nodes"].as_array().unwrap().len(), 4);
        assert_eq!(
            content["views"][0]["edges"],
            json!([
                { "id": "edge-a", "from": "caller", "to": "chat-a", "label": "context" },
                { "id": "edge-b", "from": "caller", "to": "terminal-b", "label": "context" }
            ])
        );
        assert_eq!(content["views"][0]["nodes"][3]["runtimeMode"], "auto");
    }
}
