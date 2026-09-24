import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { AGENT_HOLD_IDLE_MS, SWIPE_DEFAULT_MS } from '../devices/agent-driver.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { field, SCOPE_LINE } from './verb.ts';

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const NODE_PARAM = { syntax: '<id>', need: 'required', field: 'nodeId', more: 'ruimte-context list names the ones linked to you' } as const;

/* The sentences about the line and the device, which every action of this noun is held to. */
const COMMON_DETAIL: readonly string[] = [
    'line\tA line between you and that node is what lets you operate its device, whichever way it was drawn, the same line that lets you read it',
    'device\tThe device is its own sandbox: no card asks the person, and computer use need not be on',
    `session\tA tap works whether or not anyone has the node open; whoever does sees it happen, and can pause you or take over. Your hold on the device ends ${AGENT_HOLD_IDLE_MS / 1000} s after your last call`,
    'refused\tdevice-not-booted\tthe device is not running: ask the person to start it from its node, since an agent never starts one',
    'refused\tdevice-missing\tthis machine does not have that device right now: tell the person',
    'refused\tno-shot, outside-shot\tcoordinates are pixels of the last shot: take one with device shot and count in it',
    'refused\tpaused, taken-over\tthe person paused you or operates the device by hand from its node: wait and call again later, taking a shot first, or stop and tell them what is left. A shot still works',
    'see\truimte-context device state <id>\twhat the device can do, and the size of the last shot',
    SCOPE_LINE
];

/* An x,y pair of the last shot, as a pixel counted from its top-left corner. */
const pixelPair = (flag: string) =>
    z
        .string({ error: `--${flag} needs a pixel of the last shot, as x,y` })
        .regex(/^\d+(\.\d+)?,\d+(\.\d+)?$/, `--${flag} takes a pixel of the last shot as x,y, two numbers of 0 or more such as 540,1200`)
        .transform((value) => {
            const [x, y] = value.split(',').map(Number);
            return { x: x!, y: y! };
        });

const nodeTuple = (word: string, rest: string) =>
    z.tuple([z.string().min(1, `device ${word} needs the id of a device node`)], {
        error: (issue) => (issue.code === 'too_big' ? `device ${word} takes one node id${rest}` : `device ${word} needs the id of a device node`)
    });

const doneLine = (word: string, outcome: ActionOutput<'device.tap'>): string[] => [
    `done\t${word}\t${outcome.nodeId}\t${field(outcome.device)}`,
    'next\truimte-context device shot <id>\tshows what it did'
];

const stateAction = defineActionVerb('device', {
    name: 'state',
    action: 'device.inspect',
    usage: '<id>',
    params: [NODE_PARAM],
    detail: [
        'prints\tdevice\tid\tname\tplatform\tkind\truntime\twhich device the node points at',
        'prints\tstate\tbooted|shutdown|transitioning|missing\twhether it runs; missing when this machine does not have it right now',
        'prints\tscreen\twidthxheight|unknown\tthe size of the last shot, which every coordinate is counted in; unknown until you take one',
        'prints\tbuttons\tname ...\tthe buttons device button takes on this device',
        'prints\tcan\tshot|input|type|launch\tyes|no\twhat works on it now; input is tap, swipe and button',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('state', ' and nothing else'),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const state = await runAction(call, 'device.inspect', { nodeId: id });
        const { device } = state;
        return [
            `device\t${id}\t${field(device.name)}\t${device.platform}\t${device.kind}\t${field(device.runtime)}`,
            `state\t${state.state ?? 'missing'}`,
            `screen\t${state.screen === null ? 'unknown' : `${state.screen.width}x${state.screen.height}`}`,
            `buttons\t${state.buttons.join(' ')}`,
            `can\tshot\t${yesNo(state.can.shot)}`,
            `can\tinput\t${yesNo(state.can.input)}`,
            `can\ttype\t${yesNo(state.can.type)}`,
            `can\tlaunch\t${yesNo(state.can.launch)}`
        ];
    }
});

