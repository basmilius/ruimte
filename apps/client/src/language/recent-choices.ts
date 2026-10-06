import type { CompletionItem } from '@adecore/lsp';
import { qualifierOf } from './completion-model';

const LIMIT = 200;

/*
 * The suggestions a person took lately, so one they use again comes first among equal matches. It lives in
 * memory only, one per language, and forgets the oldest choice past a few hundred.
 */
export class RecentChoices {
    private readonly order = new Map<string, number>();
    private tick = 0;

    /* An item is told by its label, its kind and where it comes from, so two `Property` of two namespaces are two choices. */
    static keyOf(item: CompletionItem): string {
        return `${item.label}\0${item.kind ?? ''}\0${qualifierOf(item)}`;
    }

    record(item: CompletionItem): void {
        const key = RecentChoices.keyOf(item);
        this.order.delete(key);
        this.order.set(key, ++this.tick);
        if (this.order.size > LIMIT) {
            this.order.delete(this.order.keys().next().value!);
        }
    }

    /* Higher for a later choice, 0 for an item never chosen. */
    recency(item: CompletionItem): number {
        return this.order.get(RecentChoices.keyOf(item)) ?? 0;
    }
}

const stores = new Map<string, RecentChoices>();

export function recentChoicesOf(languageId: string): RecentChoices {
    let store = stores.get(languageId);
    if (store === undefined) {
        store = new RecentChoices();
        stores.set(languageId, store);
    }
    return store;
}

/* For a test that must not hear the choices an earlier one made. */
export function forgetRecentChoices(): void {
    stores.clear();
}
