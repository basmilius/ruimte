//! Strings that name something a project declares: `config('app.name')`, `route('home')`,
//! `view('mail.welcome')`. Which arguments of which functions do is the framework overlay's; what
//! the strings can say and where they point is the catalogs of `php-index`.

use php_index::framework::keys::KeyKind;
use php_index::framework::overlay::{Marker, is_marked, markers_for};
use php_syntax::SyntaxKind::*;
use php_syntax::{SyntaxNode, TextRange};

use crate::ast::range_of;
use crate::context::FileContext;
use crate::infer::Analyzer;

/// A string that names something, with the text inside its quotes.
#[derive(Clone, Debug, PartialEq)]
pub struct KeyString {
    pub kind: KeyKind,
    pub value: String,
    pub range: TextRange,
    /// The class the call is made on, for the kinds that depend on it.
    pub scope: Option<String>,
    /// The code expects the name to be missing: it asks whether it exists or gives a default.
    pub guarded: bool,
}

/// The key a string literal is, when it is the argument of a call that takes one.
pub fn key_of_literal(analyzer: &Analyzer<'_>, literal: &SyntaxNode) -> Option<KeyString> {
    if !analyzer.index.frameworks().any() {
        return None;
    }
    let (value, span) = php_index::test_facts::string_value(literal)?;
    let argument = literal.parent().filter(|parent| parent.kind() == ARGUMENT)?;
    if argument.children_with_tokens().any(|element| element.kind() == COLON) {
        return None;
    }
    let call = argument
        .parent()
        .filter(|list| list.kind() == ARGUMENT_LIST)?
        .parent()
        .filter(|call| call.kind() == CALL_EXPR)?;
    let position = call
        .children()
        .find(|child| child.kind() == ARGUMENT_LIST)?
        .children()
        .filter(|child| child.kind() == ARGUMENT)
        .position(|child| child == argument)?;
    let callee = call.children().next()?;
    let name = callee.descendants().filter(|node| node.kind() == NAME).last()?;
    if !is_marked(&name.text().to_string()) {
        return None;
    }
    let env = analyzer.env_around(&call);
    for resolved in analyzer.callees(&call, &env) {
        let (class, method) = match resolved.name.split_once("::") {
            Some((class, method)) => (Some(class), method),
            None => (None, resolved.name.as_str()),
        };
        let receiver = resolved
            .receiver
            .as_ref()
            .and_then(|ty| ty.class_names().first().map(|name| name.to_string()));
        for marker in markers_for(analyzer.index, class, receiver.as_deref(), method) {
            if let Marker::Key { kind, position: wanted } = marker {
                if wanted == position {
                    if let Some(kind) = KeyKind::parse(&kind) {
                        let asks_existence = matches!(method.to_ascii_lowercase().as_str(), "has" | "exists");
                        let has_default = kind == KeyKind::Config && argument_count(&call) > 1;
                        return Some(KeyString {
                            kind,
                            value,
                            range: range_of(span.start, span.end),
                            scope: receiver.clone(),
                            guarded: asks_existence || has_default,
                        });
                    }
                }
            }
        }
    }
    None
}

fn argument_count(call: &SyntaxNode) -> usize {
    call.children()
        .find(|child| child.kind() == ARGUMENT_LIST)
        .map_or(0, |list| {
            list.children().filter(|child| child.kind() == ARGUMENT).count()
        })
}

/// The key string around an offset, the end of the text inside the quotes counting as in it.
pub fn key_at(analyzer: &Analyzer<'_>, offset: u32) -> Option<KeyString> {
    let tokens = match analyzer.root.token_at_offset(php_syntax::TextSize::from(offset)) {
        php_syntax::TokenAtOffset::None => return None,
        php_syntax::TokenAtOffset::Single(token) => vec![token],
        php_syntax::TokenAtOffset::Between(left, right) => vec![right, left],
    };
    for token in tokens {
        if token.kind() != STRING_LITERAL {
            continue;
        }
        let Some(literal) = token.parent() else {
            continue;
        };
        if let Some(found) = key_of_literal(analyzer, &literal) {
            let (start, end) = (u32::from(found.range.start()), u32::from(found.range.end()));
            if start <= offset && offset <= end {
                return Some(found);
            }
        }
    }
    None
}

/// Every key string of a file.
pub fn keys_in(ctx: &FileContext<'_>) -> Vec<KeyString> {
    if !ctx.index.frameworks().any() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for node in ctx.root.descendants().filter(|node| node.kind() == LITERAL) {
        let Some(parent) = node.parent().filter(|parent| parent.kind() == ARGUMENT) else {
            continue;
        };
        let _ = parent;
        let analyzer = ctx.analyzer(&node);
        out.extend(key_of_literal(&analyzer, &node));
    }
    out
}

/// What a key stands for, one description per place it is declared.
pub fn describe(
    index: &php_index::Index,
    kind: KeyKind,
    name: &str,
    scope: Option<&str>,
) -> Vec<crate::nav::Description> {
    let definitions = php_index::framework::keys::definitions(index, kind, name, scope);
    let title = format!("{} '{name}'", kind.label());
    if definitions.is_empty() {
        return vec![crate::nav::Description {
            title,
            signature: name.to_string(),
            doc: None,
            place: None,
        }];
    }
    definitions
        .into_iter()
        .map(|definition| crate::nav::Description {
            title: title.clone(),
            signature: if definition.detail.is_empty() {
                name.to_string()
            } else {
                format!("{name} = {}", definition.detail)
            },
            doc: None,
            place: Some(crate::nav::Place {
                path: Some(definition.path),
                span: definition.span,
            }),
        })
        .collect()
}
