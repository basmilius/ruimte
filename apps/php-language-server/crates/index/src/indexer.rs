//! Indexes many files at once: finds them, reads the declarations of each in parallel, and reuses
//! what the cache holds for files that did not change.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use php_syntax::parse;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::cache::{Cache, Record, Stamp, content_hash};
use crate::composer::Composer;
use crate::extract::{ExtractOptions, extract};
use crate::index::Origin;
use crate::model::FileSymbols;
use crate::stubs;

/// Files larger than this are generated or data, and parsing them tells the index nothing.
const MAX_FILE_SIZE: u64 = 4 << 20;
const BATCH: usize = 256;

#[derive(Clone, Debug)]
pub struct IndexedFile {
    pub path: PathBuf,
    pub origin: Origin,
    /// For a stub, the normalized name of its extension folder.
    pub extension: Option<String>,
    pub symbols: Arc<FileSymbols>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub files: usize,
    pub parsed: usize,
    pub from_cache: usize,
    pub discovery: Duration,
    pub total: Duration,
}

pub enum IndexEvent {
    Discovered(usize),
    Files(Vec<IndexedFile>),
    Finished(Stats),
}

/// Folders that never hold source a person works on.
fn skipped_dir(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "vendor")
}

fn is_php(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("php"))
}

/// The PHP files of a project: everything under its folder except the vendor folder and generated
/// caches, then the files of the installed packages that Composer would load.
pub fn discover_project(root: &Path, composer: Option<&Composer>) -> Vec<(PathBuf, Origin)> {
    let vendor_dir = composer.map(|composer| composer.vendor_dir.clone());
    let mut found: BTreeSet<PathBuf> = BTreeSet::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 || !entry.file_type().is_dir() {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if vendor_dir.as_deref() == Some(entry.path()) || skipped_dir(&name) {
                return false;
            }
            let path = entry.path();
            !(path.ends_with("storage/framework") || path.ends_with("bootstrap/cache") || path.ends_with("var/cache"))
        });
    for entry in walker.flatten() {
        if entry.file_type().is_file() && is_php(entry.path()) {
            found.insert(entry.into_path());
        }
    }
    let mut files: Vec<(PathBuf, Origin)> = found.into_iter().map(|path| (path, Origin::Project)).collect();

    if let Some(composer) = composer {
        let mut vendor: BTreeSet<PathBuf> = BTreeSet::new();
        for root in composer.vendor_roots() {
            if root.is_file() {
                vendor.insert(root);
                continue;
            }
            for entry in WalkDir::new(&root).follow_links(false).into_iter().flatten() {
                if entry.file_type().is_file() && is_php(entry.path()) && !composer.excluded(entry.path()) {
                    vendor.insert(entry.into_path());
                }
            }
        }
        files.extend(vendor.into_iter().map(|path| (path, Origin::Vendor)));
    }
    files
}

/// The PHP files of the extension folders of the stubs.
pub fn discover_stubs(root: &Path) -> Vec<(PathBuf, Origin)> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.path().is_dir() || !stubs::is_extension_folder(&name) {
            continue;
        }
        for file in WalkDir::new(entry.path()).into_iter().flatten() {
            if file.file_type().is_file() && is_php(file.path()) {
                files.push((file.into_path(), Origin::Stub));
            }
        }
    }
    files.sort();
    files
}

/// The declarations of a text.
pub fn extract_text(text: &str, stub: bool) -> FileSymbols {
    extract(&parse(text).syntax(), ExtractOptions { stub })
}

/// Reads and extracts one file from disk.
pub fn index_file(path: &Path, origin: Origin) -> Option<FileSymbols> {
    let bytes = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(extract_text(&text, origin == Origin::Stub))
}

struct Counters {
    parsed: AtomicUsize,
    from_cache: AtomicUsize,
    done: AtomicUsize,
}

/// Extracts every file, reusing cached declarations where the stamp or the content matches, and
/// reports finished files in batches. The cache is rewritten when anything in it changed.
pub fn run(
    files: Vec<(PathBuf, Origin)>,
    cache_path: Option<&Path>,
    stub_root: Option<&Path>,
    threads: usize,
    emit: &(dyn Fn(IndexEvent) + Sync),
) {
    let started = Instant::now();
    let total = files.len();
    emit(IndexEvent::Discovered(total));
    let cache = cache_path.map(Cache::load).unwrap_or_default();
    let cached_before = cache.records.len();
    let counters = Counters {
        parsed: AtomicUsize::new(0),
        from_cache: AtomicUsize::new(0),
        done: AtomicUsize::new(0),
    };
    let records: Mutex<Vec<Record>> = Mutex::new(Vec::with_capacity(total));

    let work = || {
        files.par_chunks(BATCH).for_each(|chunk| {
            let mut batch = Vec::with_capacity(chunk.len());
            let mut fresh = Vec::with_capacity(chunk.len());
            for (path, origin) in chunk {
                if let Some((symbols, record)) = process(path, *origin, &cache, &counters) {
                    let extension = stub_root.and_then(|root| stubs::extension_of(root, path));
                    batch.push(IndexedFile {
                        path: path.clone(),
                        origin: *origin,
                        extension,
                        symbols: Arc::new(symbols),
                    });
                    if let Some(record) = record {
                        fresh.push(record);
                    }
                }
            }
            counters.done.fetch_add(chunk.len(), Ordering::Relaxed);
            if let Ok(mut all) = records.lock() {
                all.append(&mut fresh);
            }
            emit(IndexEvent::Files(batch));
        });
    };
    match rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .stack_size(64 << 20)
        .build()
    {
        Ok(pool) => pool.install(work),
        Err(_) => work(),
    }

    let records = records.into_inner().unwrap_or_default();
    let parsed = counters.parsed.load(Ordering::Relaxed);
    let from_cache = counters.from_cache.load(Ordering::Relaxed);
    let removed = cached_before.saturating_sub(
        records
            .iter()
            .filter(|record| cache.records.contains_key(&record.path))
            .count(),
    );
    if let Some(path) = cache_path {
        if parsed > 0 || removed > 0 || cached_before == 0 {
            let _ = Cache::save(path, &records);
        }
    }
    emit(IndexEvent::Finished(Stats {
        files: total,
        parsed,
        from_cache,
        discovery: Duration::ZERO,
        total: started.elapsed(),
    }));
}

