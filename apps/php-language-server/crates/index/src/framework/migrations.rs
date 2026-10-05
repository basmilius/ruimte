//! The columns of the tables, read from the migrations: `Schema::create('users', fn (Blueprint $table)
//! => ...)` and the `Schema::table` calls after it, in the order of the file names.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use php_syntax::SyntaxKind::*;
use php_syntax::{SyntaxNode, parse};

use super::Section;
use super::overlay::{ColumnType, SchemaRule, schema_rules};
use super::source::{Link, static_call_parts, variable_chain};
use crate::index::Index;
use crate::model::Span;
use crate::test_facts::{argument_expressions, string_value};

#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    pub name: String,
    pub ty: ColumnType,
    pub nullable: bool,
    pub path: PathBuf,
    /// The name inside its quotes, in the migration that added the column.
    pub span: Span,
}

#[derive(Clone, Debug, Default)]
pub struct Table {
    pub columns: Vec<Column>,
}

impl Table {
    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|column| column.name == name)
    }
}

#[derive(Default)]
pub struct Tables {
    tables: HashMap<String, Table>,
}

impl Tables {
    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.get(name)
    }

    pub fn names(&self) -> impl Iterator<Item = &String> {
        self.tables.keys()
    }
}

impl Section for Tables {
    fn build(index: &Index) -> Self {
        let root = index.framework_root();
        let files: Vec<PathBuf> = index
            .files_below(&root.join("database").join("migrations"))
            .into_iter()
            .filter(|path| path.extension().is_some_and(|ext| ext == "php"))
            .collect();
        let mut tables = Tables::default();
        for path in files {
            if let Some(text) = index.read_text(&path) {
                tables.read(&path, &text);
            }
        }
        tables
    }

    fn depends_on(root: &Path, path: &Path) -> bool {
        super::is_below(root, path, "database/migrations")
    }
}

impl Tables {
    fn read(&mut self, path: &Path, text: &str) {
        let tree = parse(text).syntax();
        for node in tree.descendants() {
            let Some((class, method, call)) = static_call_parts(&node) else {
                continue;
            };
            if class.trim_start_matches('\\').rsplit('\\').next() != Some("Schema") || in_down(&call) {
                continue;
            }
            let args = argument_expressions(&call);
            let Some((table, _)) = args.first().and_then(string_value) else {
                continue;
            };
            match method.to_ascii_lowercase().as_str() {
                "create" => {
                    self.tables.insert(table.clone(), Table::default());
                    self.read_blueprint(&table, path, &args);
                }
                "table" => self.read_blueprint(&table, path, &args),
                "drop" | "dropifexists" => {
                    self.tables.remove(&table);
                }
                "rename" => {
                    if let (Some(from), Some((to, _))) =
                        (self.tables.remove(&table), args.get(1).and_then(string_value))
                    {
                        self.tables.insert(to, from);
                    }
                }
                _ => {}
            }
        }
    }

    fn read_blueprint(&mut self, table: &str, path: &Path, args: &[SyntaxNode]) {
        let Some(closure) = args
            .get(1)
            .filter(|arg| matches!(arg.kind(), CLOSURE_EXPR | ARROW_FUNCTION_EXPR))
        else {
            return;
        };
        let Some(variable) = closure
            .descendants()
            .find(|node| node.kind() == PARAMETER)
            .and_then(|parameter| {
                parameter
                    .children_with_tokens()
                    .filter_map(|element| element.into_token())
                    .find(|token| token.kind() == VARIABLE)
            })
            .map(|token| token.text().trim_start_matches('$').to_string())
        else {
            return;
        };
        let rules = schema_rules();
        for statement in closure.descendants() {
            if !matches!(statement.kind(), EXPR_STATEMENT | RETURN_STATEMENT) && statement.kind() != ARROW_FUNCTION_EXPR
            {
                continue;
            }
            let expression = match statement.kind() {
                ARROW_FUNCTION_EXPR => statement.children().last(),
                _ => statement.children().next(),
            };
            let Some((base, links)) = expression.as_ref().and_then(variable_chain) else {
                continue;
            };
            if base != variable {
                continue;
            }
            let Some(first) = links.first() else {
                continue;
            };
            let Some(rule) = rules.get(&first.name.to_ascii_lowercase()) else {
                continue;
            };
            let nullable_chain = links
                .iter()
                .skip(1)
                .any(|link| link.name == "nullable" && !link.args.first().is_some_and(|arg| arg.text() == "false"));
            let changes = links.iter().any(|link| link.name == "change");
            self.apply(table, path, first, rule, nullable_chain, changes);
        }
    }

