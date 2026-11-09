import { Kbd, type KbdProps } from '@adecore/ui';
import { useKeyOf, type RowId } from '@/surface/shortcut-overrides';

interface RowKbdProps extends Omit<KbdProps, 'shortcut' | 'children'> {
    row: RowId;
}

/* The key a row answers to now, printed as a chip that follows a rebind. */
export function RowKbd({ row, ...props }: RowKbdProps) {
    const key = useKeyOf(row as never) as ReturnType<typeof useKeyOf>;

    return key === undefined ? null : <Kbd shortcut={key} {...props} />;
}
