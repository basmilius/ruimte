import { describe, expect, test } from 'bun:test';
import { HealthResultSchema, MACHINE_HEALTH_PATH } from '@ruimte/contracts';
import { answerDoorway, startingResponse } from './http.ts';

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

describe('answerDoorway', () => {
    const server = {} as Parameters<typeof answerDoorway>[2];

    test.each(['Cf-Ray', 'Cf-Connecting-Ip'])('refuses a request with %s while the machine starts, without saying what it is', async (header) => {
        const response = await answerDoorway(null, new Request(`http://127.0.0.1:4210${MACHINE_HEALTH_PATH}`, { headers: { [header]: 'x' } }), server);

        expect(response?.status).toBe(403);
        expect(await response?.text()).not.toContain('starting');
    });

    test('refuses a tunnelled request before the routes see it', async () => {
        const handlers = {
            fetch: () => new Response('routes'),
            websocket: {}
        } as unknown as Parameters<typeof answerDoorway>[0];
        const response = await answerDoorway(handlers, new Request('http://127.0.0.1:4210/fs/file', { headers: { 'Cf-Ray': 'x' } }), server);

        expect(response?.status).toBe(403);
    });

    test('answers the starting response to a plain request until the routes are handed over', async () => {
        const response = await answerDoorway(null, new Request(`http://127.0.0.1:4210${MACHINE_HEALTH_PATH}`), server);

        expect(response?.status).toBe(503);
    });
});
