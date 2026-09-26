import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ChatSubagentItem } from '@ruimte/agent-contracts';
import {
    breadcrumbOf,
    canOpenSubagent,
    MAIN_AGENT,
    openableSubagents,
    openBelow,
    openFromMain,
    showsComposer,
    stepBack,
    trailTo,
    useSubagentView,
    type SubagentStep
} from './subagent-view';

const subagent = (id: string, patch: Partial<ChatSubagentItem> = {}): ChatSubagentItem => ({
    id,
    kind: 'subagent',
    createdAt: 0,
    turnId: null,
    toolUseId: `toolu_${id}`,
    description: `Agent ${id}`,
    subagentType: null,
    prompt: null,
    background: false,
    status: 'running',
    startedAt: 0,
    finishedAt: null,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: false,
    ...patch
});

const note = (id: string): ChatItem => ({ id, kind: 'note', createdAt: 0, turnId: null, level: 'info', text: id });

const survey: SubagentStep = { toolUseId: 'toolu_1', description: 'Survey' };
const count: SubagentStep = { toolUseId: 'toolu_2', description: 'Count' };
const deeper: SubagentStep = { toolUseId: 'toolu_3', description: '' };

describe('subagent view', () => {
    beforeEach(() => {
        useSubagentView.setState({ trails: {} });
    });

    test('a row opens its conversation straight away, and a row inside one goes a level deeper', () => {
        expect(openFromMain(survey)).toEqual([survey]);
        expect(openBelow(openFromMain(survey), deeper)).toEqual([survey, deeper]);
    });

    test('the breadcrumb follows the title with every step down and marks the one on screen', () => {
        expect(breadcrumbOf(MAIN_AGENT)).toEqual([]);
        expect(breadcrumbOf([count, survey, deeper])).toEqual([
            { label: 'Count', depth: 1, current: false },
            { label: 'Survey', depth: 2, current: false },
            { label: 'Sub-agent', depth: 3, current: true }
        ]);
        expect(breadcrumbOf([count])).toEqual([{ label: 'Count', depth: 1, current: true }]);
    });

    test('a crumb goes back to its depth, back goes up one level and the title or the close is depth zero', () => {
        const trail = [count, survey, deeper];
        expect(trailTo(trail, 1)).toEqual([count]);
        expect(trailTo(trail, 0)).toBe(MAIN_AGENT);
        expect(stepBack(trail)).toEqual([count, survey]);
        expect(stepBack([count, survey])).toEqual([count]);
        expect(stepBack([survey])).toBe(MAIN_AGENT);
        expect(stepBack(MAIN_AGENT)).toBe(MAIN_AGENT);
    });

    test('the composer is there only on the main agent', () => {
        expect(showsComposer(MAIN_AGENT)).toBe(true);
        expect(showsComposer([survey])).toBe(false);
    });

    test('the store keeps a trail per chat and back answers whether it went anywhere', () => {
        const store = useSubagentView.getState();
        store.show('m:chat-1', [survey, count]);
        store.show('m:chat-2', [deeper]);
        expect(store.back('m:chat-1')).toBe(true);
        expect(useSubagentView.getState().trails['m:chat-1']).toEqual([survey]);
        expect(store.back('m:chat-1')).toBe(true);
        expect(useSubagentView.getState().trails).toEqual({ 'm:chat-2': [deeper] });
        expect(store.back('m:chat-1')).toBe(false);
        store.show('m:chat-2', MAIN_AGENT);
        expect(useSubagentView.getState().trails).toEqual({});
    });

    test('a chat can open every subagent in thread order, and a refusing machine only the ones with a pointer', () => {
        const native = subagent('a', { native: { agentId: 'agent-a' } });
        const task = subagent('b', { origin: 'ruimte', childId: 'node-b' });
        const structure: Record<string, ChatItem> = { a: native, n: note('n'), b: task };
        expect(openableSubagents(['a', 'n', 'b'], structure, false)).toEqual([native, task]);
        expect(openableSubagents(['a', 'n', 'b'], structure, true)).toEqual([native]);
        expect(canOpenSubagent(task, true)).toBe(false);
        expect(openableSubagents([], structure, false)).toEqual([]);
    });
});
