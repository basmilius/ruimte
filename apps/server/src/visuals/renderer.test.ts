import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_MEASURE_WIDTHS } from '@ruimte/contracts';
import type { RenderAnswer } from './render-protocol.ts';
import { previewVisual, renderCommand, VisualRenderer, type RenderJob, type RenderProcess } from './renderer.ts';

/* Timers that run only when a test moves the clock. */
class ManualTimers {
    time = 0;
    private timers: { at: number; run: () => void }[] = [];

    schedule(ms: number, run: () => void): () => void {
        const timer = { at: this.time + ms, run };
        this.timers.push(timer);
        return () => {
            this.timers = this.timers.filter((candidate) => candidate !== timer);
        };
    }

    advance(ms: number): void {
        this.time += ms;
        const due = this.timers.filter((timer) => timer.at <= this.time);
        this.timers = this.timers.filter((timer) => timer.at > this.time);
        for (const timer of due) {
            timer.run();
        }
    }
}

interface FakeChild extends RenderProcess {
    job: RenderJob;
    budgetMs: number;
    killed: boolean;
    reply(answer: RenderAnswer | null): void;
    exit(): void;
}

/* A launcher whose children answer and go only when a test says so. */
function fakeLauncher(): { launch: (job: RenderJob, budgetMs: number) => FakeChild; children: FakeChild[] } {
    const children: FakeChild[] = [];
    const launch = (job: RenderJob, budgetMs: number): FakeChild => {
        let reply!: (answer: RenderAnswer | null) => void;
        let exit!: () => void;
        const answer = new Promise<RenderAnswer | null>((resolve) => {
            reply = resolve;
        });
        const gone = new Promise<void>((resolve) => {
            exit = resolve;
        });
        const child: FakeChild = {
            job,
            budgetMs,
            killed: false,
            answer,
            gone,
            reply,
            exit,
            kill: () => {
                child.killed = true;
                reply(null);
                exit();
            }
        };
        children.push(child);
        return child;
    };
    return { launch, children };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function rendered(width: number, height: number): RenderAnswer {
    return { ok: true, pages: [{ width, height, shot: PNG.toString('base64'), shotHeight: height, console: [{ level: 'log', text: 'drawn' }], omitted: 2 }] };
}

function setup(): { renderer: VisualRenderer; timers: ManualTimers; children: FakeChild[]; warnings: string[] } {
    const timers = new ManualTimers();
    const { launch, children } = fakeLauncher();
    const warnings: string[] = [];
    const renderer = new VisualRenderer(launch, {
        schedule: (ms, run) => timers.schedule(ms, run),
        now: () => timers.time,
        warn: (line) => warnings.push(line)
    });
    return { renderer, timers, children, warnings };
}

/* Lets the promise chains of the renderer move on. */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

async function failure(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
    try {
        await promise;
    } catch (e) {
        return e as { code?: string; message: string };
    }
    throw new Error('expected a failure');
}

describe('VisualRenderer.preview', () => {
    test('asks one width with a capture and hands back the png, the heights and the console', async () => {
        const { renderer, children } = setup();
        const preview = renderer.preview('<p>x</p>', 600, 'light');
        await flush();
        expect(children).toHaveLength(1);
        expect(children[0]!.job).toEqual({ html: '<p>x</p>', widths: [600], appearance: 'light', capture: true });
        expect(children[0]!.budgetMs).toBe(19_000);
        children[0]!.reply(rendered(600, 340));
        expect(await preview).toEqual({
            png: new Uint8Array(PNG),
            width: 600,
            height: 340,
            shotHeight: 340,
            console: [{ level: 'log', text: 'drawn' }],
            omitted: 2
        });
    });

    test('a machine without a browser refuses with a code of its own', async () => {
        const { renderer, children } = setup();
        const preview = failure(renderer.preview('<p>x</p>', 600, 'dark'));
        await flush();
        children[0]!.reply({ ok: false, code: 'browser-unavailable', message: 'Failed to spawn Chrome' });
        const error = await preview;
        expect(error.code).toBe('preview-unavailable');
        expect(error.message).toContain('without a preview');
    });

    test('a child past its limit is killed and the preview refused as too slow', async () => {
        const { renderer, timers, children } = setup();
        const preview = failure(renderer.preview('<p>x</p>', 600, 'dark'));
        await flush();
        timers.advance(20_000);
        expect((await preview).code).toBe('preview-timeout');
        expect(children[0]!.killed).toBe(true);
    });

    test('a child that fails, or answers nothing, is a failed preview', async () => {
        const { renderer, children } = setup();
        const first = failure(renderer.preview('<p>x</p>', 600, 'dark'));
        const second = failure(renderer.preview('<p>x</p>', 600, 'dark'));
        await flush();
        children[0]!.reply({ ok: false, code: 'render-failed', message: 'broken' });
        children[1]!.reply(null);
        expect((await first).code).toBe('preview-failed');
        expect((await second).code).toBe('preview-failed');
    });

    test('writes the png under the screenshots of the machine by a name of its own', async () => {
        const home = await mkdtemp(join(tmpdir(), 'ruimte-preview-'));
        try {
            const { renderer, children } = setup();
            const first = previewVisual(renderer, home, { html: '<p>x</p>', width: 600, appearance: 'dark' });
            const second = previewVisual(renderer, home, { html: '<p>x</p>', width: 600, appearance: 'dark' });
            await flush();
            children[0]!.reply(rendered(600, 340));
            children[1]!.reply(rendered(600, 340));
            const [one, two] = await Promise.all([first, second]);
            expect(one.path.startsWith(join(home, 'screenshots', 'visual-'))).toBe(true);
            expect(one.path).not.toBe(two.path);
            expect(await readFile(one.path)).toEqual(PNG);
            expect(one).toMatchObject({ width: 600, height: 340, shotHeight: 340, console: [{ level: 'log', text: 'drawn' }], omitted: 2 });
        } finally {
            await rm(home, { recursive: true, force: true });
        }
    });
});

describe('VisualRenderer.measure', () => {
    test('measures every width at once and answers the pairs', async () => {
        const { renderer, children, warnings } = setup();
        const heights = renderer.measure('<p>x</p>');
        await flush();
        expect(children[0]!.job).toEqual({ html: '<p>x</p>', widths: [...VISUAL_MEASURE_WIDTHS], appearance: 'dark', capture: false });
        expect(children[0]!.budgetMs).toBe(5_000);
        children[0]!.reply({
            ok: true,
            pages: [
                { width: 320, height: 500 },
                { width: 800, height: 300 }
            ]
        });
        expect(await heights).toEqual([
            [320, 500],
            [800, 300]
        ]);
        expect(warnings).toEqual([]);
    });

    test('without a browser, on a failure or past six seconds it answers no heights and says so in the log', async () => {
        const { renderer, timers, children, warnings } = setup();
        const unavailable = renderer.measure('<p>x</p>');
        const failed = renderer.measure('<p>x</p>');
        await flush();
        children[0]!.reply({ ok: false, code: 'browser-unavailable', message: 'Failed to spawn Chrome' });
        children[1]!.reply({ ok: true, pages: [] });
        expect(await unavailable).toBeUndefined();
        expect(await failed).toBeUndefined();
        children[0]!.exit();
        children[1]!.exit();
        await flush();

        const slow = renderer.measure('<p>x</p>');
        await flush();
        timers.advance(6_000);
        expect(await slow).toBeUndefined();
        expect(children[2]!.killed).toBe(true);
        expect(warnings).toEqual([
            'Measuring a visual failed, so it is shown without heights: Failed to spawn Chrome',
            'Measuring a visual took longer than 6 s, so it is shown without heights',
            'Measuring a visual took longer than 6 s, so it is shown without heights'
        ]);
    });

    test('a launcher that throws leaves the page without heights', async () => {
        const warnings: string[] = [];
        const renderer = new VisualRenderer(
            () => {
                throw new Error('no executable');
            },
            { warn: (line) => warnings.push(line) }
        );
        expect(await renderer.measure('<p>x</p>')).toBeUndefined();
        expect(warnings).toEqual(['Measuring a visual failed, so it is shown without heights: no executable']);
    });
});

describe('VisualRenderer slots', () => {
    test('runs two children at once and starts the next once one is gone', async () => {
        const { renderer, timers, children } = setup();
        const first = renderer.preview('<p>1</p>', 600, 'dark');
        const second = renderer.preview('<p>2</p>', 600, 'dark');
        const third = renderer.preview('<p>3</p>', 600, 'dark');
        await flush();
        expect(children).toHaveLength(2);

        timers.advance(4_000);
        children[0]!.reply(rendered(600, 100));
        await first;
        await flush();
        // Answered is not gone: the child still holds its browser and its profile.
        expect(children).toHaveLength(2);
        children[0]!.exit();
        await flush();
        expect(children).toHaveLength(3);
        // The wait counts against the limit of the one that waited.
        expect(children[2]!.budgetMs).toBe(15_000);
        expect(children[2]!.job.html).toBe('<p>3</p>');

        children[1]!.reply(rendered(600, 100));
        children[2]!.reply(rendered(600, 100));
        await Promise.all([second, third]);
    });

    test('a measurement whose time runs out in the line never starts a child', async () => {
        const { renderer, timers, children, warnings } = setup();
        void renderer.preview('<p>1</p>', 600, 'dark');
        void renderer.preview('<p>2</p>', 600, 'dark');
        const queued = renderer.measure('<p>3</p>');
        await flush();
        timers.advance(6_000);
        expect(await queued).toBeUndefined();
        children[0]!.exit();
        await flush();
        expect(children).toHaveLength(2);
        expect(warnings).toEqual(['Measuring a visual took longer than 6 s, so it is shown without heights']);
    });

    test('stop kills every child, lets the waiting go and turns every later call away', async () => {
        const { renderer, children } = setup();
        const first = failure(renderer.preview('<p>1</p>', 600, 'dark'));
        const second = failure(renderer.preview('<p>2</p>', 600, 'dark'));
        const waiting = renderer.measure('<p>3</p>');
        await flush();
        await renderer.stop();
        expect(children.map((child) => child.killed)).toEqual([true, true]);
        expect((await first).code).toBe('preview-failed');
        expect((await second).code).toBe('preview-failed');
        expect(await waiting).toBeUndefined();
        expect((await failure(renderer.preview('<p>4</p>', 600, 'dark'))).code).toBe('preview-unavailable');
        expect(await renderer.measure('<p>5</p>')).toBeUndefined();
        expect(children).toHaveLength(2);
    });
});

describe('renderCommand', () => {
    test('the compiled binary by name, a checkout through its entry file with its conditions', () => {
        expect(renderCommand(true, '/app/ruimte', [], '/$bunfs/root')).toEqual(['/app/ruimte', 'visual-render']);
        expect(renderCommand(false, '/bin/bun', ['--conditions=source', '--watch'], '/repo/apps/server/src')).toEqual([
            '/bin/bun',
            '--conditions=source',
            '/repo/apps/server/src/main.ts',
            'visual-render'
        ]);
    });
});
