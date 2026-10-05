# php-language-server

A language server for PHP, written in Rust. It reads PHP 8.1 through 8.5 with a parser of its own that keeps every byte of a file, comments and whitespace included, and that goes on past a syntax error instead of stopping at it. The aim is the insight a full PHP IDE gives (navigation, completion, rename, inspections, refactors) as a server any editor can talk to over LSP.

Phase 1a is the parser, the syntax tree and a small server on top of it. Phase 1b adds an index of the project, its Composer packages and the standard library, a type layer, and hover, navigation, workspace symbols and completion with auto-import on top of that.

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
| `crates/index` (`php-index`) | The declarations of a file with their PHPDoc, name resolution, PHPDoc types, Composer metadata, the stubs of the standard library, the persistent cache, the parallel indexer and the class hierarchy. Knows nothing of LSP. |
| `crates/analysis` (`php-analysis`) | Questions about a tree and an index: document symbols, folding, selection ranges, diagnostics, the type layer, hover, definitions, implementations, workspace symbols, completion and the line index that maps offsets to positions. Knows nothing of LSP. |
| `crates/server` (`php-language-server`) | The LSP front end over stdio: documents, incremental sync, workspace folders, background indexing with progress, the requests below, configuration. Library and binary. |

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

- `textDocument/hover`, `textDocument/definition`, `textDocument/typeDefinition`, `textDocument/implementation`, `workspace/symbol`, `textDocument/completion` and `completionItem/resolve`, described under "Phase 1b" below.

### Configuration

Only standard LSP channels are used:

- `initializationOptions`: `{ "phpVersion": "8.4", "storagePath": "/some/folder", "stubsPath": "/some/stubs" }`. `phpVersion` is the language level for a project whose `composer.json` names none. `storagePath` is where the server keeps its cache and the standard library stubs; without it nothing is kept between runs and the stubs are not fetched, so the server then knows the project and nothing of the standard library. `stubsPath` reads a folder of phpstorm-stubs instead of fetching them;
- `workspace/configuration`, when the client supports it: the server asks for the section `phpLanguageServer` with the document as `scopeUri` and reads `{ "phpVersion": "8.4" }`, so a client can answer differently per project or folder;
- `workspace/didChangeConfiguration` with the same object, bare or under `phpLanguageServer`.

The level of a document is the answer for its scope, else the default, else the newest version (8.5).

### Incremental reparse

A change is applied to the text and the whole file is parsed again. That is measured to be faster than anything a patch could save: a typical 54 KB file parses in about 0.5 ms and a 1.4 MB file in about 13 ms, while typing arrives at a fraction of that rate. The server also answers every message already queued before it publishes diagnostics, so a burst of keystrokes costs one parse. Reusing unchanged subtrees of the old green tree is possible later if a profile ever asks for it.

## Phase 1b: the index, types and the features on top

### What the index holds

`php-index` reads every file into a `FileSymbols`: classes, interfaces, traits and enums with their cases, constants, properties (promoted ones and ones with hooks and asymmetric visibility included) and methods, plus functions and constants (`const` and `define()`). A declaration carries its signature, modifiers, attributes, location, the PHPDoc (summary and description, `@param`, `@return`, `@var`, `@throws`, `@deprecated`, `@template` with bounds and defaults, `@extends`, `@implements`, `@use`, `@mixin`, `@property*`, `@method`, `@see`) and its types with every class name already resolved, so a cached entry needs nothing of the file it came from.

- **Sources.** The project's own files (everything under the folder except `vendor/`, `node_modules`, dot folders and generated caches), the installed packages (only the files Composer would load, from the `autoload` of `vendor/composer/installed.json`), and the standard library stubs. A project file wins over a package, and a package over the stubs.
- **Cache.** One file per project under `<storagePath>/cache`, keyed by the path of each source file with its size, modification time and a content hash. A file whose stamp matches is not read; one that was only touched is read and hashed but not parsed. The cache is dropped when the sources that decide what an entry means change (a hash of them is in the header). Declarations are serialized with postcard.
- **Parallel and incremental.** Files are extracted on a rayon pool and reach the server in batches, which reports them as `$/progress` (work done progress, when the client supports it). Open documents are indexed from their text as it changes and win over the disk; `workspace/didChangeWatchedFiles` (registered dynamically for `**/*.php`, `composer.json` and `installed.json`) updates single files, and a change to Composer's files reads the project again. Workspace folders can come and go.
- **Missing classes.** A class the index has not seen is looked up in the PSR-4 and PSR-0 maps and read on demand, for hover and navigation.

Measured on a project with 9,288 PHP files (its own and the packages Composer loads, 9,272 classes) on an Apple M-series laptop with 16 cores, release build:

