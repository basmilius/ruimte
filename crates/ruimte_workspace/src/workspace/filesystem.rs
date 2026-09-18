#![allow(clippy::collapsible_if)]

use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex as SyncMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::UNIX_EPOCH,
};

use base64::Engine;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use regex::RegexBuilder;
use serde_json::{Value, json};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::{
    events::EventBus,
    rpc::{RequestContext, RpcError, RpcResult},
};

use super::{
    ResolvedAsset,
    project::ProjectStore,
    util::{io_error, string_field},
};

const LIST_MAX: usize = 2000;
const SEARCH_MAX: usize = 200;
const GREP_MAX: usize = 200;
const READ_MAX: u64 = 2 * 1024 * 1024;
const BYTES_MAX: u64 = 32 * 1024 * 1024;
const BYTES_CHUNK_MAX: u64 = 256 * 1024;

pub struct FileSystem {
    events: EventBus,
    projects: Arc<ProjectStore>,
    watchers: Mutex<HashMap<(String, PathBuf), FsWatch>>,
}

struct FsWatch {
    _watcher: RecommendedWatcher,
    cancel: CancellationToken,
}

impl FileSystem {
    pub fn new(events: EventBus, projects: Arc<ProjectStore>) -> Self {
        Self {
            events,
            projects,
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub async fn dispatch(
        &self,
        method: &str,
        payload: Value,
        context: &RequestContext,
    ) -> Option<RpcResult> {
        Some(match method {
            "fs.browse" => browse(payload).await,
            "fs.list" => list(payload).await,
            "fs.read" => read(payload).await,
            "fs.search" => search(payload).await,
            "fs.grep" => grep(payload).await,
            "fs.reveal" => reveal(payload).await,
            "fs.watch" => self.watch(payload, context).await,
            "fs.unwatch" => self.unwatch(payload, context).await,
            "bytes.read" => self.read_bytes(payload).await,
            _ => return None,
        })
    }

    pub async fn detach(&self, client_id: &str) {
        let mut watchers = self.watchers.lock().await;
        watchers.retain(|(owner, _), watch| {
            if owner == client_id {
                watch.cancel.cancel();
                false
            } else {
                true
            }
        });
    }
    pub async fn shutdown(&self) {
        let mut watchers = self.watchers.lock().await;
        for watch in watchers.values() {
            watch.cancel.cancel();
        }
        watchers.clear();
    }

    pub async fn resolve_file_media(&self, path: &Path) -> Result<Option<ResolvedAsset>, RpcError> {
        if !path.is_absolute() {
            return Ok(None);
        }
        match fs::symlink_metadata(path).await {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io_error(error)),
        }
        let head = read_head(path).await?;
        let Some(mime) = inspect_mime(&head, head.len() == SNIFF_BYTES) else {
            return Ok(None);
        };
        if !mime.starts_with("image/") && !mime.starts_with("video/") {
            return Ok(None);
        }
        resolved_asset(path, mime).await
    }

    pub async fn resolve_project_icon(
        &self,
        project_id: &str,
        theme: &str,
    ) -> Result<Option<ResolvedAsset>, RpcError> {
        let Some((path, mime)) = self.projects.icon_file(project_id, theme).await? else {
            return Ok(None);
        };
        resolved_asset(&path, mime).await
    }

    async fn watch(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let root = absolute(&string_field(&payload, "path")?)?;
        if !fs::metadata(&root)
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        {
            return Err(RpcError::new(
                "not-found",
                format!("{} is not a directory", root.display()),
            ));
        }
        let events = self.events.clone();
        let client_id = context.client_id.clone();
        let watched_root = root.clone();
        let pending = Arc::new(SyncMutex::new(HashSet::new()));
        let scheduled = Arc::new(AtomicBool::new(false));
        let cancel = CancellationToken::new();
        let runtime = tokio::runtime::Handle::current();
        let callback_cancel = cancel.clone();
        let mut watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else {
                    return;
                };
                let mut changed = pending.lock().unwrap();
                for path in event.paths {
                    let directory = if path.is_dir() {
                        path
                    } else {
                        path.parent().unwrap_or(&watched_root).to_path_buf()
                    };
                    changed.insert(directory.to_string_lossy().to_string());
                }
                let has_paths = !changed.is_empty();
                drop(changed);
                if !has_paths || scheduled.swap(true, Ordering::AcqRel) {
                    return;
                }
                let events = events.clone();
                let client_id = client_id.clone();
                let watched_root = watched_root.clone();
                let pending = pending.clone();
                let scheduled = scheduled.clone();
                let cancel = callback_cancel.clone();
                runtime.spawn(async move {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {}
                        _ = cancel.cancelled() => return,
                    }
                    scheduled.store(false, Ordering::Release);
                    let paths = {
                        let mut changed = pending.lock().unwrap();
                        std::mem::take(&mut *changed)
                    };
                    if !paths.is_empty() && !cancel.is_cancelled() {
                        events.send(
                            &client_id,
                            "fs.changed",
                            json!({ "root": watched_root, "paths": paths }),
                        );
                    }
                });
            },
            Config::default(),
        )
        .map_err(|error| RpcError::new("watch-failed", error.to_string()))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| RpcError::new("watch-failed", error.to_string()))?;
        self.watchers.lock().await.insert(
            (context.client_id.clone(), root),
            FsWatch {
                _watcher: watcher,
                cancel,
            },
        );
        Ok(json!({}))
    }

    async fn unwatch(&self, payload: Value, context: &RequestContext) -> RpcResult {
        let root = absolute(&string_field(&payload, "path")?)?;
        if let Some(watch) = self
            .watchers
            .lock()
            .await
            .remove(&(context.client_id.clone(), root))
        {
            watch.cancel.cancel();
        }
        Ok(json!({}))
    }

    async fn read_bytes(&self, payload: Value) -> RpcResult {
        let offset = payload
            .get("offset")
            .and_then(Value::as_u64)
            .ok_or_else(|| RpcError::new("bad-request", "offset must be a non-negative integer"))?;
        let length = payload
            .get("length")
            .and_then(Value::as_u64)
            .filter(|length| *length > 0 && *length <= BYTES_CHUNK_MAX)
            .ok_or_else(|| RpcError::new("bad-request", "length is outside the allowed range"))?;
        let resource = payload
            .get("resource")
            .ok_or_else(|| RpcError::new("bad-request", "Missing resource."))?;
        let asset = match resource.get("kind").and_then(Value::as_str) {
            Some("file") => {
                let path = PathBuf::from(string_field(resource, "path")?);
                self.resolve_file_media(&path)
                    .await?
                    .ok_or_else(|| RpcError::new("not-found", "Not a file this machine serves"))?
            }
            Some("projectIcon") => {
                let project_id = string_field(resource, "projectId")?;
                let theme = resource
                    .get("theme")
                    .and_then(Value::as_str)
                    .unwrap_or("light");
                self.resolve_project_icon(&project_id, theme)
                    .await?
                    .ok_or_else(|| RpcError::new("not-found", "Not a file this machine serves"))?
            }
            _ => return Err(RpcError::new("not-found", "Not a file this machine serves")),
        };
        if asset.len > BYTES_MAX {
            return Err(RpcError::new(
                "too-large",
                format!(
                    "This file is {} MB; at most 32 MB loads over a direct connection",
                    asset.len.div_ceil(1024 * 1024)
                ),
            ));
        }
        if offset > asset.len {
            return Err(RpcError::new(
                "bad-offset",
                format!(
                    "Offset {offset} is past the end of a file of {} bytes",
                    asset.len
                ),
            ));
        }
        let take = length.min(asset.len - offset) as usize;
        let mut file = fs::File::open(&asset.path).await.map_err(io_error)?;
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(io_error)?;
        let mut bytes = vec![0; take];
        file.read_exact(&mut bytes).await.map_err(io_error)?;
        Ok(
            json!({ "mime": asset.mime, "size": asset.len, "version": asset.etag.trim_matches('"'), "offset": offset, "data": base64::engine::general_purpose::STANDARD.encode(bytes) }),
        )
    }
}

