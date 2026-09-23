import type { ActionHandlers, ActionOutput } from '@ruimte/actions';
import { EDGE_ROLES, isAgentKind, type EdgeRole, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { MAX_LINKS, ROLE_LINES, edgeLines, ownEnd } from '../canvas/links.ts';
import { newId, nodeLines } from '../canvas/nodes.ts';
import { refuseMissingNodes } from '../canvas/own-view.ts';
import { VerbRefusal, canvasNamed } from '../canvas/verb.ts';
import { verbCallOf, type ServerActionContext } from './context.ts';

type DrawnEdge = ActionOutput<'link.create'>['edges'][number];

const pickId = (edge: ProjectEdge): string => edge.id;

export const linkActions: ActionHandlers<ServerActionContext> = {
    'link.list': async ({ viewId }, { context }) => {
        const canvas = canvasNamed(await context.host.read(context.place.projectId), viewId);
        return {
            output: {
                viewId: canvas.id,
                edges: canvas.edges.map((edge) => ({ edgeId: edge.id, from: edge.from, to: edge.to, label: edge.label ?? null }))
            }
        };
    },
    'link.create': async ({ viewId, from: start, to, label, role }, call) => {
        const { host, place } = call.context;
        const targets = [...new Set(to)];
        if (targets.length > MAX_LINKS) {
            throw new VerbRefusal('too-many-links', `--to names ${targets.length} nodes and at most ${MAX_LINKS} may be linked at once`);
        }
        if (role !== null && !(EDGE_ROLES as readonly string[]).includes(role)) {
            throw new VerbRefusal('unknown-role', `${role} is not one of the ${EDGE_ROLES.length} things a line can be for`, [...ROLE_LINES]);
        }
        const edgeRole = role === null ? undefined : (role as EdgeRole);
        /* A line that reads: the role says so, or nothing was said and a line into an agent has read
           the other end since before the field existed. The only kind drawn back, and the only one
           this action calls "context" by itself. */
        const reads = edgeRole === undefined || edgeRole === 'context';

        return host.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const from = start ?? call.actor.id;
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
                    id: newId('edge', content, made.map(pickId)),
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
        const { host, place } = call.context;
        const caller = verbCallOf(call);
        const anyLine = host.agentsDeleteAnyView();
        const deletable = (edge: ProjectEdge): boolean => anyLine || (ownEnd(edge.from, caller) && ownEnd(edge.to, caller));
        return host.mutate(place.projectId, (content) => {
            const canvas = canvasNamed(content, viewId);
            const edge = canvas.edges.find((candidate) => candidate.id === edgeId);
            if (!edge) {
                throw new VerbRefusal('unknown-edge', `${edgeId} is not a line on ${canvas.id}`, edgeLines(canvas, deletable));
            }
            if (!deletable(edge)) {
                const foreign = ownEnd(edge.from, caller) ? edge.to : edge.from;
                const maker = host.madeBy(foreign) ?? 'a person';
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
            const edges = canvas.edges.filter((candidate) => candidate.id !== edgeId);
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, edges } : view)) },
                result: { output: { viewId: canvas.id, edgeId: edge.id, from: edge.from, to: edge.to, label: edge.label ?? null } }
            };
        });
    }
};
