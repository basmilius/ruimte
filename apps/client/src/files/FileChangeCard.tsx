import type { Editor } from '@adecore/editor';
import { ErrorBoundary } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import type { AgentHover } from '@/editor-ai/agent-changes';
import { ProvenanceCard } from '@/editor-ai/ProvenanceCard';
import { ChangePreviewCard } from './ChangePreviewCard';
import { useChangePreview } from './use-change-preview';

export function FileChangeCard({
    editor,
    base,
    path,
    plain,
    readOnly,
    attribution,
    onAttributionHold
}: {
    editor: Editor | null;
    base: string | null;
    path: string;
    plain: boolean;
    readOnly: string | null;
    attribution: AgentHover | null;
    onAttributionHold(inside: boolean): void;
}) {
    const { t } = useTranslation('panels');
    const changes = useChangePreview(editor, base, path);
    if (editor !== null && changes.preview !== null) {
        const author =
            changes.preview.after.length === 0 ||
            attribution === null ||
            attribution.startLine > changes.preview.line ||
            attribution.endLine < changes.preview.line
                ? null
                : attribution;
        return (
            <ErrorBoundary compact className="fixed top-3 right-3 z-(--z-popup) max-w-80" label={t('file.edit.failed')} resetKeys={[changes.preview.key]}>
                <ChangePreviewCard
                    key={changes.preview.key}
                    preview={changes.preview}
                    editor={editor}
                    plain={plain}
                    readOnly={readOnly}
                    attribution={author}
                    onHold={changes.hold}
                    onRevert={changes.revert}
                />
            </ErrorBoundary>
        );
    }
    return attribution === null ? null : (
        <ErrorBoundary compact className="fixed top-3 right-3 z-(--z-popup) max-w-80" label={t('file.edit.failed')} resetKeys={[attribution.run.id]}>
            <ProvenanceCard hover={attribution} onHold={onAttributionHold} />
        </ErrorBoundary>
    );
}
