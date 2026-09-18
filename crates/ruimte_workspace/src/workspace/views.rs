#![allow(clippy::collapsible_if, clippy::question_mark, clippy::type_complexity)]

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{Value, json};
use tokio::{
    fs,
    sync::{Mutex, Semaphore},
};
use tokio_util::sync::CancellationToken;

use crate::{
    events::EventBus,
    rpc::{RpcError, RpcResult},
};

use super::{
    graphics::{diagram_svg, drawing_svg, render_diagram, render_drawing},
    project::ProjectStore,
    util::{
        encode_component, io_error, now_ms, read_optional, string_field, u64_field,
        write_atomic_mode,
    },
};

#[derive(Clone, Copy)]
enum ViewKind {
    Drawing,
    Diagram,
}

impl ViewKind {
    fn name(self) -> &'static str {
        match self {
            Self::Drawing => "drawing",
            Self::Diagram => "diagram",
        }
    }
    fn directory(self) -> &'static str {
        match self {
            Self::Drawing => "drawings",
            Self::Diagram => "diagrams",
        }
    }
    fn empty(self) -> Value {
        match self {
            Self::Drawing => json!({ "version": 1, "rev": 0, "elements": [] }),
            Self::Diagram => {
                json!({ "version": 1, "rev": 0, "meta": { "title": "", "direction": "right" }, "nodes": [], "groups": [], "edges": [] })
            }
        }
    }
}

