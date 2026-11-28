import { describe, expect, test } from 'bun:test';
import { createTestHost, createTestServer, refusal, type TestHostOptions } from '@ruimte/extension/testing';
import type { BeaconServer } from '../server';

const NODES = [
    { id: 'browser-1', kind: 'browser', title: 'Shop', url: 'http://localhost:3000/checkout' },
    { id: 'device-1', kind: 'device', title: 'Phone' },
    { id: 'chat-1', kind: 'chat', title: 'Fixes', agent: { status: 'idle' as const } }
];
const PAGE = { url: 'http://localhost:3000/checkout/', title: 'Checkout', loading: false, canGoBack: true, canGoForward: false };
const DEVICE = { name: 'Phone 17', platform: 'ios' as const, kind: 'simulator' as const, runtime: '27.0' };
const CAN = { shot: true, input: true, type: true, launch: true };
const CHAT = { chat: { id: 'chat-1' }, node: { id: 'chat-1' } };

interface Published {
    files: { name: string; text?: string }[];
    title?: string;
    kind?: string;
    key?: string;
}

async function hostWith(options: TestHostOptions = {}, page: typeof PAGE | null = PAGE) {
    const server = await createTestServer<BeaconServer>();
    const published: Published[] = [];
    const host = await createTestHost({
        project: { nodes: NODES },
        ...options,
        answers: {
            server,
            'agents.run': ({ context }) => ({ text: `${context?.length ?? 0} things to fix, the labels first.` }),
            'machine.run': {
                'browser.inspect': ({ node }) => ({ node, open: page !== null, page, error: null }),
                'browser.screenshot': ({ node }) => ({ node, open: true, page, error: null, path: '/tmp/shot.png' }),
                'device.inspect': ({ node }) => ({ node, device: DEVICE, present: true, state: 'booted', screen: null, buttons: [], can: CAN }),
                'device.screenshot': ({ node }) => ({ node, path: '/tmp/screen.png', width: 1206, height: 2622 }),
                'device.list': () => ({ devices: [{ ...DEVICE, id: 'phone', state: 'booted' }] }),
                'artifact.publish': (input) => {
                    published.push(input);

                    return {
                        artifact: { id: 'artifact-1', title: input.title ?? '', kind: 'report', key: input.key ?? null, createdAt: 0 },
                        version: { id: 'v1', number: 1 },
                        existing: false
                    };
                }
            },
            ...options.answers
        }
    });

    return { host, published };
}

