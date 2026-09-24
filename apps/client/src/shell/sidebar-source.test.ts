import { describe, expect, test } from 'bun:test';
import { sameSidebarSource, type SidebarCanvasNode, type SidebarSource } from '@/shell/sidebar-source';

const chat = (patch: Partial<SidebarCanvasNode> = {}): SidebarCanvasNode => ({ id: 'chat', kind: 'chat', title: 'Plan', ...patch });

const views: SidebarSource['views'] = [];

const source = (nodes: SidebarCanvasNode[]): SidebarSource => ({ views, activeViewId: null, openViewIds: [], canvases: { canvas: nodes } });

describe('the sidebar source', () => {
    test('is the same for a canvas whose nodes only moved, which is every frame of a drag', () => {
        const before = source([chat()]);
        expect(sameSidebarSource(before, source([chat()]))).toBe(true);
    });

    test('changes with what a row shows', () => {
        const before = source([chat()]);
        expect(sameSidebarSource(before, source([chat({ title: 'Ship' })]))).toBe(false);
        expect(sameSidebarSource(before, source([chat({ provider: 'codex' })]))).toBe(false);
        expect(sameSidebarSource(before, source([chat(), chat({ id: 'other' })]))).toBe(false);
        expect(sameSidebarSource(before, source([]))).toBe(false);
    });
});
