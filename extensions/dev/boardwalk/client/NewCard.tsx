import { Button } from '@ruimte/extension/ui';
import { useState } from 'react';
import { COLUMNS, NEW_CARD, type CardData } from './board';

export default function NewCard({ params, close }: { params: { after: string | null }; close(answer?: CardData): void }) {
    const [title, setTitle] = useState('');
    const [column, setColumn] = useState<string>(COLUMNS[0]);

    return (
        <form
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            onSubmit={(e) => {
                e.preventDefault();
                close({ ...NEW_CARD, title: title.trim() === '' ? NEW_CARD.title : title.trim(), column });
            }}
        >
            {params.after !== null && <span style={{ color: 'var(--text-muted)' }}>Follows {params.after}</span>}
            <input aria-label="Title" placeholder="Title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
            <select aria-label="Column" value={column} onChange={(e) => setColumn(e.target.value)}>
                {COLUMNS.map((name) => (
                    <option key={name} value={name}>
                        {name}
                    </option>
                ))}
            </select>
            <Button type="submit">Add the card</Button>
        </form>
    );
}