describe('Beacon', () => {
    test('checks the page of a browser against the rules, and keeps a report with a summary in Output', async () => {
        const { host, published } = await hostWith();
        const check = host.action('check-page');

        expect(host.slot(check, 'nodeHeader', { node: { id: 'chat-1' } })).toBeNull();
        expect(await host.run(check, 'browserToolbar', { node: { id: 'browser-1' }, url: PAGE.url })).toEqual({ ok: true, value: undefined });

        expect(published).toHaveLength(1);
        expect(published[0]).toMatchObject({ title: 'Beacon: Checkout', kind: 'report', key: 'beacon-localhost-3000-checkout' });
        expect(published[0]?.files[0]?.text).toBe(
            [
                '# Beacon: Checkout',
                '',
                'Checked: http://localhost:3000/checkout/',
                '- Title: Checkout',
                '- Picture: /tmp/shot.png',
                '',
                '3 things to fix, the labels first.',
                '',
                '## Findings (3)',
                '',
                '- **high** The card number field has no label, so a screen reader announces nothing. (labels)',
                '- **high** A refused card shows no message. (errors)',
                '- **medium** The Pay button cannot be reached with the keyboard. (focus)',
                ''
            ].join('\n')
        );
        expect(host.notifications).toEqual([{ text: '3 findings in http://localhost:3000/checkout/', tone: 'neutral', action: 'Open Beacon' }]);
        expect(host.storage.computer.last).toMatchObject({ title: 'Beacon: Checkout', artifact: 'artifact-1' });
    });

    test('keeps the report without a summary when no agent answers', async () => {
        const { host, published } = await hostWith({
            answers: {
                'agents.run': () => {
                    throw refusal('unavailable', 'No agent on this machine');
                }
            }
        });

        await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } });

        expect(published[0]?.files[0]?.text).not.toContain('things to fix');
        expect(host.storage.computer.last).toMatchObject({ summary: null });
    });

    test('says so when the browser has no page open, and keeps nothing', async () => {
        const { host, published } = await hostWith({}, null);

        expect(await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } })).toEqual({
            ok: false,
            error: { code: 'failed', message: 'Open the page in this browser first' }
        });
        expect(published).toEqual([]);
    });

    test('refuses a check without browser.control, and shows the person why', async () => {
        const { host } = await hostWith({ manifest: { permissions: { 'artifacts.write': 'Keeps' } } });

        expect(await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } })).toEqual({
            ok: false,
            error: { code: 'failed', message: 'Beacon did not ask for the permission browser.control in its manifest' }
        });
    });

    test('checks the screen of a device that runs, with its own report', async () => {
        const { host, published } = await hostWith();
        const check = host.action('check-device');

        expect(host.slot(check, 'nodeHeader', { node: { id: 'browser-1' } })).toBeNull();
        expect(await host.run(check, 'nodeHeader', { node: { id: 'device-1' } })).toEqual({ ok: true, value: undefined });
        expect(published[0]).toMatchObject({ title: 'Beacon: Phone 17', key: 'beacon-phone-17' });
        expect(published[0]?.files[0]?.text).toContain('- ios 27.0\n- Picture: /tmp/screen.png');
        expect(host.notifications[0]?.text).toBe('1 finding in Phone 17');
    });

    test('sends a chat the last report, and offers that only once there is one', async () => {
        const sent: [string, string][] = [];
        const { host } = await hostWith({ answers: { 'chats.send': (chat, text) => void sent.push([chat, text]) } });
        const send = host.action('send-report');

        expect(host.slot(send, 'composer', CHAT)).toMatchObject({ disabled: 'Check a page first' });

        await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } });

        expect(host.slot(send, 'composer', CHAT)).toMatchObject({ disabled: false });
        expect(await host.run(send, 'composer', CHAT)).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([
            [
                'chat-1',
                [
                    'Beacon checked http://localhost:3000/checkout/ and found 3 things to fix:',
                    '- high: The card number field has no label, so a screen reader announces nothing.',
                    '- high: A refused card shows no message.',
                    '- medium: The Pay button cannot be reached with the keyboard.',
                    '',
                    'Fix these, the high ones first.'
                ].join('\n')
            ]
        ]);
    });

    test('asks an empty chat for a test plan', async () => {
        const sent: string[] = [];
        const { host } = await hostWith({ answers: { 'chats.send': (_chat, text) => void sent.push(text) } });

        await host.run(host.action('test-plan'), 'emptyThread', { chat: { id: 'chat-1' } });

        expect(sent).toEqual(['Write a test plan for this project: the flows a person goes through, and what to check in each.']);
    });

    test('keeps what an agent said as a note for the next report, counted over the thread, and starts over after it', async () => {
        const { host, published } = await hostWith();
        const note = host.action('note');
        const message = { id: 'message-1', kind: 'assistant' as const, text: 'The Pay button also overlaps the footer.' };
        const badge = await host.render(host.widget('notes'), { context: host.context('threadHeader', CHAT) });

        expect(host.slot(note, 'messageActions', { chat: { id: 'chat-1' }, message: { ...message, kind: 'user' } })).toBeNull();
        expect(badge.text()).toBe('');

        await host.run(note, 'messageActions', { chat: { id: 'chat-1' }, message });
        await badge.until(() => badge.text() === '1 note for the next report');
        await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } });

        expect(published[0]?.files[0]?.text).toContain('## Notes\n\n- The Pay button also overlaps the footer.\n');
        expect(host.storage.computer.notes).toBeUndefined();
    });

    test('opens its panel from the menu of a browser, with the last report and an answer that streams until it is stopped', async () => {
        const { host } = await hostWith({
            answers: {
                'agents.stream': async function* ({ signal }) {
                    yield 'Label the field. ';
                    yield 'Show the refusal.';
                    await new Promise((resolve) => signal.addEventListener('abort', resolve));
                }
            }
        });

        await host.run(host.action('open'), 'browserMenu');

        expect(host.panels.beacon?.open).toBe(true);

        const panel = await host.render(host.panel('beacon'));

        expect(panel.text()).toContain('Check a page from the bar of a browser');

        await host.run(host.action('check-page'), 'nodeHeader', { node: { id: 'browser-1' } });
        await panel.until(() => panel.find('Beacon: Checkout') !== null);
        await panel.click('Explain the fixes');
        await panel.until(() => panel.find('Label the field. Show the refusal.') !== null);
        await panel.click('Stop');

        expect(host.agents.calls.map((call) => call.method)).toEqual(['agents.run', 'agents.stream']);
    });

    test('says which databases of the project answer, and which devices the machine has', async () => {
        const { host } = await hostWith({
            answers: {
                'database.connections': () => [
                    { id: 'main', name: 'Main' },
                    { id: 'reports', name: 'Reports' }
                ],
                'database.query': (connection) => {
                    if (connection === 'reports') {
                        throw refusal('unavailable', 'The server is not running');
                    }

                    return { columns: ['ready'], rows: [[1]], hasMore: false };
                }
            }
        });
        const panel = await host.render(host.panel('beacon'));

        await panel.click('Check the databases');
        await panel.until(() => panel.find('Main answers') !== null);

        expect(panel.text()).toContain('Reports: The server is not running');

        await panel.click('Find devices');
        await panel.until(() => panel.find('Phone 17: booted') !== null);
    });
});
