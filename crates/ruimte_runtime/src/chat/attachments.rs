use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{
    Engine,
    alphabet::STANDARD,
    engine::{GeneralPurpose, GeneralPurposeConfig},
};
use rand::{RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{fs, io::AsyncWriteExt};

use crate::rpc::RpcError;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_COUNT: usize = 8;

const DECODER: GeneralPurpose = GeneralPurpose::new(
    &STANDARD,
    GeneralPurposeConfig::new().with_decode_allow_trailing_bits(true),
);

#[derive(Clone)]
pub struct AttachmentStore {
    directory: PathBuf,
}

#[derive(Deserialize)]
pub struct AttachmentUpload {
    name: String,
    mime: String,
    data: String,
}

pub struct ResolvedAttachment {
    pub asset: ResolvedAsset,
    pub name: String,
    pub inline: bool,
}

#[derive(Clone, Debug)]
pub struct ResolvedAsset {
    pub path: PathBuf,
    pub mime: String,
    pub len: u64,
    pub modified: Option<SystemTime>,
    pub etag: String,
}

impl AttachmentStore {
    pub fn new(home: &Path) -> Self {
        Self {
            directory: home.join("attachments"),
        }
    }

    pub async fn save_all(
        &self,
        chat_id: &str,
        uploads: Vec<AttachmentUpload>,
    ) -> Result<Vec<Value>, RpcError> {
        let uploads = validate_uploads(uploads)?;
        let mut saved = Vec::with_capacity(uploads.len());
        for upload in uploads {
            match self.save(chat_id, upload).await {
                Ok(attachment) => saved.push(attachment),
                Err(error) => {
                    for attachment in &saved {
                        if let Some(path) = attachment.get("path").and_then(Value::as_str) {
                            let _ = fs::remove_file(path).await;
                        }
                    }
                    return Err(error);
                }
            }
        }
        Ok(saved)
    }

    pub async fn remove_all(&self, chat_id: &str) -> Result<(), RpcError> {
        match fs::remove_dir_all(self.folder(chat_id)).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(storage_error(error)),
        }
    }

    pub async fn remove_saved(&self, attachments: &[Value]) {
        for attachment in attachments {
            if let Some(path) = attachment.get("path").and_then(Value::as_str) {
                let _ = fs::remove_file(path).await;
            }
        }
    }

    pub async fn resolve(
        &self,
        chat_id: &str,
        attachment: &Value,
    ) -> Result<Option<ResolvedAttachment>, RpcError> {
        let Some(id) = attachment.get("id").and_then(Value::as_str) else {
            return Ok(None);
        };
        let Some(path) = attachment.get("path").and_then(Value::as_str) else {
            return Ok(None);
        };
        let expected = match fs::canonicalize(self.folder(chat_id)).await {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        let path = match fs::canonicalize(path).await {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        let valid_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("{id}.")));
        if !path.starts_with(&expected) || !valid_name {
            return Ok(None);
        }
        let metadata = fs::metadata(&path).await.map_err(storage_error)?;
        if !metadata.is_file() {
            return Ok(None);
        }
        let mime = attachment
            .get("mime")
            .and_then(Value::as_str)
            .unwrap_or("application/octet-stream")
            .to_owned();
        let modified = metadata.modified().ok();
        let modified_ms = modified
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        Ok(Some(ResolvedAttachment {
            asset: ResolvedAsset {
                path,
                mime: mime.clone(),
                len: metadata.len(),
                modified,
                etag: format!("\"{modified_ms}-{}\"", metadata.len()),
            },
            name: attachment
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_owned(),
            inline: is_inline_mime(&mime),
        }))
    }

    pub async fn migrate_items(
        &self,
        chat_id: &str,
        items: &mut [Value],
    ) -> Result<bool, RpcError> {
        let mut migrated = false;
        for item in items {
            let Some(attachments) = item.get_mut("attachments").and_then(Value::as_array_mut)
            else {
                continue;
            };
            for attachment in attachments {
                let Some(upload) = inline_upload(attachment) else {
                    continue;
                };
                *attachment = self.save(chat_id, upload).await?;
                migrated = true;
            }
        }
        Ok(migrated)
    }

    async fn save(&self, chat_id: &str, upload: ValidUpload) -> Result<Value, RpcError> {
        let folder = self.folder(chat_id);
        private_directory(&self.directory).await?;
        private_directory(&folder).await?;
        let mime = attachment_image_mime(&upload.name, &upload.mime)
            .unwrap_or_else(|| upload.mime.clone());
        for _ in 0..8 {
            let mut random = [0_u8; 8];
            OsRng.fill_bytes(&mut random);
            let id = random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let path = folder.join(format!("{id}.{}", extension_for(&upload.name, &mime)));
            let mut options = fs::OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                options.mode(0o600);
            }
            match options.open(&path).await {
                Ok(mut file) => {
                    if let Err(error) = file.write_all(&upload.bytes).await {
                        drop(file);
                        let _ = fs::remove_file(&path).await;
                        return Err(storage_error(error));
                    }
                    file.flush().await.map_err(storage_error)?;
                    return Ok(json!({
                        "id": id,
                        "name": upload.name,
                        "mime": mime,
                        "size": upload.bytes.len(),
                        "path": path,
                    }));
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(storage_error(error)),
            }
        }
        Err(RpcError::new(
            "chat-storage",
            "Could not allocate an attachment file",
        ))
    }

    fn folder(&self, chat_id: &str) -> PathBuf {
        self.directory.join(encode_component(chat_id))
    }
}

