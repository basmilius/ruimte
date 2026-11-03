import { MAX_OPENED_PER_CALLER } from '@ruimte/actions';
import { ToolRefusal } from '@adecore/agents/context';
import { type AgentCall } from './host.ts';

// Teams stop at depth 1 to prevent exponential fan-out; single helpers may reach depth 2.
export const MAX_AGENT_DEPTH = 2;
export const MAX_TEAM_DEPTH = 1;

export { MAX_OPENED_PER_CALLER } from '@ruimte/actions';

function depthLines(mine: number): string[] {
    return [
        `depth\tyou\t${mine}`,
        'depth\t0\ta node a person opened',
        `depth\tagent_start\topens up to depth ${MAX_AGENT_DEPTH}`,
        `depth\tagent_team\topens up to depth ${MAX_TEAM_DEPTH}`
    ];
}

/*
 * The depth the nodes this call would open land at, refusing when the chain has run far enough or
 * this caller has opened enough. `making` is how many nodes are about to be opened, so a team is
 * weighed whole rather than one role at a time.
 */
export function depthForOpening(call: AgentCall, tool: 'agent_start' | 'agent_team', making: number): number {
    const mine = call.host.lineage.depthOf(call.caller);
    const depth = mine + 1;
    const max = tool === 'agent_team' ? MAX_TEAM_DEPTH : MAX_AGENT_DEPTH;
    if (depth > max) {
        throw new ToolRefusal(
            'too-deep',
            `You sit at depth ${mine} and ${tool} would open agents at depth ${depth}; ${tool} opens up to depth ${max}`,
            depthLines(mine)
        );
    }
    const already = call.host.starts.openedCount(call.caller);
    if (already + making > MAX_OPENED_PER_CALLER) {
        throw new ToolRefusal(
            'too-many-agents',
            `You have ${already} agents open and this would open ${making} more; one caller may have ${MAX_OPENED_PER_CALLER} open at a time. Removing a canvas node or finishing a hidden agent frees the count`
        );
    }
    return depth;
}