pub struct ViewStores {
    projects: std::sync::Arc<ProjectStore>,
    events: EventBus,
    open: Arc<Mutex<HashMap<(String, String, &'static str), OpenView>>>,
    watchers: Mutex<HashMap<(String, &'static str), RecommendedWatcher>>,
    mutation_locks: Arc<Mutex<HashMap<(String, String, &'static str), Arc<Mutex<()>>>>>,
    watcher_tasks:
        Arc<std::sync::Mutex<HashMap<(String, String, &'static str), CancellationToken>>>,
    render_slots: Arc<Semaphore>,
}

struct OpenView {
    rev: u64,
    last_text: String,
}

impl ViewStores {
    pub fn new(projects: std::sync::Arc<ProjectStore>, events: EventBus) -> Self {
        Self {
            projects,
            events,
            open: Arc::new(Mutex::new(HashMap::new())),
            watchers: Mutex::new(HashMap::new()),
            mutation_locks: Arc::new(Mutex::new(HashMap::new())),
            watcher_tasks: Arc::new(std::sync::Mutex::new(HashMap::new())),
            render_slots: Arc::new(Semaphore::new(
                std::thread::available_parallelism()
                    .map(usize::from)
                    .unwrap_or(1)
                    .clamp(1, 4),
            )),
        }
    }

    pub async fn dispatch(&self, method: &str, payload: Value) -> Option<RpcResult> {
        let (kind, action) = if let Some(action) = method.strip_prefix("drawing.") {
            (ViewKind::Drawing, action)
        } else if let Some(action) = method.strip_prefix("diagram.") {
            (ViewKind::Diagram, action)
        } else {
            return None;
        };
        Some(match action {
            "open" => self.open(kind, payload).await,
            "save" => self.save(kind, payload).await,
            "close" => self.close(kind, payload).await,
            "copy" => self.copy(kind, payload).await,
            "paths" if matches!(kind, ViewKind::Drawing) => self.render_drawing(payload).await,
            "layout" if matches!(kind, ViewKind::Diagram) => self.render_diagram(payload).await,
            _ => return None,
        })
    }

    pub async fn shutdown(&self) {
        self.watchers.lock().await.clear();
        for token in self
            .watcher_tasks
            .lock()
            .expect("view watcher task lock poisoned")
            .values()
        {
            token.cancel();
        }
        self.watcher_tasks
            .lock()
            .expect("view watcher task lock poisoned")
            .clear();
        self.open.lock().await.clear();
    }

    pub async fn close_project(&self, project_id: &str) {
        self.open
            .lock()
            .await
            .retain(|(owner, _, _), _| owner != project_id);
        {
            let mut tasks = self
                .watcher_tasks
                .lock()
                .expect("view watcher task lock poisoned");
            tasks.retain(|(owner, _, _), token| {
                if owner == project_id {
                    token.cancel();
                    false
                } else {
                    true
                }
            });
        }
        self.watchers
            .lock()
            .await
            .retain(|(owner, _), _| owner != project_id);
    }

    pub async fn read_drawing(
        &self,
        project_id: &str,
        view_id: &str,
    ) -> Result<Option<Value>, RpcError> {
        self.read_file(ViewKind::Drawing, project_id, view_id).await
    }

    async fn render_drawing(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let view_id = string_field(&payload, "viewId")?;
        let document = self
            .read_file(ViewKind::Drawing, &project_id, &view_id)
            .await?
            .ok_or_else(|| RpcError::new("drawing-invalid", "The drawing file is invalid"))?;
        self.render(document, render_drawing).await
    }

    async fn render_diagram(&self, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let view_id = string_field(&payload, "viewId")?;
        let document = self
            .read_file(ViewKind::Diagram, &project_id, &view_id)
            .await?
            .ok_or_else(|| RpcError::new("diagram-invalid", "The diagram file is invalid"))?;
        self.render(document, render_diagram).await
    }

    async fn render(&self, document: Value, renderer: fn(&Value) -> RpcResult) -> RpcResult {
        let permit = self
            .render_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| RpcError::new("server-shutdown", "The renderer is shutting down"))?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            renderer(&document)
        })
        .await
        .map_err(|error| RpcError::new("internal-error", format!("Rendering failed: {error}")))?
    }

    pub async fn read_diagram(
        &self,
        project_id: &str,
        view_id: &str,
    ) -> Result<Option<Value>, RpcError> {
        self.read_file(ViewKind::Diagram, project_id, view_id).await
    }

    pub(crate) async fn write_diagram(
        &self,
        project_id: &str,
        view_id: &str,
        mut content: Value,
    ) -> Result<u64, RpcError> {
        normalize_content(ViewKind::Diagram, &mut content)?;
        validate_content(ViewKind::Diagram, &content)?;
        let key = (project_id.to_owned(), view_id.to_owned(), "diagram");
        let lock = self.view_lock(key.clone()).await;
        let _guard = lock.lock().await;
        let path = self.path(ViewKind::Diagram, project_id, view_id).await?;
        let current = read_view_snapshot(ViewKind::Diagram, &path, false)
            .await?
            .map_or(0, |(document, _)| document["rev"].as_u64().unwrap_or(0));
        content
            .as_object_mut()
            .unwrap()
            .insert("version".to_owned(), json!(1));
        content
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(current + 1));
        let last_text = write_view(&path, &content).await?;
        let mut open = self.open.lock().await;
        if open.contains_key(&key) {
            open.insert(
                key,
                OpenView {
                    rev: current + 1,
                    last_text,
                },
            );
        }
        drop(open);
        self.events.broadcast(
            "diagram.changed",
            json!({ "projectId": project_id, "viewId": view_id, "document": content }),
        );
        Ok(current + 1)
    }

    pub(crate) async fn render_drawing_svg(&self, document: Value) -> Result<String, RpcError> {
        self.render_owned(document, drawing_svg).await
    }

    pub(crate) async fn render_diagram_svg(&self, document: Value) -> Result<String, RpcError> {
        self.render_owned(document, diagram_svg).await
    }