async fn browse(payload: Value) -> RpcResult {
    let typed = string_field(&payload, "partialPath")?.trim().to_owned();
    if cfg!(not(windows)) && (looks_windows(&typed)) {
        return Err(RpcError::new(
            "windows-path",
            "That is a Windows path. This machine does not run Windows.",
        ));
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"));
    let cwd = payload
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let target = if typed == "~" || typed.starts_with("~/") {
        home.join(typed.trim_start_matches('~').trim_start_matches('/'))
    } else if typed == "." || typed == ".." || typed.starts_with("./") || typed.starts_with("../") {
        cwd.ok_or_else(|| {
            RpcError::new(
                "cwd-required",
                "A relative path needs an open project to count from",
            )
        })?
        .join(&typed)
    } else if Path::new(&typed).is_absolute() {
        PathBuf::from(&typed)
    } else {
        cwd.unwrap_or(home).join(&typed)
    };
    let whole =
        typed.ends_with('/') || typed.ends_with('\\') || matches!(typed.as_str(), "~" | "." | "..");
    let parent = if whole {
        target.clone()
    } else {
        target.parent().unwrap_or(Path::new("/")).to_path_buf()
    };
    let prefix = if whole {
        String::new()
    } else {
        target
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_lowercase()
    };
    let show_hidden =
        payload.get("hidden").and_then(Value::as_bool) == Some(true) || prefix.starts_with('.');
    let mut entries = Vec::new();
    let mut directory = match fs::read_dir(&parent).await {
        Ok(directory) => directory,
        Err(_) => {
            return Ok(
                json!({ "parentPath": trim_root(&parent), "entries": [], "exists": fs::metadata(&parent).await.map(|m| m.is_dir()).unwrap_or(false) }),
            );
        }
    };
    while let Some(entry) = directory.next_entry().await.map_err(io_error)? {
        let name = entry.file_name().to_string_lossy().to_string();
        if (!show_hidden && name.starts_with('.'))
            || !name.to_lowercase().starts_with(&prefix)
            || !entry.file_type().await.map_err(io_error)?.is_dir()
        {
            continue;
        }
        let full = entry.path();
        entries.push(json!({ "name": name, "fullPath": full, "hasCanvas": fs::metadata(full.join(".ruimte/project.json")).await.is_ok() }));
    }
    entries.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
    Ok(json!({ "parentPath": trim_root(&parent), "entries": entries, "exists": true }))
}

async fn list(payload: Value) -> RpcResult {
    let root = absolute(&string_field(&payload, "path")?)?;
    let metadata = fs::metadata(&root)
        .await
        .map_err(|_| RpcError::new("not-found", format!("{} does not exist", root.display())))?;
    if !metadata.is_dir() {
        return Err(RpcError::new(
            "not-a-directory",
            format!("{} is not a directory", root.display()),
        ));
    }
    let depth = payload
        .get("depth")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 3) as usize;
    let hidden = payload.get("hidden").and_then(Value::as_bool) == Some(true);
    let mut by_directory = HashMap::<PathBuf, Vec<Value>>::new();
    let mut queue = vec![root.clone()];
    let mut total = 0;
    let mut truncated = false;
    for _ in 0..depth {
        if queue.is_empty() || truncated {
            break;
        }
        let mut level_entries = Vec::new();
        for directory in &queue {
            let mut read = read_entries(directory, hidden).await.unwrap_or_default();
            if total + read.len() > LIST_MAX {
                read.truncate(LIST_MAX - total);
                truncated = true;
            }
            total += read.len();
            level_entries.extend(read.iter().cloned());
            by_directory.insert(directory.clone(), read);
            if truncated {
                break;
            }
        }
        let paths = level_entries
            .iter()
            .filter_map(|entry| entry["path"].as_str().map(PathBuf::from))
            .collect::<Vec<_>>();
        let ignored = ignored_paths(&paths, &root).await;
        for entry in by_directory.values_mut().flatten() {
            if entry["ignored"] != true
                && entry["path"]
                    .as_str()
                    .is_some_and(|path| ignored.contains(Path::new(path)))
            {
                entry["ignored"] = json!(true);
            }
        }
        queue = level_entries
            .iter()
            .filter(|entry| entry["kind"] == "directory")
            .filter_map(|entry| entry["path"].as_str().map(PathBuf::from))
            .filter(|path| !ignored.contains(path) && path.file_name() != Some(OsStr::new(".git")))
            .collect();
    }
    let mut entries = Vec::new();
    emit_entries(&root, &by_directory, &mut entries);
    Ok(json!({ "path": root, "entries": entries, "truncated": truncated }))
}

