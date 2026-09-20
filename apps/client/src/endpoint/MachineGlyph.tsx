import clsx from 'clsx';
import { Server } from 'lucide-react';
import type { ProjectIconChoice } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { Icon } from '@/ui/Icon';

interface MachineGlyphProps {
    /* What a person picked for this machine, or null while nobody has. */
    icon: ProjectIconChoice | null;
    size?: number;
    className?: string;
}

/* A machine's icon at one size. It picks from the same set a project does, minus the image kind: a
   machine has no folder to keep a file in, so there is nothing to fall back to but a server. */
export function MachineGlyph({ icon, size = 16, className }: MachineGlyphProps) {
    if (icon?.kind === 'lucide') {
        return <Icon icon={PROJECT_ICON_GLYPHS[icon.value]} size={size} className={clsx('shrink-0', className)} />;
    }
    return <Icon icon={Server} size={size} className={clsx('shrink-0', className)} />;
}
