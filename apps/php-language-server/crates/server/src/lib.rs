//! A PHP language server over LSP: document sync, diagnostics, document symbols, folding and
//! selection ranges, all read from the syntax tree of `php-syntax`.

mod config;
mod convert;
mod documents;
mod server;

pub use server::run;
