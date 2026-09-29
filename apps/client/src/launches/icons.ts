import { Layers, Rocket, SquareTerminal, type LucideIcon } from 'lucide-react';
import type { LaunchConfigKind } from '@ruimte/contracts';

export const LAUNCH_KIND_ICON: Record<LaunchConfigKind, LucideIcon> = {
    service: Rocket,
    task: SquareTerminal,
    group: Layers
};
