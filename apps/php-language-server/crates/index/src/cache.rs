//! The cache that keeps extracted declarations between runs. One file per project, keyed by the path
//! of each source file with its size and modification time, and a hash of its content for the case
//! where a tool touched a file without changing it.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use xxhash_rust::const_xxh3::xxh3_64 as const_hash;
use xxhash_rust::xxh3::xxh3_64;

use crate::model::FileSymbols;

const MAGIC: u32 = 0x5048_5049;

/// Changes whenever the sources that decide what a cached entry means change, so a cache written by
/// an older build is dropped instead of read as something it is not.
const SCHEMA: u64 = const_hash(include_bytes!("model.rs"))
    ^ const_hash(include_bytes!("types.rs")).rotate_left(1)
    ^ const_hash(include_bytes!("extract.rs")).rotate_left(2)
    ^ const_hash(include_bytes!("phpdoc.rs")).rotate_left(3)
    ^ const_hash(include_bytes!("cache.rs")).rotate_left(4);

/// What identifies a version of a file on disk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub size: u64,
    pub mtime_ns: u64,
}

impl Stamp {
    pub fn of(path: &Path) -> Option<Stamp> {
        let metadata = fs::metadata(path).ok()?;
        let modified = metadata.modified().ok()?;
        let nanos = modified.duration_since(UNIX_EPOCH).ok()?.as_nanos();
        Some(Stamp {
            size: metadata.len(),
            mtime_ns: u64::try_from(nanos).unwrap_or(u64::MAX),
        })
    }
}

pub fn content_hash(bytes: &[u8]) -> u64 {
    xxh3_64(bytes)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    pub path: String,
    pub stamp: Stamp,
    pub hash: u64,
    /// The declarations of the file, serialized.
    pub payload: Vec<u8>,
}

impl Record {
    pub fn new(path: &Path, stamp: Stamp, hash: u64, symbols: &FileSymbols) -> Option<Record> {
        Some(Record {
            path: path.to_string_lossy().into_owned(),
            stamp,
            hash,
            payload: postcard::to_stdvec(symbols).ok()?,
        })
    }

    pub fn symbols(&self) -> Option<FileSymbols> {
        postcard::from_bytes(&self.payload).ok()
    }
}

#[derive(Serialize, Deserialize)]
struct Header {
    magic: u32,
    schema: u64,
}

#[derive(Default)]
pub struct Cache {
    pub records: HashMap<String, Record>,
}

impl Cache {
    /// An unreadable or outdated cache is an empty one.
    pub fn load(path: &Path) -> Cache {
        let Ok(bytes) = fs::read(path) else {
            return Cache::default();
        };
        let Ok((header, rest)) = postcard::take_from_bytes::<Header>(&bytes) else {
            return Cache::default();
        };
        if header.magic != MAGIC || header.schema != SCHEMA {
            return Cache::default();
        }
        let Ok(records) = postcard::from_bytes::<Vec<Record>>(rest) else {
            return Cache::default();
        };
        Cache {
            records: records
                .into_iter()
                .map(|record| (record.path.clone(), record))
                .collect(),
        }
    }

    /// Writes the cache next to its final place and renames it, so a reader never sees half of it.
    pub fn save(path: &Path, records: &[Record]) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut bytes = postcard::to_stdvec(&Header {
            magic: MAGIC,
            schema: SCHEMA,
        })
        .map_err(io::Error::other)?;
        bytes.extend(postcard::to_stdvec(records).map_err(io::Error::other)?);
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, bytes)?;
        fs::rename(temporary, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{ExtractOptions, extract};
    use php_syntax::parse;

    #[test]
    fn round_trips_records_and_drops_a_foreign_file() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let source = dir.path().join("a.php");
        fs::write(&source, "<?php class A { public function f(int $x): ?A {} }").expect("written");
        let text = fs::read_to_string(&source).expect("read");
        let symbols = extract(&parse(&text).syntax(), ExtractOptions::default());
        let stamp = Stamp::of(&source).expect("stat");
        let record = Record::new(&source, stamp, content_hash(text.as_bytes()), &symbols).expect("serialized");

        let path = dir.path().join("cache/project.bin");
        Cache::save(&path, &[record]).expect("saved");
        let cache = Cache::load(&path);
        let loaded = cache
            .records
            .get(&source.to_string_lossy().into_owned())
            .expect("a record");
        assert_eq!(loaded.stamp, stamp);
        assert_eq!(loaded.symbols().expect("decoded"), symbols);

        fs::write(&path, b"garbage").expect("written");
        assert!(Cache::load(&path).records.is_empty());
        assert!(Cache::load(&dir.path().join("missing.bin")).records.is_empty());
    }
}
