import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { zonedTime, type ArtifactGetResult, type ProjectCanvasView, type ProjectNode, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { act } from 'react';
import { setRunsHidden } from '@/routines/runs-hidden';
import { showRoutine, useRoutinesStage } from '@/routines/stage';
import { liveCanvas } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { windowWorkspace } from '@/workspace/window';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOut, layOutChat, mount, openSubmenu, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const AMS = 'Europe/Amsterdam';
// Sunday 25 October 2026, 14:20 on the machine's clock.
const NOW = zonedTime(2026, 10, 25, 14, 20, AMS);
const REPORT = '# Morning\n\nAll green\n';

function run(runId: string, day: number, patch: Partial<RoutineRun> & Pick<RoutineRun, 'state'>): RoutineRun {
    const due = zonedTime(2026, 10, day, 9, 0, AMS);
    return { runId, routineId: 'morning', projectId: 'project-atlas', kind: 'scheduled', due, at: due, endedAt: due + 180_000, ...patch };
}

const MORNING: RoutineEntry = {
    routine: {
        id: 'morning',
        kind: 'agent',
        title: 'Morning summary',
        schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        outputKey: 'morning',
        prompt: 'Summarize what changed on main.',
        provider: 'claude',
        mode: 'supervised',
        perRun: 'new'
    },
    projectId: 'project-atlas',
    projectName: 'Atlas',
    shared: true,
    local: {},
    digest: 'digest-morning',
    approved: true,
    next: zonedTime(2026, 10, 26, 9, 0, AMS),
    runs: [
        run('fri', 23, { state: 'skipped', skipped: 'overlap' }),
        run('thu', 22, { state: 'done', waited: true, chatId: 'chat-thu' }),
        run('wed', 21, { state: 'done', kind: 'caught-up', artifactId: 'art-1', versionId: 'ver-14', versionNumber: 14 })
    ],
    artifactId: 'art-1'
};

const ARTIFACT: ArtifactGetResult = {
    artifact: { artifactId: 'art-1', projectId: 'project-atlas', projectName: 'Atlas', title: 'Morning summary', kind: 'report', createdAt: 0 },
    versions: [
        {
            versionId: 'ver-15',
            number: 15,
            createdAt: zonedTime(2026, 10, 22, 9, 3, AMS),
            files: [{ name: 'morning.md', mime: 'text/markdown', size: REPORT.length, sha256: 'ver-15' }],
            bytes: REPORT.length,
            provenance: { maker: 'routine', machineId: 'mac' },
            copiedTo: []
        },
        {
            versionId: 'ver-14',
            number: 14,
            createdAt: zonedTime(2026, 10, 21, 9, 3, AMS),
            files: [{ name: 'morning.md', mime: 'text/markdown', size: REPORT.length, sha256: 'ver-14' }],
            bytes: REPORT.length,
            provenance: { maker: 'routine', machineId: 'mac' },
            copiedTo: []
        }
    ],
    chatPresent: false
};

function routineNode(id: string, routine?: string): ProjectNode {
    return { id, kind: 'routine', title: 'Morning summary', x: 0, y: 0, w: 400, h: 560, ...(routine === undefined ? {} : { routine }) };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(nodes: ProjectNode[]): Promise<void> {
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
    page = mount();
    await page.renderApp();
}

function frameOf(id: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
}

function looks(frame: HTMLElement): string[] {
    return [...frame.querySelectorAll('[data-look]')].map((block) => block.getAttribute('data-look') ?? '');
}

beforeEach(() => {
    setSystemTime(NOW);
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('routine.list', () => ({ routines: [MORNING], revs: { 'project-atlas': 4 }, timeZone: AMS }));
    machine.answer('artifact.get', () => ARTIFACT);
    machine.answer('bytes.read', ({ offset }) => ({ mime: 'text/markdown', size: REPORT.length, version: 'v', offset, data: btoa(REPORT.slice(offset)) }));
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await act(async () => useRoutinesStage.setState({ open: false, week: 0, filter: 'project', routine: null, runId: null }));
    await page.unmount();
    workspace.close();
    setSystemTime();
});

describe('a routine node', () => {
    test('draws its runs oldest first with the next time and its schedule, and leaves its Output to the card beside it', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => frameOf('node-1')?.querySelector('[data-look="next"]') != null);
        const frame = frameOf('node-1')!;
        expect(looks(frame)).toEqual(['caught-up', 'waited', 'skipped', 'next']);
        expect(frame.textContent).toContain('Weekdays at');
        expect(frame.textContent).toContain('Mon 09:00');
        // The newest run that ran is picked, and says what happened.
        expect(frame.textContent).toContain('after waiting for you');
        expect(frame.querySelector('[aria-pressed="true"]')?.getAttribute('data-look')).toBe('waited');
        expect(frame.textContent).not.toContain('v15');
    });

    test("a block opens that run in Routines, and the clock the routine's own page", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => frameOf('node-1')?.querySelector('[data-look="caught-up"]') != null);
        await clickOn(frameOf('node-1')!.querySelector('[data-look="caught-up"]'));
        expect(useRoutinesStage.getState()).toMatchObject({ open: true, routine: { projectId: 'project-atlas', routineId: 'morning' }, runId: 'wed' });

        await act(async () => useRoutinesStage.setState({ open: false, routine: null, runId: null }));
        await clickOn(frameOf('node-1')!.querySelector('button[aria-label="Open in Routines"]'));
        expect(useRoutinesStage.getState()).toMatchObject({ open: true, routine: { routineId: 'morning' }, runId: null });
    });

    test('the switch in its header pauses the routine on the machine', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => frameOf('node-1')?.querySelector('[role="switch"]') != null);
        const toggle = frameOf('node-1')!.querySelector('[role="switch"]')!;
        expect(toggle.getAttribute('aria-checked')).toBe('true');
        await clickOn(toggle);
        await until(() => machine.requests('routine.pause').length === 1);
        expect(machine.requests('routine.pause')[0]).toEqual({ projectId: 'project-atlas', routineId: 'morning' });
    });

    test('a routine this machine does not keep says so', async () => {
        await open([routineNode('node-1', 'nightly'), routineNode('node-2')]);
        await until(() => (frameOf('node-2')?.textContent ?? '').includes('not on this machine'));
        expect(frameOf('node-1')?.textContent).toContain('This routine is not on this machine');
    });

    test("Show on canvas in a routine's page places it on the canvas", async () => {
        await open([]);
        await act(async () => showRoutine({ projectId: 'project-atlas', routineId: 'morning' }));
        await until(() => document.querySelector('[role="dialog"][aria-label="Routines"] [aria-label="More"]') !== null);
        await clickOn(document.querySelector<HTMLElement>('[role="dialog"][aria-label="Routines"] [aria-label="More"]'));
        await until(() => document.querySelector('[role="menu"]') !== null);
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Show on canvas') ?? null);
        await until(() => !useRoutinesStage.getState().open && liveCanvas('main') !== null);
        // The page has no layout to measure, so the canvas gets the size a window would give it.
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').length > 0);
        const view = machine
            .requests('project.save')
            .at(-1)
            ?.content.views.find((candidate) => candidate.id === 'main');
        expect(view?.kind === 'canvas' ? view.nodes[0] : null).toMatchObject({ kind: 'routine', routine: 'morning', title: 'Morning summary' });
    });

    test("the dock's plus places one of the project's routines on the canvas", async () => {
        await open([]);
        await until(() => liveCanvas('main') !== null);
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        await clickOn(page.host.querySelector<HTMLElement>('[aria-label="Add"]'));
        await until(() => document.querySelector('[role="menu"]') !== null);
        await openSubmenu('Routine');
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Morning summary') ?? null);
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine' && node.routine === 'morning'));
    });

    test("a right-click on the canvas places one of the project's routines there", async () => {
        await open([]);
        await until(() => liveCanvas('main') !== null);
        await act(async () => liveCanvas('main')!.setViewport({ w: 1280, h: 800 }));
        const surface = page.host.querySelector('[data-canvas-surface]')!;
        await act(async () => {
            surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        await openSubmenu('Routine');
        const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        expect(items().some((item) => item.textContent?.trim() === 'New routine…')).toBe(true);
        await clickOn(items().find((item) => item.textContent?.trim() === 'Morning summary') ?? null);
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'routine'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').length > 0);
        const view = machine
            .requests('project.save')
            .at(-1)
            ?.content.views.find((candidate) => candidate.id === 'main');
        expect(view?.kind === 'canvas' ? view.nodes[0] : null).toMatchObject({ kind: 'routine', routine: 'morning', title: 'Morning summary' });
    });
});

