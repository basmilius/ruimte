#![allow(
    clippy::collapsible_if,
    clippy::map_identity,
    clippy::unnecessary_lazy_evaluations
)]

use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use base64::Engine;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::{fs, sync::Mutex};

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
};

use super::util::{
    encode_component, io_error, now_ms, read_optional, string_field, u64_field, write_atomic,
    write_atomic_mode,
};

const DEFAULT_COLOR: &str = "#7c74ff";
const ICON_MAX_BYTES: usize = 256 * 1024;
const ICON_CANDIDATES: &[&str] = &[
    ".ruimte/icon.svg",
    ".ruimte/icon.png",
    ".ruimte/icon.jpg",
    ".ruimte/icon.jpeg",
    ".ruimte/icon.gif",
    ".ruimte/icon.webp",
    ".idea/icon.svg",
    ".idea/icon.png",
    ".vscode/icon.svg",
    ".vscode/icon.png",
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "public/icon.svg",
    "public/icon.png",
    "app/favicon.ico",
    "app/icon.svg",
    "app/icon.png",
    "src/favicon.svg",
    "src/favicon.ico",
    "src/app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "assets/icon.svg",
    "assets/icon.png",
    "assets/logo.svg",
    "assets/logo.png",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    project_id: String,
    name: String,
    color: String,
    folder: Option<PathBuf>,
    last_opened_at: u64,
    #[serde(default)]
    closed_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<Value>,
}

#[derive(Default, Deserialize, Serialize)]
struct Registry {
    projects: Vec<RegistryEntry>,
}

struct OpenProject {
    rev: u64,
    folder: Option<PathBuf>,
    last_text: String,
}

#[derive(Default)]
struct State {
    registry: Option<Vec<RegistryEntry>>,
    open: HashMap<String, OpenProject>,
    viewers: HashMap<String, HashSet<String>>,
    clients: HashSet<String>,
}

pub struct ProjectStore {
    home: PathBuf,
    events: EventBus,
    state: std::sync::Arc<Mutex<State>>,
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    mutation_locks: Mutex<HashMap<String, std::sync::Arc<Mutex<()>>>>,
    registry_write: Mutex<()>,
}

impl ProjectStore {
    pub fn new(home: PathBuf, events: EventBus) -> Self {
        Self {
            home,
            events,
            state: std::sync::Arc::new(Mutex::new(State::default())),
            watchers: Mutex::new(HashMap::new()),
            mutation_locks: Mutex::new(HashMap::new()),
            registry_write: Mutex::new(()),
        }
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        if !method.starts_with("project.") {
            return None;
        }
        self.state
            .lock()
            .await
            .clients
            .insert(context.client_id.clone());
        Some(match method {
            "project.list" => self.list().await,
            "project.open" => self.open(payload, context).await,
            "project.save" => self.save(payload, context).await,
            "project.save-local" => self.save_local(payload).await,
            "project.close" => self.close(payload, context).await,
            "project.release" => self.release(payload, context).await,
            "project.delete" => self.delete(payload).await,
            "project.setIdentity" => self.set_identity(payload).await,
            "project.setIcon" => self.set_icon(payload).await,
            "project.settings" => self.settings(payload).await,
            "project.settings-update" => self.update_settings(payload).await,
            _ => return None,
        })
    }

    pub async fn detach(&self, client_id: &str) {
        let mut state = self.state.lock().await;
        state.viewers.remove(client_id);
        state.clients.remove(client_id);
    }

    pub async fn shutdown(&self) {
        self.watchers.lock().await.clear();
        self.state.lock().await.open.clear();
    }

    pub async fn project_place(&self, project_id: &str) -> Result<(PathBuf, Value), RpcError> {
        let entry = {
            let mut state = self.state.lock().await;
            self.ensure_registry(&mut state).await?;
            require_entry(&state, project_id)?.clone()
        };
        let path = self.document_path(&entry);
        let document = read_document(&path, false).await?.ok_or_else(|| {
            RpcError::new(
                "project-missing",
                format!(
                    "The project file of {} is missing from {}",
                    entry.name,
                    path.display()
                ),
            )
        })?;
        Ok((path, document))
    }

    pub async fn known_projects(&self) -> Result<Vec<(String, String, Option<PathBuf>)>, RpcError> {
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        Ok(state
            .registry
            .as_ref()
            .into_iter()
            .flatten()
            .map(|entry| {
                (
                    entry.project_id.clone(),
                    entry.name.clone(),
                    entry.folder.clone(),
                )
            })
            .collect())
    }

    pub async fn read_project(&self, project_id: &str) -> Result<Value, RpcError> {
        let (path, mut document) = self.project_place(project_id).await?;
        let folder = path
            .parent()
            .and_then(Path::parent)
            .filter(|_| path.ends_with(".ruimte/project.json"));
        make_daemon_side(&mut document, folder);
        Ok(document)
    }

