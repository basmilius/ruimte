import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field } from './verb.ts';

/*
 * The one verb that makes nothing. Every other verb writes the project file, which is shared;
 * looking at a view is one person at one screen, so this is an event and each client decides for
 * itself whether to follow it. That is also why it takes no `--dry-run`: there is nothing to undo.
 */
export const openAction = defineActionVerb('view', {
    name: 'open',
    action: 'view.focus',
    usage: '<viewId>',
    params: [{ syntax: '<viewId>', need: 'required', field: 'viewId', text: 'The view to show, by id', more: 'ruimte-context view list lists them' }],
    detail: [
        'prints\tshowing\tid\tkind\tname\tthe view you asked for',
        'prints\tsent\tyes|no\tsentence\twhether anyone had this project on screen to show it to, and the same in words',
        'shows\tThe view takes the place of the one the person was working in; a view already on screen is brought to the front instead',
        'note\tThis writes nothing, so it is the one verb a person can turn off: a client may be set to only mention the view and stay where it is',
        'note\tNobody watching is not a failure; nothing waits, and the same call later shows it to whoever is there then',
        'note\tA separator and a subheader divide the sidebar and hold nothing to show',
        'see\truimte-context view list\tthe views of the project, which is where the id comes from'
    ],
    positionals: z.tuple([z.string().min(1, 'view open needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'view open takes one view id and nothing else' : 'view open needs the id of a view')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const shown = await runAction(call, 'view.focus', { viewId: id });
        return [
            `showing\t${id}\t${shown.kind}\t${field(shown.view)}`,
            shown.delivered === true
                ? 'sent\tyes\tEveryone with this project on screen was told'
                : 'sent\tno\tNobody has this project on screen right now, so nothing was showing it'
        ];
    }
});
