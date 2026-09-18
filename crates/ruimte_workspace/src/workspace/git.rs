#![allow(
    clippy::collapsible_if,
    clippy::manual_unwrap_or_default,
    clippy::missing_const_for_fn,
    clippy::trim_split_whitespace,
    clippy::too_many_arguments,
    clippy::while_let_loop
)]

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::Mutex,
    task::{AbortHandle, JoinHandle},
};
use tokio_util::sync::CancellationToken;

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
};

use super::{
    project::ProjectStore,
    util::{io_error, now_ms, read_optional, string_field, write_atomic},
};

const MESSAGE_PATCH_LIMIT: usize = 24 * 1024;
const MESSAGE_NAMES_LIMIT: usize = 4 * 1024;
const MESSAGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const MESSAGE_OUTPUT_LIMIT: usize = 64 * 1024;
const MESSAGE_EXIT_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

#[derive(Clone)]
struct OneShotProvider {
    kind: &'static str,
    name: &'static str,
    command: String,
    environment: Vec<(String, String)>,
}

pub struct GitService {
    home: PathBuf,
    events: EventBus,
    watchers: Mutex<HashMap<(String, PathBuf), GitWatch>>,
    actions: Mutex<HashMap<String, CancellationToken>>,
    projects: Arc<ProjectStore>,
    register_lock: Mutex<()>,
    worktree_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

struct GitWatch {
    _watcher: RecommendedWatcher,
    cancel: CancellationToken,
}

impl GitService {
    pub fn new(home: PathBuf, events: EventBus, projects: Arc<ProjectStore>) -> Self {
        Self {
            home,
            events,
            watchers: Mutex::new(HashMap::new()),
            actions: Mutex::new(HashMap::new()),
            projects,
            register_lock: Mutex::new(()),
            worktree_locks: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn fork_branches(&self, cwd: &Path) -> Result<Option<Vec<String>>, RpcError> {
        if git_status(cwd, &["rev-parse", "--show-toplevel"]).await?.0 != 0 {
            return Ok(None);
        }
        let branches = git_output(
            cwd,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        )
        .await?
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(ToOwned::to_owned)
        .collect();
        Ok(Some(branches))
    }

    pub(crate) async fn fork_worktree_paths(&self, cwd: &Path) -> Result<Vec<PathBuf>, RpcError> {
        let output = git_output(cwd, &["worktree", "list", "--porcelain"])
            .await
            .map_err(|_| {
                RpcError::new("not-a-repo", "The folder is not inside a git repository")
            })?;
        Ok(parse_worktrees(&output)
            .into_iter()
            .map(|entry| entry.path)
            .collect())
    }

    pub(crate) async fn canvas_worktrees(&self, repo: &Path) -> Result<Vec<Value>, RpcError> {
        let value = self
            .worktree_list(json!({ "repo": repo, "inspect": true }))
            .await?;
        Ok(value["worktrees"].as_array().cloned().unwrap_or_default())
    }

    pub(crate) async fn canvas_worktree_diff(
        &self,
        path: &Path,
        base: Option<&str>,
    ) -> Result<Value, RpcError> {
        diff_checkout(path, base).await
    }

    pub(crate) async fn canvas_worktree_merge(
        &self,
        repo: &Path,
        path: &Path,
        strategy: &str,
        subject: &str,
    ) -> Result<Value, RpcError> {
        self.worktree_merge_inner(
            json!({
                "repo": repo,
                "path": path,
                "strategy": strategy,
                "subject": subject,
                "commitFirst": true,
                "cleanTarget": true,
                "actionId": random_action_id()
            }),
            None,
            &CancellationToken::new(),
        )
        .await
    }

    pub(crate) async fn fork_add_worktree(
        &self,
        cwd: &Path,
        branch: &str,
        project_id: &str,
        node_id: &str,
    ) -> Result<(Value, PathBuf), RpcError> {
        let prefix = git_output(cwd, &["rev-parse", "--show-prefix"])
            .await?
            .trim()
            .to_owned();
        let result = self
            .worktree_add(json!({
                "repo": cwd,
                "branch": branch,
                "projectId": project_id,
                "nodeId": node_id,
                "madeBy": "fork"
            }))
            .await?;
        let worktree = result["worktree"].clone();
        let root = PathBuf::from(
            worktree["path"]
                .as_str()
                .ok_or_else(|| RpcError::new("worktree-failed", "The worktree has no path"))?,
        );
        let fork_cwd = if prefix.is_empty() {
            root
        } else {
            root.join(prefix.trim_end_matches('/'))
        };
        Ok((worktree, fork_cwd))
    }

    pub(crate) async fn fork_remove_worktree(&self, worktree: &Value) -> Result<(), RpcError> {
        let path = string_field(worktree, "path")?;
        self.worktree_remove(json!({
            "repo": path,
            "path": path,
            "force": true
        }))
        .await
        .map(|_| ())
    }

    pub(crate) async fn checkpoint_exists(&self, cwd: &Path, tree: &str) -> Result<bool, RpcError> {
        Ok(
            git_status(cwd, &["cat-file", "-e", &format!("{tree}^{{tree}}")])
                .await?
                .0
                == 0,
        )
    }

    pub(crate) async fn checkpoint_take(&self, cwd: &Path) -> Result<Option<String>, RpcError> {
        let top = match git_output(cwd, &["rev-parse", "--show-toplevel"]).await {
            Ok(top) => PathBuf::from(top.trim()),
            Err(_) => return Ok(None),
        };
        let lock = self.worktree_lock_for(&top).await;
        let _guard = lock.lock().await;
        let checkpoint_dir = self.home.join("checkpoints");
        tokio::fs::create_dir_all(&checkpoint_dir)
            .await
            .map_err(io_error)?;
        #[cfg(unix)]
        tokio::fs::set_permissions(
            &checkpoint_dir,
            <std::fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o700),
        )
        .await
        .map_err(io_error)?;
        let index = checkpoint_index_path(&checkpoint_dir, &top);
        let add = git_status_env(&top, &["add", "-A"], "GIT_INDEX_FILE", &index).await?;
        if add.0 != 0 {
            return Ok(None);
        }
        let tree = git_status_env(&top, &["write-tree"], "GIT_INDEX_FILE", &index).await?;
        if tree.0 != 0 {
            return Ok(None);
        }
        Ok(tree
            .1
            .trim()
            .split_whitespace()
            .next()
            .map(ToOwned::to_owned))
    }

    pub(crate) async fn checkpoint_restore(&self, cwd: &Path, tree: &str) -> Result<(), RpcError> {
        let top = git_output(cwd, &["rev-parse", "--show-toplevel"])
            .await
            .map(|top| PathBuf::from(top.trim()))
            .map_err(|_| {
                RpcError::new(
                    "not-a-repo",
                    format!("{} is not inside a git repository", cwd.display()),
                )
            })?;
        let lock = self.worktree_lock_for(&top).await;
        let _guard = lock.lock().await;
        git_output(&top, &["read-tree", "-u", "--reset", tree]).await?;
        git_output(&top, &["reset", "--quiet"]).await?;
        Ok(())
    }

    pub(crate) async fn checkpoint_diff(
        &self,
        cwd: &Path,
        tree: &str,
    ) -> Result<Option<Value>, RpcError> {
        let top = match git_output(cwd, &["rev-parse", "--show-toplevel"]).await {
            Ok(top) => PathBuf::from(top.trim()),
            Err(_) => return Ok(None),
        };
        if !self.checkpoint_exists(cwd, tree).await? {
            return Ok(None);
        }
        let prefix = match git_output(cwd, &["rev-parse", "--show-prefix"]).await {
            Ok(prefix) => prefix.trim().to_owned(),
            Err(_) => return Ok(None),
        };
        let Some(now) = self.checkpoint_take(cwd).await? else {
            return Ok(None);
        };
        let mut arguments = vec![
            "diff".to_owned(),
            "--numstat".to_owned(),
            "-z".to_owned(),
            "--no-renames".to_owned(),
            tree.to_owned(),
            now.clone(),
        ];
        if !prefix.is_empty() {
            arguments.extend(["--".to_owned(), format!(":(literal){prefix}")]);
        }
        let refs = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let counts = match git_output(&top, &refs).await {
            Ok(output) => parse_checkpoint_numstat(&output),
            Err(_) => return Ok(None),
        };
        let mut status_arguments = arguments;
        status_arguments[1] = "--name-status".to_owned();
        let refs = status_arguments
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        let status = match git_output(&top, &refs).await {
            Ok(output) => checkpoint_kinds(&output),
            Err(_) => return Ok(None),
        };
        let mut budget = 512 * 1024;
        let mut files = Vec::new();
        for (path, added, deleted, binary) in counts.iter().take(100) {
            let mut file = json!({
                "path": path,
                "kind": status.get(path).map(String::as_str).unwrap_or("update"),
                "added": added,
                "deleted": deleted,
                "diff": ""
            });
            if *binary {
                file["omitted"] = json!("binary");
            } else if added + deleted > 2_000 {
                file["omitted"] = json!("too-large");
            } else {
                let patch = git_output(
                    &top,
                    &[
                        "diff",
                        "--no-color",
                        "--no-ext-diff",
                        tree,
                        &now,
                        "--",
                        &format!(":(literal){path}"),
                    ],
                )
                .await
                .ok();
                if let Some(patch) =
                    patch.filter(|patch| patch.len() <= 128 * 1024 && patch.len() <= budget)
                {
                    budget -= patch.len();
                    file["diff"] = json!(patch);
                } else {
                    file["omitted"] = json!("too-large");
                }
            }
            files.push(file);
        }
        Ok(Some(
            json!({ "files": files, "truncated": counts.len() > 100 }),
        ))
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        if !matches!(
            method,
            "git.status"
                | "git.watch"
                | "git.unwatch"
                | "git.diff"
                | "git.stage"
                | "git.discard"
                | "git.refs"
                | "git.log"
                | "git.action"
                | "git.cancel"
                | "git.capabilities"
                | "git.suggestMessage"
                | "git.worktree-add"
                | "git.worktree-list"
                | "git.worktree-remove"
                | "git.worktree-merge"
                | "git.worktree-abort"
        ) {
            return None;
        }
        let result: RpcResult = async {
            match method {
                "git.status" => status(Path::new(&string_field(&payload, "cwd")?)).await,
                "git.watch" => self.watch(payload, context).await,
                "git.unwatch" => self.unwatch(payload, context).await,
                "git.diff" => diff(payload).await,
                "git.stage" => stage(payload).await,
                "git.discard" => discard(payload).await,
                "git.refs" => refs(payload).await,
                "git.log" => log(payload).await,
                "git.action" => self.action(payload, context).await,
                "git.cancel" => self.cancel(payload).await,
                "git.capabilities" => capabilities().await,
                "git.suggestMessage" => self.suggest_message(payload).await,
                "git.worktree-add" => self.worktree_add(payload).await,
                "git.worktree-list" => self.worktree_list(payload).await,
                "git.worktree-remove" => self.worktree_remove(payload).await,
                "git.worktree-merge" => self.worktree_merge(payload, context).await,
                "git.worktree-abort" => worktree_abort(payload).await,
                _ => unreachable!(),
            }
        }
        .await;
        Some(result)
    }

    pub async fn detach(&self, client_id: &str) {
        let mut watchers = self.watchers.lock().await;
        watchers.retain(|(owner, _), watch| {
            if owner == client_id {
                watch.cancel.cancel();
                false
            } else {
                true
            }
        });
    }
    pub async fn shutdown(&self) {
        let mut watchers = self.watchers.lock().await;
        for watch in watchers.values() {
            watch.cancel.cancel();
        }
        watchers.clear();
        for token in self.actions.lock().await.values() {
            token.cancel();
        }
        self.actions.lock().await.clear();
    }

    async fn watch(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let cwd = PathBuf::from(string_field(&payload, "cwd")?);
        let root = git_output(&cwd, &["rev-parse", "--show-toplevel"])
            .await?
            .trim()
            .to_owned();
        let root = PathBuf::from(root);
        let events = self.events.clone();
        let client_id = context.client_id.clone();
        let watched_cwd = cwd.clone();
        let runtime = tokio::runtime::Handle::current();
        let scheduled = Arc::new(AtomicBool::new(false));
        let cancel = CancellationToken::new();
        let callback_cancel = cancel.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if result.is_err() {
                    return;
                }
                if scheduled.swap(true, Ordering::AcqRel) {
                    return;
                }
                let events = events.clone();
                let client_id = client_id.clone();
                let cwd = watched_cwd.clone();
                let scheduled = scheduled.clone();
                let cancel = callback_cancel.clone();
                runtime.spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {}
                        _ = cancel.cancelled() => return,
                    }
                    scheduled.store(false, Ordering::Release);
                    if let Ok(current) = status(&cwd).await {
                        if !cancel.is_cancelled() {
                            events.send(
                                &client_id,
                                "git.status",
                                json!({ "cwd": cwd, "status": current }),
                            );
                        }
                    }
                });
            },
            Config::default(),
        )
        .map_err(|error| RpcError::new("watch-failed", error.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| RpcError::new("watch-failed", error.to_string()))?;
        self.watchers.lock().await.insert(
            (context.client_id.clone(), cwd),
            GitWatch {
                _watcher: watcher,
                cancel,
            },
        );
        Ok(json!({}))
    }

    async fn unwatch(&self, payload: Value, context: &RequestContext) -> RpcResult {
        if let Some(watch) = self.watchers.lock().await.remove(&(
            context.client_id.clone(),
            PathBuf::from(string_field(&payload, "cwd")?),
        )) {
            watch.cancel.cancel();
        }
        Ok(json!({}))
    }

    async fn cancel(&self, payload: Value) -> RpcResult {
        if let Some(token) = self
            .actions
            .lock()
            .await
            .get(&string_field(&payload, "actionId")?)
        {
            token.cancel();
        }
        Ok(json!({}))
    }

    async fn suggest_message(&self, payload: Value) -> RpcResult {
        let action_id = string_field(&payload, "actionId")?;
        let token = CancellationToken::new();
        self.actions
            .lock()
            .await
            .insert(action_id.clone(), token.clone());
        let result = suggest_message_with(
            &payload,
            &token,
            &default_message_providers(),
            MESSAGE_TIMEOUT,
        )
        .await;
        self.actions.lock().await.remove(&action_id);
        result
    }

    async fn action(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let action_id = string_field(&payload, "actionId")?;
        let token = CancellationToken::new();
        self.actions
            .lock()
            .await
            .insert(action_id.clone(), token.clone());
        let result = self.action_inner(payload, context, &token).await;
        self.actions.lock().await.remove(&action_id);
        result
    }

    async fn action_inner(
        &self,
        payload: Value,
        context: &RequestContext,
        token: &CancellationToken,
    ) -> RpcResult {
        let cwd = PathBuf::from(string_field(&payload, "cwd")?);
        let action_id = string_field(&payload, "actionId")?;
        let kind = string_field(&payload, "kind")?;
        let branch = git_output(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .unwrap_or_default()
            .trim()
            .to_owned();
        if matches!(kind.as_str(), "commit" | "commit-push")
            && payload.get("stageAll").and_then(Value::as_bool) == Some(true)
        {
            run_cancelable("git", &["add".into(), "--all".into()], &cwd, token).await?;
        }
        if kind == "checkout" && payload.get("stash").and_then(Value::as_bool) == Some(true) {
            run_cancelable(
                "git",
                &[
                    "stash".into(),
                    "push".into(),
                    "--include-untracked".into(),
                    "--message".into(),
                    format!("ruimte-switch-{}", uuid::Uuid::new_v4()),
                ],
                &cwd,
                token,
            )
            .await?;
        }
        if kind == "sync" {
            let has_upstream = git_status(&cwd, &["rev-parse", "--verify", "@{upstream}"])
                .await?
                .0
                == 0;
            if has_upstream {
                run_cancelable(
                    "git",
                    &["pull".into(), "--ff-only".into(), "--progress".into()],
                    &cwd,
                    token,
                )
                .await?;
            }
        }
        let phase = action_phase(&kind);
        self.events.send(
            &context.client_id,
            "git.progress",
            json!({ "cwd": cwd, "actionId": action_id, "phase": phase, "line": "" }),
        );
        let mut arguments = action_arguments(&payload, &kind)?;
        if kind == "publish" {
            arguments.push(branch.clone());
        }
        let program = if kind == "create-pr" { "gh" } else { "git" };
        let outcome = run_cancelable(program, &arguments, &cwd, token).await;
        let mut output = match outcome {
            Ok(output) => output,
            Err(error) => {
                self.events.send(&context.client_id, "git.progress", json!({ "cwd": cwd, "actionId": action_id, "phase": "failed", "line": error.message }));
                return Err(error);
            }
        };
        if kind == "commit-push" {
            let pushed =
                run_cancelable("git", &["push".into(), "--progress".into()], &cwd, token).await?;
            if !pushed.is_empty() {
                output.push('\n');
                output.push_str(&pushed);
            }
        }
        let summary = action_summary(&kind, &payload);
        self.events.send(
            &context.client_id,
            "git.progress",
            json!({ "cwd": cwd, "actionId": action_id, "phase": "done", "line": summary }),
        );
        let mut result = json!({ "actionId": action_id, "summary": summary, "output": output });
        if matches!(kind.as_str(), "commit" | "commit-push") {
            if let Ok(hash) = git_output(&cwd, &["rev-parse", "HEAD"]).await {
                result.as_object_mut().unwrap().insert("commit".to_owned(), json!({ "hash": hash.trim(), "subject": payload.get("subject").and_then(Value::as_str).unwrap_or("Commit") }));
            }
        }
        if kind == "create-pr" {
            if let Some(url) = output
                .split_whitespace()
                .find(|word| word.starts_with("https://"))
            {
                result
                    .as_object_mut()
                    .unwrap()
                    .insert("url".to_owned(), json!(url));
            }
        }
        Ok(result)
    }

    async fn worktree_add(&self, payload: Value) -> RpcResult {
        let repo = PathBuf::from(string_field(&payload, "repo")?);
        let branch = string_field(&payload, "branch")?;
        let (main, _) = repository_state(&repo).await?;
        let operation_lock = self.worktree_lock_for(&main).await;
        let _operation = operation_lock.lock().await;
        let (_, existing) = repository_state(&repo).await?;
        let from_branch = git_output(&repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .await
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let from_commit = git_output(&repo, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .to_owned();
        if let Some(entry) = existing
            .iter()
            .find(|entry| entry.branch.as_deref() == Some(branch.as_str()))
        {
            let records = self.read_register(&main).await;
            let mut worktree = json!({ "path": entry.path, "branch": branch });
            if let Some(record) = records.get(&worktree_key(&entry.path)) {
                add_record_fields(&mut worktree, record);
            }
            return Ok(json!({ "worktree": worktree, "created": false }));
        }
        let path = self
            .repository_worktree_dir(&main)
            .join(safe_branch_name(&branch));
        let directory = self.repository_worktree_dir(&main);
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        #[cfg(unix)]
        tokio::fs::set_permissions(
            &directory,
            <std::fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o700),
        )
        .await
        .map_err(io_error)?;
        let branch_exists = git_status(
            &main,
            &[
                "show-ref",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ],
        )
        .await?
        .0 == 0;
        let path_arg = path.to_string_lossy().to_string();
        let arguments = if branch_exists {
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                path_arg,
                branch.clone(),
            ]
        } else {
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                "-b".to_owned(),
                branch.clone(),
                path_arg,
                "HEAD".to_owned(),
            ]
        };
        git_owned(&main, &arguments).await?;
        let project_id = payload
            .get("projectId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let record = WorktreeRecord {
            branch: branch.clone(),
            from: WorktreeFrom {
                branch: from_branch,
                commit: from_commit,
            },
            project_id,
            node_id: payload
                .get("nodeId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            made_by: payload
                .get("madeBy")
                .and_then(Value::as_str)
                .filter(|value| matches!(*value, "verb" | "client" | "fork"))
                .unwrap_or("client")
                .to_owned(),
            branch_made: !branch_exists,
            made_at: now_ms(),
        };
        let registered = match self.register_put(&main, &path, record.clone()).await {
            Ok(()) => match payload.get("projectId").and_then(Value::as_str) {
                Some(project_id) => self.link_shared_paths(project_id, &path).await,
                None => Ok(()),
            },
            Err(error) => Err(error),
        };
        if let Err(error) = registered {
            let _ = git_owned(
                &main,
                &[
                    "worktree".to_owned(),
                    "remove".to_owned(),
                    "--force".to_owned(),
                    path.to_string_lossy().to_string(),
                ],
            )
            .await;
            if !branch_exists {
                let _ = git_owned(
                    &main,
                    &["branch".to_owned(), "-D".to_owned(), branch.clone()],
                )
                .await;
            }
            let _ = self.register_delete(&main, &path).await;
            return Err(error);
        }
        self.events
            .broadcast("git.worktrees", json!({ "repo": main }));
        let mut worktree = json!({ "path": path, "branch": branch });
        add_record_fields(&mut worktree, &record);
        Ok(json!({ "worktree": worktree, "created": true }))
    }

    async fn worktree_remove(&self, payload: Value) -> RpcResult {
        let repo = PathBuf::from(string_field(&payload, "repo")?);
        let requested = PathBuf::from(string_field(&payload, "path")?);
        let (main, _) = repository_state(&repo).await?;
        let operation_lock = self.worktree_lock_for(&main).await;
        let _operation = operation_lock.lock().await;
        let (_, worktrees) = repository_state(&repo).await?;
        if same_path(&main, &requested) {
            return Err(RpcError::new(
                "worktree-main",
                "The repository's main checkout cannot be removed as a worktree.",
            ));
        }
        let records = self.read_register(&main).await;
        let entry = worktrees
            .iter()
            .find(|entry| same_path(&entry.path, &requested));
        let record_key = records
            .keys()
            .find(|path| same_path(Path::new(path), &requested))
            .cloned();
        let checkpoint_top = entry
            .map(|entry| entry.path.clone())
            .or_else(|| record_key.as_ref().map(PathBuf::from))
            .unwrap_or_else(|| requested.clone());
        let record = record_key.as_ref().and_then(|key| records.get(key));
        let recorded_branch_exists = match record {
            Some(record) => branch_exists(&main, &record.branch).await,
            None => false,
        };
        if entry.is_none() && !recorded_branch_exists {
            if let Some(key) = record_key {
                self.register_delete(&main, Path::new(&key)).await?;
            }
            return Err(RpcError::new(
                "worktree-not-found",
                format!(
                    "{} is not a worktree of this repository",
                    requested.display()
                ),
            ));
        }
        let missing = entry.is_none_or(|entry| entry.prunable || !entry.path.exists());
        let (work, target) = inspect_worktree(&main, entry, record, missing).await?;
        let force = payload.get("force").and_then(Value::as_bool) == Some(true);
        if !force && has_work(&work) {
            let label = entry
                .and_then(|entry| entry.branch.as_deref())
                .or_else(|| record.map(|record| record.branch.as_str()))
                .unwrap_or("worktree");
            return Err(RpcError::new(
                "worktree-has-work",
                work_sentence(label, &work, target.as_deref()),
            ));
        }
        if !force && entry.is_some_and(|entry| entry.locked) {
            return Err(RpcError::new(
                "worktree-locked",
                "The worktree is locked. Remove it with force to override the lock.",
            ));
        }
        if let Some(entry) = entry {
            let mut arguments = vec![
                "worktree".to_owned(),
                "remove".to_owned(),
                "--force".to_owned(),
            ];
            if entry.locked {
                arguments.push("--force".to_owned());
            }
            arguments.push(entry.path.to_string_lossy().to_string());
            let removed = git_status_owned(&main, &arguments).await?;
            if removed.0 != 0 {
                if missing && !entry.locked {
                    git_output(&main, &["worktree", "prune"]).await?;
                } else {
                    return Err(RpcError::new("git-failed", removed.2.trim().to_owned()));
                }
            }
        }
        let keep = payload.get("keepBranch").and_then(Value::as_bool);
        let branch = branch_to_delete(entry, record, keep);
        let mut branch_deleted = false;
        let mut branch_commit = None;
        if let Some(branch) = branch
            && branch_exists(&main, &branch).await
            && (work.ahead == 0 || force)
        {
            branch_commit = git_output(&main, &["rev-parse", &format!("refs/heads/{branch}")])
                .await
                .ok()
                .map(|value| value.trim().to_owned());
            branch_deleted = git_status(&main, &["branch", "-D", &branch]).await?.0 == 0;
        }
        if let Some(key) = record_key {
            self.register_delete(&main, Path::new(&key)).await?;
        }
        match tokio::fs::remove_file(checkpoint_index_path(
            &self.home.join("checkpoints"),
            &checkpoint_top,
        ))
        .await
        {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        self.events
            .broadcast("git.worktrees", json!({ "repo": main }));
        let mut result = json!({ "branchDeleted": branch_deleted });
        if branch_deleted && let Some(commit) = branch_commit {
            result
                .as_object_mut()
                .unwrap()
                .insert("branchCommit".to_owned(), json!(commit));
        }
        Ok(result)
    }

    async fn worktree_list(&self, payload: Value) -> RpcResult {
        let repo = PathBuf::from(string_field(&payload, "repo")?);
        let inspect = payload.get("inspect").and_then(Value::as_bool) == Some(true);
        let (main, entries) = repository_state(&repo).await?;
        let records = self.read_register(&main).await;
        let mut values = Vec::new();
        let mut known = HashSet::new();
        for entry in &entries {
            let branch = entry.branch.as_deref().unwrap_or("(detached)");
            let entry_key = worktree_key(&entry.path);
            known.insert(entry_key.clone());
            let mut value = json!({ "path": entry.path, "branch": branch });
            let record = records.get(&entry_key);
            if let Some(record) = record {
                add_record_fields(&mut value, record);
            }
            if entry.locked {
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("locked".to_owned(), json!(true));
            }
            let missing = entry.prunable || !entry.path.exists();
            if missing {
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("missing".to_owned(), json!(true));
            }
            if inspect {
                let (work, _) = inspect_worktree(&main, Some(entry), record, missing).await?;
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("work".to_owned(), serde_json::to_value(work).unwrap());
            }
            values.push(value);
        }
        for (path, record) in &records {
            if known.contains(path) || !branch_exists(&main, &record.branch).await {
                continue;
            }
            let mut value = json!({ "path": path, "branch": record.branch, "missing": true });
            add_record_fields(&mut value, record);
            if inspect {
                let (work, _) = inspect_worktree(&main, None, Some(record), true).await?;
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("work".to_owned(), serde_json::to_value(work).unwrap());
            }
            values.push(value);
        }
        Ok(json!({ "worktrees": values }))
    }

    fn repository_worktree_dir(&self, main: &Path) -> PathBuf {
        let name = main
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("repo");
        let mut digest = Sha1::new();
        digest.update(main.to_string_lossy().as_bytes());
        let hash = format!("{:x}", digest.finalize());
        self.home
            .join("worktrees")
            .join(format!("{name}-{}", &hash[..8]))
    }

    fn register_path(&self, main: &Path) -> PathBuf {
        self.repository_worktree_dir(main).join("worktrees.json")
    }

    async fn read_register(&self, main: &Path) -> HashMap<String, WorktreeRecord> {
        read_optional(&self.register_path(main))
            .await
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value.get("worktrees").and_then(Value::as_object).cloned())
            .map(|records| {
                records
                    .into_iter()
                    .filter_map(|(path, value)| {
                        serde_json::from_value(value).ok().map(|record| {
                            let key = worktree_key(Path::new(&path));
                            (key, record)
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    async fn write_register(
        &self,
        main: &Path,
        records: HashMap<String, WorktreeRecord>,
    ) -> Result<(), RpcError> {
        let mut bytes =
            serde_json::to_vec_pretty(&json!({ "version": 1, "worktrees": records })).unwrap();
        bytes.push(b'\n');
        write_atomic(&self.register_path(main), &bytes)
            .await
            .map_err(io_error)
    }

    async fn register_put(
        &self,
        main: &Path,
        path: &Path,
        record: WorktreeRecord,
    ) -> Result<(), RpcError> {
        let _guard = self.register_lock.lock().await;
        let mut records = self.read_register(main).await;
        records.insert(worktree_key(path), record);
        self.write_register(main, records).await
    }

    async fn register_delete(&self, main: &Path, path: &Path) -> Result<(), RpcError> {
        let _guard = self.register_lock.lock().await;
        let mut records = self.read_register(main).await;
        if records.remove(&worktree_key(path)).is_none() {
            return Ok(());
        }
        self.write_register(main, records).await
    }

    async fn link_shared_paths(&self, project_id: &str, worktree: &Path) -> Result<(), RpcError> {
        let Some(folder) = self.projects.folder_of(project_id).await? else {
            return Ok(());
        };
        let top = PathBuf::from(
            git_output(&folder, &["rev-parse", "--show-toplevel"])
                .await?
                .trim(),
        );
        let prefix = git_output(&folder, &["rev-parse", "--show-prefix"])
            .await?
            .trim()
            .to_owned();
        let settings = read_optional(&folder.join(".ruimte/settings.json"))
            .await
            .map_err(io_error)?
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .unwrap_or_else(|| json!({}));
        let mut excluded = Vec::new();
        for wanted in settings
            .get("worktrees")
            .and_then(|value| value.get("share"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let Some(relative) = shared_path_of(wanted) else {
                continue;
            };
            let source = folder.join(&relative);
            if tokio::fs::symlink_metadata(&source).await.is_err() {
                continue;
            }
            let in_repository = format!("{prefix}{}", relative.to_string_lossy());
            if !git_output(
                &top,
                &[
                    "ls-files",
                    "-z",
                    "--",
                    &format!(":(literal){in_repository}"),
                ],
            )
            .await?
            .is_empty()
            {
                continue;
            }
            if git_status(&top, &["check-ignore", "-q", "--", &in_repository])
                .await?
                .0
                != 0
            {
                continue;
            }
            let target = worktree.join(&relative);
            if tokio::fs::symlink_metadata(&target).await.is_ok() {
                continue;
            }
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(io_error)?;
            }
            create_symlink(source, target).await?;
            excluded.push(format!("/{in_repository}"));
        }
        if !excluded.is_empty() {
            self.add_git_excludes(&top, &excluded).await?;
        }
        Ok(())
    }

    async fn add_git_excludes(&self, top: &Path, lines: &[String]) -> Result<(), RpcError> {
        let common = git_output(top, &["rev-parse", "--git-common-dir"])
            .await?
            .trim()
            .to_owned();
        let common = PathBuf::from(common);
        let common = if common.is_absolute() {
            common
        } else {
            top.join(common)
        };
        let file = common.join("info/exclude");
        let current = tokio::fs::read_to_string(&file).await.unwrap_or_default();
        let present = current.lines().map(str::trim).collect::<HashSet<_>>();
        let missing = lines
            .iter()
            .filter(|line| !present.contains(line.as_str()))
            .collect::<Vec<_>>();
        if missing.is_empty() {
            return Ok(());
        }
        if let Some(parent) = file.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(io_error)?;
        }
        let mut addition = String::new();
        if !current.is_empty() && !current.ends_with('\n') {
            addition.push('\n');
        }
        if !present.contains("# Ruimte: shared paths linked into worktrees") {
            addition.push_str("# Ruimte: shared paths linked into worktrees\n");
        }
        for line in missing {
            addition.push_str(line);
            addition.push('\n');
        }
        use tokio::io::AsyncWriteExt;
        let mut output = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file)
            .await
            .map_err(io_error)?;
        output
            .write_all(addition.as_bytes())
            .await
            .map_err(io_error)
    }

    async fn worktree_merge(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let action_id = string_field(&payload, "actionId")?;
        let token = CancellationToken::new();
        self.actions
            .lock()
            .await
            .insert(action_id.clone(), token.clone());
        let result = self
            .worktree_merge_inner(payload, Some(context), &token)
            .await;
        self.actions.lock().await.remove(&action_id);
        result
    }

    async fn worktree_merge_inner(
        &self,
        payload: Value,
        context: Option<&RequestContext>,
        token: &CancellationToken,
    ) -> RpcResult {
        let repo = PathBuf::from(string_field(&payload, "repo")?);
        let (main, _) = repository_state(&repo).await?;
        let operation_lock = self.worktree_lock_for(&main).await;
        let _operation = operation_lock.lock().await;
        let source_path = PathBuf::from(string_field(&payload, "path")?);
        let action_id = string_field(&payload, "actionId")?;
        let strategy = string_field(&payload, "strategy")?;
        let worktrees =
            parse_worktrees(&git_output(&repo, &["worktree", "list", "--porcelain"]).await?);
        let source = worktrees
            .iter()
            .find(|entry| same_path(&entry.path, &source_path))
            .ok_or_else(|| {
                RpcError::new(
                    "worktree-missing",
                    "The worktree is gone, so there is nothing to merge.",
                )
            })?;
        let branch = source
            .branch
            .clone()
            .ok_or_else(|| RpcError::new("no-branch", "Only a branch can be merged."))?;
        if let Some(operation) = operation_in(&source.path).await {
            return Err(RpcError::new(
                "worktree-busy",
                format!("A {operation} stopped halfway in {branch}. Finish or abort it first."),
            ));
        }
        let into = payload
            .get("into")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| worktrees.first().and_then(|entry| entry.branch.clone()))
            .ok_or_else(|| {
                RpcError::new(
                    "target-not-checked-out",
                    "Name a checked out branch to merge into.",
                )
            })?;
        let target = worktrees
            .iter()
            .find(|entry| {
                entry.branch.as_deref() == Some(into.as_str())
                    && !same_path(&entry.path, &source_path)
            })
            .ok_or_else(|| {
                RpcError::new(
                    "target-not-checked-out",
                    format!("{into} is not checked out anywhere."),
                )
            })?;
        if let Some(operation) = operation_in(&target.path).await {
            return Err(RpcError::new(
                "target-busy",
                format!(
                    "A {operation} waits halfway in {}. Finish or abort it first.",
                    target.path.display()
                ),
            ));
        }
        if payload.get("cleanTarget").and_then(Value::as_bool) == Some(true)
            && !git_output(
                &target.path,
                &["status", "--porcelain", "--untracked-files=no"],
            )
            .await?
            .trim()
            .is_empty()
        {
            return Err(RpcError::new(
                "target-dirty",
                format!(
                    "{} has uncommitted changes of its own.",
                    target.path.display()
                ),
            ));
        }
        if git_output(&source.path, &["status", "--porcelain"])
            .await?
            .trim()
            != ""
        {
            if payload.get("commitFirst").and_then(Value::as_bool) != Some(true) {
                return Err(RpcError::new(
                    "worktree-has-work",
                    format!("{branch} holds uncommitted work. Commit it first."),
                ));
            }
            run_cancelable(
                "git",
                &["add".to_owned(), "--all".to_owned()],
                &source.path,
                token,
            )
            .await?;
            let subject = payload
                .get("subject")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("Work in worktree");
            run_cancelable(
                "git",
                &[
                    "commit".to_owned(),
                    "--message".to_owned(),
                    subject.to_owned(),
                ],
                &source.path,
                token,
            )
            .await?;
        }
        if let Some(context) = context {
            let phase = if strategy == "rebase" {
                "rebase"
            } else {
                "merge"
            };
            self.events.send(
                &context.client_id,
                "git.progress",
                json!({ "cwd": target.path, "actionId": action_id, "phase": phase, "line": "" }),
            );
        }
        let output = match strategy.as_str() {
            "rebase" => {
                if let Err(error) = run_cancelable(
                    "git",
                    &["rebase".to_owned(), format!("refs/heads/{into}")],
                    &source.path,
                    token,
                )
                .await
                {
                    let conflicts = conflicted_files(&source.path).await;
                    let _ = git_status(&source.path, &["rebase", "--abort"]).await;
                    return Err(RpcError::new(
                        "merge-conflict",
                        if conflicts.is_empty() {
                            error.message
                        } else {
                            format!(
                                "Rebasing {branch} onto {into} conflicts in: {}. The rebase was taken back.",
                                conflicts.join(", ")
                            )
                        },
                    ));
                }
                run_cancelable(
                    "git",
                    &[
                        "merge".to_owned(),
                        "--ff-only".to_owned(),
                        format!("refs/heads/{branch}"),
                    ],
                    &target.path,
                    token,
                )
                .await?
            }
            "squash" => {
                let mut output = match run_cancelable(
                    "git",
                    &[
                        "merge".to_owned(),
                        "--squash".to_owned(),
                        format!("refs/heads/{branch}"),
                    ],
                    &target.path,
                    token,
                )
                .await
                {
                    Ok(output) => output,
                    Err(error) => {
                        return merge_failure(
                            &repo,
                            &target.path,
                            &action_id,
                            &into,
                            error,
                            token.is_cancelled(),
                        )
                        .await;
                    }
                };
                if git_status(&target.path, &["diff", "--cached", "--quiet"])
                    .await?
                    .0
                    != 0
                {
                    let subject = payload
                        .get("subject")
                        .and_then(Value::as_str)
                        .unwrap_or("Merge worktree");
                    output.push_str(
                        &run_cancelable(
                            "git",
                            &[
                                "commit".to_owned(),
                                "--message".to_owned(),
                                subject.to_owned(),
                            ],
                            &target.path,
                            token,
                        )
                        .await?,
                    );
                }
                output
            }
            "merge" => {
                match run_cancelable(
                    "git",
                    &[
                        "-c".to_owned(),
                        "merge.autoStash=false".to_owned(),
                        "-c".to_owned(),
                        "rerere.enabled=false".to_owned(),
                        "merge".to_owned(),
                        "--no-edit".to_owned(),
                        "--no-ff".to_owned(),
                        branch.clone(),
                    ],
                    &target.path,
                    token,
                )
                .await
                {
                    Ok(output) => output,
                    Err(error) => {
                        return merge_failure(
                            &repo,
                            &target.path,
                            &action_id,
                            &into,
                            error,
                            token.is_cancelled(),
                        )
                        .await;
                    }
                }
            }
            _ => return Err(RpcError::new("bad-request", "Unknown merge strategy.")),
        };
        let summary = match strategy.as_str() {
            "squash" => format!("Squashed {branch} into {into}."),
            "rebase" => format!("Rebased {branch} onto {into} and fast-forwarded."),
            _ => format!("Merged {branch} into {into}."),
        };
        if let Some(context) = context {
            self.events.send(
                &context.client_id,
                "git.progress",
                json!({ "cwd": target.path, "actionId": action_id, "phase": "done", "line": summary }),
            );
        }
        self.events
            .broadcast("git.worktrees", json!({ "repo": repo }));
        Ok(
            json!({ "actionId": action_id, "summary": summary, "output": output, "cwd": target.path, "into": into }),
        )
    }

    async fn worktree_lock_for(&self, main: &Path) -> Arc<Mutex<()>> {
        self.worktree_locks
            .lock()
            .await
            .entry(main.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

async fn merge_failure(
    repo: &Path,
    target: &Path,
    action_id: &str,
    into: &str,
    error: RpcError,
    canceled: bool,
) -> RpcResult {
    let conflicts = conflicted_files(target).await;
    let waiting =
        operation_in(target).await.is_some() || git_path_exists(target, "SQUASH_MSG").await;
    if canceled {
        let _ = abort_merge_state(target).await;
        return Err(error);
    }
    if conflicts.is_empty() && !waiting {
        return Err(error);
    }
    let summary = if conflicts.is_empty() {
        format!("The merge waits in {}.", target.display())
    } else {
        format!(
            "Files conflict in {}: {}.",
            target.display(),
            conflicts.join(", ")
        )
    };
    Ok(json!({
        "actionId": action_id,
        "summary": summary,
        "output": error.message,
        "cwd": target,
        "into": into,
        "conflicts": conflicts,
        "repo": repo
    }))
}

async fn conflicted_files(cwd: &Path) -> Vec<String> {
    git_output(cwd, &["diff", "--name-only", "--diff-filter=U", "-z"])
        .await
        .unwrap_or_default()
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

async fn git_path_exists(cwd: &Path, name: &str) -> bool {
    let Ok(path) = git_output(cwd, &["rev-parse", "--git-path", name]).await else {
        return false;
    };
    let path = PathBuf::from(path.trim());
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    path.exists()
}

async fn abort_merge_state(cwd: &Path) -> Result<(), RpcError> {
    if git_path_exists(cwd, "MERGE_HEAD").await {
        git_output(cwd, &["merge", "--abort"]).await?;
        return Ok(());
    }
    if git_path_exists(cwd, "SQUASH_MSG").await && !conflicted_files(cwd).await.is_empty() {
        git_output(cwd, &["reset", "--merge"]).await?;
        let message = git_output(cwd, &["rev-parse", "--git-path", "SQUASH_MSG"]).await?;
        let message = PathBuf::from(message.trim());
        let message = if message.is_absolute() {
            message
        } else {
            cwd.join(message)
        };
        let _ = tokio::fs::remove_file(message).await;
        return Ok(());
    }
    Err(RpcError::new(
        "git-failed",
        "No merge waits halfway in this checkout.",
    ))
}

async fn status(cwd: &Path) -> RpcResult {
    let root = match git_status(cwd, &["rev-parse", "--show-toplevel"]).await {
        Ok((0, stdout, _)) => PathBuf::from(stdout.trim()),
        _ => return Ok(empty_status()),
    };
    let porcelain = git_output(
        &root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )
    .await?;
    let parsed = parse_porcelain(&porcelain);
    let base = resolve_base(&root).await;
    let merge_base = if let Some(base) = &base {
        git_output(&root, &["merge-base", base, "HEAD"])
            .await
            .ok()
            .map(|value| value.trim().to_owned())
    } else {
        None
    };
    let staged = numstat_map(&root, &["diff", "--cached", "--numstat", "-z"]).await;
    let unstaged = numstat_map(&root, &["diff", "--numstat", "-z"]).await;
    let mut files = Vec::new();
    for entry in parsed.entries.iter().take(1000) {
        if entry.untracked {
            files.push(git_file(
                entry,
                "untracked",
                "?",
                untracked_numstat(&root, &entry.path).await,
            ));
            continue;
        }
        if entry.unmerged {
            files.push(git_file(
                entry,
                "conflicted",
                &format!("{}{}", entry.index, entry.worktree),
                None,
            ));
            continue;
        }
        if entry.index != '.' {
            files.push(git_file(
                entry,
                "staged",
                &entry.index.to_string(),
                staged.get(&entry.path).copied(),
            ));
        }
        if entry.worktree != '.' {
            files.push(git_file(
                entry,
                "unstaged",
                &entry.worktree.to_string(),
                unstaged.get(&entry.path).copied(),
            ));
        }
    }
    Ok(
        json!({ "repo": true, "root": root, "branch": parsed.branch, "detached": parsed.detached, "upstream": parsed.upstream, "ahead": parsed.ahead, "behind": parsed.behind, "base": base, "mergeBase": merge_base, "files": files, "truncated": parsed.entries.len() > 1000, "live": true }),
    )
}

fn empty_status() -> Value {
    json!({ "repo": false, "root": null, "branch": null, "detached": false, "upstream": null, "ahead": 0, "behind": 0, "base": null, "mergeBase": null, "files": [], "truncated": false, "live": true })
}
fn git_file(
    entry: &StatusEntry,
    state: &str,
    status: &str,
    count: Option<(u64, u64, bool)>,
) -> Value {
    let (added, deleted, binary) = count.unwrap_or((0, 0, false));
    let mut value = json!({ "path": entry.path, "state": state, "status": status, "added": added, "deleted": deleted, "binary": binary });
    if let Some(old_path) = &entry.old_path {
        value
            .as_object_mut()
            .unwrap()
            .insert("oldPath".to_owned(), json!(old_path));
    }
    value
}

struct ParsedStatus {
    branch: Option<String>,
    detached: bool,
    upstream: Option<String>,
    ahead: u64,
    behind: u64,
    entries: Vec<StatusEntry>,
}
struct StatusEntry {
    path: String,
    old_path: Option<String>,
    index: char,
    worktree: char,
    unmerged: bool,
    untracked: bool,
}

fn parse_porcelain(output: &str) -> ParsedStatus {
    let records = output.split('\0').collect::<Vec<_>>();
    let mut parsed = ParsedStatus {
        branch: None,
        detached: false,
        upstream: None,
        ahead: 0,
        behind: 0,
        entries: Vec::new(),
    };
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if let Some(head) = record.strip_prefix("# branch.head ") {
            parsed.detached = head == "(detached)";
            if !parsed.detached {
                parsed.branch = Some(head.to_owned());
            }
        } else if let Some(upstream) = record.strip_prefix("# branch.upstream ") {
            parsed.upstream = Some(upstream.to_owned());
        } else if let Some(counts) = record.strip_prefix("# branch.ab ") {
            let mut fields = counts.split_whitespace();
            parsed.ahead = fields
                .next()
                .and_then(|value| value.trim_start_matches('+').parse().ok())
                .unwrap_or(0);
            parsed.behind = fields
                .next()
                .and_then(|value| value.trim_start_matches('-').parse().ok())
                .unwrap_or(0);
        } else if record.starts_with("1 ") {
            let fields = record.split(' ').collect::<Vec<_>>();
            let xy = fields.get(1).copied().unwrap_or("..");
            parsed.entries.push(StatusEntry {
                path: fields.get(8..).unwrap_or_default().join(" "),
                old_path: None,
                index: xy.chars().next().unwrap_or('.'),
                worktree: xy.chars().nth(1).unwrap_or('.'),
                unmerged: false,
                untracked: false,
            });
        } else if record.starts_with("2 ") {
            let fields = record.split(' ').collect::<Vec<_>>();
            let xy = fields.get(1).copied().unwrap_or("..");
            index += 1;
            parsed.entries.push(StatusEntry {
                path: fields.get(9..).unwrap_or_default().join(" "),
                old_path: records.get(index).map(|value| (*value).to_owned()),
                index: xy.chars().next().unwrap_or('.'),
                worktree: xy.chars().nth(1).unwrap_or('.'),
                unmerged: false,
                untracked: false,
            });
        } else if record.starts_with("u ") {
            let fields = record.split(' ').collect::<Vec<_>>();
            let xy = fields.get(1).copied().unwrap_or("UU");
            parsed.entries.push(StatusEntry {
                path: fields.get(10..).unwrap_or_default().join(" "),
                old_path: None,
                index: xy.chars().next().unwrap_or('U'),
                worktree: xy.chars().nth(1).unwrap_or('U'),
                unmerged: true,
                untracked: false,
            });
        } else if let Some(path) = record.strip_prefix("? ") {
            parsed.entries.push(StatusEntry {
                path: path.to_owned(),
                old_path: None,
                index: '?',
                worktree: '?',
                unmerged: false,
                untracked: true,
            });
        }
        index += 1;
    }
    parsed
}

async fn numstat_map(cwd: &Path, arguments: &[&str]) -> HashMap<String, (u64, u64, bool)> {
    let Ok(output) = git_output(cwd, arguments).await else {
        return HashMap::new();
    };
    parse_numstat_z(&output)
        .into_iter()
        .map(|(path, added, deleted, binary)| (path, (added, deleted, binary)))
        .collect()
}

fn parse_numstat_z(output: &str) -> Vec<(String, u64, u64, bool)> {
    let records = output.split('\0').collect::<Vec<_>>();
    let mut values = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        if record.is_empty() {
            index += 1;
            continue;
        }
        let mut fields = record.splitn(3, '\t');
        let added = fields.next().unwrap_or_default();
        let deleted = fields.next().unwrap_or_default();
        let mut path = fields.next().unwrap_or_default().to_owned();
        if path.is_empty() {
            index += 2;
            path = records.get(index).copied().unwrap_or_default().to_owned();
        }
        if !path.is_empty() {
            values.push((
                path,
                added.parse().unwrap_or(0),
                deleted.parse().unwrap_or(0),
                added == "-",
            ));
        }
        index += 1;
    }
    values
}

async fn untracked_numstat(cwd: &Path, path: &str) -> Option<(u64, u64, bool)> {
    let result = git_status(
        cwd,
        &["diff", "--numstat", "-z", "--no-index", "/dev/null", path],
    )
    .await
    .ok()?;
    if result.0 > 1 {
        return None;
    }
    parse_numstat_z(&result.1)
        .into_iter()
        .next()
        .map(|(_, added, deleted, binary)| (added, deleted, binary))
}

async fn diff(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let scope = string_field(&payload, "scope")?;
    let path = payload.get("path").and_then(Value::as_str);
    if path.is_none() && scope != "commit" && scope != "base" {
        return Err(RpcError::new(
            "bad-request",
            "A diff of this scope needs a path.",
        ));
    }
    let mut arguments = vec!["diff", "--no-color", "--no-ext-diff"];
    if payload.get("ignoreWhitespace").and_then(Value::as_bool) == Some(true) {
        arguments.push("--ignore-all-space");
    }
    let owned_base;
    if scope == "commit" {
        let commit = payload
            .get("commit")
            .and_then(Value::as_str)
            .unwrap_or("HEAD");
        owned_base = git_output(
            &cwd,
            &["rev-parse", "--verify", "--quiet", &format!("{commit}^")],
        )
        .await
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_owned());
        arguments.extend([owned_base.as_str(), commit]);
    } else if scope == "base" {
        owned_base = if let Some(named) = payload.get("base").and_then(Value::as_str) {
            git_output(&cwd, &["merge-base", named, "HEAD"])
                .await
                .unwrap_or_else(|_| "HEAD".to_owned())
        } else if let Some(base) = resolve_base(&cwd).await {
            git_output(&cwd, &["merge-base", &base, "HEAD"])
                .await
                .unwrap_or_else(|_| "HEAD".to_owned())
        } else {
            "HEAD".to_owned()
        };
        arguments.push(owned_base.trim());
    } else if payload.get("staged").and_then(Value::as_bool) == Some(true) {
        arguments.push("--cached");
    }
    if scope == "worktree" && payload.get("staged").and_then(Value::as_bool) != Some(true) {
        if let Some(path) = path {
            if git_status(&cwd, &["ls-files", "--error-unmatch", "--", path])
                .await?
                .0
                != 0
            {
                return diff_untracked(
                    &cwd,
                    path,
                    payload.get("ignoreWhitespace").and_then(Value::as_bool) == Some(true),
                )
                .await;
            }
        }
    }
    if let Some(path) = path {
        arguments.extend(["--", path]);
    }
    let output = git_output(&cwd, &arguments).await?;
    if path.is_none() {
        let files = diff_files(&cwd, &arguments).await?;
        let added = files
            .iter()
            .map(|file| file["added"].as_u64().unwrap_or(0))
            .sum::<u64>();
        let deleted = files
            .iter()
            .map(|file| file["deleted"].as_u64().unwrap_or(0))
            .sum::<u64>();
        let mut result = json!({ "path": "", "diff": "", "added": added, "deleted": deleted, "binary": false, "files": files, "truncated": false });
        if scope == "commit" {
            let commit = payload
                .get("commit")
                .and_then(Value::as_str)
                .unwrap_or("HEAD");
            if let Some(metadata) = commit_metadata(&cwd, commit).await {
                result
                    .as_object_mut()
                    .unwrap()
                    .insert("commit".to_owned(), metadata);
            }
        }
        return Ok(result);
    }
    let (added, deleted, binary) = numstat(&cwd, &arguments)
        .await?
        .into_iter()
        .next()
        .map(|(_, a, d, b)| (a, d, b))
        .unwrap_or((0, 0, false));
    let mut result = json!({ "path": path.unwrap(), "diff": if output.len() > 128 * 1024 { "" } else { &output }, "added": added, "deleted": deleted, "binary": binary });
    if binary {
        result
            .as_object_mut()
            .unwrap()
            .insert("omitted".to_owned(), json!("binary"));
    } else if output.len() > 128 * 1024 {
        result
            .as_object_mut()
            .unwrap()
            .insert("omitted".to_owned(), json!("too-large"));
    }
    Ok(result)
}

async fn diff_checkout(cwd: &Path, base: Option<&str>) -> RpcResult {
    let scratch =
        tempfile::tempdir().map_err(|error| RpcError::new("git-failed", error.to_string()))?;
    let index = scratch.path().join("index");
    if let Ok(own) = git_output(cwd, &["rev-parse", "--git-path", "index"]).await {
        let own = PathBuf::from(own.trim());
        let own = if own.is_absolute() {
            own
        } else {
            cwd.join(own)
        };
        if own.is_file() {
            let _ = tokio::fs::copy(own, &index).await;
        }
    }
    let index_value = index.to_string_lossy().into_owned();
    let (code, _, stderr) = git_status_with_index(cwd, &["add", "-A"], &index_value).await?;
    if code != 0 {
        return Err(RpcError::new(
            "git-failed",
            if stderr.trim().is_empty() {
                format!("Could not read the working tree of {}.", cwd.display())
            } else {
                stderr.trim().to_owned()
            },
        ));
    }
    let (code, tree, stderr) = git_status_with_index(cwd, &["write-tree"], &index_value).await?;
    if code != 0 || tree.trim().is_empty() {
        return Err(RpcError::new(
            "git-failed",
            if stderr.trim().is_empty() {
                format!("Could not read the working tree of {}.", cwd.display())
            } else {
                stderr.trim().to_owned()
            },
        ));
    }
    let start = match base {
        Some(base) => base.to_owned(),
        None => git_output(cwd, &["rev-parse", "--verify", "--quiet", "HEAD"])
            .await
            .map(|value| value.trim().to_owned())
            .unwrap_or_else(|_| "4b825dc642cb6eb9a060e54bf8d69288fbee4904".to_owned()),
    };
    let tree = tree.trim().to_owned();
    let arguments = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        start.as_str(),
        tree.as_str(),
    ];
    let files = diff_files(cwd, &arguments).await?;
    let added = files
        .iter()
        .map(|file| file["added"].as_u64().unwrap_or(0))
        .sum::<u64>();
    let deleted = files
        .iter()
        .map(|file| file["deleted"].as_u64().unwrap_or(0))
        .sum::<u64>();
    Ok(json!({
        "path": "",
        "diff": "",
        "added": added,
        "deleted": deleted,
        "binary": false,
        "files": files,
        "truncated": false
    }))
}

async fn git_status_with_index(
    cwd: &Path,
    arguments: &[&str],
    index: &str,
) -> Result<(i32, String, String), RpcError> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .env("GIT_INDEX_FILE", index)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(io_error)?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

async fn diff_files(cwd: &Path, arguments: &[&str]) -> Result<Vec<Value>, RpcError> {
    let counts = numstat(cwd, arguments).await?;
    let mut files = Vec::new();
    let mut total = 512 * 1024usize;
    for (path, added, deleted, binary) in counts.into_iter().take(100) {
        let mut file = json!({ "path": path, "diff": "", "added": added, "deleted": deleted, "binary": binary });
        if binary {
            file.as_object_mut()
                .unwrap()
                .insert("omitted".to_owned(), json!("binary"));
        } else if added + deleted > 2000 {
            file.as_object_mut()
                .unwrap()
                .insert("omitted".to_owned(), json!("too-large"));
        } else {
            let mut patch_args = arguments.to_vec();
            patch_args.extend(["--", path.as_str()]);
            let patch = git_output(cwd, &patch_args).await.unwrap_or_default();
            if patch.len() > 128 * 1024 || patch.len() > total {
                file.as_object_mut()
                    .unwrap()
                    .insert("omitted".to_owned(), json!("too-large"));
            } else {
                total -= patch.len();
                file.as_object_mut()
                    .unwrap()
                    .insert("diff".to_owned(), json!(patch));
            }
        }
        files.push(file);
    }
    Ok(files)
}

async fn diff_untracked(cwd: &Path, path: &str, ignore_whitespace: bool) -> RpcResult {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-index"];
    if ignore_whitespace {
        args.push("--ignore-all-space");
    }
    args.extend(["/dev/null", path]);
    let result = git_status(cwd, &args).await?;
    if result.0 > 1 {
        return Err(RpcError::new("git-failed", result.2.trim().to_owned()));
    }
    let mut stat_args = vec!["diff", "--numstat", "-z", "--no-index", "/dev/null", path];
    if ignore_whitespace {
        stat_args.insert(2, "--ignore-all-space");
    }
    let stat = git_status(cwd, &stat_args).await?;
    let (added, deleted, binary) = parse_numstat_z(&stat.1)
        .into_iter()
        .next()
        .map(|(_, added, deleted, binary)| (added, deleted, binary))
        .unwrap_or((0, 0, false));
    let too_large = result.1.len() > 128 * 1024;
    let mut value = json!({ "path": path, "diff": if too_large { String::new() } else { result.1 }, "added": added, "deleted": deleted, "binary": binary });
    if binary {
        value
            .as_object_mut()
            .unwrap()
            .insert("omitted".to_owned(), json!("binary"));
    } else if too_large {
        value
            .as_object_mut()
            .unwrap()
            .insert("omitted".to_owned(), json!("too-large"));
    }
    Ok(value)
}

async fn commit_metadata(cwd: &Path, commit: &str) -> Option<Value> {
    let output = git_output(
        cwd,
        &[
            "log",
            "-1",
            "--format=%H%x1f%h%x1f%an%x1f%at%x1f%D%x1f%s",
            commit,
        ],
    )
    .await
    .ok()?;
    let fields = output.trim_end().split('\u{1f}').collect::<Vec<_>>();
    if fields.len() < 6 {
        return None;
    }
    let refs = fields[4]
        .split(", ")
        .map(|name| {
            name.trim_start_matches("HEAD -> ")
                .trim_start_matches("tag: ")
                .trim()
        })
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    Some(
        json!({ "hash": fields[0], "shortHash": fields[1], "author": fields[2], "at": fields[3].parse::<i64>().unwrap_or(0), "refs": refs, "subject": fields[5..].join("\u{1f}") }),
    )
}

async fn numstat(
    cwd: &Path,
    arguments: &[&str],
) -> Result<Vec<(String, u64, u64, bool)>, RpcError> {
    let mut args = arguments.to_vec();
    args.insert(1, "--numstat");
    args.insert(2, "-z");
    let output = git_output(cwd, &args).await?;
    Ok(parse_numstat_z(&output))
}

async fn stage(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let paths = payload
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("bad-request", "paths must be an array"))?;
    let mut arguments = if payload.get("staged").and_then(Value::as_bool) == Some(true) {
        vec!["add".to_owned(), "--".to_owned()]
    } else {
        vec!["reset".to_owned(), "HEAD".to_owned(), "--".to_owned()]
    };
    arguments.extend(
        paths
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned),
    );
    git_owned(&cwd, &arguments).await?;
    Ok(json!({}))
}

async fn discard(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let paths = payload
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("bad-request", "paths must be an array"))?;
    let marker = format!("ruimte-discard-{}", uuid::Uuid::new_v4());
    let mut arguments = vec![
        "stash".to_owned(),
        "push".to_owned(),
        "--include-untracked".to_owned(),
        "--message".to_owned(),
        marker.clone(),
        "--".to_owned(),
    ];
    arguments.extend(
        paths
            .iter()
            .filter_map(Value::as_str)
            .map(ToOwned::to_owned),
    );
    let output = git_owned(&cwd, &arguments).await?;
    let stash = if output.contains("No local changes") {
        None
    } else {
        git_output(&cwd, &["stash", "list", "--format=%gd%x1f%gs"])
            .await?
            .lines()
            .find_map(|line| {
                line.split_once('\u{1f}')
                    .filter(|(_, message)| message.contains(&marker))
                    .map(|(reference, _)| reference.to_owned())
            })
    };
    Ok(json!({ "stash": stash }))
}

async fn refs(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let base = resolve_base(&cwd).await;
    let current = git_output(&cwd, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .await
        .ok()
        .map(|value| value.trim().to_owned());
    let worktrees = parse_worktrees(&git_output(&cwd, &["worktree", "list", "--porcelain"]).await?);
    let checked = worktrees
        .into_iter()
        .filter_map(|entry| entry.branch.map(|branch| (branch, entry.path)))
        .collect::<HashMap<_, _>>();
    let mut rows = Vec::new();
    for (kind, namespace) in [("local", "refs/heads"), ("remote", "refs/remotes")] {
        let output = git_output(
            &cwd,
            &[
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(refname:short)%1f%(committerdate:unix)",
                namespace,
            ],
        )
        .await?;
        for line in output.lines().take(200 - rows.len()) {
            let Some((name, at)) = line.split_once('\u{1f}') else {
                continue;
            };
            if name.ends_with("/HEAD") {
                continue;
            }
            let mut row = json!({ "name": name, "kind": kind, "current": current.as_deref() == Some(name), "isDefault": base.as_deref() == Some(name), "at": at.parse::<i64>().unwrap_or(0) });
            if let Some(path) = checked.get(name) {
                row.as_object_mut()
                    .unwrap()
                    .insert("worktree".to_owned(), json!(path));
            }
            rows.push(row);
        }
    }
    let stashes = git_output(&cwd, &["stash", "list", "--format=%gd%x1f%gs"])
        .await
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            line.split_once('\u{1f}')
                .map(|(reference, message)| json!({ "ref": reference, "message": message }))
        })
        .collect::<Vec<_>>();
    Ok(json!({ "refs": rows, "current": current, "stashes": stashes }))
}

