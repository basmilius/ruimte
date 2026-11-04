import { describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { groupMemberIds } from '@ruimte/contracts/node-defaults';
import { box, canvasFixture, canvasOnDisk, invoke, madeId, nodeOnDisk, seed } from './canvas-test-fixture.ts';

canvasFixture();

/*
 * Groups as 0.29 wrote them: `room` is open around the caller `term-1` and names no members, `shelf` is
 * collapsed and names the one it hides.
 */
const room = box('room', -400, -400, { kind: 'group', w: 4000, h: 3000 });
const shelf = box('shelf', 8000, 0, { kind: 'group', w: 800, h: 40, collapsed: true, expandedHeight: 600, memberIds: ['kept'] });
const kept = box('kept', 8100, 100);
const loose = box('loose', 1200, 400);

/* Every id a group holds, through the groups inside it, as both the daemon and the client read it. */
function heldBy(canvas: ProjectCanvasView, id: string): string[] {
    const items = [...canvas.nodes, ...canvas.texts];
    const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
    const held = new Set<string>();

    const visit = (groupId: string): void => {
        const group = byId.get(groupId);

        if (group?.kind !== 'group') {
            return;
        }

        for (const member of groupMemberIds(group, items)) {
            if (member !== id && !held.has(member)) {
                held.add(member);
                visit(member);
            }
        }
    };

    visit(id);

    return [...held].sort();
}

async function seedFromOlderRuimte(...extra: ProjectNode[]): Promise<ProjectCanvasView> {
    await seed(room, loose, shelf, kept, ...extra);

    return canvasOnDisk();
}

describe('a project an older Ruimte wrote', () => {
    test('node group inside an open group that names no members leaves that group reading them off its frame', async () => {
        const before = await seedFromOlderRuimte(box('other', 1600, 400));

        const id = await madeId(invoke('node_group', { nodes: 'loose,other' }));
        const after = await canvasOnDisk();

        expect((await nodeOnDisk('room'))!.memberIds).toBeUndefined();
        expect((await nodeOnDisk(id))!.memberIds).toEqual(['loose', 'other']);
        expect(heldBy(after, 'room')).toEqual([...heldBy(before, 'room'), id].sort());
        expect(heldBy(after, 'shelf')).toEqual(['kept']);
    });

    test('agent start beside its opener stands in the open group the opener stands in, without writing it out', async () => {
        const before = await seedFromOlderRuimte();

        const id = await madeId(invoke('agent_start', { cli: 'claude', beside: 'term-1' }));
        const after = await canvasOnDisk();

        expect((await nodeOnDisk('room'))!.memberIds).toBeUndefined();
        expect(heldBy(after, 'room')).toEqual([...heldBy(before, 'room'), id].sort());
        expect(heldBy(after, 'shelf')).toEqual(['kept']);
    });

    test('a team started beside its opener goes clear of the open group, which keeps what it held, and holds only its agents', async () => {
        const before = await seedFromOlderRuimte();
        const roles = [
            { provider: 'claude', title: 'One', prompt: 'a' },
            { provider: 'claude', title: 'Two', prompt: 'b' }
        ];

        const { lines } = await invoke('agent_team', { label: 'Crew', roles: JSON.stringify(roles) });
        const after = await canvasOnDisk();
        const team = after.nodes.find((node) => node.kind === 'group' && node.title === 'Crew')!;
        const agents = after.nodes.filter((node) => !before.nodes.some((known) => known.id === node.id) && node.id !== team.id).map((node) => node.id);

        expect(lines[0]).not.toStartWith('refused');
        expect(team.memberIds).toEqual(agents);
        expect((await nodeOnDisk('room'))!.memberIds).toBeUndefined();
        expect(heldBy(after, 'room')).toEqual(heldBy(before, 'room'));
        expect(heldBy(after, 'shelf')).toEqual(['kept']);
        expect(heldBy(after, team.id)).toEqual([...agents].sort());
    });
});
