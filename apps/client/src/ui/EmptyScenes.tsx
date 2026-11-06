import { EmptyScene } from '@adecore/ui';

const CURSOR = 'M0 0V13l3.5-3.2L6 15l2.2-1L5.8 9H10Z';
const DRAWN_LINE = 'M20 76C36 42 54 40 62 62S84 92 98 66S120 30 140 44';
const CODE_ROWS = [0, 1, 2, 3, 4, 5];

const CLOCK_TICKS = Array.from({ length: 12 }, (_, hour) => {
    const angle = ((hour * 30 - 90) * Math.PI) / 180;
    const inner = hour % 3 === 0 ? 23 : 26;
    const point = (radius: number) => `${(80 + Math.cos(angle) * radius).toFixed(2)} ${(54 + Math.sin(angle) * radius).toFixed(2)}`;

    return `M${point(inner)}L${point(28)}`;
}).join('');

function Cursor({ className }: { className: string }) {
    return <path className={`scene-cursor ${className}`} d={CURSOR} />;
}

/* A page takes shape, and a person pins a comment on it. */
export function DesignScene() {
    return (
        <EmptyScene>
            <g className="scene-loop">
                <g className="scene-lift">
                    <path className="scene-shape" d="M51 6h41l24 24v62a6 6 0 0 1-6 6H51a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6Z" />
                </g>
                <path className="scene-edge" d="M92 6v18a6 6 0 0 0 6 6h18" />
                <g className="scene-reveal-0">
                    <rect className="scene-inset" x="55" y="14" width="10" height="7" rx="3.5" />
                    <path className="scene-text" d="M70 17.5h16" />
                </g>
                <g className="scene-reveal-1">
                    <rect className="scene-inset" x="55" y="30" width="50" height="26" rx="5" />
                    <path className="scene-edge" d="M59 52l10-10 7 7 4-4 9 7" />
                    <circle className="scene-edge" cx="96" cy="37" r="3" />
                </g>
                <path className="scene-text scene-type-3" pathLength={1} d="M55 66h46" />
                <path className="scene-text scene-type-4" pathLength={1} d="M55 75h34" />
                <rect className="scene-inset scene-reveal-5" x="55" y="83" width="22" height="9" rx="4.5" />
                <g className="design-scene-pin">
                    <circle className="scene-accent" cx="104" cy="58" r="6" />
                    <circle className="design-scene-pin-hole" cx="104" cy="58" r="2" />
                </g>
                <Cursor className="design-scene-cursor" />
            </g>
        </EmptyScene>
    );
}

/* A pencil draws one line, its point the accent, and lifts. */
export function DrawingScene() {
    return (
        <EmptyScene>
            <g className="drawing-scene-loop">
                <path className="scene-line drawing-scene-ink" pathLength={1} d={DRAWN_LINE} />
                <g className="drawing-scene-pencil">
                    <g className="drawing-scene-lift">
                        <g className="drawing-scene-tilt">
                            <g className="scene-lift">
                                <path className="scene-shape" d="M-5 -13V-40a5 5 0 0 1 10 0V-13Z" />
                                <path className="scene-shape" d="M-5 -13L-1 -2a1.1 1.1 0 0 0 2 0L5 -13Z" />
                            </g>
                            <rect className="scene-inset" x="-1.4" y="-31" width="2.8" height="17" rx="1.4" />
                            <rect className="scene-inset" x="-5" y="-37" width="10" height="5" />
                            <path className="scene-edge" d="M-5 -37h10M-5 -32h10" />
                            <path className="scene-accent" d="M-1.7 -4.6L-0.5 -1.3a.55 .55 0 0 0 1 0L1.7 -4.6Z" />
                        </g>
                    </g>
                </g>
            </g>
        </EmptyScene>
    );
}

