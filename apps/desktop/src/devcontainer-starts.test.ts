import { describe, expect, test } from 'bun:test';
import type { MachineStartState } from '@ruimte/contracts';
import type { DevcontainerStart } from '@ruimte/desktop-bridge';
import { DevcontainerStarts } from './devcontainer-starts';
import type { OriginAnswer } from './linux-origin';
import type { ProgramRun } from './program-run';

const FOLDER = '/work/shop';
const ACCOUNT = 'account-1';
const FILE = '.devcontainer/devcontainer.json';
const REGISTRATION = {
    id: 'machine-shop',
    name: 'Shop',
    icon: null,
    brokerUrl: 'wss://broker.ruimte.app',
    publicKey: Buffer.from(Uint8Array.from({ length: 32 }, (_value, i) => i)).toString('base64url'),
    issuedAt: 1_000_000,
    signature: 's'.repeat(86),
    automatic: true
};
const CHECKOUT: OriginAnswer = {
    ok: true,
    value: {
        origin: {
            step: { title: 'Build Ruimte for Linux from this checkout', spawn: { command: 'bun', args: ['/src/ruimte/apps/server/scripts/compile.ts'] } },
            folder: '/src/ruimte/apps/server/dist/linux-arm64'
        },
        fetch: null
    }
};

interface Rig {
    starts: DevcontainerStarts;
    files: Record<string, string>;
    ran: ProgramRun[];
    stopped: string[];
    docker: boolean;
    origin: OriginAnswer;
    /* What `ruimte join` prints, and the code it ends with. */
    joinAnswer: { out: string; err?: string; code: number };
    /* The first argument of the program that waits for a stop. */
    hangs: string | null;
    /* Settles once that program runs. */
    hanging: Promise<void>;
    /* Settles at the first state this start is told in, `joining` once the new machine signed. */
    settled(state: MachineStartState): Promise<DevcontainerStart>;
}

function rig(): Rig {
    const waiting: Array<{ state: MachineStartState; resolve(start: DevcontainerStart): void }> = [];
    const hanging = Promise.withResolvers<void>();
    const self: Rig = {
        starts: null as never,
        files: { [FILE]: JSON.stringify({ name: 'Shop', image: 'debian:bookworm-slim', customizations: {} }) },
        ran: [],
        stopped: [],
        docker: true,
        origin: CHECKOUT,
        joinAnswer: { out: JSON.stringify(REGISTRATION), code: 0 },
        hangs: null,
        hanging: hanging.promise,
        settled: (state) => new Promise((resolve) => waiting.push({ state, resolve }))
    };

    self.starts = new DevcontainerStarts({
        readerOf: () => async (path) => (path in self.files ? { ok: true, value: self.files[path] as string } : { ok: false, error: { message: 'missing' } }),
        hasDocker: async () => self.docker,
        env: async () => ({ PATH: '/usr/bin' }),
        origin: async () => self.origin,
        run: async (run, hooks) => {
            self.ran.push(run);

            if (run.args.includes('join')) {
                hooks.line(self.joinAnswer.out, 'out');

                if (self.joinAnswer.err !== undefined) {
                    hooks.line(self.joinAnswer.err, 'err');
                }

                return self.joinAnswer.code;
            }

            if (self.hangs !== null && run.args[0] === self.hangs) {
                hanging.resolve();
                await new Promise<void>((resolve) => hooks.signal.addEventListener('abort', () => resolve()));
                self.stopped.push(run.command);

                return null;
            }

            return 0;
        },
        publish: (start) => {
            const reached = (state: MachineStartState): boolean =>
                state === start.candidate.state && (state !== 'joining' || start.candidate.join === 'signed');

            for (const wait of waiting.filter((each) => reached(each.state))) {
                waiting.splice(waiting.indexOf(wait), 1);
                wait.resolve(start);
            }
        }
    });

    return self;
}

