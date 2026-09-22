import { deriveProjectContextSources, isCanvasView, type BrowserDriveAction, type ContextSource, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import type { DriveOutcome } from '../browser/drive.ts';
import { checkUrl } from './node-verb.ts';
import { defineAction, field, orNote, placeOf, SCOPE_LINE, VerbRefusal, type BrowserDriveHost, type VerbCall } from './verb.ts';

/* What every action of this noun prints under its first line, so an agent reads one shape whatever it asked. */
const PRINTS_LINES: readonly string[] = [
    'prints\topen\tyes|no\tsentence\twhether anyone on this machine has the page open, and the same in words',
    'prints\tpage\tid\taddress\ttitle\twhere the page stands afterwards; absent when nobody has it open',
    'prints\tloading\tyes|no\twhether the page was still loading when it answered',
    'prints\tback\tyes|no\twhether the history has a step back in it',
    'prints\tforward\tyes|no\twhether it has one forward',
    'prints\terror\tsentence\twhat the page ran into; absent when it ran into nothing'
];

/* The sentences about the line and the page, which every action of this noun is held to. */
const COMMON_DETAIL: readonly string[] = [
    'argument\t<id>\trequired\tThe browser node, by id; ruimte-context list names the ones linked to you',
    'line\tA line between you and that node is what lets you drive it, whichever way it was drawn, the same line that lets you read the page',
    'page\tThe page lives where it is shown: in the app of whoever has this project open, or on this machine for a client that has no browser of its own',
    'page\tNobody watching is not a failure; the call says open no, changes nothing, and the same call later reaches whoever is there then',
    'see\truimte-context read <id>\tthe address and the text of the page, which is how you read what you navigated to',
    SCOPE_LINE
];

/* Every browser node this caller may drive, for a refusal that offers what the next call takes. */
const browserLines = (sources: readonly ContextSource[]): string[] =>
    orNote(
        sources.filter((source) => source.kind === 'browser').map((source) => `browser\t${source.id}\t${field(source.title)}\t${field(source.text ?? '')}`),
        'No browser node is linked to you; ruimte-context link new --to <id> draws the line to one'
    );

interface Target {
    projectId: string;
    node: ProjectNode;
}

/*
 * The node an action works on. A browser node of this project, with a line between it and the
 * caller: the same line a read takes, since driving a page and reading it are one permission.
 */
const targetOf = async (call: VerbCall, id: string): Promise<Target> => {
    const place = placeOf(call);
    const content = await call.host.read(place.projectId);
    const sources = deriveProjectContextSources(content.views, null).get(call.caller) ?? [];
    const linked = sources.find((source) => source.id === id);
    const node = content.views.flatMap((view) => (isCanvasView(view) ? view.nodes : [])).find((candidate) => candidate.id === id);
    if (!node) {
        throw new VerbRefusal('unknown-node', `${id} is not a node of this project`, browserLines(sources));
    }
    if (node.kind !== 'browser') {
        throw new VerbRefusal('not-a-browser', `${id} is a ${node.kind} node, and only a browser node has a page to drive`, browserLines(sources));
    }
    if (!linked) {
        throw new VerbRefusal('not-linked', `No line runs between you and ${id}, and that line is what lets you drive its page`, [
            `see\truimte-context link new --to ${id}\tdraws it`,
            ...browserLines(sources)
        ]);
    }
    return { projectId: place.projectId, node };
};

/* The machine's door to a page, or the refusal for a machine built without one. */
const driverOf = (call: VerbCall): BrowserDriveHost => {
    const driver = call.host.browsers;
    if (!driver) {
        throw new VerbRefusal('unavailable', 'This machine cannot drive a page');
    }
    return driver;
};

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/* What an action answers with: where the page stands, or the one line saying nobody has it open. */
const pageLines = (id: string, outcome: DriveOutcome | null): string[] => {
    if (outcome === null) {
        return [`open\tno\tNobody has this page open right now, so nothing was driving it`];
    }
    const state = outcome.state;
    return [
        'open\tyes\tThe page answered',
        ...(state === null
            ? []
            : [
                  `page\t${id}\t${field(state.url)}\t${field(state.title)}`,
                  `loading\t${yesNo(state.loading)}`,
                  `back\t${yesNo(state.canGoBack)}`,
                  `forward\t${yesNo(state.canGoForward)}`
              ]),
        ...(outcome.error === undefined && (state === null || state.error === null) ? [] : [`error\t${field(outcome.error ?? state?.error ?? '')}`])
    ];
};

/* The actions that take nothing but the node: the page is told one word and answers where it stands. */
const plainAction = (word: string, summary: string, action: BrowserDriveAction, detail: readonly string[] = []) =>
    defineAction('browser', {
        name: word,
        usage: '<id>',
        summary,
        detail: [...detail, ...PRINTS_LINES, ...COMMON_DETAIL],
        positionals: z.tuple([z.string().min(1, `browser ${word} needs the id of a browser node`)], {
            error: (issue) =>
                issue.code === 'too_big' ? `browser ${word} takes one node id and nothing else` : `browser ${word} needs the id of a browser node`
        }),
        flags: z.object({}),
        async run({ positionals: [id] }, call) {
            const target = await targetOf(call, id);
            return pageLines(target.node.id, await driverOf(call).drive(id, action));
        }
    });

const stateAction = plainAction('state', 'Where the page of a browser node stands: its address, its title, whether it is loading and what its history holds', {
    kind: 'state'
});

const backAction = plainAction('back', 'Takes the page one step back through its own history', { kind: 'back' }, [
    'note\tA page with nothing behind it stays where it is and answers back no'
]);

const forwardAction = plainAction('forward', 'Takes the page one step forward again, after a step back', { kind: 'forward' }, [
    'note\tA page with nothing ahead of it stays where it is and answers forward no'
]);

const stopAction = plainAction('stop', 'Ends a load that is still running, leaving the page as far as it got', { kind: 'stop' });

const goAction = defineAction('browser', {
    name: 'go',
    usage: '<id> --url U',
    summary: 'Sends the page of a browser node to an address',
    detail: [
        'flag\t--url U\trequired\tA whole http or https address, scheme and all',
        'note\tA node that has no address yet is given this one, which is what starts its page at all; there the call writes the project file and the page opens for whoever shows that canvas',
        ...PRINTS_LINES,
        ...COMMON_DETAIL
    ],
    positionals: z.tuple([z.string().min(1, 'browser go needs the id of a browser node')], {
        error: (issue) => (issue.code === 'too_big' ? 'browser go takes one node id and the address in --url' : 'browser go needs the id of a browser node')
    }),
    flags: z.object({ url: z.string().min(1, '--url needs an http or https address') }),
    async run({ positionals: [id], flags }, call) {
        const url = checkUrl(flags.url);
        const target = await targetOf(call, id);
        if (!target.node.url) {
            /* The same step a person takes from the splash: an address on an empty node is what makes
               it a page, so it belongs in the project and not only in whatever client is looking. */
            await call.host.mutate(target.projectId, (content) => ({
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        'nodes' in view ? { ...view, nodes: view.nodes.map((node) => (node.id === id ? { ...node, url } : node)) } : view
                    )
                },
                result: undefined
            }));
            return [
                `open\tno\tThis node had no address yet, so ${url} is now the page it opens with`,
                `page\t${id}\t${field(url)}\t${field(target.node.title)}`
            ];
        }
        return pageLines(id, await driverOf(call).drive(id, { kind: 'go', url }));
    }
});

