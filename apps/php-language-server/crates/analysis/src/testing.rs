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
    /// A folder written for the test, removed again with the fixture.
    disk: Option<PathBuf>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(dir) = &self.disk {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
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
        Fixture {
            index,
            sources,
            disk: None,
        }
    }

    /// Like `with_level`, with the files on disk too, for what reads a body from the file it is in.
    pub fn on_disk(files: &[(&str, &str)], stubs: &[(&str, &str)]) -> Fixture {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "php-analysis-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let mut index = Index::new(PhpVersion::V8_4);
        let mut sources = std::collections::HashMap::new();
        for (path, text) in files {
            let full = dir.join(path);
            std::fs::create_dir_all(full.parent().expect("a parent")).expect("a test folder");
            std::fs::write(&full, text).expect("a test file");
            sources.insert(full.clone(), text.to_string());
            let symbols = extract(&parse(text).syntax(), ExtractOptions::default());
            index.set_file(full, Origin::Project, Arc::new(symbols));
        }
        for (path, text) in stubs {
            let symbols = extract(&parse(text).syntax(), ExtractOptions { stub: true });
            index.set_file(PathBuf::from(format!("/stubs/{path}")), Origin::Stub, Arc::new(symbols));
        }
        Fixture {
            index,
            sources,
            disk: Some(dir),
        }
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
