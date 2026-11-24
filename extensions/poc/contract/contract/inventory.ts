/*
 * Where the contract suite holds each row of the extension API's inventory (`@ruimte/contracts/extension-inventory`):
 * the scenario that uses it, the one that refuses it without its permission and the one that stops it. A row the suite
 * does not hold yet is a known gap with its reason. `bun run check` fails for a row in neither list, so a call the API
 * gains lands with its scenario.
 */
import type { ExtensionApiCoverage, ExtensionApiRow } from '@ruimte/contracts/extension-inventory';

const REFUSES = 'refuses every call without its permission, before anything else, in the words of Ruimte';
const SLOT = 'tells a slot what is true at its place, and hands the same to run';
const NOTE = 'writes a note beside a node and links the two, with value undefined for a link';
const EVENT = 'hands a client event to what listens, until it stops';
const NODE = 'makes a node of its own with the size and data its definition starts with';
const OTHER_KIND = 'reads nothing of another kind: a chat with terminals.read, a terminal with chats.read';
const STARTS = 'starts an agent as a node on the canvas in front, and as a view of its own with no canvas there';
const OTHER_WINDOW = "shows what another window wrote to this computer's storage and to a setting";
const NEW_CANVAS = 'opens a canvas it makes, so the note it makes next lands there';
const NEW_NOTE = 'makes a note the size and title of a note, centered beside its node on the grid, and selects it';
const ON_SCREEN = 'reads what is on screen of the canvas, and whether a node is in view';
const KEYBOARD = 'hands the keyboard to a view it names, and refuses a canvas overlay in a space it does not know';
const BESIDE = 'tells a widget beside a view of its own which view it is, and where the composer lies';
const COMPUTER = 'keeps a value on this computer outside a component, which useStorage reads and a watch hears change';
const WATCH = 'tells a watch of a folder that a file under it changed, until it stops';
const IN_FRONT = 'says nothing when it opens the view in front, and shows no failure for an action a person stopped';
const HEARS = 'hears a machine event only with its permission, and says why not in the log';
const DEAF = 'hears no more of an event once it stops following it';
const LOADS = 'answers what its module awaits as it loads, and keeps what it stored then';
const SENDS = 'sends a chat at most 20 messages an hour, each with value undefined';
const NOT_ASKED = 'refuses what the manifest does not ask for, in the words of the machine';
const CHAT = 'starts a chat a person sees with agents.start, and none without it';
const TOOL = 'answers an agent through its tool, and has no tool without agents.tools';
const ASKS = 'asks an agent and lists the chats, each only with its permission';
const SECRET = 'keeps a secret apart from what it stores, and writes what it logs';
const OWN_TERMINAL = 'opens a terminal on the canvas in front, and types only into a terminal it opened itself';
const PROFILE = 'opens a terminal with its profile, and types only into a terminal it opened itself';
const EACH_TERMINAL = 'opens, types into and reads a terminal each only with its permission';
const DEFINES = 'defines a terminal profile only when its manifest asks for it, names it as proposed and lists it';
const SAVES_LAUNCH = 'adds a launch and changes one through the machine, which is handed what the call gave';
const LISTS_LAUNCHES = 'lists its launches for the machine to start, and tells when they change until it is asked to stop';
const DEFINES_SOURCES = 'defines a launch source and a problem source only when its manifest asks for each, names it as proposed and lists it';
const REPORTS = 'reports the problems of a source file by file, replaces what it said of a file and takes it all back';
const NO_REPORT = 'reports no problem without its permission, outside the project or past what the machine holds of one file';
const FILES = 'reads and lists the files of a project, and hears a file change until it stops following it';
const NO_FILES = 'reads, lists and follows no file without files.read, and none outside the project';
const FOLLOWS = 'hears a launch change and a project open and close in a shape of its own, each only with its permission';
const PROJECT_SETTING = "puts a section in a project's settings, whose field a surface reads for the project in front";
const NO_PROJECT_SETTING = "puts no section in a project's settings while its manifest does not name the part as proposed";
const CHOSEN = "reads what a person chose in a project's settings, and nothing while its manifest does not name the part";