const reloadAction = defineAction('browser', {
    name: 'reload',
    usage: '<id> [--hard]',
    summary: 'Loads the page of a browser node again',
    detail: ['flag\t--hard\tno value\tLoads it past the cache, the way a person holding shift would', ...PRINTS_LINES, ...COMMON_DETAIL],
    positionals: z.tuple([z.string().min(1, 'browser reload needs the id of a browser node')], {
        error: (issue) => (issue.code === 'too_big' ? 'browser reload takes one node id and nothing else' : 'browser reload needs the id of a browser node')
    }),
    flags: z.object({}),
    switches: ['hard'],
    async run({ positionals: [id], switches }, call) {
        await targetOf(call, id);
        return pageLines(id, await driverOf(call).drive(id, { kind: 'reload', ignoreCache: switches.has('hard') }));
    }
});

const shotAction = defineAction('browser', {
    name: 'shot',
    usage: '<id>',
    summary: 'Writes a png of the page of a browser node and answers where it is',
    detail: [
        'prints\tshot\tpath\tthe png on this machine, which you open with your own tools',
        'prints\topen\tno\tsentence\twhen nobody has the page open, which is when no picture can be taken',
        'note\tThe file is this machine’s, not the project’s: it lives outside the project folder and is swept a day later',
        'note\tThe picture is what the page shows now, the visible part of it and no more',
        ...COMMON_DETAIL
    ],
    positionals: z.tuple([z.string().min(1, 'browser shot needs the id of a browser node')], {
        error: (issue) => (issue.code === 'too_big' ? 'browser shot takes one node id and nothing else' : 'browser shot needs the id of a browser node')
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        await targetOf(call, id);
        const outcome = await driverOf(call).shot(id);
        if (outcome === null) {
            return ['open\tno\tNobody has this page open right now, so there was nothing to photograph'];
        }
        if (outcome.path === null) {
            throw new VerbRefusal('shot-failed', outcome.error ?? 'The page could not be photographed');
        }
        const [, ...stand] = pageLines(id, { state: outcome.state });
        return ['open\tyes\tThe page answered', `shot\t${field(outcome.path)}\tRead it with your own tools`, ...stand];
    }
});

export const BROWSER_ACTIONS = [stateAction, goAction, backAction, forwardAction, reloadAction, stopAction, shotAction] as const;

export const BROWSER_SUMMARY = 'Drives a browser node you have a line to: where its page goes, through its history, and a picture of it';

export const BROWSER_DETAIL: readonly string[] = [
    'note\tOnly a page: a click, a keystroke and a scroll stay a person’s, and an agent works a page by its address',
    'see\truimte-context node new browser --url U\tputting a browser node on the canvas in the first place',
    'see\truimte-context read <id>\treading what the page says',
    SCOPE_LINE
];