    pub async fn mutate_project<T, F>(
        &self,
        project_id: &str,
        change: F,
    ) -> Result<(u64, T), RpcError>
    where
        F: FnOnce(&mut Value) -> Result<T, RpcError>,
    {
        let project_lock = self.project_lock(project_id).await;
        let _mutation = project_lock.lock().await;
        let entry = {
            let mut state = self.state.lock().await;
            self.ensure_registry(&mut state).await?;
            require_entry(&state, project_id)?.clone()
        };
        let path = self.document_path(&entry);
        let mut document = read_document(&path, false).await?.ok_or_else(|| {
            RpcError::new(
                "project-missing",
                format!("The project file of {} is missing", entry.name),
            )
        })?;
        let previous = document.clone();
        make_daemon_side(&mut document, entry.folder.as_deref());
        let result = change(&mut document)?;
        validate_content(&document)?;
        let rev = document.get("rev").and_then(Value::as_u64).unwrap_or(0) + 1;
        document
            .as_object_mut()
            .unwrap()
            .insert("version".to_owned(), json!(2));
        document
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(rev));
        make_portable(&mut document, entry.folder.as_deref());
        unwrap_unknown_entries(&mut document);
        write_json(&path, &document).await?;
        remove_view_orphans(&path, &previous, &document).await;
        let mut wire = document;
        wrap_unknown_entries(&mut wire);
        {
            let _registry = self.registry_write.lock().await;
            let mut state = self.state.lock().await;
            if let Some(open) = state.open.get_mut(project_id) {
                open.rev = rev;
                open.last_text = serde_json::to_string(&wire).unwrap_or_default();
            }
            if let Some(saved) = state.registry.as_mut().and_then(|entries| {
                entries
                    .iter_mut()
                    .find(|entry| entry.project_id == project_id)
            }) {
                saved.name = string_member(&wire, "name")?;
                saved.color = wire
                    .get("color")
                    .and_then(Value::as_str)
                    .unwrap_or(DEFAULT_COLOR)
                    .to_owned();
                saved.icon = wire.get("icon").cloned();
            }
            let registry = state.registry.clone().unwrap_or_default();
            drop(state);
            self.save_registry(&registry).await?;
        }
        make_daemon_side(&mut wire, entry.folder.as_deref());
        self.events.broadcast(
            "project.changed",
            json!({ "projectId": project_id, "document": wire }),
        );
        Ok((rev, result))
    }

    pub async fn locate(&self, id: &str) -> Option<Value> {
        for (project_id, folder, document) in self.all_documents().await {
            for view in document
                .get("views")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if matches!(
                    view.get("kind").and_then(Value::as_str),
                    Some("chat" | "terminal" | "browser" | "device")
                ) && view.get("id").and_then(Value::as_str) == Some(id)
                {
                    return Some(json!({
                        "projectId": project_id,
                        "folder": folder,
                        "canvasId": null,
                        "kind": view.get("kind")
                    }));
                }
                if view.get("kind").and_then(Value::as_str) == Some("canvas")
                    && let Some(node) = view
                        .get("nodes")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .find(|node| node.get("id").and_then(Value::as_str) == Some(id))
                {
                    return Some(json!({
                        "projectId": project_id,
                        "folder": folder,
                        "canvasId": view.get("id"),
                        "kind": node.get("kind")
                    }));
                }
            }
        }
        None
    }

    pub async fn title_for(&self, id: &str) -> Option<String> {
        for (_, _, document) in self.all_documents().await {
            for view in document
                .get("views")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if view.get("id").and_then(Value::as_str) == Some(id) {
                    return view
                        .get("name")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
                if let Some(node) = view
                    .get("nodes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .find(|node| node.get("id").and_then(Value::as_str) == Some(id))
                {
                    return node
                        .get("title")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
            }
        }
        None
    }

    pub async fn sources_for(&self, target_id: &str) -> Vec<Value> {
        let mut sources = Vec::new();
        for (_, folder, document) in self.all_documents().await {
            for view in document
                .get("views")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|view| view.get("kind").and_then(Value::as_str) == Some("canvas"))
            {
                let nodes = view
                    .get("nodes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|node| node.get("id").and_then(Value::as_str).map(|id| (id, node)))
                    .collect::<HashMap<_, _>>();
                let texts = view
                    .get("texts")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|text| text.get("id").and_then(Value::as_str).map(|id| (id, text)))
                    .collect::<HashMap<_, _>>();
                for edge in view
                    .get("edges")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|edge| edge.get("to").and_then(Value::as_str) == Some(target_id))
                {
                    let Some(from) = edge.get("from").and_then(Value::as_str) else {
                        continue;
                    };
                    if let Some(text) = texts.get(from) {
                        let body = text.get("text").and_then(Value::as_str).unwrap_or_default();
                        let title = body
                            .lines()
                            .next()
                            .unwrap_or("Text")
                            .trim()
                            .chars()
                            .take(60)
                            .collect::<String>();
                        sources.push(json!({ "id": from, "kind": "text", "title": if title.is_empty() { "Text" } else { &title }, "text": body }));
                    } else if let Some(node) = nodes.get(from) {
                        let kind = node.get("kind").and_then(Value::as_str).unwrap_or_default();
                        let title = node
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        match kind {
                            "terminal" | "chat" => sources.push(json!({ "id": from, "kind": kind, "title": title })),
                            "note" => sources.push(json!({ "id": from, "kind": "text", "title": title, "text": node.get("body").and_then(Value::as_str).unwrap_or_default() })),
                            "drawing" | "diagram" if node.get("viewId").and_then(Value::as_str).is_some() => sources.push(json!({ "id": node["viewId"], "kind": kind, "title": title, "nodeId": from })),
                            "file" if node.get("path").and_then(Value::as_str).is_some() => {
                                let stored = node["path"].as_str().unwrap();
                                let resolved = folder.as_ref().filter(|_| !Path::new(stored).is_absolute()).map(|folder| folder.join(stored).to_string_lossy().to_string()).unwrap_or_else(|| stored.to_owned());
                                sources.push(json!({ "id": from, "kind": "file", "title": title, "text": resolved }));
                            }
                            "browser" if node.get("url").and_then(Value::as_str).is_some() => sources.push(json!({ "id": from, "kind": "text", "title": title, "text": node["url"] })),
                            _ => {}
                        }
                    }
                }
            }
        }
        sources
    }

    async fn all_documents(&self) -> Vec<(String, Option<PathBuf>, Value)> {
        let mut state = self.state.lock().await;
        if self.ensure_registry(&mut state).await.is_err() {
            return Vec::new();
        }
        let entries = state.registry.as_ref().unwrap().clone();
        drop(state);
        let mut documents = Vec::new();
        for entry in entries {
            if let Ok(Some(document)) = read_document(&self.document_path(&entry), false).await {
                documents.push((entry.project_id, entry.folder, document));
            }
        }
        documents
    }

    pub async fn icon_file(
        &self,
        project_id: &str,
        theme: &str,
    ) -> Result<Option<(PathBuf, String)>, RpcError> {
        let entry = {
            let mut state = self.state.lock().await;
            self.ensure_registry(&mut state).await?;
            require_entry(&state, project_id)?.clone()
        };
        if entry.icon.is_some() {
            return Ok(None);
        }
        let Some(folder) = entry.folder else {
            return Ok(None);
        };
        Ok(derive_icon(&folder).await.and_then(|icon| {
            if theme == "dark" {
                icon.dark
                    .map(|(path, mime)| (path, mime))
                    .or(Some((icon.path, icon.mime)))
            } else {
                Some((icon.path, icon.mime))
            }
        }))
    }

    pub async fn folder_of(&self, project_id: &str) -> Result<Option<PathBuf>, RpcError> {
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        Ok(require_entry(&state, project_id)?.folder.clone())
    }

    pub async fn show_view(&self, project_id: &str, view_id: &str, by: &str) -> bool {
        let clients = self
            .state
            .lock()
            .await
            .viewers
            .iter()
            .filter(|(_, projects)| projects.contains(project_id))
            .map(|(client_id, _)| client_id.clone())
            .collect::<Vec<_>>();
        let mut delivered = false;
        for client_id in clients {
            delivered |= self.events.send(
                &client_id,
                "project.showView",
                json!({ "projectId": project_id, "viewId": view_id, "by": by }),
            );
        }
        delivered
    }

    async fn list(&self) -> RpcResult {
        let entries = {
            let mut state = self.state.lock().await;
            self.ensure_registry(&mut state).await?;
            state.registry.clone().unwrap_or_default()
        };
        let mut projects = Vec::with_capacity(entries.len());
        for entry in &entries {
            projects.push(self.summary(entry).await);
        }
        Ok(json!({ "projects": projects }))
    }

    async fn open(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        let entries = state.registry.as_ref().unwrap();
        let mut first_open = false;
        let mut entry = if let Some(project_id) = payload.get("projectId").and_then(Value::as_str) {
            entries
                .iter()
                .find(|entry| entry.project_id == project_id)
                .cloned()
                .ok_or_else(|| {
                    RpcError::new("project-not-found", format!("No project {project_id}"))
                })?
        } else if let Some(folder) = payload.get("folder").and_then(Value::as_str) {
            let folder = absolute_path(folder)?;
            if payload.get("createFolder").and_then(Value::as_bool) == Some(true)
                && fs::metadata(&folder).await.is_err()
            {
                fs::create_dir_all(&folder).await.map_err(|error| {
                    RpcError::new(
                        "folder-create-failed",
                        format!("{} could not be created: {error}", folder.display()),
                    )
                })?;
            }
            if !fs::metadata(&folder)
                .await
                .map(|value| value.is_dir())
                .unwrap_or(false)
            {
                return Err(RpcError::new(
                    "folder-not-found",
                    format!("{} is not a folder", folder.display()),
                ));
            }
            if let Some(known) = entries
                .iter()
                .find(|entry| entry.folder.as_ref() == Some(&folder))
            {
                known.clone()
            } else {
                first_open = true;
                RegistryEntry {
                    project_id: random_id(),
                    name: payload
                        .get("name")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| {
                            folder
                                .file_name()
                                .and_then(|name| name.to_str())
                                .unwrap_or("Untitled project")
                                .to_owned()
                        }),
                    color: payload
                        .get("color")
                        .and_then(Value::as_str)
                        .unwrap_or(DEFAULT_COLOR)
                        .to_owned(),
                    folder: Some(folder),
                    last_opened_at: now_ms(),
                    closed_at: None,
                    icon: None,
                }
            }
        } else {
            first_open = true;
            RegistryEntry {
                project_id: random_id(),
                name: payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled project")
                    .to_owned(),
                color: payload
                    .get("color")
                    .and_then(Value::as_str)
                    .unwrap_or(DEFAULT_COLOR)
                    .to_owned(),
                folder: None,
                last_opened_at: now_ms(),
                closed_at: None,
                icon: None,
            }
        };

        let path = self.document_path(&entry);
        let requested_existing = payload.get("projectId").is_some() && entry.folder.is_some();
        let mut document = match read_document(&path, true).await? {
            Some(document) => document,
            None if requested_existing => {
                return Err(RpcError::new(
                    "project-missing",
                    format!(
                        "The project file of {} is missing from {}",
                        entry.name,
                        entry.folder.as_ref().unwrap().display()
                    ),
                ));
            }
            None => {
                if first_open && payload.get("name").is_none() {
                    if let Some(folder) = &entry.folder {
                        if let Some(name) = read_idea_name(folder).await {
                            entry.name = name;
                        }
                    }
                }
                let document = json!({
                    "version": 2,
                    "rev": 0,
                    "name": entry.name,
                    "color": entry.color,
                    "views": [{ "kind": "canvas", "id": "main", "name": "Canvas", "nodes": [], "texts": [], "edges": [], "layouts": [] }]
                });
                write_json(&path, &document).await?;
                document
            }
        };
        entry.name = string_member(&document, "name")?;
        entry.color = document
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or(DEFAULT_COLOR)
            .to_owned();
        entry.icon = document.get("icon").cloned();
        entry.last_opened_at = now_ms();
        entry.closed_at = None;
        let projects = state.registry.as_mut().unwrap();
        projects.retain(|candidate| candidate.project_id != entry.project_id);
        projects.push(entry.clone());
        self.save_registry(projects).await?;
        let rev = document.get("rev").and_then(Value::as_u64).unwrap_or(0);
        state.open.insert(
            entry.project_id.clone(),
            OpenProject {
                rev,
                folder: entry.folder.clone(),
                last_text: serde_json::to_string(&document).unwrap_or_default(),
            },
        );
        state
            .viewers
            .entry(context.client_id.clone())
            .or_default()
            .insert(entry.project_id.clone());
        self.start_project_watcher(entry.project_id.clone(), path.clone())
            .await;
        make_daemon_side(&mut document, entry.folder.as_deref());
        let local = self.read_local(&entry.project_id).await;
        Ok(json!({ "summary": self.summary(&entry).await, "document": document, "local": local }))
    }

    async fn save(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let base_rev = u64_field(&payload, "baseRev")?;
        let mut content = payload
            .get("content")
            .cloned()
            .ok_or_else(|| RpcError::new("bad-request", "Missing content."))?;
        validate_content(&content)?;
        let project_lock = self.project_lock(&project_id).await;
        let _mutation = project_lock.lock().await;
        let (folder, entry) = {
            let state = self.state.lock().await;
            let open = state.open.get(&project_id).ok_or_else(|| {
                RpcError::new(
                    "project-not-found",
                    format!("Project {project_id} is not open"),
                )
            })?;
            if base_rev != open.rev {
                return Err(RpcError::new(
                    "rev-conflict",
                    format!(
                        "The canvas is at rev {}, the save was based on {base_rev}",
                        open.rev
                    ),
                ));
            }
            (
                open.folder.clone(),
                require_entry(&state, &project_id)?.clone(),
            )
        };
        make_portable(&mut content, folder.as_deref());
        let mut document = content;
        document
            .as_object_mut()
            .unwrap()
            .insert("version".to_owned(), json!(2));
        document
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(base_rev + 1));
        unwrap_unknown_entries(&mut document);
        let document_path = self.document_path(&entry);
        let previous = read_document(&document_path, false)
            .await?
            .unwrap_or_else(|| json!({ "views": [] }));
        write_json(&document_path, &document).await?;
        remove_view_orphans(&document_path, &previous, &document).await;
        let mut wire = document.clone();
        wrap_unknown_entries(&mut wire);
        let clients = {
            let _registry = self.registry_write.lock().await;
            let mut state = self.state.lock().await;
            let open = state.open.get_mut(&project_id).ok_or_else(|| {
                RpcError::new(
                    "project-not-found",
                    format!("Project {project_id} is not open"),
                )
            })?;
            open.rev = base_rev + 1;
            open.last_text = serde_json::to_string(&wire).unwrap_or_default();
            if let Some(saved) = state.registry.as_mut().and_then(|projects| {
                projects
                    .iter_mut()
                    .find(|candidate| candidate.project_id == project_id)
            }) {
                saved.name = string_member(&document, "name")?;
                saved.color = document
                    .get("color")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                saved.icon = document.get("icon").cloned();
            }
            let registry = state.registry.clone().unwrap_or_default();
            let clients = state.clients.clone();
            drop(state);
            self.save_registry(&registry).await?;
            clients
        };
        make_daemon_side(&mut wire, folder.as_deref());
        let event = json!({ "projectId": project_id, "document": wire });
        for client_id in clients {
            if client_id != context.client_id {
                self.events
                    .send(&client_id, "project.changed", event.clone());
            }
        }
        Ok(json!({ "rev": base_rev + 1 }))
    }

    async fn save_local(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let local = payload
            .get("local")
            .ok_or_else(|| RpcError::new("bad-request", "Missing local."))?;
        let path = self.local_path(&project_id);
        write_atomic(&path, serde_json::to_vec(local).unwrap().as_slice())
            .await
            .map_err(io_error)?;
        Ok(json!({}))
    }

    async fn close(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        state
            .viewers
            .entry(context.client_id.clone())
            .or_default()
            .remove(&project_id);
        state.open.remove(&project_id);
        self.watchers.lock().await.remove(&project_id);
        let entry = state
            .registry
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
            .ok_or_else(|| {
                RpcError::new("project-not-found", format!("No project {project_id}"))
            })?;
        entry.closed_at = Some(now_ms());
        let summary_entry = entry.clone();
        self.save_registry(state.registry.as_ref().unwrap()).await?;
        self.events.broadcast(
            "project.summary",
            json!({ "summary": self.summary(&summary_entry).await }),
        );
        Ok(json!({}))
    }

    async fn release(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let mut state = self.state.lock().await;
        state
            .viewers
            .entry(context.client_id.clone())
            .or_default()
            .remove(&project_id);
        state.open.remove(&project_id);
        self.watchers.lock().await.remove(&project_id);
        Ok(json!({}))
    }

    async fn delete(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let remove_files = payload
            .get("removeFiles")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        let entry = require_entry(&state, &project_id)?.clone();
        state.open.remove(&project_id);
        self.watchers.lock().await.remove(&project_id);
        state
            .registry
            .as_mut()
            .unwrap()
            .retain(|entry| entry.project_id != project_id);
        self.save_registry(state.registry.as_ref().unwrap()).await?;
        let _ = fs::remove_file(self.local_path(&project_id)).await;
        if remove_files {
            let document = self.document_path(&entry);
            if entry.folder.is_some() {
                let root = document.parent().unwrap();
                let _ = fs::remove_dir_all(root.join("drawings")).await;
                let _ = fs::remove_dir_all(root.join("diagrams")).await;
                let _ = fs::remove_file(&document).await;
                let _ = fs::remove_dir(root).await;
            } else if let Some(parent) = document.parent() {
                let _ = fs::remove_dir_all(parent).await;
            }
        }
        Ok(json!({}))
    }

    async fn set_identity(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        let entry = require_entry(&state, &project_id)?.clone();
        let path = self.document_path(&entry);
        let mut document = read_document(&path, false).await?.ok_or_else(|| {
            RpcError::new(
                "project-missing",
                format!("The project file of {} is missing", entry.name),
            )
        })?;
        let name_changed = payload
            .get("name")
            .is_some_and(|name| document.get("name") != Some(name));
        let icon_changed = payload.get("icon").is_some_and(|icon| {
            if icon.is_null() {
                document.get("icon").is_some()
            } else {
                document.get("icon") != Some(icon)
            }
        });
        if !name_changed && !icon_changed {
            return Ok(json!({ "summary": self.summary(&entry).await }));
        }
        let rev = document.get("rev").and_then(Value::as_u64).unwrap_or(0) + 1;
        if let Some(name) = payload.get("name") {
            document
                .as_object_mut()
                .unwrap()
                .insert("name".to_owned(), name.clone());
        }
        if payload.get("icon").is_some() {
            if payload.get("icon") == Some(&Value::Null) {
                document.as_object_mut().unwrap().remove("icon");
            } else {
                document
                    .as_object_mut()
                    .unwrap()
                    .insert("icon".to_owned(), payload["icon"].clone());
            }
        }
        document
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(rev));
        let mut stored = document.clone();
        unwrap_unknown_entries(&mut stored);
        write_json(&path, &stored).await?;
        let saved = state
            .registry
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry.project_id == project_id)
            .unwrap();
        saved.name = string_member(&document, "name")?;
        saved.icon = document.get("icon").cloned();
        let summary_entry = saved.clone();
        self.save_registry(state.registry.as_ref().unwrap()).await?;
        if let Some(open) = state.open.get_mut(&project_id) {
            open.rev = rev;
            open.last_text = serde_json::to_string(&document).unwrap_or_default();
        }
        let mut wire = document;
        make_daemon_side(&mut wire, entry.folder.as_deref());
        self.events.broadcast(
            "project.changed",
            json!({ "projectId": project_id, "document": wire }),
        );
        let summary = self.summary(&summary_entry).await;
        self.events
            .broadcast("project.summary", json!({ "summary": summary.clone() }));
        Ok(json!({ "summary": summary }))
    }

    async fn set_icon(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let mut state = self.state.lock().await;
        self.ensure_registry(&mut state).await?;
        let entry = require_entry(&state, &project_id)?.clone();
        let folder = entry.folder.as_ref().ok_or_else(|| {
            RpcError::new(
                "bad-icon",
                "A canvas without a folder has nowhere to keep an icon",
            )
        })?;
        let root = folder.join(".ruimte");
        let prepared = if let Some(image) = payload.get("image").filter(|value| !value.is_null()) {
            let raw = image
                .get("base64")
                .and_then(Value::as_str)
                .ok_or_else(|| RpcError::new("bad-icon", "The icon bytes are missing"))?;
            if raw.len().div_ceil(4) * 3 > ICON_MAX_BYTES {
                return Err(RpcError::new(
                    "bad-icon",
                    "That image is larger than 256 KB",
                ));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(raw)
                .map_err(|_| RpcError::new("bad-icon", "The icon is not valid base64"))?;
            if bytes.is_empty() || bytes.len() > ICON_MAX_BYTES {
                return Err(RpcError::new(
                    "bad-icon",
                    "That image is empty or larger than 256 KB",
                ));
            }
            let extension = image_extension(&bytes).ok_or_else(|| {
                RpcError::new(
                    "bad-icon",
                    "That file is not a PNG, JPEG, GIF, WebP or SVG image",
                )
            })?;
            Some((extension, bytes))
        } else {
            None
        };
        if let Some((extension, bytes)) = &prepared {
            write_atomic_mode(&root.join(format!("icon.{extension}")), bytes, 0o644)
                .await
                .map_err(io_error)?;
        }
        for extension in ["png", "jpg", "jpeg", "gif", "webp", "svg"] {
            if prepared.as_ref().is_none_or(|(keep, _)| *keep != extension) {
                let _ = fs::remove_file(root.join(format!("icon.{extension}"))).await;
            }
        }
        let summary = self.summary(&entry).await;
        self.events
            .broadcast("project.summary", json!({ "summary": summary.clone() }));
        Ok(json!({ "summary": summary }))
    }

    async fn settings(&self, payload: Value) -> RpcResult {
        let folder = PathBuf::from(string_field(&payload, "folder")?);
        Ok(read_settings(&folder).await)
    }

    async fn update_settings(&self, payload: Value) -> RpcResult {
        let folder = PathBuf::from(string_field(&payload, "folder")?);
        let patch = payload
            .get("settings")
            .and_then(Value::as_object)
            .ok_or_else(|| RpcError::new("bad-request", "Missing settings."))?;
        let mut raw = read_raw_settings(&folder).await;
        if let Some(worktrees) = patch.get("worktrees").and_then(Value::as_object) {
            let current = raw
                .entry("worktrees".to_owned())
                .or_insert_with(|| json!({}));
            if !current.is_object() {
                *current = json!({});
            }
            if let Some(share) = worktrees.get("share").and_then(Value::as_array) {
                let mut cleaned = Vec::new();
                for item in share {
                    let value = item.as_str().ok_or_else(|| {
                        RpcError::new("bad-share-path", "A shared path must be a string")
                    })?;
                    let normalized = shared_path(value).ok_or_else(|| RpcError::new("bad-share-path", format!("A shared path is relative to the project folder and stays inside it: {value}")))?;
                    if !cleaned.contains(&Value::String(normalized.clone())) {
                        cleaned.push(Value::String(normalized));
                    }
                }
                current
                    .as_object_mut()
                    .unwrap()
                    .insert("share".to_owned(), Value::Array(cleaned));
            }
        }
        let path = folder.join(".ruimte/settings.json");
        let mut bytes = serde_json::to_vec_pretty(&Value::Object(raw)).unwrap();
        bytes.push(b'\n');
        write_atomic_mode(&path, &bytes, 0o644)
            .await
            .map_err(io_error)?;
        Ok(read_settings(&folder).await)
    }

    async fn ensure_registry(&self, state: &mut State) -> Result<(), RpcError> {
        if state.registry.is_some() {
            return Ok(());
        }
        let path = self.home.join("projects.json");
        let registry = read_optional(&path)
            .await
            .map_err(io_error)?
            .and_then(|bytes| serde_json::from_slice::<Registry>(&bytes).ok())
            .unwrap_or_default();
        state.registry = Some(registry.projects);
        Ok(())
    }

    async fn start_project_watcher(&self, project_id: String, path: PathBuf) {
        let Some(parent) = path.parent().map(Path::to_path_buf) else {
            return;
        };
        let state = self.state.clone();
        let events = self.events.clone();
        let runtime = tokio::runtime::Handle::current();
        let watched_path = path.clone();
        let watched_id = project_id.clone();
        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else {
                    return;
                };
                let project_changed = event
                    .paths
                    .iter()
                    .any(|changed| changed.file_name() == watched_path.file_name());
                let icon_changed = event.paths.iter().any(|changed| {
                    changed
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with("icon."))
                });
                if !project_changed && !icon_changed {
                    return;
                }
                let state = state.clone();
                let events = events.clone();
                let path = watched_path.clone();
                let project_id = watched_id.clone();
                runtime.spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    if icon_changed {
                        let entry = {
                            let state = state.lock().await;
                            state
                                .registry
                                .as_ref()
                                .and_then(|entries| {
                                    entries.iter().find(|entry| entry.project_id == project_id)
                                })
                                .cloned()
                        };
                        if let Some(entry) = entry {
                            events.broadcast(
                                "project.summary",
                                json!({ "summary": summary_for(&entry).await }),
                            );
                        }
                    }
                    if !project_changed {
                        return;
                    }
                    let Ok(Some(document)) = read_document(&path, false).await else {
                        return;
                    };
                    let text = serde_json::to_string(&document).unwrap_or_default();
                    let mut state = state.lock().await;
                    let Some(open) = state.open.get_mut(&project_id) else {
                        return;
                    };
                    if open.last_text == text {
                        return;
                    }
                    open.last_text = text;
                    open.rev = document
                        .get("rev")
                        .and_then(Value::as_u64)
                        .unwrap_or(open.rev);
                    drop(state);
                    events.broadcast(
                        "project.changed",
                        json!({ "projectId": project_id, "document": document }),
                    );
                });
            },
            Config::default(),
        );
        let Ok(mut watcher) = watcher else {
            return;
        };
        if watcher.watch(&parent, RecursiveMode::NonRecursive).is_ok() {
            self.watchers.lock().await.insert(project_id, watcher);
        }
    }

    async fn save_registry(&self, projects: &[RegistryEntry]) -> Result<(), RpcError> {
        let mut bytes = serde_json::to_vec_pretty(&Registry {
            projects: projects.to_vec(),
        })
        .unwrap();
        bytes.push(b'\n');
        write_atomic(&self.home.join("projects.json"), &bytes)
            .await
            .map_err(io_error)
    }

    fn document_path(&self, entry: &RegistryEntry) -> PathBuf {
        entry
            .folder
            .as_ref()
            .map(|folder| folder.join(".ruimte/project.json"))
            .unwrap_or_else(|| {
                self.home
                    .join("projects")
                    .join(encode_component(&entry.project_id))
                    .join("project.json")
            })
    }

    fn local_path(&self, project_id: &str) -> PathBuf {
        self.home
            .join("projects")
            .join(format!("{}.local.json", encode_component(project_id)))
    }

    async fn read_local(&self, project_id: &str) -> Value {
        let Some(mut local) = read_optional(&self.local_path(project_id))
            .await
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            return json!({ "activeViewId": null, "views": {} });
        };
        if local.get("activeViewId").is_none() && local.get("focusedNodeId").is_some() {
            let mut migrated = json!({
                "activeViewId": "main",
                "views": { "main": { "camera": null, "focusedNodeId": local.get("focusedNodeId").cloned().unwrap_or(Value::Null) } }
            });
            if let Some(panels) = local.get("panels") {
                migrated
                    .as_object_mut()
                    .unwrap()
                    .insert("panels".to_owned(), panels.clone());
            }
            return migrated;
        }
        if let Some(views) = local.get_mut("views").and_then(Value::as_object_mut) {
            for view in views.values_mut() {
                if view
                    .get("camera")
                    .is_some_and(|camera| camera.get("center").is_none() && !camera.is_null())
                {
                    view.as_object_mut()
                        .unwrap()
                        .insert("camera".to_owned(), Value::Null);
                }
            }
        }
        if local.get("activeViewId").is_none()
            || local.get("views").and_then(Value::as_object).is_none()
        {
            json!({ "activeViewId": null, "views": {} })
        } else {
            local
        }
    }

    async fn summary(&self, entry: &RegistryEntry) -> Value {
        summary_for(entry).await
    }

    async fn project_lock(&self, project_id: &str) -> std::sync::Arc<Mutex<()>> {
        self.mutation_locks
            .lock()
            .await
            .entry(project_id.to_owned())
            .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
            .clone()
    }
}

