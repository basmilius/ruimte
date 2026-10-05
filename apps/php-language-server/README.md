# php-language-server

A language server for PHP, written in Rust. It reads PHP 8.1 through 8.5 with a parser of its own that keeps every byte of a file, comments and whitespace included, and that goes on past a syntax error instead of stopping at it. The aim is the insight a full PHP IDE gives (navigation, completion, rename, inspections, refactors) as a server any editor can talk to over LSP.

Phase 1a is the parser, the syntax tree and a small server on top of it. Phase 1b adds an index of the project, its Composer packages and the standard library, a type layer, and hover, navigation, workspace symbols and completion with auto-import on top of that. Phase 2 adds find usages, rename, highlights, signature help, call and type hierarchies, semantic tokens, inlay hints and completion of overridable methods, and keeps the declarations of packages in the cache file until something needs them. Phase 3 adds inspections, quick fixes and code actions, and a formatter.

## Where the code comes from

Everything here is written from scratch. The sources it is allowed to learn from are:

- the PHP language reference and grammar (php.net, the grammar in php-src) and php-src's own tests for the cases the grammar leaves open;
- the open source IntelliJ Platform (Apache 2.0) for general ideas such as lossless trees and error recovery;
- JetBrains/phpstorm-stubs (Apache 2.0), as a corpus the parser must read without errors now and as the description of the standard library later;
- PHPStan and Psalm (MIT) for type rules, later;
- watching what an installed IDE does with a piece of code.

Nothing was taken from the bytecode or the decompiled classes of any IDE plugin, and no code was copied from another product. Crates under MIT, Apache or BSD licenses are used freely. The corpora are fetched by a script into a folder git ignores, so none of that material is part of this repository and there is no NOTICE to carry.

## Layout

A Cargo workspace with five crates.

| Crate | Holds |
| --- | --- |
| `crates/syntax` (`php-syntax`) | The lexer, the parser, the tree (on `rowan`), the language level table and the pass that checks a tree against a level. |
| `crates/format` (`php-format`) | The formatter: it reads a tree and decides the whitespace between tokens, and nothing else. Knows nothing of LSP. |
| `crates/index` (`php-index`) | The declarations of a file with their PHPDoc, name resolution, PHPDoc types, Composer metadata, the stubs of the standard library, the persistent cache and the stores that read declarations back from it, the parallel indexer, the class hierarchy and the word index that narrows a search to the files that may hold a name. Knows nothing of LSP. |
| `crates/analysis` (`php-analysis`) | Questions about a tree and an index: document symbols, folding, selection ranges, diagnostics, the type layer, hover, definitions, implementations, workspace symbols, completion, usages, highlights, rename, signature help, hierarchies, semantic tokens, inlay hints and the line index that maps offsets to positions. Knows nothing of LSP. |
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

- `textDocument/hover`, `textDocument/definition`, `textDocument/typeDefinition`, `textDocument/implementation`, `workspace/symbol`, `textDocument/completion` and `completionItem/resolve`, described under "Phase 1b" below;
- `textDocument/references`, `textDocument/documentHighlight`, `textDocument/prepareRename`, `textDocument/rename`, `textDocument/signatureHelp`, `textDocument/prepareCallHierarchy` with `callHierarchy/incomingCalls` and `callHierarchy/outgoingCalls`, `textDocument/prepareTypeHierarchy` with `typeHierarchy/supertypes` and `typeHierarchy/subtypes`, `textDocument/semanticTokens/full` and `/range`, and `textDocument/inlayHint`, described under "Phase 2" below.

### Configuration

Only standard LSP channels are used:

