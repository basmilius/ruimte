import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasFixture, type CanvasFixture } from './canvas-fixture-test-helpers.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('port_share', () => {
    test('refuses while a person has not turned the setting on, and says where it is', async () => {
        const refused = await fx.invoke('port_share', { port: 3000 });

        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toBe('refused\tsetting-off\tA person has not let agents share ports');
        expect(refused.lines.join('\n')).toContain('agentsSharePorts');
        expect(fx.portGrants.list()).toEqual([]);
    });

    test('shares a port of its own project once the setting is on, and lists it', async () => {
        fx.knobs.sharePorts = true;

        expect((await fx.invoke('port_share', { port: 3000 })).lines).toEqual(['shared\t3000\t127.0.0.1\tagent']);
        expect((await fx.invoke('port_share', {})).lines).toEqual(['shared\t3000\t127.0.0.1\tagent']);
        expect(fx.portGrants.list()).toMatchObject([{ projectId: fx.projectId, port: 3000, host: '127.0.0.1', sharedBy: 'agent' }]);
    });

    test('refuses a loopback service that answers no HTTP and no launch of the project uses', async () => {
        fx.knobs.sharePorts = true;

        const refused = await fx.invoke('port_share', { port: 5432 });

        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toStartWith('refused\tnot-a-dev-server\t');
        expect(fx.portGrants.list()).toEqual([]);
    });

    test('shares a port a launch of the project uses, before its server answers', async () => {
        fx.knobs.sharePorts = true;
        fx.knobs.launchPorts = [8080];

        expect((await fx.invoke('port_share', { port: 8080 })).lines).toEqual(['shared\t8080\t127.0.0.1\tagent']);
    });

    test('leaves a share of a person as it was, whatever listens', async () => {
        expect(fx.portGrants.share(fx.projectId, 5432, '127.0.0.1', 'person')).toMatchObject({ port: 5432, sharedBy: 'person' });
    });

    test('takes the other address family only when asked for it', async () => {
        fx.knobs.sharePorts = true;

        await fx.invoke('port_share', { port: 3000, host: '::1' });

        expect(fx.portGrants.list().map((grant) => grant.host)).toEqual(['::1']);
    });

    test('refuses the ports Ruimte listens on', async () => {
        fx.knobs.sharePorts = true;

        fx.knobs.httpPorts = [4210];

        const refused = await fx.invoke('port_share', { port: 4210 });

        expect(refused.status).toBe(422);
        expect(refused.lines[0]).toStartWith('refused\tport-denied\t');
    });

    test('stops a share an agent made and never one a person made', async () => {
        fx.knobs.sharePorts = true;
        fx.portGrants.share(fx.projectId, 5173, '127.0.0.1', 'person');
        await fx.invoke('port_share', { port: 3000 });

        expect((await fx.invoke('port_share', { port: 5173, stop: true })).lines[0]).toStartWith('unchanged\t5173');
        expect((await fx.invoke('port_share', { port: 3000, stop: true })).lines).toEqual(['stopped\t3000\t127.0.0.1']);
        expect(fx.portGrants.list().map((grant) => grant.port)).toEqual([5173]);
    });

    test('stops working the moment the setting goes off', async () => {
        fx.knobs.sharePorts = true;
        await fx.invoke('port_share', { port: 3000 });
        fx.knobs.sharePorts = false;

        expect((await fx.invoke('port_share', { port: 3000, stop: true })).lines[0]).toStartWith('refused\tsetting-off');
    });

    test('refuses a port that is no port', async () => {
        fx.knobs.sharePorts = true;

        expect((await fx.invoke('port_share', { port: 70000 })).lines[0]).toStartWith('refused\tbad-arguments\t');
    });
});
