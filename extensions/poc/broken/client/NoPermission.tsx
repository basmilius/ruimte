import { useAgents } from '@ruimte/extension/client';

export default function NoPermission() {
    return <div>{useAgents().length} agents, which this should not know</div>;
}
