import { describe, expect, test } from 'bun:test';
import { wireCanvasHost } from '../wiring/canvas-host.ts';
import { AGENT_FEATURES } from './list.ts';

/* A stand-in for every service: any property is another one, and calling it answers one. */
function anyService(): object {
    const target = (): object => anyService();

    return new Proxy(target, { get: (_target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : anyService()), apply: () => anyService() });
}

describe('agent features', () => {
    test('are named once each', () => {
        const names = AGENT_FEATURES.map((feature) => feature.name);

        expect(new Set(names).size).toBe(names.length);
    });

    test('define no action twice, and preview only what they define', () => {
        const defined = AGENT_FEATURES.flatMap((feature) => Object.keys(feature.actions ?? {}));

        expect(new Set(defined).size).toBe(defined.length);

        for (const feature of AGENT_FEATURES) {
            for (const name of feature.previews ?? []) {
                expect(Object.keys(feature.actions ?? {})).toContain(name);
            }
        }
    });

    test('fill each field of the host once', () => {
        const input = Object.fromEntries(
            [
                'identity',
                'stores',
                'providers',
                'agents',
                'projects',
                'work',
                'launches',
                'git',
                'devices',
                'databases',
                'extensions',
                'remote',
                'usage',
                'artifacts',
                'routines',
                'templates',
                'later'
            ].map((key) => [key, anyService()])
        ) as unknown as Parameters<typeof wireCanvasHost>[1];

        expect(() => wireCanvasHost(AGENT_FEATURES, input)).not.toThrow();
    });
});
