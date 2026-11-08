import { describe, expect, test } from 'bun:test';
import type { ChatProvider } from '@adecore/agents/providers';
import { splitBlocks, splitLines } from '@adecore/merge';
import { oneShotRun } from './one-shot.ts';
import { buildResolvePrompt, parseResolution } from './resolve-ai.ts';

const blocks = splitBlocks(splitLines('one\ntwo\nthree\nfour\n'), splitLines('one\nour two\nthree\nfour\n'), splitLines('one\ntheir two\nthree\nfour\n'));

describe('buildResolvePrompt', () => {
    test('leaves a conflict that would not fit out of the prompt, and still asks about the ones that do', () => {
        // About 200 KB over its three versions, under the line distance past which the whole file is one conflict.
        const huge = Array.from(
            { length: 600 },
            (_, i) => `line ${i} of a file one side reformatted from top to bottom, and the other side as well, at length`
        );
        const base = ['head', ...huge, 'middle', 'two', 'tail'];
        const ours = ['head', ...huge.map((line) => `  ${line}`), 'middle', 'our two', 'tail'];
        const theirs = ['head', ...huge.map((line) => `${line};`), 'middle', 'their two', 'tail'];
        const split = splitBlocks(base, ours, theirs);
        const conflicts = [...split.entries()].filter(([, entry]) => entry.kind === 'conflict').map(([index]) => index);
        expect(conflicts).toHaveLength(2);

        const built = buildResolvePrompt('file.txt', split, 'main', 'feature');
        expect(Buffer.byteLength(built.prompt)).toBeLessThanOrEqual(24 * 1024);
        expect(built.asked).toEqual([conflicts[1]!]);
        expect(built.skipped).toEqual([conflicts[0]!]);
        expect(built.prompt).toContain('Side "main":\nour two');
    });

    test('hands over every side of the conflict and the lines around it', () => {
        const { prompt } = buildResolvePrompt('file.txt', blocks, 'main', 'feature');
        expect(prompt).toContain('Resolve the merge conflicts in file.txt');
        expect(prompt).toContain('Conflict 1');
        expect(prompt).toContain('Side "main":\nour two');
        expect(prompt).toContain('Side "feature":\ntheir two');
        expect(prompt).toContain('Both sides started from:\ntwo');
        expect(prompt).toContain('Lines after:\nthree\nfour');
    });

    test('ties an answer to the heading of its conflict and shows no index a model could copy', () => {
        const { prompt, asked } = buildResolvePrompt('file.txt', blocks, 'main', 'feature');
        expect(asked).toEqual([1]);
        expect(prompt).toContain('where N is the number of the "Conflict N" heading it answers');
        expect(prompt).not.toMatch(/"index": \d/);
    });

    test('says nothing about the stretches that merge by themselves', () => {
        expect(buildResolvePrompt('file.txt', blocks, 'main', 'feature').prompt).not.toContain('Conflict 0');
    });
});

describe('oneShotRun', () => {
    const provider = (stdinArgs?: string[]): ChatProvider =>
        ({ name: 'Fake', oneShotArgs: (prompt: string) => ['-p', prompt], ...(stdinArgs ? { oneShotStdinArgs: stdinArgs } : {}) }) as unknown as ChatProvider;

    test('hands the prompt over on stdin when the CLI reads it there, and never on its command line', () => {
        expect(oneShotRun(provider(['-p']), 'the prompt')).toEqual({ args: ['-p'], stdin: 'the prompt' });
    });

    test('falls back to the command line for a CLI that only takes it there', () => {
        expect(oneShotRun(provider(), 'the prompt')).toEqual({ args: ['-p', 'the prompt'] });
    });

    test('adds the model as a flag, before the stdin marker of Codex', () => {
        expect(oneShotRun(provider(['-p']), 'the prompt', 'small')).toEqual({ args: ['-p', '--model', 'small'], stdin: 'the prompt' });
        expect(oneShotRun(provider(), 'the prompt', 'small')).toEqual({ args: ['-p', 'the prompt', '--model', 'small'] });

        const codex = { name: 'Codex', kind: 'codex', oneShotStdinArgs: ['exec', '-'] } as unknown as ChatProvider;

        expect(oneShotRun(codex, 'the prompt', 'small')).toEqual({ args: ['exec', '--model', 'small', '-'], stdin: 'the prompt' });
    });
});

describe('parseResolution', () => {
    test('reads the blocks out of whatever was written around them', () => {
        const output = 'Sure, here you go:\n{"blocks": [{"index": 1, "lines": ["merged two"]}]}\nDone.';
        expect(parseResolution(output)).toEqual([{ index: 1, lines: ['merged two'] }]);
    });

    test('drops an entry that is not a stretch of lines', () => {
        const output = '{"blocks": [{"index": 1, "lines": "merged"}, {"index": 2, "lines": ["fine"]}]}';
        expect(parseResolution(output)).toEqual([{ index: 2, lines: ['fine'] }]);
    });

    test('answers nothing for output that holds no object', () => {
        expect(parseResolution('I could not do it.')).toEqual([]);
    });
});
