//! Lexer, error-tolerant parser and lossless syntax tree for PHP.

mod kind;
pub mod lexer;

pub use kind::{PhpLanguage, SyntaxElement, SyntaxKind, SyntaxNode, SyntaxToken};

#[cfg(test)]
mod tests;
