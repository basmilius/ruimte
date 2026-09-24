import { useMemo } from 'react';
import { projectChats, type ProjectChat } from '@/chat/chat-references';
import { useSidebarSource } from '@/shell/sidebar-source';

/* The chats of the open project, renamed the moment a node on a live canvas is. */
export const useProjectChats = (): ProjectChat[] => {
    const source = useSidebarSource();
    return useMemo(() => projectChats(source), [source]);
};