async fn read_entries(directory: &Path, hidden: bool) -> Result<Vec<Value>, std::io::Error> {
    let mut reader = fs::read_dir(directory).await?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if !hidden && name.starts_with('.') {
            continue;
        }
        let kind = entry.file_type().await?;
        let metadata = fs::symlink_metadata(entry.path()).await.ok();
        let kind_name = if kind.is_symlink() {
            "symlink"
        } else if kind.is_dir() {
            "directory"
        } else if kind.is_file() {
            "file"
        } else {
            "other"
        };
        let mtime = metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        entries.push(json!({
            "name": name,
            "path": entry.path(),
            "kind": kind_name,
            "size": if kind.is_file() { metadata.as_ref().map(|metadata| metadata.len()) } else { None },
            "mtime": mtime,
            "hidden": name.starts_with('.'),
            "ignored": name == ".git"
        }));
    }
    entries.sort_by(|left, right| {
        let left_rank = if left["kind"] == "directory" { 0 } else { 1 };
        let right_rank = if right["kind"] == "directory" { 0 } else { 1 };
        left_rank.cmp(&right_rank).then_with(|| {
            natural_cmp(
                left["name"].as_str().unwrap_or_default(),
                right["name"].as_str().unwrap_or_default(),
            )
        })
    });
    Ok(entries)
}

