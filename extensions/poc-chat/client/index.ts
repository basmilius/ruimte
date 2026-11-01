import {
    canvas,
    defineAction,
    defineDiffViewer,
    defineExtensionSettings,
    defineFileIcon,
    definePanel,
    defineReference,
    defineSlashCommand,
    defineTemplate,
    defineVoiceAction,
    files,
    host,
    type NodeInfo
} from '@ruimte/extension/client';

defineExtensionSettings({
    fields: [
        { key: 'greeting', type: 'text', label: 'Greeting', description: 'What /greet says', default: 'Hello' },
        { key: 'loud', type: 'boolean', label: 'Loud', default: false },
        {
            key: 'tone',
            type: 'select',
            label: 'Tone',
            default: 'plain',
            options: [
                { value: 'plain', label: 'Plain' },
                { value: 'formal', label: 'Formal' }
            ]
        }
    ]
});

defineSlashCommand({
    name: 'review',
    description: 'Asks for a review of what you name',
    run: (args) => `Review ${args || 'the last change'} and list what could break.`
});
defineSlashCommand({ name: 'readme', description: 'Puts the README in the prompt', run: () => files.readText('README.md') });

const ISSUES = [
    { id: '1', name: 'POC issue: login fails' },
    { id: '2', name: 'POC issue: slow canvas' }
];

defineReference({
    id: 'issues',
    title: 'POC issues',
    list: async () => ISSUES,
    read: async (issue) => `Issue "${issue.name}": steps to reproduce are in the tracker.`
});

definePanel({ id: 'stream', title: 'POC chat', icon: 'radio', component: () => import('./ChatPanel') });

defineVoiceAction({ id: 'count', description: 'Says how many nodes are selected', run: () => 'Nothing is selected in this example' });

defineTemplate({
    id: 'trio',
    title: 'Three notes',
    icon: 'layout-grid',
    create: ({ at }) => {
        const notes = ['One', 'Two', 'Three'].flatMap((text) => canvas.createNote({ text }) ?? []);

        canvas.arrange(notes, 'row');

        if (notes[0] !== undefined) {
            canvas.update(notes[0], { x: at.x, y: at.y });
        }
    }
});

defineAction({
    id: 'shortcut',
    title: 'POC shortcut',
    shortcut: 'mod+alt+k',
    run: () =>
        host.notify('From a shortcut', {
            action: { title: 'Open settings', run: () => host.openSettings() }
        })
});

defineAction({
    id: 'remove',
    title: 'Remove, after asking',
    icon: 'trash',
    slots: { nodeMenu: ({ node }) => node.kind === 'note' },
    run: ({ nodes }: { nodes: NodeInfo[] }) => canvas.remove(nodes).then(() => undefined)
});

for (const slot of ['projectMenu', 'sidebarFooter', 'editorStatusBar'] as const) {
    defineAction({ id: `in-${slot}`, title: `POC in ${slot}`, icon: 'radio', slots: { [slot]: true } as never, run: () => host.notify(`From ${slot}`) });
}

defineFileIcon({ extensions: ['poc'], path: 'assets/poc-file.svg' });
defineDiffViewer({ id: 'stat', title: 'Lines', extensions: ['poc'], component: () => import('./DiffStat') });
