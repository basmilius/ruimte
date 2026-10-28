import { groupFrame, type ProjectCanvasLine } from '@ruimte/contracts';
import { parentGroupOf } from '@/canvas/editable-gaps';
import { gapFrames } from '@/canvas/element-frames';
import { snapLine } from '@/canvas/line-geometry';
import { snapToGrid, unionOf, type Point } from '@/canvas/math';
import type { CanvasState } from '@/state/canvas';
import { boundsOfElement, carriedByGroups, HISTORY_LIMIT, membersOf, remember, snapshotOf, type CanvasGet, type CanvasSet } from '@/state/canvas-model';

/* What is selected, and what its groups carry, each put where `place` and `line` say. */
function movedSelection(
    state: Pick<CanvasState, 'nodes' | 'texts' | 'lines' | 'selection'>,
    place: (at: Point) => Point,
    line: (line: ProjectCanvasLine) => ProjectCanvasLine
): Pick<CanvasState, 'nodes' | 'texts' | 'lines'> {
    const { nodes, texts, lines, selection } = state;
    const next = { nodes: { ...nodes }, texts: { ...texts }, lines: { ...lines } };
    for (const id of [...selection, ...carriedByGroups(nodes, texts, selection, lines)]) {
        if (next.nodes[id]) {
            next.nodes[id] = { ...next.nodes[id], ...place(next.nodes[id]) };
        } else if (next.texts[id]) {
            next.texts[id] = { ...next.texts[id], ...place(next.texts[id]) };
        } else if (next.lines[id]) {
            next.lines[id] = line(next.lines[id]);
        }
    }
    return next;
}

/* Moving and resizing what is selected, the gap move that pushes its neighbors aside, and the locks on both. */
export function createCanvasGestureSlice(
    set: CanvasSet,
    get: CanvasGet
): Pick<
    CanvasState,
    | 'moveSelected'
    | 'settleMove'
    | 'resizeNode'
    | 'setResizing'
    | 'setDerivedCard'
    | 'leaveDerivedCard'
    | 'setGesturing'
    | 'setPanning'
    | 'setHoverGroup'
    | 'beginGapMove'
    | 'moveGapNodes'
    | 'endGapMove'
    | 'heldNodeIds'
    | 'toggleLock'
