import { expect, test } from 'bun:test';
import { NODE_ACCENT_NAMES, ProjectCanvasViewSchema, type ProjectCanvasLine, type ProjectCanvasView } from '@ruimte/contracts';
import { constrainedLineEnd, lineDash } from '@/canvas-model/line-geometry';
import { mergeProject } from '@/clients/project/merge';
import { createCanvasStore } from './canvas';

const VIEW: ProjectCanvasView = { id: 'main', kind: 'canvas', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const LINE: Omit<ProjectCanvasLine, 'id'> = { x: 12, y: 20, endX: 212, endY: 120, stroke: 'red', strokeWidth: 2, strokeStyle: 'dashed', arrowEnd: true };

function editor() {
    const store = createCanvasStore();
    store.getState().loadView(VIEW, null);
    return store;
}

test('drawing and editing line endpoints snaps to the canvas grid', () => {
    const store = editor();
    const id = store.getState().addLine({ ...LINE, x: 11, y: -7, endX: 109, endY: 59 })!;
    expect(store.getState().lines[id]).toMatchObject({ x: 12, y: -8, endX: 108, endY: 60 });
    store.getState().updateLine(id, { endX: 127, endY: 83 });
    expect(store.getState().lines[id]).toMatchObject({ x: 12, y: -8, endX: 128, endY: 84 });
    const end = constrainedLineEnd({ x: 12, y: -8 }, { x: 111, y: 63 }, true);
    expect(end.x % 4).toBe(0);
    expect(end.y % 4).toBe(0);
    expect(end.x - 12).toBe(end.y + 8);
});

test('gap edits translate a reversed line as one object and support cancel and undo', () => {
    const store = editor();
    const id = store.getState().addLine({ ...LINE, x: 200, y: 160, endX: 100, endY: 80 })!;
    expect(store.getState().beginGapMove([id])).toBe(true);
    store.getState().moveGapNodes({ [id]: { x: 24, y: 8 } });
    expect(store.getState().lines[id]).toMatchObject({ x: 224, y: 168, endX: 124, endY: 88 });
    store.getState().endGapMove(true);
    expect(store.getState().lines[id]).toMatchObject({ x: 200, y: 160, endX: 100, endY: 80 });
    expect(store.getState().beginGapMove([id])).toBe(true);
    store.getState().moveGapNodes({ [id]: { x: 24, y: 8 } });
    store.getState().endGapMove();
    store.getState().undo();
    expect(store.getState().lines[id]).toMatchObject({ x: 200, y: 160, endX: 100, endY: 80 });
});

test('group moves and collapses carry lines, and a gap edit expands the enclosing group', () => {
    const store = editor();
    const group = { id: 'group', kind: 'group' as const, title: 'Group', x: 0, y: 0, w: 200, h: 200 };
    store.setState({ nodes: { group }, order: ['group'] });
    const id = store.getState().addLine({ ...LINE, x: 24, y: 48, endX: 104, endY: 48 })!;
    store.getState().select(['group']);
    store.getState().moveSelected(8, 8, true);
    expect(store.getState().lines[id]).toMatchObject({ x: 32, y: 56, endX: 112, endY: 56 });
    store.getState().undo();
    store.getState().toggleCollapse('group');
    expect(store.getState().hidden.has(id)).toBe(true);
    store.getState().selectInRect({ x: -20, y: -20, w: 300, h: 300 });
    expect(store.getState().selection).toEqual(['group']);
    store.getState().toggleCollapse('group');
    expect(store.getState().beginGapMove([id])).toBe(true);
    store.getState().moveGapNodes({ [id]: { x: 300, y: 0 } });
    store.getState().endGapMove();
    expect(store.getState().nodes.group!.x + store.getState().nodes.group!.w).toBeGreaterThan(404);
    store.getState().undo();
    expect(store.getState().nodes.group).toMatchObject(group);
    expect(store.getState().lines[id]).toMatchObject({ x: 24, y: 48, endX: 104, endY: 48 });
});

test('lines accept the shared accent palette and keep existing neutral colors when reloaded', () => {
    const colors = [...NODE_ACCENT_NAMES, 'ink', 'muted', 'accent'] as const;
    const lines = colors.map((stroke) => ({ ...LINE, id: `line-${stroke}`, stroke }));
    const view = ProjectCanvasViewSchema.parse({ ...VIEW, lines });
    const store = editor();
    store.getState().loadView(view, null);
    expect(store.getState().exportContent().lines).toEqual(lines);
});

test('decorative arrows save, reload, undo and redo without becoming context edges', () => {
    const store = editor();
    const id = store.getState().addLine(LINE)!;
    const saved = ProjectCanvasViewSchema.parse({ ...VIEW, ...store.getState().exportContent() });
    expect(saved.lines).toEqual([{ ...LINE, id }]);
    expect(saved.edges).toEqual([]);
    store.getState().undo();
    expect(Object.keys(store.getState().lines)).toHaveLength(0);
    store.getState().redo();
    expect(store.getState().lines[id]).toEqual({ ...LINE, id });
    const reloaded = editor();
    reloaded.getState().loadView(saved, null);
    expect(reloaded.getState().lines[id]).toEqual({ ...LINE, id });
});

test('selection, moving, styling, duplication and deleting the last line remain undoable', () => {
    const store = editor();
    const id = store.getState().addLine(LINE)!;
    store.getState().clearSelection();
    store.getState().selectInRect({ x: 0, y: 0, w: 300, h: 200 });
    expect(store.getState().selection).toEqual([id]);
    store.getState().moveSelected(20, 30, true);
    expect(store.getState().lines[id]).toMatchObject({ x: 32, y: 52, endX: 232, endY: 152 });
    store.getState().updateLine(id, { stroke: 'blue', strokeStyle: 'dotted', strokeWidth: 4, arrowStart: true });
    store.getState().undo();
    expect(store.getState().lines[id]).toMatchObject({ stroke: 'red', strokeStyle: 'dashed', strokeWidth: 2 });
    store.getState().duplicateLine(id);
    expect(Object.values(store.getState().lines)).toHaveLength(2);
    store.getState().select(Object.keys(store.getState().lines));
    store.getState().deleteSelected();
    expect(store.getState().exportContent().lines).toEqual([]);
    store.getState().undo();
    expect(Object.values(store.getState().lines)).toHaveLength(2);
});

test('remote line styles merge with local geometry and survive unrelated undo steps', () => {
    const line = { ...LINE, id: 'line-a' };
    const baseView = { ...VIEW, lines: [line] };
    const content = (view: ProjectCanvasView) => ({ name: 'Project', color: '#000', views: [view] });
    const merged = mergeProject(
        content(baseView),
        content({ ...baseView, lines: [{ ...line, x: 20 }] }),
        content({ ...baseView, lines: [{ ...line, stroke: 'blue' }] })
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) {
        return;
    }
    const view = merged.content.views[0] as ProjectCanvasView;
    expect(view.lines?.[0]).toMatchObject({ x: 20, stroke: 'blue' });
    const store = editor();
    store.getState().addText({ x: 0, y: 0 });
    store.getState().applyExternal({ nodes: [], texts: [], edges: [], lines: [line], removed: { nodes: [], texts: [], edges: [] }, order: [], layouts: null });
    store.getState().undo();
    expect(store.getState().lines[line.id]).toEqual(line);
});

test('clicks do not create zero-length lines and Shift constrains direction', () => {
    expect(
        editor()
            .getState()
            .addLine({ ...LINE, endX: LINE.x, endY: LINE.y })
    ).toBeNull();
    expect(createCanvasStore().getState().addLine(LINE)).toBeNull();
    const end = constrainedLineEnd({ x: 0, y: 0 }, { x: 100, y: 12 }, true);
    expect(end.y).toBe(0);
    expect(lineDash({ strokeStyle: 'dotted', strokeWidth: 4 })).toBe('0 12');
    expect(lineDash({ strokeStyle: 'solid', strokeWidth: 4 })).toBeUndefined();
});
