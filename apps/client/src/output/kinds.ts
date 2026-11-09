import { chatNameOf, type KnownArtifactKind, type ProjectView } from '@ruimte/contracts';
import { AppWindow, Box, FileText, Image, Sheet, Video, type LucideIcon } from 'lucide-react';
import { drawnKind } from '@/output/artifact-list';
import { revealNode, showView } from '@/project/views';
import { useDocument } from '@/state/document';
import { nodesOfView } from '@/state/view-nodes';

const KIND_ICONS: Record<KnownArtifactKind, LucideIcon> = {
    report: FileText,
    image: Image,
    build: Box,
    export: Sheet,
    recording: Video,
    page: AppWindow
};

export function kindIcon(kind: string): LucideIcon {
    return KIND_ICONS[drawnKind(kind)];
}

function chatNameIn(views: readonly ProjectView[], chatId: string): string | null {
    for (const view of views) {
        if (view.id === chatId) {
            return view.name ?? '';
        }
        const node = nodesOfView(view).find((candidate) => candidate.id === chatId);
        if (node !== undefined) {
            return node.title;
        }
    }
    // A later chat of a design is no node and no view of its own.
    return chatNameOf(views, chatId);
}

export function useChatName(chatId: string | undefined): string | null {
    return useDocument((s) => (chatId === undefined ? null : chatNameIn(s.views, chatId)));
}

export function showChat(chatId: string): void {
    if (useDocument.getState().views.some((view) => view.id === chatId)) {
        showView(chatId);
        return;
    }
    revealNode(chatId);
}