    async fn render_owned<T: Send + 'static>(
        &self,
        document: Value,
        renderer: fn(&Value) -> Result<T, RpcError>,
    ) -> Result<T, RpcError> {
        let permit = self
            .render_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| RpcError::new("server-shutdown", "The renderer is shutting down"))?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            renderer(&document)
        })
        .await
        .map_err(|error| RpcError::new("internal-error", format!("Rendering failed: {error}")))?
    }

    async fn read_file(
        &self,
        kind: ViewKind,
        project_id: &str,
        view_id: &str,
    ) -> Result<Option<Value>, RpcError> {
        let path = self.path(kind, project_id, view_id).await?;
        match read_view(kind, &path, false).await {
            Ok(None) => Ok(Some(kind.empty())),
            Ok(document) => Ok(document),
            Err(error) if error.code.ends_with("-invalid") => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn open(&self, kind: ViewKind, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let view_id = string_field(&payload, "viewId")?;
        let key = (project_id.clone(), view_id.clone(), kind.name());
        let lock = self.view_lock(key.clone()).await;
        let _guard = lock.lock().await;
        let path = self.path(kind, &project_id, &view_id).await?;
        let (document, last_text) = match read_view_snapshot(kind, &path, true).await? {
            Some(snapshot) => snapshot,
            None => (kind.empty(), String::new()),
        };
        self.open.lock().await.insert(
            key,
            OpenView {
                rev: document["rev"].as_u64().unwrap_or(0),
                last_text,
            },
        );
        self.start_watcher(kind, project_id, path.parent().unwrap().to_path_buf())
            .await;
        Ok(json!({ "document": document }))
    }

    async fn save(&self, kind: ViewKind, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let view_id = string_field(&payload, "viewId")?;
        let base_rev = u64_field(&payload, "baseRev")?;
        let mut content = payload
            .get("content")
            .cloned()
            .ok_or_else(|| RpcError::new("bad-request", "Missing content."))?;
        normalize_content(kind, &mut content)?;
        validate_content(kind, &content)?;
        let key = (project_id.clone(), view_id.clone(), kind.name());
        let lock = self.view_lock(key.clone()).await;
        let _guard = lock.lock().await;
        let current = self
            .open
            .lock()
            .await
            .get(&key)
            .ok_or_else(|| {
                RpcError::new(
                    format!("{}-not-found", kind.name()),
                    format!("{view_id} is not an open {}", kind.name()),
                )
            })?
            .rev;
        if current != base_rev {
            return Err(RpcError::new(
                "rev-conflict",
                format!(
                    "The {} is at rev {current}, the save was based on {base_rev}",
                    kind.name()
                ),
            ));
        }
        let mut document = content;
        document
            .as_object_mut()
            .unwrap()
            .insert("version".to_owned(), json!(1));
        document
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(base_rev + 1));
        let path = self.path(kind, &project_id, &view_id).await?;
        let last_text = write_view(&path, &document).await?;
        self.open.lock().await.insert(
            key,
            OpenView {
                rev: base_rev + 1,
                last_text,
            },
        );
        Ok(json!({ "rev": base_rev + 1 }))
    }

    async fn close(&self, kind: ViewKind, payload: Value) -> RpcResult {
        let key = (
            string_field(&payload, "projectId")?,
            string_field(&payload, "viewId")?,
            kind.name(),
        );
        self.open.lock().await.remove(&key);
        if let Some(token) = self
            .watcher_tasks
            .lock()
            .expect("view watcher task lock poisoned")
            .remove(&key)
        {
            token.cancel();
        }
        Ok(json!({}))
    }

    async fn start_watcher(&self, kind: ViewKind, project_id: String, directory: PathBuf) {
        let key = (project_id.clone(), kind.name());
        if self.watchers.lock().await.contains_key(&key) {
            return;
        }
        if fs::create_dir_all(&directory).await.is_err() {
            return;
        }
        let open = self.open.clone();
        let events = self.events.clone();
        let mutation_locks = self.mutation_locks.clone();
        let watcher_tasks = self.watcher_tasks.clone();
        let runtime = tokio::runtime::Handle::current();
        let watched_project = project_id.clone();
        let watched_directory = directory.clone();
        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if result.is_err() {
                    return;
                }
                let open = open.clone();
                let events = events.clone();
                let mutation_locks = mutation_locks.clone();
                let watcher_tasks = watcher_tasks.clone();
                let watched_project = watched_project.clone();
                let watched_directory = watched_directory.clone();
                runtime.spawn(async move {
                    let keys = open
                        .lock()
                        .await
                        .keys()
                        .filter(|(project_id, _, view_kind)| {
                            project_id == &watched_project && *view_kind == kind.name()
                        })
                        .cloned()
                        .collect::<Vec<_>>();
                    for key in keys {
                        let view_id = key.1.clone();
                        let path =
                            watched_directory.join(format!("{}.json", encode_component(&view_id)));
                        let cancel = CancellationToken::new();
                        if let Some(previous) = watcher_tasks
                            .lock()
                            .expect("view watcher task lock poisoned")
                            .insert(key.clone(), cancel.clone())
                        {
                            previous.cancel();
                        }
                        let open = open.clone();
                        let events = events.clone();
                        let mutation_locks = mutation_locks.clone();
                        let project_id = watched_project.clone();
                        tokio::spawn(async move {
                            tokio::select! {
                                _ = cancel.cancelled() => return,
                                _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {}
                            }
                            let lock = mutation_locks
                                .lock()
                                .await
                                .entry(key.clone())
                                .or_insert_with(|| Arc::new(Mutex::new(())))
                                .clone();
                            let _guard = lock.lock().await;
                            if !open.lock().await.contains_key(&key) {
                                return;
                            }
                            let Ok(Some((document, text))) =
                                read_view_snapshot(kind, &path, false).await
                            else {
                                return;
                            };
                            let mut opened = open.lock().await;
                            let Some(current) = opened.get_mut(&key) else {
                                return;
                            };
                            if current.last_text == text {
                                return;
                            }
                            current.rev = document["rev"].as_u64().unwrap_or(current.rev);
                            current.last_text = text;
                            drop(opened);
                            events.broadcast(
                                &format!("{}.changed", kind.name()),
                                json!({
                                    "projectId": project_id,
                                    "viewId": view_id,
                                    "document": document
                                }),
                            );
                        });
                    }
                });
            },
            Config::default(),
        );
        let Ok(mut watcher) = watcher else {
            return;
        };
        if watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .is_ok()
        {
            self.watchers.lock().await.insert(key, watcher);
        }
    }

    async fn copy(&self, kind: ViewKind, payload: Value) -> RpcResult {
        let project_id = string_field(&payload, "projectId")?;
        let from = string_field(&payload, "from")?;
        let to = string_field(&payload, "to")?;
        let source = self.path(kind, &project_id, &from).await?;
        let target = self.path(kind, &project_id, &to).await?;
        let source_lock = self
            .view_lock((project_id.clone(), from, kind.name()))
            .await;
        let _source_guard = source_lock.lock().await;
        let Some(mut document) = read_view(kind, &source, false).await? else {
            return Ok(json!({}));
        };
        drop(_source_guard);
        document
            .as_object_mut()
            .unwrap()
            .insert("rev".to_owned(), json!(0));
        let target_lock = self.view_lock((project_id, to, kind.name())).await;
        let _target_guard = target_lock.lock().await;
        write_view(&target, &document).await?;
        Ok(json!({}))
    }

    async fn view_lock(&self, key: (String, String, &'static str)) -> Arc<Mutex<()>> {
        self.mutation_locks
            .lock()
            .await
            .entry(key)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn path(
        &self,
        kind: ViewKind,
        project_id: &str,
        view_id: &str,
    ) -> Result<PathBuf, RpcError> {
        let (document_path, document) = self.projects.project_place(project_id).await?;
        let found = document
            .get("views")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|view| {
                view.get("id").and_then(Value::as_str) == Some(view_id)
                    && view.get("kind").and_then(Value::as_str) == Some(kind.name())
            });
        if !found {
            return Err(RpcError::new(
                format!("{}-not-found", kind.name()),
                format!("{view_id} is not a {} of project {project_id}", kind.name()),
            ));
        }
        Ok(document_path
            .parent()
            .unwrap()
            .join(kind.directory())
            .join(format!("{}.json", encode_component(view_id))))
    }
}