async fn log(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(30)
        .min(200) as usize;
    let skip = payload
        .get("cursor")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let count = (limit + 1).to_string();
    let skip_arg = skip.to_string();
    let output = match git_output(
        &cwd,
        &[
            "log",
            "-z",
            "--format=%H%x1f%h%x1f%an%x1f%at%x1f%D%x1f%s",
            "--max-count",
            &count,
            "--skip",
            &skip_arg,
            "HEAD",
        ],
    )
    .await
    {
        Ok(output) => output,
        Err(_) => String::new(),
    };
    let mut commits = output.split('\0').filter(|record| !record.is_empty()).filter_map(|record| {
        let fields = record.split('\u{1f}').collect::<Vec<_>>();
        if fields.len() < 6 { return None; }
        let refs = fields[4].split(", ").map(|name| name.trim_start_matches("HEAD -> ").trim_start_matches("tag: ").trim()).filter(|name| !name.is_empty()).collect::<Vec<_>>();
        Some(json!({ "hash": fields[0], "shortHash": fields[1], "author": fields[2], "at": fields[3].parse::<i64>().unwrap_or(0), "refs": refs, "subject": fields[5..].join("\u{1f}") }))
    }).collect::<Vec<_>>();
    let more = commits.len() > limit;
    commits.truncate(limit);
    Ok(
        json!({ "commits": commits, "cursor": if more { Some((skip + limit).to_string()) } else { None } }),
    )
}

