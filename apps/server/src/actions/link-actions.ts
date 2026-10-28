import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { EDGE_ROLES, isAgentKind, lineEndOf, type EdgeRole, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { MAX_LINKS, ROLE_LINES, edgeLines, ownEnd } from '../canvas/links.ts';
import { newId, nodeLines } from '../canvas/nodes.ts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { VerbRefusal, canvasNamed } from '../canvas/verb.ts';
import { verbCallOf, type ServerActionCall, type ServerActionContext } from './context.ts';

type DrawnEdge = ActionOutput<'link.create'>['edges'][number];

function edgeRow(edge: ProjectEdge) {
    return { edgeId: edge.id, from: edge.from, to: edge.to, label: edge.label ?? null };
}

/*
 * Removes the lines in one write. Each is checked against the canvas as it was read, before any
 * goes, so a refusal of one removes none.
 */
async function deleteEdges(call: ServerActionCall, viewId: string, edgeIds: readonly string[]): Promise<ActionOutput<'link.deleteMany'>> {
    const { host, place } = call.context;
    const caller = verbCallOf(call);
    const anyLine = host.machine.agentsDeleteAnyView;
    const deletable = (edge: ProjectEdge): boolean => anyLine || (ownEnd(edge.from, caller) && ownEnd(edge.to, caller));
    const ids = [...new Set(edgeIds)];
    return host.projects.mutate(place.projectId, (content) => {
        const canvas = canvasNamed(content, viewId);
        const going = ids.map((edgeId) => {
            const edge = canvas.edges.find((candidate) => candidate.id === edgeId);
            if (!edge) {
                throw new VerbRefusal('unknown-edge', `${edgeId} is not a line on ${canvas.id}`, edgeLines(canvas, deletable));
            }
            if (!deletable(edge)) {
                const foreign = ownEnd(edge.from, caller) ? edge.to : edge.from;
                const maker = host.lineage.madeBy(foreign) ?? 'a person';
                throw new VerbRefusal(
                    'not-yours',
                    `${edgeId} runs ${foreign === edge.from ? 'from' : 'into'} ${foreign}, which ${maker} made, and link delete only removes a line whose ends are both yours`,
                    [
                        `made by\t${foreign}\t${maker}`,
                        `you\t${caller.caller}`,
                        "setting\tagentsDeleteAnyView in this machine's endpoint.json frees every node, view and line; a person turns it on from the Machines pane"
                    ]
                );
            }
            return edge;
        });
        const gone = new Set(ids);
        const edges = canvas.edges.filter((candidate) => !gone.has(candidate.id));
        return {
            content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges } : view)) },
            result: { viewId: canvas.id, edges: going.map(edgeRow) }
        };
    });
}

