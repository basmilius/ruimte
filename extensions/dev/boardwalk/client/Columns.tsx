import type { Board } from './board';

export function Columns({ board }: { board: Board }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
            {board.name !== '' && <strong>{board.name}</strong>}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {board.columns.map((column) => (
                    <section key={column.name} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                            {column.name} ({column.cards.reduce((sum, card) => sum + card.points, 0)})
                        </span>
                        {column.cards.map((card, index) => (
                            <div key={`${card.title}${index}`} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border)' }}>
                                {card.title}
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}
