import { afterEach, describe, expect, test } from 'bun:test';
import { PortGrants, portsStore } from './port-grants.ts';
import { deniedRuimtePorts, reservedPorts, WELL_KNOWN_RUIMTE_PORTS } from './reserved-ports.ts';

const released: Array<() => void> = [];

afterEach(() => {
    released.splice(0).forEach((release) => release());
});

function grantsWithRuimtePorts(own: number[] = []): PortGrants {
    return new PortGrants({
        store: portsStore(undefined),
        deniedPorts: () => deniedRuimtePorts(own),
        random: () => 'g',
        now: () => 1,
        changed: () => undefined
    });
}

describe('the ports of Ruimte itself', () => {
    test('cover a dev and an installed daemon side by side, with their doors and external listeners', () => {
        for (const port of [4210, 4211, 4212, 4213, 4220, 4221, 4230, 4231]) {
            expect(WELL_KNOWN_RUIMTE_PORTS).toContain(port);
        }

        expect(WELL_KNOWN_RUIMTE_PORTS).not.toContain(3000);
        expect(WELL_KNOWN_RUIMTE_PORTS).not.toContain(5173);
    });

    test('are refused for a grant whichever daemon this is, and the own ports of this daemon too', () => {
        const grants = grantsWithRuimtePorts([5555]);

        for (const port of [4210, 4211, 4213, 4221, 4231, 5555]) {
            expect(() => grants.share('project-1', port, '127.0.0.1', 'person')).toThrow(/belongs to Ruimte/);
        }

        expect(grants.share('project-1', 3000, '127.0.0.1', 'person').port).toBe(3000);
    });

    test('hold a port a proxy of Ruimte listens on until it is released, and are read again at every open', () => {
        const grants = grantsWithRuimtePorts();
        const grant = grants.share('project-1', 40123, '127.0.0.1', 'person');

        expect(grants.deniedReason(grant)).toBeNull();

        const release = reservedPorts.reserve(40123);
        released.push(release);

        expect(grants.deniedReason(grant)).toMatch(/belongs to Ruimte/);
        expect(() => grants.share('project-2', 40123, '127.0.0.1', 'person')).toThrow(/belongs to Ruimte/);

        release();

        expect(grants.deniedReason(grant)).toBeNull();
    });

    test('stay reserved while a second proxy holds the same port, and release once each', () => {
        const first = reservedPorts.reserve(40124);
        const second = reservedPorts.reserve(40124);
        released.push(first, second);

        first();
        first();

        expect(reservedPorts.list()).toContain(40124);

        second();

        expect(reservedPorts.list()).not.toContain(40124);
    });
});
