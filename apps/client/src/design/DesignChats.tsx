import { useTranslation } from 'react-i18next';
import { MessageSquare, Plus } from 'lucide-react';
import type { DesignPlace, ViewChat } from '@ruimte/contracts';
import type { ComposerHeaderSlotProps } from '@adecore/agents-react';
import { Icon, ProjectSwitcher, type ProjectSwitcherItem } from '@adecore/ui';
import { ChatAgentMenu } from '@/agents/AgentMenus';
import { addDesignChat } from '@/agents/nodes';
import { useDesignChat } from '@/design/design-chat';
import { useDesignOfChat } from '@/design/design-places';

function itemOf(chat: ViewChat): ProjectSwitcherItem {
    return { id: chat.id, name: chat.name, icon: <Icon icon={MessageSquare} size={14} className="shrink-0 text-text-muted" /> };
}

/*
 * The chats of a design at the top of its composer, picked like the pages over the canvas: every one,
 * the oldest first, so an earlier conversation stays one pick away, and a new one on any CLI. A new
 * chat comes into view, since a design shows its newest. The composer of any other chat draws nothing.
 * A composer nobody may write in only switches between the chats, since a new one would start work.
 */
export function DesignComposerHeader({ chatId, disabled, focused }: ComposerHeaderSlotProps) {
    const design = useDesignOfChat(chatId);

    return design === null ? null : <DesignChats design={design} active={chatId} disabled={disabled} focused={focused} />;
}

function DesignChats({ design, active, disabled, focused }: { design: DesignPlace; active: string; disabled: boolean; focused: boolean }) {
    const { t } = useTranslation('shell');
    const pick = useDesignChat((state) => state.pick);
    const chats = design.chats;
    const shown = chats.find((chat) => chat.id === active) ?? chats.at(-1)!;
    const tabIndex = focused ? undefined : -1;

    return (
        <div data-composer-action className="flex shrink-0 items-center justify-between gap-1 border-b border-border px-1.5 py-1 text-xs">
            <ProjectSwitcher
                tabIndex={tabIndex}
                className="h-7 min-w-0 px-2"
                label={t('design.chats.label')}
                current={itemOf(shown)}
                projects={chats.map(itemOf)}
                onSelect={(chat) => pick(design.id, chat.id)}
            />
            {!disabled && (
                <ChatAgentMenu
                    label={t('design.chats.new')}
                    icon={Plus}
                    tabIndex={tabIndex}
                    onPick={(provider, account) => {
                        const chatId = addDesignChat(design, provider, chats.length, account === undefined ? {} : { account });
                        if (chatId !== null) {
                            pick(design.id, chatId);
                        }
                    }}
                />
            )}
        </div>
    );
}
