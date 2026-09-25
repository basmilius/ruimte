'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';

// A sketch of a phone, an API and a database with the first call circled, drawn a few strokes per step.
const STROKES: readonly { readonly d: string; readonly at: number }[] = [
    { at: 1, d: 'M 62 142 C 100 138, 140 141, 184 140 C 187 170, 185 196, 183 222 C 142 224, 102 221, 60 223 C 58 196, 61 168, 62 142' },
    { at: 2, d: 'M 262 140 C 300 137, 350 141, 392 139 C 394 168, 391 196, 393 224 C 350 226, 305 222, 260 224 C 259 196, 262 168, 262 140' },
    {
        at: 3,
        d: 'M 452 146 C 452 130, 532 128, 534 146 C 536 162, 452 164, 452 146 M 452 146 C 450 180, 451 210, 453 232 C 460 248, 528 250, 534 232 C 536 208, 535 176, 534 146'
    },
    { at: 4, d: 'M 188 182 C 210 180, 232 183, 254 181 M 242 172 L 255 181 L 243 191' },
    { at: 4, d: 'M 398 184 C 415 183, 430 185, 446 184 M 434 175 L 447 184 L 435 193' },
    { at: 5, d: 'M 222 150 C 262 148, 268 214, 222 216 C 180 218, 176 152, 226 146' },
    { at: 5, d: 'M 214 220 C 206 240, 196 256, 184 268' }
];

const LABELS: readonly { readonly x: number; readonly y: number; readonly at: number; readonly size?: number; readonly children: ReactNode }[] = [
    { x: 60, y: 44, at: 0, size: 30, children: 'orders flow' },
    { x: 94, y: 164, at: 1, children: 'phone' },
    { x: 306, y: 164, at: 2, children: 'api' },
    { x: 478, y: 184, at: 3, children: 'db' },
    { x: 96, y: 272, at: 5, children: 'cache this?' }
];

/**
 * A drawing as the drawing view paints it: strokes in the text color, words in Kalam. `step` says how
 * far the sketch has come; `scale` fits it to the body it sits in.
 */
export function Sketch({ step, scale = 1, offset = [0, 0] }: { readonly step: number; readonly scale?: number; readonly offset?: readonly [number, number] }) {
    return (
        <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ transform: `translate(${offset[0]}px, ${offset[1]}px) scale(${scale})`, width: 560, height: 320 }}
        >
            <svg className="absolute inset-0 overflow-visible" width="100%" height="100%">
                {STROKES.map((stroke) => (
                    <motion.path
                        key={stroke.d}
                        d={stroke.d}
                        fill="none"
                        stroke="var(--text)"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={false}
                        animate={{ pathLength: step >= stroke.at ? 1 : 0, opacity: step >= stroke.at ? 1 : 0 }}
                        transition={{ duration: step >= stroke.at ? 0.75 : 0.2, ease: 'easeInOut' }}
                    />
                ))}
            </svg>
            {LABELS.map((label) => (
                <motion.div
                    key={label.x + label.y}
                    className="absolute font-hand leading-none text-text"
                    style={{ left: label.x, top: label.y, fontSize: label.size ?? 22 }}
                    initial={false}
                    animate={{ opacity: step >= label.at ? 1 : 0 }}
                    transition={{ duration: 0.3, delay: step >= label.at ? 0.45 : 0 }}
                >
                    {label.children}
                </motion.div>
            ))}
        </div>
    );
}
