import { DEFAULT_TITLES, emptyCanvasGroupIds, groupFrame, isUnknownNode, nodeColorPatch } from '@ruimte/contracts';
import { arrangeGroupMembers } from '@/canvas/arrange-group';
import { snapToGrid } from '@/canvas/math';
import type { CanvasState } from '@/state/canvas';
import {
    anchorOf,
    carriedByGroups,
    COLLAPSED_NODE_PX,
    contains,
    droppedIntoGroups,
    goingWithDelete,
    GROUP_HEADER_PX,
    hiddenIn,
    membersOf,
    movedToGroup,
    nextId,
    remember,
    type CanvasGet,
    type CanvasNode,
    type CanvasSet
} from '@/state/canvas-model';
import { defaultNodeSize } from '@/state/node-size';

/* Adding, changing, grouping and removing the nodes of the canvas. */
export function createCanvasNodesSlice(
    set: CanvasSet,
    get: CanvasGet
): Pick<
    CanvasState,
    | 'setNodeColor'
    | 'renameNode'
    | 'updateNode'
    | 'duplicateNode'
    | 'bringToFront'
    | 'addNode'
    | 'addExtensionNode'
    | 'updateExtensionNode'
    | 'groupSelection'
    | 'arrangeGroup'
    | 'deleteSelected'
    | 'toggleCollapse'
    | 'setGroupWorktree'
