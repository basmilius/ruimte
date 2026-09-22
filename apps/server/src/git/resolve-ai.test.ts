import { describe, expect, test } from 'bun:test';
import { splitBlocks, splitLines } from '@ruimte/merge';
import { buildResolvePrompt, parseResolution } from './resolve-ai.ts';

const blocks = splitBlocks(splitLines('one\ntwo\nthree\nfour\n'), splitLines('one\nour two\nthree\nfour\n'), splitLines('one\ntheir two\nthree\nfour\n'));

describe('buildResolvePrompt', () => {
    test('hands over every side of the conflict and the lines around it', () => {
        const prompt = buildResolvePrompt('file.txt', blocks, 'main', 'feature');
        expect(prompt).toContain('Resolve the merge conflicts in file.txt');
        expect(prompt).toContain('Conflict 1');
        expect(prompt).toContain('Side "main":\nour two');
        expect(prompt).toContain('Side "feature":\ntheir two');
        expect(prompt).toContain('Both sides started from:\ntwo');
        expect(prompt).toContain('Lines after:\nthree\nfour');
    });

    test('says nothing about the stretches that merge by themselves', () => {
        expect(buildResolvePrompt('file.txt', blocks, 'main', 'feature')).not.toContain('Conflict 0');
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