async fn capabilities() -> RpcResult {
    let provider = select_message_provider(&default_message_providers(), None).await;
    Ok(json!({
        "gh": command_exists("gh").await,
        "messageProvider": provider.map(|provider| provider.kind)
    }))
}

fn default_message_providers() -> Vec<OneShotProvider> {
    vec![
        OneShotProvider {
            kind: "claude",
            name: "Claude Code",
            command: "claude".to_owned(),
            environment: Vec::new(),
        },
        OneShotProvider {
            kind: "codex",
            name: "Codex",
            command: "codex".to_owned(),
            environment: Vec::new(),
        },
        OneShotProvider {
            kind: "gemini",
            name: "Gemini",
            command: "gemini".to_owned(),
            environment: Vec::new(),
        },
    ]
}

fn random_action_id() -> String {
    format!("canvas-{}", uuid::Uuid::new_v4())
}

async fn select_message_provider(
    providers: &[OneShotProvider],
    preferred: Option<&str>,
) -> Option<OneShotProvider> {
    if let Some(preferred) = preferred
        && let Some(provider) = providers.iter().find(|provider| provider.kind == preferred)
        && command_exists_with_env(&provider.command, &provider.environment).await
    {
        return Some(provider.clone());
    }
    for provider in providers {
        if Some(provider.kind) != preferred
            && command_exists_with_env(&provider.command, &provider.environment).await
        {
            return Some(provider.clone());
        }
    }
    None
}

