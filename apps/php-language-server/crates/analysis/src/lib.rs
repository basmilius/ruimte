//! Questions about a syntax tree that the language server answers: where the symbols are, what
//! folds, how a selection grows and which diagnostics a file has. Nothing here knows about LSP or
//! about processes, so the same functions serve any front end.

mod diagnostics;
mod folding;
mod line_index;
mod selection;
mod symbols;

pub use diagnostics::{Diagnostic, DiagnosticSeverity, diagnostics};
pub use folding::{Fold, FoldKind, folding_ranges};
pub use line_index::{LineCol, LineIndex, PositionEncoding};
pub use selection::selection_ranges;
pub use symbols::{Symbol, SymbolKind, document_symbols};