fn process(path: &Path, origin: Origin, cache: &Cache, counters: &Counters) -> Option<(FileSymbols, Option<Record>)> {
    let stamp = Stamp::of(path)?;
    if stamp.size > MAX_FILE_SIZE {
        return None;
    }
    let key = path.to_string_lossy();
    let cached = cache.records.get(key.as_ref());
    if let Some(record) = cached {
        if record.stamp == stamp {
            if let Some(symbols) = record.symbols() {
                counters.from_cache.fetch_add(1, Ordering::Relaxed);
                return Some((symbols, Some(record.clone())));
            }
        }
    }
    let bytes = std::fs::read(path).ok()?;
    let hash = content_hash(&bytes);
    if let Some(record) = cached {
        if record.hash == hash {
            if let Some(symbols) = record.symbols() {
                counters.from_cache.fetch_add(1, Ordering::Relaxed);
                let mut record = record.clone();
                record.stamp = stamp;
                return Some((symbols, Some(record)));
            }
        }
    }
    let text = String::from_utf8_lossy(&bytes);
    let symbols = extract_text(&text, origin == Origin::Stub);
    counters.parsed.fetch_add(1, Ordering::Relaxed);
    let record = Record::new(path, stamp, hash, &symbols);
    Some((symbols, record))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn collect(files: Vec<(PathBuf, Origin)>, cache: Option<&Path>) -> (Vec<IndexedFile>, Stats) {
        let collected = Mutex::new(Vec::new());
        let stats = Mutex::new(Stats::default());
        run(files, cache, None, 2, &|event| match event {
            IndexEvent::Files(mut batch) => collected.lock().expect("lock").append(&mut batch),
            IndexEvent::Finished(done) => *stats.lock().expect("lock") = done,
            IndexEvent::Discovered(_) => {}
        });
        (collected.into_inner().expect("lock"), stats.into_inner().expect("lock"))
    }

    #[test]
    fn discovers_project_files_and_skips_generated_folders() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        for path in [
            "src/A.php",
            "tests/ATest.php",
            "vendor/x/y.php",
            "node_modules/z.php",
            ".git/hooks.php",
            "storage/framework/views/v.php",
            "README.md",
        ] {
            let file = root.join(path);
            fs::create_dir_all(file.parent().expect("a parent")).expect("created");
            fs::write(file, "<?php class X {}").expect("written");
        }
        let found = discover_project(root, None);
        let names: Vec<String> = found
            .iter()
            .map(|(path, _)| path.strip_prefix(root).expect("inside").to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["src/A.php", "tests/ATest.php"]);
    }

    #[test]
    fn indexes_in_parallel_and_reuses_the_cache() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let mut files = Vec::new();
        for number in 0..40 {
            let path = dir.path().join(format!("f{number}.php"));
            fs::write(
                &path,
                format!("<?php class C{number} {{ public function m(): int {{}} }}"),
            )
            .expect("written");
            files.push((path, Origin::Project));
        }
        let cache = dir.path().join("cache/p.bin");
        let (indexed, stats) = collect(files.clone(), Some(&cache));
        assert_eq!(indexed.len(), 40);
        assert_eq!((stats.parsed, stats.from_cache), (40, 0));

        let (_, stats) = collect(files.clone(), Some(&cache));
        assert_eq!((stats.parsed, stats.from_cache), (0, 40));

        // Touched without a change in content: the hash saves the parse.
        let touched = &files[3].0;
        let text = fs::read_to_string(touched).expect("read");
        std::thread::sleep(Duration::from_millis(20));
        fs::write(touched, &text).expect("written");
        let (_, stats) = collect(files.clone(), Some(&cache));
        assert_eq!((stats.parsed, stats.from_cache), (0, 40));

        fs::write(touched, "<?php class Changed {}").expect("written");
        let (indexed, stats) = collect(files, Some(&cache));
        assert_eq!(stats.parsed, 1);
        assert!(
            indexed
                .iter()
                .any(|file| file.symbols.classes.iter().any(|class| class.name == "Changed"))
        );
    }
}
