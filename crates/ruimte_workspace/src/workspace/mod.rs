#![allow(clippy::collapsible_if)]

mod canvas;
mod context;
mod diagram_layout;
mod filesystem;
mod fork_host;
mod git;
mod graphics;
mod notice_store;
mod outbox_store;
mod plan_store;
mod plans;
mod project;
mod prompt_store;
mod util;
mod views;
mod workflow;
mod workflow_coordinator;
mod workflow_store;

#[cfg(test)]
mod tests;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use serde_json::Value;

use crate::{
    chat::{ChatContextHost, ChatLaunchFacts, ChatTurnContext},
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
    runtime::{RuntimeAuthority, RuntimeFactSink, RuntimeHost},
};

pub use crate::ResolvedAsset;
pub use canvas::CanvasRefusal;
use context::ContextStore;
use filesystem::FileSystem;
use git::GitService;
use project::ProjectStore;
use views::ViewStores;
use workflow_coordinator::WorkflowCoordinator;
use workflow_store::WorkflowStore;

#[derive(Clone, Debug)]
pub struct KnownProject {
    pub project_id: String,
    pub name: String,
    pub folder: Option<String>,
}

#[derive(Clone)]
pub struct WorkspaceService {
    inner: Arc<WorkspaceInner>,
}

struct WorkspaceInner {
    projects: Arc<ProjectStore>,
    views: Arc<ViewStores>,
    filesystem: FileSystem,
    git: GitService,
    workflow: WorkflowStore,
    coordinator: Arc<WorkflowCoordinator>,
    context: ContextStore,
}

impl WorkspaceService {
    pub async fn new(home: PathBuf, events: EventBus) -> anyhow::Result<Self> {
        tokio::fs::create_dir_all(&home).await?;
        let projects = Arc::new(ProjectStore::new(home.clone(), events.clone()));
        let views = Arc::new(ViewStores::new(projects.clone(), events.clone()));
        let workflow = WorkflowStore::new(home.clone(), events.clone()).await?;
        let context = ContextStore::new(
            projects.clone(),
            views.clone(),
            workflow.clone(),
            workflow.plans().clone(),
        );
        let coordinator = WorkflowCoordinator::new(projects.clone(), workflow.clone());
        Ok(Self {
            inner: Arc::new(WorkspaceInner {
                views,
                filesystem: FileSystem::new(events.clone(), projects.clone()),
                git: GitService::new(home.clone(), events.clone(), projects.clone()),
                workflow,
                coordinator,
                context,
                projects,
            }),
        })
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        if let Some(result) = self
            .inner
            .projects
            .dispatch(method, payload.clone(), context)
            .await
        {
            if result.is_ok()
                && matches!(method, "project.open" | "project.save" | "project.delete")
                && let Some(project_id) = payload.get("projectId").and_then(Value::as_str)
            {
                if let Err(error) = self.refresh_places(project_id).await {
                    eprintln!("Pruning project state for {project_id} failed: {error}");
                }
            }
            if result.is_ok()
                && matches!(
                    method,
                    "project.close" | "project.release" | "project.delete"
                )
            {
                if let Some(project_id) = payload.get("projectId").and_then(Value::as_str) {
                    self.inner.views.close_project(project_id).await;
                }
            }
            return Some(result);
        }
        if let Some(result) = self.inner.views.dispatch(method, payload.clone()).await {
            return Some(result);
        }
        if let Some(result) = self
            .inner
            .filesystem
            .dispatch(method, payload.clone(), context)
            .await
        {
            return Some(result);
        }
        if let Some(result) = self.inner.workflow.dispatch(method, payload.clone()).await {
            return Some(result);
        }
        if method == "git.worktree-merge"
            && let Err(error) = self.guard_person_worktree_merge(&payload).await
        {
            return Some(Err(error));
        }
        self.inner.git.dispatch(method, payload, context).await
    }

    pub async fn detach(&self, client_id: &str) {
        self.inner.projects.detach(client_id).await;
        self.inner.filesystem.detach(client_id).await;
        self.inner.git.detach(client_id).await;
    }

    pub async fn shutdown(&self) {
        self.inner.projects.shutdown().await;
        self.inner.views.shutdown().await;
        self.inner.filesystem.shutdown().await;
        self.inner.git.shutdown().await;
        self.inner.coordinator.shutdown().await;
    }

