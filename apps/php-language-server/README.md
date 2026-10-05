# php-language-server

A language server for PHP, written in Rust. It reads PHP 8.1 through 8.5 with a parser of its own that keeps every byte of a file, comments and whitespace included, and that goes on past a syntax error instead of stopping at it. The aim is the insight a full PHP IDE gives (navigation, completion, rename, inspections, refactors) as a server any editor can talk to over LSP.

This is phase 1a: the parser, the syntax tree and a small server on top of it. It has no index yet, so it knows nothing about other files, types or the standard library.

## Where the code comes from

Everything here is written from scratch. The sources it is allowed to learn from are:

- the PHP language reference and grammar (php.net, the grammar in php-src) and php-src's own tests for the cases the grammar leaves open;
- the open source IntelliJ Platform (Apache 2.0) for general ideas such as lossless trees and error recovery;
- JetBrains/phpstorm-stubs (Apache 2.0), as a corpus the parser must read without errors now and as the description of the standard library later;
- PHPStan and Psalm (MIT) for type rules, later;
- watching what an installed IDE does with a piece of code.

Nothing was taken from the bytecode or the decompiled classes of any IDE plugin, and no code was copied from another product. Crates under MIT, Apache or BSD licenses are used freely. The corpora are fetched by a script into a folder git ignores, so none of that material is part of this repository and there is no NOTICE to carry.

## Layout

A Cargo workspace with three crates.

| Crate | Holds |
| --- | --- |
| `crates/syntax` (`php-syntax`) | The lexer, the parser, the tree (on `rowan`), the language level table and the pass that checks a tree against a level. |
| `crates/analysis` (`php-analysis`) | Questions about a tree: document symbols, folding ranges, selection ranges, diagnostics, and the line index that maps offsets to positions. Knows nothing of LSP. |
| `crates/server` (`php-language-server`) | The LSP front end over stdio: documents, incremental sync, the requests below, configuration. Library and binary. |

`index` (symbols across files and the standard library) and a type layer come next to these in phase 1b.

### The syntax crate

- `lexer.rs` is a mode stack that mirrors how PHP tokenizes: inline HTML, `<?php` and `<?=`, interpolated strings with `$a[0]`, `$a->b`, `{$...}` and `${...}`, heredocs and nowdocs with flexible closing markers, casts, numbers with separators and every base, names as single tokens (`Foo\Bar`, `\Foo`, `namespace\Foo`), `__halt_compiler`. Every byte lands in exactly one token. The state is a small value that can be cloned: `lex_with_checkpoints` records it at the first token of every line, and `lex_from` resumes from one, which is what incremental relexing needs.
- `parser/` is recursive descent with a Pratt parser for expressions, over the union of PHP 8.1 to 8.5 syntax: property hooks, asymmetric visibility, `new` without parentheses in a chain, the pipe operator, `clone` with arguments, the `(void)` cast, closures and first-class callables in constant expressions, attributes everywhere they are allowed, alternative syntax, enums and so on. It never looks at a language level.
- `kind.rs` holds the one enum of token and node kinds. `dump.rs` prints a tree for tests and for looking at what the parser made.
- `language_level.rs` is described below.

Notes on the shape of the tree:

- A node starts at its first token and ends at its last, so trivia sit between nodes. The exception is a declaration, which also owns the doc comment right before it (and its attributes), so `/** ... */ final class A {}` is one node.
- Names are single tokens wrapped in a `NAME` node, for declarations and references alike. `A::$b` is a `STATIC_PROPERTY_EXPR`, `A::B` and `A::b()` are a `SCOPED_ACCESS_EXPR`, which is what tells an assignable target from one that is not.
- A `?>` ends a statement the way a `;` does, and a file may swap between PHP and inline HTML anywhere, including in the middle of `if (...): ?> ... <?php endif; ?>`.

### Error recovery

