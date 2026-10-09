import { expect, test } from 'bun:test';
import type { ChatItem, TerminalPrepareSource } from '@ruimte/contracts';
import { hasPrepareSource } from './prepare-source.ts';

const source: TerminalPrepareSource = { chatId: 'chat', itemId: 'reply', language: 'sh', code: 'echo ok\n' };
function reply(text: string): ChatItem {
    return { id: 'reply', kind: 'assistant', text, streaming: false, createdAt: 0, turnId: null };
}

test('requires the exact line in a closed shell fence of a finished main reply', () => {
    expect(hasPrepareSource(reply('```sh\necho ok\n```'), source)).toBe(true);
    for (const text of [
        '```sh\necho ok',
        '```sh\necho other\n```',
        '```js\necho ok\n```',
        '```sh\necho ok\necho more\n```',
        '~~~text\n```sh\necho ok\n```\n~~~'
    ]) {
        expect(hasPrepareSource(reply(text), source)).toBe(false);
    }
    const item = reply('```sh\necho ok\n```');
    if (item.kind !== 'assistant') {
        throw new Error('fixture');
    }
    expect(hasPrepareSource({ ...item, streaming: true }, source)).toBe(false);
    expect(hasPrepareSource({ ...item, parentToolUseId: 'child' }, source)).toBe(false);
    expect(hasPrepareSource({ ...item, id: 'another' }, source)).toBe(false);
});
