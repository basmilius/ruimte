use std::path::Path;

use async_trait::async_trait;
use rand::RngCore;
use serde_json::{Map, Value, json};

use crate::{
    chat::{
        ChatForkWorkspaceHost, ForkPlacementRequest, ForkPlacementResult, ForkWorkspaceLocation,
        ForkWorktree, ForkWorktreeRequest,
    },
    rpc::RpcError,
};

use super::WorkspaceService;

#[async_trait]
impl ChatForkWorkspaceHost for WorkspaceService {
    async fn locate(&self, node_id: &str) -> Result<Option<ForkWorkspaceLocation>, RpcError> {
        let Some(place) = self.inner.projects.locate(node_id).await else {
            return Ok(None);
        };
        Ok(Some(ForkWorkspaceLocation {
            project_id: place["projectId"].as_str().unwrap_or_default().to_owned(),
            canvas_id: place["canvasId"].as_str().map(ToOwned::to_owned),
            folder: place["folder"].as_str().unwrap_or_default().to_owned(),
            title: self.inner.projects.title_for(node_id).await,
            lineage_depth: self.inner.workflow.depth_of(node_id).await as u32,
        }))
    }

    async fn place_fork(
        &self,
        request: ForkPlacementRequest,
    ) -> Result<ForkPlacementResult, RpcError> {
        let Some(place) = self.inner.projects.locate(&request.source_id).await else {
            return Err(RpcError::new(
                "chat-not-found",
                format!("{} is in no known project", request.source_id),
            ));
        };
        if place["projectId"] != request.project_id {
            return Err(RpcError::new(
                "chat-not-found",
                format!(
                    "{} left its project while the fork was made",
                    request.source_id
                ),
            ));
        }
        let depth = self.inner.workflow.depth_of(&request.source_id).await;
        self.inner
            .workflow
            .record_lineage(
                &request.project_id,
                &request.fork_id,
                &request.source_id,
                depth,
                true,
                Some("fork"),
            )
            .await?;
        let project_id = request.project_id.clone();
        let fork_id = request.fork_id.clone();
        let result = self
            .mutate_project(&project_id, move |content| place_fork(content, request))
            .await;
        match result {
            Ok((_, result)) => Ok(result),
            Err(error) => {
                let _ = self.inner.workflow.remove_lineage(&fork_id).await;
                Err(error)
            }
        }
    }

    async fn branches(&self, cwd: &str) -> Result<Option<Vec<String>>, RpcError> {
        self.inner.git.fork_branches(Path::new(cwd)).await
    }

    async fn add_worktree(&self, request: ForkWorktreeRequest) -> Result<ForkWorktree, RpcError> {
        let (record, cwd) = self
            .inner
            .git
            .fork_add_worktree(
                Path::new(&request.cwd),
                &request.branch,
                &request.project_id,
                &request.node_id,
            )
            .await?;
        Ok(ForkWorktree {
            record,
            cwd: cwd.to_string_lossy().into_owned(),
        })
    }

    async fn remove_worktree(&self, worktree: &Value) -> Result<(), RpcError> {
        self.inner.git.fork_remove_worktree(worktree).await
    }

    async fn tree_exists(&self, cwd: &str, tree: &str) -> Result<bool, RpcError> {
        self.inner.git.checkpoint_exists(Path::new(cwd), tree).await
    }

    async fn take_tree(&self, cwd: &str) -> Result<Option<String>, RpcError> {
        self.inner.git.checkpoint_take(Path::new(cwd)).await
    }

    async fn restore_tree(&self, cwd: &str, tree: &str) -> Result<(), RpcError> {
        self.inner
            .git
            .checkpoint_restore(Path::new(cwd), tree)
            .await
    }

    async fn diff_tree(&self, cwd: &str, tree: &str) -> Result<Option<Value>, RpcError> {
        self.inner.git.checkpoint_diff(Path::new(cwd), tree).await
    }

    async fn copy_plans(&self, from_chat_id: &str, to_chat_id: &str) -> Result<(), RpcError> {
        self.inner
            .workflow
            .plans()
            .copy_chat(from_chat_id, to_chat_id)
            .await
    }