export const EXTENSION_API_SCENARIOS: Readonly<Partial<Record<ExtensionApiRow, ExtensionApiCoverage>>> = {
    'client/call/agents.start': { scenario: STARTS, refusal: REFUSES },
    'client/call/agents.stream': { scenario: 'ends a stream that fails after some pieces with that failure', refusal: REFUSES },
    'client/call/canvas.createNode': { scenario: NODE, refusal: REFUSES },
    'client/call/canvas.createNote': { scenario: NOTE, refusal: REFUSES },
    'client/call/canvas.group': {
        scenario: 'groups only nodes of the canvas in front in the frame a person would draw, and selects the group',
        refusal: REFUSES
    },
    'client/call/canvas.link': { scenario: NOTE, refusal: REFUSES },
    'client/call/canvas.remove': { scenario: 'removes only what is on the canvas in front, and leaves nothing selected', refusal: REFUSES },
    'client/call/chats.inspect': {
        scenario: 'reads what a chat runs on and that something waits in it through the machine, which is handed the chat it named',
        refusal: REFUSES
    },
    'client/call/chats.read': { scenario: 'reads a chat it started in a view of its own', refusal: REFUSES },
    'client/call/context.read': {
        scenario: 'reads the nodes it names and those on the view it names, each once, and nothing when it names neither',
        refusal: REFUSES
    },
    'client/call/files.watch': { scenario: WATCH, refusal: REFUSES, cleanup: WATCH },
    'client/call/launches.create': { scenario: SAVES_LAUNCH, refusal: REFUSES },
    'client/call/launches.edit': { scenario: SAVES_LAUNCH, refusal: REFUSES },
    'client/call/getServer': { scenario: 'calls server/ outside a component with getServer, answering as useServer does' },
    'client/call/nodeColorValue': { scenario: 'reads a node a collapsed group hides as hidden, and its color by its accent and as it is drawn' },
    'client/call/onEvent': { scenario: EVENT, cleanup: EVENT },
    'client/call/storage.delete': { scenario: COMPUTER },
    'client/call/storage.get': { scenario: COMPUTER },
    'client/call/storage.set': { scenario: COMPUTER },
    'client/call/storage.watch': { scenario: COMPUTER, cleanup: COMPUTER },
    'client/call/terminals.open': { scenario: OWN_TERMINAL, refusal: REFUSES },
    'client/call/terminals.read': { scenario: OTHER_KIND, refusal: REFUSES },
    'client/call/terminals.write': { scenario: OWN_TERMINAL, refusal: REFUSES },
    'client/call/views.createCanvas': { scenario: NEW_CANVAS, refusal: REFUSES },
    'client/call/views.focus': { scenario: KEYBOARD },
    'client/call/views.open': { scenario: IN_FRONT },
    'client/event/selection.changed': { scenario: EVENT },
    'client/event/view.changed': { scenario: IN_FRONT },
    'client/hook/useActiveView': { scenario: NEW_CANVAS },
    'client/hook/useCanvasView': { scenario: ON_SCREEN },
    'client/hook/useInView': { scenario: ON_SCREEN },
    'client/hook/useNode': { scenario: NODE },
    'client/hook/useNodeData': { scenario: NODE },
    'client/hook/useProjectSetting': { scenario: PROJECT_SETTING },
    'client/hook/useProviders': { scenario: 'lists the agents the machine can start' },
    'client/hook/useSelection': { scenario: NEW_NOTE },
    'client/hook/useServer': { scenario: 'asks server/ again for what .use() kept after reload, and after the connection to the machine comes back' },
    'client/hook/useSetting': { scenario: OTHER_WINDOW },
    'client/hook/useStorage': { scenario: 'keeps storage per scope, and reads it back in another surface' },
    'client/hook/useViews': { scenario: 'keeps a view of its own as a view of a kind Ruimte does not know, as useViews reads it' },
    'client/provider/defineAction': { scenario: SLOT },
    'client/provider/defineCanvasOverlay': { scenario: KEYBOARD },
    'client/provider/defineExtensionSettings': {
        scenario: 'keeps the settings page of an extension Ruimte does not ship under Extensions, also when it asks for a section'
    },
    'client/provider/defineEditorDecoration': {
        scenario: 'marks lines in the margin of an open file, told only which file, and is asked again after it says they changed until the editor goes',
        refusal: 'marks nothing in the margin while its manifest does not name the part as proposed',
        cleanup: 'marks lines in the margin of an open file, told only which file, and is asked again after it says they changed until the editor goes'
    },
    'client/provider/defineLanguage': {
        scenario: 'covers the files of a language of its own by extension and by name, and refuses a grammar outside its pack',
        refusal: 'covers no file with a language while its manifest does not name the part as proposed'
    },
    'client/provider/defineNode': { scenario: NODE },
    'client/provider/defineProjectSettings': { scenario: PROJECT_SETTING, refusal: NO_PROJECT_SETTING },
    'client/provider/defineView': { scenario: 'keeps a view of its own as a view of a kind Ruimte does not know, as useViews reads it' },
    'client/slot/nodeHeader': { scenario: SLOT },
    'client/slot/selectionBar': { scenario: SLOT },
    'client/slot/viewAccessory': { scenario: BESIDE },
    'client/slot/viewToolbar': { scenario: SLOT },
    'manifest/contribution/id': { scenario: NOT_ASKED },
    'manifest/contribution/name': { scenario: REFUSES },
    'manifest/contribution/permissions': { scenario: REFUSES },
    'manifest/contribution/proposed': { scenario: 'does not load with a proposed part as an extension a person installed' },
    'manifest/contribution/provides': { scenario: DEFINES },
    'server/call/agents.run': { scenario: ASKS, refusal: ASKS },
    'server/call/agents.start': { scenario: CHAT, refusal: CHAT },
    'server/call/chats.list': { scenario: ASKS, refusal: ASKS },
    'server/call/chats.send': { scenario: SENDS, refusal: NOT_ASKED },
    'server/call/emit': { scenario: 'says an event without a payload as one a client hears with none' },
    'server/call/files.list': { scenario: FILES, refusal: NO_FILES },
    'server/call/files.readText': { scenario: FILES, refusal: NO_FILES },
    'server/call/files.watch': { scenario: FILES, refusal: NO_FILES, cleanup: FILES },
    'server/call/problems.clear': { scenario: REPORTS, refusal: NO_REPORT },
    'server/call/projectSettings.get': { scenario: CHOSEN, refusal: CHOSEN },
    'server/call/problems.report': { scenario: REPORTS, refusal: NO_REPORT },
    'server/event/launch.status': { scenario: FOLLOWS, refusal: FOLLOWS },
    'server/event/project.closed': { scenario: FOLLOWS, refusal: FOLLOWS },
    'server/event/project.opened': { scenario: FOLLOWS, refusal: FOLLOWS },
    'server/provider/defineLaunchSource': { scenario: LISTS_LAUNCHES, refusal: DEFINES_SOURCES, cleanup: LISTS_LAUNCHES },
    'server/provider/defineProblemSource': { scenario: REPORTS, refusal: DEFINES_SOURCES },
    'server/provider/defineMachineSource': {
        scenario: 'lists the places of a machine source, and describes a start for the machine to run until the person stops it',
        refusal: 'defines a machine source only when its manifest asks for it, names it as proposed and lists it'
    },
    'server/provider/defineNotificationChannel': {
        scenario: 'hands a notification channel what to tell a person, and keeps a channel that throws to its own log',
        refusal: 'defines a notification channel only when its manifest asks for it, names it as proposed and lists it'
    },
    'server/provider/defineReference': {
        scenario: 'offers a reference and a slash command of server/ in a chat, and puts what each answers in the prompt',
        refusal: 'defines a reference and a slash command only when its manifest asks for them, names them as proposed and lists them'
    },
    'server/provider/defineSlashCommand': {
        scenario: 'offers a reference and a slash command of server/ in a chat, and puts what each answers in the prompt',
        refusal: 'defines a reference and a slash command only when its manifest asks for them, names them as proposed and lists them'
    },
    'server/provider/defineUiSource': {
        scenario: 'answers a block with what a UI source reads for its project, and nothing for a throw or an answer that is too large',
        refusal: 'defines a UI source only when its manifest asks for it, names it as proposed and lists it'
    },
    'server/call/log.info': { scenario: SECRET },
    'server/call/machine.run': { scenario: "checks a machine action's input, and throws for one of the wrong shape" },
    'server/call/onEvent': { scenario: HEARS, cleanup: DEAF },
    'server/call/secrets.get': { scenario: SECRET },
    'server/call/secrets.set': { scenario: SECRET },
    'server/call/storage.delete': { scenario: 'reads a key it deleted as one it never wrote' },
    'server/call/storage.get': { scenario: LOADS },
    'server/call/storage.set': { scenario: LOADS },
    'server/call/terminals.open': { scenario: PROFILE, refusal: EACH_TERMINAL },
    'server/call/terminals.read': { scenario: EACH_TERMINAL, refusal: EACH_TERMINAL },
    'server/call/terminals.write': { scenario: PROFILE, refusal: EACH_TERMINAL },
    'server/event/chat.event': { scenario: HEARS, refusal: HEARS },
    'server/provider/defineAgentTool': { scenario: TOOL, refusal: TOOL },
    'server/provider/defineTerminalProfile': { scenario: PROFILE, refusal: DEFINES },
    'server/provider/defineServer': { scenario: 'goes on after its own code prints, also what reads as a message' }
};

