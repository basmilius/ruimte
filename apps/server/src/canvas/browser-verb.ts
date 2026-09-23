import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field, SCOPE_LINE } from './verb.ts';

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
    'line\tA line between you and that node is what lets you drive it, whichever way it was drawn, the same line that lets you read the page',
    'page\tThe page lives where it is shown: in the app of whoever has this project open, or on this machine for a client that has no browser of its own',
    'page\tNobody watching is not a failure; the call says open no, changes nothing, and the same call later reaches whoever is there then',
    'see\truimte-context read <id>\tthe address and the text of the page, which is how you read what you navigated to',
    SCOPE_LINE
];

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/* What an action answers with: where the page stands, or the one line saying nobody has it open. */
const pageLines = ({ nodeId, open, page, error }: ActionOutput<'browser.inspect'>): string[] => {
    if (!open) {
        return [`open\tno\tNobody has this page open right now, so nothing was driving it`];
    }
    return [
        'open\tyes\tThe page answered',
        ...(page === null
            ? []
            : [
                  `page\t${nodeId}\t${field(page.url)}\t${field(page.title)}`,
                  `loading\t${yesNo(page.loading)}`,
                  `back\t${yesNo(page.canGoBack)}`,
                  `forward\t${yesNo(page.canGoForward)}`
              ]),
        ...(error === null ? [] : [`error\t${field(error)}`])
    ];
};

const NODE_PARAM = { syntax: '<id>', need: 'required', field: 'nodeId', more: 'ruimte-context list names the ones linked to you' } as const;

/* The actions that take nothing but the node: the page is told one word and answers where it stands. */
const plainAction = (word: string, action: 'browser.inspect' | 'browser.back' | 'browser.forward' | 'browser.stop', detail: readonly string[] = []) =>
    defineActionVerb('browser', {
        name: word,
        action,
        usage: '<id>',
        params: [NODE_PARAM],
        detail: [...detail, ...PRINTS_LINES, ...COMMON_DETAIL],
        positionals: z.tuple([z.string().min(1, `browser ${word} needs the id of a browser node`)], {
            error: (issue) =>
                issue.code === 'too_big' ? `browser ${word} takes one node id and nothing else` : `browser ${word} needs the id of a browser node`
        }),
        flags: z.object({}),
        async run({ positionals: [id] }, call) {
            return pageLines(await runAction(call, action, { nodeId: id }));
        }
    });

const stateAction = plainAction('state', 'browser.inspect');

const backAction = plainAction('back', 'browser.back', ['note\tA page with nothing behind it stays where it is and answers back no']);

const forwardAction = plainAction('forward', 'browser.forward', ['note\tA page with nothing ahead of it stays where it is and answers forward no']);

const stopAction = plainAction('stop', 'browser.stop');

const goAction = defineActionVerb('browser', {
    name: 'go',
    action: 'browser.navigate',
    usage: '<id> --url U',
    params: [NODE_PARAM, { syntax: '--url U', need: 'required', field: 'url' }],
    detail: [
        'note\tA node that has no address yet is given this one, which is what starts its page at all; there the call writes the project file and the page opens for whoever shows that canvas',
        ...PRINTS_LINES,
        ...COMMON_DETAIL
    ],
    positionals: z.tuple([z.string().min(1, 'browser go needs the id of a browser node')], {
        error: (issue) => (issue.code === 'too_big' ? 'browser go takes one node id and the address in --url' : 'browser go needs the id of a browser node')
    }),
    flags: z.object({ url: z.string().min(1, '--url needs an http or https address') }),
    async run({ positionals: [id], flags }, call) {
        const went = await runAction(call, 'browser.navigate', { nodeId: id, url: flags.url });
        if (went.assigned !== null) {
            return [
                `open\tno\tThis node had no address yet, so ${went.assigned.url} is now the page it opens with`,
                `page\t${id}\t${field(went.assigned.url)}\t${field(went.assigned.title)}`
            ];
        }
        return pageLines(went);
    }
});

const reloadAction = defineActionVerb('browser', {
    name: 'reload',
    action: 'browser.reload',
    usage: '<id> [--hard]',
    params: [NODE_PARAM, { syntax: '--hard', need: 'no value', field: 'hard' }],
    detail: [...PRINTS_LINES, ...COMMON_DETAIL],
    positionals: z.tuple([z.string().min(1, 'browser reload needs the id of a browser node')], {
        error: (issue) => (issue.code === 'too_big' ? 'browser reload takes one node id and nothing else' : 'browser reload needs the id of a browser node')
    }),
    flags: z.object({}),
    switches: ['hard'],
    async run({ positionals: [id], switches }, call) {
        return pageLines(await runAction(call, 'browser.reload', { nodeId: id, hard: switches.has('hard') }));
    }
});

const shotAction = defineActionVerb('browser', {
    name: 'shot',
    action: 'browser.screenshot',
    usage: '<id>',
    params: [NODE_PARAM],
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
        const shot = await runAction(call, 'browser.screenshot', { nodeId: id });
        if (!shot.open || shot.path === null) {
            return ['open\tno\tNobody has this page open right now, so there was nothing to photograph'];
        }
        const [, ...stand] = pageLines(shot);
        return ['open\tyes\tThe page answered', `shot\t${field(shot.path)}\tRead it with your own tools`, ...stand];
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
