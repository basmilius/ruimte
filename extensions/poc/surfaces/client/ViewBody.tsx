export default function ViewBody({ params }: { params: unknown }) {
    return <pre style={{ padding: 16 }}>params: {JSON.stringify(params)}</pre>;
}