struct ValidUpload {
    name: String,
    mime: String,
    bytes: Vec<u8>,
}

fn validate_uploads(uploads: Vec<AttachmentUpload>) -> Result<Vec<ValidUpload>, RpcError> {
    if uploads.len() > MAX_COUNT {
        return Err(invalid("At most 8 attachments are allowed"));
    }
    let mut total = 0_usize;
    let mut valid = Vec::with_capacity(uploads.len());
    for upload in uploads {
        if upload.name.is_empty() || upload.name.encode_utf16().count() > 255 {
            return Err(invalid(
                "Attachment name must be between 1 and 255 characters",
            ));
        }
        if upload.mime.is_empty() || upload.mime.encode_utf16().count() > 255 {
            return Err(invalid(
                "Attachment MIME type must be between 1 and 255 characters",
            ));
        }
        if !valid_base64(&upload.data) {
            return Err(invalid("Invalid attachment base64"));
        }
        let size = decoded_size(&upload.data);
        if size > MAX_BYTES {
            return Err(invalid("Attachment exceeds 10 MiB"));
        }
        total = total.saturating_add(size);
        if total > MAX_BYTES {
            return Err(invalid("Attachments must total at most 10 MiB per message"));
        }
        let bytes = DECODER
            .decode(upload.data.as_bytes())
            .map_err(|_| invalid("Invalid attachment base64"))?;
        valid.push(ValidUpload {
            name: upload.name,
            mime: upload.mime,
            bytes,
        });
    }
    Ok(valid)
}

fn inline_upload(value: &Value) -> Option<ValidUpload> {
    let name = value.get("name")?.as_str()?.to_owned();
    let mime = value.get("mediaType")?.as_str()?.to_owned();
    let data = value.get("data")?.as_str()?;
    validate_uploads(vec![AttachmentUpload {
        name,
        mime,
        data: data.to_owned(),
    }])
    .ok()?
    .pop()
}

fn valid_base64(data: &str) -> bool {
    if data.is_empty() || !data.len().is_multiple_of(4) {
        return false;
    }
    let padding = if data.ends_with("==") {
        2
    } else if data.ends_with('=') {
        1
    } else {
        0
    };
    data[..data.len() - padding]
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
}

fn decoded_size(data: &str) -> usize {
    data.len() * 3 / 4
        - if data.ends_with("==") {
            2
        } else if data.ends_with('=') {
            1
        } else {
            0
        }
}

pub fn attachment_image_mime(name: &str, mime: &str) -> Option<String> {
    let declared = mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(
        declared.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    ) {
        return Some(declared);
    }
    if !matches!(
        declared.as_str(),
        "" | "application/octet-stream" | "binary/octet-stream"
    ) {
        return None;
    }
    match extension(name).as_str() {
        "png" => Some("image/png".to_owned()),
        "jpg" | "jpeg" => Some("image/jpeg".to_owned()),
        "webp" => Some("image/webp".to_owned()),
        "gif" => Some("image/gif".to_owned()),
        _ => None,
    }
}

