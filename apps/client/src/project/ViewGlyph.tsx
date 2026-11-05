import { AgentIcon } from '@adecore/agents-react/providers';
import { useChats } from '@adecore/agents-react/state';
import { FileIcon, Icon } from '@adecore/ui';
import type { AgentKind, ProjectIconChoice, ProjectViewKind } from '@ruimte/contracts';
import clsx from 'clsx';
import {
    CircleQuestionMark,
    FileText,
    Frame,
    Globe,
    Heading,
    MessageSquare,
    Minus,
    Package,
    PenTool,
    Smartphone,
    SwatchBook,
    Table,
    Terminal,
    Workflow,
    type LucideIcon
} from 'lucide-react';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { extensionKeyOf, useContributions } from '@/state/extension-registry';
import { nodeProvider } from '@/state/sessions';
import { Favicon } from '@/surface/Favicon';
import { projectIconGlyphOf } from '@/surface/project-icons';

/* The default mark for a view, when nobody picked an icon. */
const VIEW_KIND_GLYPHS: Record<ProjectViewKind, LucideIcon> = {
    canvas: Frame,
    chat: MessageSquare,
    terminal: Terminal,
    browser: Globe,
    device: Smartphone,
    drawing: PenTool,
    diagram: Workflow,
    file: FileText,
    database: Table,
    separator: Minus,
    subheader: Heading,
    artifact: Package,
    design: SwatchBook,
    unknown: CircleQuestionMark
};

interface ViewGlyphProps {
    id: string;
    kind: ProjectViewKind;
    /* A picked icon, which outranks everything below it. */
    icon?: ProjectIconChoice | null;
    /* The CLI a chat or terminal view stores, whose mark it wears instead of its kind's. A chat without one wears its thread's. */
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
export function ViewGlyph({ id, kind, icon = null, provider: stored = null, path = null, size = 14, className }: ViewGlyphProps) {
    const endpointId = useEndpointId();
    const provider = useChats((s) => nodeProvider({ id, kind, provider: stored ?? undefined }, s.statusByKey, endpointId));
    const picked = icon?.kind === 'lucide' ? projectIconGlyphOf(icon.value) : null;
    if (picked) {
        return <Icon icon={picked} size={size} className={clsx('shrink-0', className)} />;
    }
    if (kind === 'browser') {
        return <Favicon id={id} size={size} className={className} />;
    }
    // The one place the app steps outside Lucide, the way the files panel and the tabs do.
    if (kind === 'file' && path) {
        return <FileIcon path={path} size={size} className={className} />;
    }
    if (provider && (kind === 'chat' || kind === 'terminal')) {
        return <AgentIcon kind={provider} size={size} className={className} />;
    }
    if (kind === 'unknown') {
        return <ExtensionViewGlyph id={id} size={size} className={className} />;
    }
    return <Icon icon={VIEW_KIND_GLYPHS[kind]} size={size} className={className} />;
}

/* A view of an extension is kept as `unknown`; the icon its `defineView` names is the one it wears. */
function ExtensionViewGlyph({ id, size, className }: { id: string; size: number; className: string | undefined }) {
    const key = useDocument((state) => {
        const view = state.views.find((each) => each.id === id);

        return view?.kind === 'unknown' ? extensionKeyOf(view.raw) : null;
    });
    const icon = useContributions((state) => (key === null ? undefined : state.extensionViews.find((entry) => entry.id === key)?.icon));

    return <Icon icon={icon ?? VIEW_KIND_GLYPHS.unknown} size={size} className={className} />;
}