async fn suggest_message_with(
    payload: &Value,
    token: &CancellationToken,
    providers: &[OneShotProvider],
    timeout: std::time::Duration,
) -> RpcResult {
    let cwd = PathBuf::from(string_field(payload, "cwd")?);
    let top = PathBuf::from(
        git_output(&cwd, &["rev-parse", "--show-toplevel"])
            .await?
            .trim(),
    );
    let mut input = None;
    for scope in [Some("--cached"), None] {
        let mut names_args = vec!["diff"];
        if let Some(scope) = scope {
            names_args.push(scope);
        }
        names_args.push("--name-status");
        let names = git_output_bounded(&top, &names_args, MESSAGE_NAMES_LIMIT, token).await?;
        if names.trim().is_empty() {
            continue;
        }
        let mut patch_args = vec!["diff"];
        if let Some(scope) = scope {
            patch_args.push(scope);
        }
        patch_args.extend(["--no-color", "--no-ext-diff", "--unified=1"]);
        let patch = git_output_bounded(&top, &patch_args, MESSAGE_PATCH_LIMIT, token).await?;
        input = Some((
            truncate_utf8(&names, MESSAGE_NAMES_LIMIT),
            truncate_utf8(&patch, MESSAGE_PATCH_LIMIT),
        ));
        break;
    }
    let Some((names, patch)) = input else {
        return Err(RpcError::new(
            "git-failed",
            "There are no staged changes to describe.",
        ));
    };
    let preferred = payload.get("provider").and_then(Value::as_str);
    let provider = select_message_provider(providers, preferred)
        .await
        .ok_or_else(|| {
            RpcError::new(
                "git-failed",
                "No agent CLI on this machine can write a commit message.",
            )
        })?;
    let prompt = build_message_prompt(&names, &patch);
    let arguments = message_provider_arguments(provider.kind, prompt).ok_or_else(|| {
        RpcError::new(
            "git-failed",
            format!("{} cannot answer a single prompt.", provider.name),
        )
    })?;
    let output = run_message_command(
        &provider.command,
        &arguments,
        &top,
        token,
        provider.name,
        &provider.environment,
        timeout,
    )
    .await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let suggestion = output.success.then(|| parse_suggestion(&stdout)).flatten();
    let Some((subject, body)) = suggestion.filter(|(subject, _)| !subject.is_empty()) else {
        return Err(RpcError::new(
            "git-failed",
            format!(
                "{} wrote no message: {}",
                provider.name,
                if stderr.trim().is_empty() {
                    "no output"
                } else {
                    stderr.trim()
                }
            ),
        ));
    };
    Ok(json!({ "subject": subject, "body": body }))
}

