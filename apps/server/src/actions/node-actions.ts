import { basename } from 'node:path';
import { ARRANGE_LAYOUTS, ActionRefusal, type ActionHandlers, type ActionInput, type ActionOutput } from '@ruimte/actions';
import {
    DEFAULT_TITLES,
    NODE_ACCENT_NAMES,
    flagOf,
    emptyCanvasGroupIds,
    groupFrame,
    nodeColorOf,
    nodeColorPatch,
    isCanvasView,
    isChatNode,
    isDiagramView,
    isDrawingView,
    isUnknownNode,
    lineEndOf,
    nodeChats,
    storedPathOf,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectDiagramView,
    type ProjectDrawingView,
    type ProjectEdge,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import { ArtifactError } from '../artifacts/artifact-names.ts';
import { isChatView } from '../canvas/chat-view.ts';
import { ownEnd } from '../canvas/links.ts';
import { EVERY_KIND_LINE, KIND_FLAGS, REQUIRED_FLAG, kindLine, type KindFlag } from '../canvas/node-kinds.ts';
import { MAX_CANVAS_NODES, NOT_A_GROUP, canvasFull, checkUrl, newId, nodeLines, nodesNamed, openingEdge } from '../canvas/nodes.ts';
import { ownViewOf, refuseMissingNodes, refuseOwnView } from '../canvas/own-view.ts';
import { arrangeRects, containersOf, gridColumns, groupMembers, placeBeside, placeFree } from '../canvas/placement.ts';
import { checkCwd, checkPath, isInside } from '../canvas/project-paths.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { NEW_NODE, VerbRefusal, canvasNamed, field, orNote, referencedBy, snoozedAt, type VerbCall } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { hostService, verbCallOf, type ServerActionCall, type ServerActionContext } from './context.ts';
import { machineDevice } from './device-actions.ts';
import { entryOf, routinesOf } from './routine-actions.ts';

/* The set is closed and short enough to print whole, unlike the Lucide names a view picks from. */
export const COLOR_LINES: readonly string[] = [['colors', ...NODE_ACCENT_NAMES].join('\t')];

function withCanvas(content: ProjectContent, canvas: ProjectCanvasView): ProjectContent {
    return {
        ...content,
        views: content.views.map((view) => (view.id === canvas.id ? canvas : view))
    };
}

/*
 * What this refusal may offer: the nodes on the caller's own canvas that this same call would
 * actually remove. The caller's own node is left out, since `deletes-caller` refuses it two lines
 * later, and so is every node the caller did not make unless the machine frees them.
 */
function deletableLines(content: ProjectContent, place: IndexedPlace, call: VerbCall, anyNode: boolean): string[] {
    const canvas = place.canvasId === null ? undefined : content.views.find((view) => view.id === place.canvasId);
    if (canvas === undefined || !isCanvasView(canvas)) {
        return ['detail\truimte-context node list --view <id>\tthe nodes of a canvas, which is where an id comes from'];
    }
    return nodeLines(canvas, {
        takes: (node) => node.id !== lineEndOf(canvas.nodes, call.caller) && (anyNode || call.host.lineage.madeBy(node.id) === call.caller),
        empty: `You have no node on ${canvas.id} to remove; node delete takes a node you made yourself`
    });
}

/*
 * Who may write in a note or color a node: not the maker alone, so two agents can keep one between
 * them. A line a person drew grants it, in either direction, since a note holds no agent and a color
 * is no way into what a session runs. A chat view has no lines and touches any node of the canvas
 * it names, as a person arranging that canvas would. A later chat of a design node goes by the node's lines.
 */
function mayTouch(canvas: ProjectCanvasView, node: ProjectNode, call: VerbCall, chatView: boolean): boolean {
    const end = lineEndOf(canvas.nodes, call.caller);

    return (
        chatView ||
        call.host.lineage.madeBy(node.id) === call.caller ||
        canvas.edges.some((edge) => (edge.from === end && edge.to === node.id) || (edge.to === end && edge.from === node.id))
    );
}

/* A note a person pointed the caller at with `#` is its to write in as well, as along a line; a `#` to its canvas alone is not. */
function mayWrite(canvas: ProjectCanvasView, node: ProjectNode, call: VerbCall, chatView: boolean): boolean {
    return mayTouch(canvas, node, call, chatView) || referencedBy(call.host, call.caller, node.id);
}

/* Its own node too: how a session's node looks is that session's to say. A node pointed at with `#` counts as along a line. */
function mayColor(canvas: ProjectCanvasView, node: ProjectNode, call: VerbCall, chatView: boolean): boolean {
    return node.id === lineEndOf(canvas.nodes, call.caller) || mayWrite(canvas, node, call, chatView);
}

/* What a refusal may offer instead: only the nodes this same call would really color. */
function colorableLines(canvas: ProjectCanvasView, call: VerbCall, chatView: boolean): string[] {
    return nodeLines(canvas, {
        takes: (node) => !isUnknownNode(node) && mayColor(canvas, node, call, chatView),
        empty: `${canvas.id} has no node you may color; ruimte-context node new adds one of your own`
    });
}

/* What a refusal may offer instead: only the notes this same call would really write in. */
function writableLines(canvas: ProjectCanvasView, call: VerbCall, chatView: boolean): string[] {
    return nodeLines(canvas, {
        takes: (node) => node.kind === 'note' && mayWrite(canvas, node, call, chatView),
        empty: `${canvas.id} has no note you may write in; ruimte-context node new note --text B adds one of your own`
    });
}

/* The text as a line of its own under what is there, and nothing but the text on a note still empty. */
function withLine(body: string, text: string): string {
    if (body === '') {
        return text;
    }
    return `${body}${body.endsWith('\n') ? '' : '\n'}${text}`;
}

/*
 * The lines between the caller and what the frame now holds, which the one line into the group says
 * in their place. Both ends have to be the caller's, the rule `link delete` follows, either way round.
 */
function ownLinesInto(edges: readonly ProjectEdge[], held: ReadonlySet<string>, call: VerbCall): ProjectEdge[] {
    return edges.filter(
        (edge) =>
            ((edge.from === call.caller && held.has(edge.to)) || (edge.to === call.caller && held.has(edge.from))) &&
            ownEnd(edge.from, call) &&
            ownEnd(edge.to, call)
    );
}

/* A rename on the canvas as it stands, refused for a node it does not hold or a kind it cannot write back. */
function renamedOn(content: ProjectContent, canvas: ProjectCanvasView, nodeId: string, name: string) {
    const [node] = nodesNamed(content, canvas, [nodeId], { cannot: 'there is no node to rename' });
    if (!node || isUnknownNode(node)) {
        throw new VerbRefusal('unknown-node', `${nodeId} is not a renameable node on ${canvas.id}`);
    }
    const previousName = node.title;
    const previousSource = node.titleSource ?? null;
    const changed = previousName !== name || previousSource !== 'user';
    const nodes = changed
        ? canvas.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, title: name, titleSource: 'user' as const } : candidate))
        : canvas.nodes;
    return { canvas: changed ? { ...canvas, nodes } : canvas, kind: node.kind, previousName, previousSource, changed };
}

