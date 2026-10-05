use std::path::PathBuf;

use php_syntax::PhpVersion;
use serde_json::Value;

/// The section a client answers `workspace/configuration` for, and pushes in `didChangeConfiguration`.
pub const SECTION: &str = "phpLanguageServer";

/// The settings the server reads. Both `{ "phpVersion": "8.4" }` and the same object under
/// [`SECTION`] are understood, so a client may pass the settings as it likes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Settings {
    /// The language level for a project whose `composer.json` does not say.
    pub php_version: Option<PhpVersion>,
    /// A folder the server may keep its cache and the standard library stubs in. Without one it keeps
    /// nothing between runs and does not fetch the stubs.
    pub storage_path: Option<PathBuf>,
    /// A folder of phpstorm-stubs to read instead of fetching them into the storage path.
    pub stubs_path: Option<PathBuf>,
}

impl Settings {
    pub fn from_value(value: &Value) -> Settings {
        let object = value.get(SECTION).unwrap_or(value);
        let text = |key: &str| object.get(key).and_then(Value::as_str);
        Settings {
            php_version: text("phpVersion").and_then(PhpVersion::parse),
            storage_path: text("storagePath").map(PathBuf::from),
            stubs_path: text("stubsPath").map(PathBuf::from),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_version_from_either_shape() {
        let direct = Settings::from_value(&json!({ "phpVersion": "8.3" }));
        assert_eq!(direct.php_version, Some(PhpVersion::V8_3));
        let nested = Settings::from_value(&json!({ "phpLanguageServer": { "phpVersion": "^8.1" } }));
        assert_eq!(nested.php_version, Some(PhpVersion::V8_1));
        assert_eq!(Settings::from_value(&json!(null)).php_version, None);
        assert_eq!(
            Settings::from_value(&json!({ "phpVersion": "nonsense" })).php_version,
            None
        );
    }

    #[test]
    fn reads_the_storage_and_stub_folders() {
        let settings = Settings::from_value(&json!({ "storagePath": "/cache", "stubsPath": "/stubs" }));
        assert_eq!(settings.storage_path, Some(PathBuf::from("/cache")));
        assert_eq!(settings.stubs_path, Some(PathBuf::from("/stubs")));
    }
}
