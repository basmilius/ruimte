import { describe, expect, test } from 'bun:test';
import type { MachineStatus } from '@ruimte/contracts';
import { CLOSED_LID_USAGE, runClosedLid, type ClosedLidCliOptions } from './closed-lid.ts';

const STATUS: MachineStatus = {
    version: '0.14.0',
    service: true,
    label: 'MacBook',
    onAccount: true,
    broker: { url: null, connected: false },
    lan: null,
    lanDoorFixed: false,
    keepAwake: { mode: 'working', onBattery: false, holding: false, lid: { on: false, rule: true, holding: false } }
};

async function run(patch: Partial<ClosedLidCliOptions> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const ran: string[][] = [];
    const code = await runClosedLid({
        action: 'install',
        platform: 'darwin',
        uid: 501,
        user: 'bas',
        rulePresent: async () => true,
        runAttached: async (command) => {
            ran.push(command);
            return 0;
        },
        status: async () => STATUS,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        ...patch
    });
    return { code, out, err, ran };
}

describe('ruimte closed-lid', () => {
    test('install prints the rule it installs, word for word, before sudo asks for the password', async () => {
        const { code, out, ran } = await run();
        expect(code).toBe(0);
        expect(out.slice(0, 6)).toEqual([
            'This installs /etc/sudoers.d/ruimte-closed-lid-501, owned by root and readable by root alone:',
            '',
            '    # Installed by Ruimte: lets this user turn sleep off and on again for a closed lid, and nothing else.',
            '    # Remove it in Ruimte under Settings, Agents, with `ruimte closed-lid remove`, or by deleting this file.',
            '    bas ALL = (root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0',
            ''
        ]);
        expect(ran).toHaveLength(1);
        expect(ran[0]?.slice(0, 3)).toEqual(['/usr/bin/sudo', '/bin/sh', '-c']);
        expect(ran[0]?.[3]).toContain('/usr/sbin/visudo -c -q -f');
        expect(out.at(-1)).toBe('Ruimte on this Mac: allowed but off, so a closed lid sleeps this Mac.');
    });

    test('without a running machine it says where to turn the switch on, and a refused sudo installs nothing', async () => {
        expect((await run({ status: async () => null })).out.at(-1)).toContain('Settings, Agents');
        const refused = await run({ runAttached: async () => 1 });
        expect(refused).toMatchObject({ code: 1, err: ['Nothing was installed.'] });
    });

    test('remove turns sleep back on and removes the rule, and has the machine read it again', async () => {
        let asked = 0;
        const { code, out, ran } = await run({
            action: 'remove',
            status: async () => {
                asked += 1;
                return null;
            }
        });
        expect(code).toBe(0);
        expect(ran[0]?.[3]).toBe(`/usr/bin/pmset -a disablesleep 0\n/bin/rm -f '/etc/sudoers.d/ruimte-closed-lid-501'`);
        expect(out.at(-1)).toBe('Removed /etc/sudoers.d/ruimte-closed-lid-501. A closed lid sleeps this Mac again.');
        expect(asked).toBe(1);
    });

    test('a rule that is not there is nothing to remove, and nothing is run for it', async () => {
        const { code, ran, out } = await run({ action: 'remove', rulePresent: async () => false });
        expect([code, ran, out]).toEqual([0, [], ['/etc/sudoers.d/ruimte-closed-lid-501 is not installed; there is nothing to remove.']]);
    });

    test('off a Mac, for a name sudoers would misread, or for another action it runs nothing', async () => {
        expect(await run({ platform: 'linux' })).toMatchObject({ code: 1, ran: [], err: ['Only a Mac can stay awake with its lid closed.'] });
        expect(await run({ user: 'bas, ALL' })).toMatchObject({ code: 1, ran: [] });
        expect(await run({ action: 'status' })).toMatchObject({ code: 1, ran: [], err: [CLOSED_LID_USAGE] });
    });
});
