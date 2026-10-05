//! The service container: which class a name the framework registers itself stands for.

use std::collections::HashMap;
use std::path::Path;

use php_syntax::SyntaxKind::*;

use super::Section;
use super::source::{Literal, array_items, literal_of, tree_of};
use crate::index::Index;
use crate::types::{Name, Type};

pub const APPLICATION: &str = "Illuminate\\Foundation\\Application";

/// The aliases the application registers for the framework's own services (`cache`, `db`, `config`),
/// read from the array `registerCoreContainerAliases()` loops over.
#[derive(Default)]
pub struct CoreAliases {
    classes: HashMap<String, Name>,
}

impl CoreAliases {
    pub fn class_of(&self, alias: &str) -> Option<Name> {
        self.classes.get(alias).cloned()
    }
}

impl Section for CoreAliases {
    fn build(index: &Index) -> Self {
        let mut aliases = CoreAliases::default();
        let Some(application) = index.class(APPLICATION) else {
            return aliases;
        };
        let Some(method) = application.decl.method("registerCoreContainerAliases") else {
            return aliases;
        };
        let Some(tree) = tree_of(index, &application.file.path) else {
            return aliases;
        };
        let Some(declaration) = super::source::method_at(&tree, method.name_span.start) else {
            return aliases;
        };
        let Some(list) = declaration.descendants().find(|node| node.kind() == ARRAY_EXPR) else {
            return aliases;
        };
        for (key, value) in array_items(&list).unwrap_or_default() {
            let Some(Literal::Text(alias, _)) = key.as_ref().and_then(literal_of) else {
                continue;
            };
            let Some(first) = array_items(&value).and_then(|items| items.into_iter().next()) else {
                continue;
            };
            let class = match literal_of(&first.1) {
                Some(Literal::Class(name)) => Some(name),
                _ => self_class(&first.1, application.decl.name.as_str()),
            };
            if let Some(class) = class {
                aliases.classes.insert(alias, class);
            }
        }
        aliases
    }

    fn depends_on(_: &Path, _: &Path) -> bool {
        false
    }
}

/// `self::class` inside the application stands for the application.
fn self_class(node: &php_syntax::SyntaxNode, application: &str) -> Option<Name> {
    let text = node.text().to_string();
    (text.replace(' ', "") == "self::class").then(|| application.to_string())
}

/// The type a container name resolves to when it is one of the framework's own.
pub fn alias_type(index: &Index, alias: &str) -> Option<Type> {
    index.section::<CoreAliases>().class_of(alias).map(Type::class)
}
