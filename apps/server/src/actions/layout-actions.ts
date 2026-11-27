import { ToolRefusal } from '@adecore/agents/context';
import { ARRANGE_LAYOUTS, type ActionHandlers, type ActionInput, type ActionName } from '@ruimte/actions';
import { gridPoint, type ProjectCanvasView, type ProjectContent, type ProjectNode } from '@ruimte/contracts';
import { canvasNamed } from '../canvas/host.ts';
import { anchorOf, carriedBy, movedTo, overlapsOf, refuseUnknownNode, resized, settled, sideSpot, type Settling } from '../canvas/layout.ts';
import { nodesNamed } from '../canvas/nodes.ts';
import { arrangeRects, gridColumns, spreadRects } from '../canvas/placement.ts';
import type { ServerActionContext } from './context.ts';
import { withCanvas } from './node-actions.ts';

type LayoutRow = ActionInput<'node.layout'>['nodes'][number];

/* A refusal about one node of several names it, since the rows of a call are told apart by their node. */
function forRow<T>(nodeId: string, run: () => T): T {
    try {
        return run();
    } catch (error) {
        if (error instanceof ToolRefusal) {
            throw new ToolRefusal(error.code, `${nodeId}: ${error.message}`, error.lines);
        }

        throw error;
    }
}

/* What a row asks for has to be one thing: a corner, or a side of a node, with a size beside either. */
function checkRow(row: LayoutRow): void {
    const corner = row.x != null || row.y != null;
    const beside = row.side != null || row.beside != null;

    if (corner && (row.x == null || row.y == null)) {
        throw new ToolRefusal('bad-arguments', 'x and y go together; give both, or neither and a side');
    }

    if (corner && beside) {
        throw new ToolRefusal('bad-arguments', 'x and y place the node themselves; leave out side and beside, or leave out x and y');
    }

    if (row.gap != null && !beside) {
        throw new ToolRefusal('bad-arguments', 'gap is the room to the node it goes beside; give side or beside with it');
    }

    if (row.beside === row.nodeId) {
        throw new ToolRefusal('bad-arguments', 'beside names the node itself; name another node');
    }

    if (!corner && !beside && row.w == null && row.h == null) {
        throw new ToolRefusal('nothing-to-change', 'Give x and y, a side, w or h');
    }
}

/* One row applied to the canvas as the rows before it left it. */
function placed(content: ProjectContent, canvas: ProjectCanvasView, row: LayoutRow, caller: string): { canvas: ProjectCanvasView; settling: Settling } {
    // `nodesNamed` refuses an id the canvas does not hold, so the one it was given is there.
    const node = nodesNamed(content, canvas, [row.nodeId], { cannot: 'there is nothing there to place' })[0]!;

    refuseUnknownNode(node);

    const sized = resized(node, row.w, row.h);
    const resizedCanvas = { ...canvas, nodes: canvas.nodes.map((candidate) => (candidate.id === sized.id ? sized : candidate)) };

    if (row.x != null && row.y != null) {
        return {
            canvas: movedTo(resizedCanvas, sized.id, gridPoint(row.x), gridPoint(row.y)),
            settling: { id: sized.id, beside: null, moved: true }
        };
    }

    if (row.side == null && row.beside == null) {
        return { canvas: resizedCanvas, settling: { id: sized.id, beside: null, moved: false } };
    }

    const anchor = anchorOf(content, resizedCanvas, caller, row.beside);
    const leaving = carriedBy(resizedCanvas, [sized.id]);

    if (leaving.has(anchor.id)) {
        throw new ToolRefusal('bad-arguments', `${anchor.id} moves with this node, so the node cannot stand beside it; name another node with beside`);
    }

    const spot = sideSpot(resizedCanvas, anchor, sized, row.side ?? 'right', { gap: row.gap, walk: row.beside == null, leaving });

    return { canvas: movedTo(resizedCanvas, sized.id, spot.x, spot.y), settling: { id: sized.id, beside: anchor.id, moved: true } };
}

function sameFrame(first: ProjectNode | undefined, second: ProjectNode): boolean {
    return (
        first !== undefined &&
        first.x === second.x &&
        first.y === second.y &&
        first.w === second.w &&
        first.h === second.h &&
        first.expandedHeight === second.expandedHeight
    );
}

/* The actions of this file that honor a dry run. */
export const layoutPreviews: readonly ActionName[] = ['node.layout'];

