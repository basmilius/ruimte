import { setChatHost } from '@ruimte/agents-react/host';
import { FEATURED_ACCENTS, NODE_ACCENTS, accentLabel, type AccentId } from '@/canvas/accents';

/* What the chat takes from Ruimte, handed over once before the first render. */
export const connectChatHost = (): void => {
    setChatHost({
        accents: { all: NODE_ACCENTS, featured: FEATURED_ACCENTS, label: (id) => accentLabel(id as AccentId) }
    });
};
