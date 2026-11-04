import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { formatDateTime } from '@adecore/ui/format';
import { EditorView } from '@codemirror/view';
import { REQUEST_SCHEMAS, zonedTime, type RequestType, type RoutineEntry, type RoutineRun } from '@ruimte/contracts';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { showRoutine, useRoutinesStage } from '@/routines/stage';
import { liveCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { buttonWithText } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const AMS = 'Europe/Amsterdam';
const MAIN = emptyCanvas();
// Sunday 25 October 2026, 14:20 on the machine's clock.
const NOW = zonedTime(2026, 10, 25, 14, 20, AMS);

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let routines: RoutineEntry[];

function run(runId: string, day: number, patch: Partial<RoutineRun> & Pick<RoutineRun, 'state'>): RoutineRun {
    const due = zonedTime(2026, 10, day, 9, 0, AMS);
    return { runId, routineId: 'morning', projectId: 'project-atlas', kind: 'scheduled', due, at: due, endedAt: due + 180_000, ...patch };
}

function entry(id: string, title: string, patch: Partial<RoutineEntry> = {}): RoutineEntry {
    return {
        routine: {
            id,
            kind: 'agent',
            title,
            schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
            outputKey: id,
            prompt: 'Summarize what changed on main.',
            provider: 'claude',
            mode: 'supervised',
            perRun: 'new'
        },
        projectId: 'project-atlas',
        projectName: 'Atlas',
        shared: false,
        local: {},
        digest: `digest-${id}`,
        approved: true,
        next: zonedTime(2026, 10, 26, 9, 0, AMS),
        runs: [],
        ...patch
    };
}

const MORNING = entry('morning', 'Morning summary', {
    runs: [
        run('fri', 23, { state: 'skipped', skipped: 'overlap' }),
        run('thu', 22, { state: 'done', waited: true }),
        run('wed', 21, { state: 'done', kind: 'caught-up', at: zonedTime(2026, 10, 21, 9, 41, AMS) }),
        run('tue', 20, { state: 'limit' }),
        run('mon', 19, { state: 'done' })
    ]
});

const HELD: RoutineEntry = {
    ...entry('changelog', 'Weekly changelog draft', { approved: false, held: 'outside', shared: true, next: null }),
    routine: {
        ...MORNING.routine,
        id: 'changelog',
        title: 'Weekly changelog draft',
        outputKey: 'changelog',
        schedule: { kind: 'weekly', days: [5], time: '16:00' }
    }
};

const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, diffs: 'before-after', slashCommands: true });

function text(): string {
    return document.body.textContent ?? '';
}

function stage(): HTMLElement | null {
    return document.querySelector('[role="dialog"][aria-label="Routines"]');
}

function clock(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('nav[aria-label="Tools"] button[aria-label^="Routines"]');
}

/* The prompt of the routine form, an editor rather than a text field. */
function promptEditor(form: ParentNode): EditorView {
    return EditorView.findFromDOM(form.querySelector<HTMLElement>('.cm-content')!)!;
}

async function typePrompt(form: ParentNode, words: string): Promise<void> {
    await act(async () => {
        const view = promptEditor(form);
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function sidePanelShown(): boolean {
    return document.body.querySelector('.ade-workspace')?.hasAttribute('data-side-panel') ?? false;
}

function looksOf(routineId: string): string[] {
    return [...document.body.querySelectorAll(`[data-routine="${routineId}"] [data-look]`)].map((block) => block.getAttribute('data-look') ?? '');
}

async function openStage(): Promise<void> {
    await until(() => clock() !== null);
    await clickOn(clock());
    await until(() => stage() !== null && text().includes('Week 43'));
}

beforeEach(async () => {
    setSystemTime(NOW);
    localStorage.clear();
    routines = [MORNING];
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }));
    machine.answer('routine.list', () => ({ routines, revs: { 'project-atlas': 4 }, timeZone: AMS }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        useRoutinesStage.setState({ open: false, week: 0, filter: 'project', routine: null, runId: null });
        useUi.getState().setPanel({ open: false, kind: 'files' });
    });
    await page.unmount();
    workspace.close();
    setSystemTime();
});

