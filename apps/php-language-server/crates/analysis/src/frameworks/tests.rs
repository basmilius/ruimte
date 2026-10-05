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

fn container_project() -> Fixture {
    let mut files = php_index::framework::testing::CONTAINER.to_vec();
    files.extend_from_slice(&[
        (
            "app/Mailer.php",
            "<?php namespace App; class Mailer { public function send() {} }",
        ),
        ("app/Gateway.php", "<?php namespace App; interface Gateway {}"),
        (
            "app/StripeGateway.php",
            "<?php namespace App; class StripeGateway implements Gateway {}",
        ),
        (
            "app/Providers/AppServiceProvider.php",
            r#"<?php
namespace App\Providers;
use App\{Gateway, Mailer, StripeGateway};
use Illuminate\Support\ServiceProvider;
class AppServiceProvider extends ServiceProvider {
    public function register(): void {
        $this->app->singleton('mailer', fn () => new Mailer());
        $this->app->bind(Gateway::class, StripeGateway::class);
        $this->app->bind('gateway', function ($app) { return $app->make(StripeGateway::class); });
    }
}
"#,
        ),
    ]);
    Fixture::framework(&files)
}

fn container_var(code: &str, name: &str) -> String {
    let fixture = container_project().with_current(code);
    let (_, root, offset) = split_cursor(code);
    let analyzer = Analyzer::new(&fixture.index, &root, offset);
    analyzer
        .env_at(offset)
        .get(name)
        .map_or_else(|| "<unset>".to_string(), |ty| ty.display(true))
}

#[test]
fn the_container_gives_the_class_that_is_asked_for() {
    let code = "<?php use App\\Mailer;\n$mailer = app(Mailer::class);\n$app = app();\n$0";
    assert_eq!(container_var(code, "mailer"), "Mailer");
    assert_eq!(container_var(code, "app"), "Application");
}

#[test]
fn the_container_resolves_names_the_framework_and_the_project_register() {
    let code = "<?php\n$cache = app('cache');\n$mailer = app('mailer');\n$gateway = app('gateway');\n$typed = app(\\App\\Gateway::class);\n$unknown = app('nope');\n$0";
    assert_eq!(container_var(code, "cache"), "CacheManager");
    assert_eq!(container_var(code, "mailer"), "Mailer");
    assert_eq!(container_var(code, "gateway"), "StripeGateway");
    assert_eq!(container_var(code, "typed"), "Gateway");
    assert_eq!(container_var(code, "unknown"), "mixed");
}

#[test]
fn make_on_the_application_resolves_names_too() {
    let code = "<?php\nfunction f(\\Illuminate\\Foundation\\Application $app) { $cache = $app->make('cache'); $0 }";
    assert_eq!(container_var(code, "cache"), "CacheManager");
}

mod keys {
    use php_index::framework::testing::HELPERS;

    use crate::completion::{CompletionOptions, complete};
    use crate::infer::Analyzer;
    use crate::inspections::{Externals, InspectionEnv, InspectionSettings, inspect};
    use crate::testing::{CURSOR, Fixture, split_cursor};

    const CONFIG_APP: &str = "<?php\nreturn [\n    'name' => env('APP_NAME', 'Laravel'),\n    'locale' => 'en',\n    'nested' => ['a' => 1],\n];\n";

    fn project() -> Fixture {
        let mut files = HELPERS.to_vec();
        files.extend_from_slice(&[
            ("config/app.php", CONFIG_APP),
            (
                "routes/web.php",
                "<?php\nRoute::get('/', fn () => 1)->name('home');\nRoute::get('/about', fn () => 1)->name('about');\n",
            ),
            ("resources/views/welcome.blade.php", "<h1>hi</h1>"),
            ("resources/views/mail/invoice.blade.php", "x"),
            ("lang/en/messages.php", "<?php return ['welcome' => 'Welcome'];"),
            (".env", "APP_NAME=Laravel\nAPP_DEBUG=true\n"),
        ]);
        Fixture::framework(&files)
    }

    fn completions(code: &str) -> Vec<String> {
        let fixture = project().with_current(code);
        let offset = code.find(CURSOR).expect("a cursor marker") as u32;
        let text = code.replacen(CURSOR, "", 1);
        complete(&fixture.index, &text, offset, CompletionOptions::default())
            .items
            .into_iter()
            .map(|item| item.label)
            .collect()
    }

    fn definitions(code: &str) -> Vec<(String, String)> {
        let fixture = project().with_current(code);
        let (text, root, offset) = split_cursor(code);
        let analyzer = Analyzer::new(&fixture.index, &root, offset);
        let _ = text;
        analyzer
            .definitions(offset)
            .into_iter()
            .map(|place| {
                let path = place.path.expect("a file");
                let source = fixture.sources.get(&path).cloned().unwrap_or_default();
                let found = source
                    .get(place.span.start as usize..place.span.end as usize)
                    .unwrap_or("")
                    .to_string();
                (
                    path.strip_prefix("/project")
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .into_owned(),
                    found,
                )
            })
            .collect()
    }