    fn apply(&mut self, table: &str, path: &Path, link: &Link, rule: &SchemaRule, chain_nullable: bool, change: bool) {
        let first_text = link.args.first().and_then(string_value);
        let default_name = |default: &Option<String>| {
            first_text
                .clone()
                .or_else(|| default.clone().map(|name| (name, Span::default())))
        };
        let set = |tables: &mut Tables, name: String, span: Span, ty: ColumnType, nullable: bool| {
            let table = tables.tables.entry(table.to_string()).or_default();
            let column = Column {
                name,
                ty,
                nullable,
                path: path.to_path_buf(),
                span,
            };
            match table.columns.iter_mut().find(|existing| existing.name == column.name) {
                Some(existing) => {
                    if change {
                        existing.ty = column.ty;
                        existing.nullable = column.nullable;
                    } else {
                        *existing = column;
                    }
                }
                None => table.columns.push(column),
            }
        };
        match rule {
            SchemaRule::Column {
                ty,
                nullable,
                default_name: default,
            } => {
                if let Some((name, span)) = default_name(default) {
                    set(self, name, span, *ty, *nullable || chain_nullable);
                }
            }
            SchemaRule::Columns(columns) => {
                for (name, ty, nullable) in columns {
                    set(self, name.clone(), Span::default(), *ty, *nullable || chain_nullable);
                }
            }
            SchemaRule::Morphs { id, nullable } => {
                if let Some((name, span)) = first_text {
                    let nullable = *nullable || chain_nullable;
                    set(self, format!("{name}_type"), span, ColumnType::String, nullable);
                    set(self, format!("{name}_id"), span, *id, nullable);
                }
            }
            SchemaRule::ForeignFor => {
                let named = link.args.get(1).and_then(string_value);
                let model = link.args.first().map(|arg| arg.text().to_string());
                let name = named.map(|(name, _)| name).or_else(|| {
                    let class = model?.strip_suffix("::class")?.rsplit('\\').next()?.trim().to_string();
                    Some(format!("{}_id", super::inflect::snake(&class)))
                });
                if let Some(name) = name {
                    set(self, name, Span::default(), ColumnType::Int, chain_nullable);
                }
            }
            SchemaRule::Drop { default_name: default } => {
                let mut names: Vec<String> = Vec::new();
                for arg in &link.args {
                    if let Some((name, _)) = string_value(arg) {
                        names.push(name);
                    } else if arg.kind() == ARRAY_EXPR {
                        names.extend(argument_array_strings(arg));
                    }
                }
                if link.args.is_empty() {
                    names.extend(default.clone());
                }
                self.remove(table, &names);
            }
            SchemaRule::Drops(names) => self.remove(table, names),
            SchemaRule::Rename => {
                let from = first_text.map(|(name, _)| name);
                let to = link.args.get(1).and_then(string_value);
                if let (Some(from), Some((to, span))) = (from, to) {
                    if let Some(column) = self
                        .tables
                        .get_mut(table)
                        .and_then(|table| table.columns.iter_mut().find(|column| column.name == from))
                    {
                        column.name = to;
                        column.span = span;
                        column.path = path.to_path_buf();
                    }
                }
            }
        }
    }

    fn remove(&mut self, table: &str, names: &[String]) {
        if let Some(table) = self.tables.get_mut(table) {
            table.columns.retain(|column| !names.contains(&column.name));
        }
    }
}

fn argument_array_strings(array: &SyntaxNode) -> Vec<String> {
    array
        .children()
        .filter(|item| item.kind() == ARRAY_ITEM)
        .filter_map(|item| item.children().last())
        .filter_map(|value| string_value(&value))
        .map(|(name, _)| name)
        .collect()
}

/// Whether a call sits in the `down()` method of a migration, which undoes what `up()` did.
fn in_down(node: &SyntaxNode) -> bool {
    node.ancestors().any(|ancestor| {
        ancestor.kind() == METHOD_DECLARATION
            && ancestor
                .children()
                .find(|child| child.kind() == NAME)
                .is_some_and(|name| name.text().to_string().eq_ignore_ascii_case("down"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::testing::project;

    const USERS: &str = r#"<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->foreignId('team_id')->constrained();
            $table->morphs('owner');
            $table->softDeletes();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
"#;

    const ALTER: &str = r#"<?php
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('nickname', 40)->nullable()->after('name');
            $table->renameColumn('name', 'full_name');
            $table->dropColumn(['team_id']);
            $table->json('settings');
            $table->string('email', 200)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('settings');
        });
    }
};
"#;

    fn tables(files: &[(&str, &str)]) -> std::sync::Arc<Tables> {
        project(files).section::<Tables>()
    }

    #[test]
    fn reads_the_columns_a_migration_creates() {
        let tables = tables(&[("database/migrations/2020_01_01_000000_create_users.php", USERS)]);
        let users = tables.table("users").expect("a table");
        let names: Vec<&str> = users.columns.iter().map(|column| column.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "id",
                "name",
                "email",
                "email_verified_at",
                "team_id",
                "owner_type",
                "owner_id",
                "deleted_at",
                "created_at",
                "updated_at"
            ]
        );
        assert_eq!(users.column("id").map(|column| column.ty), Some(ColumnType::Int));
        assert!(users.column("email_verified_at").is_some_and(|column| column.nullable));
        assert!(!users.column("name").is_some_and(|column| column.nullable));
        assert!(users.column("deleted_at").is_some_and(|column| column.nullable));
    }

    #[test]
    fn follows_the_alterations_in_order_and_ignores_down() {
        let tables = tables(&[
            ("database/migrations/2020_01_01_000000_create_users.php", USERS),
            ("database/migrations/2021_01_01_000000_alter_users.php", ALTER),
        ]);
        let users = tables.table("users").expect("a table");
        assert!(users.column("name").is_none());
        assert!(users.column("full_name").is_some());
        assert!(users.column("team_id").is_none());
        assert!(users.column("nickname").is_some_and(|column| column.nullable));
        assert_eq!(
            users.column("settings").map(|column| column.ty),
            Some(ColumnType::Array)
        );
        assert!(users.column("email").is_some_and(|column| column.nullable));
    }

    #[test]
    fn a_dropped_table_is_gone() {
        let tables = tables(&[(
            "database/migrations/1.php",
            "<?php Schema::create('a', function (Blueprint $t) { $t->id(); }); Schema::create('b', fn (Blueprint $t) => $t->id()); Schema::drop('a');",
        )]);
        assert!(tables.table("a").is_none());
        assert!(tables.table("b").is_some());
    }
}
