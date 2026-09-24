import { describe, expect, test } from 'bun:test';
import { SAMPLE_TREE } from './device-test-helpers.ts';
import { centerOf, findElements, flattenTree, simulatorTree, SimulatorTreeReplySchema, textOf } from './device-tree.ts';

/* What the bridge answered for the Settings app of an iPhone simulator, cut down to three elements. */
const BRIDGE_REPLY = {
    type: 'tree',
    id: 3,
    scale: 3,
    root: {
        role: 'AXApplication',
        subrole: null,
        label: ' ',
        value: null,
        identifier: null,
        frame: { x: 0, y: 0, width: 402, height: 874 },
        enabled: true,
        children: [
            {
                role: 'AXButton',
                subrole: null,
                label: 'General',
                value: '',
                identifier: 'com.apple.settings.general',
                frame: { x: 16, y: 398.3333333333333, width: 370, height: 52 },
                enabled: true,
                children: []
            },
            {
                role: 'AXTextField',
                subrole: 'AXSearchField',
                label: null,
                value: 'Search',
                identifier: null,
                frame: { x: 28, y: 808, width: 346, height: 28 },
                enabled: false,
                children: []
            }
        ]
    },
    truncated: false,
    ms: 34
};

describe('simulatorTree', () => {
    test('counts in pixels of the screen, names roles without their prefix and drops empty text', () => {
        const tree = simulatorTree(SimulatorTreeReplySchema.parse(BRIDGE_REPLY));
        expect(tree.screen).toEqual({ width: 1206, height: 2622 });
        expect(tree.root.label).toBeNull();
        expect(tree.root.children[0]).toEqual({
            role: 'Button',
            subrole: null,
            label: 'General',
            value: null,
            identifier: 'com.apple.settings.general',
            frame: { x: 48, y: 1195, width: 1110, height: 156 },
            enabled: true,
            children: []
        });
        expect(tree.root.children[1]).toMatchObject({ role: 'TextField', subrole: 'SearchField', value: 'Search', enabled: false });
    });

    test('leaves frames in points when the bridge knows no scale', () => {
        const tree = simulatorTree(SimulatorTreeReplySchema.parse({ ...BRIDGE_REPLY, scale: null }));
        expect(tree.screen).toEqual({ width: 402, height: 874 });
    });

    test('refuses a reply that is not a tree', () => {
        expect(SimulatorTreeReplySchema.safeParse({ ...BRIDGE_REPLY, root: { role: 'AXApplication' } }).success).toBe(false);
    });

    test('treats white space as no text', () => {
        expect(textOf(' \n')).toBeNull();
        expect(textOf(undefined)).toBeNull();
        expect(textOf(' Wi-Fi ')).toBe(' Wi-Fi ');
    });
});

describe('flattenTree', () => {
    test('numbers the elements depth first and marks those off the screen', () => {
        const elements = flattenTree(SAMPLE_TREE);
        expect(elements.map((element) => [element.handle, element.depth, element.parent, element.label])).toEqual([
            [0, 0, null, 'Settings'],
            [1, 1, 0, 'Settings'],
            [2, 1, 0, null],
            [3, 2, 2, 'General'],
            [4, 2, 2, 'Wi-Fi'],
            [5, 2, 2, 'Privacy'],
            [6, 1, 0, 'Done']
        ]);
        expect(elements.filter((element) => element.offscreen).map((element) => element.handle)).toEqual([5]);
        expect(centerOf(elements[3]!)).toEqual({ x: 500, y: 565 });
    });
});

describe('findElements', () => {
    test('keeps the elements that hold the text, ignoring case, with what they sit in and their numbers', () => {
        const elements = flattenTree(SAMPLE_TREE);
        const wifi = findElements(elements, 'home NETWORK');
        expect(wifi.matches).toBe(1);
        expect(wifi.elements.map((element) => element.handle)).toEqual([0, 2, 4]);
        const general = findElements(elements, 'example.general');
        expect(general.elements.map((element) => element.handle)).toEqual([0, 2, 3]);
        const settings = findElements(elements, 'settings');
        expect(settings).toMatchObject({ matches: 2 });
        expect(settings.elements.map((element) => element.handle)).toEqual([0, 1]);
        expect(findElements(elements, 'nowhere')).toEqual({ elements: [], matches: 0 });
    });
});
