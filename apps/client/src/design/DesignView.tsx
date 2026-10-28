import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SwatchBook } from 'lucide-react';
import { designFolderOf, resolveStoredPath, type ProjectDesignView } from '@ruimte/contracts';
import { ColumnResizeHandle, EmptyState, ErrorBoundary, useColumnResize, useMeasuredWidth } from '@adecore/ui';
import { activeDesignChat, useDesignChat } from '@/design/design-chat';
import { DesignStage } from '@/design/DesignStage';
import { ChatBody } from '@/nodes/ChatBody';
import { useDocument } from '@/state/document';
import { shownFolderOf, useProject } from '@/state/project';

const CHAT_WIDTH = 400;
const CHAT_MIN_WIDTH = 320;

/* A design: the chat that works on it, and beside it the pages of its folder on a stage. */
export function DesignView({ view, focused }: { view: ProjectDesignView; focused: boolean }) {
    const { t } = useTranslation('shell');
    const projectFolder = useProject((s) => shownFolderOf(s.current));
    const shared = useDocument((s) => s.shared.includes(view.id));
    const location = designFolderOf(view, shared);
    const folder = resolveStoredPath(projectFolder, location);
    const picked = useDesignChat((state) => state.picked);
    const chatId = activeDesignChat(view, picked);
    const row = useRef<HTMLDivElement | null>(null);
    const chat = useRef<HTMLDivElement>(null);
    const [measure, rowWidth] = useMeasuredWidth();
    const [chatWidth, setChatWidth] = useState(CHAT_WIDTH);
    // The chat takes at most half of the view, also when the view narrows after a drag.
    const half = (): number => Math.floor((row.current?.clientWidth ?? 0) / 2);
    const shownWidth = rowWidth > 0 ? Math.max(CHAT_MIN_WIDTH, Math.min(chatWidth, Math.floor(rowWidth / 2))) : chatWidth;
    const { startResize } = useColumnResize(chat, { size: shownWidth, min: CHAT_MIN_WIDTH, max: half, from: 'left', onSize: setChatWidth });

    const setRow = (node: HTMLDivElement | null): void => {
        row.current = node;
        measure(node);
    };

    return (
        <div ref={setRow} className="flex h-full min-h-0">
            <div
                ref={chat}
                className="group/chat relative flex shrink-0 flex-col border-r border-border bg-surface bg-clip-padding"
                style={{ width: shownWidth }}
            >
                {/* Keyed on the chat, so every chat gets a thread of its own; their picker stands at the top of the composer. */}
                <ChatBody key={chatId} id={chatId} focused={focused} />
                {/* The line over the border lights up under the pointer and while dragging, like a divider of the window's split. */}
                <ColumnResizeHandle
                    from="left"
                    className="after:absolute after:inset-y-0 after:right-0 after:w-0.5 hover:after:bg-accent group-data-resizing/chat:after:bg-accent"
                    onPointerDown={startResize}
                />
            </div>
            {/* The ground of a canvas, which a board takes over too: the page reads its background from what lies behind its frame. */}
            <div className="relative flex min-w-0 grow flex-col bg-canvas-bg">
                <ErrorBoundary label={t('design.failed')} resetKeys={[view.id, folder]}>
                    {folder === null ? (
                        <EmptyState icon={SwatchBook} className="grow">
                            {t('design.noFolder')}
                        </EmptyState>
                    ) : (
                        <DesignStage view={view} chatId={chatId} folder={folder} location={location} watched={projectFolder ?? folder} />
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
}
