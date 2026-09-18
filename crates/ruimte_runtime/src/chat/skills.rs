use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};

use serde_json::{Value, json};
use tokio::{fs, sync::Mutex, time::Instant};

use crate::rpc::RpcError;

const CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct SkillIndex {
    home: PathBuf,
    claude_config: PathBuf,
    cache: std::sync::Arc<Mutex<HashMap<String, CachedSkills>>>,
}

struct CachedSkills {
    at: Instant,
    skills: Vec<Value>,
}

struct SkillRoot {
    directory: PathBuf,
    source: &'static str,
    prefix: Option<String>,
}

impl SkillIndex {
    pub fn new(home: PathBuf, claude_config: Option<PathBuf>) -> Self {
        Self {
            claude_config: claude_config.unwrap_or_else(|| home.join(".claude")),
            home,
            cache: std::sync::Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn list(&self, provider: &str, cwd: &Path) -> Result<Vec<Value>, RpcError> {
        let key = format!("{provider}:{}", cwd.display());
        if let Some(cached) = self.cache.lock().await.get(&key)
            && cached.at.elapsed() < CACHE_TTL
        {
            return Ok(cached.skills.clone());
        }
        let roots = self.roots(provider, cwd).await?;
        let skills = scan_roots(roots).await;
        self.cache.lock().await.insert(
            key,
            CachedSkills {
                at: Instant::now(),
                skills: skills.clone(),
            },
        );
        Ok(skills)
    }

    async fn roots(&self, provider: &str, cwd: &Path) -> Result<Vec<SkillRoot>, RpcError> {
        if provider == "codex" {
            let mut roots = vec![
                SkillRoot {
                    directory: self.home.join(".agents/skills"),
                    source: "user",
                    prefix: None,
                },
                SkillRoot {
                    directory: self.home.join(".codex/skills"),
                    source: "user",
                    prefix: None,
                },
            ];
            roots.extend(
                project_directories(cwd, &self.home)
                    .into_iter()
                    .map(|directory| SkillRoot {
                        directory: directory.join(".agents/skills"),
                        source: "project",
                        prefix: None,
                    }),
            );
            return Ok(roots);
        }
        let mut roots = vec![SkillRoot {
            directory: self.claude_config.join("skills"),
            source: "user",
            prefix: None,
        }];
        roots.extend(
            project_directories(cwd, &self.home)
                .into_iter()
                .map(|directory| SkillRoot {
                    directory: directory.join(".claude/skills"),
                    source: "project",
                    prefix: None,
                }),
        );
        roots.extend(plugin_roots(&self.claude_config).await?);
        Ok(roots)
    }
}

async fn scan_roots(roots: Vec<SkillRoot>) -> Vec<Value> {
    let mut found = HashMap::<String, Value>::new();
    for root in roots {
        let mut entries = match fs::read_dir(&root.directory).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if !entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            let folder = entry.file_name().to_string_lossy().into_owned();
            let Ok(text) = fs::read_to_string(entry.path().join("SKILL.md")).await else {
                continue;
            };
            let fields = parse_frontmatter(&text);
            let own = fields
                .get("name")
                .filter(|name| valid_name(name))
                .cloned()
                .unwrap_or(folder);
            let name = root
                .prefix
                .as_ref()
                .map(|prefix| format!("{prefix}:{own}"))
                .unwrap_or(own);
            if !valid_name(&name) || found.contains_key(&name) {
                continue;
            }
            found.insert(
                name.clone(),
                json!({
                    "name": name,
                    "description": fields.get("description").cloned().unwrap_or_default(),
                    "source": root.source,
                }),
            );
        }
    }
    let mut skills = found.into_values().collect::<Vec<_>>();
    skills.sort_by(|left, right| {
        let left = left.get("name").and_then(Value::as_str).unwrap_or_default();
        let right = right
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        skill_sort_key(left).cmp(&skill_sort_key(right))
    });
    skills
}

fn skill_sort_key(name: &str) -> (Vec<u16>, Vec<u8>) {
    let primary = name
        .bytes()
        .map(|byte| match byte {
            b'_' => 1,
            b'-' => 2,
            b':' => 3,
            byte => u16::from(byte.to_ascii_lowercase()) + 4,
        })
        .collect();
    let secondary = name
        .bytes()
        .map(|byte| u8::from(byte.is_ascii_uppercase()))
        .collect();
    (primary, secondary)
}

fn project_directories(cwd: &Path, home: &Path) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    let mut current = cwd.to_path_buf();
    while current != home && current.parent().is_some() && directories.len() < 8 {
        directories.push(current.clone());
        if current.join(".git").exists() {
            break;
        }
        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current || parent == home.parent().unwrap_or(home) {
            break;
        }
        current = parent.to_path_buf();
    }
    directories
}

