//! Fixtures for tests: a small index built from PHP sources, and a cursor marker in the text.

use std::path::PathBuf;
use std::sync::Arc;

use php_index::extract::{ExtractOptions, extract};
use php_index::{Index, Origin};
use php_syntax::{PhpVersion, SyntaxNode, parse};

/// Where a test puts the cursor.
pub const CURSOR: &str = "$0";

pub struct Fixture {
    pub index: Index,
    /// The text of each file by path, for looking at what a span points to.
    pub sources: std::collections::HashMap<PathBuf, String>,
}

impl Fixture {
    pub fn new(files: &[(&str, &str)]) -> Fixture {
        Fixture::with_level(PhpVersion::V8_4, files, &[])
    }

    pub fn with_level(level: PhpVersion, files: &[(&str, &str)], stubs: &[(&str, &str)]) -> Fixture {
        let mut index = Index::new(level);
        let mut sources = std::collections::HashMap::new();
        for (path, text) in files {
            sources.insert(PathBuf::from(format!("/project/{path}")), text.to_string());
            let symbols = extract(&parse(text).syntax(), ExtractOptions::default());
            index.set_file(
                PathBuf::from(format!("/project/{path}")),
                Origin::Project,
                Arc::new(symbols),
            );
        }
        for (path, text) in stubs {
            let symbols = extract(&parse(text).syntax(), ExtractOptions { stub: true });
            index.set_file(PathBuf::from(format!("/stubs/{path}")), Origin::Stub, Arc::new(symbols));
        }
        Fixture { index, sources }
    }

    /// Adds the file being edited to the index, the way the server does for an open document.
    pub fn with_current(mut self, text: &str) -> Fixture {
        let clean = text.replace(CURSOR, "");
        let symbols = extract(&parse(&clean).syntax(), ExtractOptions::default());
        self.index.set_file(
            PathBuf::from("/project/current.php"),
            Origin::Project,
            Arc::new(symbols),
        );
        self
    }
}

/// The text without the cursor marker, its tree and the offset where the marker was.
pub fn split_cursor(text: &str) -> (String, SyntaxNode, u32) {
    let offset = text.find(CURSOR).expect("the text has a cursor marker");
    let clean = text.replacen(CURSOR, "", 1);
    let root = parse(&clean).syntax();
    (clean, root, offset as u32)
}
