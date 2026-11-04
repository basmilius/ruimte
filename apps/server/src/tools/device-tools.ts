import { ToolRefusal } from '@adecore/agents/context';
import type { ActionOutput } from '@ruimte/actions';
import { z } from 'zod';
import { machineDeviceLine } from '../actions/device-actions.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { field, orNote, requiredField, yesNo } from './host.ts';
import { defineTool, defineToolkit } from './tool.ts';

const PERMISSIONS = ['camera', 'microphone', 'photos', 'contacts', 'calendar', 'reminders', 'location', 'motion', 'media-library', 'faceid'] as const;

const INPUTS = ['tap', 'swipe', 'button', 'type'] as const;

const APP_ACTIONS = ['launch', 'terminate'] as const;

/* What each action of `device_input` takes besides `action` and `device`. */
const INPUT_FIELDS: Readonly<Record<(typeof INPUTS)[number], readonly string[]>> = {
    tap: ['at', 'element'],
    swipe: ['from', 'to', 'ms'],
    button: ['name'],
    type: ['text']
};

/* Text past this many characters is cut in a state line, which says how long it was. */
const MAX_TEXT = 200;

/* The device a call names: the id device_list gives it, or a device node's id, with no line or view. */
function deviceInput(tool: string): z.ZodString {
    return requiredField(`${tool} needs device, the id of a device as device_list gives it`);
}

const APP_INPUT = z
    .string({ error: 'app needs a bundle id or a package name' })
    .trim()
    .min(1, 'app needs a bundle id or a package name')
    .describe('A bundle id or package name');

/* An x,y pair of the last shot, as a pixel counted from its top-left corner. */
function pixelPair(name: string) {
    return z
        .string({ error: `${name} needs a pixel of the last shot, as x,y` })
        .regex(/^\d+(\.\d+)?,\d+(\.\d+)?$/, `${name} takes a pixel of the last shot as x,y, two numbers of 0 or more such as 540,1200`)
        .transform((value) => {
            const [x, y] = value.split(',').map(Number);

            return { x: x!, y: y! };
        });
}

/* The pair a location is written as, latitude first, the way a map shows it. */
const LOCATION_INPUT = z
    .string({ error: 'location needs a place, as LAT,LON' })
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'location takes a place as LAT,LON, two numbers such as 52.3676,4.9041')
    .transform((value) => {
        const [latitude, longitude] = value.split(',').map(Number);

        return { latitude: latitude!, longitude: longitude! };
    });

/* The size coordinates count in, which is that of the last shot, so a running device has none before one. */
function screenLine(state: ActionOutput<'device.inspect'>): string {
    if (state.screen !== null) {
        return `${state.screen.width}x${state.screen.height}`;
    }

    return state.present ? 'unknown until device_shot' : 'unknown';
}

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
function elementLine(element: TreeElement): string {
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
        ...(tree.truncated ? ['truncated\tyes\tThe tree was cut off after the elements above; use find for the rest'] : []),
        ...tree.elements.map((element) => `tree\t${field(elementLine(element))}`)
    ];
}

function doneLine(word: string, outcome: ActionOutput<'device.tap'>): string[] {
    return [`done\t${word}\t${outcome.nodeId}\t${field(outcome.device)}`, 'next\tdevice_shot\tshows what it did'];
}

/* The one switch of several a call has to turn on, refused with `message` for none or more than one. */
function oneOf<Name extends string>(names: readonly Name[], input: Readonly<Partial<Record<Name, boolean>>>, message: string): Name {
    const on = names.filter((name) => input[name] === true);

    if (on.length !== 1) {
        throw new ToolRefusal('bad-arguments', message);
    }

    return on[0]!;
}

const deviceList = defineActionTool('device', {
    name: 'device_list',
    action: 'device.list',
    description: "Lists this machine's simulators, emulators and phones, with their ids.",
    annotations: { readOnly: true },
    input: z.object({}),
    async run(_input, call) {
        const listed = await runAction(call, 'device.list', {});

        return orNote(listed.devices.map(machineDeviceLine), 'This machine has no simulator, emulator or phone right now; the person brings one');
    }
});