describe('a folder in a dev container, started by the app', () => {
    test('shows the programs and the join for the account, and runs nothing before a yes', async () => {
        const { starts, ran } = rig();
        const start = await starts.pick(FOLDER, ACCOUNT);
        const programs = start.candidate.held?.programs ?? [];

        expect(start.candidate.state).toBe('held');
        expect(start.candidate.title).toBe('Shop');
        expect(start.workspaceFolder).toBe('/workspaces/shop');
        expect(programs.map((program) => program.title ?? 'join')).toEqual([
            'Build Ruimte for Linux from this checkout',
            'Pull debian:bookworm-slim, unless it is here already',
            `Create the container ${start.id}, unless it is there as described`,
            'Start the container',
            'Prepare the container for Ruimte',
            'Check that Ruimte runs in the container',
            'Start Ruimte in the container',
            'join'
        ]);
        expect(programs.at(-1)).toEqual({ join: true, command: `docker exec ${start.id} ruimte join ${ACCOUNT}`, cwd: FOLDER });
        expect(start.candidate.lines).toEqual(['Ignoring what Ruimte does not read in devcontainer.json: customizations']);
        expect(ran).toEqual([]);
    });

    test('runs what was shown after the yes, and hands over what the new machine signed until the page posted it', async () => {
        const { starts, ran, settled } = rig();
        const held = await starts.pick(FOLDER, ACCOUNT);
        const signed = settled('joining');

        await starts.start(held.id, ACCOUNT, held.candidate.held?.digest ?? '');

        const joining = await signed;

        expect(ran.map((run) => run.command)).toEqual(['bun', 'sh', 'sh', 'docker', 'docker', 'docker', 'docker', 'docker']);
        expect(ran.at(-1)?.args).toEqual(['exec', held.id, 'ruimte', 'join', ACCOUNT]);
        expect(ran.every((run) => run.cwd === FOLDER)).toBe(true);
        expect(joining.candidate.join).toBe('signed');
        expect(joining.machineId).toBe('machine-shop');

        const { automatic: _automatic, ...posted } = REGISTRATION;

        expect(starts.registration(held.id, ACCOUNT)).toEqual(posted);
        expect(() => starts.registration(held.id, 'account-2')).toThrow('another account');

        starts.joined(held.id);

        expect(starts.list()[0]?.candidate).toMatchObject({ state: 'done', join: 'joined' });
    });

    test('shows a changed file again and runs nothing for the yes to the old one', async () => {
        const self = rig();
        const held = await self.starts.pick(FOLDER, ACCOUNT);

        self.files[FILE] = JSON.stringify({ name: 'Shop', image: 'debian:trixie-slim' });

        const again = await self.starts.start(held.id, ACCOUNT, held.candidate.held?.digest ?? '');

        expect(again.candidate.state).toBe('held');
        expect(again.candidate.held?.digest).not.toBe(held.candidate.held?.digest);
        expect(again.candidate.held?.programs[1]?.title).toBe('Pull debian:trixie-slim, unless it is here already');
        expect(self.ran).toEqual([]);
    });

    test('shows a yes for another account again, since the join it covers named the first', async () => {
        const self = rig();
        const held = await self.starts.pick(FOLDER, ACCOUNT);
        const again = await self.starts.start(held.id, 'account-2', held.candidate.held?.digest ?? '');

        expect(again.candidate.state).toBe('held');
        expect(again.candidate.held?.programs.at(-1)?.command).toEndWith('ruimte join account-2');
        expect(self.ran).toEqual([]);
    });

    test.each([
        [
            'a file that needs what is not supported',
            { [FILE]: JSON.stringify({ image: 'node:22', features: { git: {} } }) },
            'Ruimte cannot start .devcontainer/devcontainer.json: it needs "features"'
        ],
        [
            'a mount of the Docker socket',
            { [FILE]: JSON.stringify({ image: 'node:22', mounts: ['type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock'] }) },
            'which Dev Containers keeps out of a container'
        ],
        ['a folder without the file', {}, 'This folder has no .devcontainer/devcontainer.json']
    ])('refuses %s with the reason, before anything runs', async (_name, files, reason) => {
        const self = rig();

        self.files = files;

        const start = await self.starts.pick(FOLDER, ACCOUNT);

        expect(start.candidate.state).toBe('failed');
        expect(start.candidate.failure).toContain(reason);
        expect(self.ran).toEqual([]);
    });

    test('says Docker is missing before anything runs', async () => {
        const self = rig();

        self.docker = false;

        const start = await self.starts.pick(FOLDER, ACCOUNT);

        expect(start.candidate.failure).toBe('Ruimte cannot find Docker on this computer. Install Docker, start it, and try again.');
        expect(self.ran).toEqual([]);
    });

    test('ends with the reason of the origin, before anything runs', async () => {
        const self = rig();

        self.origin = { ok: false, reason: 'Ruimte 0.40.0 has no Ruimte for Linux on npm' };

        const start = await self.starts.pick(FOLDER, ACCOUNT);

        expect(start.candidate.failure).toBe('Ruimte 0.40.0 has no Ruimte for Linux on npm');
        expect(self.ran).toEqual([]);
    });

    test('asks a program under way to end once on a stop, and runs nothing after it', async () => {
        const self = rig();

        self.hangs = 'start';

        const held = await self.starts.pick(FOLDER, ACCOUNT);
        const stopped = self.settled('stopped');

        await self.starts.start(held.id, ACCOUNT, held.candidate.held?.digest ?? '');
        await self.hanging;
        self.starts.stop(held.id);

        expect((await stopped).candidate.state).toBe('stopped');
        expect(self.stopped).toEqual(['docker']);
        expect(self.ran.at(-1)?.args).toEqual(['start', held.id]);
    });

    test('fails with what the new machine said when it would not join, and with a plain reason for an answer it cannot read', async () => {
        const self = rig();

        self.joinAnswer = { out: '', err: 'This machine is on another account.', code: 1 };

        const held = await self.starts.pick(FOLDER, ACCOUNT);
        const failed = self.settled('failed');

        await self.starts.start(held.id, ACCOUNT, held.candidate.held?.digest ?? '');

        expect((await failed).candidate.failure).toBe('This machine is on another account.');

        self.joinAnswer = { out: '{"id":"x"}', code: 0 };

        const again = await self.starts.pick(FOLDER, ACCOUNT);
        const unreadable = self.settled('failed');

        await self.starts.start(again.id, ACCOUNT, again.candidate.held?.digest ?? '');

        expect((await unreadable).candidate.failure).toBe('The new machine answered with something Ruimte cannot read, so it is on no account.');
    });

    test('refuses an account id that would reach the join as a flag', async () => {
        await expect(rig().starts.pick(FOLDER, '--help')).rejects.toThrow('Sign in to your account first');
    });
});
