import { expect, it } from 'bun:test';
import { scanBrackets } from './brackets.ts';

it('pairs nested source while ignoring comments, strings, regexes and template text', () => {
    const source = 'function f() { const s = "}"; /* { */ const r = /[{}]/g; return `text { ${fn({ value: 1 })} }`; }';
    const index = scanBrackets(source);
    expect(index.pairs.get(source.indexOf('{'))).toBe(source.length - 1);
    expect(index.pairs.has(source.indexOf('}"'))).toBe(false);
    expect(index.pairs.has(source.indexOf('{}'))).toBe(false);
    expect(index.pairs.get(source.indexOf('${') + 1)).toBe(source.indexOf('} }`'));
    expect(index.unmatched.size).toBe(0);
});
it('never creates crossing pairs through malformed nesting', () => {
    const index = scanBrackets('([)] {');
    expect(index.pairs.size).toBe(0);
    expect([...index.unmatched].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 5]);
});
it('ignores PHP hash comments but preserves attribute brackets', () => {
    const source = '# {\n#[Attribute] function f() { return "}"; }';
    const index = scanBrackets(source, 'php');
    expect(index.pairs.get(source.indexOf('['))).toBe(source.indexOf(']'));
    expect(index.pairs.get(source.lastIndexOf('{'))).toBe(source.length - 1);
    expect(index.pairs.has(source.indexOf('{'))).toBe(false);
});

it('treats // as a division in Python and #[ as a comment', () => {
    const source = 'value = (a // b)\n#[ (\nother = [1]';
    const index = scanBrackets(source, 'python');
    expect(index.pairs.get(source.indexOf('('))).toBe(source.indexOf(')'));
    expect(index.pairs.has(source.lastIndexOf('['))).toBe(true);
    expect(index.pairs.has(source.indexOf('#[') + 1)).toBe(false);
    expect(index.unmatched.size).toBe(0);
});

it('skips HTML comments only in markup languages', () => {
    const source = '<!-- ( --> (a)';
    expect(scanBrackets(source, 'html').pairs.size).toBe(2);
    expect(scanBrackets(source, 'typescript').unmatched.size).toBe(1);
});

it('has no line comments in CSS and no block comments in JSON', () => {
    const css = 'a { background: url(//example.com/x.png); }';
    expect(scanBrackets(css, 'css').unmatched.size).toBe(0);
    const json = '{ "a": 1 } /* ( */';
    expect(scanBrackets(json, 'json').unmatched.size).toBe(1);
});
