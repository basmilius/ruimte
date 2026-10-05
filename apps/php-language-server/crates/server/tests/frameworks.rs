//! Laravel and Symfony through the protocol: members that frameworks make up, and the strings that
//! name config keys, routes, views, services and translations.

mod common;

use common::*;
use lsp_server::{Message, Response};
use php_index::framework::testing::{CONTAINER, ELOQUENT, HELPERS};
use serde_json::{Value, json};

/// A project that requires Laravel, with enough of the framework installed to type models.
fn laravel() -> Disk {
    let disk = Disk::new();
    disk.write(
        "project/composer.json",
        r#"{
  "require": { "php": "^8.3", "laravel/framework": "^13.0" },
  "autoload": { "psr-4": { "App\\": "app/", "Database\\Factories\\": "database/factories/" } }
}"#,
    );
    disk.write(
        "project/vendor/composer/installed.json",
        r#"{"packages":[{"name":"laravel/framework","install-path":"../laravel","autoload":{"classmap":["."]}}]}"#,
    );
    for (path, text) in ELOQUENT.iter().chain(CONTAINER).chain(HELPERS) {
        disk.write(&format!("project/{path}"), text);
    }
    disk.write(
        "project/database/migrations/2020_01_01_000000_create_users_table.php",
        "<?php\nreturn new class {\n    public function up() {\n        Schema::create('users', function (Blueprint $table) {\n            $table->id();\n            $table->string('name');\n            $table->string('email');\n            $table->timestamps();\n        });\n    }\n};\n",
    );
    disk.write(
        "project/app/Models/User.php",
        "<?php\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Model;\nuse Illuminate\\Database\\Eloquent\\Relations\\HasMany;\n\nclass User extends Model\n{\n    public function posts(): HasMany\n    {\n        return $this->hasMany(Post::class);\n    }\n\n    public function scopeActive($query) {}\n}\n",
    );
    disk.write(
        "project/app/Models/Post.php",
        "<?php\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Model;\n\nclass Post extends Model\n{\n    public function title(): string {}\n}\n",
    );
    disk.write(
        "project/config/app.php",
        "<?php\n\nreturn [\n    'name' => env('APP_NAME', 'Laravel'),\n    'locale' => 'en',\n];\n",
    );
    disk.write(
        "project/routes/web.php",
        "<?php\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/', fn () => view('welcome'))->name('home');\n",
    );
    disk.write("project/resources/views/welcome.blade.php", "<h1>Welcome</h1>\n");
    disk.write("project/resources/views/layouts/app.blade.php", "@yield('content')\n");
    disk.write(
        "project/lang/en/messages.php",
        "<?php\nreturn ['welcome' => 'Welcome'];\n",
    );
    disk.write("project/.env", "APP_NAME=Laravel\nAPP_DEBUG=true\n");
    disk
}

fn labels(response: &Value) -> Vec<String> {
    let items = response["items"]
        .as_array()
        .or_else(|| response.as_array())
        .cloned()
        .unwrap_or_default();
    items
        .iter()
        .filter_map(|item| item["label"].as_str().map(str::to_string))
        .collect()
}

fn complete_at(client: &mut Client, uri: &str, line: u32, character: u32) -> Vec<String> {
    labels(&client.at("textDocument/completion", uri, line, character))
}

#[test]
fn a_model_has_the_attributes_its_migrations_and_relations_give_it() {
    let disk = laravel();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/app/Http/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f(User $user) {\n    $user->posts->first()->title();\n    $found = User::query()->where('name', 'a')->first();\n    $found->email;\n}\n",
    );
    let hover = client.at("textDocument/hover", &uri, 5, 12);
    let text = hover["contents"]["value"].as_str().expect("markdown");
    assert!(text.contains("string"), "{text}");
    let title = client.at("textDocument/hover", &uri, 3, 30);
    assert!(
        title["contents"]["value"]
            .as_str()
            .is_some_and(|text| text.contains("Post::title")),
        "{title}"
    );
    let typing = disk.uri("project/app/Http/Typing.php");
    client.open(
        &typing,
        "<?php\nuse App\\Models\\User;\nfunction g(User $user) {\n    $user->\n}\n",
    );
    let items = complete_at(&mut client, &typing, 3, 11);
    for expected in ["id", "name", "email", "created_at", "posts", "save"] {
        assert!(items.contains(&expected.to_string()), "{expected} in {items:?}");
    }
    client.shutdown();
}