- `initializationOptions`: `{ "phpVersion": "8.4", "storagePath": "/some/folder", "stubsPath": "/some/stubs", "inlayHints": { "parameterNames": true, "closureTypes": true } }`. `phpVersion` is the language level for a project whose `composer.json` names none. `storagePath` is where the server keeps its cache and the standard library stubs; without it nothing is kept between runs and the stubs are not fetched, so the server then knows the project and nothing of the standard library. `stubsPath` reads a folder of phpstorm-stubs instead of fetching them; `inlayHints` switches the two kinds of inlay hint, both on by default;
- `workspace/configuration`, when the client supports it: the server asks for the section `phpLanguageServer` with the document as `scopeUri` and reads `{ "phpVersion": "8.4", "inlayHints": { ... }, "inspections": { ... }, "format": { ... } }`, so a client can answer differently per project or folder;
- `workspace/didChangeConfiguration` with the same object, bare or under `phpLanguageServer`.

The level of a document is the answer for its scope, else the default, else the newest version (8.5).

### Incremental reparse

A change is applied to the text and the whole file is parsed again. That is measured to be faster than anything a patch could save: a typical 54 KB file parses in about 0.5 ms and a 1.4 MB file in about 13 ms, while typing arrives at a fraction of that rate. The server also answers every message already queued before it publishes diagnostics, so a burst of keystrokes costs one parse. Reusing unchanged subtrees of the old green tree is possible later if a profile ever asks for it.

## Phase 1b: the index, types and the features on top

### What the index holds

`php-index` reads every file into a `FileSymbols`: classes, interfaces, traits and enums with their cases, constants, properties (promoted ones and ones with hooks and asymmetric visibility included) and methods, plus functions and constants (`const` and `define()`). A declaration carries its signature, modifiers, attributes, location, the PHPDoc (summary and description, `@param`, `@return`, `@var`, `@throws`, `@deprecated`, `@template` with bounds and defaults, `@extends`, `@implements`, `@use`, `@mixin`, `@property*`, `@method`, `@see`) and its types with every class name already resolved, so a cached entry needs nothing of the file it came from.

- **Sources.** The project's own files (everything under the folder except `vendor/`, `node_modules`, dot folders and generated caches), the installed packages (only the files Composer would load, from the `autoload` of `vendor/composer/installed.json`), and the standard library stubs. A project file wins over a package, and a package over the stubs.
- **Cache.** One file per project under `<storagePath>/cache`, keyed by the path of each source file with its size, modification time and a content hash. A file whose stamp matches is not read; one that was only touched is read and hashed but not parsed. The cache is dropped when the sources that decide what an entry means change (a hash of them is in the header). Its layout is described under "Memory" in the phase 2 section.
- **Parallel and incremental.** Files are extracted on a rayon pool and reach the server in batches, which reports them as `$/progress` (work done progress, when the client supports it). Open documents are indexed from their text as it changes and win over the disk; `workspace/didChangeWatchedFiles` (registered dynamically for `**/*.php`, `composer.json` and `installed.json`) updates single files, and a change to Composer's files reads the project again. Workspace folders can come and go.
- **Missing classes.** A class the index has not seen is looked up in the PSR-4 and PSR-0 maps and read on demand, for hover and navigation.

- **Composer projects below the workspace folder.** A workspace folder that has no `composer.json` of its own (a repository with `backend/`, `frontend/` and `shop/` next to each other) is searched up to four folders deep for `composer.json` files, skipping `vendor`, `node_modules`, dot folders and folders starting with `~` (backups). Each one found is a project of its own, with the packages in its own `vendor/`, its own autoload maps, language level, stub extensions and cache file. A file belongs to the project with the deepest root above it, so hover, navigation and completion in `backend/` only see what `backend/` installs, even when `shop/` installs another version of the same package. The folder's own project reads the files that are in no composer project and skips the ones that are. A workspace folder that has a `composer.json` is one project, as before, whatever lies below it, which keeps a monorepo of packages visible to itself. `workspace/symbol` asks every project and lists a package or standard library symbol once, whichever project reported it first; symbols of the project's own files are listed for every project that has them. A `composer.json` that appears or disappears below the folder adds or drops a project, and one that changes reads that project again.

Measured on a project with 9,288 PHP files (its own and the packages Composer loads, 9,272 classes) on an Apple M-series laptop with 16 cores, release build:

