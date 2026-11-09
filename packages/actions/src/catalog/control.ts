import {
    ComputerApprovalChoiceSchema,
    DeviceAppearanceSchema,
    DevicePermissionSchema,
    DevicePowerSchema,
    DeviceReferenceSchema,
    DeviceStateSchema,
    DeviceStatusBarSchema,
    DeviceTextSizeSchema
} from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_KEY_COMBOS, MAX_TYPED_LENGTH } from '../limits.ts';
import {
    nodeId,
    frame,
    PERSON_VOICE_AND_AGENT,
    AGENT,
    PERSON_AND_AGENT,
    PERSON,
    operatedView,
    browserNode,
    browserOutcome,
    deviceNode,
    devicePixel,
    deviceDone,
    deviceElement,
    deviceSize,
    deviceApp,
    devicePath,
    computerApp,
    computerAppRef,
    computerHold,
    computerFront,
    computerStateCut,
    computerThenState,
    computerElement,
    computerPixel,
    computerState,
    computerOutcome
} from './fields.ts';

export const CONTROL_ACTIONS = {
    'browser.inspect': {
        title: 'Read a page',
        description: 'Where the page of a browser node stands: its address, its title, whether it is loading and what its history holds.',
        effect: 'read',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.navigate': {
        title: 'Go to an address',
        description: 'Sends the page of a browser node to an address.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView, url: z.string().min(1).describe('A whole http or https address, scheme and all') }),
        output: browserOutcome.extend({
            // The address a node that had none was given: written in the project, with no page driven.
            assigned: z.object({ url: z.string(), title: z.string() }).nullable()
        })
    },
    'browser.back': {
        title: 'Go back',
        description: 'Takes the page one step back through its own history.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.forward': {
        title: 'Go forward',
        description: 'Takes the page one step forward again, after a step back.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.reload': {
        title: 'Reload a page',
        description: 'Loads the page of a browser node again.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({
            nodeId: browserNode,
            viewId: operatedView,
            hard: z.boolean().describe('Loads it past the cache, the way a person holding shift would')
        }),
        output: browserOutcome
    },
    'browser.stop': {
        title: 'Stop loading',
        description: 'Ends a load that is still running, leaving the page as far as it got.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.screenshot': {
        title: 'Photograph a page',
        description: 'Writes a png of the page of a browser node and answers where it is.',
        effect: 'read',
        domain: 'pages',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome.extend({
            // On this machine, outside the project folder; null when nobody has the page open.
            path: z.string().nullable()
        })
    },
    'computer.answerApproval': {
        title: 'Answer a computer use card',
        description:
            'Lets an agent into an app for as long as its chat or terminal session runs, or always on this machine, or keeps it out. A terminal stays out whatever the answer.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON,
        input: z.object({ requestId: z.string().min(1), choice: ComputerApprovalChoiceSchema }),
        // False when the card was gone already: another client was first, or its time ran out.
        output: z.object({ requestId: z.string(), accepted: z.boolean() })
    },
    'computer.apps': {
        title: 'List apps',
        description:
            'Lists the apps that run on this machine, with how the caller stands with each: allowed always, allowed this time, to ask for, or a terminal.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({
            screenRecording: z.boolean(),
            apps: z.array(
                computerAppRef.extend({
                    frontmost: z.boolean(),
                    hidden: z.boolean(),
                    access: z.enum(['always', 'this-time', 'ask', 'terminal', 'no-bundle-id'])
                })
            )
        })
    },
    'computer.state': {
        title: 'Read an app',
        description: 'Reads the accessibility tree of the key window of an app and writes a picture of that window.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            ...computerHold,
            ...computerFront,
            find: z
                .string()
                .min(1)
                .nullish()
                .describe('Only the elements whose title, value, description or identifier holds this text, ignoring case, and what they sit in'),
            within: computerElement.nullish().describe('Only this element of the last state and what is inside it'),
            ...computerStateCut
        }),
        output: computerState
    },
    'computer.read': {
        title: 'Read an element of an app',
        description: 'Reads the title, value and description of one element of an app whole, where a state cuts them, with its role and frame.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ app: computerApp, element: computerElement, ...computerHold, ...computerFront }),
        output: z.object({
            app: computerAppRef,
            element: z.number().int(),
            role: z.string(),
            title: z.string().nullable(),
            value: z.string().nullable(),
            description: z.string().nullable(),
            placeholder: z.string().nullable(),
            identifier: z.string().nullable(),
            frame: frame.nullable(),
            // Per text that was cut: how long it is whole; what is shown is its start.
            cut: z.record(z.string(), z.number().int())
        })
    },
    'computer.wait': {
        title: 'Wait for an app',
        description: 'Reads an app until a text appears, a text is gone or an element has a value, or the time is up, and answers with what changed.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            text: z.string().min(1).nullish().describe('Wait until an element holds this text in its title, value, description or identifier, ignoring case'),
            gone: z.string().min(1).nullish().describe('Wait until no element holds this text'),
            element: computerElement.nullish().describe('With value: the element of the last state to watch'),
            value: z.string().nullish().describe('With element: wait until its value is exactly this'),
            timeout: z.number().int().min(1).max(110).nullish().describe('Seconds to wait for it; 10 without it'),
            ...computerHold,
            ...computerFront,
            fullState: z.boolean().nullish().describe('The whole tree at the end instead of what changed'),
            ...computerStateCut
        }),
        output: z.object({
            app: computerAppRef,
            met: z.boolean(),
            condition: z.string(),
            waited: z.number(),
            state: computerState.nullable(),
            stateError: z.string().nullable()
        })
    },
    'computer.click': {
        title: 'Click in an app',
        description: 'Clicks an element of an app, or a pixel of its last screenshot.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            element: computerElement.nullish(),
            x: computerPixel.nullish(),
            y: computerPixel.nullish(),
            count: z.number().int().min(1).max(3).nullish().describe('2 for a double click'),
            button: z.enum(['left', 'right']).nullish().describe('right for a context menu; left without it'),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.type': {
        title: 'Type in an app',
        description: 'Types text into the focused element of an app; a newline is Return and a tab is Tab.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            text: z
                .string()
                .min(1)
                .max(MAX_TYPED_LENGTH, `At most ${MAX_TYPED_LENGTH} characters at a time; type the rest in another call`)
                .describe(`The text to type, at most ${MAX_TYPED_LENGTH} characters`),
            element: computerElement.nullish().describe('An element of the last state to focus first'),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.key': {
        title: 'Press keys in an app',
        description: 'Presses key combinations in an app, one after the other.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            combos: z
                .array(z.string().min(1))
                .min(1)
                .max(MAX_KEY_COMBOS, `At most ${MAX_KEY_COMBOS} key combinations at a time; press the rest in another call`)
                .describe(`Key combinations such as cmd+n, return, escape, shift+tab, at most ${MAX_KEY_COMBOS}`),
            element: computerElement.nullish().describe('An element of the last state to focus first'),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.setValue': {
        title: 'Set a value in an app',
        description: 'Sets the value of a text field, text area or slider of an app directly.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            element: computerElement,
            value: z.string().describe('The value; a number element takes a number, true or false'),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.scroll': {
        title: 'Scroll in an app',
        description: 'Scrolls an element of an app, or the scroll area under a pixel of its last screenshot.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            element: computerElement.nullish(),
            x: computerPixel.nullish(),
            y: computerPixel.nullish(),
            direction: z.enum(['up', 'down', 'left', 'right']).describe('Which way the content moves into view'),
            pages: z.number().gt(0).max(50).nullish().describe('How far, in pages of 90 percent of the area; 1 without it'),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.menu': {
        title: 'Use the menu bar of an app',
        description: 'Lists the menu bar of an app, or runs one of its items.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            item: z
                .string()
                .min(1)
                .nullish()
                .describe('The item to run: its number in the last listing, or a path such as "File > Save"; without it the menu bar is listed'),
            ...computerThenState
        }),
        output: computerOutcome.extend({ listing: z.array(z.string()).nullable() })
    },
    'computer.drag': {
        title: 'Drag in an app',
        description: 'Presses on an element or a pixel of an app, moves to another and lets go there.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            app: computerApp,
            from: computerElement.nullish().describe('The element to press on'),
            fromX: computerPixel.nullish(),
            fromY: computerPixel.nullish(),
            to: computerElement.nullish().describe('The element to let go on'),
            toX: computerPixel.nullish(),
            toY: computerPixel.nullish(),
            ...computerThenState
        }),
        output: computerOutcome
    },
    'computer.open': {
        title: 'Open an app',
        description: 'Starts an app, or brings it to the front and shows it when it runs, and waits for a window.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ app: computerApp, ...computerThenState }),
        output: computerOutcome
    },
    'device.inspect': {
        title: 'Read a device',
        description: 'Which device this is, whether it runs, its screen and buttons, and what an agent can do on it.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            find: z
                .string()
                .min(1)
                .nullish()
                .describe('Only the elements whose label, value or identifier holds this text, ignoring case, and what they sit in')
        }),
        output: z.object({
            nodeId,
            // The id device.list gives the device; null while this machine does not have it.
            deviceId: z.string().nullable(),
            device: DeviceReferenceSchema,
            // False when this machine has no such device right now; everything below is then empty.
            present: z.boolean(),
            state: z.enum(['booted', 'shutdown', 'transitioning']).nullable(),
            // The picture the last shot took, which is what coordinates are counted in; null before a shot.
            screen: deviceSize.nullable(),
            buttons: z.array(z.string()),
            can: z.object({ shot: z.boolean(), input: z.boolean(), type: z.boolean(), launch: z.boolean(), tree: z.boolean() }),
            // A phone's own battery; null for a simulator or an emulator, and for a phone that could not say.
            power: DevicePowerSchema.nullable(),
            // What the device shows as elements, frames in pixels of its screen; null when it has no tree, and treeError says why when reading one failed.
            tree: z
                .object({
                    screen: deviceSize,
                    truncated: z.boolean(),
                    count: z.number().int(),
                    matches: z.number().int().nullable(),
                    elements: z.array(
                        z.object({
                            handle: z.number().int(),
                            depth: z.number().int(),
                            role: z.string(),
                            subrole: z.string().nullable(),
                            label: z.string().nullable(),
                            value: z.string().nullable(),
                            identifier: z.string().nullable(),
                            frame,
                            enabled: z.boolean(),
                            offscreen: z.boolean()
                        })
                    )
                })
                .nullable(),
            treeError: z.string().nullable()
        })
    },
    'device.list': {
        title: 'List devices',
        description: 'Lists the simulators, emulators and phones this machine has now, whether each runs, and the id every other device action takes.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({}),
        output: z.object({
            devices: z.array(DeviceReferenceSchema.extend({ deviceId: z.string(), state: DeviceStateSchema }))
        })
    },
    'device.screenshot': {
        title: 'Photograph a device',
        description: 'Writes a png of the screen of a device and answers where it is and how many pixels it has.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode }),
        // On this machine, outside the project folder.
        output: z.object({ nodeId, path: z.string(), width: z.number().int(), height: z.number().int() })
    },
    'device.tap': {
        title: 'Tap a device',
        description: 'Taps the screen of a device at a pixel of its last shot, or in the middle of an element of its last state.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode, x: devicePixel.nullish(), y: devicePixel.nullish(), element: deviceElement.nullish() }),
        output: deviceDone
    },
    'device.swipe': {
        title: 'Swipe on a device',
        description: 'Presses on the screen of a device at one pixel of its last shot, moves to another and lets go there.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            fromX: devicePixel,
            fromY: devicePixel,
            toX: devicePixel,
            toY: devicePixel,
            ms: z.number().int().min(50).max(5000).nullish().describe('How long the finger takes from one to the other, in milliseconds; 300 without it')
        }),
        output: deviceDone
    },
    'device.button': {
        title: 'Press a device button',
        description: 'Presses one of the buttons a device announces, such as home or lock.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            button: z.string().min(1).describe('A button the device announces, as device.inspect lists them')
        }),
        output: deviceDone
    },
    'device.type': {
        title: 'Type on a device',
        description: 'Types text into whatever has the focus on a device.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            text: z.string().min(1).max(2000).describe('The text to type; a newline is Return and a tab is Tab')
        }),
        output: deviceDone
    },
    'device.launch': {
        title: 'Open an app on a device',
        description: 'Opens an app on a device by its bundle id or package name.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            app: deviceApp
        }),
        output: deviceDone
    },
    'device.set': {
        title: 'Set up a device',
        description: 'Changes what a device shows: its appearance, text size, status bar, battery and simulated location.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            appearance: DeviceAppearanceSchema.nullish(),
            textSize: DeviceTextSizeSchema.nullish(),
            statusBar: DeviceStatusBarSchema.nullish(),
            battery: z.number().int().min(0).max(100).nullish().describe('The battery level in percent'),
            charging: z.boolean().nullish().describe('Whether the battery charges, with battery'),
            latitude: z.number().min(-90).max(90).nullish(),
            longitude: z.number().min(-180).max(180).nullish(),
            clearLocation: z.boolean().nullish().describe('Takes the simulated location away')
        }),
        output: deviceDone
    },
    'device.open': {
        title: 'Open a link on a device',
        description: 'Opens a link or an app scheme on a device.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode, url: z.string().trim().min(1).max(2048) }),
        output: deviceDone
    },
    'device.permission': {
        title: 'Change an app permission on a device',
        description: 'Grants, revokes or resets one permission of an app on a device, or all of them.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            app: deviceApp,
            decision: z.enum(['grant', 'revoke', 'reset']),
            permission: DevicePermissionSchema.nullish().describe('One permission; without it every permission of the app')
        }),
        output: deviceDone
    },
    'device.push': {
        title: 'Send a push to a device',
        description: 'Sends a local push notification to an app on a simulator.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode, app: deviceApp, payload: z.string().min(1).max(16_384).describe('The alert text') }),
        output: deviceDone
    },
    'device.biometric': {
        title: 'Answer a biometric check on a device',
        description: 'Enrolls Face ID or Touch ID on a simulator, or answers a check with a match or no match.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            event: z.enum(['enroll', 'unenroll', 'match', 'nomatch']),
            sensor: z.enum(['face', 'finger']).nullish().describe('Face ID or a fingerprint; face on iOS and finger on Android without it')
        }),
        output: deviceDone
    },
    'device.clipboard': {
        title: 'Read or write a device clipboard',
        description: 'Reads the clipboard of a device, or puts text on it.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({
            nodeId: deviceNode,
            text: z.string().max(1_048_576).nullish().describe('What to put on it; without it the clipboard is read')
        }),
        output: deviceDone.extend({ text: z.string() })
    },
    'device.record': {
        title: 'Record a device',
        description: 'Records the screen of a device for some seconds and answers where the video is.',
        effect: 'read',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode, seconds: z.number().int().min(1).max(60) }),
        // On this machine, outside the project folder.
        output: deviceDone.extend({ path: z.string() })
    },
    'device.install': {
        title: 'Install an app on a device',
        description: 'Installs an app bundle from a file the agent may hand over on a device.',
        effect: 'external',
        domain: 'machine',
        actors: AGENT,
        input: z.object({ nodeId: deviceNode, path: devicePath }),
        output: deviceDone
    },
    'device.media': {
        title: 'Add pictures to a device',
        description: 'Adds pictures and videos the agent may hand over to the photos of a device.',
        effect: 'external',
        domain: 'machine',
        actors: AGENT,
        input: z.object({ nodeId: deviceNode, paths: z.array(devicePath).min(1).max(20) }),
        output: deviceDone
    },
    'device.terminate': {
        title: 'Stop an app on a device',
        description: 'Stops an app that runs on a device.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode, app: deviceApp }),
        output: deviceDone
    },
    'device.start': {
        title: 'Start a device',
        description:
            'Starts a simulator or an emulator for the person, as its start in the side panel does, and claims it for the agent; a phone has no start.',
        effect: 'external',
        domain: 'machine',
        actors: PERSON_AND_AGENT,
        input: z.object({ nodeId: deviceNode }),
        output: deviceDone.extend({ state: DeviceStateSchema, ready: z.boolean() })
    }
} as const;