/* A note written on the canvas as it stands, refused for anything but a note the caller may write in. */
function writtenOn(
    content: ProjectContent,
    canvas: ProjectCanvasView,
    { nodeId, text, append }: { nodeId: string; text: string; append: boolean },
    caller: VerbCall,
    chatView: boolean
) {
    const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
        throw refuseMissingNodes(content, [nodeId], canvas.id, 'there is no node to write in', writableLines(canvas, caller, chatView));
    }
    refuseOtherMachine(caller.host, nodeId);
    if (node.kind !== 'note') {
        throw new VerbRefusal(
            'not-a-note',
            `${nodeId} is a ${node.kind} node and only a note holds a body to write; what a file, a browser, a terminal or a chat shows is not yours to set`,
            writableLines(canvas, caller, chatView)
        );
    }
    if (!mayWrite(canvas, node, caller, chatView)) {
        throw new VerbRefusal('not-linked', `${nodeId} is a note you did not make and no line joins you to it: draw that line and you can write in it`, [
            ...writableLines(canvas, caller, chatView),
            `see\truimte-context link new --to ${nodeId}\tdraws the line this needs`
        ]);
    }
    // Read here under the project's lock and nowhere earlier, so of two agents appending at once the second writes under the first.
    const body = node.body ?? '';
    const next = append ? withLine(body, text) : text;
    const output = { nodeId, lines: next === '' ? 0 : next.split('\n').length, characters: next.length, changed: next !== body };
    if (next === body) {
        return { canvas, output };
    }
    return { canvas: { ...canvas, nodes: canvas.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, body: next } : candidate)) }, output };
}

