import type { ChatAssistantItem } from '@ruimte/contracts';
import { uiFallbackText } from '@adecore/intelligent-ui/text';

/* A reply as text, with each UI block replaced by its readable fallback (the frozen one where its live data was read). */
export function readableAssistantText(item: ChatAssistantItem): string {
    return uiFallbackText(
        item.text,
        (item.ui ?? []).map((block) => {
            const frozen = item.uiQueries?.blocks[block.id];
            return frozen && frozen.revision === block.revision ? { ...block, fallback: frozen.fallback } : block;
        })
    );
}
