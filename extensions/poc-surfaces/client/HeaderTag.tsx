import type { NodeInfo } from '@ruimte/extension/client';

export default function HeaderTag({ context }: { context: { node: NodeInfo } }) {
    console.info(`Drawn in the header of ${context.node.title}`);

    return <span style={{ color: 'var(--text-muted)' }}>POC</span>;
}
