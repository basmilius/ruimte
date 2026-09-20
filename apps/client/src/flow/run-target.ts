import type { FlowContent } from '@ruimte/contracts';
import { isTriggerCard } from '@ruimte/flow';

/*
 * Which card running the flow by hand begins at. A run always begins at a card a trigger could have
 * fired, so this never invents one: it takes the trigger a person picked, and with nothing picked it
 * takes the only trigger there is. With several and none picked there is no answer, and the button
 * says so rather than guessing which branch a person meant.
 */
export const runTarget = (content: FlowContent, selection: readonly string[]): string | null => {
    const picked = selection.filter((id) => {
        const card = content.cards[id];
        return card !== undefined && isTriggerCard(card);
    });
    if (picked.length === 1) {
        return picked[0] as string;
    }
    if (picked.length > 1) {
        return null;
    }
    const triggers = Object.keys(content.cards).filter((id) => isTriggerCard(content.cards[id]!));
    return triggers.length === 1 ? (triggers[0] as string) : null;
};
