use std::collections::HashSet;

use rand::{Rng, distributions::Alphanumeric};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone)]
pub(crate) struct PlanRefusal {
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn apply_plan_ops(
    plan: &Value,
    ops: &[Value],
    actor: &str,
    now: &str,
) -> Result<Value, PlanRefusal> {
    if ops.is_empty() {
        return Err(refuse(
            "plan-invalid",
            "A plan operation batch may not be empty",
        ));
    }
    let mut next = plan.clone();
    let mut dropped = Vec::<String>::new();
    let mut minted = Vec::<String>::new();
    for op in ops {
        can_apply(&next, op, actor)?;
        apply_one(&mut next, op, actor, now, &mut minted, &mut dropped)?;
    }
    prune_empty_steps(next["items"].as_array_mut().unwrap());
    next.as_object_mut().unwrap().insert(
        "rev".to_owned(),
        json!(plan["rev"].as_u64().unwrap_or(0) + 1),
    );
    validate_structure(&next)?;
    Ok(json!({ "ok": true, "plan": next, "minted": minted, "dropped": dropped }))
}

fn can_apply(plan: &Value, op: &Value, actor: &str) -> Result<(), PlanRefusal> {
    let operation = op["op"].as_str().unwrap_or_default();
    let allowed = if actor == "person" {
        matches!(operation, "set" | "note" | "unlock")
    } else {
        matches!(
            operation,
            "set" | "note" | "add" | "edit" | "move" | "remove" | "meta"
        )
    };
    if !allowed {
        return Err(refuse(
            "op-not-allowed",
            if actor == "person" {
                format!("A person cannot {operation} in a plan")
            } else {
                format!("An agent cannot {operation} a plan")
            },
        ));
    }
    match operation {
        "set" => {
            if actor == "person" && op.get("next").is_some() {
                return Err(refuse(
                    "op-not-allowed",
                    "Only the agent moves on to a next step",
                ));
            }
            let mut targets = op["ids"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|id| (id, op["state"].as_str().unwrap_or_default()))
                .collect::<Vec<_>>();
            if let Some(next) = op.get("next").and_then(Value::as_str) {
                targets.push((next, "active"));
            }
            for (id, state) in targets {
                let step = step_for(plan, id, true)?;
                may_state(plan, step, state, actor)?;
            }
        }
        "note" => {
            step_for(plan, op["id"].as_str().unwrap_or_default(), false)?;
        }
        "unlock" => {
            if let Some(ids) = op["ids"].as_array() {
                for id in ids.iter().filter_map(Value::as_str) {
                    step_for(plan, id, false)?;
                }
            }
        }
        "add" => may_hold_children(plan, op.get("under").and_then(Value::as_str))?,
        "edit" => {
            let id = op["id"].as_str().unwrap_or_default();
            let item = find_item(&plan["items"], id).ok_or_else(|| {
                refuse(
                    "plan-missing-item",
                    format!("The plan has no item \"{id}\""),
                )
            })?;
            if let Some(checks) = op.get("checks").and_then(Value::as_str)
                && item["type"] == "step"
            {
                if item["unlocked"] == true && checks != "anyone" {
                    return Err(refuse(
                        "unlocked-by-person",
                        format!("A person unlocked \"{id}\", so anyone checks it"),
                    ));
                }
                if effective_checks(plan, item) == "person" && checks != "person" {
                    return Err(refuse(
                        "person-only",
                        format!("Only a person checks \"{id}\", and that stays so"),
                    ));
                }
            }
        }
        "move" => {
            let id = op["id"].as_str().unwrap_or_default();
            if find_item(&plan["items"], id).is_none() {
                return Err(refuse(
                    "plan-missing-item",
                    format!("The plan has no item \"{id}\""),
                ));
            }
            may_hold_children(plan, op.get("under").and_then(Value::as_str))?;
        }
        "remove" => {
            let id = op["id"].as_str().unwrap_or_default();
            let item = find_item(&plan["items"], id).ok_or_else(|| {
                refuse(
                    "plan-missing-item",
                    format!("The plan has no item \"{id}\""),
                )
            })?;
            if holds_person_state(item) {
                return Err(refuse(
                    "set-by-person",
                    format!("A person checked \"{id}\" or a step under it, so it stays"),
                ));
            }
        }
        "meta" => {
            if let Some(checks) = op.get("checks").and_then(Value::as_str)
                && checks != "person"
                && plan["meta"]["checks"] == "person"
                && all_items(&plan["items"]).into_iter().any(|step| {
                    step["type"] == "step"
                        && step.get("checks").is_none()
                        && step["unlocked"] != true
                })
            {
                return Err(refuse(
                    "person-only",
                    "Only a person checks the steps of this plan, and that stays so",
                ));
            }
        }
        _ => return Err(refuse("plan-invalid", "Unknown plan operation")),
    }
    Ok(())
}

fn may_state(plan: &Value, step: &Value, state: &str, actor: &str) -> Result<(), PlanRefusal> {
    let id = step["id"].as_str().unwrap_or_default();
    let checks = effective_checks(plan, step);
    if actor == "person" {
        if checks == "agent" {
            return Err(refuse(
                "step-locked",
                format!("Only the agent checks \"{id}\" until a person unlocks it"),
            ));
        }
        return Ok(());
    }
    if checks == "person" {
        return Err(refuse(
            "person-only",
            format!("Only a person checks \"{id}\""),
        ));
    }
    if step["by"] == "person"
        && step.get("state").is_some()
        && step["state"].as_str() != Some(state)
    {
        return Err(refuse(
            "set-by-person",
            format!(
                "A person set \"{id}\" to {}; add a note or ask in the chat instead",
                step["state"].as_str().unwrap_or_default()
            ),
        ));
    }
    Ok(())
}

fn may_hold_children(plan: &Value, under: Option<&str>) -> Result<(), PlanRefusal> {
    let Some(under) = under else {
        return Ok(());
    };
    if let Some(item) = find_item(&plan["items"], under)
        && item["type"] == "step"
        && !is_parent(item)
        && holds_person_state(item)
    {
        return Err(refuse(
            "set-by-person",
            format!(
                "A person set \"{under}\" to {}; a sub-step would take that state away",
                item["state"].as_str().unwrap_or_default()
            ),
        ));
    }
    Ok(())
}

fn step_for<'a>(plan: &'a Value, id: &str, leaf: bool) -> Result<&'a Value, PlanRefusal> {
    let item = find_item(&plan["items"], id).ok_or_else(|| {
        refuse(
            "plan-missing-item",
            format!("The plan has no item \"{id}\""),
        )
    })?;
    if item["type"] != "step" {
        return Err(refuse(
            "plan-not-a-step",
            format!(
                "\"{id}\" is a {}, not a step",
                item["type"].as_str().unwrap_or_default()
            ),
        ));
    }
    if leaf && is_parent(item) {
        return Err(refuse(
            "plan-parent-state",
            format!("The step \"{id}\" has sub-steps, so its state follows from them"),
        ));
    }
    Ok(item)
}

