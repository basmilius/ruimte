//! Questions about a syntax tree and an index that the language server answers: where the symbols
//! are, what folds, how a selection grows, which diagnostics a file has, what a variable is, what
//! completes at a cursor and what a name refers to. Nothing here knows about LSP or about processes,
//! so the same functions serve any front end.

mod ast;
pub mod completion;
pub mod context;
pub mod decl;
mod diagnostics;
pub mod doc_refs;
mod folding;
pub mod hierarchy;
mod imports;
pub mod infer;
mod line_index;
pub mod nav;
pub mod references;
pub mod refs;
pub mod rename;
pub mod render;
mod selection;
pub mod signature;
mod symbols;
pub mod target;
pub mod workspace_symbols;

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

#[cfg(test)]
mod completion_tests;

#[cfg(test)]
mod nav_tests;

#[cfg(test)]
mod references_tests;

#[cfg(test)]
mod rename_tests;

#[cfg(test)]
mod signature_tests;

#[cfg(test)]
mod hierarchy_tests;
