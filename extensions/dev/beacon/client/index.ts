import { chats, defineAction, definePanel, defineWidget, host, storage, type Result } from '@ruimte/extension/client';
import { checkDevice, checkPage, lastReport, notes, NOTES, reportMessage, type LastReport } from './checks';

const TEST_PLAN = 'Write a test plan for this project: the flows a person goes through, and what to check in each.';

const panel = definePanel({ id: 'beacon', title: 'Beacon', component: () => import('./BeaconPanel') });

function valueOf<Value>(result: Result<Value>): Value {
    if (!result.ok) {
        throw new Error(result.error.message);
    }

    return result.value;
}

function tell(report: LastReport): void {
    const count = report.findings.length;

    host.notify(count === 0 ? `Nothing found in ${report.subject}` : `${count === 1 ? '1 finding' : `${count} findings`} in ${report.subject}`, {
        action: { title: 'Open Beacon', run: () => panel.open() }
    });
}

defineAction({
    id: 'check-page',
    title: 'Check this page',
    icon: 'scan-search',
    slots: { browserToolbar: true, nodeHeader: ({ node }) => node.kind === 'browser' },
    run: async ({ node }) => tell(await checkPage(node))
});

defineAction({
    id: 'check-device',
    title: 'Check this screen',
    icon: 'scan-search',
    slots: { nodeHeader: ({ node }) => node.kind === 'device' },
    run: async ({ node }) => tell(await checkDevice(node))
});

defineAction({ id: 'open', title: 'Open Beacon', icon: 'radio-tower', slots: { browserMenu: true }, run: () => panel.open() });

defineAction<'composer'>({
    id: 'send-report',
    title: 'Send the last report',
    icon: 'radio-tower',
    slots: { composer: () => (lastReport() === null ? { disabled: 'Check a page first' } : true) },
    run: async ({ chat }) => {
        const report = lastReport();

        if (report !== null) {
            valueOf(await chats.send(chat.id, reportMessage(report)));
        }
    }
});

defineAction({
    id: 'test-plan',
    title: 'Ask for a test plan',
    icon: 'list-checks',
    slots: { emptyThread: true },
    run: async ({ chat }) => valueOf(await chats.send(chat.id, TEST_PLAN))
});

defineAction({
    id: 'note',
    title: 'Add to the next report',
    icon: 'notebook-pen',
    slots: { messageActions: ({ message }) => message.kind === 'assistant' },
    run: ({ message }) => {
        valueOf(storage.set(NOTES, [...notes(), message.text]));
        host.notify('Added to the next report');
    }
});

defineWidget({ id: 'notes', slots: { threadHeader: true }, component: () => import('./NotesBadge') });