    async fn remove_plans(&self, chat_id: &str) -> Result<(), RpcError> {
        self.inner.workflow.plans().remove_chat(chat_id).await
    }
}

fn place_fork(
    content: &mut Value,
    request: ForkPlacementRequest,
) -> Result<ForkPlacementResult, RpcError> {
    if project_has_id(content, &request.fork_id) {
        return Err(RpcError::new(
            "fork-failed",
            format!(
                "The id {} was taken while the fork was made; try again",
                request.fork_id
            ),
        ));
    }
    let potential_edge_id = fresh_id("edge", content);
    let views = content
        .get_mut("views")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| RpcError::new("project-invalid", "The project has no views"))?;
    let source_view = views.iter().position(|view| {
        view["id"] == request.source_id
            || (view["kind"] == "canvas"
                && view["nodes"]
                    .as_array()
                    .is_some_and(|nodes| nodes.iter().any(|node| node["id"] == request.source_id)))
    });
    let Some(source_view) = source_view else {
        return Err(RpcError::new(
            "chat-not-found",
            format!(
                "{} left the project while the fork was made",
                request.source_id
            ),
        ));
    };
    if request.as_view {
        let mut node = Map::from_iter([
            ("provider".to_owned(), json!(request.provider)),
            ("providerFixed".to_owned(), json!(true)),
        ]);
        if let Some(cwd) = request.cwd {
            node.insert("cwd".to_owned(), json!(cwd));
        }
        let view = json!({
            "kind": "chat",
            "id": request.fork_id,
            "name": request.title,
            "titleSource": "user",
            "node": node
        });
        let insert_at = source_view + 1;
        views.insert(insert_at, view);
        return Ok(ForkPlacementResult {
            node_id: request.fork_id.clone(),
            view_id: request.fork_id,
            edge_id: None,
        });
    }
    let canvas_id = request.canvas_id.as_deref().or_else(|| {
        (views[source_view]["kind"] == "canvas")
            .then(|| views[source_view]["id"].as_str())
            .flatten()
    });
    let Some(canvas_index) = canvas_id.and_then(|canvas_id| {
        views
            .iter()
            .position(|view| view["kind"] == "canvas" && view["id"] == canvas_id)
    }) else {
        return Err(RpcError::new(
            "not-on-a-canvas",
            "The fork target is not a canvas of this project",
        ));
    };
    let canvas = views[canvas_index].as_object_mut().unwrap();
    let nodes = canvas
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| RpcError::new("project-invalid", "The canvas has no nodes"))?;
    if nodes.len() >= 500 {
        return Err(RpcError::new(
            "canvas-full",
            "The canvas already holds the 500 nodes a canvas may hold",
        ));
    }
    let anchor = nodes
        .iter()
        .find(|node| node["id"] == request.source_id)
        .cloned();
    let (x, y) = free_chat_position(nodes, anchor.as_ref());
    let mut node = json!({
        "id": request.fork_id,
        "kind": "chat",
        "title": request.title,
        "titleSource": "user",
        "x": x,
        "y": y,
        "w": 480,
        "h": 520,
        "provider": request.provider,
        "providerFixed": true
    });
    if let Some(cwd) = request.cwd {
        node.as_object_mut()
            .unwrap()
            .insert("cwd".to_owned(), json!(cwd));
    }
    nodes.push(node);
    let edge_id = anchor.map(|_| potential_edge_id);
    if let Some(edge_id) = &edge_id {
        canvas
            .entry("edges")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id": edge_id,
                "from": request.source_id,
                "to": request.fork_id,
                "label": "context"
            }));
    }
    Ok(ForkPlacementResult {
        node_id: request.fork_id,
        view_id: canvas["id"].as_str().unwrap_or_default().to_owned(),
        edge_id,
    })
}

pub(super) fn free_chat_position(nodes: &[Value], anchor: Option<&Value>) -> (i64, i64) {
    free_position(nodes, anchor, 480.0, 520.0)
}