async fn plugin_roots(config: &Path) -> Result<Vec<SkillRoot>, RpcError> {
    let raw = match fs::read(config.join("plugins/installed_plugins.json")).await {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RpcError::new("chat-storage", error.to_string())),
    };
    let Ok(parsed) = serde_json::from_slice::<Value>(&raw) else {
        return Ok(Vec::new());
    };
    let Some(plugins) = parsed.get("plugins").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let mut roots = Vec::new();
    for (key, installs) in plugins {
        let prefix = key.split('@').next().unwrap_or(key).to_owned();
        for install in installs.as_array().into_iter().flatten() {
            if let Some(path) = install.get("installPath").and_then(Value::as_str)
                && !path.is_empty()
            {
                roots.push(SkillRoot {
                    directory: Path::new(path).join("skills"),
                    source: "plugin",
                    prefix: Some(prefix.clone()),
                });
            }
        }
    }
    Ok(roots)
}

fn parse_frontmatter(text: &str) -> HashMap<String, String> {
    let normalized = text.replace("\r\n", "\n");
    let Some(body) = normalized.strip_prefix("---\n") else {
        return HashMap::new();
    };
    let Some((frontmatter, _)) = body.split_once("\n---") else {
        return HashMap::new();
    };
    let lines = frontmatter.lines().collect::<Vec<_>>();
    let mut fields = HashMap::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        let Some((key, raw)) = line.split_once(':') else {
            index += 1;
            continue;
        };
        if !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            index += 1;
            continue;
        }
        let mut value = raw.trim().to_owned();
        if matches!(value.as_str(), "" | ">" | ">-" | "|" | "|-") {
            let keep_newlines = value.starts_with('|');
            let mut parts = Vec::new();
            while index + 1 < lines.len()
                && lines[index + 1]
                    .chars()
                    .next()
                    .is_some_and(char::is_whitespace)
                && !lines[index + 1].trim().is_empty()
            {
                index += 1;
                parts.push(lines[index].trim());
            }
            value = parts.join(if keep_newlines { "\n" } else { " " });
        }
        if value.len() >= 2
            && ((value.starts_with('\'') && value.ends_with('\''))
                || (value.starts_with('"') && value.ends_with('"')))
        {
            value = value[1..value.len() - 1].to_owned();
        }
        fields.insert(key.to_owned(), value);
        index += 1;
    }
    fields
}

fn valid_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flat_and_block_frontmatter() {
        assert_eq!(
            parse_frontmatter(
                "---\r\nname: 'review'\r\ndescription: >-\r\n  Checks the code\r\n  carefully\r\n---\r\n"
            )["description"],
            "Checks the code carefully"
        );
        assert_eq!(
            parse_frontmatter("---\ndescription: |\n  first\n  second\n---\n")["description"],
            "first\nsecond"
        );
    }

    #[tokio::test]
    async fn scans_provider_roots_with_precedence_and_plugin_prefixes() {
        let temporary = tempfile::tempdir().unwrap();
        let home = temporary.path().join("home");
        let project = temporary.path().join("work/repo");
        let plugin = temporary.path().join("plugin");
        for path in [
            home.join(".claude/skills/shared"),
            project.join(".claude/skills/shared"),
            project.join(".claude/skills/local"),
            plugin.join("skills/check"),
        ] {
            fs::create_dir_all(&path).await.unwrap();
        }
        fs::write(
            home.join(".claude/skills/shared/SKILL.md"),
            "---\ndescription: user\n---",
        )
        .await
        .unwrap();
        fs::write(
            project.join(".claude/skills/shared/SKILL.md"),
            "---\ndescription: project\n---",
        )
        .await
        .unwrap();
        fs::write(
            project.join(".claude/skills/local/SKILL.md"),
            "---\nname: local\ndescription: here\n---",
        )
        .await
        .unwrap();
        fs::write(
            plugin.join("skills/check/SKILL.md"),
            "---\nname: scan\ndescription: plugin\n---",
        )
        .await
        .unwrap();
        fs::create_dir_all(home.join(".claude/plugins"))
            .await
            .unwrap();
        fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            json!({ "plugins": { "tools@market": [{ "installPath": plugin }] } }).to_string(),
        )
        .await
        .unwrap();

        let index = SkillIndex::new(home.clone(), None);
        let skills = index.list("claude", &project).await.unwrap();
        assert_eq!(
            skills
                .iter()
                .map(|skill| skill["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["local", "shared", "tools:scan"]
        );
        assert_eq!(skills[1]["description"], "user");
    }

    #[test]
    fn sorts_case_and_punctuation_like_the_client() {
        let mut names = [
            "Beta", "ab2", "a-b", "xy", "ab10", "a", "x:y", "beta", "A", "a:b", "x_y", "ab", "aa",
            "a_b", "ab1", "x-y", "b",
        ];
        names.sort_by_key(|name| skill_sort_key(name));
        assert_eq!(
            names,
            [
                "a", "A", "a_b", "a-b", "a:b", "aa", "ab", "ab1", "ab10", "ab2", "b", "beta",
                "Beta", "x_y", "x-y", "x:y", "xy",
            ]
        );
    }
}
