import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { AGENT_HOLD_IDLE_MS, SWIPE_DEFAULT_MS } from '../devices/agent-driver.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { machineDeviceLine } from '../actions/device-actions.ts';
import { field, orNote, SCOPE_LINE, VerbRefusal } from './verb.ts';

function powerLine(state: ActionOutput<'device.inspect'>): string {
    const { power } = state;
    if (state.device.kind !== 'physical') {
        return 'power\tnone';
    }
    if (power === null) {
        return 'power\tunknown';
    }
    return `power\t${power.level}%\t${power.plugged ? 'plugged' : 'battery'}\t${power.charging ? 'charging' : 'not-charging'}${power.simulated ? '\tsimulated' : ''}`;
}

function yesNo(value: boolean): string {
    return value ? 'yes' : 'no';
}

const NODE_PARAM = {
    syntax: '<id>',
    need: 'required',
    field: 'nodeId',
    more: 'ruimte-context list names the ones linked to you, and a chat view finds them with node list --view V'
} as const;

const VIEW_PARAM = { syntax: '--view V', need: 'optional', field: 'viewId' } as const;

const VIEW_FLAG = z.string().min(1, '--view needs the id of a canvas').optional();

/* The sentences about the line and the device, which every action of this noun is held to. */
const COMMON_DETAIL: readonly string[] = [
    'line\tA line between you and that node is what lets you operate its device, whichever way it was drawn, the same line that lets you read it',
    'chat view\tA chat view has no lines: it operates any device node of the canvas it names with --view, and without --view it is refused with view-required',
    'device\tThe device is its own sandbox: no card asks the person, and computer use need not be on',
    `session\tA tap works whether or not anyone has the node open; whoever does sees it happen, and can pause you or take over. Your hold on the device ends ${AGENT_HOLD_IDLE_MS / 1000} s after your last call`,
    'refused\tdevice-not-booted\tthe device is not running: ask the person to start it from its node, since an agent never starts one',
    'refused\tdevice-missing\tthis machine does not have that device right now: tell the person',
    'refused\tno-shot, outside-shot\tcoordinates are pixels of the last shot: take one with device shot and count in it',
    'refused\tstale-element, unknown-element, offscreen-element\tan element is a number of the last device state of that device: read the state again',
    'refused\tpaused, taken-over\tthe person paused you or operates the device by hand from its node: wait and call again later, taking a shot first, or stop and tell them what is left. A shot still works',
    'see\truimte-context device state <id>\twhat the device can do, the size of the last shot and the elements on screen',
    SCOPE_LINE
];

/* An x,y pair of the last shot, as a pixel counted from its top-left corner. */
function pixelPair(flag: string) {
    return z
        .string({ error: `--${flag} needs a pixel of the last shot, as x,y` })
        .regex(/^\d+(\.\d+)?,\d+(\.\d+)?$/, `--${flag} takes a pixel of the last shot as x,y, two numbers of 0 or more such as 540,1200`)
        .transform((value) => {
            const [x, y] = value.split(',').map(Number);
            return { x: x!, y: y! };
        });
}

function nodeTuple(word: string, rest: string) {
    return z.tuple([z.string().min(1, `device ${word} needs the id of a device node`)], {
        error: (issue) => (issue.code === 'too_big' ? `device ${word} takes one node id${rest}` : `device ${word} needs the id of a device node`)
    });
}

/* Text past this many characters is cut in a state line, which says how long it was. */
const MAX_TEXT = 200;

function quote(text: string): string {
    const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
    const escaped = clipped
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replaceAll('\t', '\\t');
    return text.length > MAX_TEXT ? `"${escaped}"(cut: ${text.length} chars)` : `"${escaped}"`;
}

type TreeElement = NonNullable<ActionOutput<'device.inspect'>['tree']>['elements'][number];

/* One element on one line, as a state of an app on this Mac writes it, indented by its depth. */
export function elementLine(element: TreeElement): string {
    const parts = [`[${element.handle}]`, element.subrole === null ? element.role : `${element.role}:${element.subrole}`];
    if (element.label !== null) {
        parts.push(quote(element.label));
    }
    if (element.value !== null && element.value !== element.label) {
        parts.push(`value=${quote(element.value)}`);
    }
    if (element.identifier !== null && element.identifier !== element.label) {
        parts.push(`id=${quote(element.identifier)}`);
    }
    const { x, y, width, height } = element.frame;
    parts.push(`(${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)})`);
    if (element.offscreen) {
        parts.push('offscreen');
    }
    if (!element.enabled) {
        parts.push('disabled');
    }
    return `${'  '.repeat(element.depth)}${parts.join(' ')}`;
}