The parser never fails and never panics: every input gives a tree whose text equals the input, with `ERROR` nodes around what it could not read and a list of errors with ranges. A missing token is reported without being consumed, a list stops at a token that cannot belong to it (`;`, `{`, `}`), a statement list stops at a token that closes something outside it, and a class body picks up again at the next token that starts a member. A `public` or `private` found inside a method body ends that body, because it means a `}` went missing above it. Nesting is limited to 200 levels, past which the parser reports it and goes on, so a hostile file cannot overflow the stack.

Messages say what is missing in the form of an IDE (`';' expected`, `Expression expected`) and an empty range, which is where something is missing, is widened by the server to the character before it so a client has something to draw.

## Language level

The lexer and the parser accept all supported syntax and never reject it by version. What a file may use is a separate question, answered by `PhpVersion` and one table.

- `PhpVersion { major, minor }` is ordered and parses `8.4`, `8.4.2` and constraints such as `^8.1`.
- `FEATURES` in `language_level.rs` has one row per piece of syntax: its id, the name it has in a message, the version that introduced it, the version that deprecated it and the version that removed it, the node or token kinds to look at, a function that finds the construct, and an example. About forty rows cover 8.0 to 8.5.
- `check_language_level(tree, version)` walks the tree once and reports syntax newer than the level as an error (`Property hooks are only available since PHP 8.4`), syntax removed by then as an error (`The (real) cast was removed in PHP 8.0`) and deprecated syntax as a warning with the deprecated tag (`The backtick operator is deprecated since PHP 8.5`), each ranged on the construct.

Supporting PHP 8.6 means adding rows to the table, plus the syntax to the parser when there is any. No version check sits anywhere else. A test parses the example of every row and holds the row against it: reported just below its `since`, accepted at it, and the same for deprecations and removals.

## The server

`php-language-server --stdio` (the flag is the default) speaks LSP over stdin and stdout. It answers:

- `initialize`, with incremental document sync and a position encoding it negotiates (UTF-8 when the client offers it, else UTF-16);
- diagnostics: syntax errors and language level findings, pushed with `textDocument/publishDiagnostics` after a burst of changes has settled, or pulled with `textDocument/diagnostic` when the client announces that it pulls (then nothing is pushed). Zero-width ranges are widened;
- `textDocument/documentSymbol`: namespaces, classes, interfaces, traits, enums and their members (methods, constructors, properties and promoted properties, constants, enum cases), functions and constants, with signatures as detail and the deprecated tag from `@deprecated`. A client that cannot nest gets the flat form. Declarations behind `if (!function_exists(...))` count;
- `textDocument/foldingRange`: class, function and control structure bodies, arrays, `match` and `switch` bodies, property hooks, attribute lists, heredocs, alternative syntax bodies, multi-line and consecutive line comments (`comment`), runs of `use` statements (`imports`), `// region` and `// endregion` (`region`) and PHP tags between markup. A fold ends on the line before a closing bracket that starts its line, so the bracket stays visible;
- `textDocument/selectionRange`, growing from the token through every enclosing node to the file.

### Configuration

Only standard LSP channels are used:

- `initializationOptions`: `{ "phpVersion": "8.4" }`, the default language level;
- `workspace/configuration`, when the client supports it: the server asks for the section `phpLanguageServer` with the document as `scopeUri` and reads `{ "phpVersion": "8.4" }`, so a client can answer differently per project or folder;
- `workspace/didChangeConfiguration` with the same object, bare or under `phpLanguageServer`.

The level of a document is the answer for its scope, else the default, else the newest version (8.5).

### Incremental reparse

A change is applied to the text and the whole file is parsed again. That is measured to be faster than anything a patch could save: a typical 54 KB file parses in about 0.5 ms and a 1.4 MB file in about 13 ms, while typing arrives at a fraction of that rate. The server also answers every message already queued before it publishes diagnostics, so a burst of keystrokes costs one parse. Reusing unchanged subtrees of the old green tree is possible later if a profile ever asks for it.

## Build, test and run