struct CapturedOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

enum CapturedOutcome {
    Finished(CapturedOutput),
    Canceled,
    TimedOut,
}

async fn git_output_bounded(
    cwd: &Path,
    arguments: &[&str],
    limit: usize,
    token: &CancellationToken,
) -> Result<String, RpcError> {
    let arguments = arguments
        .iter()
        .map(|argument| (*argument).to_owned())
        .collect::<Vec<_>>();
    match run_captured_command("git", &arguments, cwd, token, None, &[], limit, 16 * 1024).await? {
        CapturedOutcome::Finished(output) if output.success => {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        }
        CapturedOutcome::Finished(output) => Err(RpcError::new(
            "git-failed",
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        )),
        CapturedOutcome::Canceled => {
            Err(RpcError::new("git-failed", "The git action was canceled."))
        }
        CapturedOutcome::TimedOut => unreachable!("git preparation has no timeout"),
    }
}

async fn run_message_command(
    program: &str,
    arguments: &[String],
    cwd: &Path,
    token: &CancellationToken,
    provider_name: &str,
    environment: &[(String, String)],
    timeout: std::time::Duration,
) -> Result<CapturedOutput, RpcError> {
    match run_captured_command(
        program,
        arguments,
        cwd,
        token,
        Some(timeout),
        environment,
        MESSAGE_OUTPUT_LIMIT,
        MESSAGE_OUTPUT_LIMIT,
    )
    .await?
    {
        CapturedOutcome::Finished(output) => Ok(output),
        CapturedOutcome::Canceled => {
            Err(RpcError::new("git-failed", "The git action was canceled."))
        }
        CapturedOutcome::TimedOut => Err(RpcError::new(
            "git-failed",
            format!("{provider_name} wrote no message: no output"),
        )),
    }
}