| | Cold (no cache) | Warm (cache) |
| --- | --- | --- |
| Standard library stubs (547 files, 9 MB) | 140 ms | 8 ms |
| The project | discover 100 ms, index 340 ms | discover 90 ms, index 11 ms |
| Resident memory of the whole server after indexing | 125 MB | 35 MB |
| ... after a find usages, a workspace symbol search, completion and semantic tokens | 130 MB | 45 MB |

Before phase 2 the whole process held 440 MB cold and 310 MB warm, since every declaration of every package sat in memory. The numbers above are `scripts/measure-memory.py` on a real server, the ones of the bench example are in the next paragraph.

`cargo run --release -p php-index --example bench -- <project> <stubs> [cache]` measures the indexing on any project and prints the resident size. Single-threaded extraction of all stubs takes about 100 ms (`cargo bench -p php-index`), and adding them to an index 2 ms.

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

## Phase 2: usages, rename, hierarchies, signatures, tokens and hints

### Names and their usages

A name in a file resolves to a `Symbol` through the same resolution and type layer hover uses: a class, function or constant by its qualified name, a method, property or class constant by the class that declares it, a parameter by the function that owns it, and a local variable by the function or file it lives in. Several declarations are one symbol when they are one thing: a method is one with the methods it overrides and implements, in both directions (an interface method, its implementations, and the classes below them), and a property or class constant works the same way. A private member and a constructor are their own. A promoted constructor parameter is a variable, a parameter and a property at once, so its usages are the variable inside the constructor, the named arguments of `new` and every `$object->name`.

What counts as a usage: a class in every type and expression position (types, `new`, `extends`, `implements`, `instanceof`, `catch`, `Foo::class`, static access, attributes, trait `use` and its `insteadof` and `as` rules), `use` statements and group uses, functions and constants, methods (also through `static::`, `self::`, `parent::`, first-class callables and `?->`), properties (also written as `Foo::$name`), class constants and enum cases, variables with their closures and arrow functions, parameters through their named arguments, and PHPDoc: the classes in the types of every tag, `@param` and `@var` variables, `@property` and `@method` declarations, `@template` names, and the targets of `@see` and `{@see}`. A constructor also counts the `new` that calls it, also for a class below it that has no constructor of its own. A class imported under an alias counts where the alias is written.

How it is found: `php-index` keeps, per file of the project, the sorted hashes of the words in it (`words.rs`), built the first time something asks and kept current from then on (open documents, watched files). A search reads only the files whose words contain the name, in parallel, and resolves the names in them against the index, so a result is never stale when a file elsewhere changed. Open documents are searched as they are in the editor. The resolved references are not stored. In the 798 own files of the project above, finding the 321 usages of a class in 68 files takes 60 ms in the probe (the words took 80 ms the first time) and 25 ms through the server, and a method used in five places takes 2 ms.

Limits: only the project's own files are searched, not the installed packages. A usage whose receiver the type layer cannot name (`mixed`, a dynamic member name, `__get` and `__call`) is not found, and neither is a name inside a string (`'App\Foo'`, `[$this, 'run']`, `compact('x')`). `$$name` and `${name}` are not variables here. A usage in a file that is not on disk and not open is not seen.

`textDocument/documentHighlight` marks the same places inside the open file. Variables and properties and class constants say read or write (an assignment, a compound assignment, `++`, `unset`, a `foreach` target, a destructuring and a by-reference `use` count as writes), the rest says text.

### Rename

`prepareRename` answers the range and the name of what is under the cursor, or says why not: a keyword (`self`, `static`, `parent`, `$this`), a name declared in an installed package or the standard library, a magic method, a name the index does not know. `rename` returns a workspace edit, as `documentChanges` when the client sends them and as `changes` otherwise. It renames:

