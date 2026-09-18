use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::rpc::RpcError;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkWorkspaceLocation {
    pub project_id: String,
    pub canvas_id: Option<String>,
    pub folder: String,
    pub title: Option<String>,
    pub lineage_depth: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkWorktreeRequest {
    pub cwd: String,
    pub branch: String,
    pub project_id: String,
    pub node_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkWorktree {
    pub record: Value,
    pub cwd: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPlacementRequest {
    pub project_id: String,
    pub source_id: String,
    pub fork_id: String,
    pub provider: String,
    pub title: String,
    pub cwd: Option<String>,
    pub as_view: bool,
    pub canvas_id: Option<String>,
    pub worktree: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPlacementResult {
    pub node_id: String,
    pub view_id: String,
    pub edge_id: Option<String>,
}

#[async_trait]
pub trait ChatForkWorkspaceHost: Send + Sync {
    async fn locate(&self, node_id: &str) -> Result<Option<ForkWorkspaceLocation>, RpcError>;
    async fn place_fork(
        &self,
        request: ForkPlacementRequest,
    ) -> Result<ForkPlacementResult, RpcError>;
    async fn branches(&self, cwd: &str) -> Result<Option<Vec<String>>, RpcError>;
    async fn add_worktree(&self, request: ForkWorktreeRequest) -> Result<ForkWorktree, RpcError>;
    async fn remove_worktree(&self, worktree: &Value) -> Result<(), RpcError>;
    async fn tree_exists(&self, cwd: &str, tree: &str) -> Result<bool, RpcError>;
    async fn take_tree(&self, cwd: &str) -> Result<Option<String>, RpcError>;
    async fn restore_tree(&self, cwd: &str, tree: &str) -> Result<(), RpcError>;
    async fn diff_tree(&self, cwd: &str, tree: &str) -> Result<Option<Value>, RpcError>;
    async fn copy_plans(&self, from_chat_id: &str, to_chat_id: &str) -> Result<(), RpcError>;
    async fn remove_plans(&self, chat_id: &str) -> Result<(), RpcError>;
}
