import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import { starsOf } from '@/ui/eclipse-stars';

export interface EclipseOrbit {
    /* Its diameter in pixels, an even number so its center lands on a whole pixel. */
    size: number;
    /* How strong its line is, from 0 to 1. */
    alpha: number;
    /* Seconds per turn; a negative number turns it the other way. Absent, it stands still. */
    spin?: number;
    /* A small body on the orbit, at a point given in percent of the orbit's box. */
    moon?: { tone: 'cool' | 'warm'; left: number; top: number };
}

interface EclipseProps {
    /* Where the eclipse sits, in pixels from the top; it is always centered across. */
    center: number;
    /* The diameters of the warm glow and the white one. */
    glows: readonly [number, number];
    /* The diameters of the warm arc and the cool one. */
    rings: readonly [number, number];
    orbits: readonly EclipseOrbit[];
    stars: { count: number; seed: number };
    /* `fade` runs the sky out into the surface of the dialog it sits in, for a scene behind a pane. */
    sky?: 'full' | 'fade';
    /* The height of the scene, and anything else about its box. */
    className?: string;
}

/* A part centered on the eclipse: a glow, an arc or an orbit, `size` pixels across. */
function around(center: number, size: number): CSSProperties {
    return { top: center, width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px` };
}

/*
 * The sky of the welcome and of About: stars that twinkle, two glows that breathe, two arcs of
 * light around the eclipse that turn against each other, and orbits with a moon on some. Decorative
 * only, so it is hidden from a screen reader, and it stands still for a person who asked for less motion.
 */
export function Eclipse({ center, glows, rings, orbits, stars, sky = 'full', className }: EclipseProps) {
    const field = useMemo(() => starsOf(stars.count, stars.seed), [stars.count, stars.seed]);
    return (
        <div
            aria-hidden
            className={clsx('eclipse', sky === 'full' ? 'eclipse-sky' : 'eclipse-sky-fade', className)}
            style={{ '--eclipse-center': `${center}px` } as CSSProperties}
        >
            {field.map((star, index) => (
                <span
                    key={index}
                    className="eclipse-star"
                    data-tone={star.tone}
                    data-glint={star.glint ? '' : undefined}
                    style={
                        {
                            left: `${star.left}%`,
                            top: `${star.top}%`,
                            width: star.size,
                            height: star.size,
                            '--eclipse-alpha': star.alpha,
                            '--eclipse-duration': `${star.duration}s`,
                            '--eclipse-delay': `${star.delay}s`
                        } as CSSProperties
                    }
                />
            ))}
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
                >
                    {orbit.moon && (
                        <span className={`eclipse-moon eclipse-moon-${orbit.moon.tone}`} style={{ left: `${orbit.moon.left}%`, top: `${orbit.moon.top}%` }} />
                    )}
                </span>
            ))}
        </div>
    );
}
