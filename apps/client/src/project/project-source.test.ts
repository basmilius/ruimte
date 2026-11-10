import { describe, expect, test } from 'bun:test';
import { sameProjectSource, type ProjectSourceNode, type ProjectSource } from '@/project/project-source';

function chat(patch: Partial<ProjectSourceNode> = {}): ProjectSourceNode {
    return { id: 'chat', kind: 'chat', title: 'Plan', ...patch };
}

const views: ProjectSource['views'] = [];

function source(nodes: ProjectSourceNode[]): ProjectSource {
    return { views, activeViewId: null, openViewIds: [], nodes: { canvas: nodes }, nodesOf: () => nodes };
}

describe('the sidebar source', () => {
    test('is the same for a canvas whose nodes only moved, which is every frame of a drag', () => {
        const before = source([chat()]);
        expect(sameProjectSource(before, source([chat()]))).toBe(true);
    });

    test('changes with what a row shows', () => {
        const before = source([chat()]);
        expect(sameProjectSource(before, source([chat({ title: 'Ship' })]))).toBe(false);
        expect(sameProjectSource(before, source([chat({ provider: 'codex' })]))).toBe(false);
        expect(sameProjectSource(before, source([chat(), chat({ id: 'other' })]))).toBe(false);
        expect(sameProjectSource(before, source([]))).toBe(false);
    });
});
