import type { LaunchConfigKind } from '@ruimte/contracts';
import { Layers, Rocket, SquareTerminal, type LucideIcon } from 'lucide-react';

export const LAUNCH_KIND_ICON: Record<LaunchConfigKind, LucideIcon> = {
    service: Rocket,
    task: SquareTerminal,
    group: Layers
};
