'use client';

import { motion } from 'motion/react';
import { AssistantText, Composer, UserBubble } from '../../app/chat.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 2600, 3600] as const;
const BUILDS = [
    { day: 'Mon', seconds: 48 },
    { day: 'Tue', seconds: 61 },
    { day: 'Wed', seconds: 44 },
    { day: 'Thu', seconds: 72 },
    { day: 'Fri', seconds: 39 }
] as const;

/* A thread where a `chart` fence draws as a chart, and the composer offers a slash command of the same extension. */
export function ChatBlocks() {
    return (
        <Stage
            width={760}
            height={520}
            label="An agent answers with a chart fence, which the extension draws as bars. In the composer, /review comes from the same extension."
        >
            <ChatScene />
        </Stage>
    );
}

function ChatScene() {
    const step = useTimeline(STEPS);
    const longest = Math.max(...BUILDS.map((build) => build.seconds));

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-surface shadow-[0_24px_60px_rgb(0_0_0/0.45)]">
            <div className="flex grow flex-col gap-4 overflow-hidden px-8 pt-7">
                <UserBubble>How long did the builds take this week?</UserBubble>
                <AssistantText shown text="Thursday was the slowest, after the new image step. Here they are per day." />
                <motion.div
                    className="w-[440px] rounded-xl border border-border bg-surface-sunken p-4"
                    initial={false}
                    animate={{ opacity: step >= 1 ? 1 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                >
                    <div className="flex h-36 items-end gap-5">
                        {BUILDS.map((build, index) => (
                            <div key={build.day} className="flex grow flex-col items-center gap-2">
                                <motion.span
                                    className="w-full origin-bottom rounded-t-md bg-accent"
                                    style={{ height: `${(build.seconds / longest) * 100}%` }}
                                    initial={false}
                                    animate={{ scaleY: step >= 1 ? 1 : 0 }}
                                    transition={{ duration: 0.5, ease: EASE, delay: step >= 1 ? index * 0.08 : 0 }}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex gap-5 text-[12px] text-text-faint">
                        {BUILDS.map((build) => (
                            <span key={build.day} className="grow text-center">
                                {build.day}
                            </span>
                        ))}
                    </div>
                </motion.div>
            </div>
            <div className="relative px-6 pb-6">
                <motion.div
                    className="absolute bottom-[132px] left-6 z-10 flex w-[360px] flex-col rounded-xl border border-border bg-surface-raised p-1 shadow-float"
                    initial={false}
                    animate={{ opacity: step === 2 ? 1 : 0, y: step === 2 ? 0 : 6 }}
                    transition={{ duration: 0.3, ease: EASE }}
                >
                    <span className="flex h-9 items-center gap-3 rounded-md bg-surface-active px-2.5 text-[13px]">
                        <span className="font-mono text-text">/review</span>
                        <span className="truncate text-text-muted">Ask for a review of the open diff</span>
                    </span>
                </motion.div>
                <Composer draft={step === 2 ? '/rev' : undefined} typing={step === 2} />
            </div>
        </div>
    );
}
