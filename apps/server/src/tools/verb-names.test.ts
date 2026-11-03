import { expect, test } from 'bun:test';
import { CONTEXT_VERBS } from '@ruimte/contracts';
import { VERBS } from './verbs';

// A verb the client does not know reads as plain "Ruimte" in a chat, so a new one has to reach the list.
test('the verbs a client names are the verbs ruimte-context answers, in the same order', () => {
    expect(VERBS.map(({ name }) => name)).toEqual([...CONTEXT_VERBS]);
});
