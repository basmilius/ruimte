import { createElement } from 'react';
import { useContributions } from '@/extensions/registry';

/* The cards extensions keep in view at the foot of the sidebar. Each brings its own boundary. */
export function SidebarCards() {
    const cards = useContributions((state) => state.sidebarCards);

    if (cards.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-2 px-2 pb-2">
            {cards.map((card) => (
                <section key={card.id} aria-label={card.title} className="overflow-hidden rounded-lg border border-border p-2">
                    {createElement(card.component)}
                </section>
            ))}
        </div>
    );
}
