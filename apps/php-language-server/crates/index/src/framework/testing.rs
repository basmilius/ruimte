//! Fixtures for the framework tests: an index of files held in memory.

use std::path::PathBuf;
use std::sync::Arc;

use php_syntax::{PhpVersion, parse};

use super::Frameworks;
use crate::extract::{ExtractOptions, extract};
use crate::index::{Index, Origin};

pub const ROOT: &str = "/project";

/// An index of files given as paths below the project and their text. A path starting with `vendor/`
/// is a package's. Every framework is on.
pub fn project(files: &[(&str, &str)]) -> Index {
    let mut index = Index::new(PhpVersion::V8_4);
    index.set_frameworks(std::path::Path::new(ROOT), Frameworks::all());
    for (relative, text) in files {
        add(&mut index, relative, text);
    }
    index
}

pub fn add(index: &mut Index, relative: &str, text: &str) {
    let path = PathBuf::from(ROOT).join(relative);
    let origin = if relative.starts_with("vendor/") {
        Origin::Vendor
    } else {
        Origin::Project
    };
    index.set_open_text(&path, Some(Arc::from(text)));
    if relative.ends_with(".php") {
        let symbols = extract(&parse(text).syntax(), ExtractOptions::default());
        index.set_file(path, origin, Arc::new(symbols));
    }
}

/// Enough of Eloquent, with the docblocks the framework writes, for models to be typed.
pub const ELOQUENT: &[(&str, &str)] = &[
    (
        "vendor/laravel/Model.php",
        r#"<?php
namespace Illuminate\Database\Eloquent;
use Illuminate\Database\Eloquent\Concerns\HasRelationships;
abstract class Model {
    use HasRelationships;
    /** @return \Illuminate\Database\Eloquent\Builder<static> */
    public static function query() {}
    /** @return \Illuminate\Database\Eloquent\Builder<static> */
    public function newQuery() {}
    public function save(array $options = []): bool {}
    public function __call($method, $parameters) {}
    public static function __callStatic($method, $parameters) {}
    public function __get($key) {}
}
"#,
    ),
    (
        "vendor/laravel/Builder.php",
        r#"<?php
namespace Illuminate\Database\Eloquent;
/**
 * @template TModel of \Illuminate\Database\Eloquent\Model
 * @mixin \Illuminate\Database\Query\Builder
 */
class Builder {
    /** @return $this */
    public function where($column, $operator = null, $value = null, $boolean = 'and') {}
    /** @return TModel|null */
    public function first($columns = ['*']) {}
    /** @return \Illuminate\Database\Eloquent\Collection<int, TModel> */
    public function get($columns = ['*']) {}
    /** @return TModel */
    public function create(array $attributes = []) {}
}
"#,
    ),
    (
        "vendor/laravel/QueryBuilder.php",
        "<?php namespace Illuminate\\Database\\Query; class Builder { /** @return $this */ public function orderBy($column) {} public function count(): int {} }",
    ),
    (
        "vendor/laravel/Collection.php",
        r#"<?php
namespace Illuminate\Database\Eloquent;
/**
 * @template TKey of array-key
 * @template TModel of \Illuminate\Database\Eloquent\Model
 * @extends \Illuminate\Support\Collection<TKey, TModel>
 */
class Collection extends \Illuminate\Support\Collection {}
"#,
    ),
    (
        "vendor/laravel/SupportCollection.php",
        r#"<?php
namespace Illuminate\Support;
/**
 * @template TKey of array-key
 * @template-covariant TValue
 */
class Collection {
    /** @return TValue|null */
    public function first() {}
    /**
     * @param callable(TValue, TKey): mixed $callback
     * @return $this
     */
    public function each(callable $callback) {}
}
"#,
    ),
    (
        "vendor/laravel/Carbon.php",
        "<?php namespace Illuminate\\Support; class Carbon { public function format(string $format): string {} }",
    ),
    (
        "vendor/laravel/HasRelationships.php",
        r#"<?php
namespace Illuminate\Database\Eloquent\Concerns;
trait HasRelationships {
    /**
     * @template TRelatedModel of \Illuminate\Database\Eloquent\Model
     * @param  class-string<TRelatedModel>  $related
     * @return \Illuminate\Database\Eloquent\Relations\HasMany<TRelatedModel, $this>
     */
    public function hasMany($related, $foreignKey = null, $localKey = null) {}
    /**
     * @template TRelatedModel of \Illuminate\Database\Eloquent\Model
     * @param  class-string<TRelatedModel>  $related
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo<TRelatedModel, $this>
     */
    public function belongsTo($related, $foreignKey = null, $ownerKey = null, $relation = null) {}
}
"#,
    ),
    (
        "vendor/laravel/Relation.php",
        r#"<?php
namespace Illuminate\Database\Eloquent\Relations;
/**
 * @template TRelatedModel of \Illuminate\Database\Eloquent\Model
 * @template TDeclaringModel of \Illuminate\Database\Eloquent\Model
 * @template TResult
 * @mixin \Illuminate\Database\Eloquent\Builder<TRelatedModel>
 */
abstract class Relation {
    /** @return TResult */
    abstract public function getResults();
}
"#,
    ),
    (
        "vendor/laravel/HasMany.php",
        r#"<?php
namespace Illuminate\Database\Eloquent\Relations;
/**
 * @template TRelatedModel of \Illuminate\Database\Eloquent\Model
 * @template TDeclaringModel of \Illuminate\Database\Eloquent\Model
 * @extends Relation<TRelatedModel, TDeclaringModel, \Illuminate\Database\Eloquent\Collection<int, TRelatedModel>>
 */
class HasMany extends Relation { /** @inheritDoc */ public function getResults() {} }
"#,
    ),
    (
        "vendor/laravel/BelongsTo.php",
        r#"<?php
namespace Illuminate\Database\Eloquent\Relations;
/**
 * @template TRelatedModel of \Illuminate\Database\Eloquent\Model
 * @template TDeclaringModel of \Illuminate\Database\Eloquent\Model
 * @extends Relation<TRelatedModel, TDeclaringModel, ?TRelatedModel>
 */
class BelongsTo extends Relation { /** @inheritDoc */ public function getResults() {} }
"#,
    ),
    (
        "vendor/laravel/Attribute.php",
        "<?php namespace Illuminate\\Database\\Eloquent\\Casts; class Attribute { public static function make(?callable $get = null, ?callable $set = null): static {} }",
    ),
    (
        "vendor/laravel/CastsAttributes.php",
        "<?php namespace Illuminate\\Contracts\\Database\\Eloquent; /** @template TGet @template TSet */ interface CastsAttributes { /** @return TGet|null */ public function get($model, string $key, mixed $value, array $attributes); }",
    ),
    (
        "vendor/laravel/SoftDeletes.php",
        "<?php namespace Illuminate\\Database\\Eloquent;\n/** @method static \\Illuminate\\Database\\Eloquent\\Builder<static> withTrashed(bool $withTrashed = true) */\ntrait SoftDeletes {}",
    ),
    (
        "vendor/laravel/ScopeAttribute.php",
        "<?php namespace Illuminate\\Database\\Eloquent\\Attributes; #[\\Attribute] class Scope {}",
    ),
];