const deviceStart = defineActionTool('device', {
    name: 'device_start',
    action: 'device.start',
    description: 'Starts a simulator or emulator and claims it for you.',
    input: z.object({ device: deviceInput('device_start') }),
    async run(input, call) {
        const started = await runAction(call, 'device.start', { nodeId: input.device });

        if (!started.ready) {
            return [
                `started\t${input.device}\t${field(started.device)}\tstarting`,
                'next\tdevice_start\tit is still starting; call it again to wait until it can be operated'
            ];
        }

        return [`started\t${input.device}\t${field(started.device)}\t${started.state}`, 'next\tdevice_state\twhat the device can do now'];
    }
});

const deviceState = defineActionTool('device', {
    name: 'device_state',
    action: 'device.inspect',
    description: "Reads a device's state, screen elements and buttons.",
    annotations: { readOnly: true },
    input: z.object({
        device: deviceInput('device_state'),
        find: z.string({ error: 'find needs the text to look for' }).min(1, 'find needs the text to look for').optional()
    }),
    async run(input, call) {
        const state = await runAction(call, 'device.inspect', { nodeId: input.device, find: input.find ?? null });
        const { device } = state;

        return [
            `device\t${state.deviceId ?? input.device}\t${field(device.name)}\t${device.platform}\t${device.kind}\t${field(device.runtime)}`,
            `state\t${state.state ?? 'missing'}`,
            powerLine(state),
            `screen\t${screenLine(state)}`,
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

const deviceShot = defineActionTool('device', {
    name: 'device_shot',
    action: 'device.screenshot',
    description: "Takes a png of a device's screen.",
    annotations: { readOnly: true },
    input: z.object({ device: deviceInput('device_shot') }),
    async run(input, call) {
        const shot = await runAction(call, 'device.screenshot', { nodeId: input.device });
        call.image(shot.path);

        return [`shot\t${field(shot.path)}\t${shot.width}x${shot.height}\tRead it with your own tools`];
    }
});

/* A tap, a swipe, a button and typing meet the same claim and leave the same line, so one tool picks among them. */
const deviceInputTool = defineTool('device', {
    name: 'device_input',
    description: 'Taps, swipes, presses a button or types on a device.',
    input: z.object({
        action: z.enum(INPUTS, { error: `device_input needs action, one of ${INPUTS.join(', ')}` }),
        device: deviceInput('device_input'),
        at: pixelPair('at').optional().describe('For tap, x,y of the last device_shot'),
        element: z
            .number({ error: 'element takes the number in brackets that device_state gave the element' })
            .int('element takes the number in brackets that device_state gave the element')
            .min(0, 'element takes the number in brackets that device_state gave the element')
            .optional()
            .describe('For tap, a number from the last device_state'),
        from: pixelPair('from').optional().describe('For swipe, the x,y it presses on'),
        to: pixelPair('to').optional().describe('For swipe, the x,y it lets go on'),
        ms: z
            .number({ error: 'ms takes a whole number of milliseconds' })
            .int('ms takes a whole number of milliseconds')
            .min(50, 'ms is between 50 and 5000')
            .max(5000, 'ms is between 50 and 5000')
            .optional()
            .describe('For swipe'),
        name: z.string().min(1, 'name needs a button, as device_state lists them').optional().describe('For button, one device_state lists'),
        text: z.string().min(1, 'text needs the text to type').optional().describe('For type')
    }),
    async run(input, call) {
        const own = INPUT_FIELDS[input.action];
        const given = [...new Set(Object.values(INPUT_FIELDS).flat())].filter((key) => !own.includes(key) && input[key as keyof typeof input] !== undefined);

        if (given.length > 0) {
            throw new ToolRefusal('bad-arguments', `device_input ${input.action} takes no ${given.join(', ')}`, [`fields\taction\tdevice\t${own.join('\t')}`]);
        }

        const nodeId = input.device;

        switch (input.action) {
            case 'tap': {
                const outcome = await runAction(call, 'device.tap', { nodeId, x: input.at?.x ?? null, y: input.at?.y ?? null, element: input.element ?? null });

                return doneLine('tap', outcome);
            }

            case 'swipe': {
                if (input.from === undefined || input.to === undefined) {
                    throw new ToolRefusal('bad-arguments', `${input.from === undefined ? 'from' : 'to'} needs a pixel of the last shot, as x,y`);
                }

                const outcome = await runAction(call, 'device.swipe', {
                    nodeId,
                    fromX: input.from.x,
                    fromY: input.from.y,
                    toX: input.to.x,
                    toY: input.to.y,
                    ms: input.ms ?? null
                });

                return doneLine('swipe', outcome);
            }

            case 'button': {
                if (input.name === undefined) {
                    throw new ToolRefusal('bad-arguments', 'name needs a button, as device_state lists them');
                }

                return doneLine('button', await runAction(call, 'device.button', { nodeId, button: input.name }));
            }

            case 'type': {
                if (input.text === undefined) {
                    throw new ToolRefusal('bad-arguments', 'text needs the text to type');
                }

                return doneLine('type', await runAction(call, 'device.type', { nodeId, text: input.text }));
            }
        }
    }
});

const deviceApp = defineTool('device', {
    name: 'device_app',
    description: 'Launches or stops an app on a device.',
    input: z.object({
        action: z.enum(APP_ACTIONS, { error: `device_app needs action, one of ${APP_ACTIONS.join(', ')}` }),
        device: deviceInput('device_app'),
        app: APP_INPUT
    }),
    async run(input, call) {
        if (input.action === 'launch') {
            return doneLine('launch', await runAction(call, 'device.launch', { nodeId: input.device, app: input.app }));
        }

        return doneLine('terminate', await runAction(call, 'device.terminate', { nodeId: input.device, app: input.app }));
    }
});

const deviceSet = defineActionTool('device', {
    name: 'device_set',
    action: 'device.set',
    description: "Sets a device's appearance, text size, status bar, battery or location.",
    input: z.object({
        device: deviceInput('device_set'),
        appearance: z.enum(['light', 'dark'], { error: 'appearance is light or dark' }).optional(),
        text_size: z.enum(['small', 'default', 'large', 'extra-large'], { error: 'text_size is small, default, large or extra-large' }).optional(),
        status_bar: z.enum(['clean', 'default'], { error: 'status_bar is clean or default' }).optional().describe('clean shows 9:41 and full bars'),
        battery: z
            .number({ error: 'battery takes a whole number of percent' })
            .int('battery takes a whole number of percent')
            .min(0, 'battery is between 0 and 100')
            .max(100, 'battery is between 0 and 100')
            .optional(),
        location: LOCATION_INPUT.optional().describe('lat,lon'),
        charging: z.boolean().optional(),
        clear_location: z.boolean().optional()
    }),
    async run(input, call) {
        const outcome = await runAction(call, 'device.set', {
            nodeId: input.device,
            appearance: input.appearance ?? null,
            textSize: input.text_size ?? null,
            statusBar: input.status_bar ?? null,
            battery: input.battery ?? null,
            charging: input.charging === true ? true : null,
            latitude: input.location?.latitude ?? null,
            longitude: input.location?.longitude ?? null,
            clearLocation: input.clear_location === true ? true : null
        });

        return doneLine('set', outcome);
    }
});

const deviceOpen = defineActionTool('device', {
    name: 'device_open',
    action: 'device.open',
    description: 'Opens a link or an app scheme on a device.',
    input: z.object({ device: deviceInput('device_open'), url: requiredField('device_open needs url, a link or a scheme of an app such as myapp://') }),
    async run(input, call) {
        return doneLine('open', await runAction(call, 'device.open', { nodeId: input.device, url: input.url }));
    }
});

const devicePermission = defineActionTool('device', {
    name: 'device_permission',
    action: 'device.permission',
    description: "Grants, revokes or resets an app's permissions on a device.",
    input: z.object({
        device: deviceInput('device_permission'),
        app: APP_INPUT,
        name: z.enum(PERMISSIONS, { error: `name is one of ${PERMISSIONS.join(', ')}` }).optional(),
        grant: z.boolean().optional(),
        revoke: z.boolean().optional(),
        reset: z.boolean().optional(),
        all: z.boolean().optional()
    }),
    async run(input, call) {
        const decision = oneOf(['grant', 'revoke', 'reset'] as const, input, 'device_permission takes one of grant, revoke and reset');

        if ((input.name === undefined) === (input.all !== true)) {
            throw new ToolRefusal('bad-arguments', 'device_permission takes one permission in name, or all');
        }

        const outcome = await runAction(call, 'device.permission', { nodeId: input.device, app: input.app, decision, permission: input.name ?? null });

        return doneLine('permission', outcome);
    }
});

const devicePush = defineActionTool('device', {
    name: 'device_push',
    action: 'device.push',
    description: 'Sends a local push notification to an app on a simulator.',
    input: z.object({
        device: deviceInput('device_push'),
        app: APP_INPUT,
        payload: requiredField('device_push needs payload, the alert text').describe('The alert text')
    }),
    async run(input, call) {
        return doneLine('push', await runAction(call, 'device.push', { nodeId: input.device, app: input.app, payload: input.payload }));
    }
});

const deviceBiometric = defineActionTool('device', {
    name: 'device_biometric',
    action: 'device.biometric',
    description: 'Enrolls Face ID or Touch ID on a simulator, or answers a check.',
    input: z.object({
        device: deviceInput('device_biometric'),
        sensor: z.enum(['face', 'finger'], { error: 'sensor is face or finger' }).optional(),
        match: z.boolean().optional(),
        nomatch: z.boolean().optional(),
        enroll: z.boolean().optional(),
        unenroll: z.boolean().optional()
    }),
    async run(input, call) {
        const event = oneOf(['match', 'nomatch', 'enroll', 'unenroll'] as const, input, 'device_biometric takes one of match, nomatch, enroll and unenroll');

        return doneLine('biometric', await runAction(call, 'device.biometric', { nodeId: input.device, event, sensor: input.sensor ?? null }));
    }
});

const deviceClipboard = defineActionTool('device', {
    name: 'device_clipboard',
    action: 'device.clipboard',
    description: 'Reads the clipboard of a device, or puts text on it.',
    input: z.object({ device: deviceInput('device_clipboard'), text: z.string().optional().describe('Text to put on it; without it, reads it') }),
    async run(input, call) {
        const outcome = await runAction(call, 'device.clipboard', { nodeId: input.device, text: input.text ?? null });

        return [`clipboard\t${quote(outcome.text)}`];
    }
});

const deviceRecord = defineActionTool('device', {
    name: 'device_record',
    action: 'device.record',
    description: "Records a device's screen and answers the video's path.",
    input: z.object({
        device: deviceInput('device_record'),
        seconds: z
            .number({ error: 'device_record needs seconds, how long to record' })
            .int('seconds takes a whole number')
            .min(1, 'seconds is between 1 and 60')
            .max(60, 'seconds is between 1 and 60')
    }),
    async run(input, call) {
        const outcome = await runAction(call, 'device.record', { nodeId: input.device, seconds: input.seconds });

        return [`recording\t${field(outcome.path)}\tRead it with your own tools`];
    }
});

const deviceInstall = defineActionTool('device', {
    name: 'device_install',
    action: 'device.install',
    description: 'Installs an app bundle on a device.',
    input: z.object({ device: deviceInput('device_install'), path: requiredField('device_install needs path, the app to install') }),
    async run(input, call) {
        return doneLine('install', await runAction(call, 'device.install', { nodeId: input.device, path: input.path }));
    }
});

const deviceMedia = defineActionTool('device', {
    name: 'device_media',
    action: 'device.media',
    description: "Adds pictures and videos to a device's photos.",
    input: z.object({
        device: deviceInput('device_media'),
        paths: z
            .array(z.string().min(1, 'paths has an empty path in it'), { error: 'device_media needs paths, at least one file' })
            .min(1, 'device_media needs paths, at least one file')
            .max(20, 'device_media takes 20 pictures at most')
    }),
    async run(input, call) {
        return doneLine('media', await runAction(call, 'device.media', { nodeId: input.device, paths: input.paths }));
    }
});

/* Named as the usage counter its calls add to, which the usage report and the client know. */
export const deviceToolkit = defineToolkit('device', [
    deviceList,
    deviceStart,
    deviceState,
    deviceShot,
    deviceInputTool,
    deviceApp,
    deviceSet,
    deviceOpen,
    devicePermission,
    devicePush,
    deviceBiometric,
    deviceClipboard,
    deviceRecord,
    deviceInstall,
    deviceMedia
]);
