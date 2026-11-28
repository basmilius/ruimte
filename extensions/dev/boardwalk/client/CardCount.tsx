import { useNodes } from '@ruimte/extension/client';
import { CARD_NODE } from './board';

export default function CardCount() {
    const cards = useNodes((node) => node.extension?.type === CARD_NODE && !node.hidden).length;

    if (cards === 0) {
        return null;
    }

    return (
        <div
            style={{
                position: 'absolute',
                left: 16,
                bottom: 16,
                padding: '4px 8px',
                borderRadius: 8,
                background: 'var(--surface-active)',
                color: 'var(--text-muted)'
            }}
        >
            {cards === 1 ? '1 card' : `${cards} cards`}
        </div>
    );
}
