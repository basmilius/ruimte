import { isOpenableView } from '@ruimte/contracts';
import { z } from 'zod';
import { serverActionCall, serverViewActions } from '../actions/view-actions.ts';
import { VerbRefusal, defineAction, field, orNote, placeOf } from './verb.ts';
import { viewLines } from './view-verb.ts';

/*
 * The one verb that makes nothing. Every other verb writes the project file, which is shared;
 * looking at a view is one person at one screen, so this is an event and each client decides for
 * itself whether to follow it. That is also why it takes no `--dry-run`: there is nothing to undo.
 */
export const openAction = defineAction('view', {
    name: 'open',
    usage: '<viewId>',
    summary: 'Shows a view to whoever has this project on screen; the project file is not touched',
    detail: [
        'argument\t<viewId>\trequired\tThe view to show, by id; ruimte-context view list lists them',
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
        const place = placeOf(call);
        const result = await serverViewActions.execute('view.focus', { viewId: id }, serverActionCall(call.host, place.projectId, call.caller));
        if (result.status !== 'completed') {
            const content = await call.host.read(place.projectId);
            // Only what view open itself takes: a refusal that listed the dividers would offer what the next call refuses.
            const openable = orNote(viewLines(content.views.filter(isOpenableView)), 'This project has no view that opens');
            const code =
                result.status === 'failed' && result.error.code === 'view-not-openable'
                    ? 'never-opens'
                    : result.status === 'failed'
                      ? result.error.code
                      : 'confirmation-required';
            const message = result.status === 'failed' ? result.error.message : 'view open requires confirmation';
            throw new VerbRefusal(
                code,
                message,
                result.status === 'failed' && result.error.code === 'unknown-view' ? [...openable, 'note\tview open takes a view id, never a name'] : openable
            );
        }
        const shown = result.output.delivered === true;
        return [
            `showing\t${id}\t${result.output.kind}\t${field(result.output.view)}`,
            shown
                ? 'sent\tyes\tEveryone with this project on screen was told'
                : 'sent\tno\tNobody has this project on screen right now, so nothing was showing it'
        ];
    }
});
