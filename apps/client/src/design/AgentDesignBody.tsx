import { ErrorBoundary, Icon, IconButton } from '@adecore/ui';
import { ArrowLeft, SwatchBook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { closeAgentDesign } from '@/design/design-agent';
import { DesignSurface } from '@/design/DesignSurface';
import { useEndpointId } from '@/state/current-endpoint';
import { useDesignChat } from '@/state/design-chat';
import { endpointKey } from '@/state/keys';

/*
 * The design of a hidden design agent in its parent chat's place: the agent's own thread beside its pages, with
 * the tools of a Design view, so a person goes on with the agent that made it. Nothing of it is written to the
 * project; the way back is the button, or Escape (`chat/workspace-keys.ts`).
 */
export function AgentDesignBody({ chatId, focused }: { chatId: string; focused: boolean }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const chatKey = endpointKey(endpointId, chatId);
    const design = useDesignChat((state) => state.agentDesigns[chatKey]);

    if (design === undefined) {
        return null;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface bg-clip-padding px-1.5">
                <IconButton icon={ArrowLeft} size="sm" label={t('design.card.back')} onClick={() => closeAgentDesign(chatKey)} />
                <Icon icon={SwatchBook} size={14} className="shrink-0 text-text-muted" />
                <span className="truncate text-sm font-medium text-text">{design.title}</span>
            </div>
            <div className="min-h-0 grow">
                <ErrorBoundary label={t('design.failed')} resetKeys={[design.agentId]}>
                    <DesignSurface
                        designId={design.agentId}
                        chatId={design.agentId}
                        folder={design.folder}
                        watched={design.watched}
                        focused={focused}
                        follow="until-picked"
                    />
                </ErrorBoundary>
            </div>
        </div>
    );
}
