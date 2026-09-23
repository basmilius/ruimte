import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import {
    deriveProjectContextSources,
    isCanvasView,
    type BrowserDriveAction,
    type BrowserPageState,
    type ContextSource,
    type ProjectNode
} from '@ruimte/contracts';
import type { DriveOutcome } from '../browser/drive.ts';
import { checkUrl } from '../canvas/nodes.ts';
import { VerbRefusal, field, orNote, type BrowserDriveHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

/* Every browser node this caller may drive, for a refusal that offers what the next call takes. */
const browserLines = (sources: readonly ContextSource[]): string[] =>
    orNote(
        sources.filter((source) => source.kind === 'browser').map((source) => `browser\t${source.id}\t${field(source.title)}\t${field(source.text ?? '')}`),
        'No browser node is linked to you; ruimte-context link new --to <id> draws the line to one'
    );

/*
 * The node an action works on. A browser node of this project, with a line between it and the
 * caller: the same line a read takes, since driving a page and reading it are one permission.
 */
const targetOf = async ({ host, place }: ServerActionContext, caller: string, id: string): Promise<ProjectNode> => {
    const content = await host.read(place.projectId);
    const sources = deriveProjectContextSources(content.views, null).get(caller) ?? [];
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
    return node;
};

/* The machine's door to a page, or the refusal for a machine built without one. */
const driverOf = ({ host }: ServerActionContext): BrowserDriveHost => {
    const driver = host.browsers;
    if (!driver) {
        throw new VerbRefusal('unavailable', 'This machine cannot drive a page');
    }
    return driver;
};

const pageOf = (state: BrowserPageState | null): ActionOutput<'browser.inspect'>['page'] =>
    state === null ? null : { url: state.url, title: state.title, loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward };

/* Where the page stands after the drive; nobody holding it is an answer, never an error. */
const outcomeOf = (nodeId: string, outcome: DriveOutcome | null): ActionOutput<'browser.inspect'> =>
    outcome === null
        ? { nodeId, open: false, page: null, error: null }
        : { nodeId, open: true, page: pageOf(outcome.state), error: outcome.error ?? outcome.state?.error ?? null };

/*
 * Only what the page's address and its own history do: a click, a keystroke and a scroll stay a
 * person's, so no action here takes one.
 */
const drive = async (context: ServerActionContext, caller: string, nodeId: string, action: BrowserDriveAction) => {
    await targetOf(context, caller, nodeId);
    return { output: outcomeOf(nodeId, await driverOf(context).drive(nodeId, action)) };
};

export const browserActions: ActionHandlers<ServerActionContext> = {
    'browser.inspect': async ({ nodeId }, { actor, context }) => drive(context, actor.id, nodeId, { kind: 'state' }),
    'browser.back': async ({ nodeId }, { actor, context }) => drive(context, actor.id, nodeId, { kind: 'back' }),
    'browser.forward': async ({ nodeId }, { actor, context }) => drive(context, actor.id, nodeId, { kind: 'forward' }),
    'browser.stop': async ({ nodeId }, { actor, context }) => drive(context, actor.id, nodeId, { kind: 'stop' }),
    'browser.reload': async ({ nodeId, hard }, { actor, context }) => drive(context, actor.id, nodeId, { kind: 'reload', ignoreCache: hard }),
    'browser.navigate': async ({ nodeId, url }, { actor, context }) => {
        const checked = checkUrl(url);
        const node = await targetOf(context, actor.id, nodeId);
        if (!node.url) {
            /* The same step a person takes from the splash: an address on an empty node is what makes
               it a page, so it belongs in the project and not only in whatever client is looking. */
            await context.host.mutate(context.place.projectId, (content) => ({
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        'nodes' in view
                            ? { ...view, nodes: view.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, url: checked } : candidate)) }
                            : view
                    )
                },
                result: undefined
            }));
            return { output: { nodeId, open: false, page: null, error: null, assigned: { url: checked, title: node.title } } };
        }
        const outcome = await driverOf(context).drive(nodeId, { kind: 'go', url: checked });
        return { output: { ...outcomeOf(nodeId, outcome), assigned: null } };
    },
    'browser.screenshot': async ({ nodeId }, { actor, context }) => {
        await targetOf(context, actor.id, nodeId);
        const outcome = await driverOf(context).shot(nodeId);
        if (outcome === null) {
            return { output: { nodeId, open: false, page: null, error: null, path: null } };
        }
        if (outcome.path === null) {
            throw new VerbRefusal('shot-failed', outcome.error ?? 'The page could not be photographed');
        }
        return { output: { nodeId, open: true, page: pageOf(outcome.state), error: outcome.state?.error ?? null, path: outcome.path } };
    }
};
