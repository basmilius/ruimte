import { expect, test } from 'bun:test';
import { createTestHost } from '@ruimte/extension/testing';
import { createElement, use, useState } from 'react';

/* A file of its own: the host waits out all its turns here, and `ruimte extension test` runs it in a process of its own. */
test('a test host rejects a click that leaves the surface waiting on what it suspends on', async () => {
    const host = await createTestHost();
    const never = new Promise<string>(() => undefined);
    const Waits = () => createElement('p', null, use(never));
    const Start = () => {
        const [started, setStarted] = useState(false);

        return started ? createElement(Waits) : createElement('button', { type: 'button', onClick: () => setStarted(true) }, 'Start');
    };
    const screen = await host.render(Start);

    await expect(screen.click('Start')).rejects.toThrow('It is still waiting for what it suspends on');
});
