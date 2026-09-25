'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

export function MotionProvider({ children }: { readonly children: ReactNode }) {
    return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
