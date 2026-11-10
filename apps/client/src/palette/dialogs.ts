import { lazyDialog } from '@adecore/ui';
import type { DialogContribution } from '@/registry/dialogs';
import { useUi } from '@/state/ui';

const CommandPalette = lazyDialog(
    () => import('@/palette/CommandPalette'),
    'CommandPalette',
    useUi,
    (s) => s.paletteOpen
);

export const PALETTE_DIALOGS: readonly DialogContribution[] = [{ id: 'palette', surface: 'palette', component: CommandPalette }];