    pub async fn known_projects(&self) -> Result<Vec<KnownProject>, RpcError> {
        Ok(self
            .inner
            .projects
            .known_projects()
            .await?
            .into_iter()
            .map(|(project_id, name, folder)| KnownProject {
                project_id,
                name,
                folder: folder.map(|path| path.to_string_lossy().into_owned()),
            })
            .collect())
    }

    pub async fn read_project(&self, project_id: &str) -> Result<Value, RpcError> {
        self.inner.projects.read_project(project_id).await
    }

    pub async fn mutate_project<T, F>(
        &self,
        project_id: &str,
        change: F,
    ) -> Result<(u64, T), RpcError>
    where
        F: FnOnce(&mut Value) -> Result<T, RpcError>,
    {
        let result = self
            .inner
            .projects
            .mutate_project(project_id, change)
            .await?;
        self.refresh_places(project_id).await?;
        Ok(result)
    }

    async fn refresh_places(&self, project_id: &str) -> Result<Vec<String>, RpcError> {
        let existing_ids = self
            .inner
            .projects
            .read_project(project_id)
            .await
            .map(|content| project_ids(&content))
            .unwrap_or_default();
        self.inner
            .coordinator
            .places_changed(project_id, &existing_ids)
            .await?;
        let (forks, cancelled) = self
            .inner
            .workflow
            .prune_project(project_id, &existing_ids)
            .await?;
        self.inner.coordinator.tasks_cancelled(&cancelled).await;
        for fork_id in &forks {
            if let Err(error) = self.inner.context.drop_unspoken_fork(fork_id).await {
                eprintln!("Removing unused fork {fork_id} failed: {error}");
            }
        }
        Ok(forks)
    }

    pub async fn locate(&self, node_id: &str) -> Option<Value> {
        self.inner.projects.locate(node_id).await
    }

    pub async fn sources_for(&self, node_id: &str) -> Vec<Value> {
        self.inner.projects.sources_for(node_id).await
    }

    pub async fn title_for(&self, node_id: &str) -> Option<String> {
        self.inner.projects.title_for(node_id).await
    }

    pub async fn read_drawing(
        &self,
        project_id: &str,
        view_id: &str,
    ) -> Result<Option<Value>, RpcError> {
        self.inner.views.read_drawing(project_id, view_id).await
    }

    pub async fn read_diagram(
        &self,
        project_id: &str,
        view_id: &str,
    ) -> Result<Option<Value>, RpcError> {
        self.inner.views.read_diagram(project_id, view_id).await
    }

    pub async fn resolve_file_media(&self, path: &Path) -> Result<Option<ResolvedAsset>, RpcError> {
        self.inner.filesystem.resolve_file_media(path).await
    }

    pub async fn resolve_project_icon(
        &self,
        project_id: &str,
        theme: Option<&str>,
    ) -> Result<Option<ResolvedAsset>, RpcError> {
        self.inner
            .filesystem
            .resolve_project_icon(project_id, theme.unwrap_or("light"))
            .await
    }

    pub fn install_runtime_host(&self, runtime: Arc<dyn RuntimeHost>) {
        self.inner.context.install_runtime(runtime.clone());
        self.inner.coordinator.install_runtime(runtime);
    }

    pub fn runtime_fact_sink(&self) -> Arc<dyn RuntimeFactSink> {
        self.inner.coordinator.clone()
    }

    pub async fn runtime_authority(
        &self,
        bearer: &str,
    ) -> Result<Option<RuntimeAuthority>, RpcError> {
        self.inner.context.authority_for_bearer(bearer).await
    }

    pub async fn context_list(&self, authority: &RuntimeAuthority) -> Vec<Value> {
        self.inner.context.list(&authority.identity.node_id).await
    }

    pub async fn take_terminal_turn_context(
        &self,
        node_id: &str,
    ) -> Result<ChatTurnContext, RpcError> {
        let change_note = self.inner.context.change_since(node_id).await;
        let notices = self
            .inner
            .workflow
            .notices()
            .take(node_id)
            .await?
            .iter()
            .map(notice_store::NoticeStore::render)
            .collect();
        Ok(ChatTurnContext {
            change_note,
            notices,
        })
    }

