use std::collections::HashSet;

use serde_json::{Value, json};

fn boundary(character: Option<char>) -> bool {
    character.is_none_or(char::is_whitespace)
}

fn token_end(character: Option<char>) -> bool {
    boundary(character) || character.is_some_and(|character| ".,;:!?)".contains(character))
}

fn last_skill_token<'a>(text: &str, skills: &'a [String]) -> Option<(usize, &'a str)> {
    let mut names = skills.iter().map(String::as_str).collect::<Vec<_>>();
    names.sort_unstable_by_key(|name| std::cmp::Reverse(name.len()));
    names.dedup();
    let mut best = None;
    for name in names {
        let token = format!("${name}");
        for (index, _) in text.match_indices(&token) {
            let before = text[..index].chars().next_back();
            let after = text[index + token.len()..].chars().next();
            if boundary(before)
                && token_end(after)
                && best.is_none_or(|(best_index, _)| index > best_index)
            {
                best = Some((index, name));
            }
        }
    }
    best
}

fn replace_earlier_skills(text: &str, skills: &HashSet<&str>) -> String {
    let mut output = String::with_capacity(text.len());
    let mut offset = 0;
    while let Some(relative) = text[offset..].find('$') {
        let index = offset + relative;
        output.push_str(&text[offset..index]);
        let token = &text[index + 1..];
        let length = token
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':' | b'-'))
            .count();
        let name = &token[..length];
        if name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic) && skills.contains(name) {
            output.push('/');
            output.push_str(name);
            offset = index + 1 + length;
        } else {
            output.push('$');
            offset = index + 1;
        }
    }
    output.push_str(&text[offset..]);
    output
}

pub fn split_skill_prompt(text: &str, skills: &[String]) -> (String, Option<String>) {
    let Some((index, name)) = last_skill_token(text, skills) else {
        return (text.to_owned(), None);
    };
    let known = skills.iter().map(String::as_str).collect::<HashSet<_>>();
    let lead = replace_earlier_skills(&text[..index], &known)
        .trim_end()
        .to_owned();
    let rest = text[index + name.len() + 1..].trim_start_matches([' ', '\t']);
    let invocation = if rest.is_empty() {
        format!("/{name}")
    } else {
        format!("/{name} {rest}")
    };
    (lead, Some(invocation))
}

pub fn attachment_note(attachments: &[Value]) -> String {
    let lines = attachments.iter().filter_map(|attachment| {
        let path = attachment.get("path")?.as_str()?;
        let name = attachment.get("name")?.as_str()?;
        Some(format!("- {path} ({name})"))
    });
    let files = lines.collect::<Vec<_>>().join("\n");
    if files.is_empty() {
        String::new()
    } else {
        format!("Attached files:\n{files}")
    }
}

pub fn claude_user_frame(
    text: &str,
    preamble: Option<&str>,
    ultrathink: bool,
    skills: &[String],
    attachments: &[Value],
) -> Value {
    let (lead, invocation) = split_skill_prompt(text, skills);
    let prefix = [ultrathink.then_some("ultrathink"), preamble]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n\n");
    let lead = if prefix.is_empty() {
        lead
    } else if lead.is_empty() {
        prefix
    } else {
        format!("{prefix}\n\n{lead}")
    };
    let note = attachment_note(attachments);
    let prompt = [lead, note]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut content = Vec::new();
    if !prompt.is_empty() {
        content.push(json!({ "type": "text", "text": prompt }));
    }
    if let Some(invocation) = invocation {
        content.push(json!({ "type": "text", "text": invocation }));
    }
    json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
        "session_id": "",
    })
}

pub fn text_prompt(text: &str, preamble: Option<&str>, attachments: &[Value]) -> String {
    let note = attachment_note(attachments);
    [preamble.unwrap_or_default(), text, &note]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attachment() -> Value {
        json!({ "name": "shot.png", "path": "/tmp/shot.png" })
    }

    #[test]
    fn skill_invocation_is_the_last_claude_text_block() {
        let frame = claude_user_frame(
            "run $lint first, then $release-notes it",
            Some("Links changed"),
            true,
            &[
                "lint".to_owned(),
                "release".to_owned(),
                "release-notes".to_owned(),
            ],
            &[attachment()],
        );
        assert_eq!(
            frame.pointer("/message/content"),
            Some(&json!([
                { "type": "text", "text": "ultrathink\n\nLinks changed\n\nrun /lint first, then\n\nAttached files:\n- /tmp/shot.png (shot.png)" },
                { "type": "text", "text": "/release-notes it" },
            ]))
        );
    }

    #[test]
    fn unknown_and_embedded_dollar_words_stay_plain_text() {
        let skills = vec!["release".to_owned()];
        assert_eq!(
            split_skill_prompt("cost $20 x$release $release-notes", &skills),
            ("cost $20 x$release $release-notes".to_owned(), None)
        );
    }

    #[test]
    fn codex_prompt_orders_preamble_text_and_attachment_note() {
        assert_eq!(
            text_prompt("do it", Some("Links changed"), &[attachment()]),
            "Links changed\n\ndo it\n\nAttached files:\n- /tmp/shot.png (shot.png)"
        );
    }
}