fn emit_entries(root: &Path, by_directory: &HashMap<PathBuf, Vec<Value>>, output: &mut Vec<Value>) {
    for entry in by_directory.get(root).into_iter().flatten() {
        output.push(entry.clone());
        if entry["kind"] == "directory" {
            if let Some(path) = entry["path"].as_str() {
                emit_entries(Path::new(path), by_directory, output);
            }
        }
    }
}

async fn ignored_paths(paths: &[PathBuf], cwd: &Path) -> HashSet<PathBuf> {
    if paths.is_empty() {
        return HashSet::new();
    }
    let mut child = match Command::new("git")
        .args(["check-ignore", "-z", "--stdin"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return HashSet::new(),
    };
    let mut input = Vec::new();
    for path in paths {
        input.extend_from_slice(path.to_string_lossy().as_bytes());
        input.push(0);
    }
    if let Some(mut stdin) = child.stdin.take() {
        if stdin.write_all(&input).await.is_err() {
            return HashSet::new();
        }
    }
    let Ok(output) = child.wait_with_output().await else {
        return HashSet::new();
    };
    if !matches!(output.status.code(), Some(0 | 1)) {
        return HashSet::new();
    }
    output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| PathBuf::from(String::from_utf8_lossy(path).to_string()))
        .collect()
}

fn natural_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    let mut left = left.as_bytes().iter().copied().peekable();
    let mut right = right.as_bytes().iter().copied().peekable();
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let mut left_number = Vec::new();
                let mut right_number = Vec::new();
                while left.peek().is_some_and(u8::is_ascii_digit) {
                    left_number.push(left.next().unwrap());
                }
                while right.peek().is_some_and(u8::is_ascii_digit) {
                    right_number.push(right.next().unwrap());
                }
                let left_trimmed = left_number
                    .iter()
                    .skip_while(|byte| **byte == b'0')
                    .collect::<Vec<_>>();
                let right_trimmed = right_number
                    .iter()
                    .skip_while(|byte| **byte == b'0')
                    .collect::<Vec<_>>();
                let ordering = left_trimmed
                    .len()
                    .cmp(&right_trimmed.len())
                    .then_with(|| left_trimmed.cmp(&right_trimmed));
                if !ordering.is_eq() {
                    return ordering;
                }
            }
            (Some(a), Some(b)) => {
                left.next();
                right.next();
                let ordering = a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase());
                if !ordering.is_eq() {
                    return ordering;
                }
            }
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
        }
    }
}

