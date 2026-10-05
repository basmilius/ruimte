<?php
// What Laravel does at run time that no docblock of the framework says. This file is read by the
// server and never run: the tags on a method are the data.
//
// Schema builder, read from migrations to know the columns of a table:
//   @column <type>          the column named by the first argument, or by the default of `$column`;
//                           a `?` before the type makes it nullable
//   @columns n:type ...     fixed columns the method adds
//   @morphs <idtype>        `<name>_type` and `<name>_id`, `?` when nullable
//   @foreign-for            `<snake model>_id` for the model named by the first argument
//   @drop                   the columns named by the arguments (a list or several), else the default of `$column`
//   @drops n n ...          fixed columns the method removes
//   @rename                 the column named by the first argument becomes the second
// Types: int, string, bool, float, array, datetime, mixed.

namespace Illuminate\Database\Schema;

class Blueprint
{
    /** @column int */
    public function id($column = 'id') {}
    /** @column int */
    public function increments($column) {}
    /** @column int */
    public function integerIncrements($column) {}
    /** @column int */
    public function tinyIncrements($column) {}
    /** @column int */
    public function smallIncrements($column) {}
    /** @column int */
    public function mediumIncrements($column) {}
    /** @column int */
    public function bigIncrements($column) {}
    /** @column string */
    public function char($column, $length = null) {}
    /** @column string */
    public function string($column, $length = null) {}
    /** @column string */
    public function tinyText($column) {}
    /** @column string */
    public function text($column) {}
    /** @column string */
    public function mediumText($column) {}
    /** @column string */
    public function longText($column) {}
    /** @column int */
    public function integer($column) {}
    /** @column int */
    public function tinyInteger($column) {}
    /** @column int */
    public function smallInteger($column) {}
    /** @column int */
    public function mediumInteger($column) {}
    /** @column int */
    public function bigInteger($column) {}
    /** @column int */
    public function unsignedInteger($column) {}
    /** @column int */
    public function unsignedTinyInteger($column) {}
    /** @column int */
    public function unsignedSmallInteger($column) {}
    /** @column int */
    public function unsignedMediumInteger($column) {}
    /** @column int */
    public function unsignedBigInteger($column) {}
    /** @column int */
    public function foreignId($column) {}
    /** @foreign-for */
    public function foreignIdFor($model, $column = null) {}
    /** @foreign-for */
    public function foreignUuidFor($model, $column = null) {}
    /** @foreign-for */
    public function foreignUlidFor($model, $column = null) {}
    /** @column float */
    public function float($column, $precision = 53) {}
    /** @column float */
    public function double($column) {}
    /** @column string */
    public function decimal($column, $total = 8, $places = 2) {}
    /** @column bool */
    public function boolean($column) {}
    /** @column string */
    public function enum($column, array $allowed) {}
    /** @column string */
    public function set($column, array $allowed) {}
    /** @column array */
    public function json($column) {}
    /** @column array */
    public function jsonb($column) {}
    /** @column datetime */
    public function date($column) {}
    /** @column datetime */
    public function dateTime($column, $precision = null) {}
    /** @column datetime */
    public function dateTimeTz($column, $precision = null) {}
    /** @column string */
    public function time($column, $precision = null) {}
    /** @column string */
    public function timeTz($column, $precision = null) {}
    /** @column datetime */
    public function timestamp($column, $precision = null) {}
    /** @column datetime */
    public function timestampTz($column, $precision = null) {}
    /** @columns created_at:?datetime updated_at:?datetime */
    public function timestamps($precision = null) {}
    /** @columns created_at:?datetime updated_at:?datetime */
    public function nullableTimestamps($precision = null) {}
    /** @columns created_at:?datetime updated_at:?datetime */
    public function timestampsTz($precision = null) {}
    /** @columns created_at:?datetime updated_at:?datetime */
    public function nullableTimestampsTz($precision = null) {}
    /** @columns created_at:?datetime updated_at:?datetime */
    public function datetimes($precision = null) {}
    /** @column ?datetime */
    public function softDeletes($column = 'deleted_at', $precision = null) {}
    /** @column ?datetime */
    public function softDeletesTz($column = 'deleted_at', $precision = null) {}
    /** @column ?datetime */
    public function softDeletesDatetime($column = 'deleted_at', $precision = null) {}
    /** @column int */
    public function year($column) {}
    /** @column string */
    public function binary($column, $length = null, $fixed = false) {}
    /** @column string */
    public function uuid($column = 'uuid') {}
    /** @column string */
    public function foreignUuid($column) {}
    /** @column string */
    public function ulid($column = 'ulid', $length = 26) {}
    /** @column string */
    public function foreignUlid($column, $length = 26) {}
    /** @column string */
    public function ipAddress($column = 'ip_address') {}
    /** @column string */
    public function macAddress($column = 'mac_address') {}
    /** @column string */
    public function geometry($column, $subtype = null, $srid = 0) {}
    /** @column string */
    public function geography($column, $subtype = null, $srid = 4326) {}
    /** @column mixed */
    public function computed($column, $expression) {}
    /** @column array */
    public function vector($column, $dimensions = null) {}
    /** @column string */
    public function tsvector($column) {}
    /** @morphs int */
    public function morphs($name, $indexName = null, $after = null) {}
    /** @morphs ?int */
    public function nullableMorphs($name, $indexName = null, $after = null) {}
    /** @morphs int */
    public function numericMorphs($name, $indexName = null, $after = null) {}
    /** @morphs ?int */
    public function nullableNumericMorphs($name, $indexName = null, $after = null) {}
    /** @morphs string */
    public function uuidMorphs($name, $indexName = null, $after = null) {}
    /** @morphs ?string */
    public function nullableUuidMorphs($name, $indexName = null, $after = null) {}
    /** @morphs string */
    public function ulidMorphs($name, $indexName = null, $after = null) {}
    /** @morphs ?string */
    public function nullableUlidMorphs($name, $indexName = null, $after = null) {}
    /** @columns remember_token:?string */
    public function rememberToken() {}
    /** @column mixed */
    public function rawColumn($column, $definition) {}

    /** @drop */
    public function dropColumn($columns) {}
    /** @rename */
    public function renameColumn($from, $to) {}
    /** @drops created_at updated_at */
    public function dropTimestamps() {}
    /** @drops created_at updated_at */
    public function dropTimestampsTz() {}
    /** @drop */
    public function dropSoftDeletes($column = 'deleted_at') {}
    /** @drop */
    public function dropSoftDeletesTz($column = 'deleted_at') {}
    /** @drops remember_token */
    public function dropRememberToken() {}
}