describe('Routines', () => {
    test('floats over the view and its panel, and Close, Escape and its key each leave it', async () => {
        await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
        await until(() => sidePanelShown());
        await openStage();
        expect(sidePanelShown()).toBe(true);
        expect(machine.requests('routine.watch')).toHaveLength(1);

        await clickOn(buttonWithText('Close', stage()!));
        await until(() => stage() === null);
        expect(useUi.getState().panel).toEqual({ open: true, kind: 'output' });

        const pressShortcut = (target: HTMLElement): Promise<void> =>
            pressKey(target, 's', { altKey: true, metaKey: isApplePlatform(), ctrlKey: !isApplePlatform() });
        await pressShortcut(document.body);
        await until(() => stage() !== null);
        await pressKey(stage()!, 'Escape');
        await until(() => stage() === null);

        await pressShortcut(document.body);
        await until(() => stage() !== null);
        await pressShortcut(stage()!);
        await until(() => stage() === null);
    });

    test('draws a block per run by its state, and the times still to come', async () => {
        await openStage();
        expect(looksOf('morning')).toEqual(['done', 'limit', 'caught-up', 'waited', 'skipped']);
        expect(text()).toContain('October 19 to 25');
        const row = document.body.querySelector('[data-routine="morning"] [role="rowheader"]')?.textContent ?? '';
        expect(row).toContain('Weekdays at');
        expect(row).toContain('Claude Code');
        await clickOn(document.body.querySelector('button[aria-label="Next week"]'));
        await until(() => text().includes('Week 44'));
        expect(looksOf('morning')).toEqual(['next', 'next', 'next', 'next', 'next']);
    });

    test('a block opens a card of its run, and its actions go where the stage goes', async () => {
        machine.answer('routine.runNow', () => ({ outcome: 'started' as const, runId: 'now' }));
        await openStage();
        const card = (): Element | null => document.querySelector('[aria-label="Run of Morning summary"]');
        await clickOn(document.body.querySelector('[data-routine="morning"] button[data-look="done"]'));
        await until(() => card()?.textContent?.includes('Started') === true);
        expect(card()?.textContent).toContain('Atlas');
        expect(card()?.textContent).toContain('Done in 3 min');
        // Only a routine with a node on a canvas offers the way there.
        expect(buttonWithText('Open on canvas', card()!)).toBeNull();

        await clickOn(buttonWithText('Run now', card()!));
        await until(() => machine.requests('routine.runNow').length === 1);
        expect(machine.requests('routine.runNow')[0]).toEqual({ projectId: 'project-atlas', routineId: 'morning' });
        await until(() => card() === null);

        await clickOn(document.body.querySelector('[data-routine="morning"] button[data-look="done"]'));
        await until(() => card() !== null);
        await clickOn(buttonWithText('Open in Routines', card()!));
        expect(useRoutinesStage.getState()).toMatchObject({ routine: { projectId: 'project-atlas', routineId: 'morning' }, runId: 'mon' });
    });

    test('a paused routine draws the rest of the week as one band, and Resume picks it up again', async () => {
        const pausedRun = (day: number): RoutineRun => ({ ...run(`bundle-${day}`, day, { state: 'skipped', skipped: 'paused' }), routineId: 'bundle' });
        routines = [
            MORNING,
            entry('bundle', 'Bundle size report', {
                local: { pausedAt: zonedTime(2026, 10, 13, 10, 0, AMS) },
                next: null,
                runs: [pausedRun(23), pausedRun(22), pausedRun(21)]
            })
        ];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        const band = (): Element | null => document.body.querySelector('[data-routine="bundle"] [data-band="paused"]');
        await until(() => band() !== null);
        expect(band()?.textContent).toContain('Paused since');
        expect(band()?.textContent).toContain('3 runs skipped');
        await clickOn(buttonWithText('Resume', band()!));
        await until(() => machine.requests('routine.resume').length === 1);
        expect(machine.requests('routine.resume')[0]).toEqual({ projectId: 'project-atlas', routineId: 'bundle' });
    });

    test('approving a routine from git sends the digest that was shown', async () => {
        routines = [MORNING, HELD];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await until(() => document.body.querySelector('article[aria-label="Weekly changelog draft"]') !== null);
        const card = document.body.querySelector('article[aria-label="Weekly changelog draft"]');
        expect(card?.textContent).toContain('Every Friday at');
        expect(card?.textContent).toContain('Added through the project file');
        await clickOn(buttonWithText('Approve', card!));
        await until(() => machine.requests('routine.approve').length === 1);
        expect(machine.requests('routine.approve')[0]).toEqual({ projectId: 'project-atlas', routineId: 'changelog', digest: 'digest-changelog' });
    });

    test("what waits in another project shows beside this project's week, so the clock's dot is never unexplained", async () => {
        routines = [MORNING, { ...HELD, projectId: 'project-other', projectName: 'Other' }];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-other' }));
        await until(() => document.body.querySelector('article[aria-label="Weekly changelog draft"]') !== null);
        // The week stays this project's; only the column reaches further.
        expect(document.body.querySelector('[data-routine="changelog"]')).toBeNull();
        expect(clock()?.getAttribute('aria-label')).toBe('Routines, 1 needs you');
    });

    test('a routine that waits for approval says so over its definition, and approves from there', async () => {
        routines = [MORNING, HELD];
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await act(async () => showRoutine({ projectId: 'project-atlas', routineId: 'changelog' }));
        await until(() => text().includes('Needs your approval'));
        expect(text()).toContain('Added through the project file');
        await clickOn(buttonWithText('Approve', document.body));
        await until(() => machine.requests('routine.approve').length === 1);
        expect(machine.requests('routine.approve')[0]).toEqual({ projectId: 'project-atlas', routineId: 'changelog', digest: 'digest-changelog' });
    });

    test('a cron routine waits for an expression it reads, shows its next times and sends it', async () => {
        await openStage();
        await clickOn(buttonWithText('New routine', document.body));
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        await typePrompt(form, 'Check the build.');
        await clickOn(buttonWithText('Cron', form));
        await until(() => [...form.querySelectorAll('label')].some((label) => label.textContent === 'Cron expression'));
        const label = [...form.querySelectorAll('label')].find((candidate) => candidate.textContent === 'Cron expression')!;
        const field = document.getElementById(label.htmlFor) as HTMLInputElement;
        const create = buttonWithText('Create routine', form) as HTMLButtonElement;

        await type(field, '*/5 * * * *');
        expect(form.querySelector('[role="alert"]')?.textContent).toStartWith('This runs more often than every 15 minutes.');
        expect(create.disabled).toBe(true);
        await type(field, '0 25 * * *');
        expect(form.querySelector('[role="alert"]')?.textContent).toBe('The hour (0-23) field does not take "25".');

        await type(field, ' 30 8  * * 1-5');
        expect(form.querySelector('[role="alert"]')).toBeNull();
        const shown = (day: number): string =>
            formatDateTime(zonedTime(2026, 10, day, 8, 30, AMS), {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: AMS
            });
        expect(form.querySelector('[data-cron-next]')?.textContent).toBe(`Next: ${[26, 27, 28].map(shown).join(', ')}`);
        expect(create.disabled).toBe(false);
        await clickOn(create);
        await until(() => machine.requests('routine.save').length === 1);
        expect(machine.requests('routine.save')[0]!.routine.schedule).toEqual({ kind: 'cron', expression: '30 8 * * 1-5' });
    });

    test("a $ in the prompt offers the agent's skills in this project, and the pick goes with the routine", async () => {
        machine.answer('routine.skills', () => ({
            skills: [
                { name: 'html-report', description: 'Writes a report as a page.', source: 'user' as const },
                { name: 'release-notes', description: 'Drafts release notes.', source: 'project' as const }
            ]
        }));
        await openStage();
        await clickOn(buttonWithText('New routine', document.body));
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        await until(() => machine.requests('routine.skills').length > 0);
        expect(machine.requests('routine.skills')[0]).toEqual({ projectId: 'project-atlas', provider: 'claude' });

        await typePrompt(form, 'Summarize the week with $ht');
        const option = (name: string): Element | undefined => [...form.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes(name));
        await until(() => option('$html-report') !== undefined);
        expect(option('$release-notes')).toBeUndefined();
        // Picked with the keyboard: happy-dom builds an event's path after the pick took the row away, which reads as a press outside the dialog.
        await pressKey(promptEditor(form).contentDOM, 'Enter');
        expect(promptEditor(form).state.doc.toString()).toBe('Summarize the week with $html-report ');
        expect(form.querySelector('[role="option"]')).toBeNull();

        await clickOn(buttonWithText('Create routine', form));
        await until(() => machine.requests('routine.save').length === 1);
        expect(machine.requests('routine.save')[0]!.routine).toMatchObject({
            kind: 'agent',
            prompt: 'Summarize the week with $html-report',
            picked: { skills: ['html-report'] }
        });
    });

    test('a routine through the day sends its days, its step and its first and last time', async () => {
        await openStage();
        await clickOn(buttonWithText('New routine', document.body));
        await until(() => document.querySelector('form[aria-label="New routine"]') !== null);
        const form = document.querySelector('form[aria-label="New routine"]')!;
        const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        await typePrompt(form, 'Check the build.');
        await clickOn(buttonWithText('Through the day', form));
        await until(() => form.querySelector('[aria-label="How often"]') !== null);
        await clickOn(buttonWithText('Sat', form));
        await clickOn(form.querySelector('[aria-label="How often"]'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === 'every 30 minutes') ?? null);
        await type(form.querySelector<HTMLInputElement>('input[aria-label="First time"]')!, '08:00');
        await type(form.querySelector<HTMLInputElement>('input[aria-label="Last time"]')!, '18:00');
        await clickOn(buttonWithText('Create routine', form));
        await until(() => machine.requests('routine.save').length === 1);
        expect(machine.requests('routine.save')[0]!.routine.schedule).toEqual({
            kind: 'interval',
            days: [1, 2, 3, 4, 5, 6],
            every: 30,
            from: '08:00',
            to: '18:00'
        });
    });

    test('the day of a routine through the day folds its runs and its coming times', async () => {
        const hour = (value: number): number => zonedTime(2026, 10, 23, value, 0, AMS);
        const runs = [9, 10, 11, 12].map((value) => ({
            ...run(`h${value}`, 23, { state: value === 10 ? 'failed' : 'done' }),
            routineId: 'hourly',
            due: hour(value),
            at: hour(value)
        }));
        const hourly = entry('hourly', 'Build check', { runs });
        routines = [
            { ...hourly, routine: { ...hourly.routine, schedule: { kind: 'interval', days: [1, 2, 3, 4, 5, 6, 7], every: 60, from: '09:00', to: '17:00' } } }
        ];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        await until(() => document.body.querySelector('[data-routine="hourly"] [data-fold="runs"]') !== null);
        const row = document.body.querySelector('[data-routine="hourly"]')!;
        const folded = row.querySelector<HTMLElement>('[data-fold="runs"]')!;
        expect(folded.textContent).toBe('4 runs · 1 failed');
        // Sunday from 14:20 on: 15:00, 16:00 and 17:00 are still to come.
        expect(row.querySelector('[data-fold="coming"]')?.getAttribute('aria-label')).toStartWith('Build check, 3 more times from');
        await clickOn(folded);
        await until(() => document.querySelector('[aria-label="Runs of Build check"]') !== null);
        const list = document.querySelector('[aria-label="Runs of Build check"]')!;
        expect([...list.querySelectorAll('[data-look]')].map((block) => block.getAttribute('data-look'))).toEqual(['done', 'failed', 'done', 'done']);
        await clickOn(list.querySelector('[data-look="failed"]'));
        await until(() => document.querySelector('[aria-label="Runs of Build check"]') === null);
    });

    test('the keys of the canvas under it do nothing while it is open', async () => {
        await openStage();
        await pressKey(stage()!, 'n', { altKey: true });
        expect(Object.keys(liveCanvas('main')?.nodes ?? {})).toEqual([]);

        await clickOn(buttonWithText('Close', document.body));
        await until(() => stage() === null);
        await pressKey(document.body, 'n', { altKey: true });
        await until(() => Object.values(liveCanvas('main')?.nodes ?? {}).some((node) => node.kind === 'note'));
    });

    test('a run that waits says what its chat asks, once the machine said so', async () => {
        const waiting = run('sun', 25, { state: 'needs-you', chatId: 'routine-chat-sun', at: zonedTime(2026, 10, 25, 9, 0, AMS) });
        routines = [{ ...MORNING, runs: [waiting, ...MORNING.runs] }];
        await openStage();
        await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
        const needsYou = (): string => document.body.querySelector('section[aria-label="Needs you"]')?.textContent ?? '';
        await until(() => needsYou().includes('Since'));
        const question = { id: 'q1', header: 'Branch', question: 'Which branch should the summary cover?', choices: [], multiSelect: false };
        const info = chatInfoOf('routine-chat-sun', {
            status: 'needs-you',
            requests: [{ requestId: 'r1', itemId: 'i1', kind: 'question', createdAt: waiting.at, question: { questions: [question] } }]
        });
        await act(async () => machine.emit('chat.status', { chatId: 'routine-chat-sun', info }));
        await until(() => needsYou().includes('Which branch should the summary cover?'));
    });

    test("a run's chat shows its thread in the routine's own page", async () => {
        const thread = [
            { id: 'u1', kind: 'user', turnId: 'turn-1', createdAt: 0, text: 'Summarize what changed on main.' },
            { id: 'a1', kind: 'assistant', turnId: 'turn-1', createdAt: 1, text: 'Three commits on main, all checks green.', streaming: false }
        ];
        const restoreLayout = layOutChat();
        try {
            machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: thread, seq: thread.length }) as never);
            routines = [{ ...MORNING, runs: MORNING.runs.map((candidate) => (candidate.runId === 'thu' ? { ...candidate, chatId: 'chat-thu' } : candidate)) }];
            await openStage();
            await act(async () => machine.emit('routine.changed', { projectId: 'project-atlas' }));
            await act(async () => showRoutine({ projectId: 'project-atlas', routineId: 'morning' }, 'thu'));
            await until(() => (stage()?.textContent ?? '').includes('Three commits on main, all checks green.'));
            expect(stage()!.textContent).toContain('Summarize what changed on main.');
            expect(machine.requests('chat.attach').map((request) => request.chatId)).toEqual(['chat-thu']);
        } finally {
            restoreLayout();
        }
    });

    test('a machine without routines shows no clock', async () => {
        machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => !type.startsWith('routine.')));
        await until(() => document.body.querySelector('nav[aria-label="Tools"] button[aria-label="Search"]') !== null);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(clock()).toBeNull();
    });
});