const shotAction = defineActionVerb('device', {
    name: 'shot',
    action: 'device.screenshot',
    usage: '<id>',
    params: [NODE_PARAM],
    detail: [
        'prints\tshot\tpath\twidthxheight\tthe png on this machine, which you open with your own tools, and its size in pixels',
        'note\tEvery coordinate a later call takes is a pixel of this picture, counted from its top-left corner',
        'note\tThe file is this machine’s, not the project’s: it lives outside the project folder and is swept a day later',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('shot', ' and nothing else'),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const shot = await runAction(call, 'device.screenshot', { nodeId: id });
        return [`shot\t${field(shot.path)}\t${shot.width}x${shot.height}\tRead it with your own tools`];
    }
});

const tapAction = defineActionVerb('device', {
    name: 'tap',
    action: 'device.tap',
    usage: '<id> --at X,Y',
    params: [NODE_PARAM, { syntax: '--at X,Y', need: 'required', text: 'A pixel of the last shot, counted from its top-left corner' }],
    detail: ['prints\tdone\ttap\tid\tdevice', ...COMMON_DETAIL],
    positionals: nodeTuple('tap', ' and the pixel in --at'),
    flags: z.object({ at: pixelPair('at') }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('tap', await runAction(call, 'device.tap', { nodeId: id, x: flags.at.x, y: flags.at.y }));
    }
});

const swipeAction = defineActionVerb('device', {
    name: 'swipe',
    action: 'device.swipe',
    usage: '<id> --from X,Y --to X,Y',
    params: [
        NODE_PARAM,
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
    usage: '<id> --name B',
    params: [NODE_PARAM, { syntax: '--name B', need: 'required', field: 'button' }],
    detail: [
        'note\tAn iPhone knows home, swipeHome, appSwitcher, lock and siri; an Android device back, home, appSwitcher, lock and siri. A button the device does not announce is refused with the ones it does',
        'prints\tdone\tbutton\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('button', ' and the button in --name'),
    flags: z.object({
        name: z.string({ error: '--name needs a button, as device state lists them' }).min(1, '--name needs a button, as device state lists them')
    }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('button', await runAction(call, 'device.button', { nodeId: id, button: flags.name }));
    }
});

const typeAction = defineActionVerb('device', {
    name: 'type',
    action: 'device.type',
    usage: '<id> --text T',
    params: [NODE_PARAM, { syntax: '--text T', need: 'required', field: 'text' }],
    detail: [
        'note\tThe text goes wherever the focus is, so tap the field first and take a shot to see it has the cursor',
        'note\tA simulator takes the text through its pasteboard, which it replaces, so any character goes; Android takes plain ASCII only, and a phone takes no text',
        'prints\tdone\ttype\tid\tdevice',
        ...COMMON_DETAIL
    ],
    positionals: nodeTuple('type', ' and the text in --text'),
    flags: z.object({ text: z.string({ error: '--text needs the text to type' }).min(1, '--text needs the text to type') }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('type', await runAction(call, 'device.type', { nodeId: id, text: flags.text }));
    }
});

const launchAction = defineActionVerb('device', {
    name: 'launch',
    action: 'device.launch',
    usage: '<id> --app A',
    params: [NODE_PARAM, { syntax: '--app A', need: 'required', field: 'app' }],
    detail: ['note\tThe app has to be installed on the device already', 'prints\tdone\tlaunch\tid\tdevice', ...COMMON_DETAIL],
    positionals: nodeTuple('launch', ' and the app in --app'),
    flags: z.object({ app: z.string({ error: '--app needs a bundle id or a package name' }).min(1, '--app needs a bundle id or a package name') }),
    async run({ positionals: [id], flags }, call) {
        return doneLine('launch', await runAction(call, 'device.launch', { nodeId: id, app: flags.app }));
    }
});

export const DEVICE_ACTIONS = [stateAction, shotAction, tapAction, swipeAction, buttonAction, typeAction, launchAction] as const;

export const DEVICE_SUMMARY =
    'Sees and operates the device under a device node you have a line to: a picture of its screen, taps, swipes, buttons, text and apps';

export const DEVICE_DETAIL: readonly string[] = [
    'note\tWork in shots: take one, decide on it, act in its pixels, and take the next to see what happened',
    'note\tA simulator, an emulator or a phone, as long as it runs on this machine; an agent never starts or stops one',
    'see\truimte-context read <id>\twhich device the node points at, without touching it',
    SCOPE_LINE
];
