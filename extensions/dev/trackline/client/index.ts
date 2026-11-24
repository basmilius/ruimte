import {
    canvas,
    defineAction,
    defineExtensionSettings,
    defineNode,
    definePaletteSource,
    definePanel,
    defineReference,
    defineSidebarCard,
    defineSlashCommand,
    getServer,
    host,
    onEvent
} from '@ruimte/extension/client';
import type { TracklineServer } from '../server/index';
import { ISSUE_NODE, keyOf, startChat } from './issues';

const server = getServer<TracklineServer>();
const panel = definePanel<{ issue: string }>({ id: 'issues', title: 'Trackline', component: () => import('./IssuesPanel') });

/* The number of open issues on the panel's tab, or none while the account is not connected. */
async function countOpen(): Promise<void> {
    const issues = await server.issues();

    panel.setBadge(issues.ok ? String(issues.value.filter((issue) => issue.state === 'open').length) : null);
}

defineSidebarCard({ id: 'open', title: 'Trackline', component: () => import('./OpenIssuesCard') });

defineNode<{ key: string }>({
    id: ISSUE_NODE,
    title: 'Trackline issue',
    icon: 'ticket',
    size: { width: 320, height: 200 },
    initialData: { key: '' },
    component: () => import('./IssueNode')
});

defineReference({
    id: 'issues',
    title: 'Trackline issues',
    list: async () => {
        const issues = await server.issues();

        return issues.ok ? issues.value.map((issue) => ({ id: issue.key, name: `${issue.key} ${issue.title}` })) : [];
    },
    read: async (issue) => {
        const text = await server.text(issue.id);

        return text.ok ? text.value : `(${issue.name} could not be read: ${text.error.message})`;
    }
});

defineSlashCommand({
    name: 'issue',
    description: 'Puts a Trackline issue in the prompt, by its key',
    run: async (args) => {
        const key = args.trim();

        if (key === '') {
            return 'Name an issue after /issue, such as TRK-101.';
        }

        const text = await server.text(key);

        return text.ok ? `Work on this issue.\n\n${text.value}` : `(${key} could not be read: ${text.error.message})`;
    }
});
defineSlashCommand({
    name: 'triage',
    description: 'Asks for a Trackline issue written from what you describe',
    run: (args) => `Write this up as a Trackline issue with a title, steps to reproduce and a severity: ${args || 'what we just found'}`
});

definePaletteSource({
    id: 'issues',
    title: 'Trackline',
    search: async (query) => {
        const issues = await server.issues();
        const words = query.trim().toLowerCase();

        if (!issues.ok || words.length < 2) {
            return [];
        }

        return issues.value
            .filter((issue) => `${issue.key} ${issue.title}`.toLowerCase().includes(words))
            .map((issue) => ({ id: issue.key, title: `${issue.key} ${issue.title}`, detail: issue.state, run: () => panel.open({ issue: issue.key }) }));
    }
});

defineAction({
    id: 'connect',
    title: 'Connect Trackline',
    icon: 'key-round',
    slots: { commandPalette: true },
    run: async () => {
        const key = await host.prompt({ title: 'Your Trackline key', placeholder: 'trk_' });

        if (key === null) {
            return;
        }

        const account = await server.connect(key);

        if (!account.ok) {
            throw new Error(account.error.message);
        }

        host.notify(`Connected as ${account.value}`);
        await countOpen();
    }
});

defineAction({
    id: 'show',
    title: 'Show in Trackline',
    icon: 'ticket',
    slots: { nodeMenu: ({ node }) => node.extension?.type === ISSUE_NODE && keyOf(node) !== '' },
    run: ({ node }) => panel.open({ issue: keyOf(node) })
});

defineAction({
    id: 'start-chat',
    title: 'Start a chat on this issue',
    icon: 'message-circle-plus',
    slots: {
        nodeHeader: ({ node }) => node.extension?.type === ISSUE_NODE && keyOf(node) !== '' && { title: 'Start a chat' },
        nodeMenu: ({ node }) => node.extension?.type === ISSUE_NODE && keyOf(node) !== ''
    },
    run: async ({ node }) => {
        const chat = await startChat(node, keyOf(node));

        if (!chat.ok) {
            throw new Error(chat.error.message);
        }
    }
});

defineAction({
    id: 'add',
    title: 'Add a Trackline issue',
    icon: 'ticket',
    slots: { canvasMenu: true },
    run: async () => {
        const issues = await server.issues();

        if (!issues.ok) {
            throw new Error(issues.error.message);
        }

        const issue = await host.pick({ title: 'Which issue?', items: issues.value, label: (each) => `${each.key} ${each.title}` });

        if (issue === null) {
            return;
        }

        const node = canvas.createNode(ISSUE_NODE, { data: { key: issue.key }, title: issue.key });

        if (!node.ok) {
            throw new Error(node.error.message);
        }

        canvas.reveal(node.value);
    }
});

defineExtensionSettings({
    groups: [
        {
            title: 'Issues',
            description: 'Which issues the card and the panel list.',
            fields: [
                { key: 'mine', type: 'boolean', label: 'Only mine', description: 'Leaves out issues assigned to someone else', default: false },
                { key: 'closed', type: 'boolean', label: 'Closed issues', default: false }
            ]
        },
        {
            title: 'Order',
            fields: [
                {
                    key: 'order',
                    type: 'select',
                    label: 'Order',
                    default: 'service',
                    options: [
                        { value: 'service', label: 'As Trackline lists them' },
                        { value: 'key', label: 'By key' }
                    ]
                }
            ]
        }
    ]
});

onEvent('project.opened', () => void countOpen());
void countOpen();
