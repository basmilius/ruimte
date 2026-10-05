//! Questions about a syntax tree and an index that the language server answers: where the symbols
//! are, what folds, how a selection grows, which diagnostics a file has, what a variable is, what
//! completes at a cursor and what a name refers to. Nothing here knows about LSP or about processes,
//! so the same functions serve any front end.

mod ast;
mod diagnostics;
mod folding;
pub mod infer;
mod line_index;
pub mod render;
mod selection;
mod symbols;
pub mod target;

pub use diagnostics::{Diagnostic, DiagnosticSeverity, diagnostics};
pub use folding::{Fold, FoldKind, folding_ranges};
pub use infer::{Analyzer, Env};
pub use line_index::{LineCol, LineIndex, PositionEncoding};
pub use selection::selection_ranges;
pub use symbols::{Symbol, SymbolKind, document_symbols};

/// The last segment of a qualified name.
pub(crate) fn short(name: &str) -> &str {
    name.rsplit('\\').next().unwrap_or(name)
}

#[cfg(test)]
mod testing;
