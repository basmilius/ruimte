import { useNodeData } from '@ruimte/extension/client';
import { Button } from '@ruimte/extension/ui';
import { nextColumn, type CardData } from './board';

export default function CardNode() {
    const [card, setCard] = useNodeData<CardData>();

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 12 }}>
            <strong>{card.title}</strong>
            <span style={{ color: 'var(--text-muted)' }}>{card.points === 1 ? '1 point' : `${card.points} points`}</span>
            <Button onClick={() => setCard({ ...card, column: nextColumn(card.column) })}>{card.column}</Button>
        </div>
    );
}
