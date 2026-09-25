/** The pointer over the hero, -1..1 across its container, with `active` 1 while it is there. */
export type Pointer = { x: number; y: number; active: number };

/** The families the take writes in: the site's sans stack and its loaded mono face. */
export type Fonts = { sans: string; mono: string };

/* A lead agent hands a slow checkout to a team of three, their results fly back into its turn in the order they
   land, and it writes one answer. It draws in a 560 x 500 box; HeroVisual places that box over its container. */

export const DELEGATION_WIDTH = 560;
export const DELEGATION_HEIGHT = 500;
// The still for reduced motion: every result is back and the answer is written.
export const DELEGATION_POSTER = 10.8;

const W = DELEGATION_WIDTH;
const H = DELEGATION_HEIGHT;
const TAU = Math.PI * 2;

const clamp = (value: number, low = 0, high = 1) => (value < low ? low : value > high ? high : value);
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const fract = (value: number) => value - Math.floor(value);
const mod = (value: number, size: number) => ((value % size) + size) % size;
const smoothstep = (from: number, to: number, value: number) => {
    const amount = clamp((value - from) / (to - from));
    return amount * amount * (3 - 2 * amount);
};
const outCubic = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const inOutCubic = (value: number) => {
    const amount = clamp(value);
    return amount < 0.5 ? 4 * amount * amount * amount : 1 - Math.pow(-2 * amount + 2, 3) / 2;
};
const inBack = (value: number, overshoot: number) => {
    const amount = clamp(value);
    return (overshoot + 1) * amount * amount * amount - overshoot * amount * amount;
};

