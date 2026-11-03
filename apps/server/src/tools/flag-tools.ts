import { NODE_ACCENT_NAMES } from '@ruimte/contracts';
import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { idsInput } from './batch.ts';
import { defineToolkit } from './tool.ts';

/* The word that takes a flag off, the way the action's own `null` does and `view_edit` spells an icon. */
const NO_FLAG = 'null';

const COLOR_MESSAGE = `color needs one of ${NODE_ACCENT_NAMES.join(', ')}, or ${NO_FLAG} to take the flag off`;

const flag = defineActionTool('flag', {
    name: 'flag',
    action: 'flag.set',
    description: 'Sets or clears (null) a personal flag on views and nodes.',
    input: z.object({
        id: idsInput('id', 'views and nodes to flag'),
        color: z.enum([...NODE_ACCENT_NAMES, NO_FLAG], { error: COLOR_MESSAGE })
    }),
    async run(input, call) {
        const set = await runAction(call, 'flag.set', { ids: input.id, color: input.color === NO_FLAG ? null : input.color });

        return set.flags.map((flagged) => `flagged\t${flagged.id}\t${flagged.target}\t${set.color ?? NO_FLAG}`);
    }
});

export const flagToolkit = defineToolkit('flag', [flag]);
