import { describe, expect, test } from 'bun:test';
import { canvasFixture, invoke, knobs, portGrants, projectId } from './canvas-test-fixture.ts';

canvasFixture();

describe('port_share', () => {
    test('refuses while a person has not turned the setting on, and says where it is', async () => {
        const refused = await invoke('port_share', { port: 3000 });

        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tsetting-off\tA person has not let agents share ports');
        expect(refused.lines.join('\n')).toContain('agentsSharePorts');
        expect(portGrants.list()).toEqual([]);
    });

    test('shares a port of its own project once the setting is on, and lists it', async () => {
        knobs.sharePorts = true;

        expect((await invoke('port_share', { port: 3000 })).lines).toEqual(['shared\t3000\t127.0.0.1\tagent']);
        expect((await invoke('port_share', {})).lines).toEqual(['shared\t3000\t127.0.0.1\tagent']);
        expect(portGrants.list()).toMatchObject([{ projectId, port: 3000, host: '127.0.0.1', sharedBy: 'agent' }]);
    });

    test('takes the other address family only when asked for it', async () => {
        knobs.sharePorts = true;

        await invoke('port_share', { port: 3000, host: '::1' });

        expect(portGrants.list().map((grant) => grant.host)).toEqual(['::1']);
    });

    test('refuses the ports Ruimte listens on', async () => {
        knobs.sharePorts = true;

        const refused = await invoke('port_share', { port: 4210 });

        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toStartWith('refused\tport-denied\t');
    });

    test('stops a share an agent made and never one a person made', async () => {
        knobs.sharePorts = true;
        portGrants.share(projectId, 5173, '127.0.0.1', 'person');
        await invoke('port_share', { port: 3000 });

        expect((await invoke('port_share', { port: 5173, stop: true })).lines[0]).toStartWith('unchanged\t5173');
        expect((await invoke('port_share', { port: 3000, stop: true })).lines).toEqual(['stopped\t3000\t127.0.0.1']);
        expect(portGrants.list().map((grant) => grant.port)).toEqual([5173]);
    });

    test('stops working the moment the setting goes off', async () => {
        knobs.sharePorts = true;
        await invoke('port_share', { port: 3000 });
        knobs.sharePorts = false;

        expect((await invoke('port_share', { port: 3000, stop: true })).lines[0]).toStartWith('refused\tsetting-off');
    });

    test('refuses a port that is no port', async () => {
        knobs.sharePorts = true;

        expect((await invoke('port_share', { port: 70000 })).lines[0]).toStartWith('refused\tbad-arguments\t');
    });
});
