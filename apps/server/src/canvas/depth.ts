import { VerbRefusal, type VerbCall } from './verb.ts';

/*
 * How deep a chain of agents opening agents may run. A node a person opened is depth 0, and a node
 * an agent verb opens sits one deeper than the caller. `agent` reaches depth 2, so a person's agent
 * can open a helper and that helper one more, which is a chain somebody is still watching. `team`
 * reaches depth 1, so only a node a person opened may open one: a team that could open teams is a
 * fork bomb with a token bill, sixteen agents becoming two hundred and fifty-six.
 */
export const MAX_AGENT_DEPTH = 2;
export const MAX_TEAM_DEPTH = 1;

/*
 * The agent nodes one caller may have open at a time. The canvas cap of 500 nodes is the ceiling of
 * the drawing, far past the point where a person would notice a loop; this is the narrow one, and it
 * is per caller rather than per project because a person opening agents of their own should never be
 * the one who runs out. It counts nodes that still exist, so removing them frees the count.
 */
export const MAX_OPENED_PER_CALLER = 16;

const depthLines = (mine: number): string[] => [
    `depth\tyou\t${mine}`,
    'depth\t0\ta node a person opened',
    `depth\tagent\topens up to depth ${MAX_AGENT_DEPTH}`,
    `depth\tteam\topens up to depth ${MAX_TEAM_DEPTH}`
];

export const DEPTH_LIMIT_LINES: readonly string[] = [
    `depth\tA node a person opened is depth 0 and one an agent opens is one deeper; agent opens up to depth ${MAX_AGENT_DEPTH}, team up to depth ${MAX_TEAM_DEPTH}`,
    `depth\tAt depth ${MAX_TEAM_DEPTH} you may open a single agent with agent and no team of your own; at depth ${MAX_AGENT_DEPTH} neither verb opens anything`,
    `depth\tThe daemon writes the depth down beside the node, outside the project, so a restart does not start the count over`,
    `limit\tOne caller may have ${MAX_OPENED_PER_CALLER} agent nodes open at a time; removing one frees the count`
];

/*
 * The depth the nodes this call would open land at, refusing when the chain has run far enough or
 * this caller has opened enough. `making` is how many nodes are about to be opened, so a team is
 * weighed whole rather than one role at a time.
 */
export const depthForOpening = (call: VerbCall, verb: 'agent' | 'team', making: number): number => {
    const mine = call.host.depthOf(call.caller);
    const depth = mine + 1;
    const max = verb === 'team' ? MAX_TEAM_DEPTH : MAX_AGENT_DEPTH;
    if (depth > max) {
        throw new VerbRefusal(
            'too-deep',
            `You sit at depth ${mine} and ${verb} would open agents at depth ${depth}; ${verb} opens up to depth ${max}`,
            depthLines(mine)
        );
    }
    const already = call.host.openedCount(call.caller);
    if (already + making > MAX_OPENED_PER_CALLER) {
        throw new VerbRefusal(
            'too-many-agents',
            `You have ${already} agent nodes open and this would open ${making} more; one caller may have ${MAX_OPENED_PER_CALLER} open at a time, and the count frees when a person removes them`
        );
    }
    return depth;
};