function treeLines(state: ActionOutput<'device.inspect'>): string[] {
    if (state.treeError !== null) {
        return [`tree\tnone\t${field(state.treeError)}`];
    }
    if (state.tree === null) {
        return [];
    }
    const { tree } = state;
    return [
        `elements\t${tree.count}\t${tree.screen.width}x${tree.screen.height}`,
        ...(tree.matches === null ? [] : [`matches\t${tree.matches}`]),
        ...(tree.truncated ? ['truncated\tyes\tThe tree was cut off after the elements above; use --find for the rest'] : []),
        ...tree.elements.map((element) => `tree\t${field(elementLine(element))}`)
    ];
}

function doneLine(word: string, outcome: ActionOutput<'device.tap'>): string[] {
    return [`done\t${word}\t${outcome.nodeId}\t${field(outcome.device)}`, 'next\truimte-context device shot <id>\tshows what it did'];
}

const listAction = defineActionVerb('device', {
    name: 'list',
    action: 'device.list',
    usage: '',
    params: [],
    detail: [
        'prints\tdevice\tid\tname\tplatform\tkind\truntime\tstate\tone line per simulator, emulator or phone this machine has now; state is booted, shutdown or transitioning',
        'see\truimte-context node new device --device <id>\tputs one on your canvas with a line from you, which is what lets you operate it; a chat view adds --view V and operates it on that canvas without a line',
        'note\tListing touches no device. An agent never starts one: a device that is not booted waits for the person to start it from its node',
        SCOPE_LINE
    ],
    positionals: z.tuple([], { error: 'device list takes nothing' }),
    flags: z.object({}),
    async run(_input, call) {
        const listed = await runAction(call, 'device.list', {});
        return orNote(listed.devices.map(machineDeviceLine), 'This machine has no simulator, emulator or phone right now; the person brings one');
    }
});

const stateAction = defineActionVerb('device', {
    name: 'state',
    action: 'device.inspect',
    usage: '<id> [--find T] [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--find T', need: 'optional', field: 'find', more: 'prints matches, the number of elements that hold it' }],
    detail: [
        'prints\tdevice\tid\tname\tplatform\tkind\truntime\twhich device the node points at',
        'prints\tstate\tbooted|shutdown|transitioning|missing\twhether it runs; missing when this machine does not have it right now',
        "prints\tpower\tN%\tplugged|battery\tcharging|not-charging[\tsimulated]\ta phone's own battery, read now; simulated while a level set with device set --battery stands in for it. unknown when the phone cannot say, none for a simulator or an emulator. Read only",
        'prints\tscreen\twidthxheight|unknown\tthe size of the last shot, which --at, --from and --to are counted in; unknown until you take one',
        'prints\tbuttons\tname ...\tthe buttons device button takes on this device',
        'prints\tcan\tshot|input|type|launch|tree\tyes|no\twhat works on it now; input is tap, swipe and button, tree the elements below',
        'prints\telements\tN\twidthxheight\thow many elements the screen holds, and its size in pixels',
        'prints\ttree\tline\tone row per element: [N] role, label, value=, id=, frame as x,y widthxheight, and offscreen or disabled; the indent after the tab is its depth',
        'prints\ttree\tnone\twhy\twhen the elements could not be read; a shot still shows the screen',
        'read\t[N] is the number device tap takes with --element, until the next device state of this device',
        'read\tA frame is in pixels of the screen, the pixels a shot has, so it lines up with device shot and tap --at',
        'note\tThe tree holds only the app in front, or an alert over it; no web content, and of a long list only the rows on screen. Take a shot for those',
        'note\tA simulator and an Android device have a tree; an iPhone has shots only',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('state', ' and nothing else'),
    flags: z.object({ find: z.string({ error: '--find needs the text to look for' }).min(1, '--find needs the text to look for').optional(), view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        const state = await runAction(call, 'device.inspect', { nodeId: id, viewId: flags.view ?? null, find: flags.find ?? null });
        const { device } = state;
        return [
            `device\t${id}\t${field(device.name)}\t${device.platform}\t${device.kind}\t${field(device.runtime)}`,
            `state\t${state.state ?? 'missing'}`,
            powerLine(state),
            `screen\t${state.screen === null ? 'unknown' : `${state.screen.width}x${state.screen.height}`}`,
            `buttons\t${state.buttons.join(' ')}`,
            `can\tshot\t${yesNo(state.can.shot)}`,
            `can\tinput\t${yesNo(state.can.input)}`,
            `can\ttype\t${yesNo(state.can.type)}`,
            `can\tlaunch\t${yesNo(state.can.launch)}`,
            `can\ttree\t${yesNo(state.can.tree)}`,
            ...treeLines(state)
        ];
    }
});