> {
    return {
        moveSelected(dx, dy, first = false) {
            const s = get();
            if (s.locks.move) {
                return;
            }
            const moved = movedSelection(
                s,
                (at) => ({ x: at.x + dx, y: at.y + dy }),
                (line) => snapLine({ ...line, x: line.x + dx, y: line.y + dy, endX: line.endX + dx, endY: line.endY + dy })
            );
            set({ ...moved, ...(first ? remember(s) : {}) });
        },
        settleMove() {
            set(movedSelection(get(), (at) => ({ x: snapToGrid(at.x), y: snapToGrid(at.y) }), snapLine));
        },
        resizeNode(id, rect) {
            const { nodes, locks } = get();
            if (locks.resize || !nodes[id]) {
                return;
            }
            set({ nodes: { ...nodes, [id]: { ...nodes[id], ...rect } } });
        },
        setResizing(id) {
            // The handle goes down before the first resize, so this is where the old size is remembered.
            set((s) => (id !== null && s.resizing === null && s.nodes[id] !== undefined ? { resizing: id, ...remember(s) } : { resizing: id }));
        },
        setDerivedCard(id, card) {
            set((s) => {
                const next = { ...s.derivedCards };
                if (card === null) {
                    delete next[id];
                } else {
                    next[id] = card;
                }
                return { derivedCards: next };
            });
        },
        leaveDerivedCard(id, next) {
            set((s) => {
                if (s.navigationId !== id) {
                    return {};
                }
                return { navigationId: s.derivedCards[next] !== undefined || s.nodes[next] !== undefined ? next : null };
            });
        },
        setGesturing(gesturing) {
            set({ gesturing });
        },
        setPanning(panning) {
            if (get().panning !== panning) {
                set({ panning });
            }
        },
        setHoverGroup(id) {
            if (get().hoverGroupId !== id) {
                set({ hoverGroupId: id });
            }
        },
        beginGapMove(ids, fixed = []) {
            const state = get();
            const frames = gapFrames(state);
            if (state.locks.move || state.gapMove !== null || ids.length === 0 || ids.some((id) => frames[id] === undefined)) {
                return false;
            }
            const carried: Record<string, string> = {};
            for (const id of ids) {
                for (const member of carriedByGroups(state.nodes, state.texts, [id], state.lines)) {
                    if (!ids.includes(member)) {
                        carried[member] = id;
                    }
                }
            }
            const origins: Record<string, Point> = {};
            for (const id of [...ids, ...Object.keys(carried)]) {
                const element = state.nodes[id] ?? state.texts[id] ?? state.lines[id];
                if (element) {
                    origins[id] = { x: element.x, y: element.y };
                }
            }
            const parentIds = new Set<string>();
            const nodes = Object.values(frames);
            for (const id of ids) {
                let parent = parentGroupOf(frames[id]!, nodes);
                while (parent !== null && !parentIds.has(parent)) {
                    parentIds.add(parent);
                    parent = parentGroupOf(state.nodes[parent]!, nodes);
                }
            }
            const parents = [...parentIds]
                .sort((first, second) => state.nodes[first]!.w * state.nodes[first]!.h - state.nodes[second]!.w * state.nodes[second]!.h)
                .map((id) => ({ id, members: membersOf(state.nodes[id]!, state.nodes, state.texts, state.lines) }));
            set({ gapMove: { snapshot: snapshotOf(state), origins, carried, parents, fixed }, gesturing: true });
            return true;
        },
        moveGapNodes(offsets) {
            const state = get();
            const move = state.gapMove;
            if (move === null || state.locks.move) {
                return;
            }
            const nodes = { ...state.nodes };
            const texts = { ...state.texts };
            const lines = { ...state.lines };
            let changed = false;
            for (const [id, origin] of Object.entries(move.origins)) {
                const offset = offsets[move.carried[id] ?? id];
                const element = nodes[id] ?? texts[id] ?? lines[id];
                if (!offset || !element) {
                    continue;
                }
                const point = { x: origin.x + offset.x, y: origin.y + offset.y };
                if (element.x === point.x && element.y === point.y) {
                    continue;
                }
                changed = true;
                if (nodes[id]) {
                    nodes[id] = { ...nodes[id]!, ...point };
                } else if (texts[id]) {
                    texts[id] = { ...texts[id]!, ...point };
                } else if (lines[id]) {
                    const original = move.snapshot.lines?.[id] ?? lines[id];
                    lines[id] = snapLine({ ...lines[id], ...point, endX: original.endX + offset.x, endY: original.endY + offset.y });
                }
            }
            if (changed) {
                set({ nodes, texts, lines });
            }
        },
        endGapMove(cancel = false) {
            const state = get();
            const move = state.gapMove;
            if (move === null) {
                return;
            }
            const nodes = { ...state.nodes };
            const texts = { ...state.texts };
            const lines = { ...state.lines };
            const changed = Object.entries(move.origins).some(([id, point]) => {
                const element = nodes[id] ?? texts[id] ?? lines[id];
                return element !== undefined && (element.x !== point.x || element.y !== point.y);
            });
            if (cancel) {
                for (const [id, point] of Object.entries(move.origins)) {
                    if (nodes[id]) {
                        nodes[id] = { ...nodes[id]!, ...point };
                    } else if (texts[id]) {
                        texts[id] = { ...texts[id]!, ...point };
                    } else if (lines[id] && move.snapshot.lines?.[id]) {
                        const original = move.snapshot.lines[id];
                        lines[id] = { ...lines[id], x: original.x, y: original.y, endX: original.endX, endY: original.endY };
                    }
                }
            } else if (changed) {
                for (const parent of move.parents) {
                    const group = nodes[parent.id];
                    if (!group || group.collapsed) {
                        continue;
                    }
                    const frame = groupFrame(parent.members.flatMap((id) => boundsOfElement(id, nodes, texts, lines)));
                    const rect = frame === null ? null : unionOf([group, frame]);
                    if (rect !== null) {
                        nodes[parent.id] = { ...group, ...rect };
                    }
                }
            }
            set({
                nodes,
                texts,
                lines,
                gapMove: null,
                gesturing: false,
                ...(!cancel && changed ? { past: [...state.past.slice(-(HISTORY_LIMIT - 1)), move.snapshot], future: [] } : {})
            });
        },
        heldNodeIds() {
            const { gesturing, resizing, selection, nodes, texts, lines, gapMove } = get();
            if (gapMove !== null) {
                return [...new Set([...Object.keys(gapMove.origins), ...gapMove.parents.map((parent) => parent.id), ...gapMove.fixed])];
            }
            if (!gesturing && resizing === null) {
                return [];
            }
            const held = gesturing ? [...selection, ...carriedByGroups(nodes, texts, selection, lines)] : [];
            return resizing === null ? held : [...held, resizing];
        },
        toggleLock(key) {
            set((s) => ({ locks: { ...s.locks, [key]: !s.locks[key] } }));
        }
    };
}
