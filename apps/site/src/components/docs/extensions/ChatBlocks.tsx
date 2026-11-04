'use client';

import { Icon } from '@adecore/ui';
import { SquareSlash } from 'lucide-react';
import { motion } from 'motion/react';
import { AssistantText, Composer, UserBubble } from '../../app/chat.tsx';
import { EASE, useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { SceneFrame } from './parts.tsx';

const STEPS = [1400, 2600, 3600] as const;
const BUILDS = [
    { day: 'Mon', seconds: 48 },
    { day: 'Tue', seconds: 61 },
    { day: 'Wed', seconds: 44 },
    { day: 'Thu', seconds: 72 },
    { day: 'Fri', seconds: 39 }
] as const;
const LONGEST = Math.max(...BUILDS.map((build) => build.seconds));

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
    const charted = step >= 1;
    const commanding = step === 2;

    return (
        <SceneFrame>
            <div className="flex grow flex-col gap-4 overflow-hidden px-8 pt-7">
                <UserBubble>How long did the builds take this week?</UserBubble>
                <AssistantText shown text="Thursday was the slowest, after the new image step. Here they are per day." />
                <motion.div
                    className="w-[440px] rounded-xl border border-border bg-surface-sunken p-4"
                    initial={false}
                    animate={{ opacity: charted ? 1 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                >
                    <div className="flex h-36 items-end gap-5">
                        {BUILDS.map((build, index) => (
                            <div key={build.day} className="flex h-full grow flex-col justify-end">
                                <motion.span
                                    className="w-full origin-bottom rounded-t-md bg-accent"
                                    style={{ height: `${(build.seconds / LONGEST) * 100}%` }}
                                    initial={false}
                                    animate={{ scaleY: charted ? 1 : 0 }}
                                    transition={{ duration: 0.5, ease: EASE, delay: charted ? index * 0.08 : 0 }}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex gap-5 text-2xs text-text-faint">
                        {BUILDS.map((build) => (
                            <span key={build.day} className="grow basis-0 text-center">
                                {build.day}
                            </span>
                        ))}
                    </div>
                </motion.div>
            </div>
            <div className="px-6 pb-6">
                <Composer draft={commanding ? '/rev' : undefined} typing={commanding} menu={commanding && <SlashCommands />} />
            </div>
        </SceneFrame>
    );
}

/* `composer/ComposerMenu.tsx`: the commands that match, the first one under the cursor. */
function SlashCommands() {
    return (
        <div className="border-b border-border px-1.5 py-1.5">
            <span data-active="true" className="cursor-row flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-text-muted">
                <Icon icon={SquareSlash} size={12} className="shrink-0 text-text-faint" />
                <span className="font-mono text-text">/review</span>
                <span className="text-text-faint">Ask for a review of the open diff</span>
            </span>
        </div>
    );
}
