import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView, SplitLayout } from '@ruimte/contracts';
import { PLAN_CLOSE_DELAY_MS, PlanPanelRules, type PlanClock, type PlanPanelState } from '@/plan/panel-rules';
import { chatsInSight, seenNodes, type ChatSightCanvas, type ChatSightWorkspace } from '@/state/attention';

/* Time moves only when a test says so. */
class FakeClock implements PlanClock {
    private now = 0;
    private next = 1;
    private readonly timers = new Map<number, { at: number; run: () => void }>();

    setTimeout(run: () => void, ms: number): unknown {
        const id = this.next++;
        this.timers.set(id, { at: this.now + ms, run });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.timers.delete(handle as number);
    }

    advance(ms: number): void {
        const until = this.now + ms;
        for (;;) {
            const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= until).sort((one, other) => one[1].at - other[1].at)[0];
            if (!due) {
                break;
            }
            this.timers.delete(due[0]);
            this.now = due[1].at;
            due[1].run();
        }
        this.now = until;
    }
}

let state: PlanPanelState;
let clock: FakeClock;
let rules: PlanPanelRules;

const sight = (...chatIds: string[]): void => rules.sight(new Set(chatIds));

beforeEach(() => {
    state = { anchor: null, open: false };
    clock = new FakeClock();
    rules = new PlanPanelRules({ get: () => state, set: (next) => (state = next), clock });
});

describe('which plan the panel shows', () => {
    test('a new plan from a chat in sight becomes the anchor and opens the panel', () => {
        sight('chat-a');
        expect(rules.created('chat-a', 'plan-1')).toBe(true);
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: false }, open: true });
    });

    test('with two chats in sight making a plan, the last one wins', () => {
        sight('chat-a', 'chat-b');
        rules.created('chat-a', 'plan-1');
        rules.created('chat-b', 'plan-2');
        expect(state.anchor).toEqual({ chatId: 'chat-b', planId: 'plan-2', dismissed: false });
        expect(state.open).toBe(true);
    });

    test('a chat out of sight making a plan changes nothing, so its pill gets the dot instead', () => {
        sight('chat-a');
        rules.created('chat-a', 'plan-1');
        const before = state;
        expect(rules.created('chat-b', 'plan-2')).toBe(false);
        expect(state).toBe(before);
    });

    test('a pill press anchors and opens, also after the panel was closed', () => {
        sight('chat-a');
        rules.created('chat-a', 'plan-1');
        rules.close();
        rules.pill('chat-a', 'plan-1');
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: false }, open: true });
    });

    test('the chat or the plan going away clears the anchor and closes the panel', () => {
        sight('chat-a');
        rules.created('chat-a', 'plan-1');
        rules.gone();
        expect(state).toEqual({ anchor: null, open: false });
    });

    test('what is on screen never moves the anchor', () => {
        sight('chat-a', 'chat-b');
        rules.created('chat-a', 'plan-1');
        sight('chat-b');
        sight('chat-b', 'chat-a');
        clock.advance(PLAN_CLOSE_DELAY_MS * 4);
        expect(state.anchor).toEqual({ chatId: 'chat-a', planId: 'plan-1', dismissed: false });
    });

    test('picking another plan of the chat keeps the panel as it was', () => {
        sight('chat-a');
        rules.created('chat-a', 'plan-2');
        rules.pick('plan-1');
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: false }, open: true });
    });
});

describe('when the panel is open', () => {
    beforeEach(() => {
        sight('chat-a');
        rules.created('chat-a', 'plan-1');
    });

    test('open while the anchor chat is in sight', () => {
        sight('chat-a', 'chat-b');
        clock.advance(PLAN_CLOSE_DELAY_MS * 2);
        expect(state.open).toBe(true);
    });

    test('closed a moment after the anchor chat left, with the anchor kept', () => {
        sight();
        clock.advance(PLAN_CLOSE_DELAY_MS - 1);
        expect(state.open).toBe(true);
        clock.advance(1);
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: false }, open: false });
    });

    test('a pan past the chat leaves the panel up', () => {
        sight();
        clock.advance(PLAN_CLOSE_DELAY_MS - 50);
        sight('chat-a');
        clock.advance(PLAN_CLOSE_DELAY_MS * 2);
        expect(state.open).toBe(true);
    });

    test('open again at once when the anchor chat comes back', () => {
        sight();
        clock.advance(PLAN_CLOSE_DELAY_MS);
        expect(state.open).toBe(false);
        sight('chat-a');
        expect(state.open).toBe(true);
    });

    test('a restored anchor opens once its chat is in sight', () => {
        rules.gone();
        sight();
        state = { anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: false }, open: false };
        rules.settle();
        expect(state.open).toBe(false);
        sight('chat-a');
        expect(state.open).toBe(true);
    });

    test('closed by a person, it stays closed while the chat stays in sight or comes back', () => {
        rules.close();
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-1', dismissed: true }, open: false });
        sight('chat-a');
        sight();
        clock.advance(PLAN_CLOSE_DELAY_MS);
        sight('chat-a');
        expect(state.open).toBe(false);
    });

    test('closed by a person, a new plan from that chat opens it again', () => {
        rules.close();
        rules.created('chat-a', 'plan-2');
        expect(state).toEqual({ anchor: { chatId: 'chat-a', planId: 'plan-2', dismissed: false }, open: true });
    });

    test('a dismissed panel does not come back while panning', () => {
        rules.close();
        for (let i = 0; i < 10; i++) {
            sight(i % 2 === 0 ? 'chat-a' : 'chat-b');
            clock.advance(PLAN_CLOSE_DELAY_MS / 5);
        }
        sight('chat-a');
        clock.advance(PLAN_CLOSE_DELAY_MS * 2);
        expect(state.open).toBe(false);
        expect(state.anchor?.dismissed).toBe(true);
    });
});

