import {
    agents,
    canvas,
    chats,
    defineAction,
    defineMenu,
    defineNode,
    defineOverlay,
    definePanel,
    files,
    git,
    host,
    views,
    type NodeInfo
} from '@ruimte/extension/client';

const panel = definePanel<{ from: string }>({ id: 'workspace', title: 'POC workspace', icon: 'layers', component: () => import('./WorkspacePanel') });

const picker = defineOverlay<{ title: string }, string>({ id: 'picker', title: 'POC overlay', size: 'sm', component: () => import('./PickerOverlay') });
const fromOverlay = defineAction({
    id: 'overlay',
    title: 'Open an overlay',
    run: async () => host.notify((await picker.open({ title: 'Which one?' })) ?? 'Dismissed')
});

defineNode({ id: 'stamp', title: 'POC stamp', icon: 'stamp', initialData: { at: '' }, component: () => import('./StampNode') });

const openPanel = defineAction({ id: 'open-panel', title: 'Open with params', slots: { commandPalette: true }, run: ({ slot }) => panel.open({ from: slot }) });
const badge = defineAction({ id: 'badge', title: 'Set a badge', run: () => panel.setBadge('3') });
const stamp = defineAction({ id: 'stamp', title: 'Add a stamp', run: () => void canvas.createNode('stamp', { data: { at: new Date().toISOString() } }) });
const note = defineAction({
    id: 'readme',
    title: 'README as a file node',
    run: () => void canvas.createFile('README.md')
});
const log = defineAction({
    id: 'log',
    title: 'Write the git log to poc-log.json',
    run: async () => {
        const entries = await git.log({ limit: 5 });

        await files.write('poc-log.json', JSON.stringify(entries, null, 4));
        files.open('poc-log.json');
    }
});
const rename = defineAction<{ node: NodeInfo }>({
    id: 'rename',
    title: 'Rename, through a dialog',
    run: async ({ node }) => {
        const title = await host.prompt({ title: 'New title', initial: node.title });

        if (title !== null) {
            canvas.update(node, { title });
        }
    }
});
const newView = defineAction({
    id: 'new-view',
    title: 'Make a canvas, after asking',
    run: async () => {
        if (await host.confirm({ title: 'Make a canvas', body: 'Adds a view called POC.' })) {
            views.open(views.createCanvas('POC'));
        }
    }
});
const pick = defineAction({
    id: 'pick',
    title: 'Pick from a list',
    run: async () => {
        const fruit = await host.pick({ title: 'Which?', items: ['Apple', 'Pear'], label: (item) => item });

        host.notify(fruit ?? 'Nothing');
    }
});

defineMenu({
    id: 'menu',
    title: 'POC workspace',
    icon: 'layers',
    slots: { canvasMenu: true, nodeMenu: true },
    items: [openPanel, badge, fromOverlay, 'separator', stamp, note, log, newView, pick, rename]
});

defineAction({
    id: 'follow-up',
    title: 'Ask for a test',
    icon: 'message-circle',
    slots: { composer: true },
    run: ({ chat }) => chats.send(chat.id, 'Write a test for what you just did.')
});

defineAction({
    id: 'second-opinion',
    title: 'Start a second opinion',
    icon: 'users',
    slots: { nodeMenu: ({ node }) => node.kind === 'chat' && node.agent?.status === 'idle' },
    run: async ({ node }) => {
        const text = await chats.read(node.id);
        const chat = await agents.start({ title: 'Second opinion', prompt: `Review this conversation:\n\n${text}`, near: [node] });

        canvas.link(node, chat);
        canvas.reveal(chat);
    }
});