    pub async fn context_read(
        &self,
        authority: &RuntimeAuthority,
        source_id: &str,
        tail: Option<usize>,
        subagent: Option<&str>,
    ) -> Result<Option<String>, RpcError> {
        self.inner
            .context
            .read(authority, source_id, tail, subagent)
            .await
    }

    async fn guard_person_worktree_merge(&self, payload: &Value) -> Result<(), RpcError> {
        let repo = payload
            .get("repo")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("invalid-request", "Missing repo"))?;
        let path = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("invalid-request", "Missing path"))?;
        let source = tokio::fs::canonicalize(path)
            .await
            .unwrap_or_else(|_| PathBuf::from(path));
        let mut ids = HashSet::new();
        for worktree in self.inner.git.canvas_worktrees(Path::new(repo)).await? {
            let worktree_path = worktree["path"].as_str().map(PathBuf::from);
            let worktree_path = match worktree_path {
                Some(path) => tokio::fs::canonicalize(&path).await.unwrap_or(path),
                None => continue,
            };
            if worktree_path == source
                && let Some(node_id) = worktree["nodeId"].as_str()
            {
                ids.insert(node_id.to_owned());
            }
        }
        for project in self.inner.projects.known_projects().await? {
            let Ok(content) = self.inner.projects.read_project(&project.0).await else {
                continue;
            };
            for node in content["views"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|view| view["nodes"].as_array().into_iter().flatten())
            {
                if !matches!(node["kind"].as_str(), Some("chat" | "terminal")) {
                    continue;
                }
                let Some(cwd) = node["cwd"].as_str() else {
                    continue;
                };
                let cwd = tokio::fs::canonicalize(cwd)
                    .await
                    .unwrap_or_else(|_| PathBuf::from(cwd));
                if cwd.starts_with(&source)
                    && let Some(node_id) = node["id"].as_str()
                {
                    ids.insert(node_id.to_owned());
                }
            }
        }
        let ids = ids.into_iter().collect::<Vec<_>>();
        let states = self.inner.coordinator.runtime_node_states(&ids).await?;
        let working = states.iter().filter(|state| state.working).count();
        let stop_agent = payload.get("stopAgent").and_then(Value::as_bool) == Some(true);
        if working > 0 && !stop_agent {
            return Err(RpcError::new(
                "agent-working",
                format!(
                    "{working} {} still working in this worktree. Stop {} first.",
                    if working == 1 {
                        "agent is"
                    } else {
                        "agents are"
                    },
                    if working == 1 { "it" } else { "them" }
                ),
            ));
        }
        if stop_agent {
            for state in states.into_iter().filter(|state| state.live) {
                self.inner.coordinator.stop_runtime_node(&state.id).await?;
            }
        }
        Ok(())
    }
}

#[async_trait]
impl ChatContextHost for WorkspaceService {
    async fn launch_facts(&self, chat_id: &str) -> Result<ChatLaunchFacts, RpcError> {
        Ok(ChatLaunchFacts {
            has_context: self.inner.context.has(chat_id).await,
            depth: self.inner.workflow.depth_of(chat_id).await as u32,
        })
    }

    async fn take_turn_context(&self, chat_id: &str) -> Result<ChatTurnContext, RpcError> {
        let change_note = self.inner.context.change_since(chat_id).await;
        let notices = self
            .inner
            .workflow
            .notices()
            .take(chat_id)
            .await?
            .iter()
            .map(notice_store::NoticeStore::render)
            .collect();
        Ok(ChatTurnContext {
            change_note,
            notices,
        })
    }

    async fn stop_child(&self, node_id: &str, reason: &str) -> Result<(), RpcError> {
        self.inner.coordinator.stop_child(node_id, reason).await
    }

    async fn owe_interrupted_run(
        &self,
        chat_id: &str,
        turn_id: &str,
        attempt: u32,
        created_at: u64,
    ) -> Result<bool, RpcError> {
        self.inner
            .coordinator
            .owe_interrupted_run(chat_id, turn_id, attempt, created_at)
            .await
    }
}

fn project_ids(content: &Value) -> HashSet<String> {
    let mut ids = HashSet::new();
    for view in content["views"].as_array().into_iter().flatten() {
        if let Some(id) = view["id"].as_str() {
            ids.insert(id.to_owned());
        }
        for node in view["nodes"].as_array().into_iter().flatten() {
            if let Some(id) = node["id"].as_str() {
                ids.insert(id.to_owned());
            }
        }
    }
    ids
}
