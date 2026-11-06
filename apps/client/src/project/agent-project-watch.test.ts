import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { UNDO_MS } from '@adecore/ui';
import type { ProjectSummary } from '@ruimte/contracts';
import { SHOW_TOAST_ID } from '@/project/show-toast';
import { useToasts } from '@/state/toasts';
import { activateProject, askToClose, useAgentCloseAsk, type AgentProjectDeps } from './agent-project-watch';

const TARGET: ProjectSummary = {
    projectId: 'atlas',
    name: 'Atlas',
    color: '#000',
    folder: '/work/atlas',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

const PAYLOAD = { projectId: 'atlas', fromProjectId: 'home', by: 'chat-1' };

/* A window on `shown`, which a successful open moves to the project it opened. */
function fakeWindow(options: Partial<Pick<AgentProjectDeps, 'open' | 'listed'>> & { shown?: string; follow?: boolean } = {}) {
    let shown = options.shown ?? 'home';
    let asked = 0;
    const opened: string[] = [];
    const fake: AgentProjectDeps = {
        showing: (_endpointId, projectId) => projectId === shown,
        listed: options.listed ?? ((_endpointId, projectId) => (projectId === TARGET.projectId ? TARGET : null)),
        follow: () => options.follow ?? true,
        open:
            options.open ??
            (async (_endpointId, projectId) => {
                opened.push(projectId);
                shown = projectId;

                return 'done';
            }),
        closing: async () => {
            asked += 1;

            return { sessions: 2, otherClients: 0 };
        }
    };

    return { deps: fake, opened, asked: () => asked };
}

function card() {
    return useToasts.getState().toasts.find((toast) => toast.id === SHOW_TOAST_ID) ?? null;
}

beforeEach(() => {
    jest.useFakeTimers();
    useToasts.setState({ toasts: [] });
});

afterEach(() => {
    useAgentCloseAsk.setState({ ask: null });
    useToasts.getState().dismiss(SHOW_TOAST_ID);
    useToasts.setState({ toasts: [] });
    jest.useRealTimers();
});

describe('an agent bringing a project to the front', () => {
    test('with switching on, the window opens it and the toast leads back', async () => {
        const here = fakeWindow();
        await activateProject('m', PAYLOAD, here.deps);

        expect(here.opened).toEqual(['atlas']);
        expect(card()).toMatchObject({ kind: 'success', title: 'An agent brought Atlas to the front', lifetime: UNDO_MS, action: { label: 'Back' } });

        card()?.action?.run();

        expect(here.opened).toEqual(['atlas', 'home']);
        expect(card()).toBeNull();
    });

    test('with switching off, nothing moves and the toast offers to go there', async () => {
        const here = fakeWindow({ follow: false });
        await activateProject('m', PAYLOAD, here.deps);

        expect(here.opened).toEqual([]);
        expect(card()).toMatchObject({ title: 'An agent asked you to look at Atlas', action: { label: 'Go there' } });

        card()?.action?.run();

        expect(here.opened).toEqual(['atlas']);
    });

    test('a newer request replaces the toast of the one before', async () => {
        await activateProject('m', PAYLOAD, fakeWindow({ follow: false }).deps);
        await activateProject('m', PAYLOAD, fakeWindow().deps);

        expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['An agent brought Atlas to the front']);
    });

    test('a window on another project, or a project another window took up, gets no toast', async () => {
        const elsewhere = fakeWindow({ shown: 'other' });
        await activateProject('m', PAYLOAD, elsewhere.deps);

        expect(elsewhere.opened).toEqual([]);
        expect(card()).toBeNull();

        await activateProject('m', PAYLOAD, fakeWindow({ open: async () => 'done' }).deps);

        expect(card()).toBeNull();
    });
});

describe('an agent asking to close a project', () => {
    test('raises the confirmation with what closing ends, and closes nothing itself', async () => {
        const here = fakeWindow();
        await askToClose('m', PAYLOAD, here.deps);

        expect(useAgentCloseAsk.getState().ask).toEqual({
            endpointId: 'm',
            projectId: 'atlas',
            name: 'Atlas',
            agent: 'An agent',
            sessions: 2,
            otherClients: 0
        });
        expect(here.opened).toEqual([]);
    });

    test('asks nothing in a window on another project or for a project already under Recent', async () => {
        const elsewhere = fakeWindow({ shown: 'other' });
        await askToClose('m', PAYLOAD, elsewhere.deps);
        const recent = fakeWindow({ listed: () => ({ ...TARGET, closedAt: 1 }) });
        await askToClose('m', PAYLOAD, recent.deps);

        expect(elsewhere.asked() + recent.asked()).toBe(0);
        expect(useAgentCloseAsk.getState().ask).toBeNull();
    });
});
