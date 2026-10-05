use php_syntax::PhpVersion;
use serde_json::Value;

/// The section a client answers `workspace/configuration` for, and pushes in `didChangeConfiguration`.
pub const SECTION: &str = "phpLanguageServer";

/// The settings the server reads. Both `{ "phpVersion": "8.4" }` and the same object under
/// [`SECTION`] are understood, so a client may pass the settings as it likes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Settings {
    pub php_version: Option<PhpVersion>,
}

impl Settings {
    pub fn from_value(value: &Value) -> Settings {
        let object = value.get(SECTION).unwrap_or(value);
        let php_version = object
            .get("phpVersion")
            .and_then(Value::as_str)
            .and_then(PhpVersion::parse);
        Settings { php_version }
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
}
