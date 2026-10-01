import clsx from 'clsx';
import type { ProjectIcon } from '@ruimte/contracts';
import { MessagesSquare } from 'lucide-react';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { useTheme } from '@/state/theme';
import { useMachineUrl } from '@/transport/machine-url';
import { Icon } from '@basmilius/desktop-ui';

interface ProjectGlyphProps {
    projectId: string;
    /* The machine the project is on; without one the glyph asks the machine being worked on. */
    endpointId?: string;
    icon: ProjectIcon;
    color: string;
    size?: number;
    className?: string;
    /* The machine's Chats project, which is no folder and wears a mark of its own whatever its icon says. */
    scratch?: boolean;
}

/* A project's icon at one size: what was picked, what the folder declares, or its initial. */
export function ProjectGlyph({ projectId, endpointId, icon, color, size = 16, className, scratch = false }: ProjectGlyphProps) {
    const theme = useTheme((s) => s.resolved);
    const box = { width: size, height: size };
    const image = useMachineUrl(icon.kind === 'image' && !scratch ? { kind: 'projectIcon', projectId, theme, version: icon.version } : null, endpointId);

    if (scratch) {
        return (
            <span
                aria-hidden
                className={clsx('flex shrink-0 items-center justify-center rounded-sm border border-dashed border-border-strong text-text-muted', className)}
                style={box}
            >
                <Icon icon={icon.kind === 'lucide' ? PROJECT_ICON_GLYPHS[icon.value] : MessagesSquare} size={size >= 32 ? 20 : size >= 20 ? 14 : 12} />
            </span>
        );
    }

    if (icon.kind === 'lucide') {
        return <Icon icon={PROJECT_ICON_GLYPHS[icon.value]} size={size} className={clsx('shrink-0', className)} />;
    }
    if (icon.kind === 'image') {
        // The box holds its place while the bytes are on their way, so the name beside it does not jump.
        if (image.url === null) {
            return <span aria-hidden className={clsx('shrink-0', className)} style={box} />;
        }
        return <img src={image.url} alt="" width={size} height={size} className={clsx('shrink-0 object-contain', className)} style={box} />;
    }
    // The letter takes the project's own color on a tint of it, so nothing has to guess what reads
    // on an arbitrary hex. Never under 12 pixels, which a 16 pixel box still holds.
    return (
        <span
            aria-hidden
            className={clsx('flex shrink-0 items-center justify-center leading-none font-semibold', className)}
            style={{
                ...box,
                background: `color-mix(in oklab, ${color} 20%, transparent)`,
                color,
                fontSize: Math.max(12, Math.round(size * 0.68))
            }}
        >
            {icon.value}
        </span>
    );
}
