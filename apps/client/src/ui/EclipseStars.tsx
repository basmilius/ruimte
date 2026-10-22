import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '@/state/theme';
import { starsOf } from '@/ui/eclipse-stars';
import Galaxy from '@/ui/galaxy/Galaxy';

function FallbackStars({ density, seed }: { density: number; seed: number }) {
    const field = starsOf(Math.round(58 * density), seed);
    return field.map((star, index) => (
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
    ));
}

export function EclipseStars({ center, density, seed }: { center: number; density: number; seed: number }) {
    const theme = useTheme((state) => state.resolved);
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(400);
    const [available, setAvailable] = useState(true);
    const unavailable = () => setAvailable(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const resize = (): void => setHeight(Math.max(1, element.clientHeight));
        const bounds = new ResizeObserver(resize);
        bounds.observe(element);
        resize();
        return () => bounds.disconnect();
    }, []);

    return (
        <div ref={ref} className="eclipse-stars">
            {available ? (
                <Galaxy
                    focal={[0.5, 1 - center / height]}
                    density={density}
                    glowIntensity={0.3}
                    flareIntensity={1}
                    starSpeed={0.5}
                    mouseRepulsion
                    clickWarp
                    starColors={theme === 'light' ? ['#ffffff', '#ffd9a3', '#a8c8ff'] : ['#ffffff', '#bfe3ff', '#8fb8ff']}
                    hueShift={140}
                    saturation={0}
                    starSize={1}
                    twinkleIntensity={0.3}
                    speed={1}
                    rotationSpeed={0.1}
                    layers={4}
                    direction="forward"
                    repulsionStrength={2}
                    mouseInteraction
                    intro
                    lightMode={false}
                    onUnavailable={unavailable}
                />
            ) : (
                <FallbackStars density={density} seed={seed} />
            )}
        </div>
    );
}