async fn summary_for(entry: &RegistryEntry) -> Value {
    let available = entry
        .folder
        .as_ref()
        .is_none_or(|folder| std::fs::metadata(folder.join(".ruimte/project.json")).is_ok());
    let icon = match &entry.icon {
        Some(icon) => icon.clone(),
        None => {
            if let Some(folder) = &entry.folder
                && let Some(icon) = derive_icon(folder).await
            {
                json!({ "kind": "image", "value": icon.from, "version": icon.version })
            } else {
                let initial = entry
                    .name
                    .chars()
                    .find(|character| character.is_alphanumeric())
                    .unwrap_or('?')
                    .to_uppercase()
                    .collect::<String>();
                json!({ "kind": "initial", "value": initial })
            }
        }
    };
    let name_source = if entry
        .folder
        .as_ref()
        .and_then(|folder| folder.file_name())
        .and_then(|name| name.to_str())
        == Some(entry.name.as_str())
    {
        "folder"
    } else {
        "chosen"
    };
    json!({
        "projectId": entry.project_id, "name": entry.name, "color": entry.color,
        "folder": entry.folder, "lastOpenedAt": entry.last_opened_at, "closedAt": entry.closed_at,
        "available": available, "icon": icon, "nameSource": name_source
    })
}

fn require_entry<'a>(state: &'a State, project_id: &str) -> Result<&'a RegistryEntry, RpcError> {
    state
        .registry
        .as_ref()
        .unwrap()
        .iter()
        .find(|entry| entry.project_id == project_id)
        .ok_or_else(|| RpcError::new("project-not-found", format!("No project {project_id}")))
}

