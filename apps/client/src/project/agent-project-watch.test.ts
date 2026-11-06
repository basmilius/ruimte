import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { keptNotice } from '@/state/document-model';
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

afterEach(() => {
    useAgentCloseAsk.setState({ ask: null });
});

describe('an agent bringing a project to the front', () => {
    test('with switching on, the window opens it and the banner leads back', async () => {
        const here = fakeWindow();
        await activateProject('m', PAYLOAD, here.deps);

        expect(here.opened).toEqual(['atlas']);
        expect(useDocument.getState().viewNotice).toEqual({
            message: 'An agent brought Atlas to the front',
            action: { kind: 'project', endpointId: 'm', projectId: 'home', back: true }
        });
    });

    test('with switching off, nothing moves and the banner offers to go there', async () => {
        const here = fakeWindow({ follow: false });
        await activateProject('m', PAYLOAD, here.deps);

        expect(here.opened).toEqual([]);
        expect(useDocument.getState().viewNotice).toEqual({
            message: 'An agent asked you to look at Atlas',
            action: { kind: 'project', endpointId: 'm', projectId: 'atlas', back: false }
        });
    });

    test('a window on another project, or a project another window took up, gets no banner', async () => {
        const elsewhere = fakeWindow({ shown: 'other' });
        await activateProject('m', PAYLOAD, elsewhere.deps);

        expect(elsewhere.opened).toEqual([]);
        expect(useDocument.getState().viewNotice).toBeNull();

        await activateProject('m', PAYLOAD, fakeWindow({ open: async () => 'done' }).deps);

        expect(useDocument.getState().viewNotice).toBeNull();
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

test('a banner about a project outlives a change of the views, since it names no view', () => {
    const notice = { message: 'Atlas', action: { kind: 'project', endpointId: 'm', projectId: 'atlas', back: false } } as const;

    expect(keptNotice(notice, [])).toBe(notice);
});
