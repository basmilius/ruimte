import { CommandPalette, type CommandPaletteVirtualItemProps } from '@adecore/ui';
import { wantsNewWindow } from '@/project/windows';
import type { Entry } from '@/palette/palette-entries';

/* A row of a list mode. Base UI clicks it for Enter without a modifier, so only a pointer brings one here. */
export function PaletteEntryItem({
    entry,
    itemProps,
    onRun
}: {
    entry: Entry;
    itemProps?: CommandPaletteVirtualItemProps;
    onRun(entry: Entry, newWindow: boolean): void;
}) {
    return (
        <CommandPalette.Item
            {...itemProps}
            value={entry}
            icon={entry.icon}
            hint={entry.hint || undefined}
            trailing={entry.trailing}
            shortcut={entry.shortcut}
            onClick={(event) => onRun(entry, wantsNewWindow(event))}
        >
            {entry.label}
        </CommandPalette.Item>
    );
}
