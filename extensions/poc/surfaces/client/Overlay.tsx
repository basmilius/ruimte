export default function Overlay() {
    return (
        <div
            style={{
                position: 'absolute',
                left: 16,
                bottom: 16,
                padding: '4px 8px',
                borderRadius: 8,
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                pointerEvents: 'none'
            }}
        >
            POC overlay
        </div>
    );
}
