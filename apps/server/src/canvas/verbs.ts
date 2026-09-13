import { z } from 'zod';
import { nodeVerb } from './node-verb.ts';
import { canvasFor, defineVerb, field, placeOf, type ContextVerb, type VerbEntry } from './verb.ts';

const helpVerb = defineVerb({
    name: 'help',
    usage: '',
    summary: 'Lists every verb: name, arguments, what it does',
    positionals: z.tuple([]),
    flags: z.object({}),
    run: async () => VERBS.map((verb) => `${verb.name}\t${verb.usage}\t${verb.summary}`)
});

const listVerb: ContextVerb = {
    served: 'context',
    name: 'list',
    usage: '',
    summary: 'Lists the context linked to this session: id, kind, title (also what ruimte-context prints without a verb)'
};

const readVerb: ContextVerb = {
    served: 'context',
    name: 'read',
    usage: '<id>',
    summary: 'Prints one linked source'
};

const nodesVerb = defineVerb({
    name: 'nodes',
    usage: '[--view V]',
    summary: 'Lists the nodes of a canvas: id, kind, title, x, y, w, h',
    positionals: z.tuple([]),
    flags: z.object({ view: z.string().min(1).optional() }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const canvas = canvasFor(await call.host.read(place.projectId), place, flags.view);
        return canvas.nodes.map((node) =>
            [node.id, node.kind, field(node.title), ...[node.x, node.y, node.w, node.h].map((value) => String(Math.round(value)))].join('\t')
        );
    }
});

const viewsVerb = defineVerb({
    name: 'views',
    usage: '',
    summary: 'Lists the views of the project in sidebar order: id, kind, name',
    positionals: z.tuple([]),
    flags: z.object({}),
    async run(_input, call) {
        const content = await call.host.read(placeOf(call).projectId);
        return content.views.map((view) => `${view.id}\t${view.kind}\t${field(view.name ?? '')}`);
    }
});

/* In the order `help` lists them: everything `ruimte-context` does, whichever route serves it. */
export const VERBS: readonly VerbEntry[] = [helpVerb, listVerb, readVerb, nodesVerb, viewsVerb, nodeVerb];

export const verbNamed = (name: string): VerbEntry | undefined => VERBS.find((verb) => verb.name === name);
