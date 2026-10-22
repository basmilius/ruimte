import { MAX_PER_CALL } from '@ruimte/actions';
import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { ONE_WRITE, jsonBatch } from './batch.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, field, placeOf, titleField } from './verb.ts';

const NEEDS_ID = 'node rename needs the id of a node';

const NEEDS_TITLE = '--title needs a title';

const RENAME_USAGE = '(<nodeId> --title T | --json J) [--view V]';

const RENAME_USAGE_LINES = [`usage\tnode rename\t${RENAME_USAGE}`, 'detail\truimte-context help node rename'];

/* One node of a --json call: its id and the title, held to the same cap as --title. */
const JsonRenameSchema = z.strictObject({
    id: z.string({ error: 'id needs the id of a node' }).min(1, 'id needs the id of a node'),
    title: titleField('title', 'title needs a title')
});

const JSON_EXAMPLE = `ruimte-context node rename --json '[{"id":"note-1","title":"Plan"},{"id":"term-2","title":"Build the parser"}]'`;

export const renameAction = defineActionVerb('node', {
    name: 'rename',
    action: 'node.rename',
    usage: RENAME_USAGE,
    params: [
        { syntax: '<nodeId>', need: 'required', field: 'nodeId', text: 'The node to rename, by id' },
        { syntax: '--title T', need: 'required', field: 'name', text: `The new title, at most ${MAX_TITLE_LENGTH} characters, one argument, spaces and all` },
        {
            syntax: '--json J',
            need: 'in place of <nodeId> and --title',
            text: `Several nodes in one call: an array of up to ${MAX_PER_CALL} objects, each with id and title`,
            more: '--json - takes the array from stdin, a heredoc included'
        },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the nodes are on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        'prints\tid\tkind\ttitle\tthe node as it now stands; one row per node, in the order given',
        `many\tTo rename several nodes, give them all to one call with --json instead of calling once per node: ${ONE_WRITE}`,
        'many\tEach node is checked the way a single call checks it, and a refusal names the node',
        `example\t${JSON_EXAMPLE}`,
        "note\tA title set here is the node's for good: the session it holds never renames over it again, which is what a person typing a title does too",
        'note\tA rename to the title it already carries writes nothing and is not a refusal',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context view rename\trenaming a row in the sidebar instead of a node on a canvas',
        TITLE_LINE
    ],
    positionals: z.tuple([z.string().min(1, NEEDS_ID).optional()], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node rename takes one node id and nothing else; the title goes in --title, and several nodes go in --json' : NEEDS_ID
    }),
    flags: z.object({
        title: titleField('--title', NEEDS_TITLE).optional(),
        json: z.string().min(1, '--json needs an array of nodes').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags }, call) {
        if (flags.json !== undefined) {
            const single = [...(id === undefined ? [] : ['the node id']), ...(flags.title === undefined ? [] : ['--title'])];
            if (single.length > 0) {
                throw new VerbRefusal('bad-arguments', `--json carries every node with its own title; leave out ${single.join(', ')}`, RENAME_USAGE_LINES);
            }
            const renames = jsonBatch(flags.json, JsonRenameSchema, JSON_EXAMPLE);
            const viewId = await canvasIdFor(call, placeOf(call), flags.view);
            const renamed = await runAction(call, 'node.renameMany', { viewId, nodes: renames.map((rename) => ({ nodeId: rename.id, name: rename.title })) });
            return renamed.nodes.map((node) => [node.nodeId, node.kind, field(node.name)].join('\t'));
        }
        if (id === undefined) {
            throw new VerbRefusal('bad-arguments', NEEDS_ID, RENAME_USAGE_LINES);
        }
        if (flags.title === undefined) {
            throw new VerbRefusal('bad-arguments', NEEDS_TITLE, RENAME_USAGE_LINES);
        }
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const renamed = await runAction(call, 'node.rename', { viewId, nodeId: id, name: flags.title });
        return [[id, renamed.kind, field(renamed.name)].join('\t')];
    }
});
