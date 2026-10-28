import { useTranslation } from 'react-i18next';
import { MessageSquare, Plus } from 'lucide-react';
import { chatHostOf, isDesignView, viewChats, type ProjectDesignView, type ViewChat } from '@ruimte/contracts';
import type { ComposerHeaderSlotProps } from '@adecore/agents-react';
import { Icon, ProjectSwitcher, type ProjectSwitcherItem } from '@adecore/ui';
import { ChatAgentMenu } from '@/agents/AgentMenus';
import { addDesignChat } from '@/agents/nodes';
import { useDesignChat } from '@/design/design-chat';
import { useDocument } from '@/state/document';

function itemOf(chat: ViewChat): ProjectSwitcherItem {
    return { id: chat.id, name: chat.name, icon: <Icon icon={MessageSquare} size={14} className="shrink-0 text-text-muted" /> };
}

/*
 * The chats of a design at the top of its composer, picked like the pages over the canvas: every one,
 * the oldest first, so an earlier conversation stays one pick away, and a new one on any CLI. A new
 * chat comes into view, since a design shows its newest. The composer of any other chat draws nothing.
 */
export function DesignComposerHeader({ chatId }: ComposerHeaderSlotProps) {
    const views = useDocument((s) => s.views);
    const host = chatHostOf(views, chatId);

    return host !== null && isDesignView(host.view) ? <DesignChats view={host.view} active={chatId} /> : null;
}

function DesignChats({ view, active }: { view: ProjectDesignView; active: string }) {
    const { t } = useTranslation('shell');
    const pick = useDesignChat((state) => state.pick);
    const chats = viewChats(view);
    const shown = chats.find((chat) => chat.id === active) ?? chats.at(-1)!;

    return (
        <div data-composer-action className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-1.5 py-1 text-xs">
            <ProjectSwitcher
                className="h-7 min-w-0 px-2"
                label={t('design.chats.label')}
                current={itemOf(shown)}
                projects={chats.map(itemOf)}
                onSelect={(chat) => pick(view.id, chat.id)}
            />
            <ChatAgentMenu
                label={t('design.chats.new')}
                icon={Plus}
                onPick={(provider, account) => {
                    const chatId = addDesignChat(view.id, provider, chats.length, account === undefined ? {} : { account });
                    if (chatId !== null) {
                        pick(view.id, chatId);
                    }
                }}
            />
        </div>
    );
}
