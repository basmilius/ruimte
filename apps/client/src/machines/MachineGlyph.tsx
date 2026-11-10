import { Icon } from '@adecore/ui';
import type { ProjectIconChoice } from '@ruimte/contracts';
import clsx from 'clsx';
import { Server } from 'lucide-react';
import { projectIconGlyphOf } from '@/surface/project-icons';

interface MachineGlyphProps {
    icon: ProjectIconChoice | null;
    size?: number;
    className?: string;
}

/* A machine's icon at one size. It picks from the same set a project does, minus the image kind.
   A machine has no folder to keep a file in, so there is nothing to fall back to but a server. */
export function MachineGlyph({ icon, size = 16, className }: MachineGlyphProps) {
    const picked = icon?.kind === 'lucide' ? projectIconGlyphOf(icon.value) : null;
    return <Icon icon={picked ?? Server} size={size} className={clsx('shrink-0', className)} />;
}
