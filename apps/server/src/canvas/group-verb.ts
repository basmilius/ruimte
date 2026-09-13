import { DEFAULT_TITLES, NODE_ACCENT_NAMES, groupFrame, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_CANVAS_NODES, NOT_A_GROUP, canvasFull, idList, newId, nodesNamed } from './node-verb.ts';
import { containersOf, groupMembers } from './placement.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, canvasFor, defineVerb, field, placeOf, requiredField, titleField } from './verb.ts';

/* The set is closed and short enough to print whole, unlike the sixty Lucide names a view picks from. */
const COLOR_LINES: readonly string[] = [['colors', ...NODE_ACCENT_NAMES].join('\t')];

const GROUP_DETAIL: readonly string[] = [
    'flag\t--nodes A,B\trequired\tThe nodes the frame goes around, by id, separated by commas',
    `flag\t--label L\toptional\tThe name of the group, at most ${MAX_TITLE_LENGTH} characters; without one it is called "${DEFAULT_TITLES.group}"`,
    `flag\t--color C\toptional\tThe color of the frame, one of ${NODE_ACCENT_NAMES.length}; without one the frame is drawn in the faint gray a person's own grouping gives it`,
    ...COLOR_LINES,
    'flag\t--view V\toptional\tThe canvas the nodes are on, by view id; ruimte-context views lists them',
    'prints\tid\tgroup\tlabel\tview\tmembers\tthe new group, its label, the canvas it landed on, and how many nodes stand inside the frame',
    'prints\talso\tid\tkind\ttitle\tone line per node you did not name that the frame ended up around',
    'where\tThe frame is the box your nodes already occupy, with room on every side and a title band above it, snapped to the canvas grid, which is where a person grouping a selection would have put it',
    'members\tA group holds whatever has its center inside it, so a node standing between the ones you named goes in with them; that is what the also rows are for',
    'rule\tEvery node has to stand in the same place already: all of them on the canvas itself, or all of them inside one and the same group',
    'rule\tA group is never one of --nodes; a frame is drawn around nodes, and the client leaves a group out of a selection for the same reason',
    'collapsed\tInside a group that is folded shut the new frame joins its members in the file, so it is folded away with the rest',
    `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes, this frame among them`,
    'ids\tOnly ids, never titles; ruimte-context nodes lists the nodes of a canvas with theirs',
    'see\truimte-context arrange\ttidying those nodes before you draw a frame around them',
    TITLE_LINE
];

/* Where a node stands, said in the words a refusal needs: a frame by id, or the canvas itself. */
const placeName = (container: ProjectNode | undefined): string => (container === undefined ? 'on the canvas itself' : `in group ${container.id}`);

export const groupVerb = defineVerb({
    name: 'group',
    usage: '--nodes A,B [--label L] [--color C] [--view V]',
    summary: 'Draws a frame around nodes that already stand together and prints id, group, label, view, members',
    detail: GROUP_DETAIL,
    positionals: z.tuple([], { error: 'group takes no arguments, only flags; the nodes go in --nodes' }),
    flags: z.object({
        nodes: requiredField('--nodes needs one or more node ids, separated by commas'),
        label: titleField('--label', '--label needs a name for the group').optional(),
        color: z.string().min(1, '--color needs a color').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ flags }, call) {
        const place = placeOf(call);
        const ids = idList(flags.nodes, '--nodes');
        const accent = flags.color;
        if (accent !== undefined && !(NODE_ACCENT_NAMES as readonly string[]).includes(accent)) {
            throw new VerbRefusal('unknown-color', `${accent} is not one of the ${NODE_ACCENT_NAMES.length} colors a frame takes`, [...COLOR_LINES]);
        }

        return call.host.mutate(place.projectId, async (content) => {
            const canvas = canvasFor(content, place, flags.view);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, 1);
            }
            const members = nodesNamed(canvas, ids, NOT_A_GROUP);
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
            await call.host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: call.caller, depth: 0, agent: false });
            const group: ProjectNode = {
                id,
                kind: 'group',
                title: flags.label ?? DEFAULT_TITLES.group,
                ...frame,
                ...(accent === undefined ? {} : { accent })
            };
            const inside = groupMembers(group, [...canvas.nodes, group]);
            const named = new Set(ids);
            /* A collapsed frame keeps its members in the file, so the new group has to be written into
               them: by geometry it is inside, and while the container is shut nothing reads geometry. */
            const nodes = canvas.nodes.map((node) =>
                container !== undefined && node.id === container.id && node.collapsed === true ? { ...node, memberIds: [...(node.memberIds ?? []), id] } : node
            );
            return {
                content: { ...content, views: content.views.map((view) => (view.id === canvas.id ? { ...canvas, nodes: [...nodes, group] } : view)) },
                result: [
                    [id, 'group', field(group.title), canvas.id, String(inside.length)].join('\t'),
                    ...inside.filter((node) => !named.has(node.id)).map((node) => ['also', node.id, node.kind, field(node.title)].join('\t'))
                ]
            };
        });
    }
});
