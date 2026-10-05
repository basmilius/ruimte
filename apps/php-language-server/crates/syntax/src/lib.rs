//! Lexer, error-tolerant parser and lossless syntax tree for PHP.

mod dump;
mod kind;
pub mod lexer;
mod parser;

pub use dump::{DumpOptions, dump, dump_compact};
pub use kind::{PhpLanguage, SyntaxElement, SyntaxKind, SyntaxNode, SyntaxToken};
pub use parser::{Parse, SyntaxError, parse};
pub use rowan::{TextRange, TextSize, TokenAtOffset};

#[cfg(test)]
mod tests;
