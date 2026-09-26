import clsx from 'clsx';
import { X } from 'lucide-react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Icon } from './Icon.tsx';
import type { Shortcut } from './shortcut.ts';
import { Tooltip } from './Tooltip.tsx';

type CloseButtonProps = {
    label: string;
    kbd?: Shortcut | string;
    className?: string;
} & ({ onClick: () => void } | { dialog: true });

/* The close button in the header of every panel and dialog. In a Base UI dialog it is that dialog's own `Dialog.Close`. */
export function CloseButton({ label, kbd, className, ...closes }: CloseButtonProps) {
    const classes = clsx('icon-btn', className);
    const glyph = <Icon icon={X} size={16} />;
    return (
        <Tooltip label={label} kbd={kbd} name>
            {'dialog' in closes ? (
                <Dialog.Close className={classes}>{glyph}</Dialog.Close>
            ) : (
                <button type="button" className={classes} onClick={closes.onClick}>
                    {glyph}
                </button>
            )}
        </Tooltip>
    );
}
