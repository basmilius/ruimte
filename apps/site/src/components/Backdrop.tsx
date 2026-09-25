// Ruimte is Dutch for space: the hero sits in a field of stars under two slow washes of light.

interface Star {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly opacity: number;
    /** Seconds; zero for a star that holds still. */
    readonly twinkle: number;
    readonly delay: number;
}

/** A fixed seed, so the server and the browser place every star in the same spot. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const next = random(4210);
const STARS: readonly Star[] = Array.from({ length: 170 }, () => {
    const size = next();
    return {
        x: next() * 1600,
        y: next() * 1000,
        r: size > 0.95 ? 1.4 : size > 0.75 ? 1 : 0.6,
        opacity: 0.25 + next() * 0.55,
        twinkle: next() > 0.8 ? 3 + next() * 5 : 0,
        delay: next() * -8
    };
});

export function Backdrop() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="drift-a absolute -top-[25%] -left-[10%] size-[1000px] rounded-full bg-[radial-gradient(circle,rgb(21_93_252/0.2),transparent_62%)] blur-3xl" />
            <div className="drift-b absolute top-[5%] -right-[15%] size-[900px] rounded-full bg-[radial-gradient(circle,rgb(124_58_237/0.16),transparent_62%)] blur-3xl" />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
                {STARS.map((star, i) => (
                    <circle
                        key={i}
                        cx={star.x}
                        cy={star.y}
                        r={star.r}
                        fill="#ffffff"
                        opacity={star.opacity}
                        className={star.twinkle > 0 ? 'twinkle' : undefined}
                        style={star.twinkle > 0 ? { animationDuration: `${star.twinkle}s`, animationDelay: `${star.delay}s` } : undefined}
                    />
                ))}
            </svg>
            <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-b from-transparent to-bg" />
        </div>
    );
}
