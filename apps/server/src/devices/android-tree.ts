import { textOf, type DeviceTree, type DeviceTreeNode } from './device-tree.ts';

const TAG = /<(\/)?(node|hierarchy)\b((?:\s+[\w:.-]+="[^"]*")*)\s*(\/)?>/g;
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/g;
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescape = (value: string): string =>
    value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) => {
        if (name.startsWith('#x') || name.startsWith('#X')) {
            return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
        }
        if (name.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
        }
        return ENTITIES[name] ?? entity;
    });

const attributesOf = (source: string): Map<string, string> => {
    const attributes = new Map<string, string>();
    for (const [, name, value] of source.matchAll(ATTRIBUTE)) {
        attributes.set(name!, unescape(value!));
    }
    return attributes;
};

interface RawNode {
    attributes: Map<string, string>;
    children: RawNode[];
}

/* A dump's nodes, and how far its screen is turned, which only the hierarchy tag says. */
interface Dump {
    rotation: number;
    nodes: RawNode[];
}

/* Reads the XML `uiautomator dump` writes, and nothing else: one hierarchy of nodes, every value in double quotes. */
const readDump = (xml: string): Dump | null => {
    const start = xml.indexOf('<hierarchy');
    if (start === -1) {
        return null;
    }
    const top: RawNode[] = [];
    const open: RawNode[] = [];
    let rotation = 0;
    for (const [, closing, name, attributes, selfClosing] of xml.slice(start).matchAll(TAG)) {
        if (name === 'hierarchy') {
            if (closing === undefined) {
                rotation = Number(attributesOf(attributes ?? '').get('rotation') ?? 0) || 0;
            }
            continue;
        }
        if (closing !== undefined) {
            open.pop();
            continue;
        }
        const node: RawNode = { attributes: attributesOf(attributes ?? ''), children: [] };
        (open.at(-1)?.children ?? top).push(node);
        if (selfClosing === undefined) {
            open.push(node);
        }
    }
    return { rotation, nodes: top };
};

/* `android.widget.Button` reads as `Button`. */
const roleOf = (className: string): string => className.slice(className.lastIndexOf('.') + 1) || 'View';

const yes = (attributes: Map<string, string>, name: string): boolean => attributes.get(name) === 'true';

/*
 * A node a person could read or use: one that says something or does something when touched. The
 * layouts in between, ids and all, say nothing, so their children take their place.
 */
const worthKeeping = (node: DeviceTreeNode, attributes: Map<string, string>): boolean =>
    node.label !== null || node.value !== null || ['clickable', 'long-clickable', 'scrollable', 'checkable'].some((name) => yes(attributes, name));

const convert = (raw: RawNode): DeviceTreeNode[] => {
    const { attributes } = raw;
    const children = raw.children.flatMap(convert);
    const role = roleOf(attributes.get('class') ?? '');
    const text = textOf(attributes.get('text'));
    const description = textOf(attributes.get('content-desc'));
    const field = role.endsWith('EditText');
    let label: string | null;
    let value: string | null;
    if (field) {
        label = description ?? textOf(attributes.get('hint'));
        value = text;
    } else {
        label = description ?? text;
        value = description !== null && text !== description ? text : null;
    }
    if (yes(attributes, 'checkable')) {
        value = yes(attributes, 'checked') ? 'on' : 'off';
    }
    const bounds = BOUNDS.exec(attributes.get('bounds') ?? '');
    const [left, top, right, bottom] = bounds === null ? [0, 0, 0, 0] : bounds.slice(1).map(Number);
    const node: DeviceTreeNode = {
        role,
        subrole: null,
        label,
        value,
        identifier: textOf(attributes.get('resource-id')),
        frame: { x: left!, y: top!, width: Math.max(0, right! - left!), height: Math.max(0, bottom! - top!) },
        enabled: attributes.get('enabled') !== 'false',
        children
    };
    return worthKeeping(node, attributes) ? [node] : children;
};

/*
 * An Android screen as a tree in pixels, the unit of its bounds and of a screencap. `screen` is the
 * display as `wm size` reports it, upright; a dump taken on its side turns it.
 */
export const androidTree = (xml: string, screen: { width: number; height: number }): DeviceTree | null => {
    const dump = readDump(xml);
    if (dump === null) {
        return null;
    }
    const sideways = dump.rotation === 1 || dump.rotation === 3;
    const size = sideways ? { width: screen.height, height: screen.width } : screen;
    return {
        screen: size,
        truncated: false,
        root: {
            role: 'Application',
            subrole: null,
            label: textOf(dump.nodes[0]?.attributes.get('package')),
            value: null,
            identifier: null,
            frame: { x: 0, y: 0, ...size },
            enabled: true,
            children: dump.nodes.flatMap(convert)
        }
    };
};

/* The size `wm size` reports, the override a person set before the panel's own. */
export const parseWmSize = (output: string): { width: number; height: number } | null => {
    const sizes = [...output.matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/g)];
    const chosen = sizes.find((match) => match[1] === 'Override') ?? sizes[0];
    return chosen === undefined ? null : { width: Number(chosen[2]), height: Number(chosen[3]) };
};