| | Cold (no cache) | Warm (cache) |
| --- | --- | --- |
| Standard library stubs (547 files, 9 MB) | 170 ms | 25 ms |
| The project | discover 100 ms, index 440 ms | discover 95 ms, index 35 ms |
| Resident memory of the whole process | 450 MB | 310 MB |

`cargo run --release -p php-index --example bench -- <project> <stubs> [cache]` measures this on any project. Single-threaded extraction of all stubs takes about 100 ms (`cargo bench -p php-index`), and adding them to an index 2 ms.

### The standard library stubs

The stubs are JetBrains/phpstorm-stubs (Apache 2.0). They are not in this repository and not in the binary. On first run the server downloads the tarball of one pinned commit (`STUBS_COMMIT` in `crates/index/src/stubs.rs`) into `<storagePath>/stubs/<commit>/`, unpacks only the `.php` files and the `LICENSE`, and marks the folder complete once it is whole, so an interrupted download starts over. A later run reads that folder, and a new pin fetches a new folder. The download runs in the background; until it is done the standard library is simply not offered, and a failure (no network) is logged with `window/logMessage` and leaves the rest working. `stubsPath` points at a folder that already exists, which is what the tests and `scripts/fetch-corpus.sh` use.

The stubs of one extension live in one folder. A project sees the folders of a default set (core, standard, SPL, date, json, pcre, mbstring, curl, PDO, intl and the like) plus every `ext-*` its `composer.json` requires, so `ext-redis` brings in the Redis classes and a project without it does not get them.

### Language level

The level of a project is `config.platform.php` of its `composer.json`, else the lower bound of `require.php` (`^8.1 || ^8.2`, `>=8.1 <8.4`, `~8.1.0`, `8.3.*` and hyphen ranges are read), else the `phpVersion` the client configured, else the newest version. The index filters the stubs by it: `@since` and `@removed` of a declaration, `#[PhpStormStubsElementAvailable(from:, to:)]` on functions, methods, classes and parameters, and `#[LanguageLevelTypeAware([...], default:)]` on return types, properties and parameters, which pick the type of the project's level. An 8.1 project is not offered `array_find` or `Random\Randomizer`. The `@since` of a project's own doc comments means nothing and is ignored there. A level that comes from `composer.json` also decides the syntax diagnostics of that project's files.

### Names

`NameResolver` holds the namespace and the `use` statements (classes, functions and constants, grouped, aliased) at a point of a file. Class names resolve through the imports and the namespace, relative `namespace\Name` and qualified names included; functions and constants try the namespace and then the global namespace. `self`, `static` and `parent` follow the class around the cursor. `ClassDecl`s keep traits with their `insteadof` and `as` rules, and the hierarchy (`Index::ancestors`) walks the class, its traits, its parents, its interfaces and its `@mixin`s in the order PHP looks members up, carrying the template arguments of `@extends Base<Foo>` down the chain.

### The type layer

`php-analysis` infers what a variable or an expression is at a cursor. It follows:

- declared types (unions, intersections, nullable, `static`, `self`) and PHPDoc types: `array<K, V>`, `list<T>`, `T[]`, array shapes, `class-string<T>`, `callable(A): R` and `Closure(A): R`, literals, `int<..>` and the `non-empty-string` family, and conditional types such as `($flag is true ? int : string)`;
- generics: `@template` on classes, methods and functions, bound from the receiver (`Collection<int, User>`) and from the arguments of a call (`make(User::class)` is a `User`, `identity($x)` is the type of `$x`), also for `new`;
- variables: parameters (with `@param` types, defaults of `null`, variadics), assignments, `new`, calls of functions, methods and static methods, property reads, constants and enum cases, array literals and `$a[] = x`, indexing, destructuring and `foreach` over arrays, iterables, `Iterator` and `IteratorAggregate` classes, `catch`, `static` and `global` variables, closures with `use`, arrow functions and inline `/** @var T $x */`;
- flow: branches merge into unions, a branch that ends in `return` or `throw` does not, `instanceof`, `=== null`, `isset`, `is_*` functions, truthiness and `assert` narrow in the branch they hold for and survive an early exit.

It stops at: the return type of a function with no declared or documented one (nothing is inferred from its body, except that a generator is a `Generator`), the element type a closure argument gives a template (`array_map` returns `array`), loops that need a fixed point, references, `list` with references, variable variables and dynamic member names, `__get` and `__call`, PHPDoc type aliases (`@psalm-type`), `key-of`, `value-of` and the other type-level functions, which come out as `mixed`. Where it gives up the type is `mixed` and nothing is offered or reported on it.

### Hover, navigation and symbols