const hexToRgb = (hex: string): [number, number, number] => {
    const value = parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const rgba = (hex: string, alpha = 1) => {
    const [red, green, blue] = hexToRgb(hex);
    return `rgba(${red},${green},${blue},${alpha})`;
};
const mix = (from: string, to: string, amount: number, alpha = 1) => {
    const start = hexToRgb(from);
    const end = hexToRgb(to);
    const channel = (index: number) => Math.round(lerp(start[index] ?? 0, end[index] ?? 0, amount));
    return `rgba(${channel(0)},${channel(1)},${channel(2)},${alpha})`;
};
// Colors the client mixes in CSS (`color-mix`), mixed once here and kept as hex so they can be mixed again.
const hexMix = (from: string, to: string, amount: number) => {
    const start = hexToRgb(from);
    const end = hexToRgb(to);
    return `#${start
        .map((channel, index) =>
            Math.round(lerp(channel, end[index] ?? 0, amount))
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;
};

// The site's dark theme, token for token (globals.css).
const PAL = {
    surface: '#131316',
    raised: '#18181c',
    sunken: '#08080a',
    text: '#ececf1',
    muted: '#9a9aa6',
    faint: '#5f5f6b',
    accent: '#155dfc',
    running: '#60a5fa',
    idle: '#4ade80',
    termFg: '#d6d6de',
    termDim: '#6b6b76'
} as const;
const GROUND = '#0d0d10';
const EDGE_CONTEXT = hexMix(PAL.accent, GROUND, 0.45);
const ACTIVE = '#28282e';

const CLAUDE_PATH =
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';

const CYCLE = 15;
const PW = 204;
const PH = 240;
const PY = 126;
const PX_CENTER = 178;
const PX_LEFT = 74;
const HEADER = 26;
const CHILD_HEADER = 22;
const SPAWN = 1.9;
const SLIDE = 1.6;
const RETURN = 11.7;
const ANSWER = 8.9;
const ANSWER_LEN = 1.8;
const DONE = ANSWER + ANSWER_LEN + 0.1;
const GATHER = 11.1;
const CLEAR = 12.9;
const THINK_AGAIN = 14.0;

type Child = {
    readonly title: string;
    readonly x: number;
    readonly y: number;
    readonly wide: number;
    readonly tall: number;
    readonly lines: readonly [string, string];
    readonly result: string;
    readonly done: number;
};

const CHILDREN: readonly Child[] = [
    {
        title: 'Request tracing',
        x: 318,
        y: 112,
        wide: 158,
        tall: 76,
        lines: ['$ trace /checkout', '38 requests, 4.1 s'],
        result: 'Shipping fetched per item',
        done: 5.8
    },
    { title: 'Query analysis', x: 336, y: 212, wide: 158, tall: 76, lines: ['$ explain cart', '12 cart queries'], result: 'Cart loaded 12 times', done: 4.4 },
    { title: 'Bundle size', x: 318, y: 312, wide: 158, tall: 76, lines: ['$ bun build', '212 kB gzip'], result: 'Bundle is 212 kB, fine', done: 7.2 }
];
// Results stack in the order they land, not the order they were asked for.
const ORDER = [...CHILDREN.keys()].sort((first, second) => CHILDREN[first]!.done - CHILDREN[second]!.done);
const SLOT_OF = new Int32Array(CHILDREN.length);
ORDER.forEach((child, slot) => {
    SLOT_OF[child] = slot;
});
const lift = (index: number) => CHILDREN[index]!.done + 0.15;
const fly = (index: number) => CHILDREN[index]!.done + 0.45;
const land = (index: number) => fly(index) + 0.85;
const ANSWER_LINES = ['Load the cart once and batch', 'the shipping call. The bundle', 'can stay as it is.'];
const ANSWER_WORDS = ANSWER_LINES.join(' ').split(' ').length;

// `.status-pulse`: 2s, down to half opacity and back.
const statusPulse = (time: number) => 0.75 + 0.25 * Math.cos((time * TAU) / 2);

// A spring's step response, for lifts and settles that have to stay a pure function of time.
const springStep = (elapsed: number, omega = 16, zeta = 0.5) => {
    if (elapsed <= 0) {
        return 0;
    }
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * elapsed) * (Math.cos(damped * elapsed) + ((zeta * omega) / damped) * Math.sin(damped * elapsed));
};

const parentX = (local: number) => {
    const out = inOutCubic((local - SLIDE) / 0.9);
    const back = inOutCubic((local - RETURN) / 0.9);
    return lerp(PX_CENTER, PX_LEFT, out * (1 - back));
};

const reveal = (local: number, start: number, duration = 0.35) => outCubic((local - start) / duration);

/* A connector route as polyline samples, so a pulse or a card can ride it by arc length. */
type Route = { xs: Float32Array; ys: Float32Array; ls: Float32Array; count: number; length: number };

const makeRoute = (): Route => ({ xs: new Float32Array(64), ys: new Float32Array(64), ls: new Float32Array(64), count: 0, length: 0 });

function routePush(route: Route, x: number, y: number): void {
    const index = route.count;
    route.xs[index] = x;
    route.ys[index] = y;
    route.ls[index] = index === 0 ? 0 : route.ls[index - 1]! + Math.hypot(x - route.xs[index - 1]!, y - route.ys[index - 1]!);
    route.count = index + 1;
    route.length = route.ls[index]!;
}

// Out of the right side of one node into the left side of the other, on a rail midway; every corner rounded.
function routeAcross(route: Route, ax: number, ay: number, bx: number, by: number, corner = 12): Route {
    route.count = 0;
    routePush(route, ax, ay);
    const mid = (ax + bx) / 2;
    const dy = by - ay;
    if (Math.abs(dy) < 0.5) {
        routePush(route, bx, by);
        return route;
    }
    const radius = Math.min(corner, Math.abs(dy) / 2, (bx - ax) / 4);
    const sign = Math.sign(dy);
    const corners = [
        [mid - radius, ay, mid, ay, mid, ay + sign * radius],
        [mid, by - sign * radius, mid, by, mid + radius, by]
    ] as const;
    for (const [x0, y0, cx, cy, x1, y1] of corners) {
        routePush(route, x0, y0);
        for (let step = 1; step <= 8; step++) {
            const frac = step / 8;
            const inv = 1 - frac;
            routePush(route, inv * inv * x0 + 2 * inv * frac * cx + frac * frac * x1, inv * inv * y0 + 2 * inv * frac * cy + frac * frac * y1);
        }
    }
    routePush(route, bx, by);
    return route;
}

export type Delegation = {
    /** Advances hover and the pointer's ease. `pointer` is the hero's own, -1..1 over its container. */
    update: (time: number, delta: number, pointer: Pointer) => void;
    /** Draws the frame for `time` into the 560 x 500 box the caller has transformed the context onto. */
    draw: (time: number) => void;
};

export function createDelegation(ctx: CanvasRenderingContext2D, fonts: Fonts): Delegation {
    const claude = new Path2D(CLAUDE_PATH);
    const widths = new Map<string, number>();
    const routes = CHILDREN.map(() => makeRoute());
    const hover = new Float32Array(CHILDREN.length + 1);
    const cx = new Float32Array(CHILDREN.length);
    const cy = new Float32Array(CHILDREN.length);
    const calpha = new Float32Array(CHILDREN.length);
    const cgrow = new Float32Array(CHILDREN.length);
    // In box units, eased the way the reel's runner eases it; it drifts back to the middle once the pointer leaves.
    const pointer = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, active: 0, nx: 0, ny: 0 };

    const sans = (size: number, weight = 400) => {
        ctx.font = `${weight} ${size}px ${fonts.sans}`;
    };
    const mono = (size: number, weight = 400) => {
        ctx.font = `${weight} ${size}px ${fonts.mono}`;
    };
    // Widths are cached only once the fonts are in, so a fallback face never sticks.
    const measure = (text: string) => {
        const key = `${ctx.font}|${text}`;
        let width = widths.get(key);
        if (width === undefined) {
            width = ctx.measureText(text).width;
            if (document.fonts.status === 'loaded') {
                widths.set(key, width);
            }
        }
        return width;
    };
    const roundRect = (x: number, y: number, wide: number, tall: number, radius: number) => {
        const clipped = Math.max(0, Math.min(radius, Math.abs(wide) / 2, Math.abs(tall) / 2));
        ctx.beginPath();
        ctx.moveTo(x + clipped, y);
        ctx.arcTo(x + wide, y, x + wide, y + tall, clipped);
        ctx.arcTo(x + wide, y + tall, x, y + tall, clipped);
        ctx.arcTo(x, y + tall, x, y, clipped);
        ctx.arcTo(x, y, x + wide, y, clipped);
        ctx.closePath();
    };
    const claudeMark = (x: number, y: number, size: number, color: string) => {
        ctx.save();
        ctx.translate(x - size / 2, y - size / 2);
        ctx.scale(size / 24, size / 24);
        ctx.fillStyle = color;
        ctx.fill(claude);
        ctx.restore();
    };
    const disc = (x: number, y: number, radius: number, color: string) => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.fillStyle = color;
        ctx.fill();
    };
    // `.shine`: a light band crosses the muted words of whatever is working.
    const shine = (text: string, x: number, y: number, time: number) => {
        const width = measure(text);
        const band = Math.max(18, width * 0.35);
        const center = x - band + fract(time / 1.5) * (width + band * 2);
        const gradient = ctx.createLinearGradient(center - band, 0, center + band, 0);
        gradient.addColorStop(0, rgba(PAL.muted));
        gradient.addColorStop(0.5, rgba(PAL.text));
        gradient.addColorStop(1, rgba(PAL.muted));
        ctx.fillStyle = gradient;
        ctx.fillText(text, x, y);
    };
    // Lucide `circle-check`: the ring draws, then the tick, as `progress` runs 0..1.
    const circleCheck = (x: number, y: number, size: number, color: string, progress: number, lineWidth: number) => {
        const unit = size / 24;
        const around = clamp(progress / 0.55);
        const tick = clamp((progress - 0.45) / 0.55);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (around > 0) {
            ctx.beginPath();
            ctx.arc(x, y, 10 * unit, -Math.PI / 2, -Math.PI / 2 + TAU * around);
            ctx.stroke();
        }
        if (tick > 0) {
            // m9 12 2 2 4-4: a short leg of 2.83 and a long one of 5.66, drawn as one stroke.
            const first = 2.83 / 8.49;
            ctx.beginPath();
            ctx.moveTo(x - 3 * unit, y);
            if (tick < first) {
                const frac = tick / first;
                ctx.lineTo(x + (-3 + 2 * frac) * unit, y + 2 * frac * unit);
            } else {
                const frac = (tick - first) / (1 - first);
                ctx.lineTo(x - 1 * unit, y + 2 * unit);
                ctx.lineTo(x + (-1 + 4 * frac) * unit, y + (2 - 4 * frac) * unit);
            }
            ctx.stroke();
        }
    };
    const shadowOn = (raise = 0) => {
        ctx.shadowColor = `rgba(0,0,0,${0.42 + raise * 0.04})`;
        ctx.shadowBlur = 14 + raise * 2.5;
        ctx.shadowOffsetY = 4 + raise * 1.2;
    };
    const shadowOff = () => {
        ctx.shadowColor = 'rgba(0,0,0,0)';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
    };
    /* `CanvasNode`: a surface card with a raised header strip, a hairline under it and a hairline border. */
    const nodeFrame = (x: number, y: number, wide: number, tall: number, header: number, raise: number, border: number) => {
        shadowOn(raise);
        roundRect(x, y, wide, tall, 9);
        ctx.fillStyle = PAL.surface;
        ctx.fill();
        shadowOff();
        ctx.save();
        roundRect(x, y, wide, tall, 9);
        ctx.clip();
        ctx.fillStyle = PAL.raised;
        ctx.fillRect(x, y, wide, header);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(x, y + header - 0.5, wide, 1);
        ctx.restore();
        roundRect(x + 0.5, y + 0.5, wide - 1, tall - 1, 8.5);
        ctx.strokeStyle = `rgba(255,255,255,${border})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    };
    const nodeTitle = (x: number, y: number, header: number, title: string, size: number) => {
        claudeMark(x + 13, y + header / 2, 11, PAL.muted);
        sans(size, 500);
        ctx.fillStyle = PAL.text;
        ctx.textBaseline = 'middle';
        ctx.fillText(title, x + 25, y + header / 2 + 0.5);
        ctx.textBaseline = 'alphabetic';
    };
    /* The canvas ground: a neutral dot every 24 units, never tinted. */
    const grid = (offsetX: number, offsetY: number) => {
        const pitch = 24;
        const startX = mod(offsetX, pitch) - pitch;
        const startY = mod(offsetY, pitch) - pitch;
        ctx.beginPath();
        for (let y = startY; y < H + pitch; y += pitch) {
            for (let x = startX; x < W + pitch; x += pitch) {
                ctx.rect(x - 0.6, y - 0.6, 1.2, 1.2);
            }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.075)';
        ctx.fill();
    };
    const at = { x: 0, y: 0 };
    const routeAt = (route: Route, position: number) => {
        const along = clamp(position, 0, route.length);
        let index = 1;
        while (index < route.count - 1 && route.ls[index]! < along) {
            index++;
        }
        const before = route.ls[index - 1]!;
        const span = route.ls[index]! - before || 1;
        const frac = (along - before) / span;
        at.x = route.xs[index - 1]! + (route.xs[index]! - route.xs[index - 1]!) * frac;
        at.y = route.ys[index - 1]! + (route.ys[index]! - route.ys[index - 1]!) * frac;
        return at;
    };
    // Strokes the stretch of a route between two arc lengths.
    const strokeRoute = (route: Route, from: number, to: number) => {
        if (to <= from) {
            return;
        }
        ctx.beginPath();
        routeAt(route, from);
        ctx.moveTo(at.x, at.y);
        for (let i = 1; i < route.count; i++) {
            if (route.ls[i]! > from && route.ls[i]! < to) {
                ctx.lineTo(route.xs[i]!, route.ys[i]!);
            }
        }
        routeAt(route, to);
        ctx.lineTo(at.x, at.y);
        ctx.stroke();
    };
    // The marker at a connector's head: a ring filled with the ground, so the line seems to end in a socket.
    const headDot = (x: number, y: number, color: string, alpha: number) => {
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, TAU);
        ctx.fillStyle = GROUND;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();
    };
    // Where a child is: out from under the parent on a spring, and back under it with a small wind-up.
    const childAt = (index: number, local: number, px: number) => {
        const child = CHILDREN[index]!;
        const start = SPAWN + index * 0.13;
        const gatherAt = GATHER + (CHILDREN.length - 1 - index) * 0.12;
        const out = springStep(local - start, 11, 0.58);
        const inv = clamp((local - gatherAt) / 0.65);
        const back = inBack(inv, 1.4);
        const progress = out * (1 - back);
        const hx = px + PW - child.wide - 12;
        const hy = PY + PH / 2 - child.tall / 2;
        cx[index] = lerp(hx, child.x, progress);
        cy[index] = lerp(hy, child.y, progress);
        calpha[index] = clamp((local - start) / 0.2) * (1 - clamp((inv - 0.45) / 0.4));
        cgrow[index] = clamp(progress);
    };
    const drawBubble = (x: number, y: number, wide: number) => {
        sans(12, 400);
        const lines = ['Checkout takes 4 seconds.', 'Find out why.'];
        let widest = 0;
        for (const line of lines) {
            widest = Math.max(widest, measure(line));
        }
        const bubbleWidth = widest + 22;
        const bubbleX = x + wide - 10 - bubbleWidth;
        roundRect(bubbleX, y, bubbleWidth, 40, 11);
        ctx.fillStyle = ACTIVE;
        ctx.fill();
        ctx.fillStyle = PAL.text;
        ctx.fillText(lines[0]!, bubbleX + 11, y + 17);
        ctx.fillText(lines[1]!, bubbleX + 11, y + 32);
    };
    const terminalGlyph = (x: number, y: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 3);
        ctx.lineTo(x - 1, y);
        ctx.lineTo(x - 4, y + 3);
        ctx.moveTo(x + 1, y + 3.5);
        ctx.lineTo(x + 4.5, y + 3.5);
        ctx.stroke();
    };
    // A result as a chip: in flight it is a raised card with a shadow, in the parent it is a sunken row.
    const drawResult = (x: number, y: number, wide: number, text: string, landed: number, alpha: number) => {
        ctx.globalAlpha = alpha;
        if (landed < 1) {
            shadowOn(2 * (1 - landed));
        }
        roundRect(x, y, wide, 21, 6);
        ctx.fillStyle = mix(PAL.raised, PAL.sunken, landed);
        ctx.fill();
        shadowOff();
        roundRect(x + 0.5, y + 0.5, wide - 1, 20, 5.5);
        ctx.strokeStyle = `rgba(255,255,255,${0.13 - 0.07 * landed})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        circleCheck(x + 11, y + 10.5, 11, PAL.idle, 1, 1.4);
        sans(11.5, 400);
        ctx.fillStyle = mix(PAL.text, PAL.muted, landed * 0.4);
        ctx.fillText(text, x + 21, y + 14.5);
        ctx.globalAlpha = 1;
    };
    // Dissolves everything drawn so far toward the edges of the box, so it sits on the page without a frame.
    const fadeEdges = (inner: number, outer: number) => {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.translate(W / 2, H / 2);
        ctx.scale(1, H / W);
        const gradient = ctx.createRadialGradient(0, 0, (W / 2) * inner, 0, 0, (W / 2) * outer);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(-W, -W, W * 2, W * 2);
        ctx.restore();
    };

    return {
        update(time, delta, hero) {
            const inside = hero.active > 0;
            if (inside) {
                pointer.tx = ((hero.x + 1) / 2) * W;
                pointer.ty = ((hero.y + 1) / 2) * H;
            } else {
                pointer.tx = lerp(pointer.tx, W / 2, 1 - Math.exp(-delta * 1.5));
                pointer.ty = lerp(pointer.ty, H / 2, 1 - Math.exp(-delta * 1.5));
            }
            const follow = 1 - Math.exp(-delta * 9);
            pointer.x += (pointer.tx - pointer.x) * follow;
            pointer.y += (pointer.ty - pointer.y) * follow;
            pointer.active += ((inside ? 1 : 0) - pointer.active) * (1 - Math.exp(-delta * 5));
            pointer.nx = (pointer.x / W) * 2 - 1;
            pointer.ny = (pointer.y / H) * 2 - 1;

            const local = mod(time, CYCLE);
            const px = parentX(local);
            let nearest = -1;
            const over = (x: number, y: number, wide: number, tall: number) =>
                pointer.x > x - 10 && pointer.x < x + wide + 10 && pointer.y > y - 10 && pointer.y < y + tall + 10;
            for (let i = 0; i < CHILDREN.length; i++) {
                childAt(i, local, px);
                if (calpha[i]! > 0.5 && over(cx[i]!, cy[i]!, CHILDREN[i]!.wide, CHILDREN[i]!.tall)) {
                    nearest = i;
                }
            }
            if (nearest < 0 && over(px, PY, PW, PH)) {
                nearest = CHILDREN.length;
            }
            const smoothing = 1 - Math.exp(-delta * 9);
            for (let i = 0; i <= CHILDREN.length; i++) {
                const target = i === nearest ? pointer.active : 0;
                hover[i] = hover[i]! + (target - hover[i]!) * smoothing;
            }
        },
        draw(time) {
            const local = mod(time, CYCLE);
            const ox = pointer.nx * 5 * pointer.active;
            const oy = pointer.ny * 4 * pointer.active;
            grid(ox * 0.5, oy * 0.5);
            ctx.save();
            ctx.translate(ox, oy);

            const px = parentX(local);
            // The lead dims while its team works, so the eye follows whatever moves.
            const waiting = local > SPAWN + 0.6 && local < ANSWER - 0.2;
            const leadFocus = 1 - 0.25 * smoothstep(SPAWN + 0.4, SPAWN + 1.0, local) * (1 - smoothstep(ANSWER - 0.6, ANSWER, local));

            for (let i = 0; i < CHILDREN.length; i++) {
                childAt(i, local, px);
            }

            /* Task connectors: dashed while a child works, solid once its result is back. */
            ctx.lineCap = 'round';
            for (let i = 0; i < CHILDREN.length; i++) {
                const child = CHILDREN[i]!;
                const alpha = calpha[i]!;
                const grow = cgrow[i]!;
                if (alpha <= 0) {
                    continue;
                }
                const route = routeAcross(routes[i]!, px + PW + 6, PY + PH / 2, cx[i]! - 6, cy[i]! + child.tall / 2);
                const drawn = route.length * clamp(grow * 1.1);
                const solid = local >= land(i);
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = EDGE_CONTEXT;
                ctx.lineWidth = 1.5;
                ctx.setLineDash(solid ? [] : [4, 4]);
                strokeRoute(route, 0, drawn);
                ctx.setLineDash([]);
                ctx.globalAlpha = 1;
                if (grow > 0.85) {
                    headDot(cx[i]! - 6, cy[i]! + child.tall / 2, EDGE_CONTEXT, alpha * clamp((grow - 0.85) / 0.15));
                }
            }

            /* The team, drawn under the lead so it slides out from beneath it. */
            for (let i = 0; i < CHILDREN.length; i++) {
                const child = CHILDREN[i]!;
                const alpha = calpha[i]!;
                const lifted = hover[i]!;
                if (alpha <= 0) {
                    continue;
                }
                const finished = local >= child.done;
                const x = cx[i]! + lifted * -2;
                const y = cy[i]! - lifted * 3;
                ctx.globalAlpha = alpha;
                const settleDim = finished ? 1 - 0.3 * smoothstep(land(i), land(i) + 0.6, local) : 1;
                nodeFrame(x, y, child.wide, child.tall, CHILD_HEADER, lifted * 2, 0.1 + lifted * 0.1);
                ctx.globalAlpha = alpha * settleDim;
                nodeTitle(x, y, CHILD_HEADER, child.title, 11.5);
                const dotX = x + child.wide - 11;
                const dotY = y + CHILD_HEADER / 2;
                if (finished) {
                    const pop = 1 + 0.5 * Math.sin(clamp((local - child.done) / 0.3) * Math.PI);
                    disc(dotX, dotY, 3.2 * pop, PAL.idle);
                } else {
                    ctx.globalAlpha = alpha * statusPulse(time + i * 0.4);
                    disc(dotX, dotY, 3.2, PAL.running);
                }
                ctx.globalAlpha = alpha * settleDim;
                const start = SPAWN + i * 0.13 + 0.55;
                mono(10.5, 400);
                for (let row = 0; row < 2; row++) {
                    const shownAt = row === 0 ? start : lerp(start, child.done, 0.55);
                    const amount = reveal(local, shownAt, 0.3);
                    if (amount <= 0) {
                        continue;
                    }
                    ctx.globalAlpha = alpha * settleDim * amount;
                    ctx.fillStyle = row === 0 ? PAL.termDim : PAL.termFg;
                    ctx.fillText(child.lines[row]!, x + 10, y + CHILD_HEADER + 17 + row * 15 + (1 - amount) * 3);
                }
                sans(11.5, 400);
                const lineY = y + CHILD_HEADER + 47;
                if (finished) {
                    const amount = reveal(local, child.done, 0.3);
                    ctx.globalAlpha = alpha * settleDim * amount;
                    circleCheck(x + 15, lineY - 4, 10, PAL.idle, clamp((local - child.done) / 0.4), 1.3);
                    ctx.fillStyle = PAL.idle;
                    ctx.fillText('Task done', x + 24, lineY);
                } else {
                    ctx.globalAlpha = alpha * reveal(local, start, 0.3);
                    shine('Working', x + 10, lineY, time + i * 0.5);
                }
                ctx.globalAlpha = 1;
            }

            /* The lead. */
            const hoverLead = hover[CHILDREN.length]!;
            const leadY = PY - hoverLead * 3;
            nodeFrame(px, leadY, PW, PH, HEADER, 2 + hoverLead * 2, 0.11 + hoverLead * 0.08);
            ctx.globalAlpha = leadFocus;
            nodeTitle(px, leadY, HEADER, 'Speed up checkout', 12.5);
            const dotX = px + PW - 13;
            const dotY = leadY + HEADER / 2;
            if (local >= DONE && local < THINK_AGAIN) {
                const pop = 1 + 0.5 * Math.sin(clamp((local - DONE) / 0.3) * Math.PI);
                ctx.globalAlpha = 1;
                disc(dotX, dotY, 3.4 * pop, PAL.idle);
            } else if (waiting) {
                // Asleep while it waits; each result that lands wakes it for a moment.
                let woke = 0;
                for (let i = 0; i < CHILDREN.length; i++) {
                    const since = local - land(i);
                    if (since > 0 && since < 0.9) {
                        woke = Math.max(woke, Math.sin((since / 0.9) * Math.PI));
                    }
                }
                ctx.globalAlpha = lerp(0.45 + 0.2 * Math.sin((time * TAU) / 3.2), 1, woke);
                disc(dotX, dotY, 3.4, mix(PAL.faint, PAL.running, woke));
            } else {
                ctx.globalAlpha = statusPulse(time);
                disc(dotX, dotY, 3.4, PAL.running);
            }
            ctx.globalAlpha = leadFocus;

            const x0 = px + 10;
            let y0 = leadY + HEADER + 10;
            drawBubble(px, y0, PW);
            y0 += 50;

            // Everything the turn added collapses upward from the bottom, a row at a time.
            const clearOf = (row: number) => 1 - inOutCubic((local - (CLEAR + (4 - row) * 0.08)) / 0.4);
            const tool = Math.min(reveal(local, 1.3), clearOf(0));
            const thinking = 1 - reveal(local, 1.2, 0.25) + reveal(local, THINK_AGAIN, 0.5);
            sans(12, 400);
            if (thinking > 0.01) {
                ctx.globalAlpha = leadFocus * clamp(thinking);
                shine('Thinking', x0, y0 + 13, time);
            }
            if (tool > 0.01) {
                ctx.globalAlpha = leadFocus * tool;
                const toolY = y0 + (1 - tool) * 4;
                terminalGlyph(x0 + 5, toolY + 9, PAL.muted);
                ctx.fillStyle = PAL.muted;
                ctx.fillText('Started', x0 + 16, toolY + 13);
                const wide = measure('Started');
                mono(11, 400);
                ctx.fillStyle = PAL.faint;
                ctx.fillText('3 agents', x0 + 22 + wide, toolY + 13);
                sans(12, 400);
            }
            y0 += 26;

            // The stack grows by one row per result; what sits under it is pushed down on a spring.
            let rows = 0;
            for (let position = 0; position < CHILDREN.length; position++) {
                // The room opens while the result is still on its way, so it lands in a gap and not on a row.
                rows += springStep(local - (land(ORDER[position]!) - 0.4), 12, 0.55);
            }
            rows *= clamp(clearOf(1) * 1.4 - 0.4);
            for (let i = 0; i < CHILDREN.length; i++) {
                const child = CHILDREN[i]!;
                const slot = SLOT_OF[i]!;
                const slotY = y0 + slot * 25;
                const out = clearOf(1 + (slot === 2 ? 0 : slot === 1 ? 0.5 : 1));
                if (local < lift(i) || out <= 0) {
                    continue;
                }
                const frac = clamp((local - fly(i)) / (land(i) - fly(i)));
                if (local < fly(i)) {
                    // The result peels off the child: a small rise before it goes.
                    const amount = outCubic((local - lift(i)) / 0.3);
                    drawResult(cx[i]! + 8, cy[i]! + child.tall - 25 - amount * 7, child.wide - 16, child.result, 0, amount * calpha[i]!);
                    continue;
                }
                if (frac < 1) {
                    // Launched up and away from the child, it comes into its slot level, from the right.
                    const e = inOutCubic(frac);
                    const sx = cx[i]! + 8;
                    const sy = cy[i]! + child.tall - 32;
                    const ex = x0;
                    const ey = slotY;
                    const inv = 1 - e;
                    const c1x = sx - 30;
                    const c1y = sy - 50;
                    const c2x = ex + 90;
                    const c2y = ey;
                    const x = inv * inv * inv * sx + 3 * inv * inv * e * c1x + 3 * inv * e * e * c2x + e * e * e * ex;
                    const y = inv * inv * inv * sy + 3 * inv * inv * e * c1y + 3 * inv * e * e * c2y + e * e * e * ey;
                    const wide = lerp(child.wide - 16, PW - 20, e);
                    ctx.save();
                    // It leans into the curve and straightens as it lands.
                    const lean = Math.sin(frac * Math.PI) * 0.06;
                    ctx.translate(x + wide / 2, y + 10);
                    ctx.rotate(lean);
                    ctx.translate(-(x + wide / 2), -(y + 10));
                    drawResult(x, y, wide, child.result, 0, 1);
                    ctx.restore();
                    continue;
                }
                const settle = springStep(local - land(i), 18, 0.35);
                const squash = (1 - settle) * 3;
                drawResult(x0, slotY + squash + (1 - out) * -6, PW - 20, child.result, clamp((local - land(i)) / 0.5), leadFocus * out);
            }
            y0 += rows * 25 + 4;

            // Below the stack: how many tasks are still out, then the one answer.
            if (local > SPAWN + 0.4 && local < ANSWER) {
                let open = 0;
                for (let i = 0; i < CHILDREN.length; i++) {
                    if (land(i) > local) {
                        open++;
                    }
                }
                const amount = reveal(local, SPAWN + 0.4) * (1 - clamp((local - (ANSWER - 0.3)) / 0.3));
                ctx.globalAlpha = leadFocus * amount;
                ctx.fillStyle = PAL.faint;
                sans(12, 400);
                ctx.fillText(open > 0 ? `Waiting on ${open}${open === 1 ? ' task' : ' tasks'}` : 'Reading results', x0, y0 + 13);
            }
            if (local >= ANSWER) {
                const shown = clamp((local - ANSWER) / ANSWER_LEN) * ANSWER_WORDS;
                const out = clearOf(2);
                let word = 0;
                sans(12, 400);
                ctx.fillStyle = PAL.text;
                for (let line = 0; line < ANSWER_LINES.length; line++) {
                    let x = x0;
                    for (const piece of ANSWER_LINES[line]!.split(' ')) {
                        const amount = clamp(shown - word);
                        word++;
                        if (amount <= 0) {
                            break;
                        }
                        ctx.globalAlpha = amount * out;
                        ctx.fillText(piece, x, y0 + 13 + line * 16 + (1 - amount) * 2 - (1 - out) * 6);
                        x += measure(`${piece} `);
                    }
                }
            }
            ctx.globalAlpha = 1;
            ctx.restore();
            fadeEdges(0.72, 1.0);
        }
    };
}
