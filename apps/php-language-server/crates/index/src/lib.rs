//! The index of the PHP language server: declarations with their types and PHPDoc, name resolution,
//! the standard library stubs, Composer metadata and the cache that keeps all of it between runs.

pub mod cache;
pub mod composer;
pub mod extract;
pub mod hierarchy;
pub mod index;
pub mod indexer;
pub mod model;
pub mod phpdoc;
pub mod project;
pub mod resolve;
pub mod stubs;
pub mod types;

pub use hierarchy::{Ancestor, Found};
pub use index::{Class, ConstRef, FileEntry, FileId, FunctionRef, Index, Origin, StubFile};
pub use model::*;
pub use project::Project;
pub use resolve::{NameResolver, UseKind};
pub use types::{Name, Type};