    fn findings(code: &str) -> Vec<(&'static str, String)> {
        let fixture = project().with_current(code);
        let root = php_syntax::parse(code).syntax();
        let externals = Externals::none();
        let settings = InspectionSettings::default();
        let env = InspectionEnv {
            index: &fixture.index,
            text: code,
            root: &root,
            settings: &settings,
            ready: true,
            externals: &externals,
        };
        inspect(&env)
            .into_iter()
            .map(|finding| {
                (
                    finding.diagnostic.code,
                    code[usize::from(finding.diagnostic.range.start())..usize::from(finding.diagnostic.range.end())]
                        .to_string(),
                )
            })
            .filter(|(code, _)| code.starts_with("unknown-"))
            .collect()
    }

    #[test]
    fn completes_the_names_of_every_kind() {
        assert_eq!(
            completions("<?php config('app.$0');"),
            ["app.locale", "app.name", "app.nested", "app.nested.a"]
        );
        assert_eq!(completions("<?php route('$0');"), ["about", "home"]);
        assert_eq!(completions("<?php view('mail.$0');"), ["mail.invoice"]);
        assert_eq!(completions("<?php __('messages.$0');"), ["messages.welcome"]);
        assert_eq!(completions("<?php env('APP_$0');"), ["APP_DEBUG", "APP_NAME"]);
        assert_eq!(
            completions("<?php Illuminate\\Support\\Facades\\Config::get('app.na$0');"),
            ["app.name"]
        );
        assert_eq!(
            completions("<?php Illuminate\\Support\\Facades\\View::make('wel$0');"),
            ["welcome"]
        );
    }

    #[test]
    fn completes_and_follows_the_fields_a_form_request_validates() {
        let mut files = HELPERS.to_vec();
        files.extend_from_slice(&[
            (
                "vendor/laravel/FormRequest.php",
                "<?php namespace Illuminate\\Foundation\\Http; class FormRequest { public function input($key = null, $default = null) {} public function rules() { return []; } }",
            ),
            (
                "app/Http/Requests/StoreUserRequest.php",
                "<?php namespace App\\Http\\Requests; use Illuminate\\Foundation\\Http\\FormRequest; class StoreUserRequest extends FormRequest { public function rules(): array { return ['name' => 'required', 'email' => 'email']; } }",
            ),
        ]);
        let code = "<?php use App\\Http\\Requests\\StoreUserRequest;\nfunction store(StoreUserRequest $request) { $request->input('$0'); }";
        let fixture = Fixture::framework(&files).with_current(code);
        let offset = code.find(CURSOR).expect("a cursor marker") as u32;
        let text = code.replacen(CURSOR, "", 1);
        let labels: Vec<String> = complete(&fixture.index, &text, offset, CompletionOptions::default())
            .items
            .into_iter()
            .map(|item| item.label)
            .collect();
        assert_eq!(labels, ["email", "name"]);
        let code = "<?php use App\\Http\\Requests\\StoreUserRequest;\nfunction store(StoreUserRequest $request) { $request->input('em$0ail'); }";
        let fixture = Fixture::framework(&files).with_current(code);
        let (_, root, offset) = split_cursor(code);
        let places = Analyzer::new(&fixture.index, &root, offset).definitions(offset);
        assert_eq!(places.len(), 1);
        assert!(
            places[0]
                .path
                .as_ref()
                .is_some_and(|path| path.ends_with("StoreUserRequest.php"))
        );
        let other = "<?php function f($bag) { $bag->input('em$0ail'); }";
        let (_, root, offset) = split_cursor(other);
        assert!(
            Analyzer::new(&fixture.index, &root, offset)
                .definitions(offset)
                .is_empty()
        );
    }

    #[test]
    fn a_string_that_names_nothing_completes_nothing() {
        assert!(completions("<?php strlen('app.$0');").is_empty());
        assert!(completions("<?php $x = ['app.$0'];").is_empty());
    }

    #[test]
    fn goes_to_where_the_name_is_declared() {
        assert_eq!(
            definitions("<?php config('app.na$0me');"),
            [("config/app.php".to_string(), "name".to_string())]
        );
        assert_eq!(
            definitions("<?php route('ho$0me');"),
            [("routes/web.php".to_string(), "home".to_string())]
        );
        assert_eq!(
            definitions("<?php view('mail.inv$0oice');"),
            [("resources/views/mail/invoice.blade.php".to_string(), String::new())]
        );
        assert_eq!(
            definitions("<?php env('APP_DE$0BUG');"),
            [(".env".to_string(), "APP_DEBUG".to_string())]
        );
    }

    #[test]
    fn reports_the_names_the_project_certainly_lacks() {
        let found = findings(
            "<?php config('app.nam'); route('hom'); view('welcom'); __('messages.welcom'); config('app.name'); route('home'); view('mail.invoice'); __('Hello world.');",
        );
        assert_eq!(
            found,
            [
                ("unknown-config-key", "app.nam".to_string()),
                ("unknown-route", "hom".to_string()),
                ("unknown-view", "welcom".to_string()),
                ("unknown-translation", "messages.welcom".to_string()),
            ]
        );
    }

    #[test]
    fn stays_silent_where_the_name_may_be_missing_on_purpose() {
        let found = findings(
            "<?php config('app.nope', 'fallback'); Illuminate\\Support\\Facades\\Config::has('app.nope'); Illuminate\\Support\\Facades\\Route::has('nope'); view('pkg::thing'); config('other.key'); $key = 'app.nope'; config($key); config('app.name' . 'x'); strlen('app.nam');",
        );
        assert_eq!(found, []);
    }
}