async fn run_captured_command(
    program: &str,
    arguments: &[String],
    cwd: &Path,
    token: &CancellationToken,
    deadline: Option<std::time::Duration>,
    environment: &[(String, String)],
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<CapturedOutcome, RpcError> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .current_dir(cwd)
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in [
        "RUIMTE_HOOK_URL",
        "RUIMTE_HOOK_TOKEN",
        "RUIMTE_CONTEXT_URL",
        "RUIMTE_CONTEXT_TOKEN",
        "RUIMTE_SESSION_ID",
    ] {
        command.env_remove(key);
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|error| RpcError::new("git-failed", error.to_string()))?;
    let pid = child
        .id()
        .ok_or_else(|| RpcError::new("git-failed", "The provider process did not start"))?;
    let stdout = child
        .stdout
        .take()
        .map(|stream| spawn_capped_reader(stream, stdout_limit, false));
    let stderr = child
        .stderr
        .take()
        .map(|stream| spawn_capped_reader(stream, stderr_limit, true));
    let mut guard = MessageProcessGuard::new(pid);
    if let Some(reader) = stdout.as_ref() {
        guard.track(reader);
    }
    if let Some(reader) = stderr.as_ref() {
        guard.track(reader);
    }
    let wait = async {
        if let Some(deadline) = deadline {
            tokio::select! {
                status = child.wait() => status.map(Some).map_err(io_error),
                _ = token.cancelled() => Ok(None),
                _ = tokio::time::sleep(deadline) => Ok(None),
            }
        } else {
            tokio::select! {
                status = child.wait() => status.map(Some).map_err(io_error),
                _ = token.cancelled() => Ok(None),
            }
        }
    };
    let started_at = std::time::Instant::now();
    let status = wait.await?;
    let stopped = status.is_none();
    let canceled = stopped && token.is_cancelled();
    if stopped {
        terminate_message_group(pid, libc::SIGTERM);
        if tokio::time::timeout(MESSAGE_EXIT_GRACE, child.wait())
            .await
            .is_err()
        {
            terminate_message_group(pid, libc::SIGKILL);
            let _ = child.wait().await;
        }
    }
    let stdout = finish_capped_reader(stdout, pid).await;
    let stderr = finish_capped_reader(stderr, pid).await;
    guard.disarm();
    if canceled {
        Ok(CapturedOutcome::Canceled)
    } else if stopped && deadline.is_some_and(|deadline| started_at.elapsed() >= deadline) {
        Ok(CapturedOutcome::TimedOut)
    } else if stopped {
        Ok(CapturedOutcome::Canceled)
    } else {
        Ok(CapturedOutcome::Finished(CapturedOutput {
            success: status.is_some_and(|status| status.success()),
            stdout,
            stderr,
        }))
    }
}

