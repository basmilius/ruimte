import { z } from 'zod';
import { canvasIdFor, defineActionVerb, runAction } from './action-verb.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, field, placeOf, titleField } from './verb.ts';

export const renameAction = defineActionVerb('node', {
    name: 'rename',
    action: 'node.rename',
    usage: '<nodeId> --title T [--view V]',
    params: [
        { syntax: '<nodeId>', need: 'required', field: 'nodeId', text: 'The node to rename, by id; one node per call' },
        { syntax: '--title T', need: 'required', field: 'name', text: `The new title, at most ${MAX_TITLE_LENGTH} characters, one argument, spaces and all` },
        { syntax: '--view V', need: 'optional', field: 'viewId', text: 'The canvas the node is on, by view id', more: 'ruimte-context view list lists them' }
    ],
    detail: [
        'prints\tid\tkind\ttitle\tthe node as it now stands',
        "note\tA title set here is the node's for good: the session it holds never renames over it again, which is what a person typing a title does too",
        'note\tA rename to the title it already carries writes nothing and is not a refusal',
        'ids\tOnly ids, never titles; ruimte-context node list lists the nodes of a canvas with theirs',
        'see\truimte-context view rename\trenaming a row in the sidebar instead of a node on a canvas',
        TITLE_LINE
    ],
    positionals: z.tuple([z.string().min(1, 'node rename needs the id of a node')], {
        error: (issue) =>
            issue.code === 'too_big' ? 'node rename takes one node id and nothing else; the title goes in --title' : 'node rename needs the id of a node'
    }),
    flags: z.object({
        title: titleField('--title', '--title needs a title'),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const viewId = await canvasIdFor(call, placeOf(call), flags.view);
        const renamed = await runAction(call, 'node.rename', { viewId, nodeId: id, name: flags.title });
        return [[id, renamed.kind, field(renamed.name)].join('\t')];
    }
});
