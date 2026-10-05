use std::path::PathBuf;

use crate::completion::{CompletionOptions, complete};
use crate::infer::Analyzer;
use crate::testing::{Fixture, PEST, PHPUNIT, split_cursor};

const EVENT: &str = r#"<?php
namespace App;
final class Event {
    public string $name = '';
    public ?Venue $venue = null;
    public function startsOn(): \DateTimeImmutable {}
}
final class Venue { public string $city = ''; }
"#;

fn fixture(current: &str) -> Fixture {
    Fixture::new(&[("pest.php", PEST), ("phpunit.php", PHPUNIT), ("Event.php", EVENT)]).with_current(current)
}

fn this_type(code: &str, expression: &str) -> String {
    let fixture = fixture(code);
    let (_, root, offset) = split_cursor(code);
    let _guard = crate::document::enter(Some(&PathBuf::from("/project/tests/Feature/FooTest.php")));
    let analyzer = Analyzer::new(&fixture.index, &root, offset);
    let env = analyzer.env_at(offset);
    let parsed = php_syntax::parse(&format!("<?php {expression};")).syntax();
    let node = parsed
        .descendants()
        .find(|node| node.kind() == php_syntax::SyntaxKind::EXPR_STATEMENT)
        .and_then(|statement| statement.children().next())
        .expect("an expression");
    analyzer.type_of(&node, &env).display(true)
}

#[test]
fn this_is_the_test_case_in_a_test_closure() {
    let code = r#"<?php
use App\Event;
it('works', function () {
    $0
});
"#;
    assert_eq!(this_type(code, "$this"), "static");
    let analyzer_class = {
        let fixture = fixture(code);
        let (_, root, offset) = split_cursor(code);
        Analyzer::new(&fixture.index, &root, offset).this_type().display(false)
    };
    assert_eq!(analyzer_class, "PHPUnit\\Framework\\TestCase");
}

#[test]
fn describe_and_the_top_of_the_file_have_no_test_case() {
    let code = "<?php\ndescribe('group', function () {\n    $0\n});\n";
    let fixture = fixture(code);
    let (_, root, offset) = split_cursor(code);
    assert_eq!(
        Analyzer::new(&fixture.index, &root, offset).this_type().display(false),
        "mixed"
    );
}

#[test]
fn properties_set_in_before_each_are_known_in_the_tests_of_the_file() {
    let code = r#"<?php
use App\Event;
use App\Venue;
beforeEach(function () {
    $this->event = new Event();
    $this->venue = $this->event->venue ?? new Venue();
});
it('works', function () {
    $0
});
"#;
    assert_eq!(this_type(code, "$this->event"), "Event");
    assert_eq!(this_type(code, "$this->event->venue"), "?Venue");
    assert_eq!(this_type(code, "$this->event->startsOn()"), "DateTimeImmutable");
    assert_eq!(this_type(code, "$this->venue"), "Venue");
    assert_eq!(this_type(code, "$this->unknown"), "mixed");
}

#[test]
fn a_before_each_inside_describe_only_reaches_its_own_tests() {
    let code = r#"<?php
use App\Event;
describe('inner', function () {
    beforeEach(function () { $this->event = new Event(); });
    it('sees it', function () { $0 });
});
it('does not', function () { $this->event; });
"#;
    assert_eq!(this_type(code, "$this->event"), "Event");
    let outside = r#"<?php
use App\Event;
describe('inner', function () {
    beforeEach(function () { $this->event = new Event(); });
});
it('does not', function () { $0 });
"#;
    assert_eq!(this_type(outside, "$this->event"), "mixed");
}

#[test]
fn the_case_class_and_traits_come_from_uses_for_the_folder() {
    let pest_php = "<?php\nnamespace Tests;\nuse Tests\\Support\\AppCase;\nuse Tests\\Support\\Refreshes;\nuses(AppCase::class, Refreshes::class)->in('Feature');\nuses(Other::class)->in('Unit');\n";
    let support = "<?php\nnamespace Tests\\Support;\nclass AppCase extends \\PHPUnit\\Framework\\TestCase { public function login(): void {} }\ntrait Refreshes { public function refreshDatabase(): bool {} }\n";
    let code = "<?php\nit('works', function () {\n    $0\n});\n";
    let fixture = Fixture::new(&[
        ("pest.php", PEST),
        ("phpunit.php", PHPUNIT),
        ("tests/Pest.php", pest_php),
        ("tests/Support/Support.php", support),
    ])
    .with_current(code);
    let (_, root, offset) = split_cursor(code);
    let _guard = crate::document::enter(Some(&PathBuf::from("/project/tests/Feature/Http/FooTest.php")));
    let analyzer = Analyzer::new(&fixture.index, &root, offset);
    assert_eq!(
        analyzer.this_type().display(false),
        "Tests\\Support\\AppCase&Tests\\Support\\Refreshes"
    );
    let env = analyzer.env_at(offset);
    let parsed = php_syntax::parse("<?php $this->refreshDatabase();").syntax();
    let call = parsed
        .descendants()
        .find(|node| node.kind() == php_syntax::SyntaxKind::CALL_EXPR)
        .unwrap();
    assert_eq!(analyzer.type_of(&call, &env).display(true), "bool");
    drop(_guard);
    let _unit = crate::document::enter(Some(&PathBuf::from("/project/tests/Unit/FooTest.php")));
    let analyzer = Analyzer::new(&fixture.index, &root, offset);
    assert_eq!(analyzer.this_type().display(false), "Tests\\Other");
}

#[test]
fn completion_offers_the_properties_before_each_sets() {
    let code = r#"<?php
use App\Event;
beforeEach(function () {
    $this->event = new Event();
});
it('works', function () {
    $this->ev$0
});
"#;
    let fixture = fixture(code);
    let offset = code.find("$0").unwrap() as u32;
    let text = code.replacen("$0", "", 1);
    let labels: Vec<String> = complete(&fixture.index, &text, offset, CompletionOptions::default())
        .items
        .into_iter()
        .map(|item| item.label)
        .collect();
    assert_eq!(labels, vec!["event"]);
}