fn normalize_content(kind: ViewKind, value: &mut Value) -> Result<(), RpcError> {
    match kind {
        ViewKind::Drawing => {
            let elements = value
                .get_mut("elements")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| RpcError::new("drawing-invalid", "A drawing needs elements"))?;
            for element in elements {
                normalize_drawing_element(element)?;
            }
        }
        ViewKind::Diagram => normalize_diagram(value)?,
    }
    Ok(())
}

fn normalize_drawing_element(value: &mut Value) -> Result<(), RpcError> {
    let object = value
        .as_object()
        .ok_or_else(|| RpcError::new("drawing-invalid", "A drawing element must be an object"))?;
    let kind = required_string(object, "kind", "drawing-invalid")?;
    if !matches!(
        kind,
        "rect" | "diamond" | "ellipse" | "line" | "freehand" | "text" | "note"
    ) {
        return Err(RpcError::new(
            "drawing-invalid",
            "Unknown drawing element kind",
        ));
    }
    required_string(object, "id", "drawing-invalid")?;
    for key in ["x", "y", "w", "h"] {
        required_number(object, key, "drawing-invalid")?;
    }
    enum_string(
        object,
        "stroke",
        &[
            "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple", "pink",
        ],
        false,
        "drawing-invalid",
    )?;
    if !matches!(
        object.get("strokeWidth").and_then(Value::as_u64),
        Some(1 | 2 | 4)
    ) {
        return Err(RpcError::new(
            "drawing-invalid",
            "Invalid drawing stroke width",
        ));
    }
    if object.get("seed").and_then(Value::as_u64).is_none() {
        return Err(RpcError::new("drawing-invalid", "Invalid drawing seed"));
    }
    optional_number(object, "angle", "drawing-invalid")?;
    optional_number(object, "roughness", "drawing-invalid")?;
    enum_string(
        object,
        "strokeStyle",
        &["solid", "dashed", "dotted"],
        true,
        "drawing-invalid",
    )?;
    enum_string(
        object,
        "fill",
        &["none", "solid", "hachure"],
        true,
        "drawing-invalid",
    )?;
    enum_string(
        object,
        "fillColor",
        &[
            "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple", "pink",
        ],
        true,
        "drawing-invalid",
    )?;
    optional_bool(object, "locked", "drawing-invalid")?;
    match kind {
        "rect" => {
            if object
                .get("radius")
                .is_some_and(|value| value.as_f64().is_none_or(|number| number < 0.0))
            {
                return Err(RpcError::new("drawing-invalid", "Invalid rectangle radius"));
            }
        }
        "line" => validate_points(object, 2, false)?,
        "freehand" => validate_points(object, 1, true)?,
        "text" | "note" => {
            object
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| RpcError::new("drawing-invalid", "Drawing text is missing"))?;
            let size = object.get("size").and_then(Value::as_u64).unwrap_or(0);
            if !(12..=96).contains(&size) {
                return Err(RpcError::new(
                    "drawing-invalid",
                    "Invalid drawing text size",
                ));
            }
            enum_string(
                object,
                "font",
                &["hand", "sans", "mono"],
                true,
                "drawing-invalid",
            )?;
            enum_string(
                object,
                "align",
                &["left", "center", "right"],
                true,
                "drawing-invalid",
            )?;
            if kind == "text" {
                optional_bool(object, "sized", "drawing-invalid")?;
            }
        }
        _ => {}
    }
    let keys = [
        "id",
        "x",
        "y",
        "w",
        "h",
        "angle",
        "stroke",
        "strokeWidth",
        "strokeStyle",
        "fill",
        "fillColor",
        "roughness",
        "seed",
        "locked",
        "kind",
        "radius",
        "points",
        "arrowStart",
        "arrowEnd",
        "text",
        "size",
        "font",
        "align",
        "sized",
    ];
    *value = Value::Object(
        keys.iter()
            .filter_map(|key| {
                object
                    .get(*key)
                    .cloned()
                    .map(|field| ((*key).to_owned(), field))
            })
            .collect(),
    );
    Ok(())
}

