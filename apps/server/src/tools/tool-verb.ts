import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { defineNoun } from './verb.ts';

const listSub = defineActionVerb('tool', {
    name: 'list',
    action: 'tool.list',
    usage: '',
    params: [],
    detail: ['prints\ttool\tid\twhat it does\tthe JSON schema of its input'],
    positionals: z.tuple([], { error: 'tool list takes no arguments' }),
    flags: z.object({}),
    async run(_args, call) {
        const { tools } = await runAction(call, 'tool.list', {});

        return tools.map((tool) => `tool\t${tool.id}\t${tool.description}\t${tool.parameters}`);
    }
});

const runSub = defineActionVerb('tool', {
    name: 'run',
    action: 'tool.run',
    usage: '<id> [--input J]',
    params: [{ syntax: '--input J', need: 'optional', field: 'input', more: 'JSON that fits the schema tool list prints; without it {}' }],
    detail: ['prints\tWhat the tool answers, as it answers it'],
    positionals: z.tuple([z.string({ error: 'tool run needs the id tool list prints' })]),
    flags: z.object({ input: z.string().optional() }),
    async run({ positionals, flags }, call) {
        const { text } = await runAction(call, 'tool.run', { id: positionals[0], input: flags.input ?? '{}' });

        return text.split('\n');
    }
});

export const toolVerb = defineNoun({
    name: 'tool',
    summary: 'Lists and runs the tools extensions on this machine offer you',
    detail: ['tools\tAn extension a person installed may offer tools; each runs in that extension and answers in text'],
    actions: [listSub, runSub]
});
