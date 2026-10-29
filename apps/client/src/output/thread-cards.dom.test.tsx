import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ArtifactSummary, ArtifactVersion, ChatInfo, ChatItem } from '@ruimte/contracts';
import { WORKSPACE_CHAT_HOST } from '@/chat/workspace-host';
import { useArtifactSelection } from '@/output/open';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, layOutChat, mount, openToolCall, until, type Mounted } from '../../testing/dom';
import { claudeProvider } from '../../testing/fake-provider';

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true });

const SHOT = '/work/atlas/screens/settings.png';

// A chat view per test, named apart from the last test's, so no row of one test is in the next.
let views = 0;
let chatId: string;
let saved: ArtifactSummary[];
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;

function infoOf(id: string): ChatInfo {
    return {
        chatId: id,
        createdAt: 0,
        provider: 'claude',
        cwd: '/work/atlas',
        agentSessionId: null,
        model: null,
        selection: { model: 'model', options: {} },
        runtimeMode: 'supervised',
        status: 'idle',
        running: false,
        activeTurnId: null,
        slashCommands: [],
        usage: { turns: 1, contextTokens: 0, contextWindow: 200_000, costUsd: 0 },
        background: []
    } as unknown as ChatInfo;
}

function readShot(): ChatItem {
    return {
        id: 'read-shot',
        kind: 'tool',
        createdAt: 1,
        turnId: null,
        toolUseId: 'read-shot',
        name: 'Read',
        input: { file_path: SHOT },
        output: '',
        state: 'done',
        parentToolUseId: null
    } as ChatItem;
}

function artifact(artifactId: string, title: string, kind: string): ArtifactSummary {
    const latest = {
        versionId: `${artifactId}-v1`,
        number: 1,
        createdAt: 1_761_400_000_000,
        files: [{ name: 'settings.png', mime: 'image/png', size: 4096, sha256: 'aa' }],
        bytes: 4096,
        provenance: { maker: 'person' as const, machineId: 'mac', chatId },
        copiedTo: []
    };
    return {
        artifactId,
        projectId: 'project-atlas',
        projectName: 'Atlas',
        title,
        kind,
        createdAt: latest.createdAt,
        latest,
        versionCount: 1,
        totalBytes: 4096
    };
}

function cards(): HTMLElement[] {
    return [...page.host.querySelectorAll('button[aria-label^="settings.png, "]')] as HTMLElement[];
}

function version(number: number, createdAt: number): ArtifactVersion {
    return {
        versionId: `shot-v${number}`,
        number,
        createdAt,
        files: [{ name: 'settings.png', mime: 'image/png', size: 4096 * number, sha256: `sha${number}` }],
        bytes: 4096 * number,
        provenance: { maker: 'person', machineId: 'mac', chatId },
        copiedTo: []
    };
}

function buttonWithText(label: string): HTMLElement | null {
    return ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

beforeEach(async () => {
    restoreLayout = layOutChat();
    views += 1;
    chatId = `chat-output${views}`;
    useArtifactSelection.setState({ versions: {} });
    saved = [];
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('chat.attach', ({ chatId: attached }) => ({ info: infoOf(attached), items: [readShot()], seq: 1 }) as never);
    machine.answer('fs.read', () => ({ kind: 'binary' as const, mime: 'image/png', size: 4096, mtime: 1 }));
    machine.answer('artifact.list', ({ chatId: asked }) => ({ artifacts: asked === chatId ? saved : [] }));
    machine.answer('artifact.save', () => {
        saved = [artifact('shot', 'settings.png', 'image')];
        return { artifactId: 'shot', versionId: 'shot-v1' };
    });
    const chat = { kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } };
    workspace = await openFakeWorkspace(machine, { views: [chat] } as never, { activeViewId: chatId, views: {} });
    page = mount();
    await page.renderApp();
    await openToolCall(page.host, 'read-shot');
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useFiles.setState({ tabs: [] });
    restoreLayout();
});