fn validate_points(
    object: &serde_json::Map<String, Value>,
    minimum: usize,
    pressure: bool,
) -> Result<(), RpcError> {
    let points = object
        .get("points")
        .and_then(Value::as_array)
        .filter(|points| points.len() >= minimum)
        .ok_or_else(|| RpcError::new("drawing-invalid", "Invalid drawing points"))?;
    for point in points {
        let point = point
            .as_array()
            .filter(|point| point.len() == 2 || (pressure && point.len() == 3))
            .ok_or_else(|| RpcError::new("drawing-invalid", "Invalid drawing point"))?;
        if point.iter().any(|number| number.as_f64().is_none()) {
            return Err(RpcError::new("drawing-invalid", "Invalid drawing point"));
        }
    }
    for key in ["arrowStart", "arrowEnd"] {
        optional_bool(object, key, "drawing-invalid")?;
    }
    Ok(())
}

fn normalize_diagram(value: &mut Value) -> Result<(), RpcError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram must be an object"))?;
    let meta = object
        .get_mut("meta")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs metadata"))?;
    required_string(meta, "title", "diagram-invalid")?;
    enum_string(
        meta,
        "direction",
        &["right", "down"],
        false,
        "diagram-invalid",
    )?;
    retain_fields(meta, &["title", "direction"]);
    normalize_diagram_list(
        object,
        "nodes",
        &["id", "label", "sub", "shape", "tone", "pos"],
    )?;
    normalize_diagram_list(object, "groups", &["id", "label", "wraps", "tone"])?;
    normalize_diagram_list(object, "edges", &["from", "to", "label", "style", "tone"])?;
    for node in object["nodes"].as_array().unwrap() {
        let node = node.as_object().unwrap();
        required_string(node, "id", "diagram-invalid")?;
        node.get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram node needs a label"))?;
        enum_string(
            node,
            "shape",
            &["rect", "round", "pill", "diamond", "cylinder"],
            true,
            "diagram-invalid",
        )?;
        validate_tone(node)?;
        if let Some(pos) = node.get("pos") {
            if pos.as_array().is_none_or(|pos| {
                pos.len() != 2 || pos.iter().any(|value| value.as_f64().is_none())
            }) {
                return Err(RpcError::new(
                    "diagram-invalid",
                    "Invalid diagram node position",
                ));
            }
        }
    }
    for group in object["groups"].as_array().unwrap() {
        let group = group.as_object().unwrap();
        required_string(group, "id", "diagram-invalid")?;
        group
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram group needs a label"))?;
        if group
            .get("wraps")
            .and_then(Value::as_array)
            .is_none_or(|wraps| wraps.iter().any(|id| id.as_str().is_none_or(str::is_empty)))
        {
            return Err(RpcError::new(
                "diagram-invalid",
                "Invalid diagram group members",
            ));
        }
        validate_tone(group)?;
    }
    for edge in object["edges"].as_array().unwrap() {
        let edge = edge.as_object().unwrap();
        required_string(edge, "from", "diagram-invalid")?;
        required_string(edge, "to", "diagram-invalid")?;
        enum_string(
            edge,
            "style",
            &["solid", "dashed", "dotted"],
            true,
            "diagram-invalid",
        )?;
        validate_tone(edge)?;
    }
    Ok(())
}

