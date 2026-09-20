import { describe, expect, test } from 'bun:test';
import { VoiceToolQueue } from './tool-queue';

describe('voice tool project boundaries', () => {
    test('a project switch invalidates calls already queued for its old workspace', async () => {
        let revision = 0;
        const queue = new VoiceToolQueue(() => revision);
        const order: string[] = [];
        const switching = queue.run(async () => {
            order.push('switch');
            revision++;
        });
        const stale = queue.run(async () => {
            order.push('wrong project');
        });
        await switching;
        await expect(stale).rejects.toThrow('project changed');
        await queue.run(async () => {
            order.push('new workspace');
        });
        expect(order).toEqual(['switch', 'new workspace']);
    });

    test('ending a session prevents queued tool calls from executing', async () => {
        const queue = new VoiceToolQueue(() => 0);
        const pending = queue.run(async () => 'must not execute');
        queue.cancel();
        await expect(pending).rejects.toThrow('voice session');
    });

    test('a failed tool does not block later calls', async () => {
        const queue = new VoiceToolQueue(() => 0);
        await expect(
            queue.run(async () => {
                throw new Error('offline');
            })
        ).rejects.toThrow('offline');
        expect(await queue.run(async () => 'recovered')).toBe('recovered');
    });
});