#[test]
fn a_scope_and_a_dynamic_where_complete_on_the_model_and_the_builder() {
    let disk = laravel();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/app/Http/Page.php");
    client.open(
        &uri,
        "<?php\nuse App\\Models\\User;\nfunction f() {\n    User::wh;\n    User::query()->wh;\n    User::ac;\n}\n",
    );
    let statics = complete_at(&mut client, &uri, 3, 11);
    assert!(
        statics.contains(&"where".to_string()) && statics.contains(&"whereEmail".to_string()),
        "{statics:?}"
    );
    let builder = complete_at(&mut client, &uri, 4, 21);
    assert!(builder.contains(&"whereName".to_string()), "{builder:?}");
    let scopes = complete_at(&mut client, &uri, 5, 11);
    assert!(scopes.contains(&"active".to_string()), "{scopes:?}");
    client.shutdown();
}

#[test]
fn strings_that_name_things_complete_navigate_and_are_checked() {
    let disk = laravel();
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/app/Http/Page.php");
    let code = "<?php\nconfig('app.name');\nconfig('app.nam');\nroute('home');\nview('welcome');\n__('messages.welcome');\nenv('APP_DEBUG');\nconfig('app.');\n";
    client.open(&uri, code);

    let found = complete_at(&mut client, &uri, 7, 12);
    assert_eq!(found, ["app.locale", "app.name"]);

    let definition = client.at("textDocument/definition", &uri, 1, 12);
    assert_eq!(definition[0]["uri"], disk.uri("project/config/app.php"));
    assert_eq!(definition[0]["range"]["start"], json!({ "line": 3, "character": 5 }));
    let route = client.at("textDocument/definition", &uri, 3, 9);
    assert_eq!(route[0]["uri"], disk.uri("project/routes/web.php"));
    let view = client.at("textDocument/definition", &uri, 4, 9);
    assert_eq!(view[0]["uri"], disk.uri("project/resources/views/welcome.blade.php"));
    let translation = client.at("textDocument/definition", &uri, 5, 12);
    assert_eq!(translation[0]["uri"], disk.uri("project/lang/en/messages.php"));
    let env = client.at("textDocument/definition", &uri, 6, 8);
    assert_eq!(env[0]["uri"], disk.uri("project/.env"));

    let hover = client.at("textDocument/hover", &uri, 1, 12);
    assert!(
        hover["contents"]["value"]
            .as_str()
            .is_some_and(|text| text.contains("config key")),
        "{hover}"
    );

    let diagnostics = client.diagnostics(&uri);
    let unknown: Vec<&Value> = diagnostics
        .iter()
        .filter(|diagnostic| {
            diagnostic["code"]
                .as_str()
                .is_some_and(|code| code.starts_with("unknown-"))
        })
        .collect();
    let lines: Vec<&Value> = unknown
        .iter()
        .map(|diagnostic| &diagnostic["range"]["start"]["line"])
        .collect();
    assert_eq!(lines, [2, 7], "{diagnostics:?}");
    assert!(
        unknown
            .iter()
            .all(|diagnostic| diagnostic["code"] == "unknown-config-key")
    );
    client.shutdown();
}

