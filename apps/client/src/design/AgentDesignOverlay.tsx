import { Button, Dialog, ErrorBoundary, Icon } from '@adecore/ui';
import { SwatchBook, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentDesignDialog } from '@/design/agent-design-dialog';
import { openDesignButton } from '@/design/design-agent';
import { DesignSurface } from '@/design/DesignSurface';
import { useEndpointId } from '@/state/current-endpoint';

/*
 * The design of a hidden design agent over the window, opened from its card in a chat view or a chat node alike:
 * the agent's own thread beside its pages, with the tools of a Design view, so a person goes on with the agent that
 * made it. The thread underneath stays where it was, and nothing of this is written to the project.
 */
export function AgentDesignOverlay() {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const requested = agentDesignDialog.useRequest((request) => request);
    // The last one asked for, so the design stays drawn while the overlay closes and the focus knows its card.
    const [design, setDesign] = useState(requested);
    const open = requested !== null && requested.endpointId === endpointId;

    if (requested !== null && requested !== design) {
        setDesign(requested);
    }

    // A design another workspace opened is none of the next one's.
    useEffect(() => () => agentDesignDialog.close(), []);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && agentDesignDialog.close()}>
            <Dialog.Popup
                aria-label={design?.title}
                finalFocus={() => (design === null ? true : (openDesignButton(design.taskId) ?? true))}
                className="flex h-[calc(100dvh-80px)] w-[calc(100vw-112px)] flex-col overflow-hidden"
            >
                {design !== null && (
                    <>
                        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2 text-sm">
                            <Icon icon={SwatchBook} size={14} className="ml-1 shrink-0 text-text-muted" />
                            <h2 className="truncate font-medium text-text">{design.title}</h2>
                            <span className="grow" />
                            <Button size="sm" onClick={() => agentDesignDialog.close()}>
                                <Icon icon={X} size={14} />
                                {t('design.card.close')}
                            </Button>
                        </header>
                        <div className="min-h-0 grow">
                            <ErrorBoundary label={t('design.failed')} resetKeys={[design.agentId]}>
                                <DesignSurface
                                    designId={design.agentId}
                                    chatId={design.agentId}
                                    folder={design.folder}
                                    watched={design.watched}
                                    focused
                                    follow="until-picked"
                                    onEscape={() => agentDesignDialog.close()}
                                />
                            </ErrorBoundary>
                        </div>
                    </>
                )}
            </Dialog.Popup>
        </Dialog.Root>
    );
}
