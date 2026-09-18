use async_trait::async_trait;

use crate::rpc::RpcError;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatLaunchFacts {
    pub has_context: bool,
    pub depth: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatTurnContext {
    pub change_note: Option<String>,
    pub notices: Vec<String>,
}

#[async_trait]
pub trait ChatContextHost: Send + Sync {
    async fn launch_facts(&self, chat_id: &str) -> Result<ChatLaunchFacts, RpcError>;
    async fn take_turn_context(&self, chat_id: &str) -> Result<ChatTurnContext, RpcError>;
    async fn stop_child(&self, node_id: &str, reason: &str) -> Result<(), RpcError>;
    async fn owe_interrupted_run(
        &self,
        _chat_id: &str,
        _turn_id: &str,
        _attempt: u32,
        _created_at: u64,
    ) -> Result<bool, RpcError> {
        Ok(false)
    }
}

pub fn chat_prompt(facts: &ChatLaunchFacts) -> String {
    let mut parts = vec![
        "Ruimte: `ruimte-context` is a command you run in your shell, not a tool. It reads context linked to you and places nodes on the canvas.".to_owned(),
        "`ruimte-context help` lists the verbs and nouns, and `ruimte-context help <verb or noun>` details one.".to_owned(),
    ];
    if facts.depth < 1 {
        parts.push("It also opens agents (`agent` for one, `team` for several in parallel), which is for work the person asked you to split or that truly runs in parallel: every agent is a node on their canvas until someone removes it, so answer yourself whatever you can.".to_owned());
    } else if facts.depth < 2 {
        parts.push("It also opens a helper agent with `agent`, which is for work the person asked you to split: that agent is a node on their canvas until someone removes it, so answer yourself whatever you can.".to_owned());
    }
    if facts.depth < 2 {
        parts.push("With `--task` a result comes back as your next message once it settles, so end your turn instead of polling.".to_owned());
    }
    parts.push("Ids in its output are for your commands; to the person, name things by their title, never by id.".to_owned());
    if facts.has_context {
        parts.push("The person linked context to this chat on their canvas. Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item, whenever it could help.".to_owned());
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_prompt_obeys_depth_and_context() {
        let root = chat_prompt(&ChatLaunchFacts {
            has_context: true,
            depth: 0,
        });
        assert!(root.contains("team"));
        assert!(root.contains("person linked context"));
        let deepest = chat_prompt(&ChatLaunchFacts {
            has_context: false,
            depth: 2,
        });
        assert!(!deepest.contains("opens a helper"));
        assert!(!deepest.contains("--task"));
    }
}