/* Two boxes are dragged into place, and the lines find them. */
export function EmptyDiagramScene() {
    return (
        <EmptyScene>
            <g className="scene-loop">
                <g className="scene-lift">
                    <rect className="scene-shape" x="8" y="38" width="44" height="28" rx="8" />
                </g>
                <path className="scene-text" d="M18 52h24" />
                <path className="scene-line scene-stroke-4" pathLength={1} d="M52 52h20a6 6 0 0 0 6-6V36a6 6 0 0 1 6-6h20" />
                <path className="scene-line scene-stroke-9" pathLength={1} d="M72 52a6 6 0 0 1 6 6v10a6 6 0 0 0 6 6h20" />
                <g className="diagram-scene-first">
                    <g className="scene-lift">
                        <rect className="scene-shape" x="104" y="16" width="46" height="28" rx="8" />
                    </g>
                    <path className="scene-text" d="M114 30h24" />
                    <g transform="translate(131 33)">
                        <Cursor className="diagram-scene-first-cursor" />
                    </g>
                </g>
                <g className="diagram-scene-second">
                    <g className="scene-lift">
                        <rect className="scene-shape" x="104" y="60" width="46" height="28" rx="8" />
                    </g>
                    <path className="scene-text" d="M114 74h18" />
                    <g transform="translate(127 77)">
                        <Cursor className="diagram-scene-second-cursor" />
                    </g>
                </g>
                <circle className="scene-accent scene-reveal-11" cx="141" cy="74" r="2.5" />
            </g>
        </EmptyScene>
    );
}

/* The clock reaches the hour and a routine starts. */
export function RoutinesScene() {
    return (
        <EmptyScene>
            <g className="routines-scene-ring">
                <circle className="scene-edge" cx="80" cy="54" r="36" />
            </g>
            <g className="scene-lift">
                <circle className="scene-shape" cx="80" cy="54" r="36" />
            </g>
            <circle className="scene-inset" cx="80" cy="54" r="31" />
            <path className="scene-edge" d={CLOCK_TICKS} />
            <path className="scene-hand" d="M80 54L64 56" />
            <g className="routines-scene-minute">
                <path className="scene-hand" d="M80 54V31" />
            </g>
            <g className="routines-scene-second">
                <path className="scene-edge" d="M80 61V28" />
            </g>
            <circle className="scene-shape" cx="80" cy="54" r="3" />
            <g className="routines-scene-chip">
                <g className="scene-lift">
                    <rect className="scene-shape" x="104" y="10" width="42" height="16" rx="8" />
                </g>
                <path className="scene-accent" d="M112 14.5v7l6-3.5Z" />
                <path className="scene-text" d="M123 18h15" />
            </g>
        </EmptyScene>
    );
}

/* A file is carried over and dropped in the folder. */
export function FilesScene() {
    return (
        <EmptyScene compact>
            <g className="scene-lift">
                <path className="scene-shape" d="M32 28h20a5 5 0 0 1 4 2l5 6h67a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V34a6 6 0 0 1 6-6Z" />
            </g>
            <rect className="scene-inset" x="31" y="41" width="98" height="13" rx="3" />
            <g className="files-scene-file">
                <g className="scene-lift">
                    <path className="scene-shape" d="M66 16h22l10 10v32a4 4 0 0 1-4 4H66a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4Z" />
                </g>
                <path className="scene-edge" d="M88 16v6a4 4 0 0 0 4 4h6" />
                <path className="scene-text" d="M68 36h20M68 44h13" />
                <circle className="scene-accent" cx="70" cy="25" r="2.5" />
                <g transform="translate(86 34)">
                    <Cursor className="files-scene-cursor" />
                </g>
            </g>
            <g className="files-scene-flap">
                <g className="scene-lift">
                    <path className="scene-shape" d="M24 54h112a4 4 0 0 1 3.9 4.8l-5 27.6a7 7 0 0 1-6.9 5.6H32a7 7 0 0 1-6.9-5.6l-5-27.6A4 4 0 0 1 24 54Z" />
                </g>
            </g>
        </EmptyScene>
    );
}

