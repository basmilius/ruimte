import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import clsx from 'clsx';

interface IconProps {
    icon: IconDefinition;
    size?: number;
    className?: string;
}

/* One Font Awesome regular icon, sized in pixels. Icons here are decorative: the name a screen
   reader reads sits on the button or the label next to it, so the glyph stays hidden. */
export function Icon({ icon, size = 16, className }: IconProps) {
    // Font Awesome sizes itself in em off the surrounding text, which would make one glyph drift
    // from the next; a pixel box gives every call site the size it asks for. The `icon` class
    // carries the optical alignment.
    return <FontAwesomeIcon icon={icon} className={clsx('icon', className)} style={{ width: size, height: size }} aria-hidden />;
}