describe('what a chat saved to Output', () => {
    test('has no card while the chat made nothing', async () => {
        await until(() => machine.requests('artifact.list').some((payload) => payload.chatId === chatId));
        expect(cards()).toHaveLength(0);
    });

    test('a cleared thread loses its saved cards, including after a new message and reopening', async () => {
        saved = [artifact('shot', 'settings.png', 'image')];
        await act(async () => machine.emit('artifact.changed', { artifactId: 'shot', projectId: 'project-atlas' }));
        await until(() => cards().length === 1);
        await act(async () => machine.emit('chat.event', { chatId, event: { type: 'reset', info: infoOf(chatId), items: [] }, seq: 2 }));
        expect(page.host.querySelector('[data-find-item="read-shot"]')).toBeNull();
        expect(cards()).toHaveLength(0);

        const next = { ...readShot(), id: 'next-shot', createdAt: saved[0]!.latest.createdAt + 1 };
        await act(async () => machine.emit('chat.event', { chatId, event: { type: 'item', item: next }, seq: 3 }));
        expect(cards()).toHaveLength(0);

        machine.answer('chat.attach', () => ({ info: infoOf(chatId), items: [next], seq: 3 }) as never);
        await page.unmount();
        workspace.close();
        workspace = await openFakeWorkspace(machine, { views: [{ kind: 'chat', id: chatId, name: 'Agent', node: { provider: 'claude' } }] } as never, {
            activeViewId: chatId,
            views: {}
        });
        page = mount();
        await page.renderApp();
        await openToolCall(page.host, 'next-shot');
        expect(cards()).toHaveLength(0);
        expect(saved).toHaveLength(1);

        saved = [{ ...saved[0]!, latest: version(2, next.createdAt + 1), versionCount: 2 }];
        const renewed = saved[0]!;
        machine.answer('artifact.get', () => ({ artifact: renewed, versions: [renewed.latest, version(1, renewed.createdAt)], chatPresent: true }));
        await act(async () => machine.emit('artifact.changed', { artifactId: 'shot', projectId: 'project-atlas' }));
        await until(() => cards().length === 1);
        expect(cards()[0]!.textContent).toContain('Version 2 saved to Output');
    });

    test('a screenshot a tool read saves to Output and then stands as a card in the thread', async () => {
        await until(() => buttonWithText('Save to Output') !== null);
        await clickOn(buttonWithText('Save to Output'));
        await until(() => machine.requests('artifact.save').length === 1);
        const request = machine.requests('artifact.save')[0]!;
        expect(request.projectId).toBe('project-atlas');
        expect(request.source).toEqual({ kind: 'image', chatId, path: SHOT });
        expect(request.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

        await act(async () => machine.emit('artifact.changed', { artifactId: 'shot', projectId: 'project-atlas' }));
        await until(() => cards().length === 1);
        expect(cards()[0]!.textContent).toContain('Saved to Output');
        // A card is the client's own row: the thread on the wire gained nothing.
        expect(machine.requests('artifact.get')).toHaveLength(0);

        await clickOn(cards()[0]!);
        await until(() => useFiles.getState().tabs.some((tab) => tab.key === 'artifact:shot'));
        expect(useArtifactSelection.getState().versions['artifact:shot']).toBeUndefined();
    });

    test('a second version joins the card as a row of its own, and a row opens its version', async () => {
        saved = [{ ...artifact('shot', 'settings.png', 'image'), latest: version(2, 1_761_400_100_000), versionCount: 2 }];
        machine.answer('artifact.get', () => ({
            artifact: {
                artifactId: 'shot',
                projectId: 'project-atlas',
                projectName: 'Atlas',
                title: 'settings.png',
                kind: 'image',
                createdAt: 1_761_400_000_000
            },
            versions: [version(2, 1_761_400_100_000), version(1, 1_761_400_000_000)],
            chatPresent: true
        }));
        await act(async () => machine.emit('artifact.changed', { artifactId: 'shot', projectId: 'project-atlas' }));
        await until(() => cards().length === 2);
        expect(cards().map((card) => card.getAttribute('aria-label'))).toEqual(['settings.png, Saved to Output', 'settings.png, Version 2 saved to Output']);
        // Nothing in the thread began between the two, so they stand as one list.
        expect(cards()[0]!.parentElement).toBe(cards()[1]!.parentElement);
        expect(cards()[1]!.textContent).not.toContain('KB');

        await clickOn(cards()[0]!);
        await until(() => useFiles.getState().tabs.some((tab) => tab.key === 'artifact:shot'));
        expect(useArtifactSelection.getState().versions['artifact:shot']).toBe('shot-v1');
    });

    test('a row dragged onto the sidebar becomes a view of the project', async () => {
        saved = [artifact('shot', 'settings.png', 'image')];
        machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
        await act(async () => machine.emit('artifact.changed', { artifactId: 'shot', projectId: 'project-atlas' }));
        await until(() => cards().length === 1);

        const dataTransfer = new DataTransfer();
        const fire = (target: Element, type: string): void => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
            target.dispatchEvent(event);
        };
        const row = page.host.querySelector(`[data-sidebar-row="view:${chatId}"]`)!;
        await act(async () => {
            fire(cards()[0]!, 'dragstart');
            fire(row, 'dragover');
            fire(row, 'drop');
            fire(cards()[0]!, 'dragend');
        });

        await until(() => useDocument.getState().views.some((view) => view.kind === 'artifact'));
        expect(useDocument.getState().views.find((view) => view.kind === 'artifact')).toMatchObject({
            name: 'settings.png',
            node: { artifact: { id: 'shot' } }
        });
    });

    test('a report an agent published shows its text under its row, so the reply need not repeat it', async () => {
        const body = '# Morning summary\n\n| Check | State |\n| --- | --- |\n| Build | green |\n';
        const report = artifact('morning', 'Morning summary', 'report');
        saved = [
            {
                ...report,
                latest: {
                    ...report.latest,
                    files: [{ name: 'morning.md', mime: 'text/markdown', size: body.length, sha256: 'bb' }],
                    provenance: { maker: 'agent', machineId: 'mac', chatId }
                }
            }
        ];
        machine.answer('bytes.read', ({ offset }) => ({ mime: 'text/markdown', size: body.length, version: 'v', offset, data: btoa(body.slice(offset)) }));
        await act(async () => machine.emit('artifact.changed', { artifactId: 'morning', projectId: 'project-atlas' }));

        await until(() => page.host.querySelector('[role="group"][aria-label="Morning summary"]')?.textContent?.includes('green') === true);
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'artifact', artifactId: 'morning', versionId: 'morning-v1', file: 0 });
        expect(page.host.querySelector('button[aria-label="Morning summary, Saved to Output"]')).not.toBeNull();
    });

    test('a visual and a generated image offer Save to Output, which names them by id', async () => {
        const visualActions = WORKSPACE_CHAT_HOST.visuals!.actions!(workspaceEndpoint(), chatId, {
            id: 'visual-1',
            title: 'Suite timings',
            at: 1,
            maxHeight: 600,
            size: 10
        });
        expect(visualActions.map((action) => action.label)).toEqual(['Save to Output']);
        await act(async () => visualActions[0]!.run());
        await until(() => machine.requests('artifact.save').length === 1);
        expect(machine.requests('artifact.save')[0]).toMatchObject({ title: 'Suite timings', source: { kind: 'visual', chatId, visualId: 'visual-1' } });

        const image = { id: 'image-1', name: 'chart.png', mime: 'image/png', size: 10, path: '/x/chart.png' };
        const imageActions = WORKSPACE_CHAT_HOST.attachments!.actions!(workspaceEndpoint(), chatId, image);
        await act(async () => imageActions[0]!.run());
        await until(() => machine.requests('artifact.save').length === 2);
        expect(machine.requests('artifact.save')[1]!.source).toEqual({ kind: 'attachment', chatId, attachmentId: 'image-1' });
        expect(WORKSPACE_CHAT_HOST.attachments!.actions!(workspaceEndpoint(), chatId, { ...image, mime: 'application/pdf' })).toEqual([]);
    });
});

/* The machine the window's project is on, which is the scope a chat of it hands the host. */
function workspaceEndpoint(): string {
    return useProject.getState().currentEndpointId ?? '';
}
