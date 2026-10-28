import { useDesignOfChat } from '@/design/design-places';
import { useSettings } from '@/state/settings';

/* A design chat reads as the conversation about the design, so its tool lines never show; any other chat follows the setting. */
export function useDesignHidesToolCalls(_scopeId: string, chatId: string): boolean {
    const inDesign = useDesignOfChat(chatId) !== null;
    const setting = useSettings((s) => s.chatHideToolCalls);

    return inDesign || setting;
}
