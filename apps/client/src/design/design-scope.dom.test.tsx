import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useDesignChat } from '@/design/design-chat';
import { useDesignPages } from '@/design/design-files';
import { DesignStage } from '@/design/DesignStage';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { useWorkspace } from '@/transport/connections';
import { TransportError } from '@/transport/transport';
import { chatInfoOf } from '../../testing/chat-info';
import { layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let mounted: Mounted;
let restoreLayout: () => void;

beforeEach(async () => {
    localStorage.clear();
    useDesignChat.setState({ picked: {}, pages: {}, cameras: {} });
    restoreLayout = layOutChat();
    machine = new FakeMachine();
    machine.answer('fs.list', ({ path }) => {
        if (path === '/work/b') {
            throw new TransportError('not-readable', 'Folder B is unreadable');
        }

        return {
            path,
            entries: [{ name: 'only-in-a.html', path: '/work/a/only-in-a.html', kind: 'file' as const, size: 1, mtime: 1, hidden: false, ignored: false }],
            truncated: false
        };
    });
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    mounted = mount();
});

afterEach(async () => {
    await mounted.unmount();
    workspace.close();
    restoreLayout();
});

function Scoped({ children }: { children: React.ReactNode }) {
    const scoped = useWorkspace();

    return scoped === null ? null : <ConnectionProvider connection={scoped.connection}>{children}</ConnectionProvider>;
}

function Probe({ folder }: { folder: string }) {
    const { pages, problem } = useDesignPages('fake-machine', folder, '/work');

    return <output>{JSON.stringify({ folder, pages, problem })}</output>;
}

describe('a design folder that changes under a mounted reader', () => {
    test('the pages hook shows no page of the folder before it once the new folder cannot be read', async () => {
        await mounted.render(
            <Scoped>
                <Probe folder="/work/a" />
            </Scoped>
        );
        await until(() => mounted.host.textContent?.includes('only-in-a.html') === true);

        await mounted.render(
            <Scoped>
                <Probe folder="/work/b" />
            </Scoped>
        );
        await until(() => mounted.host.textContent?.includes('Folder B is unreadable') === true);

        expect(JSON.parse(mounted.host.textContent!)).toEqual({ folder: '/work/b', pages: [], problem: 'Folder B is unreadable' });
    });

    test('the stage shows the problem of the new folder instead of the pages of the folder before it', async () => {
        await mounted.render(
            <Scoped>
                <DesignStage designId="design" chatId="chat" folder="/work/a" watched="/work" />
            </Scoped>
        );
        await until(() => mounted.host.textContent?.includes('only-in-a') === true);

        await mounted.render(
            <Scoped>
                <DesignStage designId="design" chatId="chat" folder="/work/b" watched="/work" />
            </Scoped>
        );
        await until(() => mounted.host.textContent?.includes('Folder B is unreadable') === true);

        expect(mounted.host.textContent).not.toContain('only-in-a');
    });
});
