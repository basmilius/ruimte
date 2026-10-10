import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_MEASURE_WIDTHS, type VisualAppearance, type VisualHeight } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { errorText } from '../error-text.ts';
import type { ConsoleEntry } from './page-console.ts';
import { RENDER_COMMAND, RenderAnswerSchema, type RenderAnswer, type RenderRequest } from './render-protocol.ts';

/*
 * Renders an agent's page in a child process with a Chrome of its own (`render-child.ts`), for a
 * preview the agent asked for and for the heights a published page is measured at. At most two
 * children run at once and the rest wait their turn; each has a hard limit, and a child that passes
 * it is killed with its whole process group, its browser included.
 */

/* The width a preview is drawn at: the reply column of a chat that is a view of its own (`.chat-column-content` in `@adecore/agents-react`). */
export const PREVIEW_WIDTH = { min: 240, max: 1600, default: 768 } as const;

export const PREVIEW_LIMIT_MS = 20_000;
/* Measuring is part of publishing, which must not keep the agent waiting long. */
export const MEASURE_LIMIT_MS = 6_000;
const SLOTS = 2;
// The child answers this long before its limit, so what it has arrives before it is killed.
const ANSWER_MARGIN_MS = 1_000;
const STOP_WAIT_MS = 2_000;

export type RenderJob = Omit<RenderRequest, 'profile' | 'budgetMs'>;

/* One child at work: its answer, null when it gave none; a way to kill it with its browser; and when it is gone with its profile. */
export interface RenderProcess {
    answer: Promise<RenderAnswer | null>;
    kill(): void;
    gone: Promise<void>;
}

export type RenderLauncher = (job: RenderJob, budgetMs: number) => RenderProcess;

/* Calls `run` after `ms`, unless the function it answers is called first. */
export type Schedule = (ms: number, run: () => void) => () => void;

export type VisualRenderErrorCode = 'preview-unavailable' | 'preview-timeout' | 'preview-failed';

export class VisualRenderError extends CodedError<VisualRenderErrorCode> {}

export interface RenderedPreview {
    png: Uint8Array;
    width: number;
    height: number;
    shotHeight: number;
    console: ConsoleEntry[];
    omitted: number;
}

/* A preview as an agent gets it: the png written where it can open it. */
export type VisualPreview = Omit<RenderedPreview, 'png'> & { path: string };

type RunOutcome = { kind: 'answer'; answer: RenderAnswer | null } | { kind: 'late' } | { kind: 'stopped' };

/* How the daemon starts itself as a render child: the compiled binary by name, a checkout through its entry file with the same conditions. */
export function renderCommand(compiled: boolean, execPath: string, execArgv: readonly string[], sourceDir: string): string[] {
    if (compiled) {
        return [execPath, RENDER_COMMAND];
    }
    return [execPath, ...execArgv.filter((argument) => argument.startsWith('--conditions')), join(sourceDir, 'main.ts'), RENDER_COMMAND];
}

