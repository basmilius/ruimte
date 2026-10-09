import { expect, test } from 'bun:test';
import { compileUiBlock } from '@adecore/intelligent-ui';
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
    const block = compileUiBlock('<Summary>Kept</Summary><Summary>{1}</Summary>', { id: 'a', final: true });
    block.nodes[1].children[0].expressions.text = { kind: 'future' } as never;
    const result = evaluateNativeUi({ block });
    const nodes = result.nodes as { children: { props: { text?: string }; error?: string }[] }[];
    expect(nodes[0].children[0].props.text).toBe('Kept');
    expect(nodes[1].children[0].error).toBeDefined();
    expect(result.diagnostics).toHaveLength(1);
});