fn random_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_owned()
}

fn absolute_path(path: &str) -> Result<PathBuf, RpcError> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(io_error)
    }
}

fn string_member(value: &Value, name: &str) -> Result<String, RpcError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            RpcError::new(
                "project-invalid",
                format!("The project has no valid {name}"),
            )
        })
}

async fn write_json(path: &Path, value: &Value) -> Result<(), RpcError> {
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| RpcError::new("project-invalid", error.to_string()))?;
    bytes.push(b'\n');
    write_atomic_mode(path, &bytes, 0o644)
        .await
        .map_err(io_error)
}

async fn read_document(path: &Path, set_aside_corrupt: bool) -> Result<Option<Value>, RpcError> {
    let Some(bytes) = read_optional(path).await.map_err(io_error)? else {
        return Ok(None);
    };
    let mut value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) if set_aside_corrupt => {
            let set_aside = path.with_extension(format!("json.corrupt-{}", now_ms()));
            fs::rename(path, set_aside).await.map_err(io_error)?;
            return Ok(None);
        }
        Err(_) => {
            return Err(RpcError::new(
                "project-invalid",
                format!("{} does not parse as a canvas", path.display()),
            ));
        }
    };
    migrate_document(&mut value)?;
    validate_document(&value)?;
    remove_cross_view_edges(&mut value);
    wrap_unknown_entries(&mut value);
    Ok(Some(value))
}

