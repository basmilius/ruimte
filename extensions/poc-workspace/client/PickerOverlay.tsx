export default function PickerOverlay({ params, close }: { params: { title: string }; close(result?: string): void }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
            <strong>{params.title}</strong>
            <button type="button" onClick={() => close('The first')}>
                The first
            </button>
            <button type="button" onClick={() => close('The second')}>
                The second
            </button>
        </div>
    );
}
