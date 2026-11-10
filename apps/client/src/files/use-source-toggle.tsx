import { ButtonGroup } from '@adecore/ui';
import { Code, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileActions } from '@/files/file-actions';
import { FileToolbarToggle } from '@/files/FileToolbar';
import { useEndpointId } from '@/state/current-endpoint';
import { useFiles } from '@/state/files';
import { useUnsaved } from '@/state/text-drafts';

interface RenderedLabels {
    label: string;
    /* What the rendered view's button says while unsaved changes keep it shut. */
    afterSave: string;
}

/*
 * Whether a file with a rendered view (a preview, a table) shows its source, and the switch between the
 * two. The rendered view draws what is on disk, so a file with unsaved changes stays in the source until
 * they are saved, and so does a line a link asked to reveal until a person picks the rendered view again.
 */
export function useSourceToggle(path: string, icon: LucideIcon, labels: RenderedLabels): { source: boolean; toggle: ReactNode } {
    const { t } = useTranslation('panels');
    const tabKey = useFileActions()?.tabKey ?? null;
    const reveal = useFiles((state) => (state.revealLine?.key === tabKey ? state.revealLine : null));
    const [dismissedReveal, setDismissedReveal] = useState<number | null>(null);
    const [chosen, setChosen] = useState(false);
    const unsaved = useUnsaved(useEndpointId(), path);
    const source = unsaved || (reveal !== null && reveal.nonce !== dismissedReveal) || chosen;

    const toggle = (
        <ButtonGroup>
            <FileToolbarToggle
                icon={icon}
                label={unsaved ? labels.afterSave : labels.label}
                active={!source}
                disabled={unsaved}
                onClick={() => {
                    setDismissedReveal(reveal?.nonce ?? null);
                    setChosen(false);
                }}
            />
            <FileToolbarToggle icon={Code} label={t('file.view.source')} active={source} onClick={() => setChosen(true)} />
        </ButtonGroup>
    );

    return { source, toggle };
}
