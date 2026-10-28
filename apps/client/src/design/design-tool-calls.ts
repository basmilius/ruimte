import { chatHostOf, isDesignView } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { useSettings } from '@/state/settings';

/* A design chat reads as the conversation about the design, so its tool lines never show; any other chat follows the setting. */
export function useDesignHidesToolCalls(_scopeId: string, chatId: string): boolean {
    const inDesign = useDocument((s) => {
        const host = chatHostOf(s.views, chatId);
        return host !== null && isDesignView(host.view);
    });
    const setting = useSettings((s) => s.chatHideToolCalls);

    return inDesign || setting;
}
