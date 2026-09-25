import { AppIcon } from './AppIcon.tsx';

interface Ring {
    readonly radius: number;
    readonly color: string;
    /** Seconds per turn. */
    readonly period: number;
    /** Where on its ring the agent starts, in degrees. */
    readonly start: number;
}

// The agents circle in the status colors of the app: running, needs you, idle, and the accent.
const RINGS: readonly Ring[] = [
    { radius: 150, color: '#60a5fa', period: 16, start: 40 },
    { radius: 208, color: '#fbbf24', period: 26, start: 200 },
    { radius: 262, color: '#4ade80', period: 36, start: 300 },
    { radius: 310, color: '#93c5fd', period: 52, start: 120 }
];

/**
 * The app icon at the center of a tilted plane of orbits, each carrying an agent with a trail of
 * light, over a disc of the canvas's own dots.
 */
export function Orbit({ className = '' }: { readonly className?: string }) {
    return (
        <div aria-hidden className={`pointer-events-none relative aspect-square ${className}`}>
            <div className="absolute inset-0 [perspective:1400px]">
                <div className="absolute top-1/2 left-1/2 size-[680px] -translate-x-1/2 -translate-y-1/2 [transform:rotateX(64deg)_rotateZ(-24deg)] [transform-style:preserve-3d]">
                    <div className="canvas-dots absolute inset-0 rounded-full bg-transparent! [mask-image:radial-gradient(closest-side,black_30%,transparent_100%)]" />
                    {RINGS.map((ring) => (
                        <div
                            key={ring.radius}
                            className="absolute top-1/2 left-1/2 rounded-full border border-white/[0.09]"
                            style={{ width: ring.radius * 2, height: ring.radius * 2, marginLeft: -ring.radius, marginTop: -ring.radius }}
                        >
                            <div
                                className="orbit absolute -inset-px rounded-full"
                                style={{ animationDuration: `${ring.period}s`, animationDelay: `${(-ring.start / 360) * ring.period}s` }}
                            >
                                <div
                                    className="absolute inset-0 rounded-full [mask-image:radial-gradient(farthest-side,transparent_calc(100%-2px),black_calc(100%-1.5px))]"
                                    style={{ background: `conic-gradient(from 0deg, transparent 0 72%, ${ring.color} 100%)` }}
                                />
                                <span
                                    className="absolute top-0 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                                    style={{ background: ring.color, boxShadow: `0 0 18px 5px ${ring.color}88` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="absolute -inset-16 rounded-full bg-[radial-gradient(closest-side,rgb(21_93_252/0.45),transparent)] blur-2xl" />
                <div className="float relative">
                    <AppIcon size={132} className="drop-shadow-[0_24px_48px_rgb(0_0_0/0.6)]" />
                </div>
            </div>
        </div>
    );
}
