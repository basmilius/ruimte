//! Completion inside the strings that name a config key, a route, a view and the like.

use php_index::Index;
use php_index::framework::keys::{KeyKind, candidates};
use php_syntax::SyntaxNode;

use super::keys::key_at;
use crate::completion::{CompletionItem, CompletionList, CompletionOptions, ItemKind, TextEdit, match_score};
use crate::infer::Analyzer;

fn item_kind(kind: KeyKind) -> ItemKind {
    match kind {
        KeyKind::Config => ItemKind::Property,
        KeyKind::Route => ItemKind::Method,
        KeyKind::View => ItemKind::Module,
        KeyKind::Translation => ItemKind::Constant,
        KeyKind::Env => ItemKind::Variable,
        KeyKind::Ability => ItemKind::Keyword,
    }
}

/// The completions for the string around an offset, `None` when it is not one that names something.
pub fn complete_key(
    index: &Index,
    root: &SyntaxNode,
    text: &str,
    offset: u32,
    options: CompletionOptions,
) -> Option<CompletionList> {
    if !index.frameworks().any() {
        return None;
    }
    let analyzer = Analyzer::new(index, root, offset);
    let found = key_at(&analyzer, offset)?;
    let start = u32::from(found.range.start());
    let typed = text.get(start as usize..offset as usize)?;
    let mut items: Vec<(u8, CompletionItem)> = candidates(index, found.kind)
        .into_iter()
        .filter_map(|candidate| {
            let score = match_score(&candidate.key, typed)?;
            Some((
                score,
                CompletionItem {
                    label: candidate.key.clone(),
                    kind: item_kind(found.kind),
                    detail: candidate.detail,
                    description: Some(found.kind.label().to_string()),
                    edit: TextEdit {
                        start,
                        end: u32::from(found.range.end()),
                        new_text: candidate.key.clone(),
                    },
                    additional_edits: Vec::new(),
                    sort_text: candidate.key.to_ascii_lowercase(),
                    filter_text: Some(candidate.key),
                    deprecated: false,
                    data: None,
                },
            ))
        })
        .collect();
    items.sort_by(|left, right| (left.0, &left.1.sort_text).cmp(&(right.0, &right.1.sort_text)));
    let incomplete = items.len() > options.limit;
    items.truncate(options.limit);
    Some(CompletionList {
        items: items.into_iter().map(|(_, item)| item).collect(),
        incomplete,
    })
}
