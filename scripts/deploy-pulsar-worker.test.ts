import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { deployPulsarWorker } from './deploy-pulsar-worker.ts';

describe('Worker deployment', () => {
    test('migrates and deploys before refreshing, with only a digest in Wrangler arguments', async () => {
        const commands: string[][] = [];
        let requests = 0;
        const startedAt = Date.now();
        await deployPulsarWorker(
            async (args) => {
                commands.push(args);
            },
            async (url, init) => {
                requests++;
                expect(commands).toHaveLength(2);
                expect(commands[0]).toEqual(['d1', 'migrations', 'apply', 'ruimte-pulsar', '--remote']);
                expect(commands[1][0]).toBe('deploy');
                expect(url).toBe('https://pulsar.ruimte.app/internal/benchmarks/refresh');
                expect(init.method).toBe('POST');
                expect(init.redirect).toBe('error');
                const token = new Headers(init.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
                expect(token).toMatch(/^[a-f0-9]{64}$/);
                expect(commands.flat().join(' ')).not.toContain(token);
                expect(commands[1]).toContain(`BENCHMARK_REFRESH_TOKEN_HASH:${createHash('sha256').update(token).digest('base64url')}`);
                const expiry = Number(commands[1].find((arg) => arg.startsWith('BENCHMARK_REFRESH_TOKEN_EXPIRES_AT:'))?.split(':')[1]);
                expect(expiry).toBeGreaterThanOrEqual(startedAt + 15 * 60_000);
                expect(expiry).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
                return Response.json({ refreshed: true, fetchedAt: 123, measurements: 70 });
            }
        );
        expect(requests).toBe(1);
    });

    test('a failed migration or deploy stops before consuming API quota', async () => {
        for (const failedCommand of ['d1', 'deploy']) {
            const commands: string[] = [];
            let requests = 0;
            await expect(
                deployPulsarWorker(
                    async (args) => {
                        commands.push(args[0]);
                        if (args[0] === failedCommand) {
                            throw new Error('Wrangler failed');
                        }
                    },
                    async () => {
                        requests++;
                        return Response.json({ refreshed: true });
                    }
                )
            ).rejects.toThrow('Wrangler failed');
            expect(commands).toEqual(failedCommand === 'd1' ? ['d1'] : ['d1', 'deploy']);
            expect(requests).toBe(0);
        }
    });

    test('fails the workflow when refresh fails or returns an unconfirmed or empty result, without retries', async () => {
        for (const [status, body] of [
            [502, { refreshed: false }],
            [429, {}],
            [200, null],
            [200, {}],
            [200, { refreshed: true, fetchedAt: 123, measurements: 0 }]
        ] as const) {
            let requests = 0;
            await expect(
                deployPulsarWorker(
                    async () => {},
                    async () => {
                        requests++;
                        return Response.json(body, { status });
                    }
                )
            ).rejects.toThrow('Worker deployed, but');
            expect(requests).toBe(1);
        }
    });

    test('waits for deployment propagation only while the old Worker rejects the request', async () => {
        const tokens: string[] = [];
        const waits: number[] = [];
        const statuses = [404, 401, 200];
        await deployPulsarWorker(
            async () => {},
            async (_url, init) => {
                tokens.push(new Headers(init.headers).get('authorization')!);
                return Response.json({ refreshed: true, fetchedAt: 123, measurements: 70 }, { status: statuses.shift()! });
            },
            async (milliseconds) => {
                waits.push(milliseconds);
            }
        );
        expect(tokens).toHaveLength(3);
        expect(new Set(tokens).size).toBe(1);
        expect(waits).toEqual([5_000, 5_000]);
    });

    test('gives up after a bounded wait when the new Worker never becomes available', async () => {
        for (const status of [401, 404]) {
            let requests = 0;
            let elapsed = 0;
            await expect(
                deployPulsarWorker(
                    async () => {},
                    async () => {
                        requests++;
                        return new Response(null, { status });
                    },
                    async (milliseconds) => {
                        elapsed += milliseconds;
                    }
                )
            ).rejects.toThrow(`HTTP ${status}`);
            expect(requests).toBe(12);
            expect(elapsed).toBe(55_000);
        }
    });

    test('reports an unconfirmed refresh after a network or JSON error without leaking request details', async () => {
        for (const networkError of [true, false]) {
            let requests = 0;
            await expect(
                deployPulsarWorker(
                    async () => {},
                    async (_url, init) => {
                        requests++;
                        if (networkError) {
                            throw new Error(new Headers(init.headers).get('authorization')!);
                        }
                        return new Response('not JSON');
                    }
                )
            ).rejects.toThrow('Worker deployed, but the benchmark refresh');
            expect(requests).toBe(1);
        }
    });
});
