import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The bar above every file renderer: what the file is on the left, the controls that change how it is
 * drawn on the right. One component for all three renderers, so a control keeps its place when the
 * open file changes type.
 */
export function FileToolbar({ label, children }: { label?: string; children?: ReactNode }) {
    return (
        <div className="file-toolbar">
            {label !== undefined && <span className="file-toolbar-label">{label}</span>}
            <span className="grow" />
            {children}
        </div>
    );
}

interface FileToolbarToggleProps {
    icon: LucideIcon;
    /* Also the button's accessible name, since the glyph carries no words of its own. */
    label: string;
    active: boolean;
    onClick: () => void;
}

/* One control in the bar. `aria-pressed` is both the state a screen reader reads and what draws the
   pressed gray key, the same style `data-active` gets in `styles.css`. */
export function FileToolbarToggle({ icon, label, active, onClick }: FileToolbarToggleProps) {
    return (
        <Tooltip label={label} name>
            <button className="icon-btn h-7 w-7" aria-pressed={active} onClick={onClick}>
                <Icon icon={icon} size={14} />
            </button>
        </Tooltip>
    );
}
