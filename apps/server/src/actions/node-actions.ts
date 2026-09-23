import { basename } from 'node:path';
import { ARRANGE_LAYOUTS, ActionRefusal, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import {
    DEFAULT_TITLES,
    NODE_ACCENT_NAMES,
    NODE_SIZE,
    groupFrame,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isUnknownNode,
    storedPathOf,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDiagramView,
    type ProjectDrawingView,
    type ProjectEdge,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { ownEnd } from '../canvas/links.ts';
import { EVERY_KIND_LINE, KIND_FLAGS, REQUIRED_FLAG, kindLine, type KindFlag } from '../canvas/node-kinds.ts';
import { MAX_CANVAS_NODES, NOT_A_GROUP, canvasFull, checkUrl, newId, nodeLines, nodesNamed, openingEdge } from '../canvas/nodes.ts';
import { ownViewOf, refuseMissingNodes, refuseOwnView } from '../canvas/own-view.ts';
import { arrangeRects, containersOf, gridColumns, groupMembers, placeBeside, placeFree } from '../canvas/placement.ts';
import { checkCwd, checkPath, isInside } from '../canvas/project-paths.ts';
import { NEW_NODE, VerbRefusal, canvasNamed, field, orNote, type VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { verbCallOf, type ServerActionContext } from './context.ts';

/* The set is closed and short enough to print whole, unlike the sixty Lucide names a view picks from. */
export const COLOR_LINES: readonly string[] = [['colors', ...NODE_ACCENT_NAMES].join('\t')];

const withCanvas = (content: ProjectContent, canvas: ProjectCanvasView): ProjectContent => ({
    ...content,
    views: content.views.map((view) => (view.id === canvas.id ? canvas : view))
});

/*
 * What this refusal may offer: the nodes on the caller's own canvas that this same call would
 * actually remove. The caller's own node is left out, since `deletes-caller` refuses it two lines
 * later, and so is every node the caller did not make unless the machine frees them.
 */
const deletableLines = (content: ProjectContent, place: IndexedPlace, call: VerbCall, anyNode: boolean): string[] => {
    const canvas = place.canvasId === null ? undefined : content.views.find((view) => view.id === place.canvasId);
    if (canvas === undefined || !isCanvasView(canvas)) {
        return ['detail\truimte-context node list --view <id>\tthe nodes of a canvas, which is where an id comes from'];
    }
    return nodeLines(canvas, {
        takes: (node) => node.id !== call.caller && (anyNode || call.host.madeBy(node.id) === call.caller),
        empty: `You have no node on ${canvas.id} to remove; node delete takes a node you made yourself`
    });
};

/*
 * Who may write in a note. Not the maker alone, the way `node delete` reads a node: a shared note is
 * the point, and two agents cannot keep one between them when only the one that made it may write.
 * A line is what a person drew, so it is what grants this, and either direction counts, since a note
 * holds no agent and a line into it reads as the same relationship as one out of it.
 */
const mayWrite = (canvas: ProjectCanvasView, node: ProjectNode, call: VerbCall): boolean =>
    call.host.madeBy(node.id) === call.caller ||
    canvas.edges.some((edge) => (edge.from === call.caller && edge.to === node.id) || (edge.to === call.caller && edge.from === node.id));

/* What a refusal may offer instead: only the notes this same call would really write in. */
const writableLines = (canvas: ProjectCanvasView, call: VerbCall): string[] =>
    nodeLines(canvas, {
        takes: (node) => node.kind === 'note' && mayWrite(canvas, node, call),
        empty: `${canvas.id} has no note you may write in; ruimte-context node new note --text B adds one of your own`
    });

/* The text as a line of its own under what is there, and nothing but the text on a note still empty. */
const withLine = (body: string, text: string): string => {
    if (body === '') {
        return text;
    }
    return `${body}${body.endsWith('\n') ? '' : '\n'}${text}`;
};

/*
 * The lines between the caller and what the frame now holds, which the one line into the group says
 * in their place: a line into a group makes everything inside it readable at once, and a node that
 * arrives twice is read once. Both ends have to be the caller's, the rule `link delete` follows,
 * since a line a person drew is the context that person gave. Which way a line runs is not part of
 * it: a line between an agent and a node that is not one reads the same in both directions.
 */
const ownLinesInto = (edges: readonly ProjectEdge[], held: ReadonlySet<string>, call: VerbCall): ProjectEdge[] =>
    edges.filter(
        (edge) =>
            ((edge.from === call.caller && held.has(edge.to)) || (edge.to === call.caller && held.has(edge.from))) &&
            ownEnd(edge.from, call) &&
            ownEnd(edge.to, call)
    );

/* Where a node stands, said in the words a refusal needs: a frame by id, or the canvas itself. */
const placeName = (container: ProjectNode | undefined): string => (container === undefined ? 'on the canvas itself' : `in group ${container.id}`);

export const nodeActions: ActionHandlers<ServerActionContext> = {
    'node.list': async ({ viewId }, { actor, context }) => {
        const revision = await context.host.revision(context.place.projectId);
        const canvas = canvasNamed(await context.host.read(context.place.projectId), viewId);
        const containers = containersOf(canvas.nodes);
        return {
            output: {
                viewId: canvas.id,
                nodes: canvas.nodes.map((node) => ({
                    nodeId: node.id,
                    kind: node.kind,
                    title: node.title,
                    x: node.x,
                    y: node.y,
                    w: node.w,
                    h: node.h,
                    groupId: containers.get(node.id)?.id ?? null
                })),
                self: canvas.nodes.some((node) => node.id === actor.id) ? actor.id : null,
                revision
            }
        };
    },
    'node.create': async (input, call) => {
        const { actor, context, dryRun } = call;
        const { host, place } = context;
        const { kind } = input;
        // Only `agent` starts anything, so a node an agent adds opens empty.
        if (input.command !== null || input.provider !== null) {
            throw new VerbRefusal('starts-nothing', 'node new starts no CLI and no command; ruimte-context agent is what opens an agent');
        }
        if (kind === 'group') {
            throw new VerbRefusal('bad-arguments', 'node new draws no frame; ruimte-context node group draws one around nodes');
        }
        const kindLines = [kindLine(kind), EVERY_KIND_LINE];
        const given: Record<KindFlag, unknown> = { text: input.content, url: input.url, path: input.path, source: input.source, cwd: input.cwd };
        for (const flag of ['text', 'url', 'path', 'source', 'cwd'] as const) {
            if (given[flag] != null && !KIND_FLAGS[kind].includes(flag)) {
                throw new VerbRefusal('flag-not-for-kind', `--${flag} does not go with a ${kind} node`, kindLines);
            }
        }
        const required = REQUIRED_FLAG[kind];
        if (required && given[required] == null) {
            throw new VerbRefusal('missing-flag', `A ${kind} node needs --${required}`, kindLines);
        }

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const url = input.url === null ? undefined : checkUrl(input.url);
        const path = input.path === null ? undefined : await checkPath(place.folder, input.path);
        const cwd = input.cwd == null ? undefined : await checkCwd(place.folder, input.cwd, (folder) => host.worktreePaths(folder));

        return host.mutate<{ output: ActionOutput<'node.create'> }>(place.projectId, async (content) => {
            const canvas = canvasNamed(content, input.viewId);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            let sourceName: string | undefined;
            if (input.source != null) {
                // Only a drawing or a diagram takes --source, and each mirrors a view of its own kind.
                const sourceKind = kind === 'diagram' ? 'diagram' : 'drawing';
                const ofKind = (view: ProjectView): view is ProjectDrawingView | ProjectDiagramView =>
                    sourceKind === 'diagram' ? isDiagramView(view) : isDrawingView(view);
                const source = content.views.find((view) => view.id === input.source);
                if (!source || !ofKind(source)) {
                    throw new VerbRefusal(
                        `not-a-${sourceKind}`,
                        `${input.source} is not a ${sourceKind} view of this project`,
                        orNote(
                            content.views.filter(ofKind).map((view) => `${sourceKind}\t${view.id}\t${field(view.name)}`),
                            sourceKind === 'diagram'
                                ? 'This project has no diagram views; ruimte-context view new --kind diagram makes one'
                                : 'This project has no drawing views; a person makes one in the sidebar'
                        )
                    );
                }
                sourceName = source.name;
            }
            const size = NODE_SIZE[kind];
            const anchor = input.beside == null ? undefined : canvas.nodes.find((node) => node.id === input.beside);
            if (input.beside != null && !anchor) {
                throw refuseMissingNodes(content, [input.beside], canvas.id, 'the new node has nothing there to stand beside', nodeLines(canvas));
            }
            const caller = canvas.nodes.find((node) => node.id === actor.id) ?? null;
            const rect = anchor
                ? placeBeside(anchor, size)
                : input.at !== null
                  ? { x: Math.round(input.at.x - size.w / 2), y: Math.round(input.at.y - size.h / 2), ...size }
                  : placeFree(canvas.nodes, size, caller);
            const title = input.title ?? sourceName ?? (path === undefined ? DEFAULT_TITLES[kind] : basename(path));
            if (dryRun === true) {
                return {
                    content: null,
                    result: {
                        output: {
                            viewId: canvas.id,
                            view: canvas.name,
                            nodeId: NEW_NODE,
                            node: title,
                            kind,
                            edge: caller ? { edgeId: null, from: caller.id, to: NEW_NODE } : null
                        }
                    }
                };
            }

            const id = newId(kind, content);
            /* Written down under the project's lock, before the node is on disk: who made a node is
               the whole of the rule `node delete` follows, and it may not arrive after the node does. */
            await host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: actor.id, depth: 0, agent: false });
            const node: ProjectNode = {
                id,
                kind,
                title,
                // A title the agent chose is not one the session may rename, the rule a person's typing follows.
                ...(input.title === null ? {} : { titleSource: 'user' as const }),
                ...rect,
                ...(input.content === null ? {} : { body: input.content }),
                ...(url === undefined ? {} : { url }),
                ...(path === undefined ? {} : { path: isInside(place.folder, path) ? storedPathOf(place.folder, path) : path }),
                ...(input.source == null ? {} : { viewId: input.source }),
                ...(cwd === undefined ? {} : { cwd })
            };
            const edge = caller ? openingEdge(caller.id, node, content) : null;
            return {
                content: withCanvas(content, { ...canvas, nodes: [...canvas.nodes, node], edges: edge ? [...canvas.edges, edge] : canvas.edges }),
                result: {
                    output: {
                        viewId: canvas.id,
                        view: canvas.name,
                        nodeId: id,
                        node: node.title,
                        kind,
                        edge: edge ? { edgeId: edge.id, from: edge.from, to: edge.to } : null
                    }
                }
            };
        });
    },
    'node.rename': async ({ viewId, nodeId, name }, { context }) => {
        const { host, place } = context;
        return host.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const [node] = nodesNamed(content, canvas, [nodeId], { cannot: 'there is no node to rename' });
            if (!node || isUnknownNode(node)) {
                throw new VerbRefusal('unknown-node', `${nodeId} is not a renameable node on ${viewId}`);
            }
            const previousName = node.title;
            const previousSource = node.titleSource ?? null;
            const changed = previousName !== name || previousSource !== 'user';
            const nodes = changed
                ? canvas.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, title: name, titleSource: 'user' as const } : candidate))
                : canvas.nodes;
            return {
                content: changed ? withCanvas(content, { ...canvas, nodes }) : null,
                result: {
                    output: { viewId, nodeId, kind: node.kind, previousName, name, changed },
                    ...(changed
                        ? {
                              undo: async () => {
                                  await host.mutate(place.projectId, (current) => {
                                      const currentCanvas = current.views.find((view): view is ProjectCanvasView => view.id === viewId && isCanvasView(view));
                                      const currentNode = currentCanvas?.nodes.find((candidate) => candidate.id === nodeId);
                                      if (!currentCanvas || !currentNode || currentNode.title !== name || currentNode.titleSource !== 'user') {
                                          throw new ActionRefusal('stale-undo', `${name} is no longer the current title of this node`);
                                      }
                                      const restored = currentCanvas.nodes.map((candidate) =>
                                          candidate.id === nodeId ? { ...candidate, title: previousName, titleSource: previousSource ?? undefined } : candidate
                                      );
                                      return { content: withCanvas(current, { ...currentCanvas, nodes: restored }), result: undefined };
                                  });
                              }
                          }
                        : {})
                }
            };
        });
    },
    'node.delete': async ({ viewId, nodeIds }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        const anyNode = host.agentsDeleteAnyView();
        const ids = [...new Set(nodeIds)];
        return host.mutate(place.projectId, async (content) => {
            // A node on no canvas at all is refused before the canvas is read: the CLI finds the canvas by the node.
            const canvases = content.views.filter(isCanvasView);
            for (const id of ids) {
                if (!canvases.some((view) => view.nodes.some((node) => node.id === id))) {
                    const lines = deletableLines(content, place, caller, anyNode);
                    const own = ownViewOf(content, id);
                    if (own) {
                        throw refuseOwnView(own, 'there is no node to remove', [
                            ...lines,
                            `see\truimte-context view delete ${id}\tremoves a view you made, with the session it holds`
                        ]);
                    }
                    throw new VerbRefusal('unknown-node', `${id} is not a node on any canvas of this project`, lines);
                }
            }
            const canvas = canvasNamed(content, viewId);
            const going = nodesNamed(content, canvas, ids, { cannot: 'there is no node to remove' });
            for (const node of going) {
                if (node.id === caller.caller) {
                    throw new VerbRefusal('deletes-caller', `You are ${node.id}, so removing it would end the session asking`);
                }
                const madeBy = host.madeBy(node.id);
                if (!anyNode && madeBy !== caller.caller) {
                    throw new VerbRefusal('not-yours', `${node.id} was made by ${madeBy ?? 'a person'} and node delete only removes a node you made yourself`, [
                        `made by\t${madeBy ?? 'a person'}`,
                        `you\t${caller.caller}`,
                        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view; a person turns it on from the Machines pane"
                    ]);
                }
            }

            const gone = new Set(ids);
            const edges = canvas.edges.filter((edge) => !gone.has(edge.from) && !gone.has(edge.to));
            /* A collapsed frame keeps its members by id, so a node that goes has to leave those lists
               too; nothing reads geometry while a group is shut. */
            const nodes = canvas.nodes
                .filter((candidate) => !gone.has(candidate.id))
                .map((candidate) =>
                    candidate.memberIds?.some((member) => gone.has(member))
                        ? { ...candidate, memberIds: candidate.memberIds.filter((member) => !gone.has(member)) }
                        : candidate
                );
            const removed = going.map((node) => ({
                nodeId: node.id,
                kind: node.kind,
                title: node.title,
                ended: node.kind === 'terminal' || node.kind === 'chat',
                edges: canvas.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
                members: node.kind === 'group' ? groupMembers(node, canvas.nodes).length : null
            }));
            for (const node of going) {
                if (node.kind === 'terminal' || node.kind === 'chat') {
                    // Before the write, the rule view delete follows: a shell that outlived its node would answer to nothing.
                    await host.endSession(node.kind, node.id);
                }
            }
            return {
                content: withCanvas(content, { ...canvas, nodes, edges }),
                result: { output: { viewId: canvas.id, view: canvas.name, nodeIds: ids, nodes: going.map((node) => node.title), removed } }
            };
        });
    },
    'node.update': async ({ viewId, nodeId, text, append }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        if (append && text === '') {
            throw new VerbRefusal('bad-arguments', '--append has nothing to add: --text is empty; leave --append off to empty the note');
        }
        return host.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
            if (!node) {
                throw refuseMissingNodes(content, [nodeId], canvas.id, 'there is no node to write in', writableLines(canvas, caller));
            }
            if (node.kind !== 'note') {
                throw new VerbRefusal(
                    'not-a-note',
                    `${nodeId} is a ${node.kind} node and only a note holds a body to write; what a file, a browser, a terminal or a chat shows is not yours to set`,
                    writableLines(canvas, caller)
                );
            }
            if (!mayWrite(canvas, node, caller)) {
                throw new VerbRefusal(
                    'not-linked',
                    `${nodeId} is a note you did not make and no line joins you to it: draw that line and you can write in it`,
                    [...writableLines(canvas, caller), `see\truimte-context link new --to ${nodeId}\tdraws the line this needs`]
                );
            }
            /*
             * The body is read here and nowhere earlier. `mutate` runs under the project's lock
             * against the document as it stands, so two agents appending in the same breath queue
             * up and the second one writes its line under the first instead of over it.
             */
            const body = node.body ?? '';
            const next = append ? withLine(body, text) : text;
            const output = { viewId: canvas.id, nodeId, lines: next === '' ? 0 : next.split('\n').length, characters: next.length, changed: next !== body };
            if (next === body) {
                return { content: null, result: { output } };
            }
            const nodes = canvas.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, body: next } : candidate));
            return { content: withCanvas(content, { ...canvas, nodes }), result: { output } };
        });
    },
    'group.create': async ({ viewId, nodeIds, label, color }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        const ids = [...new Set(nodeIds)];
        if (color != null && !(NODE_ACCENT_NAMES as readonly string[]).includes(color)) {
            throw new VerbRefusal('unknown-color', `${color} is not one of the ${NODE_ACCENT_NAMES.length} colors a frame takes`, [...COLOR_LINES]);
        }
        const accent = color ?? undefined;

        return host.mutate(place.projectId, async (content) => {
            const canvas = canvasNamed(content, viewId);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            const members = nodesNamed(content, canvas, ids, { ...NOT_A_GROUP, cannot: 'it cannot stand inside a frame' });
            const framed = members.find((node) => node.kind === 'group');
            if (framed) {
                throw new VerbRefusal(
                    'not-groupable',
                    `${framed.id} is a group, and a frame is drawn around nodes; move it inside the frame instead and it goes in with them`
                );
            }

            const containers = containersOf(canvas.nodes);
            const container = containers.get(members[0]!.id);
            const elsewhere = members.find((node) => containers.get(node.id)?.id !== container?.id);
            if (elsewhere) {
                throw new VerbRefusal(
                    'different-groups',
                    `${members[0]!.id} stands ${placeName(container)} and ${elsewhere.id} stands ${placeName(containers.get(elsewhere.id))}; a frame goes around nodes that are already in the same place`
                );
            }

            const frame = groupFrame(members)!;
            const id = newId('group', content);
            // The frame is a node like any other, and who made it is what node delete asks about.
            await host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: caller.caller, depth: 0, agent: false });
            const group: ProjectNode = {
                id,
                kind: 'group',
                title: label ?? DEFAULT_TITLES.group,
                ...frame,
                ...(accent === undefined ? {} : { accent })
            };
            const inside = groupMembers(group, [...canvas.nodes, group]);
            const named = new Set(ids);
            const held = new Set(inside.map((node) => node.id));
            /* A caller the frame ends up around keeps every line it has, since a line from inside a
               frame into that same frame tells nobody anything; so does one that is not on this canvas. */
            const framesCaller = held.has(caller.caller) || !canvas.nodes.some((node) => node.id === caller.caller);
            const replaced = framesCaller ? [] : ownLinesInto(canvas.edges, held, caller);
            // Only where something went: a frame nobody had a line into is not given one out of nowhere.
            const opening = replaced.length === 0 ? null : openingEdge(caller.caller, group, content);
            const gone = new Set(replaced.map((edge) => edge.id));
            const edges = opening === null ? canvas.edges : [...canvas.edges.filter((edge) => !gone.has(edge.id)), opening];
            /* A collapsed frame keeps its members in the file, so the new group has to be written into
               them: by geometry it is inside, and while the container is shut nothing reads geometry. */
            const nodes = canvas.nodes.map((node) =>
                container !== undefined && node.id === container.id && node.collapsed === true ? { ...node, memberIds: [...(node.memberIds ?? []), id] } : node
            );
            return {
                content: withCanvas(content, { ...canvas, nodes: [...nodes, group], edges }),
                result: {
                    output: {
                        viewId: canvas.id,
                        view: canvas.name,
                        groupId: id,
                        members: inside.map((node) => node.id),
                        label: group.title,
                        also: inside.filter((node) => !named.has(node.id)).map((node) => ({ nodeId: node.id, kind: node.kind, title: node.title })),
                        edges: opening === null ? null : { replaced: replaced.length, edgeId: opening.id }
                    }
                }
            };
        });
    },
    'node.arrange': async ({ viewId, nodeIds, layout, columns }, { context }) => {
        const { host, place } = context;
        const ids = [...new Set(nodeIds)];
        if (columns !== null && layout !== 'grid') {
            throw new VerbRefusal('flag-not-for-layout', `--cols does not go with ${layout}; a row is one row and a column is one column`, [
                'layout\tgrid\ttakes --cols',
                `layout\t${ARRANGE_LAYOUTS.filter((candidate) => candidate !== 'grid').join(', ')}\ttake no --cols`
            ]);
        }
        return host.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const moving = nodesNamed(content, canvas, ids, { ...NOT_A_GROUP, cannot: 'there is nothing there to move' });
            const carrier = moving.find((node) => node.kind === 'group');
            if (carrier) {
                throw new VerbRefusal(
                    'not-arrangeable',
                    `${carrier.id} is a group and carries whatever stands inside it; node arrange moves the nodes it is given, so name those instead`
                );
            }
            if (columns !== null && columns > moving.length) {
                throw new VerbRefusal(
                    'too-many-columns',
                    `--cols is ${columns} and you named ${moving.length} ${moving.length === 1 ? 'node' : 'nodes'}; a grid holds at most one column per node`,
                    [`columns\twithout --cols\t${gridColumns(moving.length)}`]
                );
            }

            const placed = arrangeRects(moving, layout, columns ?? undefined);
            const byId = new Map(moving.map((node, index) => [node.id, placed[index]!]));
            const changed = moving.some((node, index) => node.x !== placed[index]!.x || node.y !== placed[index]!.y);
            const output = {
                viewId: canvas.id,
                nodes: moving.map((node) => ({ nodeId: node.id, x: byId.get(node.id)!.x, y: byId.get(node.id)!.y })),
                changed
            };
            if (!changed) {
                return { content: null, result: { output } };
            }
            const moved = (node: ProjectNode): ProjectNode => {
                const rect = byId.get(node.id);
                return rect === undefined ? node : { ...node, x: rect.x, y: rect.y };
            };
            return { content: withCanvas(content, { ...canvas, nodes: canvas.nodes.map(moved) }), result: { output } };
        });
    }
};