describe('beside a routine node', () => {
    const THREAD = [
        { id: 'u1', kind: 'user', turnId: 'turn-1', createdAt: 0, text: 'Summarize what changed on main.' },
        { id: 'a1', kind: 'assistant', turnId: 'turn-1', createdAt: 1, text: 'Three commits on main, all checks green.', streaming: false }
    ];

    let restoreLayout: () => void;

    beforeEach(() => {
        restoreLayout = layOutChat();
        machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: THREAD, seq: THREAD.length }) as never);
    });

    afterEach(() => {
        restoreLayout();
        // The switch is held for the window as well as in storage, so one test's never reaches the next.
        setRunsHidden('main', 'node-1', false);
    });

    function cards(): HTMLElement[] {
        return [...page.host.querySelectorAll<HTMLElement>('[data-derived-of="node-1"]')];
    }

    function card(label: string): HTMLElement | undefined {
        return cards().find((candidate) => candidate.getAttribute('aria-label') === label);
    }

    test('the newest run that ran is open with its thread and no composer, and the others are a line each', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => (card('Morning summary · Thu, Oct 22')?.textContent ?? '').includes('Summarize what changed on main.'));
        expect(card('Morning summary · Thu, Oct 22')!.textContent).toContain('Three commits on main, all checks green.');
        // Replying is the routine's own view's: the card only reads.
        expect(card('Morning summary · Thu, Oct 22')!.querySelector('[contenteditable="true"]')).toBeNull();
        expect(card('Morning summary · Fri, Oct 23')?.querySelector('button[aria-expanded="false"]')?.textContent).toContain('Skipped');
        expect(card('Morning summary · Wed, Oct 21')?.querySelector('button[aria-expanded="false"]')?.textContent).toContain('Caught up on wake');
        expect(machine.requests('chat.attach').map((request) => request.chatId)).toEqual(['chat-thu']);
    });

    test('a run whose chat was not there yet when the card opened shows its thread once the run moves on', async () => {
        let started = false;
        machine.answer('chat.attach', ({ chatId }) => {
            if (!started) {
                throw new Error('No chat with that id');
            }
            return { info: chatInfoOf(chatId), items: THREAD, seq: THREAD.length } as never;
        });
        await open([routineNode('node-1', 'morning')]);
        await until(() => machine.requests('chat.attach').length === 1);
        expect(card('Morning summary · Thu, Oct 22')!.textContent).not.toContain('Summarize what changed on main.');
        started = true;
        const thursday = { ...MORNING.runs[1]!, endedAt: MORNING.runs[1]!.endedAt! + 60_000 };
        machine.answer('routine.list', () => ({
            routines: [{ ...MORNING, runs: [MORNING.runs[0]!, thursday, MORNING.runs[2]!] }],
            revs: { 'project-atlas': 5 },
            timeZone: AMS
        }));
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await until(() => (card('Morning summary · Thu, Oct 22')?.textContent ?? '').includes('Summarize what changed on main.'));
    });

    test('the open run starts at its smallest height, never the largest, and the cards under it follow', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Thu, Oct 22') !== undefined);
        // happy-dom lays out nothing, so the thread measures empty and the card keeps its minimum.
        expect(card('Morning summary · Thu, Oct 22')!.style.height).toBe('120px');
        expect(card('Morning summary · Wed, Oct 21')!.style.top).toBe(`${40 + 8 + 120 + 8}px`);
    });

    test('the open run takes the height of its laid out thread in one step, and opens at it again at once', async () => {
        // The afterEach puts back what was there before the beforeEach, so this needs no restore of its own.
        layOut((element) => {
            if (element.hasAttribute('data-index')) {
                return 100;
            }
            // The thread's own frame, which it waits for before it shows its rows.
            const frame = element.parentElement?.classList.contains('chat-column') === true;
            return element.classList.contains('chat-scroll') || frame ? 800 : null;
        });
        const heights: string[] = [];
        const watch = new MutationObserver(() => {
            const height = document.querySelector<HTMLElement>('[aria-label="Morning summary · Thu, Oct 22"]')?.style.height;
            if (height !== undefined && heights.at(-1) !== height) {
                heights.push(height);
            }
        });
        watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
        await open([routineNode('node-1', 'morning')]);
        // Its header and borders, and two rows of 100; happy-dom has no stylesheet, so the thread's padding is nothing.
        await until(() => card('Morning summary · Thu, Oct 22')?.style.height === '248px');
        expect(heights.filter((height) => height !== '0px')).toEqual(['120px', '248px']);

        await clickOn(card('Morning summary · Wed, Oct 21')!.querySelector('button[aria-expanded="false"]'));
        await until(() => card('Morning summary · Thu, Oct 22')?.querySelector('button[aria-expanded="false"]') != null);
        heights.length = 0;
        await clickOn(card('Morning summary · Thu, Oct 22')!.querySelector('button[aria-expanded="false"]'));
        await until(() => card('Morning summary · Thu, Oct 22')?.querySelector('button[aria-expanded="false"]') == null);
        watch.disconnect();
        expect(heights).toEqual(['248px']);
    });

    test("a wheel over a card moves the canvas until a press gives the card's node the focus", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined);
        await act(async () => liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 }));
        const wheel = (): WheelEvent => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40, clientX: 1100, clientY: 200 });
        const output = card('Output')!.firstElementChild!;
        // First with the focus, since a pan once started keeps the wheel for a moment whatever it passes over.
        await act(async () => {
            output.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
        });
        expect(liveCanvas('main')!.bodyFocusId).toBe('node-1');
        const scrolled = wheel();
        await act(async () => {
            output.dispatchEvent(scrolled);
        });
        expect(scrolled.defaultPrevented).toBe(false);
        expect(liveCanvas('main')!.camera.y).toBe(0);
        await act(async () => liveCanvas('main')!.setBodyFocus(null));
        const panned = wheel();
        await act(async () => {
            output.dispatchEvent(panned);
        });
        expect(panned.defaultPrevented).toBe(true);
        await until(() => liveCanvas('main')!.camera.y !== 0);
    });

    test('a person widens the column of runs, which the Output moves with, and the width stays this client’s', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined);
        await act(async () => liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 }));
        const surface = page.host.querySelector('[data-canvas-surface]')!;
        const at = (type: string, x: number, y: number): PointerEvent =>
            new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        // Just right of the first run's line (472 + 440, 0 to 40), which offers only that edge.
        await act(async () => {
            surface.dispatchEvent(at('pointermove', 918, 20));
        });
        await until(() => page.host.querySelector('[data-resize-node="derived:node-1:run:fri"]') !== null);
        const handle = page.host.querySelector('[data-resize-node="derived:node-1:run:fri"]')!;
        expect(handle.getAttribute('data-resize')).toBe('e');
        await act(async () => {
            handle.dispatchEvent(at('pointerdown', 918, 20));
            surface.dispatchEvent(at('pointermove', 1017, 20));
            surface.dispatchEvent(at('pointerup', 1017, 20));
        });
        // 539 wide by the pointer, 536 on the grid, for every run and the Output beside them.
        expect(card('Morning summary · Fri, Oct 23')!.style.width).toBe('536px');
        expect(card('Morning summary · Thu, Oct 22')!.style.width).toBe('536px');
        expect(card('Output')!.style.left).toBe(`${472 + 536 + 72}px`);
        expect(JSON.parse(localStorage.getItem('ruimte.routineRuns.main.node-1') ?? 'null')).toEqual({ w: 536 });
        expect(liveCanvas('main')).toMatchObject({ resizing: null, past: [] });
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(machine.requests('project.save')).toEqual([]);
    });

    test('a line opens its run in place of the open one', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Wed, Oct 21')?.querySelector('button[aria-expanded="false"]') != null);
        await clickOn(card('Morning summary · Wed, Oct 21')!.querySelector('button[aria-expanded="false"]'));
        await until(() => (card('Morning summary · Wed, Oct 21')?.textContent ?? '').includes('ran when the machine woke'));
        expect(card('Morning summary · Thu, Oct 22')?.querySelector('button[aria-expanded="false"]')).not.toBeNull();
        // The Output follows the open run to the version it kept.
        await until(() => (card('Output')?.textContent ?? '').includes('v14'));
        expect(card('Output')!.textContent).not.toContain('saved no version');
        // The run column picks the version, so the card offers no picker of its own.
        expect([...card('Output')!.querySelectorAll('header button')].some((button) => button.getAttribute('aria-haspopup') === 'menu')).toBe(false);
        expect(card('Output')!.querySelector('header button[aria-label="Open"]')).not.toBeNull();
    });

    test('the open run collapses too, so every run is a line', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Thu, Oct 22')?.querySelector('button[aria-label="Collapse"]') != null);
        await clickOn(card('Morning summary · Thu, Oct 22')!.querySelector('button[aria-label="Collapse"]'));
        await until(() => cards().filter((candidate) => candidate.querySelector(':scope > button[aria-expanded="false"]') !== null).length === 3);
        expect(machine.requests('chat.attach').length).toBeLessThanOrEqual(1);
    });

    test("the Output card says when the open run kept no version and shows the newest run's", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => (card('Output')?.textContent ?? '').includes('All green'));
        expect(card('Output')!.textContent).toContain('v14');
        expect(card('Output')!.textContent).toContain('This run saved no version. Showing the one from Wed, Oct 21.');
    });

    test("a person sizes the Output card, and the size stays this client's", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined);
        await act(async () => liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 }));
        const surface = page.host.querySelector('[data-canvas-surface]')!;
        const at = (type: string, x: number, y: number): PointerEvent =>
            new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y });
        // Just past the card's bottom-right corner (984 + 440, 480), where the canvas offers its corner handle.
        await act(async () => {
            surface.dispatchEvent(at('pointermove', 1430, 486));
        });
        await until(() => page.host.querySelector('[data-resize-node="derived:node-1:output"]') !== null);
        const handle = page.host.querySelector('[data-resize-node="derived:node-1:output"]')!;
        expect(handle.getAttribute('data-resize')).toBe('se');
        await act(async () => {
            handle.dispatchEvent(at('pointerdown', 1430, 486));
            surface.dispatchEvent(at('pointermove', 1491, 526));
            surface.dispatchEvent(at('pointerup', 1491, 526));
        });
        // 501 wide by the pointer, 504 on the grid.
        expect(card('Output')!.style.width).toBe('504px');
        expect(JSON.parse(localStorage.getItem('ruimte.routineOutput.main.node-1') ?? 'null')).toEqual({ w: 504, h: 520 });
        expect(liveCanvas('main')).toMatchObject({ resizing: null, past: [] });
        expect(Object.keys(liveCanvas('main')!.nodes)).toEqual(['node-1']);
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(machine.requests('project.save')).toEqual([]);
    });

    test("the cards wear the routine node's color", async () => {
        await open([{ ...routineNode('node-1', 'morning'), accent: 'teal' }]);
        await until(() => card('Output')?.querySelector('header') != null && card('Morning summary · Thu, Oct 22')?.querySelector('header') != null);
        // happy-dom keeps no color-mix in a plain property, only in a custom one: the shade a button in the header hovers to.
        expect(card('Output')!.querySelector('header')!.getAttribute('style')).toContain('#009689 34%');
        expect(card('Morning summary · Thu, Oct 22')!.querySelector('header')!.getAttribute('style')).toContain('#009689 34%');
        expect(card('Morning summary · Fri, Oct 23')!.querySelector('button')!.getAttribute('style')).toContain('--run-tint: color-mix(in srgb, #009689 20%');
    });

    test('switching the open run closes one and opens the other in the same commit, never two open at once', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Wed, Oct 21')?.querySelector('button[aria-expanded="false"]') != null);
        const runCards = (): HTMLElement[] => cards().filter((candidate) => candidate.getAttribute('aria-label')?.startsWith('Morning summary'));
        const tall = (): string[] =>
            runCards()
                .filter((candidate) => candidate.style.height !== '40px')
                .map((candidate) => candidate.getAttribute('aria-label')!);
        // What every batch of changes to the cards left on screen, read when the batch is delivered.
        const seen: string[][] = [];
        const watcher = new MutationObserver(() => seen.push(tall()));
        watcher.observe(page.host, { subtree: true, attributes: true, attributeFilter: ['style'] });
        await act(async () => {
            card('Morning summary · Wed, Oct 21')!.querySelector<HTMLElement>('button[aria-expanded="false"]')!.click();
        });
        watcher.disconnect();
        expect(tall()).toEqual(['Morning summary · Wed, Oct 21']);
        expect(card('Morning summary · Thu, Oct 22')!.style.height).toBe('40px');
        expect(seen.every((open) => open.length <= 1)).toBe(true);
    });

    test("the map draws the cards in their node's color, takes them into what it shows, and only pans", async () => {
        useSettings.getState().update({ canvasMinimap: true });
        try {
            await open([{ ...routineNode('node-1', 'morning'), accent: 'teal' }]);
            await until(() => card('Output') !== undefined);
            await act(async () => {
                liveCanvas('main')!.setViewport({ w: 1280, h: 800 });
                liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 });
            });
            const map = (): SVGSVGElement | null => document.querySelector('svg[role="img"][aria-label="Canvas map"]');
            await until(() => map()?.querySelector('[data-minimap-card="derived:node-1:output"]') != null);
            const rects = [...map()!.querySelectorAll<SVGRectElement>('[data-minimap-card]')];
            expect(rects.map((rect) => rect.getAttribute('data-minimap-card'))).toContain('derived:node-1:run:thu');
            // The node and its cards read as one, in the node's color.
            expect(map()!.querySelector('[data-minimap-node="node-1"]')!.getAttribute('fill')).toBe('#009689');
            expect(rects.every((rect) => rect.getAttribute('fill') === '#009689')).toBe(true);
            // The Output reaches 984 + 440 to the right, past the view: the map still holds all of it.
            const [, tx, ty, scale] = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/
                .exec(map()!.querySelector('g')!.getAttribute('transform')!)!
                .map(Number);
            for (const rect of rects) {
                const right = (Number(rect.getAttribute('x')) + Number(rect.getAttribute('width'))) * scale! + tx!;
                const bottom = (Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))) * scale! + ty!;
                expect(right).toBeLessThanOrEqual(192);
                expect(bottom).toBeLessThanOrEqual(128);
            }
            await act(async () => {
                rects[0]!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
                rects[0]!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
            });
            expect(liveCanvas('main')).toMatchObject({ selection: [], navigationId: null, bodyFocusId: null });
        } finally {
            useSettings.getState().update({ canvasMinimap: false });
        }
    });

    test("the node's menu hides its runs, which leaves the Output in their place, this client's and saved nowhere", async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined && card('Morning summary · Thu, Oct 22') !== undefined);
        const showRuns = async (): Promise<HTMLElement> => {
            await act(async () => {
                frameOf('node-1')!
                    .querySelector('header')!
                    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 20, button: 2 }));
            });
            await until(() => [...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.trim() === 'Show runs'));
            return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Show runs')!;
        };
        await clickOn(await showRuns());
        await until(() => card('Morning summary · Thu, Oct 22') === undefined);
        expect(cards().map((candidate) => candidate.getAttribute('aria-label'))).toEqual(['Output']);
        // In the first column, top aligned with the node, at its own size.
        expect(card('Output')!.style.left).toBe('472px');
        expect(card('Output')!.style.top).toBe('0px');
        expect(card('Output')!.style.width).toBe('440px');
        // Without runs to pick from the card has the artifact node's version picker, on the latest at first.
        const picker = (): HTMLElement | undefined =>
            [...card('Output')!.querySelectorAll<HTMLElement>('header button')].find(
                (button) => button.textContent?.includes('Latest') || /^v\d+/.test(button.textContent ?? '')
            );
        await until(() => picker() !== undefined);
        expect(picker()!.textContent).toContain('Latest');
        expect(picker()!.getAttribute('aria-haspopup')).toBe('menu');
        await clickOn(picker()!);
        await until(() => [...document.querySelectorAll('[role="menuitemradio"]')].some((item) => item.textContent?.includes('Version 14')));
        await clickOn([...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Version 14'))!);
        await until(() => picker()?.textContent?.includes('v14') === true);
        expect(localStorage.getItem('ruimte.routineRunsHidden.main.node-1')).toBe('true');
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(machine.requests('project.save')).toEqual([]);

        await clickOn(await showRuns());
        await until(() => card('Morning summary · Thu, Oct 22') !== undefined);
        expect(card('Output')!.style.left).toBe(`${472 + 440 + 72}px`);
        expect(localStorage.getItem('ruimte.routineRunsHidden.main.node-1')).toBeNull();
    });

    test('a press in a card gives the routine node the keyboard and selects nothing', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Fri, Oct 23') !== undefined);
        await act(async () => {
            card('Morning summary · Fri, Oct 23')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
        });
        expect(liveCanvas('main')).toMatchObject({ bodyFocusId: 'node-1', selection: [] });
    });

    test('a card that holds the focus wears the ring a selected node does, until the focus leaves it', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined);
        await act(async () => {
            card('Output')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
        });
        expect(card('Output')!.classList.contains('node-selected')).toBe(true);
        expect(card('Morning summary · Thu, Oct 22')!.classList.contains('node-selected')).toBe(false);
        await act(async () => {
            card('Morning summary · Thu, Oct 22')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
        });
        expect(card('Output')!.classList.contains('node-selected')).toBe(false);
        expect(card('Morning summary · Thu, Oct 22')!.classList.contains('node-selected')).toBe(true);
        // A press in the node itself takes the focus away from the cards.
        await act(async () => {
            frameOf('node-1')!
                .querySelector('[data-node-body]')!
                .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
        });
        expect(cards().some((candidate) => candidate.classList.contains('node-selected'))).toBe(false);
    });

    test('the keys step from the routine node onto its cards, Enter goes into one and Escape comes out', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Output') !== undefined);
        await act(async () => liveCanvas('main')!.select(['node-1']));
        const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        await act(async () => {
            document.body.dispatchEvent(key({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }));
        });
        // On a card the keys stand without selecting it: nothing moves or removes a card.
        const onRun = liveCanvas('main')!;
        expect(onRun.selection).toEqual([]);
        expect(onRun.navigationId).toStartWith('derived:node-1:run:');
        expect(cards().filter((candidate) => candidate.classList.contains('node-selected'))).toHaveLength(1);
        await act(async () => {
            document.body.dispatchEvent(key({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }));
        });
        expect(liveCanvas('main')!.navigationId).toBe('derived:node-1:output');
        expect(card('Output')!.classList.contains('node-selected')).toBe(true);
        await act(async () => {
            document.body.dispatchEvent(key({ key: 'Enter', code: 'Enter' }));
        });
        expect(liveCanvas('main')).toMatchObject({ bodyFocusId: 'node-1', navigationId: 'derived:node-1:output', selection: [] });
        expect(card('Output')!.contains(document.activeElement)).toBe(true);
        await act(async () => {
            document.activeElement!.dispatchEvent(key({ key: 'Escape', code: 'Escape' }));
        });
        expect(liveCanvas('main')).toMatchObject({ bodyFocusId: null, navigationId: 'derived:node-1:output' });
        await act(async () => {
            document.body.dispatchEvent(key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }));
        });
        expect(liveCanvas('main')!.navigationId).toStartWith('derived:node-1:run:');
        expect(Object.keys(liveCanvas('main')!.nodes)).toEqual(['node-1']);
    });

    test('the cards are drawn, never stored', async () => {
        await open([routineNode('node-1', 'morning')]);
        await until(() => card('Morning summary · Wed, Oct 21')?.querySelector('button[aria-expanded="false"]') != null);
        await clickOn(card('Morning summary · Wed, Oct 21')!.querySelector('button[aria-expanded="false"]'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(Object.keys(liveCanvas('main')!.nodes)).toEqual(['node-1']);
        for (const save of machine.requests('project.save')) {
            const view = save.content.views.find((candidate) => candidate.id === 'main');
            expect(view?.kind === 'canvas' ? view.nodes.map((node) => node.id) : null).toEqual(['node-1']);
        }
    });
});
