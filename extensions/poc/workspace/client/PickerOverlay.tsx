export default function PickerOverlay({ params, close }: { params: { question: string }; close(result?: string): void }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{params.question}</span>
            <button type="button" onClick={() => close('The first')}>
                The first
            </button>
            <button type="button" onClick={() => close('The second')}>
                The second
            </button>
        </div>
    );
}
