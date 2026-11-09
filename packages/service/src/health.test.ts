import { describe, expect, test } from 'bun:test';
import { probeHealth, settledHealth, waitForHealth } from './health';

function answering(body: unknown): (url: string, init: RequestInit) => Promise<Response> {
    return async () => Response.json(body);
}

describe('probeHealth', () => {
    test('reads the health a daemon gives', async () => {
        expect(await probeHealth(4210, { fetch: answering({ ok: true, version: '0.4.0', build: 'x', service: true }) })).toEqual({
            version: '0.4.0',
            build: 'x',
            service: true,
            starting: false
        });
    });

    test('an older daemon says nothing of its build or of the service', async () => {
        expect(await probeHealth(4210, { fetch: answering({ ok: true, version: '0.3.0' }) })).toEqual({
            version: '0.3.0',
            build: null,
            service: null,
            starting: false
        });
    });

    test('a daemon that still wires itself is a Ruimte machine that is starting, whatever its status', async () => {
        const starting = async () => Response.json({ ok: true, version: '0.4.0', build: 'x', starting: true }, { status: 503 });

        expect(await probeHealth(4210, { fetch: starting })).toEqual({ version: '0.4.0', build: 'x', service: null, starting: true });
    });

    test('a plain 503 is still no Ruimte', async () => {
        expect(await probeHealth(4210, { fetch: async () => new Response('The machine is starting', { status: 503 }) })).toBeNull();
    });

    test('asks the port on loopback, bounded', async () => {
        let asked: { url: string; signal: AbortSignal | null | undefined } | null = null;
        await probeHealth(4321, {
            fetch: async (url, init) => {
                asked = { url, signal: init.signal };
                return Response.json({ ok: true, version: '1' });
            }
        });
        expect(asked).not.toBeNull();
        expect(asked!.url).toBe('http://127.0.0.1:4321/health');
        expect(asked!.signal).toBeInstanceOf(AbortSignal);
    });

    test('anything else is no Ruimte', async () => {
        expect(await probeHealth(4210, { fetch: answering({ status: 'up' }) })).toBeNull();
        expect(await probeHealth(4210, { fetch: answering('ok') })).toBeNull();
        expect(await probeHealth(4210, { fetch: answering(null) })).toBeNull();
        expect(await probeHealth(4210, { fetch: async () => new Response('<html>', { status: 502 }) })).toBeNull();
    });

    test('a port nobody answers is no Ruimte', async () => {
        expect(
            await probeHealth(4210, {
                fetch: async () => {
                    throw new TypeError('Unable to connect');
                }
            })
        ).toBeNull();
    });
});

describe('waitForHealth', () => {
    function clock() {
        let time = 0;
        return { now: () => time, sleep: async (ms: number) => void (time += ms) };
    }

    test('resolves once the answer is one `accept` takes', async () => {
        const { now, sleep } = clock();
        const builds = ['old', 'old', 'new'];
        await waitForHealth(4210, (health) => health.build === 'new', {
            now,
            sleep,
            fetch: async () => Response.json({ ok: true, version: '1', build: builds.shift() })
        });
        expect(builds).toEqual([]);
    });

    test('keeps asking while nothing answers, then gives up', async () => {
        const { now, sleep } = clock();
        let asked = 0;
        const failed = waitForHealth(4210, () => true, {
            within: 100,
            now,
            sleep,
            fetch: async () => {
                asked += 1;
                throw new TypeError('Unable to connect');
            }
        });
        await expect(failed).rejects.toThrow('The background service did not come up');
        expect(asked).toBeGreaterThan(1);
    });

    test('does not take a daemon that still starts, whatever `accept` says', async () => {
        const { now, sleep } = clock();
        const answers = [{ starting: true }, { starting: true }, {}];
        let asked = 0;
        await waitForHealth(4210, () => true, {
            now,
            sleep,
            fetch: async () => {
                asked += 1;

                return Response.json({ ok: true, version: '1', ...answers.shift() });
            }
        });
        expect(asked).toBe(3);
    });
});

describe('settledHealth', () => {
    function clock() {
        let time = 0;
        return { now: () => time, sleep: async (ms: number) => void (time += ms) };
    }

    test('waits while the daemon starts and answers what it says when done', async () => {
        const { now, sleep } = clock();
        const answers = [{ starting: true }, { starting: true }, { service: true }];
        const health = await settledHealth(4210, {
            now,
            sleep,
            fetch: async () => Response.json({ ok: true, version: '1', ...answers.shift() })
        });
        expect(health).toEqual({ version: '1', build: null, service: true, starting: false });
        expect(answers).toEqual([]);
    });

    test('answers null at once for a port that is no Ruimte', async () => {
        const { now, sleep } = clock();
        let asked = 0;
        const health = await settledHealth(4210, {
            now,
            sleep,
            fetch: async () => {
                asked += 1;

                return new Response('nope', { status: 503 });
            }
        });
        expect(health).toBeNull();
        expect(asked).toBe(1);
    });

    test('gives the last answer, still starting, when the time is up', async () => {
        const { now, sleep } = clock();
        const health = await settledHealth(4210, {
            within: 100,
            now,
            sleep,
            fetch: async () => Response.json({ ok: true, version: '1', starting: true }, { status: 503 })
        });
        expect(health?.starting).toBe(true);
    });
});
