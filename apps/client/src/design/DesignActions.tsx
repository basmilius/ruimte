import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, CodeXml, Share } from 'lucide-react';
import { designFolderOf, resolveStoredPath, type ProjectDesignView } from '@ruimte/contracts';
import { offerDraft } from '@adecore/agents-react/chat';
import { Button, Icon, Tooltip } from '@adecore/ui';
import { createViewAction } from '@/actions/client-actions';
import { designVersionKey, useDesignChat } from '@/design/design-chat';
import { implementPrompt } from '@/design/design-messages';
import { listDesignFiles, standaloneDesignPage } from '@/design/design-read';
import { saveBlob } from '@/download';
import { newRequestId } from '@/output/artifacts';
import { useDocument } from '@/state/document';
import { useEndpointId } from '@/state/keys';
import { shownFolderOf, useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { useMachineAnswers } from '@/transport/features';

/*
 * What a person does with a design as a whole, in the bar of its view: keep the folder as it stands as a
 * version in Output, take the page in front away as one HTML file, or start a chat that builds it into
 * the project, its brief waiting in the composer for the person to send.
 */
export function DesignActions({ view }: { view: ProjectDesignView }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const project = useProject((s) => s.current);
    const shown = useDesignChat((state) => state.pages[view.id] ?? null);
    const keeps = useMachineAnswers(endpointId, 'artifact.saveFolder');
    const [busy, setBusy] = useState(false);
    const shared = useDocument((s) => s.shared.includes(view.id));
    const location = designFolderOf(view, shared);
    const folder = resolveStoredPath(shownFolderOf(project), location);

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

    // The page in front, or the first one before the stage showed any.
    const page = async (): Promise<string | null> => shown ?? (folder === null ? null : ((await listDesignFiles(endpointId, folder))?.[0] ?? null));

    const saveVersion = (): Promise<void> =>
        run(async () => {
            if (project === null) {
                return;
            }
            await machineTransport(endpointId).request('artifact.saveFolder', {
                projectId: project.projectId,
                path: location,
                title: view.name,
                key: designVersionKey(view.id),
                requestId: newRequestId()
            });
            useToasts.getState().show({ kind: 'success', title: t('design.actions.saved') });
        });

    const exportPage = (): Promise<void> =>
        run(async () => {
            const file = await page();
            if (folder === null || file === null) {
                return;
            }
            const html = await standaloneDesignPage(endpointId, folder, file);
            await saveBlob(new Blob([html], { type: 'text/html' }), file, 'text/html');
        });

    const implement = (): Promise<void> =>
        run(async () => {
            const file = await page();
            const chatId = await createViewAction('chat', view.node.provider === undefined ? {} : { provider: view.node.provider });
            if (chatId !== null && file !== null) {
                offerDraft(chatId, implementPrompt(location, file));
            }
        });

    return (
        <div className="ml-auto flex shrink-0 items-center gap-1">
            <Tooltip label={keeps ? t('design.actions.saveVersionHint') : t('design.actions.olderMachine')}>
                <Button variant="ghost" size="sm" aria-disabled={!keeps || busy} onClick={() => keeps && !busy && void saveVersion()}>
                    <Icon icon={BookmarkPlus} size={14} />
                    {t('design.actions.saveVersion')}
                </Button>
            </Tooltip>
            <Tooltip label={t('design.actions.exportHint')}>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void exportPage()}>
                    <Icon icon={Share} size={14} />
                    {t('design.actions.export')}
                </Button>
            </Tooltip>
            <Tooltip label={t('design.actions.implementHint')}>
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void implement()}>
                    <Icon icon={CodeXml} size={14} />
                    {t('design.actions.implement')}
                </Button>
            </Tooltip>
        </div>
    );
}