export const layoutActions: ActionHandlers<ServerActionContext> = {
    'node.layout': async ({ viewId, nodes: rows }, { actor, context, dryRun }) => {
        const { host, place } = context;
        const repeated = rows.find((row, index) => rows.findIndex((other) => other.nodeId === row.nodeId) !== index);

        if (repeated) {
            throw new ToolRefusal('bad-arguments', `${repeated.nodeId} is named twice; a node takes one place and one size per call`);
        }

        rows.forEach((row) => forRow(row.nodeId, () => checkRow(row)));

        return host.projects.mutate(place.projectId, (content) => {
            const before = canvasNamed(content, viewId);
            let canvas = before;
            const settlings: Settling[] = [];

            for (const row of rows) {
                const step = forRow(row.nodeId, () => placed(content, canvas, row, actor.id));

                canvas = step.canvas;
                settlings.push(step.settling);
            }

            canvas = settled(before, canvas, settlings);

            const named = new Map(rows.map((row, index) => [row.nodeId, index]));
            const was = new Map(before.nodes.map((node) => [node.id, node]));
            const output = {
                viewId: canvas.id,
                nodes: canvas.nodes
                    .filter((node) => named.has(node.id))
                    .sort((first, second) => (named.get(first.id) ?? 0) - (named.get(second.id) ?? 0))
                    // A folded node answers with the height it opens to, which is the one a call gives it.
                    .map((node) => ({
                        nodeId: node.id,
                        x: node.x,
                        y: node.y,
                        w: node.w,
                        h: node.collapsed === true ? (node.expandedHeight ?? node.h) : node.h
                    })),
                overlaps: overlapsOf(
                    canvas,
                    rows.map((row) => row.nodeId)
                ),
                changed: canvas.nodes.some((node) => !sameFrame(was.get(node.id), node))
            };

            return { content: output.changed && dryRun !== true ? withCanvas(content, canvas) : null, result: { output } };
        });
    },
    'node.arrange': async ({ viewId, nodeIds, layout, columns, gap, align, beside, side }, { actor, context }) => {
        const { host, place } = context;
        const ids = [...new Set(nodeIds)];
        const blocks = ARRANGE_LAYOUTS.filter((candidate) => candidate !== 'spread');

        if (columns !== null && layout !== 'grid') {
            throw new ToolRefusal('flag-not-for-layout', `cols does not go with ${layout}; a row is one row and a column is one column`, [
                'layout\tgrid\ttakes cols',
                `layout\t${ARRANGE_LAYOUTS.filter((candidate) => candidate !== 'grid').join(', ')}\ttake no cols`
            ]);
        }

        const blockFlag = align != null ? 'align' : beside != null ? 'beside' : side != null ? 'side' : null;

        if (layout === 'spread' && blockFlag !== null) {
            throw new ToolRefusal('flag-not-for-layout', `${blockFlag} does not go with spread, which only moves apart the nodes that stand too close`, [
                `layout\t${blocks.join(', ')}\ttake align, beside and side`,
                'layout\tspread\ttakes gap'
            ]);
        }

        return host.projects.mutate(place.projectId, (content) => {
            const before = canvasNamed(content, viewId);
            const moving = nodesNamed(content, before, ids, { cannot: 'there is nothing there to move' });
            const carried = carriedBy(before, ids);
            const holder = moving.find((node) => node.kind === 'group' && ids.some((id) => id !== node.id && carriedBy(before, [node.id]).has(id)));

            if (holder) {
                throw new ToolRefusal(
                    'inside-named-group',
                    `${holder.id} is a group and moves with everything inside it, and you named a node it holds too; name the group or its nodes`
                );
            }

            if (columns !== null && columns > moving.length) {
                throw new ToolRefusal(
                    'too-many-columns',
                    `cols is ${columns} and you named ${moving.length} ${moving.length === 1 ? 'node' : 'nodes'}; a grid holds at most one column per node`,
                    [`columns\twithout cols\t${gridColumns(moving.length)}`]
                );
            }

            let rects =
                layout === 'spread'
                    ? spreadRects(moving, gap ?? undefined)
                    : arrangeRects(moving, layout, columns ?? undefined, { gap: gap ?? undefined, align: align ?? undefined });
            let anchorId: string | null = null;

            if (beside != null || side != null) {
                const anchor = anchorOf(content, before, actor.id, beside);

                if (carried.has(anchor.id)) {
                    throw new ToolRefusal('bad-arguments', `${anchor.id} is one of the nodes this call moves; name another node with beside`);
                }

                const left = Math.min(...rects.map((rect) => rect.x));
                const top = Math.min(...rects.map((rect) => rect.y));
                const block = {
                    w: Math.max(...rects.map((rect) => rect.x + rect.w)) - left,
                    h: Math.max(...rects.map((rect) => rect.y + rect.h)) - top
                };
                const spot = sideSpot(before, anchor, block, side ?? 'right', { gap, walk: beside == null, leaving: carried });

                rects = rects.map((rect) => ({ ...rect, x: rect.x + spot.x - left, y: rect.y + spot.y - top }));
                anchorId = anchor.id;
            }

            // Both layouts answer one frame per node, in the order the nodes were given.
            const spots = rects.map((rect, index) => ({ node: moving[index]!, x: rect.x, y: rect.y }));
            const changed = spots.some(({ node, x, y }) => node.x !== x || node.y !== y);
            const output = { viewId: before.id, nodes: spots.map(({ node, x, y }) => ({ nodeId: node.id, x, y })), changed };

            if (!changed) {
                return { content: null, result: { output } };
            }

            const moved = spots.reduce((canvas, { node, x, y }) => movedTo(canvas, node.id, x, y), before);
            const settlings = spots.map(({ node }) => ({ id: node.id, beside: anchorId, moved: true }));

            return { content: withCanvas(content, settled(before, moved, settlings)), result: { output } };
        });
    }
};
