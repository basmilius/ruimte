//! Small helpers over the syntax tree that the analyses share.

use php_syntax::SyntaxKind::*;
use php_syntax::{SyntaxElement, SyntaxKind, SyntaxNode, SyntaxToken, TextRange, TextSize};

pub fn tokens(node: &SyntaxNode) -> impl Iterator<Item = SyntaxToken> {
    node.children_with_tokens().filter_map(SyntaxElement::into_token)
}

pub fn first_token(node: &SyntaxNode, kind: SyntaxKind) -> Option<SyntaxToken> {
    tokens(node).find(|token| token.kind() == kind)
}

pub fn has_token(node: &SyntaxNode, kind: SyntaxKind) -> bool {
    first_token(node, kind).is_some()
}

pub fn child_of(node: &SyntaxNode, kind: SyntaxKind) -> Option<SyntaxNode> {
    node.children().find(|child| child.kind() == kind)
}

pub fn text_of(node: &SyntaxNode) -> String {
    node.text().to_string()
}

pub fn start(node: &SyntaxNode) -> u32 {
    u32::from(node.text_range().start())
}

pub fn end(node: &SyntaxNode) -> u32 {
    u32::from(node.text_range().end())
}

pub fn range_of(start: u32, end: u32) -> TextRange {
    TextRange::new(TextSize::from(start), TextSize::from(end.max(start)))
}

/// The deepest node that covers an offset, which for an offset between two tokens is the one the
/// preceding token is in.
pub fn node_at(root: &SyntaxNode, offset: u32) -> SyntaxNode {
    let offset = offset.min(end(root));
    let range = range_of(offset, offset);
    match root.covering_element(range) {
        SyntaxElement::Node(node) => node,
        SyntaxElement::Token(token) => token.parent().unwrap_or_else(|| root.clone()),
    }
}

pub fn is_type_node(kind: SyntaxKind) -> bool {
    matches!(
        kind,
        NAMED_TYPE | NULLABLE_TYPE | UNION_TYPE | INTERSECTION_TYPE | PAREN_TYPE
    )
}

pub fn is_function_like(kind: SyntaxKind) -> bool {
    matches!(
        kind,
        FUNCTION_DECLARATION | METHOD_DECLARATION | CLOSURE_EXPR | ARROW_FUNCTION_EXPR | PROPERTY_HOOK
    )
}