fn normalize_diagram_list(
    object: &mut serde_json::Map<String, Value>,
    name: &str,
    keys: &[&str],
) -> Result<(), RpcError> {
    let items = object
        .get_mut(name)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| RpcError::new("diagram-invalid", format!("A diagram needs {name}")))?;
    for item in items {
        let item = item.as_object_mut().ok_or_else(|| {
            RpcError::new(
                "diagram-invalid",
                format!("A diagram {name} entry must be an object"),
            )
        })?;
        retain_fields(item, keys);
    }
    Ok(())
}

fn retain_fields(object: &mut serde_json::Map<String, Value>, keys: &[&str]) {
    object.retain(|key, _| keys.contains(&key.as_str()));
}

fn required_string<'a>(
    object: &'a serde_json::Map<String, Value>,
    key: &str,
    code: &str,
) -> Result<&'a str, RpcError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcError::new(code, format!("{key} must be a non-empty string")))
}

fn required_number(
    object: &serde_json::Map<String, Value>,
    key: &str,
    code: &str,
) -> Result<(), RpcError> {
    object
        .get(key)
        .and_then(Value::as_f64)
        .map(|_| ())
        .ok_or_else(|| RpcError::new(code, format!("{key} must be a number")))
}

fn optional_number(
    object: &serde_json::Map<String, Value>,
    key: &str,
    code: &str,
) -> Result<(), RpcError> {
    if object
        .get(key)
        .is_some_and(|value| value.as_f64().is_none())
    {
        Err(RpcError::new(code, format!("{key} must be a number")))
    } else {
        Ok(())
    }
}

