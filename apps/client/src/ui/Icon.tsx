import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

// The free Hugeicons set is drawn at this weight; every icon in the client renders through this
// component so the weight is one decision instead of a prop that drifts per call site.
const STROKE_WIDTH = 1.5;

interface IconProps {
    icon: IconSvgElement;
    size?: number;
    className?: string;
}

/* One icon from the free Hugeicons set, sized in pixels. Icons here are decorative: the name a
   screen reader reads sits on the button or the label next to it, so the glyph stays hidden. */
export function Icon({ icon, size = 16, className }: IconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={STROKE_WIDTH} className={className} aria-hidden />;
}