const shotAction = defineActionVerb('device', {
    name: 'shot',
    action: 'device.screenshot',
    usage: '<id> [--view V]',
    params: [NODE_PARAM, VIEW_PARAM],
    detail: [
        'prints\tshot\tpath\twidthxheight\tthe png on this machine, which you open with your own tools, and its size in pixels',
        'note\tEvery coordinate a later call takes is a pixel of this picture, counted from its top-left corner',
        'note\tThe file is this machine’s, not the project’s: it lives outside the project folder and is swept a day later',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('shot', ' and nothing else'),
    flags: z.object({ view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        const shot = await runAction(call, 'device.screenshot', { nodeId: id, viewId: flags.view ?? null });
        return [`shot\t${field(shot.path)}\t${shot.width}x${shot.height}\tRead it with your own tools`];
    }
});

const tapAction = defineActionVerb('device', {
    name: 'tap',
    action: 'device.tap',
    usage: '<id> (--element N | --at X,Y) [--view V]',
    params: [
        NODE_PARAM,
        VIEW_PARAM,
        { syntax: '--element N', need: 'or --at', field: 'element' },
        { syntax: '--at X,Y', need: 'or --element', text: 'A pixel of the last shot, counted from its top-left corner' }
    ],
    detail: [
        'note\tBy element it taps the middle of that element of the last device state, and needs no shot',
        'note\tA tap changes the screen, so read the state again before the next --element',
        'prints\tdone\ttap\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('tap', ' and the element in --element or the pixel in --at'),
    flags: z.object({
        view: VIEW_FLAG,
        at: pixelPair('at').optional(),
        element: z
            .string({ error: '--element needs the number of an element, as device state lists it' })
            .regex(/^\d+$/, '--element takes the number in brackets that device state gave the element')
            .transform(Number)
            .optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const outcome = await runAction(call, 'device.tap', {
            nodeId: id,
            viewId: flags.view ?? null,
            x: flags.at?.x ?? null,
            y: flags.at?.y ?? null,
            element: flags.element ?? null
        });
        return doneLine('tap', outcome);
    }
});

const swipeAction = defineActionVerb('device', {
    name: 'swipe',
    action: 'device.swipe',
    usage: '<id> --from X,Y --to X,Y [--view V]',
    params: [
        NODE_PARAM,
        VIEW_PARAM,
        { syntax: '--from X,Y', need: 'required', text: 'The pixel of the last shot the finger presses on' },
        { syntax: '--to X,Y', need: 'required', text: 'The pixel it lets go on' },
        { syntax: '--ms N', need: 'optional', field: 'ms' }
    ],
    detail: [
        'note\tTo scroll down a list, swipe up: from a point low on the screen to one higher up',
        `note\tA short --ms flicks and scrolls on after the finger lifts; ${SWIPE_DEFAULT_MS} or more drags`,
        'prints\tdone\tswipe\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('swipe', ' and the pixels in --from and --to'),
    flags: z.object({
        view: VIEW_FLAG,
        from: pixelPair('from'),
        to: pixelPair('to'),
        ms: z
            .string()
            .regex(/^\d+$/, '--ms takes a whole number of milliseconds')
            .transform(Number)
            .refine((value) => value >= 50 && value <= 5000, '--ms is between 50 and 5000')
            .optional()
    }),
    async run({ positionals: [id], flags }, call) {
        const outcome = await runAction(call, 'device.swipe', {
            nodeId: id,
            viewId: flags.view ?? null,
            fromX: flags.from.x,
            fromY: flags.from.y,
            toX: flags.to.x,
            toY: flags.to.y,
            ms: flags.ms ?? null
        });
        return doneLine('swipe', outcome);
    }
});

const buttonAction = defineActionVerb('device', {
    name: 'button',
    action: 'device.button',
    usage: '<id> --name B [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--name B', need: 'required', field: 'button' }],
    detail: [
        'note\tAn iPhone knows home, swipeHome, appSwitcher, lock and siri; an Android device back, home, appSwitcher, lock, siri, volumeUp, volumeDown and playPause. A button the device does not announce is refused with the ones it does',
        'prints\tdone\tbutton\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('button', ' and the button in --name'),
    flags: z.object({
        view: VIEW_FLAG,
        name: z.string({ error: '--name needs a button, as device state lists them' }).min(1, '--name needs a button, as device state lists them')
    }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('button', await runAction(call, 'device.button', { nodeId: id, viewId: flags.view ?? null, button: flags.name }));
    }
});

const typeAction = defineActionVerb('device', {
    name: 'type',
    action: 'device.type',
    usage: '<id> --text T [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--text T', need: 'required', field: 'text' }],
    detail: [
        'note\tThe text goes wherever the focus is, so tap the field first and take a shot to see it has the cursor',
        'note\tA simulator and an Android device take the text through their clipboard, which it replaces, so any character goes; a newline is Return and a tab is Tab. An iPhone takes no text',
        'prints\tdone\ttype\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('type', ' and the text in --text'),
    flags: z.object({ text: z.string({ error: '--text needs the text to type' }).min(1, '--text needs the text to type'), view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('type', await runAction(call, 'device.type', { nodeId: id, viewId: flags.view ?? null, text: flags.text }));
    }
});

const launchAction = defineActionVerb('device', {
    name: 'launch',
    action: 'device.launch',
    usage: '<id> --app A [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--app A', need: 'required', field: 'app' }],
    detail: ['note\tThe app has to be installed on the device already', 'prints\tdone\tlaunch\tid\tdevice', ...COMMON_DETAIL],
    positionals: nodeTuple('launch', ' and the app in --app'),
    flags: z.object({
        app: z.string({ error: '--app needs a bundle id or a package name' }).min(1, '--app needs a bundle id or a package name'),
        view: VIEW_FLAG
    }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('launch', await runAction(call, 'device.launch', { nodeId: id, viewId: flags.view ?? null, app: flags.app }));
    }
});

/* The pair a location is written as, latitude first, the way a map shows it. */
const locationPair = z
    .string({ error: '--location needs a place, as LAT,LON' })
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, '--location takes a place as LAT,LON, two numbers such as 52.3676,4.9041')
    .transform((value) => {
        const [latitude, longitude] = value.split(',').map(Number);
        return { latitude: latitude!, longitude: longitude! };
    });

const APP_FLAG = z.string({ error: '--app needs a bundle id or a package name' }).trim().min(1, '--app needs a bundle id or a package name');

/* The tools beside shots and taps refuse what the device does not announce, and a path that leaves the project. */
const TOOL_DETAIL: readonly string[] = [
    'refused\tdevice-action-unavailable\tthe device does not announce that tool; device state says what it can do',
    'note\tAn agent never starts, stops, restarts, erases or folds a device, nor sets its camera: those stay with the person'
];

const PATH_DETAIL =
    'refused\tdevice-path-refused\tthe path is not there, or lies outside the project folder and its worktrees, or is no file this device takes';

const setAction = defineActionVerb('device', {
    name: 'set',
    action: 'device.set',
    usage: '<id> [--appearance light|dark] [--text-size S] [--status-bar clean|default] [--battery N [--charging]] [--location LAT,LON | --clear-location] [--view V]',
    params: [
        NODE_PARAM,
        VIEW_PARAM,
        { syntax: '--appearance light|dark', need: 'optional', field: 'appearance', text: 'Light or dark' },
        { syntax: '--text-size S', need: 'optional', field: 'textSize', text: 'small, default, large or extra-large' },
        { syntax: '--status-bar clean|default', need: 'optional', field: 'statusBar', text: 'clean shows 9:41 and full bars, default the real ones' },
        { syntax: '--battery N', need: 'optional', field: 'battery' },
        { syntax: '--charging', need: 'with --battery', text: 'The battery charges at that level' },
        { syntax: '--location LAT,LON', need: 'optional', text: 'A simulated place, latitude first' },
        { syntax: '--clear-location', need: 'optional', field: 'clearLocation' }
    ],
    detail: [
        'note\tOn a simulator the battery shows in the status bar only; apps still read a full one',
        'prints\tdone\tset\tid\tdevice',
        ...TOOL_DETAIL,
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('set', ' and the flags of what changes'),
    switches: ['charging', 'clear-location'],
    flags: z.object({
        view: VIEW_FLAG,
        appearance: z.enum(['light', 'dark'], { error: '--appearance is light or dark' }).optional(),
        'text-size': z.enum(['small', 'default', 'large', 'extra-large'], { error: '--text-size is small, default, large or extra-large' }).optional(),
        'status-bar': z.enum(['clean', 'default'], { error: '--status-bar is clean or default' }).optional(),
        battery: z
            .string()
            .regex(/^\d+$/, '--battery takes a whole number of percent')
            .transform(Number)
            .refine((value) => value <= 100, '--battery is between 0 and 100')
            .optional(),
        location: locationPair.optional()
    }),
    async run({ positionals: [id], flags, switches }, call) {
        const outcome = await runAction(call, 'device.set', {
            nodeId: id,
            viewId: flags.view ?? null,
            appearance: flags.appearance ?? null,
            textSize: flags['text-size'] ?? null,
            statusBar: flags['status-bar'] ?? null,
            battery: flags.battery ?? null,
            charging: switches.has('charging') ? true : null,
            latitude: flags.location?.latitude ?? null,
            longitude: flags.location?.longitude ?? null,
            clearLocation: switches.has('clear-location') ? true : null
        });
        return doneLine('set', outcome);
    }
});

const openAction = defineActionVerb('device', {
    name: 'open',
    action: 'device.open',
    usage: '<id> --url U [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--url U', need: 'required', text: 'A link, or a scheme of an app such as myapp://' }],
    detail: ['prints\tdone\topen\tid\tdevice', ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: nodeTuple('open', ' and the link in --url'),
    flags: z.object({ url: z.string({ error: '--url needs a link' }).min(1, '--url needs a link'), view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('open', await runAction(call, 'device.open', { nodeId: id, viewId: flags.view ?? null, url: flags.url }));
    }
});

const permissionAction = defineActionVerb('device', {
    name: 'permission',
    action: 'device.permission',
    usage: '<id> --app A (--grant|--revoke|--reset) [--name P | --all] [--view V]',
    params: [
        NODE_PARAM,
        VIEW_PARAM,
        { syntax: '--app A', need: 'required', field: 'app' },
        { syntax: '--grant', need: 'or --revoke or --reset', text: 'Allows it' },
        { syntax: '--revoke', need: 'or --grant or --reset', text: 'Takes it away' },
        { syntax: '--reset', need: 'or --grant or --revoke', text: 'Asks the app again next time' },
        { syntax: '--name P', need: 'or --all', text: 'camera, microphone, photos, contacts, calendar, reminders, location, motion, media-library or faceid' },
        { syntax: '--all', need: 'or --name', text: 'Every permission the device has' }
    ],
    detail: ['prints\tdone\tpermission\tid\tdevice', ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: nodeTuple('permission', ' and the app in --app'),
    switches: ['grant', 'revoke', 'reset', 'all'],
    flags: z.object({
        app: APP_FLAG,
        name: z
            .enum(['camera', 'microphone', 'photos', 'contacts', 'calendar', 'reminders', 'location', 'motion', 'media-library', 'faceid'], {
                error: '--name is one of camera, microphone, photos, contacts, calendar, reminders, location, motion, media-library and faceid'
            })
            .optional(),
        view: VIEW_FLAG
    }),
    async run({ positionals: [id], flags, switches }, call) {
        const decisions = (['grant', 'revoke', 'reset'] as const).filter((decision) => switches.has(decision));
        if (decisions.length !== 1) {
            throw new VerbRefusal('bad-arguments', 'device permission takes one of --grant, --revoke and --reset');
        }
        if ((flags.name === undefined) === !switches.has('all')) {
            throw new VerbRefusal('bad-arguments', 'device permission takes one permission in --name, or --all');
        }
        return doneLine(
            'permission',
            await runAction(call, 'device.permission', {
                nodeId: id,
                viewId: flags.view ?? null,
                app: flags.app,
                decision: decisions[0]!,
                permission: flags.name ?? null
            })
        );
    }
});

const pushAction = defineActionVerb('device', {
    name: 'push',
    action: 'device.push',
    usage: '<id> --app A --payload JSON [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--app A', need: 'required', field: 'app' }, { syntax: '--payload JSON', need: 'required', field: 'payload' }],
    detail: ['note\tOnly a simulator takes a push from Ruimte', 'prints\tdone\tpush\tid\tdevice', ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: nodeTuple('push', ' and the app in --app'),
    flags: z.object({
        app: APP_FLAG,
        payload: z.string({ error: '--payload needs the alert text' }).min(1, '--payload needs the alert text'),
        view: VIEW_FLAG
    }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('push', await runAction(call, 'device.push', { nodeId: id, viewId: flags.view ?? null, app: flags.app, payload: flags.payload }));
    }
});

const biometricAction = defineActionVerb('device', {
    name: 'biometric',
    action: 'device.biometric',
    usage: '<id> (--match|--nomatch|--enroll|--unenroll) [--sensor face|finger] [--view V]',
    params: [
        NODE_PARAM,
        VIEW_PARAM,
        { syntax: '--match', need: 'one of four', text: 'Answers the check the app asks for as the right face or finger' },
        { syntax: '--nomatch', need: 'one of four', text: 'Answers it as a wrong one' },
        { syntax: '--enroll', need: 'one of four', text: 'Sets up Face ID or Touch ID on a simulator' },
        { syntax: '--unenroll', need: 'one of four', text: 'Takes it away again' },
        { syntax: '--sensor face|finger', need: 'optional', field: 'sensor' }
    ],
    detail: ['note\tAndroid takes a fingerprint touch on an emulator only', 'prints\tdone\tbiometric\tid\tdevice', ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: nodeTuple('biometric', ' and one of --match, --nomatch, --enroll and --unenroll'),
    switches: ['match', 'nomatch', 'enroll', 'unenroll'],
    flags: z.object({ sensor: z.enum(['face', 'finger'], { error: '--sensor is face or finger' }).optional(), view: VIEW_FLAG }),
    async run({ positionals: [id], flags, switches }, call) {
        const events = (['match', 'nomatch', 'enroll', 'unenroll'] as const).filter((event) => switches.has(event));
        if (events.length !== 1) {
            throw new VerbRefusal('bad-arguments', 'device biometric takes one of --match, --nomatch, --enroll and --unenroll');
        }
        return doneLine(
            'biometric',
            await runAction(call, 'device.biometric', { nodeId: id, viewId: flags.view ?? null, event: events[0]!, sensor: flags.sensor ?? null })
        );
    }
});

const clipboardAction = defineActionVerb('device', {
    name: 'clipboard',
    action: 'device.clipboard',
    usage: '<id> [--text T] [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--text T', need: 'optional', field: 'text' }],
    detail: [
        'prints\tclipboard\ttext\twhat the clipboard holds after the call, cut like a state line',
        'note\tPutting text there does not paste it; device type types into the field that has the focus',
        'note\tThe clipboard of an iOS simulator follows the clipboard of the Mac, so it is only written, never read',
        ...TOOL_DETAIL,
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('clipboard', ' and nothing else'),
    flags: z.object({ text: z.string({ error: '--text needs the text to put there' }).optional(), view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        const outcome = await runAction(call, 'device.clipboard', { nodeId: id, viewId: flags.view ?? null, text: flags.text ?? null });
        return [`clipboard\t${quote(outcome.text)}`];
    }
});

const recordAction = defineActionVerb('device', {
    name: 'record',
    action: 'device.record',
    usage: '<id> --seconds N [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--seconds N', need: 'required', text: 'How long it records, 1 to 60' }],
    detail: [
        'prints\trecording\tpath\tthe mp4 on this machine, which you open with your own tools',
        'note\tThe call returns once the recording ended; act on the device from another call while it runs',
        'note\tThe file is this machine’s, not the project’s, and is swept a week later',
        ...TOOL_DETAIL,
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('record', ' and the length in --seconds'),
    flags: z.object({
        seconds: z
            .string({ error: '--seconds needs how long to record' })
            .regex(/^\d+$/, '--seconds takes a whole number')
            .transform(Number)
            .refine((value) => value >= 1 && value <= 60, '--seconds is between 1 and 60'),
        view: VIEW_FLAG
    }),
    async run({ positionals: [id], flags }, call) {
        const outcome = await runAction(call, 'device.record', { nodeId: id, viewId: flags.view ?? null, seconds: flags.seconds });
        return [`recording\t${field(outcome.path)}\tRead it with your own tools`];
    }
});

const installAction = defineActionVerb('device', {
    name: 'install',
    action: 'device.install',
    usage: '<id> --path P [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--path P', need: 'required', field: 'path' }],
    detail: [
        'note\tA simulator takes an .app built for it, an iPhone an .app or an .ipa, and Android an .apk',
        'prints\tdone\tinstall\tid\tdevice',
        PATH_DETAIL,
        ...TOOL_DETAIL,
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('install', ' and the app in --path'),
    flags: z.object({ path: z.string({ error: '--path needs the app to install' }).min(1, '--path needs the app to install'), view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('install', await runAction(call, 'device.install', { nodeId: id, viewId: flags.view ?? null, path: flags.path }));
    }
});

const mediaAction = defineActionVerb('device', {
    name: 'media',
    action: 'device.media',
    usage: '<id> --path P [P…] [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--path P', need: 'required', field: 'paths', more: 'more pictures follow the first as arguments, 20 in all' }],
    detail: ['note\tpng, jpg, jpeg, heic, gif, mp4 and mov', 'prints\tdone\tmedia\tid\tdevice', PATH_DETAIL, ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: z.array(z.string().min(1)).min(1, 'device media needs the id of a device node').max(20, 'device media takes 20 pictures at most'),
    flags: z.object({ path: z.string({ error: '--path needs a picture or a video' }).min(1, '--path needs a picture or a video'), view: VIEW_FLAG }),
    async run({ positionals: [id, ...more], flags }, call) {
        return doneLine('media', await runAction(call, 'device.media', { nodeId: id!, viewId: flags.view ?? null, paths: [flags.path, ...more] }));
    }
});

const terminateAction = defineActionVerb('device', {
    name: 'terminate',
    action: 'device.terminate',
    usage: '<id> --app A [--view V]',
    params: [NODE_PARAM, VIEW_PARAM, { syntax: '--app A', need: 'required', field: 'app' }],
    detail: ['prints\tdone\tterminate\tid\tdevice', ...TOOL_DETAIL, ...COMMON_DETAIL],
    positionals: nodeTuple('terminate', ' and the app in --app'),
    flags: z.object({ app: APP_FLAG, view: VIEW_FLAG }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('terminate', await runAction(call, 'device.terminate', { nodeId: id, viewId: flags.view ?? null, app: flags.app }));
    }
});

export const DEVICE_ACTIONS = [
    listAction,
    stateAction,
    shotAction,
    tapAction,
    swipeAction,
    buttonAction,
    typeAction,
    launchAction,
    setAction,
    openAction,
    permissionAction,
    pushAction,
    biometricAction,
    clipboardAction,
    recordAction,
    installAction,
    mediaAction,
    terminateAction
] as const;

export const DEVICE_SUMMARY =
    'Sees and operates the device under a device node you have a line to, or on the canvas a chat view names: the elements and a picture of its screen, taps, swipes, buttons, text, apps and its tools';

export const DEVICE_DETAIL: readonly string[] = [
    'note\tRead the elements with device state and tap one by its number; take a shot for what the tree does not hold, act in its pixels, and read again to see what happened',
    'note\tA simulator, an emulator or a phone, as long as it runs on this machine; an agent never starts, stops, restarts, erases or folds one, nor sets its camera',
    'note\tThe tools beside shots and taps (set, open, permission, push, biometric, clipboard, record, install, media, terminate) work on what the device announces; a path is a file of the project folder or its worktrees',
    'see\truimte-context read <id>\twhich device the node points at, without touching it',
    SCOPE_LINE
];
