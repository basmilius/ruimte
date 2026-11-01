import { afterEach, describe, expect, test } from 'bun:test';
import { renderMessageActions, renderToolResult } from '@/extensions/chat-seams';
import { contribute } from '@/extensions/registry';
import { mount, type Mounted } from '../../testing/dom';

let mounted: Mounted | null = null;
const disposers: (() => void)[] = [];

afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    disposers.splice(0).forEach((dispose) => dispose());
});

const READ = { name: 'Read', input: {}, output: 'text', state: 'done' };

describe('what an extension draws in a chat', () => {
    test('takes only the tools it named, and leaves the others to the thread', async () => {
        disposers.push(contribute('toolResults', { id: 'a/read', tools: ['Read'], component: ({ call }) => <span>Drawn: {call.output}</span> }));

        expect(renderToolResult({ ...READ, name: 'Write' })).toBeNull();

        mounted = mount();
        await mounted.render(renderToolResult(READ));

        expect(mounted.host.textContent).toBe('Drawn: text');
    });

    test('adds to a message what asks for that message', async () => {
        disposers.push(
            contribute('slotEntries', {
                id: 'a/quote',
                kind: 'action',
                title: 'Quote',
                slots: { messageActions: (context) => (context as { message: { kind: string } }).message.kind === 'assistant' },
                run: () => undefined
            })
        );
        mounted = mount();
        await mounted.render(renderMessageActions({ chatId: 'chat', id: 'one', kind: 'user', text: 'Hi' }));

        expect(mounted.host.querySelector('button')).toBeNull();

        await mounted.render(renderMessageActions({ chatId: 'chat', id: 'two', kind: 'assistant', text: 'Hello' }));

        expect(mounted.host.querySelector('button')?.getAttribute('aria-label')).toBe('Quote');
    });
});
