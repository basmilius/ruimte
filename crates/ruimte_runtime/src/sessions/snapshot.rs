use std::path::{Path, PathBuf};

use anyhow::Context;
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

pub struct SnapshotStore {
    directory: PathBuf,
}

impl SnapshotStore {
    pub fn new(home: &Path) -> Self {
        Self {
            directory: home.join("sessions"),
        }
    }

    pub async fn read(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        let path = self.path(session_id);
        match fs::read_to_string(&path).await {
            Ok(screen) => Ok(Some(screen)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => {
                Err(error).with_context(|| format!("read session snapshot {}", path.display()))
            }
        }
    }

    pub async fn write(&self, session_id: &str, screen: &str) -> anyhow::Result<()> {
        fs::create_dir_all(&self.directory).await?;
        set_private_directory(&self.directory).await?;
        let path = self.path(session_id);
        let temporary = path.with_extension(format!("txt.{}.tmp", Uuid::new_v4()));
        let result = async {
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temporary).await?;
            file.write_all(screen.as_bytes()).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary, &path).await?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_file(&temporary).await;
        }
        result
    }

    pub async fn delete(&self, session_id: &str) -> anyhow::Result<()> {
        match fs::remove_file(self.path(session_id)).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn path(&self, session_id: &str) -> PathBuf {
        self.directory
            .join(format!("{}.txt", encode_component(session_id)))
    }
}

fn encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            write!(encoded, "%{byte:02X}").expect("writing to a string cannot fail");
        }
    }
    encoded
}

#[cfg(unix)]
async fn set_private_directory(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn set_private_directory(_path: &Path) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeps_session_ids_inside_the_snapshot_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let store = SnapshotStore::new(temporary.path());
        store.write("../node / é", "screen").await.unwrap();

        assert_eq!(
            store.read("../node / é").await.unwrap(),
            Some("screen".into())
        );
        assert!(!temporary.path().join("node ").exists());
        assert_eq!(
            std::fs::read_dir(temporary.path().join("sessions"))
                .unwrap()
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn concurrent_writes_use_private_unique_temporary_files() {
        let temporary = tempfile::tempdir().unwrap();
        let store = SnapshotStore::new(temporary.path());
        let (first, second) =
            tokio::join!(store.write("node", "first"), store.write("node", "second"));
        first.unwrap();
        second.unwrap();

        let screen = store.read("node").await.unwrap().unwrap();
        assert!(screen == "first" || screen == "second");
        let entries = std::fs::read_dir(temporary.path().join("sessions"))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                entries[0].metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
