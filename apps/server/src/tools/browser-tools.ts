import { ToolRefusal } from '@adecore/agents/context';
import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { field, yesNo } from '../canvas/host.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { defineTool, defineToolkit, VIEW_INPUT } from './tool.ts';

const NEEDS_ID = 'id needs the id of a browser node';

const ID_INPUT = z.string({ error: NEEDS_ID }).min(1, NEEDS_ID);

const HISTORY_ACTIONS = ['back', 'forward', 'reload', 'stop'] as const;

/* What a tool answers with: where the page stands, or the one line saying nobody has it open. */
function pageLines({ nodeId, open, page, error }: ActionOutput<'browser.inspect'>): string[] {
    if (!open) {
        return ['open\tno\tNobody has this page open right now, so nothing was driving it'];
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
}

const browserState = defineActionTool('browser', {
    name: 'browser_state',
    action: 'browser.inspect',
    description: "Reads a browser node's address, title, loading state and history.",
    annotations: { readOnly: true },
    input: z.object({ id: ID_INPUT, view: VIEW_INPUT }),
    async run(input, call) {
        return pageLines(await runAction(call, 'browser.inspect', { nodeId: input.id, viewId: input.view ?? null }));
    }
});

const browserGo = defineActionTool('browser', {
    name: 'browser_go',
    action: 'browser.navigate',
    description: 'Sends a browser node to an address.',
    input: z.object({
        id: ID_INPUT,
        url: z.string({ error: 'browser_go needs url, an http or https address' }).min(1, 'url needs an http or https address'),
        view: VIEW_INPUT
    }),
    async run(input, call) {
        const went = await runAction(call, 'browser.navigate', { nodeId: input.id, viewId: input.view ?? null, url: input.url });

        if (went.assigned !== null) {
            return [
                `open\tno\tThis node had no address yet, so ${went.assigned.url} is now the page it opens with`,
                `page\t${input.id}\t${field(went.assigned.url)}\t${field(went.assigned.title)}`
            ];
        }

        return pageLines(went);
    }
});

const browserHistory = defineTool('browser', {
    name: 'browser_history',
    description: 'Moves a browser node back or forward, reloads it or stops its loading.',
    input: z.object({
        action: z.enum(HISTORY_ACTIONS, { error: `browser_history needs action, one of ${HISTORY_ACTIONS.join(', ')}` }),
        id: ID_INPUT,
        view: VIEW_INPUT,
        hard: z.boolean({ error: 'hard is true or false' }).optional().describe('With reload, past the cache')
    }),
    async run(input, call) {
        const target = { nodeId: input.id, viewId: input.view ?? null };

        if (input.hard !== undefined && input.action !== 'reload') {
            throw new ToolRefusal('bad-arguments', `hard goes only with reload, and browser_history ${input.action} takes none`);
        }

        switch (input.action) {
            case 'back':
                return pageLines(await runAction(call, 'browser.back', target));
            case 'forward':
                return pageLines(await runAction(call, 'browser.forward', target));
            case 'reload':
                return pageLines(await runAction(call, 'browser.reload', { ...target, hard: input.hard === true }));
            case 'stop':
                return pageLines(await runAction(call, 'browser.stop', target));
        }
    }
});

const browserShot = defineActionTool('browser', {
    name: 'browser_shot',
    action: 'browser.screenshot',
    description: "Takes a png of a browser node's page.",
    annotations: { readOnly: true },
    input: z.object({ id: ID_INPUT, view: VIEW_INPUT }),
    async run(input, call) {
        const shot = await runAction(call, 'browser.screenshot', { nodeId: input.id, viewId: input.view ?? null });

        if (!shot.open || shot.path === null) {
            return ['open\tno\tNobody has this page open right now, so there was nothing to photograph'];
        }

        const [, ...stand] = pageLines(shot);
        call.image(shot.path);

        return ['open\tyes\tThe page answered', `shot\t${field(shot.path)}\tRead it with your own tools`, ...stand];
    }
});

export const browserToolkit = defineToolkit('browser', [browserState, browserGo, browserHistory, browserShot]);
