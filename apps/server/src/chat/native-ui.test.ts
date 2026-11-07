import { expect, test } from 'bun:test';
import { compileUiBlock } from '@adecore/intelligent-ui';
import { z } from 'zod';
import { evaluateNativeUi, nativeUiJson } from './native-ui';

test('the native bridge refuses deeply nested wire data before schema recursion', () => {
    let value: unknown = {};
    for (let i = 0; i < 200; i++) {
        value = { child: value };
    }
    expect(() => evaluateNativeUi({ block: value })).toThrow('structure budget');
    expect(() => nativeUiJson(' '.repeat(1024 * 1024 + 1))).toThrow('too large');
});

test('the native bridge keeps a good sibling when another node has an unsupported expression', () => {
    const block = compileUiBlock('<Summary>Kept</Summary><Summary>{1}</Summary>', { id: 'a', final: true, now: () => 0 });
    expect(block.diagnostics).toEqual([]);
    block.nodes[1].children[0].expressions.text = { kind: 'future' } as never;
    const result = evaluateNativeUi({ block });
    const nodes = result.nodes as { children: { props: { text?: string }; error?: string }[] }[];
    expect(nodes[0].children[0].props.text).toBe('Kept');
    expect(nodes[1].children[0].error).toBeDefined();
    expect(result.diagnostics).toHaveLength(1);
});

test('the native bridge keeps the compiled fallback of a component beside a known one', () => {
    const source = '<Summary>Kept</Summary><FutureWidget>Future fallback</FutureWidget>';
    const block = compileUiBlock(source, { id: 'a', final: true, now: () => 0 });
    const result = evaluateNativeUi({ block });
    const nodes = result.nodes as { type: string; fallback: string; error?: string }[];
    expect(nodes.map((node) => node.type)).toEqual(['Summary', 'FutureWidget']);
    expect(nodes[0].error).toBeUndefined();
    expect(nodes[1].error).toBe('unknown_component');
    expect(nodes[1].fallback).toBe(block.nodes[1].fallback);
    expect(nodes[1].fallback).toContain('Future fallback');
});

test('the native bridge names the queries each written node reads, an Each passing its own to what stands in it', () => {
    const source =
        '$rows = @Query("rows", {})\n<Stats><Stat label="Open" value={$rows.open}/></Stats><Each items={$rows.items} as="row"><Tag>{row.name}</Tag></Each><Summary>Plain</Summary>';
    const block = compileUiBlock(source, { id: 'a', final: true, now: () => 0, querySchemas: { rows: z.object({}) } });
    expect(block.diagnostics).toEqual([]);
    const result = evaluateNativeUi({ block, queries: { $rows: { open: 2, items: [{ name: 'x' }] } } });
    const nodeQueries = result.nodeQueries as Record<string, string[]>;
    const stat = block.nodes[0].children[0];
    const each = block.nodes[1];
    expect(nodeQueries[stat.id]).toEqual(['$rows']);
    expect(nodeQueries[each.id]).toEqual(['$rows']);
    expect(nodeQueries[each.children[0].id]).toEqual(['$rows']);
    expect(nodeQueries).not.toHaveProperty(block.nodes[2].id);
});

test('the native bridge hands the phone the errors of a block and keeps the warnings for its agent', () => {
    const block = compileUiBlock('<Timeline><Event at="someday">Launch</Event></Timeline><Summary>{1}</Summary>', { id: 'a', final: true, now: () => 0 });
    // The compiler already warned of the time; without that the evaluation says it again.
    block.diagnostics = [];
    block.nodes[1].children[0].expressions.text = { kind: 'future' } as never;
    expect((evaluateNativeUi({ block }).diagnostics as { code: string }[]).map((diagnostic) => diagnostic.code)).toEqual(['invalid_expression']);
});
