//! `workspace/symbol`: declarations by name across the project, its packages and the standard library.

use std::path::PathBuf;

use php_index::{ClassKind, Index, Origin, Span};

use crate::SymbolKind;
use crate::completion::match_score;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceSymbol {
    pub name: String,
    pub kind: SymbolKind,
    /// The namespace or class the symbol is in.
    pub container: Option<String>,
    pub path: PathBuf,
    pub span: Span,
    pub deprecated: bool,
}

fn origin_rank(origin: Origin) -> u8 {
    match origin {
        Origin::Project => 0,
        Origin::Vendor => 1,
        Origin::Stub => 2,
    }
}

/// The declarations that match a query, best first. Members are only listed for the project's own classes.
pub fn workspace_symbols(index: &Index, query: &str, limit: usize) -> Vec<WorkspaceSymbol> {
    let mut found: Vec<((u8, u8, usize), WorkspaceSymbol)> = Vec::new();
    let mut consider = |name: &str, rank: u8, symbol: WorkspaceSymbol| {
        if let Some(score) = match_score(name, query) {
            found.push(((score.max(1), rank, name.len()), symbol));
        }
    };
    for class in index.classes() {
        let short = crate::short(&class.decl.name);
        let rank = origin_rank(class.file.origin);
        let kind = match class.decl.kind {
            ClassKind::Class => SymbolKind::Class,
            ClassKind::Interface => SymbolKind::Interface,
            ClassKind::Trait => SymbolKind::Trait,
            ClassKind::Enum => SymbolKind::Enum,
        };
        let container = php_index::types::namespace_of(&class.decl.name);
        consider(
            short,
            rank,
            WorkspaceSymbol {
                name: short.to_string(),
                kind,
                container: (!container.is_empty()).then(|| container.to_string()),
                path: class.file.path.clone(),
                span: class.decl.name_span,
                deprecated: class.decl.doc.as_ref().is_some_and(|doc| doc.deprecated.is_some()),
            },
        );
        if class.file.origin != Origin::Project || query.is_empty() {
            continue;
        }
        for method in &class.decl.methods {
            consider(
                &method.name,
                rank + 3,
                WorkspaceSymbol {
                    name: method.name.clone(),
                    kind: SymbolKind::Method,
                    container: Some(class.decl.name.clone()),
                    path: class.file.path.clone(),
                    span: method.name_span,
                    deprecated: method.doc.as_ref().is_some_and(|doc| doc.deprecated.is_some()),
                },
            );
        }
        for property in &class.decl.properties {
            consider(
                &property.name,
                rank + 3,
                WorkspaceSymbol {
                    name: format!("${}", property.name),
                    kind: SymbolKind::Property,
                    container: Some(class.decl.name.clone()),
                    path: class.file.path.clone(),
                    span: property.name_span,
                    deprecated: false,
                },
            );
        }
        for constant in &class.decl.constants {
            consider(
                &constant.name,
                rank + 3,
                WorkspaceSymbol {
                    name: constant.name.clone(),
                    kind: if constant.is_case {
                        SymbolKind::EnumMember
                    } else {
                        SymbolKind::Constant
                    },
                    container: Some(class.decl.name.clone()),
                    path: class.file.path.clone(),
                    span: constant.name_span,
                    deprecated: false,
                },
            );
        }
    }
    for function in index.functions() {
        let short = crate::short(&function.decl.name);
        let container = php_index::types::namespace_of(&function.decl.name);
        consider(
            short,
            origin_rank(function.file.origin) + 1,
            WorkspaceSymbol {
                name: short.to_string(),
                kind: SymbolKind::Function,
                container: (!container.is_empty()).then(|| container.to_string()),
                path: function.file.path.clone(),
                span: function.decl.name_span,
                deprecated: function.decl.doc.as_ref().is_some_and(|doc| doc.deprecated.is_some()),
            },
        );
    }
    for constant in index.constants() {
        let short = crate::short(&constant.decl.name);
        let container = php_index::types::namespace_of(&constant.decl.name);
        consider(
            short,
            origin_rank(constant.file.origin) + 1,
            WorkspaceSymbol {
                name: short.to_string(),
                kind: SymbolKind::Constant,
                container: (!container.is_empty()).then(|| container.to_string()),
                path: constant.file.path.clone(),
                span: constant.decl.name_span,
                deprecated: false,
            },
        );
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.name.cmp(&b.1.name)));
    found.truncate(limit);
    found.into_iter().map(|(_, symbol)| symbol).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Fixture;

    #[test]
    fn ranks_prefix_matches_first_and_prefers_the_project() {
        let fixture = Fixture::with_level(
            php_syntax::PhpVersion::V8_4,
            &[(
                "a.php",
                "<?php\nnamespace App;\nclass UserController { public function index() {} }\nclass User {}\nfunction user_helper() {}\n",
            )],
            &[("s.php", "<?php\nclass UserStub {}\n")],
        );
        let symbols = workspace_symbols(&fixture.index, "user", 10);
        let names: Vec<&str> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
        assert_eq!(names, vec!["User", "UserController", "user_helper", "UserStub"]);
        assert_eq!(symbols[0].container.as_deref(), Some("App"));
        let members = workspace_symbols(&fixture.index, "index", 10);
        assert_eq!(members[0].kind, SymbolKind::Method);
        assert_eq!(members[0].container.as_deref(), Some("App\\UserController"));
        assert_eq!(workspace_symbols(&fixture.index, "uc", 10)[0].name, "UserController");
        assert_eq!(workspace_symbols(&fixture.index, "user", 2).len(), 2);
    }
}
