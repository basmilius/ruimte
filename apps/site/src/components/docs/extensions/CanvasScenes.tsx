'use client';

import { Icon, Surface } from '@adecore/ui';
import { CircleCheck, Hash, Sparkles, X } from 'lucide-react';
import { TerminalBody } from '../../app/bodies.tsx';
import { CanvasNode } from '../../app/canvas.tsx';
import { AssistantText } from '../../app/chat.tsx';
import { WindowBar } from '../../app/chrome.tsx';
import { Button, IconButton } from '../../app/primitives.tsx';
import { Scaled } from '../../film/Stage.tsx';
import { CanvasMenu, NoteText, SceneFrame } from './parts.tsx';

const WIDTH = 760;
const HEIGHT = 460;

/* A Counter node of an extension on the canvas, and the canvas menu with Counter under Extensions to add another. */
export function NodeType() {
    return (
        <Scaled
            width={WIDTH}
            height={HEIGHT}
            label="A canvas with a Counter node showing 3 and a plus button. The canvas menu is open, with Counter under its Extensions submenu."
        >
            <SceneFrame>
                <WindowBar />
                <div className="canvas-dots relative grow">
                    <CanvasNode rect={{ x: 40, y: 40, w: 240, h: 170 }} kind="file" icon={Hash} title="Counter">
                        <div className="flex h-full flex-col items-center justify-center gap-3 pb-2">
                            <span className="font-display text-4xl leading-none font-semibold text-text tabular-nums">3</span>
                            <Button variant="secondary">+1</Button>
                        </div>
                    </CanvasNode>
                    <CanvasMenu
                        className="top-[60px] left-[330px]"
                        nodes={
                            <span className="menu-item">
                                <Icon icon={Hash} size={14} /> Counter
                            </span>
                        }
                    />
                </div>
            </SceneFrame>
        </Scaled>
    );
}

/* An action in a terminal's header and the same extension's item at the foot of the canvas menu. */
export function NodeButton() {
    return (
        <Scaled
            width={WIDTH}
            height={HEIGHT}
            label="A terminal node named tests with the extension's sparkles button in its header, before zoom and close. Beside it the canvas menu ends with the extension's item Summarize this canvas."
        >
            <SceneFrame>
                <WindowBar />
                <div className="canvas-dots relative grow">
                    <CanvasNode rect={{ x: 40, y: 40, w: 300, h: 170 }} kind="terminal" title="tests" actions={<IconButton icon={Sparkles} size="sm" />}>
                        <TerminalBody>
                            <div className="text-term-dim">$ bun test signup</div>
                            <div className="mt-2 text-ansi-green">✓ keeps the email</div>
                            <div className="text-ansi-red">✗ shows the error</div>
                        </TerminalBody>
                    </CanvasNode>
                    <CanvasMenu
                        className="top-[60px] left-[400px]"
                        slot={
                            <span className="menu-item">
                                <Icon icon={Sparkles} size={14} /> Summarize this canvas
                            </span>
                        }
                    />
                </div>
            </SceneFrame>
        </Scaled>
    );
}

/* A chat that finished its turn, and the toast `host.notify` shows for it in the corner (`@adecore/ui` `Toasts`). */
export function AgentFinished() {
    return (
        <Scaled
            width={WIDTH}
            height={HEIGHT}
            label="A chat node named Review that has finished. In the bottom right corner a toast says A chat finished its turn, with a Show button."
        >
            <SceneFrame>
                <WindowBar />
                <div className="canvas-dots relative grow">
                    <CanvasNode rect={{ x: 40, y: 40, w: 280, h: 160 }} kind="note" title="Brief">
                        <NoteText>
                            <p className="font-semibold">Review the signup form.</p>
                            <p className="mt-2 text-text-muted">Check that a failed submit keeps the email.</p>
                        </NoteText>
                    </CanvasNode>
                    <CanvasNode rect={{ x: 360, y: 40, w: 340, h: 200 }} kind="chat" agent title="Review" status="idle">
                        <div className="px-4 py-3">
                            <AssistantText shown text="The form keeps the email now. I added a test for the failed submit." />
                        </div>
                    </CanvasNode>
                    <Surface className="absolute right-4 bottom-4 flex w-90 items-start gap-3 rounded-[10px] py-2.5 pr-2 pl-3">
                        <span className="flex h-(--text-sm--line-height) w-4 shrink-0 items-center justify-center">
                            <Icon icon={CircleCheck} size={16} className="text-status-idle" />
                        </span>
                        <span className="min-w-0 grow text-sm text-text">A chat finished its turn</span>
                        <span className="flex h-(--text-sm--line-height) shrink-0 items-center">
                            <Button size="xs">Show</Button>
                        </span>
                        <IconButton icon={X} size="xs" />
                    </Surface>
                </div>
            </SceneFrame>
        </Scaled>
    );
}