- **Hover** is a title line with the qualified name, a fenced `php` signature (parameters with their types and defaults, modifiers, the return type), the PHPDoc as markdown (the summary, the description, one `_@tag_` line per tag, the HTML some doc comments use turned into markdown, a method without a doc inheriting the one above it) and the file it is defined in (relative to the project, or `PHP standard library (ext)`). It works on classes, functions, constants, members, enum cases and variables (with their inferred type).
- **Definition** goes to the name of a class, function, constant, method, property or class constant, to the use of a variable, and into the stubs as files in the storage folder. **Type definition** goes to the class of a variable, a property or what a method returns. **Implementation** lists the subclasses and implementors of a class or interface, and the overrides of a method.
- **Workspace symbols** match classes, interfaces, traits, enums, functions and constants everywhere, and members of the project's own classes, by prefix, camel humps (`uc` finds `UserController`) and substring, project first.

### Completion

The word being typed is replaced by a placeholder before the text is parsed again, so an unfinished `$user->` is a whole expression to the parser and its tree says which kind of name belongs there. Completion handles:

- members after `->` and `?->` (instance members, by visibility from the class around the cursor), and after `::` (static methods, constants, enum cases, static properties as `$name`, `class`; and, after `parent::`, `self::` and `static::`, the instance methods too);
- classes in expressions, `new` (instantiable ones only, with the constructor's parameters as `detail`), `extends` (not final classes), `implements` (interfaces), trait `use`, `catch` (throwables), `instanceof`, type positions (with the built-in types) and `#[` (classes marked `#[Attribute]`);
- functions and constants, variables in scope with their types (and superglobals), named arguments of the callee, enum cases, and keywords by place (statement, expression, class body, type);
- `use` statements: namespace segments, classes, `use function` and `use const`.

A class that needs an import carries an `additionalTextEdits` entry that inserts the `use` line in sorted order in the right block: the block of the file that shares the root namespace, else the one it sorts into, after an existing group at its end, and for a file without imports after the `namespace` or `declare` line with a blank line around it. A class of the current namespace or one already imported needs nothing, and one whose short name is taken is written in full. Items have a `kind`, `labelDetails.description` with the namespace (the class for a member), `detail` with the signature, a deprecated tag from `@deprecated`, and `completionItem/resolve` adds the same documentation hover shows. No call snippets are inserted: the client adds the parentheses. With nothing typed only variables, keywords and members are offered; at most 300 items come back and `isIncomplete` says when there were more. Comments, strings and inline HTML get nothing.

### Trying it on a real project

```sh
cargo run --release -p php-analysis --example probe -- <project> <stubs> <file> <line> <column> [complete|hover|definition]
cargo bench -p php-index                  # extraction and index building over the stubs
cargo bench -p php-analysis               # completion and hover over the stubs
```

## Build, test and run

```sh
cargo build --release --locked            # target/release/php-language-server
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

The default test run needs no network and no PHP. It holds, per construct, snapshot tests of the tree in a compact text form (`expect-test`: `UPDATE_EXPECT=1 cargo test` rewrites them), error recovery tests, a round trip test (the text of the tree equals the input for every prefix of a sample file and after every single edit), tests of the language level table, and, for phase 1b, tests of the PHPDoc and type grammar, name resolution, the extractor, Composer metadata, the cache and the parallel indexer (on temporary folders), the hierarchy, type inference cases, completion at about thirty cursor positions over fixture projects (with a fake package and stubs), the placement of `use` lines, hover snapshots, navigation, and end-to-end tests of the server over an in-memory connection against a project on disk with Composer metadata, a vendor package, stubs and a cache (progress, the cache on a second run, completion with an import, level filtering of stubs, hover and definition across files, watched files, open documents over the disk). Tests that read the real stubs use the corpus below and report that they skipped when it is not there.

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

1. **Phase 1a (done):** parser, lossless tree, error recovery, language level table and gate, a server with diagnostics, symbols, folding and selection ranges.
2. **Phase 1b, index and completion (done):** the index, the cache, Composer, the language level per project, name resolution, the type layer, hover, definition, type definition, implementation, workspace symbols and completion with auto-import, as described above.
3. **Phase 2, references and rename:** find usages (the index has declarations, not yet usages, so this needs a reference index per file), rename across files, document highlights, signature help, call hierarchy and type hierarchy, completion of overridable methods, and the open points of phase 1b: the types a closure argument gives a template, return types inferred from function bodies, the doc and attribute formats of Laravel and Symfony macros, `@psalm-type` aliases, a cheaper memory footprint for large vendor trees (descriptions are kept as text, interning would help), and an on-disk index that can be read without loading everything.
4. **Phase 3, inspections and fixes:** type-aware diagnostics in the spirit of PHPStan and Psalm, with quick fixes and code actions, formatting, inlay hints and semantic tokens.
5. **Phase 4, refactors:** extract, inline, move, change signature, built on the lossless tree so formatting and comments survive.
6. **Phase 5, frameworks:** Composer autoload maps, Laravel, Symfony and similar conventions.
