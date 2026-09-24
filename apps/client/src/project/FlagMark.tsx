import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { flagOf, isFlagColor } from '@ruimte/contracts';
import { accentColor, accentLabel } from '@/canvas/accents';
import { useDocument } from '@/state/document';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* The flag a person put on a view or a node, in its own color; nothing for none, or for a color a newer Ruimte picked. */
export function FlagMark({ color }: { color: string | null | undefined }) {
    const { t } = useTranslation('project');
    if (color === null || color === undefined || !isFlagColor(color)) {
        return null;
    }
    const label = t('flag.flagged', { color: accentLabel(color) });
    return (
        <Tooltip label={label}>
            <span role="img" aria-label={label} className="flex shrink-0" style={{ color: accentColor(color) }}>
                <Icon icon={Flag} size={12} className="fill-current" />
            </span>
        </Tooltip>
    );
}

/* The same mark for an id of the project on screen, read off the document. */
export function FlagMarkOf({ id }: { id: string }) {
    const color = useDocument((state) => flagOf(state.flags, id));
    return <FlagMark color={color} />;
}