fn migrate_document(value: &mut Value) -> Result<(), RpcError> {
    if value.get("version").and_then(Value::as_u64) == Some(1) {
        let object = value
            .as_object_mut()
            .ok_or_else(|| RpcError::new("project-invalid", "The project is not an object"))?;
        let nodes = object.remove("nodes").unwrap_or_else(|| json!([]));
        let texts = object.remove("texts").unwrap_or_else(|| json!([]));
        let edges = object.remove("edges").unwrap_or_else(|| json!([]));
        let layouts = object.remove("layouts").unwrap_or_else(|| json!([]));
        object.insert("version".to_owned(), json!(2));
        object.insert("views".to_owned(), json!([{ "kind": "canvas", "id": "main", "name": "Canvas", "nodes": nodes, "texts": texts, "edges": edges, "layouts": layouts }]));
    }
    Ok(())
}

fn validate_document(value: &Value) -> Result<(), RpcError> {
    if value.get("version").and_then(Value::as_u64) != Some(2)
        || value.get("rev").and_then(Value::as_u64).is_none()
    {
        return Err(RpcError::new(
            "project-invalid",
            "This file is not a project Ruimte can read",
        ));
    }
    validate_content(value)
}

fn validate_content(value: &Value) -> Result<(), RpcError> {
    string_member(value, "name")?;
    let views = value
        .get("views")
        .and_then(Value::as_array)
        .filter(|views| !views.is_empty())
        .ok_or_else(|| RpcError::new("project-invalid", "A project needs at least one view"))?;
    let mut ids = HashSet::new();
    for view in views {
        collect_id(view, &mut ids)?;
        if view.get("kind").and_then(Value::as_str) == Some("device")
            && !view.get("device").is_some_and(valid_device_reference)
        {
            return Err(RpcError::new(
                "project-invalid",
                "A device view needs a portable device reference",
            ));
        }
        if view.get("kind").and_then(Value::as_str) == Some("canvas") {
            for item in view
                .get("nodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                collect_id(item, &mut ids)?;
                if let Some(device) = item.get("device")
                    && !valid_device_reference(device)
                {
                    return Err(RpcError::new(
                        "project-invalid",
                        "A device node has an invalid portable device reference",
                    ));
                }
            }
            for text in view
                .get("texts")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if text
                    .get("font")
                    .is_some_and(|font| !matches!(font.as_str(), Some("hand" | "sans" | "mono")))
                    || text.get("bold").is_some_and(|bold| !bold.is_boolean())
                    || text
                        .get("italic")
                        .is_some_and(|italic| !italic.is_boolean())
                {
                    return Err(RpcError::new(
                        "project-invalid",
                        "A canvas text has invalid presentation fields",
                    ));
                }
            }
            for edge in view
                .get("edges")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if ["fromSide", "toSide"].into_iter().any(|field| {
                    edge.get(field).is_some_and(|side| {
                        !matches!(side.as_str(), Some("top" | "right" | "bottom" | "left"))
                    })
                }) {
                    return Err(RpcError::new(
                        "project-invalid",
                        "A canvas edge has an invalid fixed side",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn valid_device_reference(value: &Value) -> bool {
    value
        .get("platform")
        .and_then(Value::as_str)
        .is_some_and(|platform| matches!(platform, "ios" | "android"))
        && value
            .get("kind")
            .and_then(Value::as_str)
            .is_some_and(|kind| matches!(kind, "simulator" | "physical"))
        && ["name", "runtime"].into_iter().all(|field| {
            value
                .get(field)
                .and_then(Value::as_str)
                .is_some_and(|text| (1..=256).contains(&text.encode_utf16().count()))
        })
}

fn collect_id(value: &Value, ids: &mut HashSet<String>) -> Result<(), RpcError> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| RpcError::new("project-invalid", "A view or canvas item has no id"))?;
    if !ids.insert(id.to_owned()) {
        return Err(RpcError::new(
            "project-invalid",
            format!("Two views or nodes in this project share the id \"{id}\""),
        ));
    }
    Ok(())
}

const KNOWN_VIEWS: &[&str] = &[
    "canvas",
    "chat",
    "terminal",
    "browser",
    "device",
    "drawing",
    "diagram",
    "file",
    "separator",
];
const KNOWN_NODES: &[&str] = &[
    "terminal", "chat", "browser", "device", "group", "note", "drawing", "diagram", "file",
];

fn wrap_unknown_entries(document: &mut Value) {
    let Some(views) = document.get_mut("views").and_then(Value::as_array_mut) else {
        return;
    };
    for view in views {
        let kind = view
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !KNOWN_VIEWS.contains(&kind.as_str()) && kind != "unknown" {
            let raw = view.clone();
            let id = raw.get("id").cloned().unwrap_or(Value::Null);
            let name = raw
                .get("name")
                .cloned()
                .unwrap_or_else(|| Value::String(kind.clone()));
            *view = json!({ "kind": "unknown", "id": id, "name": name, "raw": raw });
            continue;
        }
        if kind == "canvas" {
            for node in view
                .get_mut("nodes")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                let node_kind = node
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                if !KNOWN_NODES.contains(&node_kind.as_str()) && node_kind != "unknown" {
                    let raw = node.clone();
                    let number = |key: &str, fallback: f64| {
                        raw.get(key)
                            .and_then(Value::as_f64)
                            .filter(|number| number.is_finite())
                            .unwrap_or(fallback)
                    };
                    *node = json!({ "id": raw.get("id").cloned().unwrap_or(Value::Null), "kind": "unknown", "title": raw.get("title").cloned().unwrap_or_else(|| Value::String(node_kind)), "x": number("x", 0.0), "y": number("y", 0.0), "w": number("w", 320.0), "h": number("h", 200.0), "raw": raw });
                }
            }
        }
    }
}

fn unwrap_unknown_entries(document: &mut Value) {
    let Some(views) = document.get_mut("views").and_then(Value::as_array_mut) else {
        return;
    };
    for view in views.iter_mut() {
        if view.get("kind").and_then(Value::as_str) == Some("unknown") {
            if let Some(raw) = view.get("raw").cloned() {
                *view = raw;
            }
            continue;
        }
        if let Some(nodes) = view.get_mut("nodes").and_then(Value::as_array_mut) {
            for node in nodes {
                if node.get("kind").and_then(Value::as_str) == Some("unknown") {
                    if let Some(mut raw) = node.get("raw").cloned() {
                        for key in ["id", "x", "y", "w", "h"] {
                            if let Some(value) = node.get(key) {
                                let fallback = match key {
                                    "x" | "y" => raw
                                        .get(key)
                                        .cloned()
                                        .filter(Value::is_number)
                                        .unwrap_or_else(|| json!(0)),
                                    "w" => raw
                                        .get(key)
                                        .cloned()
                                        .filter(|value| {
                                            value.as_f64().is_some_and(|number| number > 0.0)
                                        })
                                        .unwrap_or_else(|| json!(320)),
                                    "h" => raw
                                        .get(key)
                                        .cloned()
                                        .filter(|value| {
                                            value.as_f64().is_some_and(|number| number > 0.0)
                                        })
                                        .unwrap_or_else(|| json!(200)),
                                    _ => raw.get(key).cloned().unwrap_or(Value::Null),
                                };
                                if *value != fallback {
                                    raw.as_object_mut()
                                        .unwrap()
                                        .insert(key.to_owned(), value.clone());
                                }
                            }
                        }
                        *node = raw;
                    }
                }
            }
        }
    }
}

fn remove_cross_view_edges(document: &mut Value) {
    let Some(views) = document.get_mut("views").and_then(Value::as_array_mut) else {
        return;
    };
    for view in views {
        if view.get("kind").and_then(Value::as_str) != Some("canvas") {
            continue;
        }
        let mut here = HashSet::new();
        for key in ["nodes", "texts"] {
            for item in view
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    here.insert(id.to_owned());
                }
            }
        }
        if let Some(edges) = view.get_mut("edges").and_then(Value::as_array_mut) {
            edges.retain(|edge| {
                edge.get("from")
                    .and_then(Value::as_str)
                    .is_some_and(|id| here.contains(id))
                    && edge
                        .get("to")
                        .and_then(Value::as_str)
                        .is_some_and(|id| here.contains(id))
            });
        }
    }
}

