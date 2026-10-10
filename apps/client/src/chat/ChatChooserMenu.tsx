import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { useProviders } from '@adecore/agents-react/state/providers';
import { ContextMenu, Kbd } from '@adecore/ui';
import { availableAgents } from '@/agents/creation';
import { useChatChooser, useChooserSections, type ChooserChat } from '@/chat/chat-chooser';
import { linkedChatsOfNode, sendToChat, startLinkedChatOrTell, type SelectionOffer } from '@/chat/selection-to-chat';

function ChatRows({
    chats,
    providerName,
    onPick
}: {
    chats: readonly ChooserChat[];
    providerName(kind: ChooserChat['provider']): string | null;
    onPick(chatId: string): void;
}) {
    return (
        <>
            {chats.map((chat) => (
                <ContextMenu.Item key={chat.id} onClick={() => onPick(chat.id)}>
                    {chat.provider !== null && <AgentIcon kind={chat.provider} />}
                    <span className="min-w-0 truncate">{chat.title}</span>
                    <ContextMenu.Hint>{providerName(chat.provider)}</ContextMenu.Hint>
                </ContextMenu.Item>
            ))}
        </>
    );
}

/*
 * Which chat gets a block of text: the ones linked to where it came from, the ones in sight, the rest of
 * the project, and a new chat per agent the app offers. A pick only fills the prompt; nothing is sent.
 */
function ChooserMenu({ offer, x, y }: { offer: SelectionOffer; x: number; y: number }) {
    const { t } = useTranslation('chat');
    const providers = useProviders((s) => s.providers);
    const trigger = useRef<HTMLDivElement>(null);
    const picked = useRef(false);
    const linkedIds = useMemo(() => ('nodeId' in offer.source ? linkedChatsOfNode(offer.source.nodeId) : []), [offer]);
    const sections = useChooserSections(linkedIds);
    const agents = availableAgents(providers, 'chat');
    const providerName = (kind: ChooserChat['provider']): string | null =>
        kind === null ? null : (providers.find((entry) => entry.kind === kind)?.name ?? null);
    const groups = [
        { id: 'linked', title: t('selection.linked'), chats: sections.linked },
        { id: 'here', title: t('selection.here'), chats: sections.here },
        { id: 'others', title: t('selection.others'), chats: sections.others }
    ].filter((group) => group.chats.length > 0);

    useEffect(() => {
        trigger.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }));
    }, [x, y]);

    return (
        <ContextMenu.Root
            onOpenChange={(open) => {
                if (!open) {
                    useChatChooser.getState().close();
                    // A pick brings its chat into focus; a dismissal gives the keyboard back to the text.
                    if (!picked.current) {
                        offer.returnFocus?.();
                    }
                }
            }}
        >
            <ContextMenu.Trigger ref={trigger} className="fixed top-0 left-0 h-0 w-0" aria-hidden />
            {/* A pick moves the keyboard to its chat, so the menu must not take it back to the trigger. */}
            <ContextMenu.Popup className="min-w-64" finalFocus={false}>
                <ContextMenu.Label className="flex items-center justify-between gap-6 font-medium text-text">
                    {t('selection.title')}
                    {offer.shortcut !== undefined && <Kbd shortcut={offer.shortcut} />}
                </ContextMenu.Label>
                {groups.map((group) => (
                    <ContextMenu.Group key={group.id}>
                        <ContextMenu.GroupLabel>{group.title}</ContextMenu.GroupLabel>
                        <ChatRows
                            chats={group.chats}
                            providerName={providerName}
                            onPick={(chatId) => {
                                picked.current = true;
                                sendToChat(chatId, offer.block);
                            }}
                        />
                    </ContextMenu.Group>
                ))}
                {agents.length > 0 && (
                    <>
                        {groups.length > 0 && <ContextMenu.Separator />}
                        {agents.map((provider) => (
                            <ContextMenu.Item
                                key={provider.kind}
                                onClick={() => {
                                    picked.current = true;
                                    void startLinkedChatOrTell(offer, provider.kind);
                                }}
                            >
                                <Plus size={14} /> {t('selection.newWith', { provider: provider.name })}
                            </ContextMenu.Item>
                        ))}
                    </>
                )}
                <ContextMenu.Separator />
                <div className="px-2.5 py-1 text-xs text-text-faint">{t('selection.note', { label: offer.label })}</div>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* The one chooser of the window, opened by `offerSelection` from wherever the text was selected. */
export function ChatChooserMenu() {
    const request = useChatChooser((s) => s.request);
    return request === null ? null : <ChooserMenu key={`${request.x},${request.y}`} offer={request.offer} x={request.x} y={request.y} />;
}
