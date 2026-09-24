import { NODE_ACCENT_NAMES } from '@ruimte/contracts';
import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';

/* The word that takes a flag off, the way the action's own `null` does and `view icon` spells it. */
const NO_FLAG = 'null';

const COLOR_MESSAGE = `flag needs a color, one of ${NODE_ACCENT_NAMES.join(', ')}, or ${NO_FLAG} to take the flag off`;

export const flagVerb = defineStandaloneActionVerb({
    name: 'flag',
    action: 'flag.set',
    usage: `<id> <color|${NO_FLAG}>`,
    params: [
        { syntax: '<id>', need: 'required', text: 'The view or node to flag, by id', more: 'ruimte-context view list and node list list them' },
        { syntax: '<color>', need: 'required', field: 'color', more: `one of ${NODE_ACCENT_NAMES.join(', ')}; ${NO_FLAG} takes the flag off` }
    ],
    detail: [
        'prints\tflagged\tid\tview|node\tcolor\tthe flag it now wears, null for none',
        "note\tA flag is the person's own mark: it never reaches the shared project file, so flag what they asked you to flag and nothing more",
        'see\truimte-context view list\tthe flag column says what each view wears; node list says the same for the nodes of a canvas'
    ],
    positionals: z.tuple([z.string().min(1, 'flag needs the id of a view or a node'), z.enum([...NODE_ACCENT_NAMES, NO_FLAG], { error: COLOR_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'flag takes one id and one color' : `flag needs the id of a view or a node and a color; ${COLOR_MESSAGE}`)
    }),
    flags: z.object({}),
    async run({ positionals: [id, value] }, call) {
        const set = await runAction(call, 'flag.set', { ids: [id], color: value === NO_FLAG ? null : value });
        return set.flags.map((flagged) => `flagged\t${flagged.id}\t${flagged.target}\t${set.color ?? NO_FLAG}`);
    }
});