async fn read(payload: Value) -> RpcResult {
    let path = PathBuf::from(string_field(&payload, "path")?);
    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|_| RpcError::new("not-found", format!("{} does not exist", path.display())))?;
    if !metadata.is_file() {
        return Err(RpcError::new(
            "not-a-file",
            format!("{} is not a file", path.display()),
        ));
    }
    let head = read_head(&path).await?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    if let Some(mime) = inspect_mime(&head, head.len() == SNIFF_BYTES) {
        return Ok(
            json!({ "kind": "binary", "mime": mime, "size": metadata.len(), "mtime": mtime }),
        );
    }
    if metadata.len() > READ_MAX {
        return Ok(json!({ "kind": "too-large", "size": metadata.len() }));
    }
    let bytes = fs::read(&path).await.map_err(io_error)?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let mut result = json!({ "kind": "text", "text": text, "encoding": "utf-8", "size": metadata.len(), "mtime": mtime });
    if let Some(language) = language_of(&path) {
        result
            .as_object_mut()
            .unwrap()
            .insert("language".to_owned(), Value::String(language.to_owned()));
    }
    Ok(result)
}

async fn search(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let query = payload
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(20)
        .min(SEARCH_MAX as u64) as usize;
    let (files, truncated) = list_searchable(&cwd).await;
    let mut scored = files
        .into_iter()
        .filter_map(|path| fuzzy_score(&query, &path).map(|score| (path, score)))
        .collect::<Vec<_>>();
    scored.sort_by(|(left, left_score), (right, right_score)| {
        right_score
            .cmp(left_score)
            .then(left.len().cmp(&right.len()))
            .then(left.cmp(right))
    });
    Ok(
        json!({ "files": scored.into_iter().take(limit).map(|(path, _)| path).collect::<Vec<_>>(), "truncated": truncated }),
    )
}

async fn grep(payload: Value) -> RpcResult {
    let cwd = PathBuf::from(string_field(&payload, "cwd")?);
    let query = string_field(&payload, "query")?.trim().to_owned();
    if query.is_empty() {
        return Ok(json!({ "matches": [], "files": 0, "truncated": false }));
    }
    let is_regex = payload.get("regex").and_then(Value::as_bool) == Some(true);
    let case_sensitive = payload.get("caseSensitive").and_then(Value::as_bool) == Some(true);
    let whole_word = payload.get("wholeWord").and_then(Value::as_bool) == Some(true);
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(GREP_MAX as u64)
        .min(GREP_MAX as u64) as usize;
    let source = if is_regex {
        query.clone()
    } else {
        regex::escape(&query)
    };
    let source = if whole_word {
        format!(r"\b(?:{source})\b")
    } else {
        source
    };
    let pattern = RegexBuilder::new(&source)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|_| RpcError::new("invalid-query", "That is not a valid search pattern"))?;
    if let Ok(result) =
        grep_with_rg(&cwd, &query, is_regex, case_sensitive, whole_word, limit).await
    {
        return Ok(result);
    }
    let (paths, walk_truncated) = list_searchable(&cwd).await;
    let mut matches = Vec::new();
    let mut matched_files = HashSet::new();
    let mut truncated = walk_truncated;
    for relative in paths {
        if matches.len() >= limit {
            truncated = true;
            break;
        }
        let path = cwd.join(&relative);
        let Ok(metadata) = fs::metadata(&path).await else {
            continue;
        };
        if metadata.len() > READ_MAX {
            continue;
        }
        let Ok(bytes) = fs::read(&path).await else {
            continue;
        };
        if looks_binary(&bytes, false) {
            continue;
        }
        let content = String::from_utf8_lossy(&bytes);
        let lines = content
            .lines()
            .map(|line| line.trim_end_matches('\r'))
            .collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if matches.len() >= limit {
                truncated = true;
                break;
            }
            let Some(found) = pattern.find(line) else {
                continue;
            };
            matched_files.insert(relative.clone());
            let before = lines[index.saturating_sub(2)..index]
                .iter()
                .map(|line| crop(line))
                .collect::<Vec<_>>();
            let after = lines[index + 1..(index + 3).min(lines.len())]
                .iter()
                .map(|line| crop(line))
                .collect::<Vec<_>>();
            let column = line[..found.start()].encode_utf16().count();
            let length = line[found.start()..found.end()].encode_utf16().count();
            matches.push(json!({ "path": relative, "line": index + 1, "column": column, "length": length, "text": crop(line), "before": before, "after": after }));
        }
    }
    Ok(json!({ "matches": matches, "files": matched_files.len(), "truncated": truncated }))
}