- classes, interfaces, traits and enums, with their `use` imports (the imported name only, so `use A\B as C` becomes `use A\X as C` and `C` stays), the names in doc comments and the attributes. A class written under an alias keeps the alias. When the file carries the class's name, is the only class in it, and Composer's autoload map agrees that the class lives there, the file is renamed too, as a `RenameFile` after the text edits and only when the client announces resource operations;
- methods with their overrides, implementations and callers, properties with their `@property` lines, promoted parameters and named arguments, class constants and enum cases, functions and constants with their `use function` and `use const` imports;
- variables and parameters inside their scope (a `use ($x)` of a closure and the `$x` of an arrow function follow), with the `@param` and inline `@var` of the doc comments, and the named arguments at the call sites;
- a namespace, from its `namespace` statement: every file with that exact namespace, every `use` of a name in it, group use prefixes and fully qualified names. Names written relative to another namespace are left, and so are sub-namespaces and Composer's `autoload` section.

A new name is checked: it has to be an identifier (a namespace may have backslashes), a class, function or constant may not be a reserved word, a type name or a keyword, a method or property may be named after a keyword, a class constant may not be `class`, a variable may not be `this` or a superglobal. Names that are taken are refused with the place: a method, property or constant of the same name anywhere in the hierarchy, a class or function of that name, a variable in the same scope, a class another class of the same file already imports under that name. The error goes back as a failed request with the message.

Strings and ordinary comments are not changed, and the server says so in a `window/logMessage` with every rename.

### Signature help

`textDocument/signatureHelp` finds the argument list around the cursor (also one that is not closed yet), resolves the callee (functions, methods, static methods, constructors with `new`, attributes, closures with a documented signature) and answers each way the callee can be called: a function or method that is declared more than once, as the stubs do for functions that can be called in different ways, has one signature per declaration that exists at the project's language level. Variants the stubs spell with `#[PhpStormStubsElementAvailable]` are one signature at the level of the project, as before. The active signature is the first that fits the arguments typed so far, the active parameter follows the commas, a variadic parameter takes every extra argument, and a named argument selects the parameter of that name. A signature has the native types of the declaration, the doc comment's summary and description, and each parameter's `@param` text.

### Call hierarchy and type hierarchy

`prepareCallHierarchy` takes a function or method at a declaration or a usage. Incoming calls are the usages of the symbol (so the callers of an interface method include the calls through its implementations, and the `new` of a constructor), grouped by the function or method they sit in; code outside any function is one item for the file. Outgoing calls walk the body, resolve every call and `new` with the type layer and group them by callee, with the called names as ranges. A closure's calls belong to the function around it.

`prepareTypeHierarchy` takes a class at a declaration or a usage. Supertypes are the parent class, the interfaces and the traits it uses, subtypes are the classes that extend, implement or use it directly. `lsp-types` has no field for the capability yet, so `typeHierarchyProvider` is added to the `initialize` answer by hand.

### Semantic tokens

`textDocument/semanticTokens/full` and `/range`. Keywords, strings, numbers and comments are left to the editor's grammar. The legend:

| Types | `namespace`, `class`, `interface`, `enum`, `struct` (traits), `typeParameter` (`@template` names), `parameter`, `variable`, `property`, `enumMember`, `function`, `method`, `keyword` (doc tags) |
| --- | --- |
| Modifiers | `declaration`, `readonly`, `static`, `deprecated`, `abstract`, `defaultLibrary` (the standard library), `documentation` (inside a doc comment) |

Classes and the like come from the index (a name it does not know is a plain `class`), constants are `variable` with `readonly`, class constants are `property` with `readonly` and `static`, and the declaration of a name carries `declaration`. A variable is a `parameter` when the function it lives in declares it as one. A qualified name is a `namespace` token for its prefix and the type for its last segment. In doc comments the tags, the classes of the types, the variables, the `@property` and `@method` names, `@see` targets and templates get tokens with `documentation`. A 5,000 line file takes about 60 ms and a typical one 5 to 20 ms. The server asks the client to refresh the tokens when the index changed (`workspace/semanticTokens/refresh`).

### Inlay hints

`textDocument/inlayHint` for a range, with two kinds:

- **Parameter names** in front of positional arguments, as `name:`. They are left out when the argument already says it: a variable, property, constant or call named like the parameter (`$user_id` for `$userId`, `$this->name`, `getName()`), a parameter with a one letter name or one that starts with an underscore, a function that takes one argument unless the argument is a bare `true`, `false` or `null`, an argument after a named or spread one, and the arguments of a variadic parameter. Accepting a hint inserts `name: `. These rules follow the common ones of editors built on the IntelliJ Platform, from what the platform itself documents; the PHP plugin's own rules were not available to compare, so expect small differences.
- **Closure parameter types** for a closure or arrow function whose parameter has no type, from the `callable(User): bool` or `Closure(...)` that the function being called declares for it, with the templates of the call bound. A type that is only built-in types can be accepted and inserts `type `.

### Completion of overridable methods

After `function ` in a class, enum or trait body, completion offers the methods of the parents, interfaces and abstract traits that the class does not declare yet and that are neither private nor final, with what must be implemented first. The inserted text is the whole method: the name, parameters with native types, defaults, by-reference and variadic markers, the return type, and a body in the indentation of the line (`return parent::name($a);` for a method that has a body above, an empty body for an abstract or interface method, a semicolon after `abstract`). Classes in the signature come with their `use` imports, a missing visibility (and `static`) is added in front of the declaration, and when the parentheses are already typed only the name is completed.

### Memory

The cache file (`<storagePath>/cache/project-<key>.bin`) has a header, an index and the declarations of every file one after the other. The index has, per file, its path, its stamp and hash, the place of its declarations and a summary: the names of its classes (with kind, abstract and deprecated flags, the level they exist at and the classes they extend, implement or use), functions and constants. A warm start reads only the index, which is what the server needs to find a class by name, to list names for completion and workspace symbols, and to know what stands below a class. The declarations of a file are read from the cache file the first time something asks for them (a lookup of one of its classes, a hover, a rename) and stay in memory while they are in use. The server lets go of the ones used longest ago when more than 1,500 are loaded, checked every three seconds, and reads them again when asked. Files that are open, files that changed since the last run, and projects without a storage folder keep their declarations in memory as before. A file whose declarations cannot be read from the cache any more is read from its source, and a class found at a place that no longer holds it (the file changed since it was indexed) is not returned.

On the first run the declarations of a file are not kept at all: the file is read again when something asks, until the cache file is written, and then every file is read from there. The old cache file is released when the new one replaces it.

Open documents keep their syntax tree, and no other tree is kept. Strings are not interned: after this change the declarations that stay resident are a few names per class, which is small next to what was dropped (the signatures, types and doc comments of 9,000 files).

`cargo run --release -p php-index --example bench` prints the resident size next to the indexing times, and `scripts/measure-memory.py` starts the real server on a project and prints it after indexing and after a few requests.

### Trying it on a real project

```sh
cargo run --release -p php-analysis --example probe -- <project> <stubs> <file> <line> <column> [complete|hover|definition|references|rename:<name>|tokens]
cargo run --release -p php-analysis --example stress -- <project> <stubs> [limit]   # every analysis at every name, looking for panics
cargo bench -p php-index                  # extraction and index building over the stubs
cargo bench -p php-analysis               # completion and hover over the stubs
cargo bench -p php-analysis --bench features   # tokens, hints, signature help, usages and rename
```

## Phase 3: inspections, fixes and formatting

### Inspections

Diagnostics from the index and the type layer, in the spirit of PHPStan and Psalm, are published next to the syntax errors and language level findings. Each has a code, a default severity and a default state, and every one can be switched off or given another severity with the `inspections` key of the configuration:

```json
{ "inspections": { "unused-import": "off", "undefined-class": "warning", "deprecated": { "severity": "hint" }, "missing-strict-types": true } }
```

A value is `true` or `false`, a severity (`error`, `warning`, `information`, `hint`, or `off`), or an object with `enabled` and `severity`.