pub(super) fn free_position(
    nodes: &[Value],
    anchor: Option<&Value>,
    width: f64,
    height: f64,
) -> (i64, i64) {
    if let Some(anchor) = anchor {
        let y = anchor["y"].as_f64().unwrap_or(0.0).round() as i64;
        let mut x =
            (anchor["x"].as_f64().unwrap_or(0.0) + anchor["w"].as_f64().unwrap_or(0.0) + 40.0)
                .round() as i64;
        loop {
            let blocking = nodes
                .iter()
                .filter(|node| overlaps(x as f64, y as f64, width, height, node))
                .collect::<Vec<_>>();
            if blocking.is_empty() {
                return (x, y);
            }
            x = (blocking
                .iter()
                .map(|node| node["x"].as_f64().unwrap_or(0.0) + node["w"].as_f64().unwrap_or(0.0))
                .fold(f64::NEG_INFINITY, f64::max)
                + 40.0)
                .round() as i64;
        }
    }
    if nodes.is_empty() {
        return (0, 0);
    }
    let x = (nodes
        .iter()
        .map(|node| node["x"].as_f64().unwrap_or(0.0) + node["w"].as_f64().unwrap_or(0.0))
        .fold(f64::NEG_INFINITY, f64::max)
        + 40.0)
        .round() as i64;
    let y = nodes
        .iter()
        .map(|node| node["y"].as_f64().unwrap_or(0.0))
        .fold(f64::INFINITY, f64::min)
        .round() as i64;
    (x, y)
}

fn overlaps(x: f64, y: f64, w: f64, h: f64, node: &Value) -> bool {
    let other_x = node["x"].as_f64().unwrap_or(0.0);
    let other_y = node["y"].as_f64().unwrap_or(0.0);
    let other_w = node["w"].as_f64().unwrap_or(0.0);
    let other_h = node["h"].as_f64().unwrap_or(0.0);
    x < other_x + other_w + 40.0
        && other_x < x + w + 40.0
        && y < other_y + other_h + 40.0
        && other_y < y + h + 40.0
}

pub(super) fn project_has_id(content: &Value, id: &str) -> bool {
    content["views"].as_array().is_some_and(|views| {
        views.iter().any(|view| {
            view["id"] == id
                || ["nodes", "texts", "edges"].iter().any(|field| {
                    view[*field]
                        .as_array()
                        .is_some_and(|items| items.iter().any(|item| item["id"] == id))
                })
        })
    })
}

pub(super) fn fresh_id(prefix: &str, content: &Value) -> String {
    loop {
        let mut bytes = [0_u8; 8];
        rand::thread_rng().fill_bytes(&mut bytes);
        let suffix = bytes
            .iter()
            .map(|byte| char::from_digit((byte % 36) as u32, 36).unwrap())
            .collect::<String>();
        let id = format!("{prefix}-{suffix}");
        if !project_has_id(content, &id) {
            return id;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fork_placement_keeps_source_and_adds_context_edge() {
        let mut content = json!({
            "views": [{
                "id": "canvas",
                "kind": "canvas",
                "name": "Canvas",
                "nodes": [{ "id": "source", "kind": "chat", "title": "Source", "x": 0, "y": 0, "w": 480, "h": 520 }],
                "texts": [],
                "edges": []
            }]
        });
        let result = place_fork(
            &mut content,
            ForkPlacementRequest {
                project_id: "project".to_owned(),
                source_id: "source".to_owned(),
                fork_id: "fork".to_owned(),
                provider: "codex".to_owned(),
                title: "Fork".to_owned(),
                cwd: Some("/tmp/repo".to_owned()),
                as_view: false,
                canvas_id: None,
                worktree: None,
            },
        )
        .unwrap();
        assert_eq!(result.view_id, "canvas");
        assert_eq!(content["views"][0]["nodes"][1]["x"], 520);
        assert_eq!(content["views"][0]["edges"][0]["from"], "source");
        assert_eq!(content["views"][0]["edges"][0]["to"], "fork");
    }
}