fn spawn_capped_reader(
    mut stream: impl AsyncRead + Send + Unpin + 'static,
    limit: usize,
    retain_tail: bool,
) -> JoinHandle<Vec<u8>> {
    tokio::spawn(async move {
        let mut retained = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            let Ok(read) = stream.read(&mut chunk).await else {
                break;
            };
            if read == 0 {
                break;
            }
            if retain_tail {
                retained.extend_from_slice(&chunk[..read]);
                if retained.len() > limit {
                    retained.drain(..retained.len() - limit);
                }
            } else if retained.len() < limit {
                let take = read.min(limit - retained.len());
                retained.extend_from_slice(&chunk[..take]);
            }
        }
        retained
    })
}

async fn finish_capped_reader(reader: Option<JoinHandle<Vec<u8>>>, pid: u32) -> Vec<u8> {
    let Some(mut reader) = reader else {
        return Vec::new();
    };
    match tokio::time::timeout(MESSAGE_EXIT_GRACE, &mut reader).await {
        Ok(Ok(bytes)) => bytes,
        _ => {
            terminate_message_group(pid, libc::SIGKILL);
            reader.abort();
            Vec::new()
        }
    }
}

struct MessageProcessGuard {
    pid: u32,
    readers: Vec<AbortHandle>,
    armed: bool,
}

impl MessageProcessGuard {
    fn new(pid: u32) -> Self {
        Self {
            pid,
            readers: Vec::new(),
            armed: true,
        }
    }

    fn track<T>(&mut self, reader: &JoinHandle<T>) {
        self.readers.push(reader.abort_handle());
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.readers.clear();
    }
}

impl Drop for MessageProcessGuard {
    fn drop(&mut self) {
        if self.armed {
            terminate_message_group(self.pid, libc::SIGKILL);
            for reader in &self.readers {
                reader.abort();
            }
        }
    }
}

fn terminate_message_group(pid: u32, signal: i32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

fn message_provider_arguments(kind: &str, prompt: String) -> Option<Vec<String>> {
    Some(match kind {
        "claude" => vec![
            "-p".to_owned(),
            prompt,
            "--output-format".to_owned(),
            "text".to_owned(),
        ],
        "codex" => vec![
            "exec".to_owned(),
            "--color".to_owned(),
            "never".to_owned(),
            "--sandbox".to_owned(),
            "read-only".to_owned(),
            "--skip-git-repo-check".to_owned(),
            "--ephemeral".to_owned(),
            prompt,
        ],
        "gemini" => vec!["--prompt".to_owned(), prompt],
        _ => return None,
    })
}

fn build_message_prompt(name_status: &str, patch: &str) -> String {
    format!(
        "Write a git commit message for the staged changes below.\n\nRules:\n- Answer with one JSON object and nothing else: {{\"subject\": \"...\", \"body\": \"...\"}}.\n- The subject is one line in the imperative mood, at most 72 characters, no trailing period.\n- Use the conventional commit form (feat:, fix:, chore:, refactor:, test:, docs:) when the change fits one.\n- The body explains why, wrapped at 72 characters, and is an empty string when the subject says it all.\n- American English. No em dashes or en dashes.\n\nFiles:\n{}\n\nPatch:\n{}",
        if name_status.trim().is_empty() {
            "(none reported)"
        } else {
            name_status.trim()
        },
        if patch.trim().is_empty() {
            "(empty)"
        } else {
            patch.trim()
        }
    )
}

fn parse_suggestion(output: &str) -> Option<(String, String)> {
    if let (Some(start), Some(end)) = (output.find('{'), output.rfind('}'))
        && end > start
        && let Ok(value) = serde_json::from_str::<Value>(&output[start..=end])
        && let Some(subject) = value.get("subject").and_then(Value::as_str)
    {
        return Some((
            subject.trim().to_owned(),
            value
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned(),
        ));
    }
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| (line.to_owned(), String::new()))
}

fn truncate_utf8(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_owned();
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

async fn worktree_abort(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    abort_merge_state(&cwd).await?;
    Ok(json!({}))
}

#[derive(Clone)]
struct WorktreeEntry {
    path: PathBuf,
    branch: Option<String>,
    head: Option<String>,
    locked: bool,
    prunable: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeFrom {
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    commit: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeRecord {
    branch: String,
    from: WorktreeFrom,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    node_id: Option<String>,
    made_by: String,
    #[serde(default = "default_true")]
    branch_made: bool,
    made_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeWork {
    changed: u64,
    untracked: u64,
    ahead: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    behind: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<String>,
}

fn default_true() -> bool {
    true
}

fn parse_worktrees(output: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<WorktreeEntry> = None;
    for line in output.lines().chain(std::iter::once("")) {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(WorktreeEntry {
                path: PathBuf::from(path),
                branch: None,
                head: None,
                locked: false,
                prunable: false,
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(entry) = current.as_mut() {
                entry.head = Some(head.to_owned());
            }
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            if let Some(entry) = current.as_mut() {
                entry.branch = Some(branch.to_owned());
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(entry) = current.as_mut() {
                entry.locked = true;
            }
        } else if line == "prunable" || line.starts_with("prunable ") {
            if let Some(entry) = current.as_mut() {
                entry.prunable = true;
            }
        } else if line.is_empty() {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
        }
    }
    entries
}

fn parse_checkpoint_numstat(output: &str) -> Vec<(String, u64, u64, bool)> {
    let records = output.split('\0').collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let record = records[index];
        index += 1;
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(3, '\t');
        let added = fields.next().unwrap_or_default();
        let deleted = fields.next().unwrap_or_default();
        let mut path = fields.next().unwrap_or_default();
        if path.is_empty() && index + 1 < records.len() {
            index += 1;
            path = records[index];
            index += 1;
        }
        if !path.is_empty() {
            result.push((
                path.to_owned(),
                added.parse().unwrap_or(0),
                deleted.parse().unwrap_or(0),
                added == "-",
            ));
        }
    }
    result
}

fn checkpoint_index_path(root: &Path, top: &Path) -> PathBuf {
    let basename = top
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repository");
    let digest = format!("{:x}", Sha1::digest(top.to_string_lossy().as_bytes()));
    root.join(format!("{basename}-{}.index", &digest[..8]))
}

fn checkpoint_kinds(output: &str) -> HashMap<String, String> {
    let fields = output
        .split('\0')
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut result = HashMap::new();
    for pair in fields.as_chunks::<2>().0 {
        let kind = match pair[0].chars().next() {
            Some('A') => "add",
            Some('D') => "delete",
            _ => "update",
        };
        result.insert(pair[1].to_owned(), kind.to_owned());
    }
    result
}

async fn repository_state(repo: &Path) -> Result<(PathBuf, Vec<WorktreeEntry>), RpcError> {
    git_output(repo, &["rev-parse", "--show-toplevel"])
        .await
        .map_err(|_| RpcError::new("not-a-repo", "The folder is not inside a git repository."))?;
    let mut entries =
        parse_worktrees(&git_output(repo, &["worktree", "list", "--porcelain"]).await?);
    if entries.is_empty() {
        return Err(RpcError::new(
            "not-a-repo",
            "The folder is not inside a git repository.",
        ));
    }
    let main = entries.remove(0).path;
    Ok((main, entries))
}

fn safe_branch_name(branch: &str) -> String {
    let name = branch
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if name.is_empty() {
        "branch".to_owned()
    } else {
        name
    }
}

fn shared_path_of(value: &str) -> Option<PathBuf> {
    let normalized = value.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return None;
    }
    let mut result = PathBuf::new();
    for component in Path::new(normalized).components() {
        match component {
            std::path::Component::Normal(part) if part != ".git" => result.push(part),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    (!result.as_os_str().is_empty()).then_some(result)
}

fn add_record_fields(value: &mut Value, record: &WorktreeRecord) {
    let object = value.as_object_mut().unwrap();
    object.insert(
        "from".to_owned(),
        serde_json::to_value(&record.from).unwrap(),
    );
    object.insert("madeAt".to_owned(), json!(record.made_at));
    if let Some(project_id) = &record.project_id {
        object.insert("projectId".to_owned(), json!(project_id));
    }
    if let Some(node_id) = &record.node_id {
        object.insert("nodeId".to_owned(), json!(node_id));
    }
}

async fn branch_exists(main: &Path, branch: &str) -> bool {
    git_status(
        main,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .await
    .is_ok_and(|result| result.0 == 0)
}

async fn inspect_worktree(
    main: &Path,
    entry: Option<&WorktreeEntry>,
    record: Option<&WorktreeRecord>,
    missing: bool,
) -> Result<(WorktreeWork, Option<String>), RpcError> {
    let target = if let Some(branch) = record.and_then(|record| record.from.branch.as_deref()) {
        if branch_exists(main, branch).await {
            Some(branch.to_owned())
        } else {
            resolve_base(main)
                .await
                .or_else(|| record.map(|record| record.from.commit.clone()))
        }
    } else {
        resolve_base(main)
            .await
            .or_else(|| record.map(|record| record.from.commit.clone()))
    };
    let mut tips = Vec::new();
    if let Some(head) = entry.and_then(|entry| entry.head.as_ref()) {
        tips.push(head.clone());
    }
    for branch in [
        entry.and_then(|entry| entry.branch.as_ref()),
        record.map(|record| &record.branch),
    ]
    .into_iter()
    .flatten()
    {
        let reference = format!("refs/heads/{branch}");
        if branch_exists(main, branch).await && !tips.contains(&reference) {
            tips.push(reference);
        }
    }
    let ahead = revision_count(main, &tips, target.as_deref()).await;
    let behind = if let Some(target) = &target {
        revision_count(
            main,
            std::slice::from_ref(target),
            tips.first().map(String::as_str),
        )
        .await
    } else {
        0
    };
    if missing || entry.is_none() {
        return Ok((
            WorktreeWork {
                changed: 0,
                untracked: 0,
                ahead,
                behind: (behind > 0).then_some(behind),
                operation: None,
            },
            target,
        ));
    }
    let entry = entry.unwrap();
    let porcelain = git_output(
        &entry.path,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "-uall",
            "--ignore-submodules=all",
        ],
    )
    .await?;
    let (changed, untracked) = count_worktree_status(&porcelain);
    let operation = operation_in(&entry.path).await;
    Ok((
        WorktreeWork {
            changed,
            untracked,
            ahead,
            behind: (behind > 0).then_some(behind),
            operation,
        },
        target,
    ))
}

async fn revision_count(main: &Path, tips: &[String], target: Option<&str>) -> u64 {
    if tips.is_empty() {
        return 0;
    }
    let mut arguments = vec!["rev-list".to_owned(), "--count".to_owned()];
    arguments.extend(tips.iter().cloned());
    if let Some(target) = target {
        arguments.extend(["--not".to_owned(), target.to_owned()]);
    } else {
        arguments.extend(["--not".to_owned(), "--branches".to_owned()]);
    }
    git_owned(main, &arguments)
        .await
        .ok()
        .and_then(|output| output.trim().parse().ok())
        .unwrap_or(0)
}

fn count_worktree_status(output: &str) -> (u64, u64) {
    let fields = output.split('\0').collect::<Vec<_>>();
    let mut changed = 0;
    let mut untracked = 0;
    let mut index = 0;
    while index < fields.len() {
        let field = fields[index];
        if field.starts_with("1 ") || field.starts_with("u ") {
            changed += 1;
        } else if field.starts_with("2 ") {
            changed += 1;
            index += 1;
        } else if field.starts_with("? ") {
            untracked += 1;
        }
        index += 1;
    }
    (changed, untracked)
}

async fn operation_in(path: &Path) -> Option<String> {
    for (file, name) in [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ] {
        let found = git_output(path, &["rev-parse", "--git-path", file])
            .await
            .ok()?;
        let found = PathBuf::from(found.trim());
        let found = if found.is_absolute() {
            found
        } else {
            path.join(found)
        };
        if found.exists() {
            return Some(name.to_owned());
        }
    }
    None
}

fn has_work(work: &WorktreeWork) -> bool {
    work.changed + work.untracked + work.ahead > 0 || work.operation.is_some()
}

fn work_sentence(branch: &str, work: &WorktreeWork, target: Option<&str>) -> String {
    let operation = work
        .operation
        .as_deref()
        .map(|name| format!(", and a {name} stopped halfway"))
        .unwrap_or_default();
    format!(
        "{branch} holds {} uncommitted files, {} new files and {} commits that {} lacks{operation}. Remove it with force to lose that.",
        work.changed,
        work.untracked,
        work.ahead,
        target.unwrap_or("no other branch")
    )
}

fn branch_to_delete(
    entry: Option<&WorktreeEntry>,
    record: Option<&WorktreeRecord>,
    keep_branch: Option<bool>,
) -> Option<String> {
    if keep_branch == Some(true) {
        return None;
    }
    if let Some(record) = record
        && (record.branch_made || keep_branch == Some(false))
    {
        return (entry.is_none()
            || entry.and_then(|entry| entry.branch.as_deref()) == Some(record.branch.as_str()))
        .then(|| record.branch.clone());
    }
    (keep_branch == Some(false))
        .then(|| entry.and_then(|entry| entry.branch.clone()))
        .flatten()
}

async fn resolve_base(cwd: &Path) -> Option<String> {
    if let Ok(value) = git_output(
        cwd,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_owned());
        }
    }
    for candidate in ["origin/main", "origin/master", "main", "master"] {
        if git_status(cwd, &["rev-parse", "--verify", "--quiet", candidate])
            .await
            .ok()
            .is_some_and(|value| value.0 == 0)
        {
            return Some(candidate.to_owned());
        }
    }
    None
}

fn action_arguments(payload: &Value, kind: &str) -> Result<Vec<String>, RpcError> {
    let required = |name: &str| {
        payload
            .get(name)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .ok_or_else(|| RpcError::new("bad-request", format!("{kind} needs {name}.")))
    };
    Ok(match kind {
        "fetch" => vec!["fetch".into(), "--prune".into(), "--progress".into()],
        "pull" => vec!["pull".into(), "--ff-only".into(), "--progress".into()],
        "push" | "sync" => vec!["push".into(), "--progress".into()],
        "publish" => vec![
            "push".into(),
            "--progress".into(),
            "--set-upstream".into(),
            "origin".into(),
        ],
        "force-push" => vec!["push".into(), "--force-with-lease".into()],
        "checkout" => vec!["checkout".into(), required("ref")?],
        "create-branch" => vec![
            "checkout".into(),
            "-b".into(),
            required("name")?,
            payload
                .get("ref")
                .and_then(Value::as_str)
                .unwrap_or("HEAD")
                .into(),
        ],
        "rename-branch" => vec!["branch".into(), "-m".into(), required("name")?],
        "delete-branch" => vec![
            "branch".into(),
            if payload.get("force").and_then(Value::as_bool) == Some(true) {
                "-D".into()
            } else {
                "-d".into()
            },
            required("ref")?,
        ],
        "merge" => vec!["merge".into(), "--no-edit".into(), required("ref")?],
        "rebase" => vec!["rebase".into(), required("ref")?],
        "stash" => vec![
            "stash".into(),
            "push".into(),
            "--include-untracked".into(),
            "--message".into(),
            payload
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or("Ruimte stash")
                .into(),
        ],
        "stash-pop" => vec![
            "stash".into(),
            "pop".into(),
            payload
                .get("ref")
                .and_then(Value::as_str)
                .unwrap_or("stash@{0}")
                .into(),
        ],
        "commit" | "commit-push" => {
            let mut args = vec!["commit".into(), "--message".into(), required("subject")?];
            if let Some(body) = payload
                .get("body")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                args.extend(["--message".into(), body.into()]);
            }
            args
        }
        "create-pr" => vec![
            "pr".into(),
            "create".into(),
            "--title".into(),
            required("subject")?,
            "--body".into(),
            payload
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        ],
        _ => return Err(RpcError::new("bad-request", "Unknown git action.")),
    })
}

fn action_phase(kind: &str) -> &str {
    match kind {
        "fetch" => "fetch",
        "pull" => "pull",
        "push" | "publish" | "force-push" => "push",
        "checkout" | "create-branch" | "rename-branch" | "delete-branch" => "branch",
        "merge" => "merge",
        "rebase" => "rebase",
        "stash" | "stash-pop" => "stash",
        "commit" | "commit-push" => "commit",
        _ => "start",
    }
}
fn action_summary(kind: &str, payload: &Value) -> String {
    match kind {
        "commit" | "commit-push" => format!(
            "Committed {}.",
            payload
                .get("subject")
                .and_then(Value::as_str)
                .unwrap_or("changes")
        ),
        _ => format!("{} finished.", kind.replace('-', " ")),
    }
}

async fn run_cancelable(
    program: &str,
    arguments: &[String],
    cwd: &Path,
    token: &CancellationToken,
) -> Result<String, RpcError> {
    let child = Command::new(program)
        .args(arguments)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| RpcError::new("git-failed", error.to_string()))?;
    tokio::select! {
        output = child.wait_with_output() => { let output = output.map_err(io_error)?; let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)).trim().to_owned(); if output.status.success() { Ok(text) } else { Err(RpcError::new("git-failed", if text.is_empty() { "git failed".to_owned() } else { text })) } }
        _ = token.cancelled() => Err(RpcError::new("git-failed", "The git action was canceled."))
    }
}

