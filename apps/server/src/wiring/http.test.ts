import { describe, expect, test } from 'bun:test';
import { HealthResultSchema, MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { startingResponse } from './http.ts';

describe('startingResponse', () => {
    test('says on the health path that this machine is starting', async () => {
        const response = startingResponse(new Request(`http://127.0.0.1:4210${MACHINE_HEALTH_PATH}`));

        expect(response.status).toBe(503);

        const parsed = HealthResultSchema.safeParse(await response.json());

        expect(parsed.success && parsed.data.starting).toBe(true);
    });

    test('answers every other path with plain text', async () => {
        const response = startingResponse(new Request('http://127.0.0.1:4210/fs/file'));

        expect(response.status).toBe(503);
        expect(await response.text()).toBe('The machine is starting');
    });

    test('answers a health request of another method with plain text', async () => {
        const response = startingResponse(new Request(`http://127.0.0.1:4210${MACHINE_HEALTH_PATH}`, { method: 'POST' }));

        expect(response.status).toBe(503);
        expect(await response.text()).toBe('The machine is starting');
    });
});
