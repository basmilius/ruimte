import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatItem, ChatSubagentItem } from '@ruimte/contracts';
import {
    breadcrumbOf,
    canOpenSubagent,
    isOnList,
    MAIN_AGENT,
    openableSubagents,
    openBelow,
    openFromList,
    openFromMain,
    showsComposer,
    stepBack,
    SUBAGENT_LIST,
    toggleList,
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

const survey: SubagentStep = { kind: 'agent', toolUseId: 'toolu_1', description: 'Survey' };
const count: SubagentStep = { kind: 'agent', toolUseId: 'toolu_2', description: 'Count' };
const deeper: SubagentStep = { kind: 'agent', toolUseId: 'toolu_3', description: '' };

describe('subagent view', () => {
    beforeEach(() => {
        useSubagentView.setState({ trails: {} });
    });

    test('a thread row opens its conversation straight away, an entry of the list keeps the list above it', () => {
        expect(openFromMain(survey)).toEqual([survey]);
        expect(openFromList(survey)).toEqual([SUBAGENT_LIST, survey]);
        expect(openBelow(openFromList(survey), deeper)).toEqual([SUBAGENT_LIST, survey, deeper]);
    });

    test('the button opens the list from anywhere and closes it from the list itself', () => {
        expect(toggleList(MAIN_AGENT)).toEqual([SUBAGENT_LIST]);
        expect(toggleList([SUBAGENT_LIST])).toBe(MAIN_AGENT);
        expect(toggleList([SUBAGENT_LIST, survey])).toEqual([SUBAGENT_LIST]);
        expect(toggleList([survey])).toEqual([SUBAGENT_LIST]);
        expect(isOnList([SUBAGENT_LIST, survey])).toBe(false);
    });

    test('the breadcrumb follows the title with every step down and marks the one on screen', () => {
        expect(breadcrumbOf(MAIN_AGENT)).toEqual([]);
        expect(breadcrumbOf([SUBAGENT_LIST])).toEqual([{ kind: 'list', label: 'Sub-agents', depth: 1, current: true }]);
        expect(breadcrumbOf([SUBAGENT_LIST, survey, deeper])).toEqual([
            { kind: 'list', label: 'Sub-agents', depth: 1, current: false },
            { kind: 'agent', label: 'Survey', depth: 2, current: false },
            { kind: 'agent', label: 'Sub-agent', depth: 3, current: true }
        ]);
        expect(breadcrumbOf([count])).toEqual([{ kind: 'agent', label: 'Count', depth: 1, current: true }]);
    });

    test('a crumb goes back to its depth, back goes up one level and the title or the close is depth zero', () => {
        const trail = [SUBAGENT_LIST, survey, deeper];
        expect(trailTo(trail, 1)).toEqual([SUBAGENT_LIST]);
        expect(trailTo(trail, 0)).toBe(MAIN_AGENT);
        expect(stepBack(trail)).toEqual([SUBAGENT_LIST, survey]);
        expect(stepBack([SUBAGENT_LIST, survey])).toEqual([SUBAGENT_LIST]);
        expect(stepBack([SUBAGENT_LIST])).toBe(MAIN_AGENT);
        expect(stepBack([survey])).toBe(MAIN_AGENT);
        expect(stepBack(MAIN_AGENT)).toBe(MAIN_AGENT);
    });

    test('the composer is there only on the main agent', () => {
        expect(showsComposer(MAIN_AGENT)).toBe(true);
        expect(showsComposer([SUBAGENT_LIST])).toBe(false);
        expect(showsComposer([survey])).toBe(false);
    });

    test('the store keeps a trail per chat and back answers whether it went anywhere', () => {
        const store = useSubagentView.getState();
        store.show('m:chat-1', [SUBAGENT_LIST, count]);
        store.show('m:chat-2', [deeper]);
        expect(store.back('m:chat-1')).toBe(true);
        expect(useSubagentView.getState().trails['m:chat-1']).toEqual([SUBAGENT_LIST]);
        expect(store.back('m:chat-1')).toBe(true);
        expect(useSubagentView.getState().trails).toEqual({ 'm:chat-2': [deeper] });
        expect(store.back('m:chat-1')).toBe(false);
        store.show('m:chat-2', MAIN_AGENT);
        expect(useSubagentView.getState().trails).toEqual({});
    });

    test('the overview lists every subagent in thread order, and a refusing machine only the ones with a pointer', () => {
        const native = subagent('a', { native: { agentId: 'agent-a' } });
        const task = subagent('b', { origin: 'ruimte', childId: 'node-b' });
        const structure: Record<string, ChatItem> = { a: native, n: note('n'), b: task };
        expect(openableSubagents(['a', 'n', 'b'], structure, false)).toEqual([native, task]);
        expect(openableSubagents(['a', 'n', 'b'], structure, true)).toEqual([native]);
        expect(canOpenSubagent(task, true)).toBe(false);
        expect(openableSubagents([], structure, false)).toEqual([]);
    });
});
