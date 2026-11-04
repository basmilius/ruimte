import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { EclipseStars } from '@/ui/EclipseStars';

export interface EclipseOrbit {
    /* Its diameter in pixels, an even number so its center lands on a whole pixel. */
    size: number;
    /* How strong its line is, from 0 to 1. */
    alpha: number;
    /* Seconds per turn; a negative number turns it the other way. Absent, it stands still. */
    spin?: number;
}

interface EclipseProps {
    /* Where the eclipse sits, in pixels from the top; it is always centered across. */
    center: number;
    /* The diameters of the warm glow and the white one. */
    glows: readonly [number, number];
    /* The diameters of the warm arc and the cool one. */
    rings: readonly [number, number];
    orbits: readonly EclipseOrbit[];
    stars: { density: number; seed: number };
    /* `fade` runs the sky out into the surface of the dialog it sits in, for a scene behind a pane. */
    sky?: 'full' | 'fade';
    className?: string;
}

function around(center: number, size: number): CSSProperties {
    return { top: center, width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px` };
}

export function Eclipse({ center, glows, rings, orbits, stars, sky = 'full', className }: EclipseProps) {
    return (
        <div
            aria-hidden
            className={clsx('eclipse', sky === 'full' ? 'eclipse-sky' : 'eclipse-sky-fade', className)}
            style={{ '--eclipse-center': `${center}px` } as CSSProperties}
        >
            <EclipseStars center={center} density={stars.density} seed={stars.seed} />
            <span className="eclipse-part eclipse-glow-warm" style={around(center, glows[0])} />
            <span className="eclipse-part eclipse-glow-white" style={around(center, glows[1])} />
            <span className="eclipse-part eclipse-ring eclipse-ring-warm" style={around(center, rings[0])} />
            <span className="eclipse-part eclipse-ring eclipse-ring-cool" style={around(center, rings[1])} />
            {orbits.map((orbit) => (
                <span
                    key={orbit.size}
                    className="eclipse-part eclipse-orbit"
                    data-spin={orbit.spin === undefined ? undefined : orbit.spin < 0 ? 'reverse' : 'forward'}
                    style={
                        {
                            ...around(center, orbit.size),
                            '--eclipse-alpha': orbit.alpha,
                            ...(orbit.spin === undefined ? {} : { '--eclipse-duration': `${Math.abs(orbit.spin)}s` })
                        } as CSSProperties
                    }
                />
            ))}
        </div>
    );
}
