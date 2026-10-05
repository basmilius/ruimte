//! The type layer over a project of the frameworks.

use php_index::framework::testing::ELOQUENT;

use crate::infer::Analyzer;
use crate::testing::{Fixture, split_cursor};

const USER: &str = r#"<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
class User extends Model {
    public function posts(): HasMany { return $this->hasMany(Post::class); }
    public function scopeActive($query) {}
}
"#;

fn project() -> Fixture {
    let mut files = ELOQUENT.to_vec();
    files.extend_from_slice(&[
        ("app/Models/User.php", USER),
        (
            "app/Models/Post.php",
            "<?php namespace App\\Models; use Illuminate\\Database\\Eloquent\\Model; class Post extends Model { public function title(): string {} }",
        ),
        (
            "database/migrations/1_create_users.php",
            "<?php Schema::create('users', function (Blueprint $table) { $table->id(); $table->string('name'); });",
        ),
    ]);
    Fixture::framework(&files)
}

/// The type of a variable at the cursor.
fn var(code: &str, name: &str) -> String {
    let fixture = project().with_current(code);
    let (_, root, offset) = split_cursor(code);
    let analyzer = Analyzer::new(&fixture.index, &root, offset);
    analyzer
        .env_at(offset)
        .get(name)
        .map_or_else(|| "<unset>".to_string(), |ty| ty.display(true))
}

#[test]
fn a_query_chain_gives_the_model() {
    let code = "<?php use App\\Models\\User;\n$user = User::query()->where('name', 'a')->first();\n$0";
    assert_eq!(var(code, "user"), "?User");
}

#[test]
fn a_static_call_a_model_forwards_gives_the_builder() {
    let code = "<?php use App\\Models\\User;\n$query = User::where('name', 'a');\n$all = User::active()->get();\n$0";
    assert_eq!(var(code, "query"), "Builder<User>");
    assert_eq!(var(code, "all"), "Collection<int, User>");
}

#[test]
fn a_relation_property_gives_a_collection_of_the_related_model() {
    let code = "<?php use App\\Models\\User;\nfunction f(User $user) { $posts = $user->posts; $first = $user->posts->first(); $name = $user->name; $0 }";
    assert_eq!(var(code, "posts"), "Collection<int, Post>");
    assert_eq!(var(code, "first"), "?Post");
    assert_eq!(var(code, "name"), "string");
}

#[test]
fn a_collection_of_models_types_its_closures() {
    let code = "<?php use App\\Models\\User;\nUser::query()->get()->each(function ($user) { $0 });";
    assert_eq!(var(code, "user"), "User");
}