/* Where a node stands, said in the words a refusal needs: a frame by id, or the canvas itself. */
function placeName(container: ProjectNode | undefined): string {
    return container === undefined ? 'on the canvas itself' : `in group ${container.id}`;
}

/* One node to make, as node.create and node.createMany both take it. */
type NodeSpec = {
    [Field in Exclude<keyof ActionInput<'node.createMany'>['nodes'][number], 'kind'>]?: ActionInput<'node.createMany'>['nodes'][number][Field] | null;
} & {
    kind: ActionInput<'node.create'>['kind'];
    title: string | null;
    at?: { x: number; y: number } | null;
    // Only node.create names an artifact or a routine: a batch carries none.
    artifact?: string | null;
    artifactVersion?: string | null;
    routine?: string | null;
};

/* What a spec names on the disk or the machine, looked up before the project's lock is taken. */
interface Checked {
    spec: NodeSpec;
    url: string | undefined;
    path: string | undefined;
    cwd: string | undefined;
    device: ProjectNode['device'];
    artifact: { reference: NonNullable<ProjectNode['artifact']>; title: string } | undefined;
    routine: { id: string; title: string } | undefined;
}

/* A routine of the caller's own project, whichever of its two files it lives in. */
async function checkRoutine(call: ServerActionCall, routineId: string): Promise<Checked['routine']> {
    const { routines } = await routinesOf(call.context).list(call.context.place.projectId);
    const { routine } = entryOf(routines, routineId);
    return { id: routine.id, title: routine.title };
}

/* An artifact of the caller's own project, and a version of it when one is named; one of another project answers as not there. */
async function checkArtifact(call: ServerActionCall, artifactId: string, versionId: string | null | undefined): Promise<Checked['artifact']> {
    const artifacts = hostService(call.context, 'artifacts', 'no-output', 'This machine keeps no Output');
    try {
        const { artifact, version } = await artifacts.read(call.context.place.projectId, { artifactId, ...(versionId == null ? {} : { versionId }) });
        return { reference: { id: artifact.artifactId, ...(versionId == null ? {} : { version: version.versionId }) }, title: artifact.title };
    } catch (error) {
        if (error instanceof ArtifactError) {
            throw new VerbRefusal('not-found', error.message, ['see\truimte-context artifact list\twhat this project keeps']);
        }
        throw error;
    }
}

type Made = ActionOutput<'node.createMany'>['nodes'][number];

/* A refusal about one node of several says which one, counted from 1 the way a person counts them. */
async function forNode<T>(index: number | null, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (index !== null && error instanceof VerbRefusal) {
            throw new VerbRefusal(error.code, `Node ${index + 1}: ${error.message}`, error.lines);
        }
        throw error;
    }
}