fn map_cwds(document: &mut Value, folder: &Path, portable: bool) {
    let Some(views) = document.get_mut("views").and_then(Value::as_array_mut) else {
        return;
    };
    for view in views {
        if let Some(nodes) = view.get_mut("nodes").and_then(Value::as_array_mut) {
            for node in nodes {
                map_cwd(node, folder, portable);
            }
        }
        if matches!(
            view.get("kind").and_then(Value::as_str),
            Some("chat" | "terminal")
        ) {
            if let Some(node) = view.get_mut("node") {
                map_cwd(node, folder, portable);
            }
        }
    }
}

fn map_cwd(carrier: &mut Value, folder: &Path, portable: bool) {
    let Some(cwd) = carrier
        .get("cwd")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return;
    };
    let mapped = if portable {
        let path = Path::new(&cwd);
        path.strip_prefix(folder)
            .ok()
            .map(|relative| {
                if relative.as_os_str().is_empty() {
                    ".".to_owned()
                } else {
                    format!("./{}", relative.to_string_lossy().replace('\\', "/"))
                }
            })
            .unwrap_or(cwd)
    } else if Path::new(&cwd).is_absolute() {
        cwd
    } else {
        folder.join(cwd).to_string_lossy().to_string()
    };
    carrier
        .as_object_mut()
        .unwrap()
        .insert("cwd".to_owned(), Value::String(mapped));
}

