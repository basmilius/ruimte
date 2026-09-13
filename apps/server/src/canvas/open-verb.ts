import { isOpenableView } from '@ruimte/contracts';
import { z } from 'zod';
import { VerbRefusal, defineVerb, field, placeOf } from './verb.ts';
import { viewLines } from './view-verb.ts';

/*
 * The one verb that makes nothing. Every other verb writes the project file, which is shared;
 * looking at a view is one person at one screen, so this is an event and each client decides for
 * itself whether to follow it. That is also why it takes no `--dry-run`: there is nothing to undo.
 */
export const openVerb = defineVerb({
    name: 'open',
    usage: '<viewId>',
    summary: 'Shows a view to whoever has this project on screen; the project file is not touched',
    detail: [
        'argument\t<viewId>\trequired\tThe view to show, by id; ruimte-context views lists them',
        'prints\tshowing\tid\tkind\tname\tthe view you asked for',
        'prints\tsent\tyes|no\twhether anyone had this project on screen to show it to',
        'shows\tThe view takes the place of the one the person was working in; a view already on screen is brought to the front instead',
        'note\tThis writes nothing, so it is the one verb a person can turn off: a client may be set to only mention the view and stay where it is',
        'note\tNobody watching is not a failure; nothing waits, and the same call later shows it to whoever is there then',
        'note\tA separator is a line in the sidebar and holds nothing to show',
        'see\truimte-context views\tthe views of the project, which is where the id comes from'
    ],
    positionals: z.tuple([z.string().min(1, 'open needs the id of a view')], {
        error: (issue) => (issue.code === 'too_big' ? 'open takes one view id and nothing else' : 'open needs the id of a view')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const place = placeOf(call);
        const content = await call.host.read(place.projectId);
        const view = content.views.find((candidate) => candidate.id === id);
        if (!view) {
            throw new VerbRefusal('unknown-view', `${id} is not a view of this project`, [...viewLines(content), 'note\topen takes a view id, never a name']);
        }
        if (!isOpenableView(view)) {
            throw new VerbRefusal('never-opens', `${id} is a separator, a line in the sidebar with nothing to show`, viewLines(content));
        }
        const shown = call.host.showView(place.projectId, id, call.caller);
        return [
            `showing\t${id}\t${view.kind}\t${field(view.name ?? '')}`,
            shown
                ? 'sent\tyes\tEveryone with this project on screen was told'
                : 'sent\tno\tNobody has this project on screen right now, so nothing was showing it'
        ];
    }
});