function gaps(reason: string, rows: readonly ExtensionApiRow[]): Partial<Record<ExtensionApiRow, string>> {
    return Object.fromEntries(rows.map((row) => [row, reason]));
}

/*
 * The rows no scenario holds yet, each with why. A row leaves this list with the scenario that holds it; none joins it
 * without a reason, and a call the API gains is not here until someone decides it belongs.
 */
export const EXTENSION_API_KNOWN_GAPS: Readonly<Partial<Record<ExtensionApiRow, string>>> = {
    ...gaps('Only its refusal is held: the worlds of the suite answer no file, repository or database of the machine yet.', [
        'client/call/files.list',
        'client/call/files.readText',
        'client/call/files.write',
        'client/call/git.diff',
        'client/call/git.log',
        'client/call/git.status',
        'client/call/database.connections',
        'client/call/database.query'
    ]),
    ...gaps('Only its refusal is held: what a machine action answers is translated per host (`machine-actions.ts`), outside the suite.', [
        'client/call/artifacts.list',
        'client/call/artifacts.publish',
        'client/call/artifacts.read',
        'client/call/browser.back',
        'client/call/browser.forward',
        'client/call/browser.inspect',
        'client/call/browser.navigate',
        'client/call/browser.reload',
        'client/call/browser.screenshot',
        'client/call/devices.inspect',
        'client/call/devices.launch',
        'client/call/devices.list',
        'client/call/devices.screenshot',
        'client/call/devices.tap',
        'client/call/launches.list',
        'client/call/launches.read',
        'client/call/launches.restart',
        'client/call/launches.start',
        'client/call/launches.stop',
        'client/call/routines.list',
        'client/call/routines.pause',
        'client/call/routines.resume',
        'client/call/routines.run'
    ]),
    ...gaps('Only its refusal is held: no scenario makes this call with its permission yet.', [
        'client/call/agents.run',
        'client/call/canvas.arrange',
        'client/call/canvas.createBrowser',
        'client/call/canvas.createFile',
        'client/call/canvas.unlink',
        'client/call/canvas.update',
        'client/call/canvas.writeNote',
        'client/call/chats.list',
        'client/call/chats.send',
        'client/call/views.rename'
    ]),
    ...gaps('Asks a person or leaves the page, and the worlds of the suite have no person and no dialog.', [
        'client/call/host.busy',
        'client/call/host.confirm',
        'client/call/host.copy',
        'client/call/host.notify',
        'client/call/host.openSettings',
        'client/call/host.openUrl',
        'client/call/host.pick',
        'client/call/host.pickFolder',
        'client/call/host.prompt'
    ]),
    ...gaps('Moves the selection, the camera or an editor without an answer, and a world reads back none of the three for it yet.', [
        'client/call/canvas.reveal',
        'client/call/canvas.select',
        'client/call/files.open'
    ]),
    ...gaps('A hook has no Result: without its permission it fails the surface that draws it, which no world of the suite reads yet.', [
        'client/call/Chat',
        'client/hook/useAgent',
        'client/hook/useAgents',
        'client/hook/useSubagents',
        'client/hook/useUsageLimits'
    ]),
    ...gaps('No scenario draws a surface that reads it yet.', [
        'client/hook/useChat',
        'client/hook/useEvent',
        'client/hook/useLocale',
        'client/hook/useMachine',
        'client/hook/useNodes',
        'client/hook/useProject',
        'client/hook/useServerEvent',
        'client/hook/useTheme'
    ]),
    ...gaps('No world of the suite makes this happen yet: only a change of the selection and of the view in front are fired.', [
        'client/event/agent.status',
        'client/event/chat.turnFinished',
        'client/event/node.added',
        'client/event/node.changed',
        'client/event/node.removed',
        'client/event/project.opened'
    ]),
    ...gaps('The client draws it in a place of its own, which a world of the suite does not have yet.', [
        'client/provider/defineCommand',
        'client/provider/defineDiffViewer',
        'client/provider/defineFileIcon',
        'client/provider/defineFileViewer',
        'client/provider/defineMarkdownBlock',
        'client/provider/defineMenu',
        'client/provider/defineOverlay',
        'client/provider/definePaletteSource',
        'client/provider/definePanel',
        'client/provider/defineReference',
        'client/provider/defineSidebarCard',
        'client/provider/defineSlashCommand',
        'client/provider/defineTemplate',
        'client/provider/defineToolResult',
        'client/provider/defineVoiceAction',
        'client/provider/defineWidget'
    ]),
    ...gaps('The suite holds what a slot is told and runs at four places; this place has no scenario of its own yet.', [
        'client/slot/browserMenu',
        'client/slot/browserToolbar',
        'client/slot/canvasMenu',
        'client/slot/commandPalette',
        'client/slot/composer',
        'client/slot/diffToolbar',
        'client/slot/editorMenu',
        'client/slot/editorStatusBar',
        'client/slot/editorToolbar',
        'client/slot/emptyCanvas',
        'client/slot/emptyThread',
        'client/slot/fileBreadcrumb',
        'client/slot/fileMenu',
        'client/slot/fileRowBadge',
        'client/slot/lineMenu',
        'client/slot/messageActions',
        'client/slot/nodeMenu',
        'client/slot/noteToolbar',
        'client/slot/panelHeader',
        'client/slot/projectBanner',
        'client/slot/projectMenu',
        'client/slot/routineMenu',
        'client/slot/sidebarFooter',
        'client/slot/sidebarRow',
        'client/slot/startScreen',
        'client/slot/tabMenu',
        'client/slot/terminalMenu',
        'client/slot/terminalToolbar',
        'client/slot/textMenu',
        'client/slot/threadHeader',
        'client/slot/toolActions',
        'client/slot/viewMenu'
    ]),
    ...gaps('Read by the pack, the store or the loader before any code of the extension runs, and a world of the suite starts after that.', [
        'manifest/contribution/activation',
        'manifest/contribution/api',
        'manifest/contribution/autostart',
        'manifest/contribution/category',
        'manifest/contribution/color',
        'manifest/contribution/description',
        'manifest/contribution/publisher',
        'manifest/contribution/themes',
        'manifest/contribution/version'
    ]),
    ...gaps("The probe's `server/` does not use it yet.", [
        'server/call/chats.read',
        'server/call/log.error',
        'server/call/schedule',
        'server/event/chat.status',
        'server/event/session.status',
        'server/provider/defineLanguageServer',
        'server/provider/defineNodeContext'
    ])
};