fn optional_bool(
    object: &serde_json::Map<String, Value>,
    key: &str,
    code: &str,
) -> Result<(), RpcError> {
    if object
        .get(key)
        .is_some_and(|value| value.as_bool().is_none())
    {
        Err(RpcError::new(code, format!("{key} must be a boolean")))
    } else {
        Ok(())
    }
}

fn enum_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    choices: &[&str],
    optional: bool,
    code: &str,
) -> Result<(), RpcError> {
    match object.get(key) {
        None if optional => Ok(()),
        Some(Value::String(value)) if choices.contains(&value.as_str()) => Ok(()),
        _ => Err(RpcError::new(code, format!("Invalid {key}"))),
    }
}

fn validate_tone(object: &serde_json::Map<String, Value>) -> Result<(), RpcError> {
    enum_string(
        object,
        "tone",
        &[
            "ink", "muted", "accent", "red", "orange", "yellow", "green", "blue", "purple", "pink",
        ],
        true,
        "diagram-invalid",
    )
}

fn validate_content(kind: ViewKind, value: &Value) -> Result<(), RpcError> {
    let object = value.as_object().ok_or_else(|| {
        RpcError::new(
            format!("{}-invalid", kind.name()),
            format!("This file is not a {} Ruimte can read", kind.name()),
        )
    })?;
    match kind {
        ViewKind::Drawing => {
            let elements = object
                .get("elements")
                .and_then(Value::as_array)
                .ok_or_else(|| RpcError::new("drawing-invalid", "A drawing needs elements"))?;
            let mut ids = HashSet::new();
            for element in elements {
                let id = element
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if id.is_empty() || !ids.insert(id) {
                    return Err(RpcError::new(
                        "drawing-invalid",
                        format!("Two elements in this drawing share the id \"{id}\""),
                    ));
                }
            }
        }
        ViewKind::Diagram => validate_diagram(value)?,
    }
    Ok(())
}

fn validate_diagram(value: &Value) -> Result<(), RpcError> {
    let nodes = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs nodes"))?;
    let groups = value
        .get("groups")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs groups"))?;
    let edges = value
        .get("edges")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs edges"))?;
    let mut node_ids = HashSet::new();
    for node in nodes {
        let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
        if id.is_empty() || !node_ids.insert(id) {
            return Err(RpcError::new(
                "diagram-invalid",
                format!("Two nodes share the id \"{id}\""),
            ));
        }
    }
    let mut group_ids = HashSet::new();
    let mut grouped = HashMap::new();
    for group in groups {
        let id = group.get("id").and_then(Value::as_str).unwrap_or_default();
        if id.is_empty() || node_ids.contains(id) || !group_ids.insert(id) {
            return Err(RpcError::new(
                "diagram-invalid",
                format!("The group id \"{id}\" is already taken"),
            ));
        }
        for wrapped in group
            .get("wraps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !node_ids.contains(wrapped) {
                return Err(RpcError::new(
                    "diagram-invalid",
                    format!("The group \"{id}\" wraps \"{wrapped}\", which is not a node"),
                ));
            }
            if let Some(other) = grouped.insert(wrapped, id) {
                return Err(RpcError::new(
                    "diagram-invalid",
                    format!("The node \"{wrapped}\" is in two groups, \"{other}\" and \"{id}\""),
                ));
            }
        }
    }
    for edge in edges {
        let from = edge.get("from").and_then(Value::as_str).unwrap_or_default();
        let to = edge.get("to").and_then(Value::as_str).unwrap_or_default();
        for end in [from, to] {
            if !node_ids.contains(end) {
                return Err(RpcError::new(
                    "diagram-invalid",
                    format!(
                        "The edge from \"{from}\" to \"{to}\" names \"{end}\", which is not a node"
                    ),
                ));
            }
        }
    }
    Ok(())
}

