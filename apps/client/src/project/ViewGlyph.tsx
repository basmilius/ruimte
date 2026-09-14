import clsx from 'clsx';
import { FileText, Frame, Globe, MessageSquare, Minus, PenTool, Terminal, Workflow, type LucideIcon } from 'lucide-react';
import type { AgentKind, ProjectIconChoice, ProjectViewKind } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { Favicon } from '@/browser/Favicon';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';

/* What a view wears when nobody picked anything: the mark of what it is. */
const VIEW_KIND_GLYPHS: Record<ProjectViewKind, LucideIcon> = {
    canvas: Frame,
    chat: MessageSquare,
    terminal: Terminal,
    browser: Globe,
    drawing: PenTool,
    diagram: Workflow,
    file: FileText,
    separator: Minus
};

interface ViewGlyphProps {
    id: string;
    kind: ProjectViewKind;
    /* A picked icon, which outranks everything below it. */
    icon?: ProjectIconChoice | null;
    /* The CLI a chat or terminal view runs, whose mark it wears instead of its kind's. */
    provider?: AgentKind | null;
    /* The file a file view reads, which wears the mark of its own name. */
    path?: string | null;
    size?: number;
    className?: string;
}

/*
 * The mark of one view, everywhere a view is listed. The chain runs from the most deliberate to the
 * least: what a person picked, then what a browser's own page says, then the CLI behind a session,
 * and the kind itself as the floor.
 */
export function ViewGlyph({ id, kind, icon = null, provider = null, path = null, size = 14, className }: ViewGlyphProps) {
    if (icon?.kind === 'lucide') {
        return <Icon icon={PROJECT_ICON_GLYPHS[icon.value]} size={size} className={clsx('shrink-0', className)} />;
    }
    if (icon?.kind === 'emoji') {
        return (
            <span
                aria-hidden
                className={clsx('flex shrink-0 items-center justify-center leading-none', className)}
                style={{ width: size, height: size, fontSize: size - 2 }}
            >
                {icon.value}
            </span>
        );
    }
    if (kind === 'browser') {
        return <Favicon id={id} size={size} />;
    }
    // The one place the app steps outside Lucide, the way the files panel and the tabs do.
    if (kind === 'file' && path) {
        return <FileIcon path={path} size={size} className={className} />;
    }
    if (provider && (kind === 'chat' || kind === 'terminal')) {
        return <AgentIcon kind={provider} size={size} className={className} />;
    }
    return <Icon icon={VIEW_KIND_GLYPHS[kind]} size={size} className={className} />;
}