/* Everything that touches the disk or git, which runs before the lock so a slow repository holds up no save. */
async function checkNode(spec: NodeSpec, call: ServerActionCall): Promise<Checked> {
    const { host, place } = call.context;
    const { kind } = spec;
    if (kind === 'group') {
        throw new VerbRefusal('bad-arguments', 'node new draws no frame; ruimte-context node group draws one around nodes');
    }
    const kindLines = [kindLine(kind), EVERY_KIND_LINE];
    const given: Record<KindFlag, unknown> = {
        text: spec.content,
        url: spec.url,
        path: spec.path,
        source: spec.source,
        device: spec.device,
        cwd: spec.cwd,
        artifact: spec.artifact,
        version: spec.artifactVersion,
        routine: spec.routine
    };
    for (const flag of ['text', 'url', 'path', 'source', 'device', 'cwd', 'artifact', 'version', 'routine'] as const) {
        if (given[flag] != null && !KIND_FLAGS[kind].includes(flag)) {
            throw new VerbRefusal('flag-not-for-kind', `--${flag} does not go with a ${kind} node`, kindLines);
        }
    }
    const required = REQUIRED_FLAG[kind];
    if (required && given[required] == null) {
        throw new VerbRefusal('missing-flag', `A ${kind} node needs --${required}`, kindLines);
    }
    return {
        spec,
        url: spec.url == null ? undefined : checkUrl(spec.url),
        path: spec.path == null ? undefined : await checkPath(place.folder, spec.path),
        cwd: spec.cwd == null ? undefined : await checkCwd(place.folder, spec.cwd, (folder) => host.checkouts.paths(folder)),
        device: spec.device == null ? undefined : await machineDevice(host, spec.device),
        artifact: spec.artifact == null ? undefined : await checkArtifact(call, spec.artifact, spec.artifactVersion),
        routine: spec.routine == null ? undefined : await checkRoutine(call, spec.routine)
    };
}

/* The title a drawing or a diagram takes from the view it mirrors, after checking that view is one of its kind. */
function sourceNameOf(content: ProjectContent, spec: NodeSpec): string | undefined {
    if (spec.source == null) {
        return undefined;
    }
    // Only a drawing or a diagram takes --source, and each mirrors a view of its own kind.
    const sourceKind = spec.kind === 'diagram' ? 'diagram' : 'drawing';
    const ofKind = (view: ProjectView): view is ProjectDrawingView | ProjectDiagramView =>
        sourceKind === 'diagram' ? isDiagramView(view) : isDrawingView(view);
    const source = content.views.find((view) => view.id === spec.source);
    if (!source || !ofKind(source)) {
        throw new VerbRefusal(
            `not-a-${sourceKind}`,
            `${spec.source} is not a ${sourceKind} view of this project`,
            orNote(
                content.views.filter(ofKind).map((view) => `${sourceKind}\t${view.id}\t${field(view.name)}`),
                sourceKind === 'diagram'
                    ? 'This project has no diagram views; ruimte-context view new --kind diagram makes one'
                    : 'This project has no drawing views; a person makes one in the sidebar'
            )
        );
    }
    return source.name;
}

/*
 * Makes the nodes in one write, each placed after the ones before it, with a line from the caller
 * into each. Every node is checked before the lock and again under it before anything is written, so
 * a refusal of one makes none.
 */
