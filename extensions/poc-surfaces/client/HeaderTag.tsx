export default function HeaderTag({ nodeId }: { nodeId: string }) {
    console.info(`Drawn in the header of ${nodeId}`);

    return <span style={{ color: 'var(--text-muted)' }}>POC</span>;
}
