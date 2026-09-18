import { expect, test } from 'bun:test';

import { CONTEXT_PROMPT } from './fake-codex.ts';

test('the fake recognizes the persisted linked-context prompt', () => {
    expect(CONTEXT_PROMPT).toBe(
        'The person linked context to this chat on their canvas. Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item, whenever it could help.'
    );
});