async function createNodes(call: ServerActionCall, viewId: string, specs: readonly NodeSpec[], counted: boolean): Promise<ActionOutput<'node.createMany'>> {
    const { actor, context, dryRun } = call;
    const { host, place } = context;
    const checked: Checked[] = [];
    for (const [index, spec] of specs.entries()) {
        checked.push(await forNode(counted ? index : null, () => checkNode(spec, call)));
    }
    const { output } = await host.projects.mutate<{ output: ActionOutput<'node.createMany'> }>(place.projectId, async (content) => {
        let canvas = canvasNamed(content, viewId);
        if (canvas.nodes.length + specs.length > MAX_CANVAS_NODES) {
            throw canvasFull(canvas, specs.length);
        }
        const callerEnd = lineEndOf(canvas.nodes, actor.id);
        const caller = canvas.nodes.find((node) => node.id === callerEnd) ?? null;
        let current = content;
        const made: Made[] = [];
        const owned: string[] = [];
        for (const [index, { spec, url, path, cwd, device, artifact, routine }] of checked.entries()) {
            const { kind } = spec;
            const placed = await forNode(counted ? index : null, async () => {
                const sourceName = sourceNameOf(current, spec);
                const size = host.machine.nodeSize(kind);
                const anchor = spec.beside == null ? undefined : canvas.nodes.find((node) => node.id === spec.beside);
                if (spec.beside != null && !anchor) {
                    throw refuseMissingNodes(current, [spec.beside], canvas.id, 'the new node has nothing there to stand beside', nodeLines(canvas));
                }
                const rect = anchor
                    ? placeBeside(anchor, size)
                    : spec.at != null
                      ? { x: Math.round(spec.at.x - size.w / 2), y: Math.round(spec.at.y - size.h / 2), ...size }
                      : placeFree(canvas.nodes, size, caller);
                return {
                    rect,
                    title:
                        spec.title ??
                        sourceName ??
                        artifact?.title ??
                        routine?.title ??
                        (path === undefined ? (device?.name ?? DEFAULT_TITLES[kind]) : basename(path))
                };
            });
            const id = newId(kind, current);
            const node: ProjectNode = {
                id,
                kind,
                title: placed.title,
                // A title the agent chose is not one the session may rename, the rule a person's typing follows.
                ...(spec.title === null ? {} : { titleSource: 'user' as const }),
                ...placed.rect,
                ...(spec.color == null ? {} : { accent: spec.color }),
                ...(spec.content == null ? {} : { body: spec.content }),
                ...(url === undefined ? {} : { url }),
                ...(path === undefined ? {} : { path: isInside(place.folder, path) ? storedPathOf(place.folder, path) : path }),
                ...(spec.source == null ? {} : { viewId: spec.source }),
                ...(device === undefined ? {} : { device }),
                ...(cwd === undefined ? {} : { cwd }),
                ...(artifact === undefined ? {} : { artifact: artifact.reference }),
                ...(routine === undefined ? {} : { routine: routine.id })
            };
            const edge = caller ? openingEdge(caller.id, node, current) : null;
            canvas = { ...canvas, nodes: [...canvas.nodes, node], edges: edge ? [...canvas.edges, edge] : canvas.edges };
            current = withCanvas(current, canvas);
            owned.push(id);
            made.push(
                dryRun === true
                    ? { nodeId: NEW_NODE, node: node.title, kind, edge: caller ? { edgeId: null, from: caller.id, to: NEW_NODE } : null }
                    : { nodeId: id, node: node.title, kind, edge: edge ? { edgeId: edge.id, from: edge.from, to: edge.to } : null }
            );
        }
        const output = { viewId: canvas.id, view: canvas.name, nodes: made };
        if (dryRun === true) {
            return { content: null, result: { output } };
        }
        /* Written down under the project's lock, before the nodes are on disk: who made a node is
           the whole of the rule `node delete` follows, and it may not arrive after the node does. */
        for (const nodeId of owned) {
            await host.lineage.put({ projectId: place.projectId, nodeId, openedBy: actor.id, depth: 0, agent: false });
        }
        return { content: current, result: { output } };
    });
    return output;
}