fn apply_one(
    plan: &mut Value,
    op: &Value,
    actor: &str,
    now: &str,
    minted: &mut Vec<String>,
    dropped: &mut Vec<String>,
) -> Result<(), PlanRefusal> {
    match op["op"].as_str().unwrap_or_default() {
        "set" => {
            for id in op["ids"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
            {
                let step = find_item_mut(&mut plan["items"], id).unwrap();
                set_state(step, op["state"].as_str().unwrap(), actor, now);
                if let Some(note) = op.get("note").and_then(Value::as_str) {
                    set_note(step, note);
                }
            }
            if let Some(id) = op.get("next").and_then(Value::as_str) {
                set_state(
                    find_item_mut(&mut plan["items"], id).unwrap(),
                    "active",
                    actor,
                    now,
                );
            }
        }
        "note" => set_note(
            find_item_mut(&mut plan["items"], op["id"].as_str().unwrap()).unwrap(),
            op["text"].as_str().unwrap(),
        ),
        "unlock" => {
            let ids = if op["ids"] == "all" {
                all_step_ids(&plan["items"])
            } else {
                op["ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str)
                    .flat_map(|id| {
                        find_item(&plan["items"], id)
                            .map(all_step_ids)
                            .unwrap_or_default()
                    })
                    .collect()
            };
            for id in ids {
                let checks = {
                    let step = find_item(&plan["items"], &id).unwrap();
                    effective_checks(plan, step).to_owned()
                };
                if checks == "agent" {
                    find_item_mut(&mut plan["items"], &id)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .insert("unlocked".to_owned(), json!(true));
                }
            }
        }
        "remove" => {
            let id = op["id"].as_str().unwrap();
            remove_item(plan["items"].as_array_mut().unwrap(), id).unwrap();
        }
        "meta" => {
            let meta = plan["meta"].as_object_mut().unwrap();
            if let Some(title) = op.get("title") {
                meta.insert("title".to_owned(), title.clone());
            }
            for key in ["summary", "status"] {
                if let Some(value) = op.get(key).and_then(Value::as_str) {
                    if value.is_empty() {
                        meta.remove(key);
                    } else {
                        meta.insert(key.to_owned(), json!(value));
                    }
                }
            }
            if let Some(checks) = op.get("checks") {
                meta.insert("checks".to_owned(), checks.clone());
            }
        }
        "add" => apply_add(plan, op, minted, dropped)?,
        "edit" => apply_edit(plan, op)?,
        "move" => apply_move(plan, op, dropped)?,
        _ => {}
    }
    Ok(())
}

fn set_state(step: &mut Value, state: &str, actor: &str, now: &str) {
    if actor == "agent" && step["by"] == "person" && step["state"] == state {
        return;
    }
    let step = step.as_object_mut().unwrap();
    step.insert("state".to_owned(), json!(state));
    if actor == "person" && state == "open" {
        step.remove("by");
        step.remove("at");
    } else {
        step.insert("by".to_owned(), json!(actor));
        step.insert("at".to_owned(), json!(now));
    }
}

fn set_note(step: &mut Value, text: &str) {
    if text.is_empty() {
        step.as_object_mut().unwrap().remove("note");
    } else {
        step.as_object_mut()
            .unwrap()
            .insert("note".to_owned(), json!(text));
    }
}

fn apply_add(
    plan: &mut Value,
    op: &Value,
    minted: &mut Vec<String>,
    dropped: &mut Vec<String>,
) -> Result<(), PlanRefusal> {
    let id = if let Some(id) = op.get("id").and_then(Value::as_str) {
        if find_item(&plan["items"], id).is_some() {
            return Err(refuse(
                "duplicate-id",
                format!("The plan already has an item \"{id}\""),
            ));
        }
        id.to_owned()
    } else {
        loop {
            let id = random_item_id();
            if find_item(&plan["items"], &id).is_none() {
                minted.push(id.clone());
                break id;
            }
        }
    };
    let kind = op["type"].as_str().unwrap();
    if op.get("checks").is_some() && kind != "step" {
        return Err(refuse("plan-invalid", "Only a step has checks"));
    }
    let mut item = json!({ "type": kind, "id": id, "title": op["title"] });
    if let Some(description) = op.get("description").and_then(Value::as_str)
        && !description.is_empty()
    {
        item.as_object_mut()
            .unwrap()
            .insert("description".to_owned(), json!(description));
    }
    if kind == "section" {
        item.as_object_mut()
            .unwrap()
            .insert("items".to_owned(), json!([]));
    }
    if kind == "step"
        && let Some(checks) = op.get("checks")
    {
        item.as_object_mut()
            .unwrap()
            .insert("checks".to_owned(), checks.clone());
    }
    insert_item(
        plan,
        item,
        op.get("under").and_then(Value::as_str),
        op.get("after").and_then(Value::as_str),
        dropped,
    )
}

fn apply_edit(plan: &mut Value, op: &Value) -> Result<(), PlanRefusal> {
    let item = find_item_mut(&mut plan["items"], op["id"].as_str().unwrap()).unwrap();
    let object = item.as_object_mut().unwrap();
    if let Some(title) = op.get("title") {
        object.insert("title".to_owned(), title.clone());
    }
    if let Some(description) = op.get("description").and_then(Value::as_str) {
        if description.is_empty() {
            object.remove("description");
        } else {
            object.insert("description".to_owned(), json!(description));
        }
    }
    if let Some(checks) = op.get("checks") {
        if object.get("type").and_then(Value::as_str) != Some("step") {
            return Err(refuse("plan-invalid", "Only a step has checks"));
        }
        object.insert("checks".to_owned(), checks.clone());
    }
    Ok(())
}

fn apply_move(plan: &mut Value, op: &Value, dropped: &mut Vec<String>) -> Result<(), PlanRefusal> {
    let id = op["id"].as_str().unwrap();
    let under = op.get("under").and_then(Value::as_str);
    if op.get("after").and_then(Value::as_str) == Some(id)
        || under.is_some_and(|under| {
            find_item(&plan["items"], id).is_some_and(|item| find_item(item, under).is_some())
        })
    {
        return Err(refuse(
            "plan-bad-position",
            format!("\"{id}\" cannot move into itself"),
        ));
    }
    let item = remove_item(plan["items"].as_array_mut().unwrap(), id).unwrap();
    insert_item(
        plan,
        item,
        under,
        op.get("after").and_then(Value::as_str),
        dropped,
    )
}

fn insert_item(
    plan: &mut Value,
    item: Value,
    under: Option<&str>,
    after: Option<&str>,
    dropped: &mut Vec<String>,
) -> Result<(), PlanRefusal> {
    let kind = item["type"].as_str().unwrap();
    if let Some(under) = under {
        let parent = find_item_mut(&mut plan["items"], under).ok_or_else(|| {
            refuse(
                "plan-missing-item",
                format!("The plan has no item \"{under}\""),
            )
        })?;
        if parent["type"] == "text" {
            return Err(refuse(
                "plan-bad-position",
                format!("\"{under}\" is a text block, which holds no items"),
            ));
        }
        if kind == "section" {
            return Err(refuse(
                "plan-bad-position",
                "A section only stands at the top of a plan",
            ));
        }
        if kind == "text" && parent["type"] == "step" {
            return Err(refuse(
                "plan-bad-position",
                "A step only holds steps, not a text block",
            ));
        }
        let key = if parent["type"] == "section" {
            "items"
        } else {
            "steps"
        };
        if parent.get(key).is_none() {
            parent
                .as_object_mut()
                .unwrap()
                .insert(key.to_owned(), json!([]));
        }
        let first_child = {
            let siblings = parent[key].as_array_mut().unwrap();
            let index = after.map_or(siblings.len(), |after| {
                siblings
                    .iter()
                    .position(|candidate| candidate["id"] == after)
                    .map(|index| index + 1)
                    .unwrap_or(usize::MAX)
            });
            if index == usize::MAX {
                return Err(refuse(
                    "plan-bad-position",
                    format!("\"{}\" is not directly under \"{under}\"", after.unwrap()),
                ));
            }
            siblings.insert(index, item);
            siblings.len() == 1
        };
        if parent["type"] == "step" && first_child {
            let object = parent.as_object_mut().unwrap();
            if object.remove("state").is_some() {
                dropped.push(under.to_owned());
            }
            object.remove("by");
            object.remove("at");
        }
        return Ok(());
    }
    if let Some(after) = after {
        if insert_after(plan["items"].as_array_mut().unwrap(), after, item) {
            return Ok(());
        }
        return Err(refuse(
            "plan-missing-item",
            format!("The plan has no item \"{after}\""),
        ));
    }
    plan["items"].as_array_mut().unwrap().push(item);
    Ok(())
}

fn insert_after(items: &mut Vec<Value>, after: &str, item: Value) -> bool {
    if let Some(index) = items.iter().position(|candidate| candidate["id"] == after) {
        items.insert(index + 1, item);
        return true;
    }
    for candidate in items {
        for key in ["items", "steps"] {
            if let Some(children) = candidate.get_mut(key).and_then(Value::as_array_mut)
                && insert_after(children, after, item.clone())
            {
                return true;
            }
        }
    }
    false
}

fn remove_item(items: &mut Vec<Value>, id: &str) -> Option<Value> {
    if let Some(index) = items.iter().position(|item| item["id"] == id) {
        return Some(items.remove(index));
    }
    for item in items {
        for key in ["items", "steps"] {
            if let Some(children) = item.get_mut(key).and_then(Value::as_array_mut)
                && let Some(found) = remove_item(children, id)
            {
                return Some(found);
            }
        }
    }
    None
}

fn prune_empty_steps(items: &mut [Value]) {
    for item in items {
        if let Some(children) = item.get_mut("items").and_then(Value::as_array_mut) {
            prune_empty_steps(children);
        }
        if let Some(children) = item.get_mut("steps").and_then(Value::as_array_mut) {
            prune_empty_steps(children);
            if children.is_empty() {
                item.as_object_mut().unwrap().remove("steps");
            }
        }
    }
}

fn validate_structure(plan: &Value) -> Result<(), PlanRefusal> {
    let mut ids = HashSet::new();
    let mut count = 0;
    validate_items(
        plan["items"].as_array().unwrap(),
        0,
        "top",
        &mut ids,
        &mut count,
    )
}

fn validate_items(
    items: &[Value],
    depth: usize,
    inside: &str,
    ids: &mut HashSet<String>,
    count: &mut usize,
) -> Result<(), PlanRefusal> {
    for item in items {
        *count += 1;
        if *count > 300 {
            return Err(refuse("plan-too-large", "A plan holds at most 300 items"));
        }
        let id = item["id"].as_str().unwrap_or_default();
        if !ids.insert(id.to_owned()) {
            return Err(refuse(
                "duplicate-id",
                format!("Two items share the id \"{id}\""),
            ));
        }
        match item["type"].as_str().unwrap_or_default() {
            "section" => {
                if inside != "top" {
                    return Err(refuse(
                        "plan-bad-position",
                        format!(
                            "The section \"{id}\" is not at the top of the plan; sections do not nest"
                        ),
                    ));
                }
                validate_items(
                    item["items"].as_array().unwrap(),
                    depth,
                    "section",
                    ids,
                    count,
                )?;
            }
            "text" if inside == "step" => {
                return Err(refuse(
                    "plan-bad-position",
                    format!("The text block \"{id}\" is under a step; a step only holds steps"),
                ));
            }
            "step" => {
                if depth + 1 > 5 {
                    return Err(refuse(
                        "plan-too-deep",
                        format!(
                            "The step \"{id}\" is {} levels deep; steps go at most 5 levels deep",
                            depth + 1
                        ),
                    ));
                }
                if is_parent(item)
                    && (item.get("state").is_some()
                        || item.get("by").is_some()
                        || item.get("at").is_some())
                {
                    return Err(refuse(
                        "plan-parent-state",
                        format!("The step \"{id}\" has sub-steps, so its state follows from them"),
                    ));
                }
                if let Some(children) = item.get("steps").and_then(Value::as_array) {
                    validate_items(children, depth + 1, "step", ids, count)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn plan_progress(items: &Value) -> Value {
    let mut counts = Map::from_iter([
        ("total".to_owned(), json!(0)),
        ("open".to_owned(), json!(0)),
        ("active".to_owned(), json!(0)),
        ("done".to_owned(), json!(0)),
        ("failed".to_owned(), json!(0)),
        ("skipped".to_owned(), json!(0)),
        ("blocked".to_owned(), json!(0)),
        ("warning".to_owned(), json!(0)),
        ("info".to_owned(), json!(0)),
        ("finished".to_owned(), json!(0)),
    ]);
    for step in all_items(items)
        .into_iter()
        .filter(|item| item["type"] == "step" && !is_parent(item))
    {
        let state = step.get("state").and_then(Value::as_str).unwrap_or("open");
        increment(&mut counts, "total");
        increment(&mut counts, state);
        if matches!(state, "done" | "failed" | "skipped" | "warning" | "info") {
            increment(&mut counts, "finished");
        }
    }
    Value::Object(counts)
}

#[cfg(test)]
pub(crate) fn plan_to_markdown(plan: &Value) -> String {
    let mut blocks = vec![format!(
        "# {}",
        plan["meta"]["title"].as_str().unwrap_or_default()
    )];
    if let Some(summary) = plan["meta"].get("summary").and_then(Value::as_str) {
        blocks.push(summary.to_owned());
    }
    let mut loose = Vec::new();
    let mut in_section = false;
    for item in plan["items"].as_array().unwrap() {
        if item["type"] != "section" {
            loose.push(item);
            continue;
        }
        flush_markdown_items(&mut blocks, &mut loose, in_section);
        blocks.push(format!("## {}", item["title"].as_str().unwrap_or_default()));
        if let Some(description) = item.get("description").and_then(Value::as_str) {
            blocks.push(description.to_owned());
        }
        markdown_items(item["items"].as_array().unwrap(), &mut blocks);
        in_section = true;
    }
    flush_markdown_items(&mut blocks, &mut loose, in_section);
    format!("{}\n", blocks.join("\n\n"))
}

pub(crate) fn parse_plan_markdown(markdown: &str) -> Result<Value, PlanRefusal> {
    let mut draft = json!({ "items": [] });
    let mut section: Option<Value> = None;
    let mut stack = Vec::<(usize, Value)>::new();
    let mut text_active = false;

    fn append_root(draft: &mut Value, section: &mut Option<Value>, item: Value) {
        if let Some(section) = section {
            section["items"].as_array_mut().unwrap().push(item);
        } else {
            draft["items"].as_array_mut().unwrap().push(item);
        }
    }

    fn pop_to(
        indent: usize,
        stack: &mut Vec<(usize, Value)>,
        draft: &mut Value,
        section: &mut Option<Value>,
    ) {
        while stack.last().is_some_and(|(width, _)| *width >= indent) {
            let (_, child) = stack.pop().unwrap();
            if let Some((_, parent)) = stack.last_mut() {
                if parent.get("steps").is_none() {
                    parent["steps"] = json!([]);
                }
                parent["steps"].as_array_mut().unwrap().push(child);
            } else {
                append_root(draft, section, child);
            }
        }
    }

    fn finish_section(draft: &mut Value, section: &mut Option<Value>) {
        if let Some(section) = section.take() {
            draft["items"].as_array_mut().unwrap().push(section);
        }
    }

    fn append_text_field(value: &mut Value, key: &str, line: &str) {
        let next = value
            .get(key)
            .and_then(Value::as_str)
            .map_or_else(|| line.to_owned(), |current| format!("{current}\n{line}"));
        value[key] = json!(next);
    }

    fn indent_of(line: &str) -> usize {
        line.chars()
            .take_while(|character| matches!(character, ' ' | '\t'))
            .map(|character| if character == '\t' { 4 } else { 1 })
            .sum()
    }

    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    for (line_index, line) in normalized.lines().enumerate() {
        let raw = line.trim_end();
        let content = raw.trim();
        let indent = indent_of(raw);
        let invalid = |message: &str| {
            refuse(
                "plan-invalid",
                format!("Line {}: {message}", line_index + 1),
            )
        };
        if content.is_empty() {
            text_active = false;
            continue;
        }
        if indent < 4 && content.starts_with('#') {
            let hashes = content
                .chars()
                .take_while(|character| *character == '#')
                .count();
            if content.chars().nth(hashes) == Some(' ') && (1..=6).contains(&hashes) {
                pop_to(0, &mut stack, &mut draft, &mut section);
                text_active = false;
                let title = content[hashes + 1..].trim();
                if hashes == 1
                    && draft
                        .get("meta")
                        .and_then(|meta| meta.get("title"))
                        .is_none()
                    && draft["items"].as_array().unwrap().is_empty()
                    && section.is_none()
                {
                    if draft.get("meta").is_none() {
                        draft["meta"] = json!({});
                    }
                    draft["meta"]["title"] = json!(title);
                } else if hashes == 2 {
                    finish_section(&mut draft, &mut section);
                    section = Some(json!({ "type": "section", "title": title, "items": [] }));
                } else {
                    return Err(invalid(
                        "only one \"#\" title before everything else and \"##\" sections are headings in a plan",
                    ));
                }
                continue;
            }
        }
        let rule = content.chars().all(|character| character == '-')
            || content.chars().all(|character| character == '*')
            || content.chars().all(|character| character == '_');
        if indent < 4 && content.len() >= 3 && rule {
            pop_to(0, &mut stack, &mut draft, &mut section);
            finish_section(&mut draft, &mut section);
            text_active = false;
            continue;
        }
        if let Some(rest) = content
            .strip_prefix("- ")
            .or_else(|| content.strip_prefix("* "))
            .or_else(|| content.strip_prefix("+ "))
        {
            text_active = false;
            let marker_syntax = rest.starts_with('[')
                && rest.as_bytes().get(2) == Some(&b']')
                && rest
                    .get(3..)
                    .and_then(|tail| tail.chars().next())
                    .is_some_and(char::is_whitespace);
            let (state, title) = if marker_syntax {
                let marker = rest.chars().nth(1).unwrap();
                let state = match marker {
                    ' ' => None,
                    'x' | 'X' => Some("done"),
                    '~' => Some("active"),
                    '!' => Some("failed"),
                    '-' => Some("skipped"),
                    '?' => Some("blocked"),
                    'w' | 'W' => Some("warning"),
                    'i' | 'I' => Some("info"),
                    _ => return Err(invalid(&format!("\"[{marker}]\" is not a step marker"))),
                };
                (state, rest[3..].trim())
            } else {
                (None, rest.trim())
            };
            if title.is_empty() {
                return Err(invalid("a step needs a title"));
            }
            pop_to(indent, &mut stack, &mut draft, &mut section);
            let mut step = json!({ "type": "step", "title": title });
            if let Some(state) = state {
                step["state"] = json!(state);
            }
            stack.push((indent, step));
            continue;
        }
        let quote = content.strip_prefix('>').map(|value| value.trim_start());
        pop_to(indent, &mut stack, &mut draft, &mut section);
        if indent > 0
            && let Some((_, owner)) = stack.last_mut()
        {
            if let Some(quote) = quote {
                append_text_field(owner, "note", quote);
            } else {
                append_text_field(owner, "description", content);
            }
            continue;
        }
        pop_to(0, &mut stack, &mut draft, &mut section);
        if let Some(quote) = quote {
            if let Some(after) = quote.strip_prefix("**")
                && let Some(end) = after.find("**")
            {
                let title = after[..end].trim();
                let description = after[end + 2..].trim();
                let mut text = json!({ "type": "text", "title": title });
                if !description.is_empty() {
                    text["description"] = json!(description);
                }
                append_root(&mut draft, &mut section, text);
                text_active = true;
            } else if text_active {
                let items = if let Some(section) = section.as_mut() {
                    section["items"].as_array_mut().unwrap()
                } else {
                    draft["items"].as_array_mut().unwrap()
                };
                append_text_field(items.last_mut().unwrap(), "description", quote);
            } else {
                return Err(invalid(
                    "a text block starts with a bold title: > **Title** description",
                ));
            }
            continue;
        }
        if section.is_none() && draft["items"].as_array().unwrap().is_empty() {
            if draft.get("meta").is_none() {
                draft["meta"] = json!({});
            }
            append_text_field(&mut draft["meta"], "summary", content);
        } else if section
            .as_ref()
            .is_some_and(|section| section["items"].as_array().unwrap().is_empty())
        {
            append_text_field(section.as_mut().unwrap(), "description", content);
        } else {
            return Err(invalid(
                "this line is not a step, a section, a text block or a description",
            ));
        }
    }
    pop_to(0, &mut stack, &mut draft, &mut section);
    finish_section(&mut draft, &mut section);
    clear_draft_parent_states(&mut draft["items"]);
    Ok(draft)
}

fn clear_draft_parent_states(items: &mut Value) {
    for item in items.as_array_mut().into_iter().flatten() {
        if item["type"] == "section" {
            clear_draft_parent_states(&mut item["items"]);
        } else if item["type"] == "step" && item.get("steps").is_some() {
            item.as_object_mut().unwrap().remove("state");
            clear_draft_parent_states(&mut item["steps"]);
        }
    }
}

pub(crate) fn render_plan_text(plan: &Value) -> String {
    let progress = plan_progress(&plan["items"]);
    let mut lines = vec![format!(
        "Plan \"{}\" ({}, {}, rev {}): {}",
        plan["meta"]["title"].as_str().unwrap_or_default(),
        plan["id"].as_str().unwrap_or_default(),
        plan["meta"]["kind"].as_str().unwrap_or_default(),
        plan["rev"].as_u64().unwrap_or(0),
        progress_text(plan, &progress)
    )];
    let mut second = Vec::new();
    if let Some(status) = plan["meta"].get("status").and_then(Value::as_str) {
        second.push(format!("Status: {status}"));
    }
    let active = all_items(&plan["items"])
        .into_iter()
        .filter(|item| item["type"] == "step" && !is_parent(item) && item["state"] == "active")
        .filter_map(|item| item["id"].as_str())
        .collect::<Vec<_>>();
    if !active.is_empty() {
        second.push(format!("Now: {}", active.join(", ")));
    }
    if !second.is_empty() {
        let last = second.len().saturating_sub(1);
        for (index, part) in second.iter_mut().enumerate() {
            if index < last && !part.ends_with(['.', '!', '?']) {
                part.push('.');
            }
        }
        lines.push(second.join(" "));
    }
    let mut loose = Vec::new();
    for item in plan["items"].as_array().into_iter().flatten() {
        if item["type"] != "section" {
            loose.push(item);
            continue;
        }
        flush_plan_text_items(plan, &mut lines, &mut loose, "");
        let section_progress = plan_progress(&item["items"]);
        let count = if section_progress["total"].as_u64().unwrap_or(0) > 0 {
            format!(
                " {}/{}",
                section_progress["finished"].as_u64().unwrap_or(0),
                section_progress["total"].as_u64().unwrap_or(0)
            )
        } else {
            String::new()
        };
        lines.push(String::new());
        lines.push(format!(
            "## {} [{}]{count}",
            item["title"].as_str().unwrap_or_default(),
            item["id"].as_str().unwrap_or_default()
        ));
        let mut section = item["items"]
            .as_array()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        plan_text_items(plan, &mut lines, &mut section, "  ");
    }
    flush_plan_text_items(plan, &mut lines, &mut loose, "");
    lines.join("\n")
}

fn flush_plan_text_items(
    plan: &Value,
    lines: &mut Vec<String>,
    items: &mut Vec<&Value>,
    indent: &str,
) {
    if items.is_empty() {
        return;
    }
    lines.push(String::new());
    plan_text_items(plan, lines, items, indent);
    items.clear();
}

fn plan_text_items(plan: &Value, lines: &mut Vec<String>, items: &mut Vec<&Value>, indent: &str) {
    let mut number = 0;
    for item in items {
        if item["type"] == "text" {
            let description = item
                .get("description")
                .and_then(Value::as_str)
                .map(one_line)
                .map(|text| format!(": {text}"))
                .unwrap_or_default();
            lines.push(format!(
                "{indent}{} [{}]{description}",
                item["title"].as_str().unwrap_or_default(),
                item["id"].as_str().unwrap_or_default()
            ));
        } else if item["type"] == "step" {
            number += 1;
            plan_step_line(plan, lines, item, &number.to_string(), indent);
        }
    }
}

fn plan_step_line(plan: &Value, lines: &mut Vec<String>, step: &Value, number: &str, indent: &str) {
    let marker = match step_state(step).as_str() {
        "active" => "[~]",
        "done" => "[x]",
        "failed" => "[!]",
        "skipped" => "[-]",
        "blocked" => "[?]",
        "warning" => "[w]",
        "info" => "[i]",
        _ => "[ ]",
    };
    let mut line = format!(
        "{indent}{marker} {number} {} [{}]",
        step["title"].as_str().unwrap_or_default(),
        step["id"].as_str().unwrap_or_default()
    );
    if is_parent(step) {
        let progress = plan_progress(&step["steps"]);
        line.push_str(&format!(
            " {}/{}",
            progress["finished"].as_u64().unwrap_or(0),
            progress["total"].as_u64().unwrap_or(0)
        ));
    } else if !plan.is_null() {
        let mut notes = Vec::new();
        let checks = effective_checks(plan, step);
        if checks != "anyone" {
            notes.push(format!("{checks}-only"));
        } else if step["unlocked"] == true {
            notes.push("unlocked".to_owned());
        }
        if step["by"] == "person" && step.get("state").is_some() {
            let at = step
                .get("at")
                .and_then(Value::as_str)
                .and_then(|at| at.get(11..16));
            notes.push(at.map_or_else(
                || "set by a person".to_owned(),
                |at| format!("set by a person {at}"),
            ));
        }
        if !notes.is_empty() {
            line.push(' ');
            line.push_str(&notes.join(", "));
        }
    }
    if let Some(note) = step.get("note").and_then(Value::as_str) {
        line.push_str(&format!(": \"{}\"", one_line(note)));
    }
    lines.push(line);
    if let Some(children) = step.get("steps").and_then(Value::as_array) {
        for (index, child) in children.iter().enumerate() {
            plan_step_line(
                plan,
                lines,
                child,
                &format!("{number}.{}", index + 1),
                &format!("{indent}  "),
            );
        }
    }
}

pub(crate) fn progress_text(plan: &Value, progress: &Value) -> String {
    let count = |key| progress[key].as_u64().unwrap_or(0);
    let mut parts = if plan["meta"]["kind"] == "test" {
        vec![
            format!("{} of {} run", count("finished"), count("total")),
            format!("{} passed", count("done")),
        ]
    } else {
        vec![format!(
            "{} of {} done",
            count("done") + count("warning") + count("info"),
            count("total")
        )]
    };
    for (key, singular, plural) in if plan["meta"]["kind"] == "test" {
        vec![
            ("warning", "warning", "warnings"),
            ("info", "info", "info"),
            ("failed", "failed", "failed"),
            ("skipped", "skipped", "skipped"),
            ("blocked", "blocked", "blocked"),
        ]
    } else {
        vec![
            ("warning", "with a warning", "with warnings"),
            ("info", "with info", "with info"),
            ("failed", "failed", "failed"),
            ("skipped", "skipped", "skipped"),
            ("blocked", "blocked", "blocked"),
        ]
    } {
        let value = count(key);
        if value > 0 {
            parts.push(format!(
                "{value} {}",
                if value == 1 { singular } else { plural }
            ));
        }
    }
    parts.join(", ")
}

fn one_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
fn flush_markdown_items(blocks: &mut Vec<String>, loose: &mut Vec<&Value>, in_section: bool) {
    if loose.is_empty() {
        return;
    }
    if in_section {
        blocks.push("---".to_owned());
    }
    markdown_items_refs(loose, blocks);
    loose.clear();
}

#[cfg(test)]
fn markdown_items(items: &[Value], blocks: &mut Vec<String>) {
    markdown_items_refs(&items.iter().collect::<Vec<_>>(), blocks);
}

#[cfg(test)]
fn markdown_items_refs(items: &[&Value], blocks: &mut Vec<String>) {
    let mut list = Vec::new();
    for item in items {
        if item["type"] == "step" {
            markdown_step(item, 0, &mut list);
        } else if item["type"] == "text" {
            if !list.is_empty() {
                blocks.push(std::mem::take(&mut list).join("\n"));
            }
            let description = item
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            let mut lines = description.split('\n');
            let first = lines.next().unwrap_or("");
            let mut text = format!("> **{}**", item["title"].as_str().unwrap_or_default());
            if !first.is_empty() {
                text.push(' ');
                text.push_str(first);
            }
            for line in lines {
                text.push_str("\n> ");
                text.push_str(line);
            }
            blocks.push(text);
        }
    }
    if !list.is_empty() {
        blocks.push(list.join("\n"));
    }
}

#[cfg(test)]
fn markdown_step(step: &Value, depth: usize, lines: &mut Vec<String>) {
    let state = step_state(step);
    let marker = match state.as_str() {
        "active" => "[~]",
        "done" => "[x]",
        "failed" => "[!]",
        "skipped" => "[-]",
        "blocked" => "[?]",
        "warning" => "[w]",
        "info" => "[i]",
        _ => "[ ]",
    };
    let indent = "    ".repeat(depth);
    let inner = "    ".repeat(depth + 1);
    lines.push(format!(
        "{indent}- {marker} {}",
        step["title"].as_str().unwrap_or_default()
    ));
    if let Some(description) = step.get("description").and_then(Value::as_str) {
        lines.extend(description.lines().map(|line| format!("{inner}{line}")));
    }
    if let Some(note) = step.get("note").and_then(Value::as_str) {
        lines.extend(note.lines().map(|line| format!("{inner}> {line}")));
    }
    if let Some(children) = step.get("steps").and_then(Value::as_array) {
        for child in children {
            markdown_step(child, depth + 1, lines);
        }
    }
}

fn step_state(step: &Value) -> String {
    if !is_parent(step) {
        return step
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("open")
            .to_owned();
    }
    let states = step["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(step_state)
        .collect::<Vec<_>>();
    if states.iter().any(|state| state == "failed") {
        "failed".to_owned()
    } else if states.iter().any(|state| state == "blocked") {
        "blocked".to_owned()
    } else if states
        .iter()
        .all(|state| matches!(state.as_str(), "done" | "skipped" | "warning" | "info"))
    {
        if states.iter().any(|state| state == "warning") {
            "warning".to_owned()
        } else {
            "done".to_owned()
        }
    } else if states
        .iter()
        .any(|state| matches!(state.as_str(), "active" | "done" | "warning" | "info"))
    {
        "active".to_owned()
    } else {
        "open".to_owned()
    }
}

fn find_item<'a>(root: &'a Value, id: &str) -> Option<&'a Value> {
    if let Some(items) = root.as_array() {
        return items.iter().find_map(|item| find_item(item, id));
    }
    if root.get("id").and_then(Value::as_str) == Some(id) {
        return Some(root);
    }
    for key in ["items", "steps"] {
        for item in root
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(found) = find_item(item, id) {
                return Some(found);
            }
        }
    }
    None
}

fn find_item_mut<'a>(root: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    if root.get("id").and_then(Value::as_str) == Some(id) {
        return Some(root);
    }
    let key = match root {
        Value::Array(items) => {
            return items.iter_mut().find_map(|item| find_item_mut(item, id));
        }
        Value::Object(object) if object.contains_key("items") => "items",
        Value::Object(object) if object.contains_key("steps") => "steps",
        _ => return None,
    };
    for item in root[key].as_array_mut().unwrap() {
        if let Some(found) = find_item_mut(item, id) {
            return Some(found);
        }
    }
    None
}

fn all_items(root: &Value) -> Vec<&Value> {
    let mut result = Vec::new();
    if let Some(items) = root.as_array() {
        for item in items {
            result.push(item);
            result.extend(all_items(item));
        }
        return result;
    }
    for key in ["items", "steps"] {
        for item in root
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            result.push(item);
            result.extend(all_items(item));
        }
    }
    result
}

fn all_step_ids(root: &Value) -> Vec<String> {
    all_items(root)
        .into_iter()
        .filter(|item| item["type"] == "step")
        .filter_map(|item| item["id"].as_str().map(ToOwned::to_owned))
        .collect()
}

fn holds_person_state(item: &Value) -> bool {
    std::iter::once(item).chain(all_items(item)).any(|entry| {
        entry["type"] == "step"
            && !is_parent(entry)
            && entry["by"] == "person"
            && entry.get("state").is_some()
    })
}

fn effective_checks<'a>(plan: &'a Value, step: &'a Value) -> &'a str {
    if step["unlocked"] == true {
        "anyone"
    } else {
        step.get("checks")
            .and_then(Value::as_str)
            .or_else(|| plan["meta"]["checks"].as_str())
            .unwrap_or("anyone")
    }
}

fn is_parent(step: &Value) -> bool {
    step.get("steps")
        .and_then(Value::as_array)
        .is_some_and(|steps| !steps.is_empty())
}

fn increment(map: &mut Map<String, Value>, key: &str) {
    let value = map[key].as_u64().unwrap_or(0) + 1;
    map.insert(key.to_owned(), json!(value));
}

fn refuse(code: &'static str, message: impl Into<String>) -> PlanRefusal {
    PlanRefusal {
        code,
        message: message.into(),
    }
}

pub(crate) fn create_plan(
    draft: &Value,
    id: &str,
    now: &str,
    overrides: Option<&Value>,
) -> Result<Value, PlanRefusal> {
    validate_draft(draft)?;
    let source_meta = draft.get("meta").and_then(Value::as_object);
    let override_meta = overrides.and_then(Value::as_object);
    let meta_value = |key: &str| {
        override_meta
            .and_then(|meta| meta.get(key))
            .or_else(|| source_meta.and_then(|meta| meta.get(key)))
    };
    let title = meta_value("title")
        .and_then(Value::as_str)
        .filter(|title| !title.is_empty())
        .ok_or_else(|| refuse("plan-invalid", "A plan needs a title"))?;
    let mut meta = json!({
        "title": title,
        "kind": meta_value("kind").and_then(Value::as_str).unwrap_or("steps"),
        "checks": meta_value("checks").and_then(Value::as_str).unwrap_or("anyone")
    });
    for key in ["summary", "status"] {
        if let Some(value) = source_meta.and_then(|source| source.get(key))
            && value.as_str().is_some_and(|text| !text.is_empty())
        {
            meta.as_object_mut()
                .unwrap()
                .insert(key.to_owned(), value.clone());
        }
    }
    let mut taken = HashSet::new();
    collect_draft_ids(&draft["items"], &mut taken)?;
    let mut minted = Vec::new();
    let items = convert_draft_items(&draft["items"], now, &mut taken, &mut minted);
    let plan = json!({ "id": id, "rev": 0, "createdAt": now, "meta": meta, "items": items });
    validate_plan(&plan)?;
    if all_items(&plan["items"]).into_iter().any(|step| {
        step["type"] == "step"
            && step.get("state").is_some()
            && effective_checks(&plan, step) == "person"
    }) {
        let step = all_items(&plan["items"])
            .into_iter()
            .find(|step| {
                step["type"] == "step"
                    && step.get("state").is_some()
                    && effective_checks(&plan, step) == "person"
            })
            .unwrap();
        return Err(refuse(
            "person-only",
            format!(
                "Only a person checks \"{}\"",
                step["id"].as_str().unwrap_or_default()
            ),
        ));
    }
    Ok(json!({ "ok": true, "plan": plan, "minted": minted, "dropped": [] }))
}

pub(crate) fn validate_plan(plan: &Value) -> Result<(), PlanRefusal> {
    validate_plan_shape(plan)?;
    validate_structure(plan)
}

fn validate_plan_shape(plan: &Value) -> Result<(), PlanRefusal> {
    let object = exact_object(plan, &["id", "rev", "createdAt", "meta", "items"])?;
    valid_id(object.get("id"), "id")?;
    if object.get("rev").and_then(Value::as_u64).is_none() {
        return Err(refuse(
            "plan-invalid",
            "rev: Expected a non-negative integer",
        ));
    }
    if object.get("createdAt").and_then(Value::as_str).is_none() {
        return Err(refuse("plan-invalid", "createdAt: Expected a string"));
    }
    validate_meta(object.get("meta").unwrap(), false)?;
    validate_stored_items(object.get("items").unwrap(), "top")
}

fn validate_draft(draft: &Value) -> Result<(), PlanRefusal> {
    let object = exact_object(draft, &["meta", "items"])?;
    if let Some(meta) = object.get("meta") {
        validate_meta(meta, true)?;
    }
    validate_draft_items(
        object
            .get("items")
            .ok_or_else(|| refuse("plan-invalid", "items: Required"))?,
        "top",
    )
}

fn validate_meta(meta: &Value, optional_title: bool) -> Result<(), PlanRefusal> {
    let object = exact_object(meta, &["title", "kind", "summary", "status", "checks"])?;
    if !optional_title || object.contains_key("title") {
        valid_text(object.get("title"), "title", 1, 200)?;
    }
    if let Some(kind) = object.get("kind")
        && !matches!(kind.as_str(), Some("steps" | "test"))
    {
        return Err(refuse("plan-invalid", "kind: Invalid option"));
    }
    if let Some(checks) = object.get("checks") {
        valid_checks(checks, "checks")?;
    }
    if object.contains_key("summary") {
        valid_text(object.get("summary"), "summary", 0, 1000)?;
    }
    if object.contains_key("status") {
        valid_text(object.get("status"), "status", 0, 200)?;
    }
    Ok(())
}

fn validate_draft_items(value: &Value, inside: &str) -> Result<(), PlanRefusal> {
    let items = value
        .as_array()
        .ok_or_else(|| refuse("plan-invalid", "items: Expected an array"))?;
    for item in items {
        let kind = item
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| refuse("plan-invalid", "type: Required"))?;
        let allowed = match kind {
            "section" => &["type", "id", "title", "description", "items"][..],
            "text" => &["type", "id", "title", "description"][..],
            "step" => &[
                "type",
                "id",
                "title",
                "description",
                "checks",
                "state",
                "note",
                "steps",
            ][..],
            _ => return Err(refuse("plan-invalid", "type: Invalid discriminator value")),
        };
        let object = exact_object(item, allowed)?;
        if let Some(id) = object.get("id") {
            valid_id(Some(id), "id")?;
        }
        validate_item_fields(object)?;
        match kind {
            "section" => {
                if inside != "top" {
                    return Err(refuse(
                        "plan-bad-position",
                        "A section only stands at the top of a plan",
                    ));
                }
                validate_draft_items(
                    object
                        .get("items")
                        .ok_or_else(|| refuse("plan-invalid", "items: Required"))?,
                    "section",
                )?;
            }
            "text" if inside == "step" => {
                return Err(refuse(
                    "plan-bad-position",
                    "A step only holds steps, not a text block",
                ));
            }
            "step" => {
                if let Some(steps) = object.get("steps") {
                    validate_draft_items(steps, "step")?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_stored_items(value: &Value, inside: &str) -> Result<(), PlanRefusal> {
    let items = value
        .as_array()
        .ok_or_else(|| refuse("plan-invalid", "items: Expected an array"))?;
    for item in items {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
        let allowed = match kind {
            "section" => &["type", "id", "title", "description", "items"][..],
            "text" => &["type", "id", "title", "description"][..],
            "step" => &[
                "type",
                "id",
                "title",
                "description",
                "checks",
                "state",
                "by",
                "at",
                "note",
                "unlocked",
                "steps",
            ][..],
            _ => return Err(refuse("plan-invalid", "type: Invalid discriminator value")),
        };
        let object = exact_object(item, allowed)?;
        valid_id(object.get("id"), "id")?;
        validate_item_fields(object)?;
        if let Some(by) = object.get("by")
            && !matches!(by.as_str(), Some("person" | "agent"))
        {
            return Err(refuse("plan-invalid", "by: Invalid option"));
        }
        if object.contains_key("at") && object.get("at").and_then(Value::as_str).is_none() {
            return Err(refuse("plan-invalid", "at: Expected a string"));
        }
        if object.contains_key("unlocked")
            && object.get("unlocked").and_then(Value::as_bool).is_none()
        {
            return Err(refuse("plan-invalid", "unlocked: Expected a boolean"));
        }
        match kind {
            "section" => validate_stored_items(
                object
                    .get("items")
                    .ok_or_else(|| refuse("plan-invalid", "items: Required"))?,
                "section",
            )?,
            "text" if inside == "step" => {
                return Err(refuse(
                    "plan-invalid",
                    "A text block may not stand under a step",
                ));
            }
            "step" => {
                if let Some(steps) = object.get("steps") {
                    validate_stored_items(steps, "step")?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_item_fields(object: &Map<String, Value>) -> Result<(), PlanRefusal> {
    valid_text(object.get("title"), "title", 1, 200)?;
    if object.contains_key("description") {
        valid_text(object.get("description"), "description", 0, 1000)?;
    }
    if let Some(checks) = object.get("checks") {
        valid_checks(checks, "checks")?;
    }
    if let Some(state) = object.get("state")
        && !matches!(
            state.as_str(),
            Some(
                "open" | "active" | "done" | "failed" | "skipped" | "blocked" | "warning" | "info"
            )
        )
    {
        return Err(refuse("plan-invalid", "state: Invalid option"));
    }
    if object.contains_key("note") {
        valid_text(object.get("note"), "note", 0, 500)?;
    }
    Ok(())
}

fn exact_object<'a>(
    value: &'a Value,
    allowed: &[&str],
) -> Result<&'a Map<String, Value>, PlanRefusal> {
    let object = value
        .as_object()
        .ok_or_else(|| refuse("plan-invalid", "Expected an object"))?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(refuse(
            "plan-invalid",
            format!("Unrecognized key: \"{key}\""),
        ));
    }
    Ok(object)
}

fn valid_id(value: Option<&Value>, field: &str) -> Result<(), PlanRefusal> {
    let Some(id) = value.and_then(Value::as_str) else {
        return Err(refuse("plan-invalid", format!("{field}: Required")));
    };
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(refuse("plan-invalid", format!("{field}: Invalid string")));
    }
    Ok(())
}

fn valid_checks(value: &Value, field: &str) -> Result<(), PlanRefusal> {
    if matches!(value.as_str(), Some("anyone" | "agent" | "person")) {
        Ok(())
    } else {
        Err(refuse("plan-invalid", format!("{field}: Invalid option")))
    }
}

fn valid_text(
    value: Option<&Value>,
    field: &str,
    minimum: usize,
    maximum: usize,
) -> Result<(), PlanRefusal> {
    let Some(text) = value.and_then(Value::as_str) else {
        return Err(refuse("plan-invalid", format!("{field}: Required")));
    };
    let length = text.chars().count();
    if length < minimum || length > maximum {
        Err(refuse("plan-invalid", format!("{field}: Invalid length")))
    } else {
        Ok(())
    }
}

fn collect_draft_ids(root: &Value, taken: &mut HashSet<String>) -> Result<(), PlanRefusal> {
    for item in root.as_array().unwrap() {
        if let Some(id) = item.get("id").and_then(Value::as_str)
            && !taken.insert(id.to_owned())
        {
            return Err(refuse(
                "duplicate-id",
                format!("Two items share the id \"{id}\""),
            ));
        }
        for key in ["items", "steps"] {
            if let Some(children) = item.get(key) {
                collect_draft_ids(children, taken)?;
            }
        }
    }
    Ok(())
}

fn convert_draft_items(
    root: &Value,
    now: &str,
    taken: &mut HashSet<String>,
    minted: &mut Vec<String>,
) -> Vec<Value> {
    root.as_array()
        .unwrap()
        .iter()
        .map(|source| {
            let mut item = source.clone();
            let object = item.as_object_mut().unwrap();
            if !object.contains_key("id") {
                let id = mint_free_id(taken);
                minted.push(id.clone());
                object.insert("id".to_owned(), json!(id));
            }
            if object.get("description").and_then(Value::as_str) == Some("") {
                object.remove("description");
            }
            if object.get("note").and_then(Value::as_str) == Some("") {
                object.remove("note");
            }
            if object.contains_key("state") {
                object.insert("by".to_owned(), json!("agent"));
                object.insert("at".to_owned(), json!(now));
            }
            for key in ["items", "steps"] {
                if let Some(children) = object.get(key) {
                    let converted = convert_draft_items(children, now, taken, minted);
                    object.insert(key.to_owned(), Value::Array(converted));
                }
            }
            item
        })
        .collect()
}

fn mint_free_id(taken: &mut HashSet<String>) -> String {
    loop {
        let id = random_item_id();
        if taken.insert(id.clone()) {
            return id;
        }
    }
}

pub(crate) fn random_item_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .map(char::from)
        .map(|character| character.to_ascii_lowercase())
        .take(6)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_operations_match_typescript_oracle() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("fixtures/plan-oracle.json")).unwrap();
        for case in cases {
            let actual = match apply_plan_ops(
                &case["input"],
                case["ops"].as_array().unwrap(),
                case["actor"].as_str().unwrap(),
                case["now"].as_str().unwrap(),
            ) {
                Ok(result) => result,
                Err(error) => json!({ "ok": false, "code": error.code, "message": error.message }),
            };
            assert_eq!(actual, case["result"], "{}", case["name"]);
            if actual["ok"] == true {
                assert_eq!(
                    plan_progress(&actual["plan"]["items"]),
                    case["progress"],
                    "{} progress",
                    case["name"]
                );
                assert_eq!(
                    plan_to_markdown(&actual["plan"]),
                    case["markdown"],
                    "{} markdown",
                    case["name"]
                );
            }
        }
    }

    #[test]
    fn markdown_parser_matches_nested_typescript_fixture() {
        let parsed = parse_plan_markdown(
            "# Ship it\n\n- [x] Build\n- [ ] Test\n  - [ ] Unit\n    Run cargo test.\n  - plain item\n\n## Release\n\n> **Heads up** Needs the keychain.\n\n* [~] Tag",
        )
        .unwrap();
        assert_eq!(
            parsed,
            json!({
                "meta": { "title": "Ship it" },
                "items": [
                    { "type": "step", "title": "Build", "state": "done" },
                    {
                        "type": "step",
                        "title": "Test",
                        "steps": [
                            { "type": "step", "title": "Unit", "description": "Run cargo test." },
                            { "type": "step", "title": "plain item" }
                        ]
                    },
                    {
                        "type": "section",
                        "title": "Release",
                        "items": [
                            { "type": "text", "title": "Heads up", "description": "Needs the keychain." },
                            { "type": "step", "title": "Tag", "state": "active" }
                        ]
                    }
                ]
            })
        );
        assert_eq!(
            parse_plan_markdown("# T\n\n- [ ] A\n\nStray prose")
                .unwrap_err()
                .code,
            "plan-invalid"
        );
        assert_eq!(
            parse_plan_markdown("- [o] A").unwrap_err().message,
            "Line 1: \"[o]\" is not a step marker"
        );
    }
}
