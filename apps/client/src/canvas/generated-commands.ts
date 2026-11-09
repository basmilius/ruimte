import { ArrowRight, LayoutDashboard, Trash } from 'lucide-react';
import type { GeneratedCommands } from '@/commands/generated';

/* The rows made once per view a node moves to and per saved layout, apart from what they do, so the start screen's chunk holds no command of a workspace. */
export const CANVAS_GENERATED: readonly GeneratedCommands[] = [
    { prefix: 'view-move-', usage: 'viewMove', palette: true, icon: ArrowRight },
    { prefix: 'layout-apply-', usage: 'layoutApply', palette: true, icon: LayoutDashboard },
    { prefix: 'layout-delete-', usage: 'layoutDelete', palette: true, icon: Trash }
];