#[test]
fn the_container_gives_the_class_a_string_names() {
    let disk = laravel();
    disk.write(
        "project/app/Providers/AppServiceProvider.php",
        "<?php\nnamespace App\\Providers;\n\nuse App\\Models\\Post;\nuse Illuminate\\Support\\ServiceProvider;\n\nclass AppServiceProvider extends ServiceProvider\n{\n    public function register(): void\n    {\n        $this->app->bind('post', fn () => new Post());\n    }\n}\n",
    );
    disk.write(
        "project/vendor/laravel/ServiceProvider.php",
        "<?php\nnamespace Illuminate\\Support;\nabstract class ServiceProvider { public function __construct(protected $app) {} }\n",
    );
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/app/Http/Page.php");
    client.open(&uri, "<?php\n$post = app('post');\n$post->title();\n$post;\n");
    let hover = client.at("textDocument/hover", &uri, 3, 2);
    assert!(
        hover["contents"]["value"]
            .as_str()
            .is_some_and(|text| text.contains("Post")),
        "{hover}"
    );
    client.shutdown();
}

#[test]
fn a_blade_template_follows_its_directives_components_and_php() {
    let disk = laravel();
    disk.write(
        "project/resources/views/components/alert.blade.php",
        "<div>{{ $slot }}</div>\n",
    );
    let mut client = indexed_server(&disk);
    let uri = disk.uri("project/resources/views/home.blade.php");
    client.notify(
        "textDocument/didOpen",
        json!({ "textDocument": { "uri": uri, "languageId": "blade", "version": 1, "text": "@extends('layouts.app')\n<x-alert />\n<p>{{ config('app.name') }}</p>\n" } }),
    );
    let extends = client.at("textDocument/definition", &uri, 0, 14);
    assert_eq!(
        extends[0]["uri"],
        disk.uri("project/resources/views/layouts/app.blade.php")
    );
    let component = client.at("textDocument/definition", &uri, 1, 5);
    assert_eq!(
        component[0]["uri"],
        disk.uri("project/resources/views/components/alert.blade.php")
    );
    let config = client.at("textDocument/definition", &uri, 2, 17);
    assert_eq!(config[0]["uri"], disk.uri("project/config/app.php"));
    let hover = client.at("textDocument/hover", &uri, 2, 17);
    assert!(
        hover["contents"]["value"]
            .as_str()
            .is_some_and(|text| text.contains("config key")),
        "{hover}"
    );
    let items = complete_at(&mut client, &uri, 0, 14);
    assert_eq!(items, ["layouts.app"]);
    client.shutdown();
}

#[test]
fn a_changed_env_file_is_read_again() {
    let disk = laravel();
    let (mut client, _) = Client::start_in(
        json!({ "window": { "workDoneProgress": true }, "workspace": { "didChangeWatchedFiles": { "dynamicRegistration": true } } }),
        disk.options(),
        json!(disk.uri("project")),
    );
    let registration = client.wait_for(|message| match message {
        Message::Request(request) if request.method == "client/registerCapability" => Some(request.clone()),
        _ => None,
    });
    let patterns: Vec<String> = registration.params["registrations"][0]["registerOptions"]["watchers"]
        .as_array()
        .expect("watchers")
        .iter()
        .filter_map(|watcher| watcher["globPattern"].as_str().map(str::to_string))
        .collect();
    assert!(patterns.contains(&"**/.env".to_string()), "{patterns:?}");
    client.send(Response::new_ok(registration.id, Value::Null));
    client.wait_for_indexing();

    let uri = disk.uri("project/app/Http/Page.php");
    client.open(&uri, "<?php\nenv('NEW_');\n");
    assert!(complete_at(&mut client, &uri, 1, 9).is_empty());
    disk.write("project/.env", "APP_NAME=Laravel\nNEW_THING=1\n");
    client.notify(
        "workspace/didChangeWatchedFiles",
        json!({ "changes": [{ "uri": disk.uri("project/.env"), "type": 2 }] }),
    );
    assert_eq!(complete_at(&mut client, &uri, 1, 9), ["NEW_THING"]);
    client.shutdown();
}
