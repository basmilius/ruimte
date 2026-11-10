import type { CSSProperties } from 'react';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';

const GLOW_ORBITS = [
    { size: 130, alpha: 0.05 },
    { size: 230, alpha: 0.035 },
    { size: 340, alpha: 0.025 }
] as const;

function atTop(size: number): CSSProperties {
    return { width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px` };
}

/*
 * The eclipse's orbits rising over the top edge, the way the welcome and About draw it. With the
 * setting on they take the color of the project on screen (`styles.css`, `.project-glow`); the
 * alphas stay those of the blue, so a loud color glows no louder.
 */
export function SidebarGlow() {
    const color = useProject((s) => s.current?.color ?? null);
    const tinted = useSettings((s) => s.projectGlow) && color !== null;
    return (
        <div
            aria-hidden
            data-glow-color={tinted ? color : undefined}
            className={tinted ? 'sidebar-glow project-glow' : 'sidebar-glow'}
            style={tinted ? ({ '--project-glow': color } as CSSProperties) : undefined}
        >
            <span className="sidebar-glow-light" style={atTop(240)} />
            {GLOW_ORBITS.map((orbit) => (
                <span key={orbit.size} className="sidebar-glow-orbit" style={{ ...atTop(orbit.size), '--sidebar-glow-alpha': orbit.alpha } as CSSProperties} />
            ))}
        </div>
    );
}