fn make_daemon_side(document: &mut Value, folder: Option<&Path>) {
    if let Some(folder) = folder {
        map_cwds(document, folder, false);
    }
}
fn make_portable(document: &mut Value, folder: Option<&Path>) {
    if let Some(folder) = folder {
        map_cwds(document, folder, true);
    }
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if String::from_utf8_lossy(&bytes[..bytes.len().min(1024)])
        .to_lowercase()
        .contains("<svg")
    {
        Some("svg")
    } else {
        None
    }
}

struct DerivedIcon {
    from: String,
    path: PathBuf,
    mime: String,
    dark: Option<(PathBuf, String)>,
    version: String,
}

async fn derive_icon(folder: &Path) -> Option<DerivedIcon> {
    for candidate in ICON_CANDIDATES {
        if let Some(icon) = read_derived_icon(folder, candidate).await {
            return Some(icon);
        }
    }
    let html = jailed_file(folder, "index.html").await?;
    let bytes = fs::read(&html).await.ok()?;
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(16 * 1024)]);
    let link = regex::Regex::new(
        r#"(?is)<link\b[^>]*\brel\s*=\s*[\"']?[^>]*icon[^>]*\bhref\s*=\s*[\"']([^\"']+)[\"']"#,
    )
    .ok()?
    .captures(&head)?
    .get(1)?
    .as_str();
    if link.starts_with("data:") || link.starts_with("//") || link.contains("://") {
        return None;
    }
    let cleaned = link.split(['?', '#']).next()?.trim_start_matches('/');
    for candidate in [format!("public/{cleaned}"), cleaned.to_owned()] {
        if let Some(icon) = read_derived_icon(folder, &candidate).await {
            return Some(icon);
        }
    }
    None
}