async fn git_output(cwd: &Path, arguments: &[&str]) -> Result<String, RpcError> {
    let owned = arguments
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    git_owned(cwd, &owned).await
}
async fn git_owned(cwd: &Path, arguments: &[String]) -> Result<String, RpcError> {
    let (code, stdout, stderr) = git_status_owned(cwd, arguments).await?;
    if code == 0 {
        Ok(stdout)
    } else {
        Err(RpcError::new(
            "git-failed",
            if stderr.trim().is_empty() {
                format!(
                    "git {} failed",
                    arguments.first().map(String::as_str).unwrap_or("command")
                )
            } else {
                stderr.trim().to_owned()
            },
        ))
    }
}
async fn git_status(cwd: &Path, arguments: &[&str]) -> Result<(i32, String, String), RpcError> {
    let owned = arguments
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    git_status_owned(cwd, &owned).await
}
async fn git_status_owned(
    cwd: &Path,
    arguments: &[String],
) -> Result<(i32, String, String), RpcError> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|error| RpcError::new("git-failed", error.to_string()))?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

async fn git_status_env(
    cwd: &Path,
    arguments: &[&str],
    key: &str,
    value: &Path,
) -> Result<(i32, String, String), RpcError> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env(key, value)
        .output()
        .await
        .map_err(|error| RpcError::new("git-failed", error.to_string()))?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}
async fn command_exists(program: &str) -> bool {
    command_exists_with_env(program, &[]).await
}

async fn command_exists_with_env(program: &str, environment: &[(String, String)]) -> bool {
    let mut command = Command::new(program);
    command
        .arg("--version")
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for key in [
        "RUIMTE_HOOK_URL",
        "RUIMTE_HOOK_TOKEN",
        "RUIMTE_CONTEXT_URL",
        "RUIMTE_CONTEXT_TOKEN",
        "RUIMTE_SESSION_ID",
    ] {
        command.env_remove(key);
    }
    command
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}
fn same_path(left: &Path, right: &Path) -> bool {
    left.canonicalize().unwrap_or_else(|_| left.to_path_buf())
        == right.canonicalize().unwrap_or_else(|_| right.to_path_buf())
}

fn worktree_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

async fn create_symlink(source: PathBuf, target: PathBuf) -> Result<(), RpcError> {
    tokio::task::spawn_blocking(move || {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source, target)
        }
        #[cfg(windows)]
        {
            if source.is_dir() {
                std::os::windows::fs::symlink_dir(source, target)
            } else {
                std::os::windows::fs::symlink_file(source, target)
            }
        }
    })
    .await
    .map_err(|error| RpcError::new("worktree-share-failed", error.to_string()))?
    .map_err(|error| RpcError::new("worktree-share-failed", error.to_string()))
}

#[cfg(test)]
mod message_tests {
    use super::*;

    #[test]
    fn commit_message_prompt_and_parser_match_the_wire_shape() {
        let prompt = build_message_prompt("M\tsrc/a.rs", "+one\n");
        assert!(prompt.contains("{\"subject\": \"...\", \"body\": \"...\"}"));
        assert!(prompt.contains("M\tsrc/a.rs"));
        assert_eq!(
            parse_suggestion(
                "Reading the patch.\n{\"subject\":\"fix: keep state\",\"body\":\"Because it matters.\\n\"}\nDone."
            ),
            Some((
                "fix: keep state".to_owned(),
                "Because it matters.".to_owned()
            ))
        );
        assert_eq!(
            parse_suggestion("chore: bump deps\n"),
            Some(("chore: bump deps".to_owned(), String::new()))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn one_shot_provider_bounds_io_clears_agent_env_and_kills_its_group() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = tempfile::tempdir().unwrap();
        let repository = temporary.path().join("repo");
        tokio::fs::create_dir(&repository).await.unwrap();
        for arguments in [
            vec!["init", "--quiet"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
        ] {
            assert!(
                Command::new("git")
                    .args(arguments)
                    .current_dir(&repository)
                    .status()
                    .await
                    .unwrap()
                    .success()
            );
        }
        tokio::fs::write(
            repository.join("change.txt"),
            "staged line\n".repeat(100_000),
        )
        .await
        .unwrap();
        assert!(
            Command::new("git")
                .args(["add", "change.txt"])
                .current_dir(&repository)
                .status()
                .await
                .unwrap()
                .success()
        );

        let provider = temporary.path().join("fake-provider");
        tokio::fs::write(
            &provider,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\nfor key in RUIMTE_HOOK_URL RUIMTE_HOOK_TOKEN RUIMTE_CONTEXT_URL RUIMTE_CONTEXT_TOKEN RUIMTE_SESSION_ID; do eval \"value=\\${$key}\"; [ -z \"$value\" ] || exit 9; done\n[ \"${#2}\" -lt 30000 ] || exit 8\nhead -c 131072 /dev/zero | tr '\\000' x >&2\nprintf '%s\\n' '{\"subject\":\"feat: add staged change\",\"body\":\"\"}'\n",
        )
        .await
        .unwrap();
        std::fs::set_permissions(&provider, std::fs::Permissions::from_mode(0o700)).unwrap();
        let providers = vec![OneShotProvider {
            kind: "claude",
            name: "Fake Claude",
            command: provider.to_string_lossy().into_owned(),
            environment: [
                "RUIMTE_HOOK_URL",
                "RUIMTE_HOOK_TOKEN",
                "RUIMTE_CONTEXT_URL",
                "RUIMTE_CONTEXT_TOKEN",
                "RUIMTE_SESSION_ID",
            ]
            .into_iter()
            .map(|key| (key.to_owned(), "canary-secret".to_owned()))
            .chain(std::iter::once((
                "PID_FILE".to_owned(),
                temporary
                    .path()
                    .join("descendant.pid")
                    .to_string_lossy()
                    .into_owned(),
            )))
            .collect(),
        }];
        let payload = json!({
            "cwd": repository,
            "actionId": "message-1",
            "provider": "claude"
        });
        let result = suggest_message_with(
            &payload,
            &CancellationToken::new(),
            &providers,
            std::time::Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert_eq!(result["subject"], "feat: add staged change");
        assert_eq!(result["body"], "");

        tokio::fs::write(
            &provider,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then exit 0; fi\ntrap '' TERM\n( trap '' TERM; while :; do sleep 1; done ) &\necho $! > \"$PID_FILE\"\nwait\n",
        )
        .await
        .unwrap();
        let token = CancellationToken::new();
        let cancel = token.clone();
        let descendant_pid = temporary.path().join("descendant.pid");
        let wait_for_pid = descendant_pid.clone();
        tokio::spawn(async move {
            while !wait_for_pid.exists() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            cancel.cancel();
        });
        let error = suggest_message_with(
            &payload,
            &token,
            &providers,
            std::time::Duration::from_secs(2),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "git-failed");
        assert_eq!(error.message, "The git action was canceled.");
        let descendant = tokio::fs::read_to_string(descendant_pid)
            .await
            .unwrap()
            .trim()
            .parse::<i32>()
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while unsafe { libc::kill(descendant, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("provider descendant exited with its process group");
    }
}
