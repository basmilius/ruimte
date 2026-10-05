use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::LineIndex;
use crate::references::{Current, Sources, references_at};
use crate::testing::{Fixture, split_cursor};

struct Files(HashMap<PathBuf, String>);

impl Sources for Files {
    fn candidates(&self, word: &str) -> Vec<PathBuf> {
        self.0
            .iter()
            .filter(|(_, text)| text.to_ascii_lowercase().contains(word))
            .map(|(path, _)| path.clone())
            .collect()
    }

    fn text(&self, path: &Path) -> Option<String> {
        self.0.get(path).cloned()
    }
}

/// Every reference of what is at the cursor of `current`, as `file:line:text` in file order.
fn find(files: &[(&str, &str)], current: &str) -> Vec<String> {
    let fixture = Fixture::new(files).with_current(current);
    let (text, root, offset) = split_cursor(current);
    let sources = Files(fixture.sources.clone());
    let path = PathBuf::from("/project/current.php");
    let found = references_at(
        &fixture.index,
        &sources,
        &Current {
            path: &path,
            text: &text,
            root: &root,
        },
        offset,
    );
    let Some(found) = found else {
        return vec!["nothing".to_string()];
    };
    let mut out = Vec::new();
    for file in &found.files {
        let source = if file.path == path {
            text.clone()
        } else {
            fixture.sources[&file.path].clone()
        };
        let lines = LineIndex::new(&source);
        for hit in &file.hits {
            let line = lines
                .line_col(&source, hit.range.start(), crate::PositionEncoding::Utf16)
                .line
                + 1;
            let name = file
                .path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let written = &source[usize::from(hit.range.start())..usize::from(hit.range.end())];
            out.push(format!("{name}:{line}:{written}:{:?}", hit.kind));
        }
    }
    out
}

#[test]
fn finds_every_use_of_a_class() {
    let user = "<?php\nnamespace App;\n\nclass User {\n    public static function make(): static { return new static(); }\n}\n";
    let service = "<?php\nnamespace App\\Services;\n\nuse App\\User;\nuse App\\User as Person;\n\n/** @param User $user */\nfunction f(User $user, Person $other): ?User {\n    $a = new User();\n    $b = User::make();\n    return $user instanceof User ? $user : null;\n}\nclass Admin extends User {}\n";
    let current = "<?php\nnamespace App;\n\n$x = new Us$0er();\n";
    assert_eq!(
        find(&[("user.php", user), ("service.php", service)], current),
        [
            "current.php:4:User:Reference",
            "service.php:4:User:Import",
            "service.php:5:User:Import",
            "service.php:7:User:Doc",
            "service.php:8:User:Reference",
            "service.php:8:Person:Reference",
            "service.php:8:User:Reference",
            "service.php:9:User:Reference",
            "service.php:10:User:Reference",
            "service.php:11:User:Reference",
            "service.php:13:User:Reference",
            "user.php:4:User:Declaration",
        ]
    );
}

#[test]
fn a_method_is_one_thing_across_its_hierarchy() {
    let contract = "<?php\nnamespace App;\n\ninterface Handler { public function handle(int $x): void; }\n";
    let first = "<?php\nnamespace App;\n\nclass First implements Handler { public function handle(int $x): void {} }\n";
    let second = "<?php\nnamespace App;\n\nclass Second extends First { public function handle(int $x): void { parent::handle($x); } }\n";
    let other = "<?php\nnamespace App;\n\nclass Other { public function handle(int $x): void {} }\n";
    let caller = "<?php\nnamespace App;\n\nfunction run(Handler $h, Second $s, Other $o) {\n    $h->handle(1);\n    $s->handle(2);\n    $o->handle(3);\n}\n";
    let current = "<?php\nnamespace App;\n\nclass Third extends Second { public function han$0dle(int $x): void {} }\n";
    assert_eq!(
        find(
            &[
                ("handler.php", contract),
                ("first.php", first),
                ("second.php", second),
                ("other.php", other),
                ("caller.php", caller)
            ],
            current
        ),
        [
            "caller.php:5:handle:Reference",
            "caller.php:6:handle:Reference",
            "current.php:4:handle:Declaration",
            "first.php:4:handle:Declaration",
            "handler.php:4:handle:Declaration",
            "second.php:4:handle:Declaration",
            "second.php:4:handle:Reference",
        ]
    );
}

#[test]
fn a_promoted_property_is_a_property_a_parameter_and_a_variable() {
    let point = "<?php\nnamespace App;\n\nclass Point {\n    public function __construct(private int $x, public int $y = 0) {}\n    public function sum(): int { return $this->x + $this->y; }\n}\n";
    let usage = "<?php\nnamespace App;\n\n$p = new Point(x: 1, y: 2);\necho $p->y;\n";
    let current = "<?php\nnamespace App;\n\nfunction f(Point $p) { return $p->$0y; }\n";
    let result = find(&[("point.php", point), ("usage.php", usage)], current);
    assert_eq!(
        result,
        [
            "current.php:4:y:Reference",
            "point.php:5:$y:Declaration",
            "point.php:6:y:Reference",
            "usage.php:4:y:Reference",
            "usage.php:5:y:Reference",
        ]
    );
}

#[test]
fn variables_stay_inside_their_function() {
    let current = "<?php\nfunction one($a, $b) {\n    $c = $a + $b;\n    $f = fn($x) => $x + $a;\n    $g = function () use ($a) { return $a; };\n    return $c . $$0a;\n}\nfunction two($a) { return $a; }\n";
    assert_eq!(
        find(&[], current),
        [
            "current.php:2:$a:Declaration",
            "current.php:3:$a:Reference",
            "current.php:4:$a:Reference",
            "current.php:5:$a:Reference",
            "current.php:5:$a:Reference",
            "current.php:6:$a:Reference",
        ]
    );
}

#[test]
fn finds_functions_and_constants() {
    let lib = "<?php\nnamespace Lib;\n\nconst LIMIT = 10;\nfunction helper(): int { return LIMIT; }\n";
    let usage = "<?php\nnamespace App;\n\nuse function Lib\\helper;\nuse const Lib\\LIMIT;\n\necho helper() + LIMIT + \\Lib\\helper();\n";
    let current = "<?php\nuse function Lib\\helper;\n\nhel$0per();\n";
    assert_eq!(
        find(&[("lib.php", lib), ("usage.php", usage)], current),
        [
            "current.php:2:helper:Import",
            "current.php:4:helper:Reference",
            "lib.php:5:helper:Declaration",
            "usage.php:4:helper:Import",
            "usage.php:7:helper:Reference",
            "usage.php:7:helper:Reference",
        ]
    );
}
