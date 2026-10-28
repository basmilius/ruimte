import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, CodeXml, Share } from 'lucide-react';
import type { DesignPlace } from '@ruimte/contracts';
import { offerDraft } from '@adecore/agents-react/chat';
import { Button, ButtonGroup, Icon, IconButton, Tooltip } from '@adecore/ui';
import { createViewAction } from '@/actions/client-actions';
import { designVersionKey, useDesignChat } from '@/design/design-chat';
import { implementPrompt } from '@/design/design-messages';
import { useDesignFolder } from '@/design/design-places';
import { standaloneDesignPage } from '@/design/design-read';
import { saveBlob } from '@/download';
import { newRequestId } from '@/output/artifacts';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

/*
 * What a person does with a design as a whole: keep the folder as it stands as a version in Output,
 * take the page in front away as one HTML file, or start a chat that builds it into the project, its
 * brief waiting in the composer for the person to send. `compact` draws them as the icon buttons of a
 * node's header; otherwise they are the labeled buttons of the view's bar.
 */
export function DesignActions({ design, compact = false }: { design: DesignPlace; compact?: boolean }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const project = useProject((s) => s.current);
    const shown = useDesignChat((state) => state.pages[design.id] ?? null);
    const keeps = useMachineAnswers(endpointId, 'artifact.saveFolder');
    const [busy, setBusy] = useState(false);
    const { location, folder } = useDesignFolder(design);

    const run = async (work: () => Promise<void>): Promise<void> => {
        setBusy(true);
        try {
            await work();
        } catch (error) {
            useToasts.getState().show({ kind: 'error', title: t('design.failedAction'), description: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    };

    // The stage and the cards of a node write only a page their listing holds, and null once it closed or went.
    const noPage = shown === null || folder === null;

    const saveVersion = (): Promise<void> =>
        run(async () => {
            if (project === null) {
                return;
            }
            await machineTransport(endpointId).request('artifact.saveFolder', {
                projectId: project.projectId,
                path: location,
                title: design.name,
                key: designVersionKey(design.id),
                requestId: newRequestId()
            });
            useToasts.getState().show({ kind: 'success', title: t('design.actions.saved') });
        });

    const exportPage = (): Promise<void> =>
        run(async () => {
            if (folder === null || shown === null) {
                return;
            }
            const html = await standaloneDesignPage(endpointId, folder, shown);
            await saveBlob(new Blob([html], { type: 'text/html' }), shown, 'text/html');
        });

    const implement = (): Promise<void> =>
        run(async () => {
            if (shown === null) {
                return;
            }
            const provider = design.chats[0]?.node.provider;
            const chatId = await createViewAction('chat', provider === undefined ? {} : { provider });
            if (chatId !== null) {
                offerDraft(chatId, implementPrompt(location, shown));
            }
        });

    const saveLabel = keeps ? t('design.actions.saveVersionHint') : t('design.actions.olderMachine');

    if (compact) {
        return (
            <ButtonGroup render={<span />}>
                <IconButton icon={BookmarkPlus} size="sm" label={saveLabel} disabled={!keeps || busy} onClick={() => void saveVersion()} />
                <IconButton icon={Share} size="sm" label={t('design.actions.exportHint')} disabled={busy || noPage} onClick={() => void exportPage()} />
                <IconButton icon={CodeXml} size="sm" label={t('design.actions.implementHint')} disabled={busy || noPage} onClick={() => void implement()} />
            </ButtonGroup>
        );
    }

    return (
        <div className="ml-auto flex shrink-0 items-center gap-1">
            <Tooltip label={saveLabel}>
                <Button variant="ghost" size="sm" aria-disabled={!keeps || busy} onClick={() => keeps && !busy && void saveVersion()}>
                    <Icon icon={BookmarkPlus} size={14} />
                    {t('design.actions.saveVersion')}
                </Button>
            </Tooltip>
            <Tooltip label={t('design.actions.exportHint')}>
                <Button variant="ghost" size="sm" disabled={busy || noPage} onClick={() => void exportPage()}>
                    <Icon icon={Share} size={14} />
                    {t('design.actions.export')}
                </Button>
            </Tooltip>
            <Tooltip label={t('design.actions.implementHint')}>
                <Button variant="primary" size="sm" disabled={busy || noPage} onClick={() => void implement()}>
                    <Icon icon={CodeXml} size={14} />
                    {t('design.actions.implement')}
                </Button>
            </Tooltip>
        </div>
    );
}
