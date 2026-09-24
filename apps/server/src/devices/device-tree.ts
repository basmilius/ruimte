import { z } from 'zod';

export interface ElementFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

/* One element on a device's screen; the frame in pixels of the screen, which a shot has too. */
export interface DeviceTreeNode {
    role: string;
    subrole: string | null;
    label: string | null;
    value: string | null;
    identifier: string | null;
    frame: ElementFrame;
    enabled: boolean;
    children: DeviceTreeNode[];
}

/* The accessibility tree of what a device shows; `truncated` when the reader stopped before the end. */
export interface DeviceTree {
    screen: { width: number; height: number };
    root: DeviceTreeNode;
    truncated: boolean;
}

/* An element as a state lists it: its handle is its place in the tree, counted depth first from the root. */
export interface DeviceElement {
    handle: number;
    depth: number;
    parent: number | null;
    role: string;
    subrole: string | null;
    label: string | null;
    value: string | null;
    identifier: string | null;
    frame: ElementFrame;
    enabled: boolean;
    offscreen: boolean;
}

/* Text that only holds white space says nothing, the single space the iOS home screen labels itself with included. */
export const textOf = (value: string | null | undefined): string | null => (value === null || value === undefined || value.trim() === '' ? null : value);

const intersects = (frame: ElementFrame, screen: { width: number; height: number }): boolean =>
    frame.x < screen.width && frame.y < screen.height && frame.x + frame.width > 0 && frame.y + frame.height > 0;

export const flattenTree = (tree: DeviceTree): DeviceElement[] => {
    const elements: DeviceElement[] = [];
    const visit = (node: DeviceTreeNode, depth: number, parent: number | null): void => {
        const handle = elements.length;
        elements.push({
            handle,
            depth,
            parent,
            role: node.role,
            subrole: node.subrole,
            label: node.label,
            value: node.value,
            identifier: node.identifier,
            frame: node.frame,
            enabled: node.enabled,
            offscreen: !intersects(node.frame, tree.screen)
        });
        for (const child of node.children) {
            visit(child, depth + 1, handle);
        }
    };
    visit(tree.root, 0, null);
    return elements;
};

/* The elements whose label, value or identifier holds the text, ignoring case, with every element they sit in. */
export const findElements = (elements: readonly DeviceElement[], text: string): { elements: DeviceElement[]; matches: number } => {
    const needle = text.toLowerCase();
    const holds = (element: DeviceElement): boolean =>
        [element.label, element.value, element.identifier].some((candidate) => candidate !== null && candidate.toLowerCase().includes(needle));
    const kept = new Set<number>();
    let matches = 0;
    for (const element of elements) {
        if (!holds(element)) {
            continue;
        }
        matches += 1;
        for (let handle: number | null = element.handle; handle !== null && !kept.has(handle); handle = elements[handle]!.parent) {
            kept.add(handle);
        }
    }
    return { elements: elements.filter((element) => kept.has(element.handle)), matches };
};

/* The pixel a tap on an element lands on: the middle of its frame. */
export const centerOf = (element: Pick<DeviceElement, 'frame'>): { x: number; y: number } => ({
    x: element.frame.x + element.frame.width / 2,
    y: element.frame.y + element.frame.height / 2
});

const BridgeFrameSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

interface BridgeNode {
    role: string | null;
    subrole: string | null;
    label: string | null;
    value: string | null;
    identifier: string | null;
    frame: ElementFrame;
    enabled: boolean;
    children: BridgeNode[];
}

const BridgeNodeSchema: z.ZodType<BridgeNode> = z.lazy(() =>
    z.object({
        role: z.string().nullable(),
        subrole: z.string().nullable(),
        label: z.string().nullable(),
        value: z.string().nullable(),
        identifier: z.string().nullable(),
        frame: BridgeFrameSchema,
        enabled: z.boolean(),
        children: z.array(BridgeNodeSchema)
    })
);

/* What the device bridge answers a tree request with, in device points. */
export const SimulatorTreeReplySchema = z.object({
    type: z.literal('tree'),
    id: z.number().int(),
    scale: z.number().positive().nullable(),
    root: BridgeNodeSchema,
    truncated: z.boolean(),
    ms: z.number()
});

export type SimulatorTreeReply = z.infer<typeof SimulatorTreeReplySchema>;

/* `AXButton` reads as `Button`, the way a state of an app on this Mac names it. */
const roleName = (role: string | null): string | null => {
    const text = textOf(role);
    return text === null ? null : text.replace(/^AX(?=[A-Z])/, '');
};

/*
 * A simulator's tree in pixels of its screen. The bridge counts in points, and a shot is taken in
 * pixels, so every frame is scaled; a bridge that knows no scale leaves them in points, which still
 * taps right because a tap is a share of the screen.
 */
export const simulatorTree = (reply: SimulatorTreeReply): DeviceTree => {
    const scale = reply.scale ?? 1;
    const convert = (node: BridgeNode): DeviceTreeNode => ({
        role: roleName(node.role) ?? 'Unknown',
        subrole: roleName(node.subrole),
        label: textOf(node.label),
        value: textOf(node.value),
        identifier: textOf(node.identifier),
        frame: { x: node.frame.x * scale, y: node.frame.y * scale, width: node.frame.width * scale, height: node.frame.height * scale },
        enabled: node.enabled,
        children: node.children.map(convert)
    });
    const root = convert(reply.root);
    return { screen: { width: Math.round(root.frame.width), height: Math.round(root.frame.height) }, root, truncated: reply.truncated };
};