/* A commit lands, the branch catches up with its remote, and the two agree. */
export function GitScene() {
    return (
        <EmptyScene compact>
            <path className="scene-line" d="M36 98V44" />
            <g className="scene-lift">
                <circle className="scene-shape" cx="36" cy="88" r="5" />
                <circle className="scene-shape" cx="36" cy="66" r="5" />
                <circle className="scene-shape" cx="36" cy="44" r="5" />
            </g>
            <g className="scene-loop">
                <path className="scene-line scene-stroke-0" pathLength={1} d="M36 44V22" />
                <g className="scene-reveal-1">
                    <g className="scene-lift">
                        <circle className="scene-shape" cx="36" cy="22" r="5" />
                    </g>
                </g>
                <g className="scene-reveal-2">
                    <path className="scene-edge" d="M41 22h9" />
                    <g className="scene-lift">
                        <rect className="scene-shape" x="50" y="14" width="44" height="16" rx="8" />
                    </g>
                    <path className="scene-text" d="M58 22h26" />
                </g>
                <g className="git-scene-origin">
                    <g className="scene-lift">
                        <rect className="scene-shape" x="98" y="14" width="54" height="16" rx="8" />
                    </g>
                    <path className="scene-text" d="M106 22h20" />
                </g>
                <path className="scene-accent-line scene-stroke-8" pathLength={1} d="M134 22l3 3l6-6" />
            </g>
        </EmptyScene>
    );
}

/* A plug goes into the database, and its light comes on. */
export function DatabasesScene() {
    return (
        <EmptyScene compact>
            <g className="scene-lift">
                <path className="scene-shape" d="M24 24v54c0 6.6 11.6 12 26 12s26-5.4 26-12V24" />
                <ellipse className="scene-shape" cx="50" cy="24" rx="26" ry="9" />
            </g>
            <path className="scene-edge" d="M24 42c0 6.6 11.6 12 26 12s26-5.4 26-12M24 60c0 6.6 11.6 12 26 12s26-5.4 26-12" />
            <circle className="scene-accent databases-scene-glow" cx="50" cy="81" r="3" />
            <circle className="scene-accent databases-scene-light" cx="50" cy="81" r="3" />
            <g className="scene-lift">
                <rect className="scene-shape" x="75" y="45" width="8" height="18" rx="3" />
            </g>
            <rect className="scene-inset" x="77" y="49" width="4" height="3" rx="1.5" />
            <rect className="scene-inset" x="77" y="56" width="4" height="3" rx="1.5" />
            <path className="databases-scene-cable" d="M113 54C134 54 122 96 142 96S156 90 162 90" />
            <g className="databases-scene-plug">
                <path className="scene-edge" d="M80 50.5h7M80 57.5h7" />
                <g className="scene-lift">
                    <rect className="scene-shape" x="87" y="44" width="18" height="20" rx="6" />
                    <rect className="scene-shape" x="105" y="49" width="9" height="10" rx="3" />
                </g>
                <path className="scene-edge" d="M94 49v10M98 49v10" />
            </g>
        </EmptyScene>
    );
}

/* A card lands on the stack and gets its bookmark. */
export function OutputScene() {
    return (
        <EmptyScene compact>
            <g className="output-scene-stack">
                <g className="scene-lift">
                    <rect className="scene-shape" x="60" y="16" width="60" height="52" rx="8" />
                    <rect className="scene-shape" x="53" y="26" width="60" height="52" rx="8" />
                </g>
            </g>
            <g className="output-scene-card">
                <g className="scene-lift">
                    <rect className="scene-shape" x="46" y="36" width="60" height="52" rx="8" />
                </g>
                <rect className="scene-inset" x="53" y="43" width="46" height="18" rx="4" />
                <path className="scene-text" d="M53 70h30M53 79h18" />
                <path className="scene-accent output-scene-ribbon" d="M88 36v13.5a1 1 0 0 0 1.6.8L93 48l3.4 2.3a1 1 0 0 0 1.6-.8V36Z" />
            </g>
        </EmptyScene>
    );
}

