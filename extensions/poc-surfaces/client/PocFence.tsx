export default function PocFence({ source }: { source: string }) {
    return <div style={{ padding: 8, border: '1px solid var(--accent)', borderRadius: 8 }}>Drawn by an extension: {source}</div>;
}
