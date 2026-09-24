import { describe, expect, test } from 'bun:test';
import { androidTree, parseWmSize } from './android-tree.ts';
import { flattenTree } from './device-tree.ts';

/* What `uiautomator dump /dev/tty` writes for the top of the Settings app, cut down, with the line it ends in. */
const SETTINGS_DUMP = [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    '<hierarchy rotation="0">',
    '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">',
    '<node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">',
    '<node index="0" text="Settings" resource-id="com.android.settings:id/homepage_title" class="android.widget.TextView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[63,310][1017,443]" />',
    '<node index="1" text="Search settings" resource-id="com.android.settings:id/search_action_bar" class="android.widget.EditText" package="com.android.settings" content-desc="" hint="Search" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[42,500][1038,640]" />',
    '<node index="2" text="" resource-id="com.android.settings:id/recycler_view" class="androidx.recyclerview.widget.RecyclerView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,680][1080,2400]">',
    '<node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,680][1080,900]">',
    '<node index="0" text="Network &amp; internet" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[200,720][800,790]" />',
    '<node index="1" text="Mobile, Wi&#8209;Fi, hotspot" resource-id="android:id/summary" class="android.widget.TextView" package="com.android.settings" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[200,790][900,860]" />',
    '</node>',
    '<node index="1" text="" resource-id="android:id/switch_widget" class="android.widget.Switch" package="com.android.settings" content-desc="Dark theme" checkable="true" checked="true" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[880,950][1040,1050]" />',
    '<node index="2" text="Apps" resource-id="" class="android.widget.Button" package="com.android.settings" content-desc="Apps &quot;installed&quot;" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1100][1080,1300]" />',
    '</node>',
    '</node>',
    '</node>',
    '</hierarchy>',
    'UI hierchary dumped to: /dev/tty'
].join('');

describe('androidTree', () => {
    test('keeps the elements that say or do something, in pixels, and lets the layouts between them go', () => {
        const tree = androidTree(SETTINGS_DUMP, { width: 1080, height: 2400 })!;
        expect(tree.screen).toEqual({ width: 1080, height: 2400 });
        expect(tree.root).toMatchObject({ role: 'Application', label: 'com.android.settings', frame: { x: 0, y: 0, width: 1080, height: 2400 } });
        const rows = flattenTree(tree).map((element) => [element.depth, element.role, element.label, element.value, element.identifier, element.enabled]);
        expect(rows).toEqual([
            [0, 'Application', 'com.android.settings', null, null, true],
            [1, 'TextView', 'Settings', null, 'com.android.settings:id/homepage_title', true],
            [1, 'EditText', 'Search', 'Search settings', 'com.android.settings:id/search_action_bar', true],
            [1, 'RecyclerView', null, null, 'com.android.settings:id/recycler_view', true],
            [2, 'LinearLayout', null, null, null, true],
            [3, 'TextView', 'Network & internet', null, 'android:id/title', true],
            [3, 'TextView', 'Mobile, Wi‑Fi, hotspot', null, 'android:id/summary', true],
            [2, 'Switch', 'Dark theme', 'on', 'android:id/switch_widget', false],
            [2, 'Button', 'Apps "installed"', 'Apps', null, true]
        ]);
        expect(flattenTree(tree)[4]!.frame).toEqual({ x: 0, y: 680, width: 1080, height: 220 });
    });

    test('turns the screen for a dump taken on its side', () => {
        const sideways = SETTINGS_DUMP.replace('rotation="0"', 'rotation="1"');
        expect(androidTree(sideways, { width: 1080, height: 2400 })!.screen).toEqual({ width: 2400, height: 1080 });
    });

    test('finds no tree in what a failing dump writes', () => {
        expect(androidTree('ERROR: could not get idle state.', { width: 1080, height: 2400 })).toBeNull();
    });
});

describe('parseWmSize', () => {
    test('reads the size, the override before the panel', () => {
        expect(parseWmSize('Physical size: 1080x2400\n')).toEqual({ width: 1080, height: 2400 });
        expect(parseWmSize('Physical size: 1440x3120\nOverride size: 1080x2340\n')).toEqual({ width: 1080, height: 2340 });
        expect(parseWmSize('')).toBeNull();
    });
});
