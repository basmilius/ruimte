use serde_json::{Value, json};

#[cfg(test)]
const MODES: [&str; 4] = ["supervised", "auto-accept-edits", "auto", "full-access"];
const MAX_AGENT_DEPTH: u64 = 2;
const MAX_TEAM_DEPTH: u64 = 1;
const MAX_OPENED_PER_CALLER: u64 = 16;
const NOT_RESUMED_PREFIX: &str = "This turn could not be resumed after the machine restarted: ";

#[derive(Debug, PartialEq)]
pub(crate) struct WorkflowRefusal {
    pub code: &'static str,
    pub message: String,
    pub lines: Vec<String>,
}

#[cfg(test)]
pub(crate) fn narrower_mode<'a>(mode: &'a str, ceiling: &'a str) -> &'a str {
    if mode_rank(mode) <= mode_rank(ceiling) {
        mode
    } else {
        ceiling
    }
}

#[cfg(test)]
pub(crate) fn mode_for_opening(
    mine: &str,
    requested: Option<&str>,
) -> Result<String, WorkflowRefusal> {
    if requested.is_some_and(|requested| mode_rank(requested) > mode_rank(mine)) {
        let requested = requested.unwrap();
        return Err(WorkflowRefusal {
            code: "mode-above-parent",
            message: format!(
                "You run in {mine} and --mode {requested} is wider; an agent you open runs in your mode or a narrower one"
            ),
            lines: std::iter::once(format!("mode\tyou\t{mine}"))
                .chain(
                    MODES
                        .iter()
                        .take(mode_rank(mine) + 1)
                        .map(|mode| format!("mode\t{mode}\tallowed")),
                )
                .collect(),
        });
    }
    Ok(mine.to_owned())
}

pub(crate) fn depth_for_opening(
    mine: u64,
    already: u64,
    verb: &str,
    making: u64,
) -> Result<u64, WorkflowRefusal> {
    let depth = mine + 1;
    let max = if verb == "team" {
        MAX_TEAM_DEPTH
    } else {
        MAX_AGENT_DEPTH
    };
    if depth > max {
        return Err(WorkflowRefusal {
            code: "too-deep",
            message: format!(
                "You sit at depth {mine} and {verb} would open agents at depth {depth}; {verb} opens up to depth {max}"
            ),
            lines: vec![
                format!("depth\tyou\t{mine}"),
                "depth\t0\ta node a person opened".to_owned(),
                format!("depth\tagent\topens up to depth {MAX_AGENT_DEPTH}"),
                format!("depth\tteam\topens up to depth {MAX_TEAM_DEPTH}"),
            ],
        });
    }
    if already + making > MAX_OPENED_PER_CALLER {
        return Err(WorkflowRefusal {
            code: "too-many-agents",
            message: format!(
                "You have {already} agent nodes open and this would open {making} more; one caller may have {MAX_OPENED_PER_CALLER} open at a time, and the count frees when a person removes them"
            ),
            lines: Vec::new(),
        });
    }
    Ok(depth)
}

pub(crate) fn result_of_turn(turn: &Value, items: &[Value], at: u64) -> Value {
    let turn_id = turn["id"].as_str().unwrap_or_default();
    let state = turn["state"].as_str().unwrap_or_default();
    let answer = items.iter().rev().find_map(|item| {
        let text = item.get("text")?.as_str()?.trim();
        (item["kind"] == "assistant"
            && item["turnId"] == turn_id
            && item.get("parentToolUseId").is_none()
            && !text.is_empty())
        .then(|| text.to_owned())
    });
    let last_note = |level: &str| {
        items.iter().rev().find_map(|item| {
            (item["kind"] == "note" && item["turnId"] == turn_id && item["level"] == level)
                .then(|| item["text"].as_str().unwrap_or_default().to_owned())
        })
    };
    let (status, text) = match state {
        "done" => (
            "done",
            answer.unwrap_or_else(|| "It ended its turn without an answer.".to_owned()),
        ),
        "aborted" => {
            let by_machine = items.iter().any(|item| {
                item["kind"] == "note"
                    && item["turnId"] == turn_id
                    && item["level"] == "warning"
                    && item["text"]
                        .as_str()
                        .is_some_and(|text| text.starts_with(NOT_RESUMED_PREFIX))
            });
            (
                "failed",
                if by_machine {
                    last_note("warning").unwrap_or_else(|| "The machine stopped it.".to_owned())
                } else {
                    "It was stopped before it finished.".to_owned()
                },
            )
        }
        _ => (
            "failed",
            last_note("error").unwrap_or_else(|| "Its turn ended in an error.".to_owned()),
        ),
    };
    json!({ "status": status, "result": { "text": text, "source": "turn", "at": at } })
}

#[cfg(test)]
fn mode_rank(mode: &str) -> usize {
    MODES
        .iter()
        .position(|candidate| *candidate == mode)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_rules_match_typescript_oracle() {
        let oracle: Value =
            serde_json::from_str(include_str!("fixtures/workflow-oracle.json")).unwrap();
        for case in oracle["modeCases"].as_array().unwrap() {
            let mine = case["mine"].as_str().unwrap();
            let requested = case["requested"].as_str();
            assert_eq!(
                outcome(mode_for_opening(mine, requested)),
                case["expected"],
                "mode {mine} {requested:?}"
            );
            if let Some(requested) = requested {
                assert_eq!(narrower_mode(requested, mine), case["narrowed"]);
            }
        }
        for case in oracle["depths"].as_array().unwrap() {
            assert_eq!(
                outcome(depth_for_opening(
                    case["mine"].as_u64().unwrap(),
                    case["already"].as_u64().unwrap(),
                    case["verb"].as_str().unwrap(),
                    case["making"].as_u64().unwrap(),
                )),
                case["expected"],
                "depth {case}"
            );
        }
        for case in oracle["taskResults"].as_array().unwrap() {
            assert_eq!(
                result_of_turn(
                    &case["turn"],
                    case["items"].as_array().unwrap(),
                    case["at"].as_u64().unwrap(),
                ),
                case["expected"],
                "task result {case}"
            );
        }
    }

    fn outcome(result: Result<impl Into<Value>, WorkflowRefusal>) -> Value {
        match result {
            Ok(value) => json!({ "ok": true, "value": value.into() }),
            Err(error) => json!({
                "ok": false,
                "code": error.code,
                "message": error.message,
                "lines": error.lines
            }),
        }
    }
}
