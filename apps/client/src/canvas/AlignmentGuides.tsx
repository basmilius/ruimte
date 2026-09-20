import type { AlignmentGuide } from '@/canvas/alignment-guides';
import type { Camera } from '@/canvas/math';

export function AlignmentGuides({ guides, camera }: { guides: readonly AlignmentGuide[]; camera: Camera }) {
    if (guides.length === 0) {
        return null;
    }
    return (
        <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-hidden text-accent">
            {guides.map((guide) => {
                const vertical = guide.axis === 'x';
                const position = guide.position * camera.zoom + (vertical ? camera.x : camera.y);
                const start = guide.start * camera.zoom + (vertical ? camera.y : camera.x) - 8;
                const end = guide.end * camera.zoom + (vertical ? camera.y : camera.x) + 8;
                return (
                    <line
                        key={`${guide.axis}:${guide.position}`}
                        x1={vertical ? position : start}
                        y1={vertical ? start : position}
                        x2={vertical ? position : end}
                        y2={vertical ? end : position}
                        stroke="currentColor"
                        strokeWidth={1}
                    />
                );
            })}
        </svg>
    );
}
