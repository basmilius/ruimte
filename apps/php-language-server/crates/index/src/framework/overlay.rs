//! The overlays: PHP files that say what the frameworks do at run time, read as data. The tags on
//! a declaration are the data, and the declarations themselves are never run.

use std::collections::HashMap;
use std::sync::OnceLock;

use php_syntax::parse;

use crate::extract::{ExtractOptions, extract};
use crate::model::{ClassDecl, FileSymbols, Method};

fn laravel() -> &'static FileSymbols {
    static PARSED: OnceLock<FileSymbols> = OnceLock::new();
    PARSED.get_or_init(|| {
        extract(
            &parse(include_str!("laravel_overlay.php")).syntax(),
            ExtractOptions::default(),
        )
    })
}

/// The tag of a method, with its text.
fn tag<'a>(method: &'a Method, name: &str) -> Option<&'a str> {
    method
        .doc
        .as_ref()?
        .tags
        .iter()
        .find(|tag| tag.name == name)
        .map(|tag| tag.text.trim())
}

/// A type of a column, as far as PHP tells them apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnType {
    Int,
    String,
    Bool,
    Float,
    Array,
    Datetime,
    Mixed,
}

impl ColumnType {
    fn parse(word: &str) -> Option<ColumnType> {
        Some(match word {
            "int" => ColumnType::Int,
            "string" => ColumnType::String,
            "bool" => ColumnType::Bool,
            "float" => ColumnType::Float,
            "array" => ColumnType::Array,
            "datetime" => ColumnType::Datetime,
            "mixed" => ColumnType::Mixed,
            _ => return None,
        })
    }
}

/// A type word with an optional `?` in front.
fn typed(word: &str) -> Option<(ColumnType, bool)> {
    let (nullable, word) = match word.strip_prefix('?') {
        Some(rest) => (true, rest),
        None => (false, word),
    };
    Some((ColumnType::parse(word)?, nullable))
}

/// What a method of the schema builder does to the columns of a table.
#[derive(Clone, Debug, PartialEq)]
pub enum SchemaRule {
    /// The column named by the first argument, or by this default when there is none.
    Column {
        ty: ColumnType,
        nullable: bool,
        default_name: Option<String>,
    },
    Columns(Vec<(String, ColumnType, bool)>),
    Morphs {
        id: ColumnType,
        nullable: bool,
    },
    ForeignFor,
    Drop {
        default_name: Option<String>,
    },
    Drops(Vec<String>),
    Rename,
}

fn default_of(method: &Method) -> Option<String> {
    let default = method.callable.params.first()?.default.as_ref()?;
    Some(default.trim_matches(['\'', '"']).to_string())
}

fn schema_rule(method: &Method) -> Option<SchemaRule> {
    if let Some(text) = tag(method, "column") {
        let (ty, nullable) = typed(text.split_whitespace().next()?)?;
        return Some(SchemaRule::Column {
            ty,
            nullable,
            default_name: default_of(method),
        });
    }
    if let Some(text) = tag(method, "columns") {
        let columns = text
            .split_whitespace()
            .filter_map(|entry| {
                let (name, word) = entry.split_once(':')?;
                let (ty, nullable) = typed(word)?;
                Some((name.to_string(), ty, nullable))
            })
            .collect();
        return Some(SchemaRule::Columns(columns));
    }
    if let Some(text) = tag(method, "morphs") {
        let (id, nullable) = typed(text.split_whitespace().next()?)?;
        return Some(SchemaRule::Morphs { id, nullable });
    }
    if tag(method, "foreign-for").is_some() {
        return Some(SchemaRule::ForeignFor);
    }
    if tag(method, "drop").is_some() {
        return Some(SchemaRule::Drop {
            default_name: default_of(method),
        });
    }
    if let Some(text) = tag(method, "drops") {
        return Some(SchemaRule::Drops(text.split_whitespace().map(str::to_string).collect()));
    }
    tag(method, "rename").map(|_| SchemaRule::Rename)
}

/// The rules of the schema builder, by the lowercase name of the method.
pub fn schema_rules() -> &'static HashMap<String, SchemaRule> {
    static RULES: OnceLock<HashMap<String, SchemaRule>> = OnceLock::new();
    RULES.get_or_init(|| {
        let mut rules = HashMap::new();
        for class in laravel().classes.iter().filter(|class| is_blueprint(class)) {
            for method in &class.methods {
                if let Some(rule) = schema_rule(method) {
                    rules.insert(method.name.to_ascii_lowercase(), rule);
                }
            }
        }
        rules
    })
}

fn is_blueprint(class: &ClassDecl) -> bool {
    class.name == "Illuminate\\Database\\Schema\\Blueprint"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_schema_builder_rules() {
        let rules = schema_rules();
        assert_eq!(
            rules.get("string"),
            Some(&SchemaRule::Column {
                ty: ColumnType::String,
                nullable: false,
                default_name: None
            })
        );
        assert_eq!(
            rules.get("id"),
            Some(&SchemaRule::Column {
                ty: ColumnType::Int,
                nullable: false,
                default_name: Some("id".to_string())
            })
        );
        assert_eq!(
            rules.get("softdeletes"),
            Some(&SchemaRule::Column {
                ty: ColumnType::Datetime,
                nullable: true,
                default_name: Some("deleted_at".to_string())
            })
        );
        assert!(matches!(rules.get("timestamps"), Some(SchemaRule::Columns(columns)) if columns.len() == 2));
        assert_eq!(
            rules.get("morphs"),
            Some(&SchemaRule::Morphs {
                id: ColumnType::Int,
                nullable: false
            })
        );
        assert_eq!(rules.get("renamecolumn"), Some(&SchemaRule::Rename));
        assert!(rules.len() > 70, "{}", rules.len());
    }
}