describe('what counts as in sight for the plan panel', () => {
    const layout = (...viewIds: string[]): SplitLayout => ({
        columns: viewIds.map((viewId) => ({ size: 1 / viewIds.length, cells: [{ viewId, size: 1 }] })),
        focus: { column: 0, cell: 0 }
    });
    const canvasView = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] } as unknown as ProjectView;
    const chatView = { kind: 'chat', id: 'chat-view', name: 'Chat', node: {} } as unknown as ProjectView;
    const canvas = (patch: Partial<ChatSightCanvas> = {}): ChatSightCanvas => ({
        camera: { x: 0, y: 0, zoom: 1 },
        viewport: { w: 1000, h: 800 },
        nodes: [
            { id: 'chat-a', kind: 'chat', x: 100, y: 100, w: 300, h: 300 },
            { id: 'far', kind: 'chat', x: 5000, y: 100, w: 300, h: 300 },
            { id: 'term', kind: 'terminal', x: 100, y: 100, w: 300, h: 300 }
        ],
        ...patch
    });
    const workspace = (patch: Partial<ChatSightWorkspace> = {}, sightCanvas: ChatSightCanvas = canvas()): ChatSightWorkspace => ({
        views: [canvasView, chatView],
        layout: layout('canvas', 'chat-view'),
        canvasOf: (viewId) => (viewId === 'canvas' ? sightCanvas : null),
        ...patch
    });

    test('a chat view in a cell and the chat nodes a canvas in a cell has in front of it', () => {
        expect([...chatsInSight(workspace(), { planWidth: 0 })].sort()).toEqual(['chat-a', 'chat-view']);
    });

    test('a view in no cell shows nothing', () => {
        expect([...chatsInSight(workspace({ layout: layout('canvas') }), { planWidth: 0 })]).toEqual(['chat-a']);
    });

    test('any zoom counts, however far out', () => {
        expect(chatsInSight(workspace({}, canvas({ camera: { x: 0, y: 0, zoom: 0.1 } })), { planWidth: 0 }).has('chat-a')).toBe(true);
    });

    test('a chat folded into a collapsed group is not in sight', () => {
        expect(chatsInSight(workspace({}, canvas({ hidden: new Set(['chat-a']) })), { planWidth: 0 }).has('chat-a')).toBe(false);
    });

    test('the focus of the window plays no part, where attention would see nothing', () => {
        expect(seenNodes(false, [['chat-a']]).size).toBe(0);
        expect(chatsInSight(workspace(), { planWidth: 0 }).has('chat-a')).toBe(true);
    });

    test('a node at the right edge is not pushed out of sight by the panel opening', () => {
        const edge = { id: 'edge', kind: 'chat', x: 900, y: 100, w: 80, h: 80 };
        const closed = canvas({ nodes: [edge] });
        expect(chatsInSight(workspace({}, closed), { planWidth: 0 }).has('edge')).toBe(true);
        // The panel takes 360 pixels off the canvas; measured as if it were closed, the node stays.
        const opened = canvas({ nodes: [edge], viewport: { w: 640, h: 800 } });
        expect(chatsInSight(workspace({}, opened), { planWidth: 0 }).has('edge')).toBe(false);
        expect(chatsInSight(workspace({}, opened), { planWidth: 360 }).has('edge')).toBe(true);

        sight('edge');
        rules.created('edge', 'plan-1');
        rules.sight(chatsInSight(workspace({}, opened), { planWidth: 360 }));
        clock.advance(PLAN_CLOSE_DELAY_MS * 2);
        expect(state.open).toBe(true);
    });
});
