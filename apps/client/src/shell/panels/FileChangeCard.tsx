import type { Editor } from '@adecore/editor';
import { ChangePreviewCard } from './ChangePreviewCard';
import { useChangePreview } from './use-change-preview';
import { ProvenanceCard } from '@/editor-ai/ProvenanceCard';
import type { AgentHover } from '@/editor-ai/agent-changes';

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
    const changes = useChangePreview(editor, base, path);
    if (editor !== null && changes.preview !== null) {
        return (
            <ChangePreviewCard
                key={changes.preview.key}
                preview={changes.preview}
                editor={editor}
                plain={plain}
                readOnly={readOnly}
                attribution={attribution}
                onHold={changes.hold}
                onRevert={changes.revert}
            />
        );
    }
    return attribution === null ? null : <ProvenanceCard hover={attribution} onHold={onAttributionHold} />;
}
