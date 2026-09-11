import clsx from 'clsx';
import type { ProjectIcon } from '@ruimte/contracts';
import { projectIconUrl } from '@/project/icon-url';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { useTheme } from '@/state/theme';
import { Icon } from '@/ui/Icon';

interface ProjectGlyphProps {
    projectId: string;
    /* The machine the project is on; without one the glyph asks the machine being worked on. */
    endpointId?: string;
    icon: ProjectIcon;
    color: string;
    size?: number;
    className?: string;
}

/* A project's icon at one size: what was picked, what the folder declares, or its initial. */
export function ProjectGlyph({ projectId, endpointId, icon, color, size = 16, className }: ProjectGlyphProps) {
    const theme = useTheme((s) => s.resolved);
    const box = { width: size, height: size };

    if (icon.kind === 'lucide') {
        return <Icon icon={PROJECT_ICON_GLYPHS[icon.value]} size={size} className={clsx('shrink-0', className)} />;
    }
    if (icon.kind === 'emoji') {
        return (
            <span aria-hidden className={clsx('flex shrink-0 items-center justify-center leading-none', className)} style={{ ...box, fontSize: size - 2 }}>
                {icon.value}
            </span>
        );
    }
    if (icon.kind === 'image') {
        return (
            <img
                src={projectIconUrl(projectId, icon.version, theme, endpointId)}
                alt=""
                width={size}
                height={size}
                className={clsx('shrink-0 rounded-sm object-contain', className)}
                style={box}
            />
        );
    }
    // The letter takes the project's own color on a tint of it, so nothing has to guess what reads
    // on an arbitrary hex. Never under 12 pixels, which a 16 pixel box still holds.
    return (
        <span
            aria-hidden
            className={clsx('flex shrink-0 items-center justify-center rounded-sm leading-none font-semibold', className)}
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