async fn grep_with_rg(
    cwd: &Path,
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    limit: usize,
) -> Result<Value, ()> {
    let mut arguments = vec!["--json".to_owned(), "--context=2".to_owned()];
    if !is_regex {
        arguments.push("--fixed-strings".to_owned());
    }
    arguments.push(
        if case_sensitive {
            "--case-sensitive"
        } else {
            "--ignore-case"
        }
        .to_owned(),
    );
    if whole_word {
        arguments.push("--word-regexp".to_owned());
    }
    arguments.extend([
        format!("--max-filesize={READ_MAX}"),
        "--no-messages".to_owned(),
        "--".to_owned(),
        query.to_owned(),
        ".".to_owned(),
    ]);
    let mut child = Command::new("rg")
        .args(arguments)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ())?;
    let stdout = child.stdout.take().ok_or(())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut matches = Vec::new();
    let mut files = HashSet::new();
    let mut current_path = None;
    let mut hits = Vec::<(u64, String, usize, usize)>::new();
    let mut context = HashMap::<u64, String>::new();
    let mut truncated = false;
    while let Some(line) = lines.next_line().await.map_err(|_| ())? {
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("begin") => {
                flush_rg_file(
                    &mut current_path,
                    &mut hits,
                    &mut context,
                    &mut matches,
                    &mut files,
                    limit,
                );
                current_path = event
                    .pointer("/data/path/text")
                    .and_then(Value::as_str)
                    .map(|path| path.trim_start_matches("./").to_owned());
            }
            Some("match") | Some("context") => {
                let Some(number) = event.pointer("/data/line_number").and_then(Value::as_u64)
                else {
                    continue;
                };
                let Some(text) = event.pointer("/data/lines/text").and_then(Value::as_str) else {
                    continue;
                };
                let text = text.trim_end_matches(['\r', '\n']).to_owned();
                context.insert(number, text.clone());
                if event.get("type").and_then(Value::as_str) == Some("match")
                    && let Some(submatch) = event
                        .pointer("/data/submatches/0")
                        .and_then(Value::as_object)
                {
                    hits.push((
                        number,
                        text,
                        submatch.get("start").and_then(Value::as_u64).unwrap_or(0) as usize,
                        submatch.get("end").and_then(Value::as_u64).unwrap_or(0) as usize,
                    ));
                }
            }
            Some("end") => {
                flush_rg_file(
                    &mut current_path,
                    &mut hits,
                    &mut context,
                    &mut matches,
                    &mut files,
                    limit,
                );
                if matches.len() >= limit {
                    truncated = true;
                    let _ = child.kill().await;
                    break;
                }
            }
            _ => {}
        }
    }
    flush_rg_file(
        &mut current_path,
        &mut hits,
        &mut context,
        &mut matches,
        &mut files,
        limit,
    );
    if !truncated {
        let status = child.wait().await.map_err(|_| ())?;
        if !matches!(status.code(), Some(0 | 1)) {
            return Err(());
        }
    }
    Ok(json!({ "matches": matches, "files": files.len(), "truncated": truncated }))
}

