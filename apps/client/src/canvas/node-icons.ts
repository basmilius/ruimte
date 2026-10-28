import {
    CalendarClock,
    CircleQuestionMark,
    FileText,
    Globe,
    LayoutGrid,
    MessageSquare,
    Package,
    PenTool,
    Smartphone,
    StickyNote,
    SwatchBook,
    Terminal,
    Workflow,
    type LucideIcon
} from 'lucide-react';
import type { CanvasNodeKind } from '@ruimte/contracts';

/* The mark of every kind a node on a canvas can be, the same in the sidebar and in settings. */
export const NODE_KIND_ICONS: Record<CanvasNodeKind, LucideIcon> = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    device: Smartphone,
    group: LayoutGrid,
    note: StickyNote,
    drawing: PenTool,
    diagram: Workflow,
    file: FileText,
    artifact: Package,
    routine: CalendarClock,
    design: SwatchBook,
    unknown: CircleQuestionMark
};