```sh
cargo build --release --locked            # target/release/php-language-server
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

The default test run needs no network and no PHP. It holds, per construct, snapshot tests of the tree in a compact text form (`expect-test`: `UPDATE_EXPECT=1 cargo test` rewrites them), error recovery tests, a round trip test (the text of the tree equals the input for every prefix of a sample file and after every single edit), tests of the language level table, and an end-to-end test of the server over an in-memory connection.

### Corpus

```sh
./scripts/fetch-corpus.sh                 # into ./corpus, ignored by git
cargo test --locked --test corpus         # without a corpus these tests report that and pass
cargo run --release -p php-syntax --example corpus -- stubs
cargo run --release -p php-syntax --example corpus -- phpt --oracle --verbose
cargo run --release -p php-syntax --example corpus -- dir=/some/project --oracle
```

The script pins phpstorm-stubs to a commit and php-src to the `php-8.5.11` tag (its `Zend/tests` and `tests` folders). The example reports files that fail to parse; with `--oracle` it asks `php -l` of the PHP on the path whether PHP itself agrees.

Results:

| Corpus | Files | Result |
| --- | --- | --- |
| phpstorm-stubs | 1052, 13 MB | no syntax errors, parsed in about 80 ms |
| php-src tests (the `--FILE--` of 6170 `.phpt`) | 6170 | no errors on any file PHP accepts; the 148 files PHP rejects are rejected here too, except those listed below |
| Real projects (vendor trees and applications on the author's machine) | 152,511, 1.1 GB | no disagreement with `php -l` on any file |

The stubs declare `exit()` and `die()` as functions, which the parser reports in a user file as a reserved word used as a name, so that one message is ignored for the stubs.

Valid files rejected by the parser: none, except `Zend/tests/stack_limit/*.phpt`, which nest tens of thousands of operators to test PHP's own stack limit and hit the nesting limit of 200 here.

Invalid files accepted by the parser, the syntax errors PHP reports that this phase does not (all are semantic rather than lexical, and a later inspection can report them):

- `(real)` cast removed in 8.0: the language level pass reports it (`real_cast.phpt`);
- `list(...)` used as a value (`list_011.phpt`), `const` inside a function (`oss_fuzz_416302790.phpt`), `?static` as a property type (`static_type_property.phpt`);
- `(void)` as the only expression of a `for` condition (`gh18301_cast_to_void_statement_for_condition.phpt`).

The one construct of older PHP the parser does not read is the removed `$a{0}` offset syntax.

### Benchmarks

```sh
cargo bench -p php-syntax                 # criterion; not part of cargo test
```

Measured on an Apple Silicon laptop, release build: lexing about 345 MiB/s, parsing about 100 MiB/s (1.4 MB synthetic file in 13.5 ms, a 54 KB file in 0.54 ms, all of phpstorm-stubs in about 80 ms).

## Roadmap

1. **Phase 1a (this):** parser, lossless tree, error recovery, language level table and gate, a server with diagnostics, symbols, folding and selection ranges.
2. **Phase 1b, index and completion:** an index of declarations over a project and the standard library, name resolution, completion, hover, signature help and go to definition. The language level comes from `composer.json` per project (`config.platform.php`, then the lower bound of `require.php`), and the standard library stubs are filtered by version (`@since`, `@removed` and the availability attributes of the stubs). The index takes a `PhpVersion` as a parameter from its first line, and `PhpVersion::parse` already reads composer constraints.
3. **Phase 2, references and rename:** find usages, rename across files, highlights, workspace symbols.
4. **Phase 3, inspections and fixes:** type-aware diagnostics in the spirit of PHPStan and Psalm, with quick fixes and code actions, formatting, inlay hints and semantic tokens.
5. **Phase 4, refactors:** extract, inline, move, change signature, built on the lossless tree so formatting and comments survive.
6. **Phase 5, frameworks:** Composer autoload maps, Laravel, Symfony and similar conventions.