fn flush_rg_file(
    path: &mut Option<String>,
    hits: &mut Vec<(u64, String, usize, usize)>,
    lines: &mut HashMap<u64, String>,
    matches: &mut Vec<Value>,
    files: &mut HashSet<String>,
    limit: usize,
) {
    if let Some(path) = path.take()
        && !hits.is_empty()
    {
        files.insert(path.clone());
        for (line, original, start, end) in hits.drain(..) {
            if matches.len() >= limit {
                break;
            }
            let text = crop(&original);
            let column = utf16_units_to_byte(&original, start).min(text.encode_utf16().count());
            let length = utf16_units_to_byte(&original, end)
                .saturating_sub(column)
                .min(text.encode_utf16().count().saturating_sub(column));
            let before = ((line.saturating_sub(2))..line)
                .filter_map(|number| lines.get(&number).map(|text| crop(text)))
                .collect::<Vec<_>>();
            let after = ((line + 1)..=(line + 2))
                .filter_map(|number| lines.get(&number).map(|text| crop(text)))
                .collect::<Vec<_>>();
            matches.push(json!({ "path": path, "line": line, "column": column, "length": length, "text": text, "before": before, "after": after }));
        }
    }
    hits.clear();
    lines.clear();
}

fn utf16_units_to_byte(text: &str, byte_offset: usize) -> usize {
    let end = byte_offset.min(text.len());
    String::from_utf8_lossy(&text.as_bytes()[..end])
        .encode_utf16()
        .count()
}

async fn reveal(payload: Value) -> RpcResult {
    let path = PathBuf::from(string_field(&payload, "path")?);
    if fs::metadata(&path).await.is_err() {
        return Err(RpcError::new(
            "not-found",
            format!("{} does not exist", path.display()),
        ));
    }
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(&path));
        command
    };
    let result = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|error| RpcError::new("reveal-failed", error.to_string()))?;
    if !result.success() {
        return Err(RpcError::new(
            "reveal-failed",
            "The file manager could not reveal that path",
        ));
    }
    Ok(json!({}))
}

async fn list_searchable(cwd: &Path) -> (Vec<String>, bool) {
    if let Ok(output) = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .current_dir(cwd)
        .output()
        .await
    {
        if output.status.success() {
            return (
                output
                    .stdout
                    .split(|byte| *byte == 0)
                    .filter(|bytes| !bytes.is_empty())
                    .map(|bytes| String::from_utf8_lossy(bytes).to_string())
                    .collect(),
                false,
            );
        }
    }
    let root = cwd.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let skip = [
            "node_modules",
            ".git",
            "dist",
            "build",
            "target",
            "vendor",
            ".cache",
            "__pycache__",
            ".venv",
            "venv",
        ];
        let mut files = Vec::new();
        for entry in WalkDir::new(&root)
            .max_depth(13)
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy();
                entry.depth() == 0 || (!name.starts_with('.') && !skip.contains(&name.as_ref()))
            })
            .flatten()
        {
            if entry.file_type().is_file() {
                files.push(
                    entry
                        .path()
                        .strip_prefix(&root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
                if files.len() >= 20_000 {
                    return (files, true);
                }
            }
        }
        (files, false)
    })
    .await
    .unwrap_or_default()
}

fn fuzzy_score(query: &str, path: &str) -> Option<i32> {
    if query.is_empty() {
        return Some(0);
    }
    let haystack = path.to_lowercase();
    let name_start = haystack.rfind('/').map(|index| index + 1).unwrap_or(0);
    let mut score = 0;
    let mut cursor = 0;
    let mut previous = None;
    for character in query.chars() {
        let found = haystack[cursor..].find(character)? + cursor;
        score += 1;
        if found == 0 || "/.-_ ".contains(haystack.as_bytes()[found.saturating_sub(1)] as char) {
            score += 4;
        }
        if previous == Some(found.saturating_sub(1)) {
            score += 3;
        }
        if found >= name_start {
            score += 2;
        }
        previous = Some(found);
        cursor = found + character.len_utf8();
    }
    if haystack[name_start..].starts_with(query) {
        score += 10;
    }
    Some(score)
}

