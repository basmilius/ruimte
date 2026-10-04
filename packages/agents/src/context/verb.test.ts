import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createVerbRegistry, type HelpTopic, type Verb, type VerbCallBase } from './verb.ts';

const REFUSAL = 'refused\tcode\tmessage';

function helpWith(topics?: readonly HelpTopic[]): Verb<VerbCallBase> {
    const { defineVerb, defineHelp } = createVerbRegistry<VerbCallBase>({ cli: 'test-context' });
    const read = defineVerb({
        name: 'read',
        usage: '<id>',
        summary: 'Reads one thing',
        detail: [],
        positionals: z.tuple([z.string()]),
        flags: z.object({}),
        run: async () => []
    });
    const help: Verb<VerbCallBase> = defineHelp({ entries: () => [read, help], root: () => [], refusal: REFUSAL, topics });
    return help;
}

const RUNTIME: HelpTopic = { name: 'runtime', summary: 'The API a scene is written against', body: ['api\tclip(from, to)', 'api\tease(name)'] };

describe('help topics', () => {
    test('the root lists every topic after the verbs and points at help <topic>', async () => {
        const lines = await helpWith([RUNTIME]).run([], {});
        expect(lines).toContain('topic\truntime\tThe API a scene is written against');
        expect(lines.indexOf('topic\truntime\tThe API a scene is written against')).toBeGreaterThan(lines.findIndex((line) => line.startsWith('verb\thelp\t')));
        expect(lines).toContain('detail\ttest-context help <topic>\tone topic in full');
    });

    test('help <topic> prints its summary and body as they are', async () => {
        expect(await helpWith([RUNTIME]).run(['runtime'], {})).toEqual(['about\tThe API a scene is written against', 'api\tclip(from, to)', 'api\tease(name)']);
    });

    test('a topic has no actions', async () => {
        await expect(helpWith([RUNTIME]).run(['runtime', 'clip'], {})).rejects.toMatchObject({ code: 'bad-arguments' });
    });

    test('a verb of the same name wins over a topic', async () => {
        const lines = await helpWith([{ name: 'read', summary: 'Shadowed', body: ['never'] }]).run(['read'], {});
        expect(lines[0]).toBe('usage\tread\t<id>');
        expect(lines).not.toContain('never');
    });

    test('an unknown name lists the topics beside the verbs', async () => {
        await expect(helpWith([RUNTIME]).run(['nothing'], {})).rejects.toMatchObject({
            code: 'unknown-verb',
            message: 'nothing is not a verb, a noun or a topic',
            lines: expect.arrayContaining(['topic\truntime\tThe API a scene is written against'])
        });
    });

    test('without topics help reads as it always did', async () => {
        const lines = await helpWith().run([], {});
        expect(lines.some((line) => line.startsWith('topic\t') || line.includes('help <topic>'))).toBe(false);
        await expect(helpWith().run(['nothing'], {})).rejects.toMatchObject({ message: 'nothing is not a verb or a noun' });
    });
});