> {
    return {
        // A node of an unknown kind is written back as read apart from its frame, so a color, a title or a patch would never reach the file.
        setNodeColor(id, accent) {
            set((s) => {
                const node = s.nodes[id];
                if (!node || isUnknownNode(node)) {
                    return {};
                }
                return { nodes: { ...s.nodes, [id]: { ...node, ...nodeColorPatch(node, accent) } }, ...remember(s) };
            });
        },
        renameNode(id, title, source = 'user') {
            set((s) => {
                const node = s.nodes[id];
                // A rename that changes nothing claims nothing, since the editor closes on a blur either way.
                if (!node || isUnknownNode(node) || (node.title === title && (node.titleSource ?? null) === source)) {
                    return {};
                }
                return { nodes: { ...s.nodes, [id]: { ...node, title, titleSource: source ?? undefined } } };
            });
        },
        updateNode(id, patch, undoable = false) {
            set((s) =>
                s.nodes[id] && !isUnknownNode(s.nodes[id])
                    ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } }, ...(undoable ? remember(s) : {}) }
                    : {}
            );
        },
        duplicateNode(id) {
            const source = get().nodes[id];
            // What a newer Ruimte's node holds may be tied to its id (a session, a file), so a copy of it is not this version's to make.
            // A design's later chats and its folder are its own, so a copy would share both.
            if (!source || isUnknownNode(source) || source.kind === 'design') {
                return;
            }
            const copyId = nextId(source.kind);
            // A copy is a new node: a fresh session, never the original's agent session, and a group's copy is its frame alone.
            const copy: CanvasNode = {
                ...source,
                id: copyId,
                x: source.x + 32,
                y: source.y + 32,
                resume: undefined,
                ...(source.kind === 'group' ? { memberIds: [] } : {})
            };
            set((s) => ({
                nodes: droppedIntoGroups({ ...s, nodes: { ...s.nodes, [copyId]: copy } }, [copyId]),
                order: [...s.order, copyId],
                selection: [copyId],
                ...remember(s)
            }));
        },
        bringToFront(id) {
            const { order } = get();
            if (order.at(-1) === id) {
                return;
            }
            set({ order: [...order.filter((entry) => entry !== id), id] });
        },
        addExtensionNode(extension, type, title, size, data, dataVersion, place) {
            if (get().viewId === null) {
                return null;
            }

            const id = nextId('extension');
            const { viewport, camera } = get();
            const at = place ?? { x: (viewport.w / 2 - camera.x) / camera.zoom, y: (viewport.h / 2 - camera.y) / camera.zoom };
            const frame = { x: snapToGrid(at.x - size.width / 2), y: snapToGrid(at.y - size.height / 2), w: size.width, h: size.height };
            // Stored as it is here: a Ruimte without the extension keeps it whole, and none of it needs a new field on the wire.
            const raw = { kind: 'extension', id, extension, type, title, ...frame, data, ...(dataVersion === undefined ? {} : { dataVersion }) };

            set((s) => ({
                nodes: droppedIntoGroups({ ...s, nodes: { ...s.nodes, [id]: { id, kind: 'unknown', title, ...frame, raw } as CanvasNode } }, [id]),
                order: [...s.order, id],
                selection: [id],
                ...remember(s)
            }));

            return id;
        },
        updateExtensionNode(id, patch) {
            set((s) => {
                const node = s.nodes[id];

                if (!node?.raw) {
                    return {};
                }

                return {
                    nodes: {
                        ...s.nodes,
                        [id]: { ...node, ...(typeof patch.title === 'string' ? { title: patch.title } : {}), raw: { ...node.raw, ...patch } }
                    },
                    ...remember(s)
                };
            });
        },
        addNode(kind, at, options = {}) {
            // Without a view nothing would ever save the node; the surfaces that offer one are hidden then, and this is the floor under them.
            if (get().viewId === null && options.viewId === undefined) {
                return null;
            }
            const id = nextId(kind);
            const size = defaultNodeSize(kind);
            // Made inside a group that is bound to a worktree, a node starts in that checkout.
            const host = Object.values(get().nodes)
                .filter((node) => node.kind === 'group' && node.worktree && contains(node, at))
                .sort((a, b) => a.w * a.h - b.w * b.h)[0];
            const node: CanvasNode = {
                id,
                kind,
                title: options.title ?? DEFAULT_TITLES[kind],
                x: snapToGrid(at.x - size.w / 2),
                y: snapToGrid(at.y - size.h / 2),
                ...size,
                url: options.url,
                ...(options.browserOwner ? { browserOwner: options.browserOwner } : {}),
                device: options.device,
                cwd: options.cwd ?? host?.worktree?.path,
                command: options.command,
                resume: options.resume,
                provider: options.provider,
                account: options.account,
                providerFixed: options.providerFixed,
                runtimeMode: options.runtimeMode,
                viewId: options.viewId,
                path: options.path,
                ...(options.issue === undefined ? {} : { issue: options.issue }),
                ...(options.machine === undefined ? {} : { machine: options.machine }),
                ...(options.artifact === undefined ? {} : { artifact: options.artifact }),
                ...(options.routine === undefined ? {} : { routine: options.routine })
            };
            // A new group takes in nothing that already stood under it.
            const added: CanvasNode = kind === 'group' ? { ...node, memberIds: [] } : node;
            set((s) => ({
                nodes: droppedIntoGroups({ ...s, nodes: { ...s.nodes, [id]: added } }, [id]),
                order: [...s.order, id],
                selection: [id],
                ...remember(s)
            }));
            return id;
        },
        groupSelection() {
            const { nodes, texts, lines, selection } = get();
            const framed = selection.map((id) => nodes[id]).filter((node): node is CanvasNode => Boolean(node) && node!.kind !== 'group');
            // The same frame the daemon's `node group` action draws, so the two ways to group cannot drift.
            const frame = groupFrame(framed);
            if (!frame) {
                return null;
            }
            const id = nextId('group');
            // What a selected group holds stays in it, and that group comes along as a member.
            const carried = new Set(selection.flatMap((selected) => [...carriedByGroups(nodes, texts, [selected], lines)]));
            const inFrame = (selected: string): boolean => {
                const at = anchorOf(selected, { nodes, texts, lines });
                return at !== null && contains(frame, at);
            };

            const members = selection.filter((selected) => !carried.has(selected) && inFrame(selected));
            let placed = { nodes: { ...nodes, [id]: { id, kind: 'group', title: DEFAULT_TITLES.group, ...frame, memberIds: [] } as CanvasNode }, texts, lines };
            for (const member of members) {
                placed = { ...placed, nodes: movedToGroup(placed, member, id) };
            }
            set((s) => ({ nodes: droppedIntoGroups(placed, [id]), order: [...s.order, id], selection: [id], ...remember(s) }));
            return id;
        },
        arrangeGroup(id) {
            const state = get();
            if (state.locks.move) {
                return { refused: 'locked' };
            }
            const result = arrangeGroupMembers(id, state.nodes, state.texts);
            if ('refused' in result) {
                return result;
            }
            const moved = Object.keys(result.moves);
            const group = state.nodes[id]!;
            const grew = result.frame.w !== group.w || result.frame.h !== group.h;
            if (moved.length === 0 && !grew) {
                return { moved };
            }
            set((s) => {
                const nodes = { ...s.nodes };
                const texts = { ...s.texts };
                for (const [movedId, to] of Object.entries(result.moves)) {
                    if (nodes[movedId] !== undefined) {
                        nodes[movedId] = { ...nodes[movedId], ...to };
                    } else if (texts[movedId] !== undefined) {
                        texts[movedId] = { ...texts[movedId], ...to };
                    }
                }
                nodes[id] = { ...nodes[id]!, w: result.frame.w, h: result.frame.h };
                return { nodes, texts, ...remember(s) };
            });
            return { moved };
        },
        deleteSelected() {
            const { nodes, texts, lines, order, edges, selection } = get();
            if (selection.length === 0) {
                return;
            }
            // A collapsed group takes what it hid along; nothing should linger unseen.
            const gone = new Set(goingWithDelete(selection, nodes, texts, lines));

            for (const id of emptyCanvasGroupIds({ nodes: Object.values(nodes), texts: Object.values(texts), lines: Object.values(lines) }, gone)) {
                gone.add(id);
            }

            const nextNodes = { ...nodes };
            const nextTexts = { ...texts };
            const nextLines = { ...lines };
            for (const id of gone) {
                delete nextNodes[id];
                delete nextTexts[id];
                delete nextLines[id];
            }

            for (const node of Object.values(nextNodes)) {
                if (node.memberIds?.some((id) => gone.has(id))) {
                    nextNodes[node.id] = { ...node, memberIds: node.memberIds.filter((id) => !gone.has(id)) };
                }
            }

            set({
                nodes: nextNodes,
                texts: nextTexts,
                lines: nextLines,
                hidden: hiddenIn(nextNodes, nextTexts, nextLines),
                order: order.filter((id) => !gone.has(id)),
                edges: edges.filter((edge) => !gone.has(edge.id) && !gone.has(edge.from) && !gone.has(edge.to)),
                selection: [],
                bodyFocusId: gone.has(get().bodyFocusId ?? '') ? null : get().bodyFocusId,
                ...remember(get())
            });
        },
        toggleCollapse(id) {
            const s = get();
            const group = s.nodes[id];
            if (!group) {
                return;
            }
            if (group.kind !== 'group') {
                // Its body stays as it was under the header (`NodeFrame`), so a terminal keeps its size and a chat its place.
                const folded: CanvasNode = group.collapsed
                    ? { ...group, collapsed: undefined, h: group.expandedHeight ?? group.h, expandedHeight: undefined }
                    : { ...group, collapsed: true, expandedHeight: group.h, h: COLLAPSED_NODE_PX };
                // A folded body is out of reach, so it gives up the keyboard.
                set({ nodes: { ...s.nodes, [id]: folded }, bodyFocusId: folded.collapsed && s.bodyFocusId === id ? null : s.bodyFocusId, ...remember(s) });
                return;
            }
            // What it holds stays as it is either way, so opening it over other nodes never takes them in.
            const next: CanvasNode = group.collapsed
                ? { ...group, collapsed: false, h: group.expandedHeight ?? group.h, expandedHeight: undefined }
                : { ...group, collapsed: true, memberIds: membersOf(group, s.nodes, s.texts, s.lines), expandedHeight: group.h, h: GROUP_HEADER_PX };
            const nodes = { ...s.nodes, [id]: next };
            const hidden = hiddenIn(nodes, s.texts, s.lines);
            set({ nodes, hidden, selection: s.selection.filter((selected) => !hidden.has(selected)), ...remember(s) });
        },
        setGroupWorktree(id, worktree) {
            set((s) => (s.nodes[id]?.kind === 'group' ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], worktree: worktree ?? undefined } } } : {}));
        }
    };
}