fn absolute(path: &str) -> Result<PathBuf, RpcError> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(io_error)
    }
}

fn trim_root(path: &Path) -> String {
    let value = path.to_string_lossy();
    if value.len() > 1 {
        value.trim_end_matches(std::path::MAIN_SEPARATOR).to_owned()
    } else {
        value.to_string()
    }
}

fn looks_windows(path: &str) -> bool {
    path.as_bytes().get(1) == Some(&b':')
        && path.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        || path.starts_with("\\\\")
}
const SNIFF_BYTES: usize = 8 * 1024;

async fn read_head(path: &Path) -> Result<Vec<u8>, RpcError> {
    use tokio::io::AsyncReadExt;

    let mut file = fs::File::open(path).await.map_err(io_error)?;
    let mut bytes = vec![0; SNIFF_BYTES];
    let read = file.read(&mut bytes).await.map_err(io_error)?;
    bytes.truncate(read);
    Ok(bytes)
}

fn inspect_mime(bytes: &[u8], truncated: bool) -> Option<String> {
    sniff_mime(bytes)
        .map(str::to_owned)
        .or_else(|| looks_binary(bytes, truncated).then(|| "application/octet-stream".to_owned()))
        .or_else(|| looks_like_svg(bytes).then(|| "image/svg+xml".to_owned()))
}

fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"%PDF-") {
        Some("application/pdf")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.get(4..8) == Some(b"ftyp") {
        match bytes.get(8..12) {
            Some(b"M4A " | b"M4B " | b"M4P ") => None,
            Some(b"qt  ") => Some("video/quicktime"),
            _ => Some("video/mp4"),
        }
    } else if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        if bytes[..bytes.len().min(64)]
            .windows(4)
            .any(|part| part == b"webm")
        {
            Some("video/webm")
        } else {
            Some("video/x-matroska")
        }
    } else if bytes.starts_with(b"OggS") {
        Some("video/ogg")
    } else {
        None
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]);
    let head = text.trim_start_matches('\u{feff}').trim_start();
    (head.starts_with("<?xml") || head.starts_with("<!--") || head.starts_with("<svg"))
        && head.to_ascii_lowercase().contains("<svg")
}

fn looks_binary(bytes: &[u8], truncated: bool) -> bool {
    if bytes.is_empty() {
        return false;
    }
    if bytes.contains(&0) {
        return true;
    }
    let controls = bytes
        .iter()
        .filter(|byte| **byte < 0x20 && !matches!(**byte, b'\t' | b'\n' | 0x0c | b'\r' | 0x1b))
        .count();
    if controls as f64 / bytes.len() as f64 > 0.1 {
        return true;
    }
    let checked = if truncated {
        &bytes[..bytes.len().saturating_sub(3)]
    } else {
        bytes
    };
    std::str::from_utf8(checked).is_err()
}
async fn resolved_asset(path: &Path, mime: String) -> Result<Option<ResolvedAsset>, RpcError> {
    let path = match fs::canonicalize(path).await {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    let metadata = fs::metadata(&path).await.map_err(io_error)?;
    if !metadata.is_file() {
        return Ok(None);
    }
    let modified = metadata.modified().ok();
    let modified_ms = modified
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(Some(ResolvedAsset {
        path,
        mime,
        len: metadata.len(),
        modified,
        etag: format!("\"{modified_ms}-{}\"", metadata.len()),
    }))
}
fn crop(text: &str) -> String {
    text.chars().take(500).collect()
}
fn language_of(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(OsStr::to_str)?
        .to_lowercase()
        .as_str()
    {
        "rs" => Some("rust"),
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" => Some("javascript"),
        "json" => Some("json"),
        "md" => Some("markdown"),
        "css" => Some("css"),
        "html" => Some("html"),
        "py" => Some("python"),
        "sh" | "zsh" | "bash" => Some("shell"),
        "toml" => Some("toml"),
        "yaml" | "yml" => Some("yaml"),
        _ => None,
    }
}