| Group | Codes |
| --- | --- |
| Names | `undefined-class`, `undefined-function`, `undefined-constant`, `undefined-class-constant`, `undefined-method`, `undefined-property`, `undefined-variable`, `undefined-named-argument`, `this-in-static-context` |
| Unused code | `unused-import`, `unused-private-method`, `unused-private-property`, `unused-private-constant`, `unused-variable`, `unused-parameter`, `unreachable-code` |
| Calls and types | `wrong-argument-count`, `argument-type-mismatch`, `return-type-mismatch`, `missing-return`, `incompatible-comparison`, `assignment-in-condition`, `deprecated`, `static-call-of-instance-method`, `instance-call-of-static-method` |
| Classes | `abstract-method-not-implemented`, `interface-method-not-implemented`, `incompatible-override`, `readonly-reassigned`, `enum-misuse` |
| PHPDoc and style | `phpdoc-unknown-parameter`, `phpdoc-type-mismatch`, `missing-strict-types` (off by default) |

The inspections report only what is certain. A name is undefined only after the project, its packages and the standard library of the extensions it requires have all been read, and a call is not checked when it reaches the callee through `__call`, which is how a method lent by a `@mixin` is called. `cargo run --release -p php-analysis --example survey -- <project> <stubs> [--all]` runs every inspection over a project and counts what they report, to find the ones that are wrong on code that is right. Over the 798 PHP files of a real project it takes about 3.7 s and reports 66 findings with the default set, none of them wrong when read by hand. The first run reported 68: a call through a `@mixin` and the classes Composer writes into `vendor/composer` were wrong, and both are fixed.

### Quick fixes and code actions

`textDocument/codeAction` offers, with the edits sent along or resolved on demand (`codeAction/resolve`):

- quick fixes: import a class, function or constant, or write its name in full; remove an unused import, declaration or variable (keeping the call when the assignment has a side effect); remove unreachable code; replace `=` with `===` in a condition; remove a `@param` of a parameter that does not exist; implement the missing methods of an abstract class or interface; create a missing method or property; add `declare(strict_types=1)`; make a member public, protected or private where an override needs it;
- intentions: add or update a PHPDoc, add a return type from what the body returns, change the visibility of a member, make a property readonly, convert a constructor and its properties to constructor property promotion;
- `source.organizeImports`.

`textDocument/onTypeFormatting` also writes the doc block after `/**` and Enter, with a `@param` per parameter and the `@return`.

### Formatting

`textDocument/formatting`, `textDocument/rangeFormatting` and `textDocument/onTypeFormatting` (on `}`, `;` and a new line) are answered by `php-format`. The defaults are PER Coding Style 2.0, and the indent follows the `FormattingOptions` the client sends.

The formatter moves whitespace and nothing else. It decides the text between two tokens with a rule per pair of neighbors, writes the indentation from the brackets and unfinished statements around a line, and keeps the line breaks the code has where PER has no opinion (arguments, chains, array items), with at most one blank line in a row. Four things follow from that:

- **Lossless.** Comments, strings and heredocs are never touched, apart from the indentation of the later lines of a block comment, which moves with its first line. Before an edit is sent the result is parsed again and compared with the original token by token, and a text whose tokens would differ is left as it is.
- **Idempotent.** The second pass over a formatted text changes nothing. This holds because every decision is made from the structure of the tree and the line breaks that are there, never from the columns of the old layout.
- **Safe on what it cannot read.** A text with syntax errors or with markup around its PHP is not formatted, and `textDocument/formatting` answers `null`. `onTypeFormatting` does lay out unfinished code (a new line gets the indentation of the open brackets above it), since that is when it is asked.
- **Range formatting follows the whole file.** The layout is worked out for the whole text and only the edits in the lines asked for are sent, so a line comes out as it would in a full format.

What PER decides is applied: one blank line between header blocks (`declare`, `namespace`, the `use` block) and between top-level declarations, methods separated by a blank line, the brace of a class or method on its own line, `{}` for an empty body, and `) {` together on one line after a parameter list that runs over several lines. A blank line at the start or end of a class body is kept; one at the start or end of a function or control structure body is removed. The spacing of casts (`(int)$x` or `(int) $x`) is left as written, since the specification does not say.

The options come from the `format` key of the configuration, besides the indent that the client sends:

| Key | Values | Default |
| --- | --- | --- |
| `classBrace` | `nextLine`, `sameLine` | `nextLine` |
| `functionBrace` | `nextLine`, `sameLine` | `nextLine` |
| `blankLinesBetweenMembers` | a number, the blank lines around a method | `1` |
| `alignAssignments` | pad the `=` of assignment statements on consecutive lines to one column | `false` |
| `alignArrayArrows` | pad the `=>` of array items on consecutive lines to one column | `false` |
| `lineLength` | an argument or parameter list on a line longer than this is put on lines of its own, one item per line, without adding a trailing comma; `0` never wraps | `120` |

Held to the corpora (`cargo run --release -p php-format --example check -- <folder>... [--tabs --wrap --align]`): every PHP file of phpstorm-stubs, the files of a real project and the `--FILE--` sections of 6,180 php-src tests keep their tokens and format the same twice, with the defaults and with tabs, a line length of 80 and alignment all on. A test in the default run does the same over the stubs when they are fetched.

## Build, test and run

```sh
cargo build --release --locked            # target/release/php-language-server
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

The default test run needs no network and no PHP. It holds, per construct, snapshot tests of the tree in a compact text form (`expect-test`: `UPDATE_EXPECT=1 cargo test` rewrites them), error recovery tests, a round trip test (the text of the tree equals the input for every prefix of a sample file and after every single edit), tests of the language level table, and, for phase 1b, tests of the PHPDoc and type grammar, name resolution, the extractor, Composer metadata, the cache and the parallel indexer (on temporary folders), the hierarchy, type inference cases, completion at about thirty cursor positions over fixture projects (with a fake package and stubs), the placement of `use` lines, hover snapshots, navigation, and end-to-end tests of the server over an in-memory connection against a project on disk with Composer metadata, a vendor package, stubs and a cache (progress, the cache on a second run, completion with an import, level filtering of stubs, hover and definition across files, watched files, open documents over the disk). For phase 2 it adds the doc comment scanner, usages over fixture projects (a class with its imports and aliases, a method across its hierarchy, a promoted property with named arguments, variables with closures, strings, enums and traits, reads and writes), rename (a class with its file, a method across a hierarchy, a promoted property, parameters with docs, namespaces, name validation and conflicts), signature help with overloads, named arguments and variadics, call and type hierarchies, snapshots of semantic tokens and inlay hints, overridable method completion, the cache file and the lazy loading and trimming of declarations, and end-to-end tests of every new request over the in-memory connection. Tests that read the real stubs use the corpus below and report that they skipped when it is not there.

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
3. **Phase 2, usages, rename and editing aids (done):** find usages, document highlights, rename, signature help, call and type hierarchies, semantic tokens, inlay hints, completion of overridable methods and a cache that keeps declarations on disk, as described above.
4. **Phase 3, inspections, fixes and formatting (done):** the inspections, quick fixes, code actions and the formatter described above. Still open from phase 1b: the types a closure argument gives a template (`array_map` still returns `array`), return types inferred from function bodies, the doc and attribute formats of Laravel and Symfony macros and `@psalm-type` aliases. Also usages in the installed packages, usages found through a reference index that is kept on disk, and interned strings if the memory of the summaries ever matters.
5. **Phase 4, refactors:** extract variable, constant, method and parameter, inline variable and method, move a class to another namespace or folder with its file and every reference, change signature, pull up and push down members, introduce a type or an interface from a class, each as a `WorkspaceEdit` built on the lossless tree and followed by the formatter on the lines it touched, so comments and layout survive. Rename gains the same preview and file moves for namespaces. Formatting gains wrapping of binary chains, arrays, ternaries and method chains, and `.editorconfig` as a source of the indent and line length.
6. **Phase 5, frameworks:** Composer autoload maps beyond PSR-4 and PSR-0 (classmap authoritative, `files`), then conventions that need more than types. Laravel: Eloquent attributes, relations and scopes, facades and their real classes, route, view, config and translation names, `Collection` and builder generics. Symfony: service ids and the container, route names, Twig templates, Doctrine entities and DQL, attributes such as `#[Route]` and `#[AsCommand]`. PHPUnit and Pest: test and dataset navigation, `$this` in Pest closures, `expect()` chains and their mixins, running a test from a code lens.