async fn read_derived_icon(folder: &Path, candidate: &str) -> Option<DerivedIcon> {
    let path = jailed_file(folder, candidate).await?;
    let metadata = fs::metadata(&path).await.ok()?;
    if metadata.len() == 0 || metadata.len() > ICON_MAX_BYTES as u64 {
        return None;
    }
    let bytes = fs::read(&path).await.ok()?;
    let mime = image_mime(&bytes)?.to_owned();
    let candidate_path = Path::new(candidate);
    let stem = candidate_path.file_stem()?.to_string_lossy();
    let extension = candidate_path.extension()?.to_string_lossy();
    let dark_candidate = candidate_path
        .with_file_name(format!("{stem}_dark.{extension}"))
        .to_string_lossy()
        .to_string();
    let dark = if let Some(dark_path) = jailed_file(folder, &dark_candidate).await {
        let dark_bytes = fs::read(&dark_path).await.ok()?;
        image_mime(&dark_bytes).map(|dark_mime| (dark_path, dark_mime.to_owned()))
    } else {
        None
    };
    let stamp = |metadata: &std::fs::Metadata| {
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        format!("{modified}-{}", metadata.len())
    };
    let mut version = stamp(&metadata);
    if let Some((dark_path, _)) = &dark {
        if let Ok(metadata) = fs::metadata(dark_path).await {
            version.push('.');
            version.push_str(&stamp(&metadata));
        }
    }
    Some(DerivedIcon {
        from: candidate.to_owned(),
        path,
        mime,
        dark,
        version,
    })
}

async fn jailed_file(folder: &Path, candidate: &str) -> Option<PathBuf> {
    if candidate.contains('\0') || Path::new(candidate).is_absolute() {
        return None;
    }
    let real_folder = fs::canonicalize(folder).await.ok()?;
    let real = fs::canonicalize(folder.join(candidate)).await.ok()?;
    if real == real_folder
        || !real.starts_with(&real_folder)
        || !fs::metadata(&real).await.ok()?.is_file()
    {
        return None;
    }
    Some(real)
}

async fn read_idea_name(folder: &Path) -> Option<String> {
    let path = jailed_file(folder, ".idea/.name").await?;
    let metadata = fs::metadata(&path).await.ok()?;
    if metadata.len() == 0 || metadata.len() > 4 * 1024 {
        return None;
    }
    let text = fs::read_to_string(path).await.ok()?;
    for line in text.lines() {
        let cleaned = line
            .chars()
            .filter(|character| *character >= ' ' && *character != '\u{7f}')
            .collect::<String>();
        let cleaned = cleaned.trim();
        if !cleaned.is_empty() {
            return Some(cleaned.chars().take(64).collect());
        }
    }
    None
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/vnd.microsoft.icon")
    } else if String::from_utf8_lossy(&bytes[..bytes.len().min(1024)])
        .to_lowercase()
        .contains("<svg")
    {
        Some("image/svg+xml")
    } else {
        None
    }
}

async fn read_raw_settings(folder: &Path) -> Map<String, Value> {
    read_optional(&folder.join(".ruimte/settings.json"))
        .await
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

async fn read_settings(folder: &Path) -> Value {
    let raw = read_raw_settings(folder).await;
    let Some(worktrees) = raw.get("worktrees").and_then(Value::as_object) else {
        return json!({});
    };
    let Some(share) = worktrees.get("share").and_then(Value::as_array) else {
        return json!({ "worktrees": {} });
    };
    if share.iter().all(|value| value.as_str().is_some()) {
        json!({ "worktrees": { "share": share } })
    } else {
        json!({})
    }
}

fn shared_path(path: &str) -> Option<String> {
    let path = path
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_owned();
    if path.is_empty() || Path::new(&path).is_absolute() {
        return None;
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(&path).components() {
        match component {
            Component::Normal(part) if part != ".git" => normalized.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    let value = normalized.to_string_lossy().replace('\\', "/");
    if value == "." { None } else { Some(value) }
}

async fn remove_view_orphans(document_path: &Path, previous: &Value, current: &Value) {
    for (kind, directory) in [("drawing", "drawings"), ("diagram", "diagrams")] {
        let before = view_ids(previous, kind);
        let keep = view_ids(current, kind);
        if before.is_subset(&keep) {
            continue;
        }
        let Some(root) = document_path.parent().map(|parent| parent.join(directory)) else {
            continue;
        };
        let Ok(mut entries) = fs::read_dir(&root).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") {
                continue;
            }
            let encoded = &name[..name.len() - 5];
            if !keep.iter().any(|id| encode_component(id) == encoded) {
                let _ = fs::remove_file(entry.path()).await;
            }
        }
    }
}

fn view_ids(document: &Value, kind: &str) -> HashSet<String> {
    document.get("views").and_then(Value::as_array).into_iter().flatten().filter(|view| {
        matches!(view.get("kind").and_then(Value::as_str), Some(found) if found == kind || found == "unknown" || !KNOWN_VIEWS.contains(&found))
    }).filter_map(|view| view.get("id").and_then(Value::as_str).map(ToOwned::to_owned)).collect()
}

#[cfg(test)]
mod device_contract_tests {
    use super::*;

    #[test]
    fn device_and_canvas_presentation_fields_are_known_and_validated() {
        let reference = json!({ "platform": "ios", "kind": "simulator", "name": "iPhone", "runtime": "iOS 27" });
        let mut content = json!({
            "name": "Device",
            "color": "#353e53",
            "views": [
                {
                    "kind": "canvas", "id": "main", "name": "Canvas",
                    "nodes": [
                        { "id": "phone", "kind": "device", "title": "Phone", "x": 0, "y": 0, "w": 360, "h": 720, "device": reference },
                        { "id": "note", "kind": "note", "title": "Note", "x": 400, "y": 0, "w": 320, "h": 240 }
                    ],
                    "texts": [{ "id": "text", "x": 0, "y": 0, "text": "Hi", "size": 16, "font": "mono", "bold": true, "italic": true }],
                    "edges": [{ "id": "edge", "from": "phone", "to": "note", "fromSide": "right", "toSide": "left" }],
                    "layouts": []
                },
                { "kind": "device", "id": "phone-view", "name": "Phone", "device": reference }
            ]
        });
        wrap_unknown_entries(&mut content);
        assert_eq!(content["views"][0]["nodes"][0]["kind"], "device");
        assert_eq!(content["views"][1]["kind"], "device");
        validate_content(&content).unwrap();

        content["views"][1]
            .as_object_mut()
            .unwrap()
            .remove("device");
        assert_eq!(
            validate_content(&content).unwrap_err().code,
            "project-invalid"
        );
    }
}
