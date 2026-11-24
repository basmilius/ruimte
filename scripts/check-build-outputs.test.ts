import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { leaksIn, needlesOf, type Needle } from './check-build-outputs.ts';

const NEEDLES: Needle[] = [
    { text: 'poc.chat', whole: true },
    { text: 'extensions/poc/chat/', whole: false }
];

describe('what a build may not hold of a development extension', () => {
    test('is the id and the folder of each one in this checkout', () => {
        const needles = needlesOf(join(import.meta.dir, '..'));

        expect(needles).toContainEqual({ text: 'poc.broken', whole: true });
        expect(needles).toContainEqual({ text: 'extensions/poc/broken/', whole: false });
        expect(needles.every((needle) => needle.text.length > 4)).toBe(true);
    });

    test('is found as an id of its own and as a path, also in a binary', () => {
        expect(leaksIn(Buffer.from('register("poc.chat",load)'), NEEDLES)).toEqual(['poc.chat']);
        expect(leaksIn(Buffer.from('//# source=../../extensions/poc/chat/client/index.ts'), NEEDLES)).toEqual(['extensions/poc/chat/']);
        expect(leaksIn(Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from('poc.chat'), Buffer.from([0])]), NEEDLES)).toEqual(['poc.chat']);
    });

    test('is not found in a longer name that only holds the id, or in the folder that holds them all', () => {
        expect(leaksIn(Buffer.from('epoc.chatter; a.poc.chat; poc.chat-two'), NEEDLES)).toEqual([]);
        expect(leaksIn(Buffer.from("['extensions/dev', 'extensions/poc']"), NEEDLES)).toEqual([]);
    });
});
