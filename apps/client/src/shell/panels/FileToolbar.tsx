import type { ReactNode } from 'react';
import { WrapText, type LucideIcon } from 'lucide-react';
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
    /* `aria-disabled` rather than `disabled`: a disabled button swallows the pointer, and with it the
       tooltip that says why the control cannot be used right now. */
    disabled?: boolean;
    onClick: () => void;
}

/* One control in the bar. `aria-pressed` is both the state a screen reader reads and what draws the
   pressed gray key, the same style `data-active` gets in `styles.css`. */
export function FileToolbarToggle({ icon, label, active, disabled = false, onClick }: FileToolbarToggleProps) {
    return (
        <Tooltip label={label} name>
            <button
                className="icon-btn h-7 w-7 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                aria-pressed={active}
                aria-disabled={disabled}
                onClick={() => {
                    if (!disabled) {
                        onClick();
                    }
                }}
            >
                <Icon icon={icon} size={14} />
            </button>
        </Tooltip>
    );
}

/* The code view's wrap control as every other view draws it: there, so the switch beside it keeps its
   place, and inert, because there are no lines of source to wrap. */
export function DisabledWrapToggle() {
    return <FileToolbarToggle icon={WrapText} label="Wrap long lines (source view only)" active={false} disabled onClick={() => undefined} />;
}