async fn read_view(
    kind: ViewKind,
    path: &Path,
    set_aside: bool,
) -> Result<Option<Value>, RpcError> {
    Ok(read_view_snapshot(kind, path, set_aside)
        .await?
        .map(|(value, _)| value))
}

async fn read_view_snapshot(
    kind: ViewKind,
    path: &Path,
    set_aside: bool,
) -> Result<Option<(Value, String)>, RpcError> {
    let Some(bytes) = read_optional(path).await.map_err(io_error)? else {
        return Ok(None);
    };
    let mut value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) if set_aside => {
            let aside = path.with_extension(format!("json.corrupt-{}", now_ms()));
            fs::rename(path, aside).await.map_err(io_error)?;
            return Ok(None);
        }
        Err(_) => {
            return Err(RpcError::new(
                format!("{}-invalid", kind.name()),
                format!("This file is not a {} Ruimte can read", kind.name()),
            ));
        }
    };
    let text = String::from_utf8(bytes).map_err(|_| {
        RpcError::new(
            format!("{}-invalid", kind.name()),
            format!("This file is not a {} Ruimte can read", kind.name()),
        )
    })?;
    if value.get("version").and_then(Value::as_u64) != Some(1)
        || value.get("rev").and_then(Value::as_u64).is_none()
    {
        return Err(RpcError::new(
            format!("{}-invalid", kind.name()),
            format!("This file is not a {} Ruimte can read", kind.name()),
        ));
    }
    normalize_content(kind, &mut value)?;
    validate_content(kind, &value)?;
    Ok(Some((value, text)))
}

async fn write_view(path: &Path, value: &Value) -> Result<String, RpcError> {
    let text = match value.get("elements").and_then(Value::as_array) {
        Some(elements) => serialize_drawing(value, elements),
        None => serialize_diagram(value),
    };
    write_atomic_mode(path, text.as_bytes(), 0o644)
        .await
        .map_err(io_error)?;
    Ok(text)
}

fn compact_list(items: &[Value], keys: &[&str]) -> String {
    if items.is_empty() {
        "[]".to_owned()
    } else {
        format!(
            "[\n{}\n  ]",
            items
                .iter()
                .map(|item| format!("    {}", compact_object(item, keys)))
                .collect::<Vec<_>>()
                .join(",\n")
        )
    }
}

fn compact_object(value: &Value, keys: &[&str]) -> String {
    let Some(object) = value.as_object() else {
        return serde_json::to_string(value).unwrap();
    };
    let fields = keys
        .iter()
        .filter_map(|key| {
            object.get(*key).map(|value| {
                format!(
                    "{}:{}",
                    serde_json::to_string(key).unwrap(),
                    serde_json::to_string(value).unwrap()
                )
            })
        })
        .collect::<Vec<_>>();
    format!("{{{}}}", fields.join(","))
}

fn serialize_drawing(value: &Value, elements: &[Value]) -> String {
    format!(
        "{{\n  \"version\": {},\n  \"rev\": {},\n  \"elements\": {}\n}}\n",
        value["version"],
        value["rev"],
        compact_list(
            elements,
            &[
                "id",
                "x",
                "y",
                "w",
                "h",
                "angle",
                "stroke",
                "strokeWidth",
                "strokeStyle",
                "fill",
                "fillColor",
                "roughness",
                "seed",
                "locked",
                "kind",
                "radius",
                "points",
                "arrowStart",
                "arrowEnd",
                "text",
                "size",
                "font",
                "align",
                "sized",
            ],
        )
    )
}

fn serialize_diagram(value: &Value) -> String {
    let nodes = value["nodes"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let groups = value["groups"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let edges = value["edges"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    format!(
        "{{\n  \"version\": {},\n  \"rev\": {},\n  \"meta\": {},\n  \"nodes\": {},\n  \"groups\": {},\n  \"edges\": {}\n}}\n",
        value["version"],
        value["rev"],
        compact_object(&value["meta"], &["title", "direction"]),
        compact_list(nodes, &["id", "label", "sub", "shape", "tone", "pos"]),
        compact_list(groups, &["id", "label", "wraps", "tone"]),
        compact_list(edges, &["from", "to", "label", "style", "tone"])
    )
}