/* The steps get written, and the first is ticked off. */
export function PlanScene() {
    return (
        <EmptyScene compact>
            <g className="scene-lift">
                <rect className="scene-shape" x="30" y="8" width="100" height="88" rx="10" />
            </g>
            <circle className="scene-edge" cx="48" cy="28" r="6" />
            <circle className="scene-edge" cx="48" cy="50" r="6" />
            <circle className="scene-edge" cx="48" cy="72" r="6" />
            <path className="scene-edge" d="M42 39h82M42 61h82" opacity="0.5" />
            <g className="scene-loop">
                <g className="plan-scene-done">
                    <path className="scene-text scene-type-0" pathLength={1} d="M62 28h48" />
                </g>
                <path className="scene-text scene-type-2" pathLength={1} d="M62 50h36" />
                <path className="scene-text scene-type-4" pathLength={1} d="M62 72h42" />
                <g className="plan-scene-fill">
                    <circle className="scene-accent" cx="48" cy="28" r="6.75" />
                </g>
                <path className="plan-scene-tick scene-stroke-9" pathLength={1} d="M45.3 28.3l1.9 1.9l3.6-4" />
                <Cursor className="plan-scene-cursor" />
            </g>
        </EmptyScene>
    );
}

/* A command gets typed, its light comes on and the output runs. */
export function LaunchesScene() {
    return (
        <EmptyScene compact>
            <g className="scene-lift">
                <rect className="scene-shape" x="14" y="10" width="132" height="84" rx="10" />
            </g>
            <path className="scene-edge" d="M14 26h132" />
            <circle className="scene-dot" cx="24" cy="18" r="2" />
            <circle className="scene-dot" cx="31" cy="18" r="2" />
            <circle className="scene-dot" cx="38" cy="18" r="2" />
            <circle className="scene-inset" cx="134" cy="18" r="3" />
            <circle className="scene-accent launches-scene-glow" cx="134" cy="18" r="3" />
            <circle className="scene-accent launches-scene-light" cx="134" cy="18" r="3" />
            <g className="scene-loop">
                <path className="scene-line" d="M24 39l4 4l-4 4" />
                <path className="scene-text launches-scene-command" pathLength={1} d="M36 43h34" />
                <rect className="scene-dot launches-scene-caret" x="36" y="37" width="5" height="12" rx="1.5" />
                <path className="scene-text scene-reveal-5" d="M24 58h70" />
                <path className="scene-text scene-reveal-6" d="M24 68h52" />
                <path className="scene-text scene-reveal-7" d="M24 78h84" />
            </g>
        </EmptyScene>
    );
}

/* A line moves down the code, finds nothing, and a check lands. */
export function ProblemsScene() {
    return (
        <EmptyScene compact>
            <g className="scene-lift">
                <rect className="scene-shape" x="24" y="6" width="112" height="92" rx="8" />
            </g>
            <path className="scene-edge" d="M44 6v92" />
            {CODE_ROWS.map((row) => (
                <rect key={row} className="scene-inset" x="31" y={16 + row * 13} width="7" height="4" rx="2" />
            ))}
            <g className="problems-scene-read">
                <rect className="scene-inset" x="45" y="13" width="90" height="10" rx="3" />
            </g>
            <path className="scene-text" d="M52 18h40M60 31h52M60 44h34M52 57h44M60 70h28M52 83h20" />
            <g className="scene-reveal-9">
                <g className="scene-lift">
                    <circle className="scene-shape" cx="126" cy="86" r="13" />
                </g>
            </g>
            <path className="scene-accent-line scene-stroke-10" pathLength={1} d="M120.5 86l3.8 3.8l7.2-7.6" />
        </EmptyScene>
    );
}