function parseAnswer(text: string): RenderAnswer | null {
    const line = text.split('\n').find((candidate) => candidate.trim() !== '');
    if (line === undefined) {
        return null;
    }
    try {
        const parsed = RenderAnswerSchema.safeParse(JSON.parse(line));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/*
 * Starts `command` in a process group of its own, so a kill reaches the browser it starts as well,
 * with a profile folder made for it and removed once the group is gone.
 */
export function childLauncher(command: readonly string[], env: Record<string, string | undefined> = process.env): RenderLauncher {
    return (job, budgetMs) => {
        let child: Bun.Subprocess<'pipe', 'pipe', 'ignore'> | null = null;
        let killed = false;
        let profile: string | null = null;
        const killGroup = (): void => {
            if (child === null) {
                return;
            }
            try {
                process.kill(-child.pid, 'SIGKILL');
            } catch {
                child.kill('SIGKILL');
            }
        };
        const answer = (async (): Promise<RenderAnswer | null> => {
            profile = await mkdtemp(join(tmpdir(), 'ruimte-visual-'));
            if (killed) {
                return null;
            }
            child = Bun.spawn([...command], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', detached: true });
            // Stdin stays open: its end is how the child learns the daemon went.
            child.stdin.write(`${JSON.stringify({ ...job, profile, budgetMs } satisfies RenderRequest)}\n`);
            await child.stdin.flush();
            return parseAnswer(await new Response(child.stdout).text());
        })();
        const gone = answer
            .catch(() => null)
            .then(async () => {
                const running = child;
                if (running !== null) {
                    await running.exited;
                    // A helper of the browser that outlived the child still holds the profile.
                    killGroup();
                    try {
                        await running.stdin.end();
                    } catch {
                        // Already closed with the process.
                    }
                }
                if (profile !== null) {
                    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
                }
            });
        return {
            answer,
            kill: () => {
                killed = true;
                killGroup();
            },
            gone
        };
    };
}

export interface VisualRendererOptions {
    slots?: number;
    previewLimitMs?: number;
    measureLimitMs?: number;
    warn?: (line: string) => void;
    schedule?: Schedule;
    now?: () => number;
}

function systemSchedule(ms: number, run: () => void): () => void {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
}

export class VisualRenderer {
    private readonly launch: RenderLauncher;
    private readonly slots: number;
    private readonly previewLimitMs: number;
    private readonly measureLimitMs: number;
    private readonly warn: (line: string) => void;
    private readonly schedule: Schedule;
    private readonly now: () => number;
    private readonly waiting: Array<() => void> = [];
    private readonly live = new Set<RenderProcess>();
    private running = 0;
    private stopped = false;

    constructor(launch: RenderLauncher, options: VisualRendererOptions = {}) {
        this.launch = launch;
        this.slots = options.slots ?? SLOTS;
        this.previewLimitMs = options.previewLimitMs ?? PREVIEW_LIMIT_MS;
        this.measureLimitMs = options.measureLimitMs ?? MEASURE_LIMIT_MS;
        this.warn = options.warn ?? ((line) => console.warn(line));
        this.schedule = options.schedule ?? systemSchedule;
        this.now = options.now ?? Date.now;
    }

    /* The page at one width as a client draws it, with its console; refuses under a code of its own when that cannot be done. */
    async preview(html: string, width: number, appearance: VisualAppearance): Promise<RenderedPreview> {
        const outcome = await this.run({ html, widths: [width], appearance, capture: true }, this.previewLimitMs).catch((e: unknown) => {
            throw new VisualRenderError('preview-failed', `The preview could not start: ${errorText(e)}`);
        });
        const seconds = Math.round(this.previewLimitMs / 1000);
        if (outcome.kind === 'stopped') {
            throw new VisualRenderError('preview-unavailable', 'This machine is stopping, so it renders no preview; show the page without one');
        }
        if (outcome.kind === 'late') {
            throw new VisualRenderError(
                'preview-timeout',
                `The page did not render within ${seconds} s; make it lighter or load fewer resources and preview again, or show it without a preview`
            );
        }
        const answer = outcome.answer;
        if (answer === null) {
            throw new VisualRenderError('preview-failed', 'The preview ended without an answer; preview again, or show the page without a preview');
        }
        if (!answer.ok) {
            if (answer.code === 'browser-unavailable') {
                throw new VisualRenderError(
                    'preview-unavailable',
                    `This machine has no Chrome to render a preview with (${answer.message}); show the page with visual show without a preview`
                );
            }
            throw new VisualRenderError('preview-failed', `The preview failed: ${answer.message}`);
        }
        const page = answer.pages[0];
        if (page?.shot === undefined) {
            throw new VisualRenderError('preview-timeout', `The page did not render within ${seconds} s; preview again, or show it without a preview`);
        }
        return {
            png: Buffer.from(page.shot, 'base64'),
            width: page.width,
            height: page.height,
            shotHeight: page.shotHeight ?? page.height,
            console: page.console ?? [],
            omitted: page.omitted ?? 0
        };
    }

    /* The page's heights at the widths a client may draw it, or undefined, with a line in the log, when that took too long or failed. */
    async measure(html: string): Promise<VisualHeight[] | undefined> {
        let outcome: RunOutcome;
        try {
            outcome = await this.run({ html, widths: [...VISUAL_MEASURE_WIDTHS], appearance: 'dark', capture: false }, this.measureLimitMs);
        } catch (e) {
            this.warn(`Measuring a visual failed, so it is shown without heights: ${errorText(e)}`);
            return undefined;
        }
        if (outcome.kind === 'stopped') {
            return undefined;
        }
        const answer = outcome.kind === 'answer' ? outcome.answer : null;
        if (outcome.kind === 'late' || (answer?.ok === true && answer.pages.length === 0)) {
            this.warn(`Measuring a visual took longer than ${Math.round(this.measureLimitMs / 1000)} s, so it is shown without heights`);
            return undefined;
        }
        if (answer === null || !answer.ok) {
            this.warn(`Measuring a visual failed, so it is shown without heights: ${answer?.message ?? 'the render process gave no answer'}`);
            return undefined;
        }
        return answer.pages.map((page): VisualHeight => [page.width, page.height]);
    }

    /* Kills every child at work and turns every later call away; resolves once they are gone, or after a short wait. */
    async stop(): Promise<void> {
        this.stopped = true;
        for (const start of this.waiting.splice(0)) {
            start();
        }
        const children = [...this.live];
        for (const child of children) {
            child.kill();
        }
        await new Promise<void>((resolve) => {
            const cancel = this.schedule(STOP_WAIT_MS, resolve);
            void Promise.all(children.map((child) => child.gone)).then(() => {
                cancel();
                resolve();
            });
        });
    }

    /* A turn among the slots: `ready` once one is free, `release` gives it back or leaves the line. */
    private take(): { ready: Promise<void>; release: () => void } {
        let started = false;
        let released = false;
        let start!: () => void;
        const ready = new Promise<void>((resolve) => {
            start = () => {
                started = true;
                this.running++;
                resolve();
            };
        });
        this.waiting.push(start);
        this.pump();
        return {
            ready,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                if (started) {
                    this.running--;
                    this.pump();
                } else {
                    this.waiting.splice(this.waiting.indexOf(start), 1);
                }
            }
        };
    }

    private pump(): void {
        while (this.running < this.slots && this.waiting.length > 0) {
            this.waiting.shift()!();
        }
    }

    /* One job within `limitMs` from the call, the wait for a slot included. */
    private async run(job: RenderJob, limitMs: number): Promise<RunOutcome> {
        if (this.stopped) {
            return { kind: 'stopped' };
        }
        const startedAt = this.now();
        let expire!: () => void;
        const expired = new Promise<'late'>((resolve) => {
            expire = () => resolve('late');
        });
        const cancel = this.schedule(limitMs, expire);
        const turn = this.take();
        let handedOver = false;
        try {
            if ((await Promise.race([turn.ready.then(() => 'ready' as const), expired])) === 'late') {
                return { kind: 'late' };
            }
            if (this.stopped) {
                return { kind: 'stopped' };
            }
            const budgetMs = limitMs - (this.now() - startedAt) - ANSWER_MARGIN_MS;
            if (budgetMs <= 0) {
                return { kind: 'late' };
            }
            const child = this.launch(job, budgetMs);
            this.live.add(child);
            handedOver = true;
            void child.gone.finally(() => {
                this.live.delete(child);
                turn.release();
            });
            const answered = await Promise.race([child.answer, expired]);
            if (answered === 'late') {
                child.kill();
                return { kind: 'late' };
            }
            return { kind: 'answer', answer: answered };
        } finally {
            cancel();
            if (!handedOver) {
                turn.release();
            }
        }
    }
}

/* The host keeps the rendered png with the chat that requested it. */
export async function previewVisual(
    renderer: VisualRenderer,
    save: (png: Uint8Array) => Promise<string>,
    input: { html: string; width: number; appearance: VisualAppearance }
): Promise<VisualPreview> {
    const { png, ...rest } = await renderer.preview(input.html, input.width, input.appearance);
    return { path: await save(png), ...rest };
}