export const linkActions: ActionHandlers<ServerActionContext> = {
    'link.list': async ({ viewId }, { context }) => {
        const revision = await context.host.projects.revision(context.place.projectId);
        const canvas = canvasNamed(await context.host.projects.read(context.place.projectId), viewId);
        return {
            output: {
                viewId: canvas.id,
                edges: canvas.edges.map(edgeRow),
                revision
            }
        };
    },
    'link.create': async ({ viewId, from: start, to, label, role }, call) => {
        const { host, place } = call.context;
        const targets = [...new Set(to)];
        if (targets.length > MAX_LINKS) {
            throw new VerbRefusal('too-many-links', `--to names ${targets.length} nodes and at most ${MAX_LINKS} may be linked at once`);
        }
        if (role != null && !(EDGE_ROLES as readonly string[]).includes(role)) {
            throw new VerbRefusal('unknown-role', `${role} is not one of the ${EDGE_ROLES.length} things a line can be for`, [...ROLE_LINES]);
        }
        const edgeRole = role == null ? undefined : (role as EdgeRole);
        /* A line that reads: the role says so, or nothing was said and a line into an agent has read
           the other end since before the field existed. The only kind drawn back, and the only one
           this action calls "context" by itself. */
        const reads = edgeRole === undefined || edgeRole === 'context';

        return host.projects.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            // A later chat of a design node has no node of its own, so its line starts at the design node.
            const from = start ?? lineEndOf(canvas.nodes, call.actor.id);
            const source = canvas.nodes.find((node) => node.id === from);
            if (!source) {
                if (start === null) {
                    throw new VerbRefusal(
                        'unknown-node',
                        `You are not a node on ${canvas.id}, so a line has nowhere to start; name one with --from`,
                        nodeLines(canvas)
                    );
                }
                throw refuseMissingNodes(content, [from], canvas.id, 'a line has nowhere to start there', nodeLines(canvas));
            }
            const missing = targets.filter((id) => !canvas.nodes.some((node) => node.id === id));
            if (missing.length > 0) {
                throw refuseMissingNodes(
                    content,
                    missing,
                    canvas.id,
                    'no line can be drawn into it',
                    // Never the node the line starts from: a line into itself is refused a moment later.
                    nodeLines(canvas, {
                        takes: (node) => node.id !== from,
                        empty: `${canvas.id} holds no other node for a line to run into`
                    })
                );
            }
            if (targets.includes(from)) {
                throw new VerbRefusal('self-link', `${from} is both ends of the line; a node reads itself without one`);
            }
            for (const end of [from, ...targets]) {
                refuseOtherMachine(host, end);
            }

            const made: ProjectEdge[] = [];
            const reroled = new Map<string, ProjectEdge>();
            const drawn: DrawnEdge[] = [];
            /* `way` is what tells the two rows of one --to apart: the line that was asked for, and
               the one this action draws back by itself between two agents. */
            const draw = (tail: string, head: ProjectNode, way: 'out' | 'back'): void => {
                const already = [...canvas.edges, ...made].find((edge) => edge.from === tail && edge.to === head.id);
                if (already) {
                    /* A --role that is not the one on the line is a different line asked for, not the
                       same call run twice, so it is written rather than dropped without a word. */
                    if (edgeRole !== undefined && already.role !== edgeRole) {
                        reroled.set(already.id, { ...already, role: edgeRole });
                        drawn.push({ edgeId: already.id, from: tail, to: head.id, state: 'updated', way });
                        return;
                    }
                    drawn.push({ edgeId: already.id, from: tail, to: head.id, state: 'existing', way });
                    return;
                }
                // The label a person's own drag gives it: named only where the line means something.
                const named = label ?? (reads && isAgentKind(head.kind) ? 'context' : undefined);
                const edge: ProjectEdge = {
                    id: newId(
                        'edge',
                        content,
                        made.map((edge) => edge.id)
                    ),
                    from: tail,
                    to: head.id,
                    ...(named === undefined ? {} : { label: named }),
                    ...(edgeRole === undefined ? {} : { role: edgeRole })
                };
                made.push(edge);
                drawn.push({ edgeId: edge.id, from: tail, to: head.id, state: 'new', way });
            };

            for (const id of targets) {
                const target = canvas.nodes.find((node) => node.id === id)!;
                draw(from, target, 'out');
                /* Both ways between two agents: each of them is then something the other can read.
                   Only for a line that reads; a target or an origin means something in one direction
                   only, so the copy back would be a line that says something nobody meant. */
                if (reads && isAgentKind(source.kind) && isAgentKind(target.kind)) {
                    draw(id, source, 'back');
                }
            }
            const output = { viewId: canvas.id, edges: drawn };
            if (made.length === 0 && reroled.size === 0) {
                return { content: null, result: { output } };
            }
            const edges = [...canvas.edges.map((edge) => reroled.get(edge.id) ?? edge), ...made];
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges } : view)) },
                result: { output }
            };
        });
    },
    'link.delete': async ({ viewId, edgeId }, call) => {
        const removed = await deleteEdges(call, viewId, [edgeId]);
        return { output: { viewId: removed.viewId, ...removed.edges[0]! } };
    },
    'link.deleteMany': async ({ viewId, edgeIds }, call) => ({ output: await deleteEdges(call, viewId, edgeIds) })
};
