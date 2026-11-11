import { afterEach, describe, expect, test } from 'bun:test';
import { deniedRuimtePorts, reservedPorts, WELL_KNOWN_RUIMTE_PORTS } from './reserved-ports.ts';

const released: Array<() => void> = [];

afterEach(() => {
    released.splice(0).forEach((release) => release());
});

describe('the ports of Ruimte itself', () => {
    test('cover a dev and an installed daemon side by side, with their doors and external listeners', () => {
        for (const port of [4210, 4211, 4212, 4213, 4220, 4221, 4230, 4231]) {
            expect(WELL_KNOWN_RUIMTE_PORTS).toContain(port);
        }

        expect(WELL_KNOWN_RUIMTE_PORTS).not.toContain(3000);
        expect(WELL_KNOWN_RUIMTE_PORTS).not.toContain(5173);
    });

    test('are denied whichever daemon this is, and the own ports of this daemon too', () => {
        const denied = deniedRuimtePorts([5555]);

        for (const port of [4210, 4211, 4213, 4221, 4231, 5555]) {
            expect(denied).toContain(port);
        }

        expect(denied).not.toContain(3000);
    });

    test('hold a port a proxy of Ruimte listens on until it is released, and are read again at every check', () => {
        expect(deniedRuimtePorts([])).not.toContain(40123);

        const release = reservedPorts.reserve(40123);
        released.push(release);

        expect(deniedRuimtePorts([])).toContain(40123);

        release();

        expect(deniedRuimtePorts([])).not.toContain(40123);
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