export const nodeActions: ActionHandlers<ServerActionContext> = {
    'node.list': async ({ viewId }, { actor, context }) => {
        const revision = await context.host.projects.revision(context.place.projectId);
        const content = await context.host.projects.read(context.place.projectId);
        const canvas = canvasNamed(content, viewId);
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
                    groupId: containers.get(node.id)?.id ?? null,
                    flag: flagOf(content.flags, node.id),
                    snoozedUntil: snoozedAt(context.host, node.id)
                })),
                self: canvas.nodes.some((node) => node.id === actor.id) ? actor.id : null,
                revision
            }
        };
    },
    'node.create': async (input, call) => {
        // Only `agent` starts anything, so a node an agent adds opens empty.
        if (input.command !== null || input.provider !== null) {
            throw new VerbRefusal('starts-nothing', 'node new starts no CLI and no command; ruimte-context agent is what opens an agent');
        }
        const made = await createNodes(call, input.viewId, [input], false);
        const [first] = made.nodes;
        return { output: { viewId: made.viewId, view: made.view, nodeId: first!.nodeId, node: first!.node, kind: first!.kind, edge: first!.edge } };
    },
    'node.createMany': async ({ viewId, nodes }, call) => ({ output: await createNodes(call, viewId, nodes, true) }),
    'node.rename': async ({ viewId, nodeId, name }, { context }) => {
        const { host, place } = context;
        return host.projects.mutate(place.projectId, (content) => {
            const renamed = renamedOn(content, canvasNamed(content, viewId), nodeId, name);
            const { previousName, previousSource, changed } = renamed;
            return {
                content: changed ? withCanvas(content, renamed.canvas) : null,
                result: {
                    output: { viewId, nodeId, kind: renamed.kind, previousName, name, changed },
                    ...(changed
                        ? {
                              undo: async () => {
                                  await host.projects.mutate(place.projectId, (current) => {
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
    'node.renameMany': async ({ viewId, nodes: renames }, { context }) => {
        const { host, place } = context;
        return host.projects.mutate(place.projectId, (content) => {
            let canvas = canvasNamed(content, viewId);
            const nodes: ActionOutput<'node.renameMany'>['nodes'] = [];
            for (const { nodeId, name } of renames) {
                const renamed = renamedOn(content, canvas, nodeId, name);
                canvas = renamed.canvas;
                nodes.push({ nodeId, kind: renamed.kind, previousName: renamed.previousName, name, changed: renamed.changed });
            }
            return {
                content: nodes.some((node) => node.changed) ? withCanvas(content, canvas) : null,
                result: { output: { viewId: canvas.id, nodes } }
            };
        });
    },
    'node.delete': async ({ viewId, nodeIds }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        const anyNode = host.machine.agentsDeleteAnyView;
        const ids = [...new Set(nodeIds)];
        return host.projects.mutate(place.projectId, async (content) => {
            // A node on no canvas at all is refused before the canvas is read: the CLI finds the canvas by the node.
            const canvases = content.views.filter(isCanvasView);
            for (const id of ids) {
                if (!canvases.some((view) => view.nodes.some((node) => node.id === id))) {
                    const lines = deletableLines(content, place, caller, anyNode);
                    const own = ownViewOf(content, id);
                    if (own) {
                        throw refuseOwnView(
                            own,
                            'there is no node to remove',
                            [...lines, `see\truimte-context view delete ${own.id}\tremoves a view you made, with the session it holds`],
                            id
                        );
                    }
                    throw new VerbRefusal('unknown-node', `${id} is not a node on any canvas of this project`, lines);
                }
            }
            const canvas = canvasNamed(content, viewId);
            const going = nodesNamed(content, canvas, ids, { cannot: 'there is no node to remove' });
            // A later chat of a design node lives in that node, so removing it would end the asker as well.
            const callerEnd = lineEndOf(canvas.nodes, caller.caller);
            for (const node of going) {
                if (node.id === callerEnd) {
                    throw new VerbRefusal('deletes-caller', `You are ${node.id}, so removing it would end the session asking`);
                }
                const madeBy = host.lineage.madeBy(node.id);
                if (!anyNode && madeBy !== caller.caller) {
                    throw new VerbRefusal('not-yours', `${node.id} was made by ${madeBy ?? 'a person'} and node delete only removes a node you made yourself`, [
                        `made by\t${madeBy ?? 'a person'}`,
                        `you\t${caller.caller}`,
                        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node and view; a person turns it on from the Machines pane"
                    ]);
                }
            }

            const gone = new Set(ids);

            for (const id of emptyCanvasGroupIds(canvas, gone)) {
                gone.add(id);
            }

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
                ended: node.kind === 'terminal' || isChatNode(node),
                edges: canvas.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
                members: node.kind === 'group' ? groupMembers(node, canvas.nodes).length : null
            }));
            for (const node of going) {
                // Before the write, the rule view delete follows: a shell that outlived its node would answer to nothing.
                if (node.kind === 'terminal') {
                    await host.endSession('terminal', node.id);
                }
                // A design node takes every chat it holds along.
                for (const chat of nodeChats(node)) {
                    await host.endSession('chat', chat.id);
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
        return host.projects.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const written = writtenOn(content, canvas, { nodeId, text, append }, caller, isChatView(content, caller.caller));
            return {
                content: written.output.changed ? withCanvas(content, written.canvas) : null,
                result: { output: { viewId: canvas.id, ...written.output } }
            };
        });
    },
    'node.updateMany': async ({ viewId, nodes: edits }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        const empty = edits.find((edit) => edit.append && edit.text === '');
        if (empty) {
            throw new VerbRefusal(
                'bad-arguments',
                `${empty.nodeId} has append and nothing to add, since its text is empty; leave append off to empty the note`
            );
        }
        return host.projects.mutate(place.projectId, (content) => {
            let canvas = canvasNamed(content, viewId);
            const chatView = isChatView(content, caller.caller);
            const nodes: ActionOutput<'node.updateMany'>['nodes'] = [];
            for (const edit of edits) {
                const written = writtenOn(content, canvas, edit, caller, chatView);
                canvas = written.canvas;
                nodes.push(written.output);
            }
            return {
                content: nodes.some((node) => node.changed) ? withCanvas(content, canvas) : null,
                result: { output: { viewId: canvas.id, nodes } }
            };
        });
    },
    'node.setColor': async ({ viewId, nodeId, color }, call) => {
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        return host.projects.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const chatView = isChatView(content, caller.caller);
            const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
            if (!node) {
                throw refuseMissingNodes(content, [nodeId], canvas.id, 'there is no node to color', colorableLines(canvas, caller, chatView));
            }
            // A newer Ruimte's node is written back as it was read, so a color on it would never reach the file.
            if (isUnknownNode(node)) {
                throw new VerbRefusal(
                    'unknown-node',
                    `${nodeId} is a node of a kind this machine does not know, so it cannot color it`,
                    colorableLines(canvas, caller, chatView)
                );
            }
            refuseOtherMachine(host, nodeId);
            if (!mayColor(canvas, node, caller, chatView)) {
                throw new VerbRefusal('not-linked', `${nodeId} is a node you did not make and no line joins you to it: draw that line and you can color it`, [
                    ...colorableLines(canvas, caller, chatView),
                    `see\truimte-context link new --to ${nodeId}\tdraws the line this needs`
                ]);
            }
            const patch = nodeColorPatch(node, color);
            // A note that already shows the color still changes when an old paper goes, so the file says what it shows.
            const changed = node.accent !== patch.accent || ('color' in patch && node.color !== undefined);
            const output = { viewId: canvas.id, nodeId, kind: node.kind, color, previousColor: nodeColorOf(node), changed };
            if (!changed || call.dryRun === true) {
                return { content: null, result: { output } };
            }
            const nodes = canvas.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, ...patch } : candidate));
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

        return host.projects.mutate(place.projectId, async (content) => {
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
            await host.lineage.put({ projectId: place.projectId, nodeId: id, openedBy: caller.caller, depth: 0, agent: false });
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
        return host.projects.mutate(place.projectId, (content) => {
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
