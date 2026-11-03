export default function ReadResult({ call }: { call: { name: string; input: unknown; output: string | null; state: string } }) {
    return (
        <div style={{ padding: 8, border: '1px solid var(--accent)', borderRadius: 8 }}>
            Drawn by an extension: {call.name}, {call.state}, {(call.output ?? '').length} characters of output for {JSON.stringify(call.input)}
        </div>
    );
}