fn extension_for(name: &str, mime: &str) -> String {
    let own = extension(name);
    if safe_extension(&own) {
        return own;
    }
    let known = match mime.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "application/pdf" => Some("pdf"),
        "application/json" => Some("json"),
        "text/csv" => Some("csv"),
        "text/markdown" => Some("md"),
        "text/plain" => Some("txt"),
        _ => None,
    };
    if let Some(known) = known {
        return known.to_owned();
    }
    let subtype = mime
        .split('/')
        .nth(1)
        .unwrap_or_default()
        .split('+')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if safe_extension(&subtype) {
        subtype
    } else {
        "bin".to_owned()
    }
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|part| part.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn safe_extension(value: &str) -> bool {
    (1..=8).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn is_inline_mime(mime: &str) -> bool {
    matches!(
        mime.to_ascii_lowercase().as_str(),
        "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/svg+xml"
            | "application/pdf"
            | "text/plain"
    )
}

async fn private_directory(path: &Path) -> Result<(), RpcError> {
    fs::create_dir_all(path).await.map_err(storage_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(storage_error)?;
    }
    Ok(())
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

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid-attachments", message)
}

fn storage_error(error: std::io::Error) -> RpcError {
    RpcError::new("chat-storage", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upload(bytes: &[u8]) -> AttachmentUpload {
        AttachmentUpload {
            name: "shot.png".to_owned(),
            mime: "image/png".to_owned(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    #[test]
    fn matches_attachment_validation_and_image_normalization() {
        for invalid in ["", "???=", "Y Q==", "YQ=", "Y===", "YQ==AAAA"] {
            assert!(
                validate_uploads(vec![AttachmentUpload {
                    name: "bad.png".to_owned(),
                    mime: "image/png".to_owned(),
                    data: invalid.to_owned(),
                }])
                .is_err()
            );
        }
        assert_eq!(
            attachment_image_mime("shot.JPG", "application/octet-stream").as_deref(),
            Some("image/jpeg")
        );
        assert_eq!(attachment_image_mime("photo.png", "application/pdf"), None);
        assert_eq!(attachment_image_mime("drawing.svg", "image/svg+xml"), None);
    }

    #[tokio::test]
    async fn saves_private_files_migrates_inline_and_jails_resolution() {
        let temporary = tempfile::tempdir().unwrap();
        let store = AttachmentStore::new(temporary.path());
        let saved = store
            .save_all("../escape", vec![upload(b"png")])
            .await
            .unwrap();
        let attachment = &saved[0];
        assert_eq!(attachment["size"], 3);
        assert!(attachment["path"].as_str().unwrap().contains("..%2Fescape"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(attachment["path"].as_str().unwrap())
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        let resolved = store
            .resolve("../escape", attachment)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(resolved.asset.len, 3);
        assert!(resolved.inline);

        let outside = temporary.path().join("outside.png");
        fs::write(&outside, b"no").await.unwrap();
        let forged = json!({ "id": "outside", "path": outside, "mime": "image/png" });
        assert!(store.resolve("../escape", &forged).await.unwrap().is_none());

        let mut items = vec![json!({
            "attachments": [{
                "name": "legacy.png",
                "mediaType": "image/png",
                "data": base64::engine::general_purpose::STANDARD.encode(b"old"),
            }]
        })];
        assert!(store.migrate_items("legacy", &mut items).await.unwrap());
        assert!(items[0]["attachments"][0].get("data").is_none());
    }

    #[test]
    fn extension_selection_matches_typescript_rules() {
        let cases = [
            ("photo.WEBP", "application/octet-stream", "webp"),
            ("no-extension", "application/pdf", "pdf"),
            ("bad.toolongext", "application/vnd.example+json", "bin"),
            ("bad.$$$", "application/x-thing", "bin"),
        ];
        for (name, mime, expected) in cases {
            assert_eq!(extension_for(name, mime), expected);
        }
    }
}
