import { z } from 'zod';
import { USAGE_DAY_DESCRIPTION, USAGE_MAX_COUNT, USAGE_MAX_DAYS_PER_BATCH, usageCohortProblem } from './usage.ts';
import { USAGE_REPORT_MAX_COUNTERS } from './usage-report.ts';

/*
 * The usage report the desktop app sends Observatory's Desktop app: the same description of a day as a
 * daemon's report, with counters of what only the app sees (commands, panels, its windows). Every name is
 * fixed here, so the page hands over a name and the shell drops one this list does not hold.
 */

/*
 * Every row of the client's command table (`apps/client/src/shell/command-table.ts`) in camelCase, then one
 * name per kind of generated row (a row per view, launch, agent or layout), never the row's own id.
 * `apps/client/src/desktop/usage.test.ts` holds the table against this list.
 */
export const USAGE_DESKTOP_COMMANDS = [
    'about',
    'settings',
    'keepAwakeOff',
    'keepAwakeWorking',
    'keepAwakeAlways',
    'windowNew',
    'chatNew',
    'chatNewWorktree',
    'issueStart',
    'viewNew',
    'viewNewDrawing',
    'viewNewDiagram',
    'viewNewTerminal',
    'viewNewFile',
    'viewNewBrowser',
    'viewNewSeparator',
    'viewNewSubheader',
    'openFolder',
    'fileNew',
    'folderNew',
    'databaseConsoleNew',
    'reveal',
    'projectSettings',
    'databaseConnections',
    'databaseSchemasRefresh',
    'windowMove',
    'tabClose',
    'closeCell',
    'cellCloseOthers',
    'cellCloseRight',
    'editUndo',
    'editRedo',
    'find',
    'findReplace',
    'findNext',
    'findPrevious',
    'openFileAtLine',
    'nextProblem',
    'previousProblem',
    'nextHighlight',
    'previousHighlight',
    'settingsSearch',
    'findInFiles',
    'searchChats',
    'prShow',
    'prWatchStop',
    'sidebar',
    'panelFiles',
    'panelOutput',
    'panelDatabases',
    'panelGit',
    'panelDevices',
    'routines',
    'routineNew',
    'panelToggle',
    'splitRight',
    'splitDown',
    'tabMoveLeft',
    'tabMoveRight',
    'projectTabMoveLeft',
    'projectTabMoveRight',
    'tabSplitOff',
    'tabUngroup',
    'cellMaximize',
    'nodeMaximize',
    'noteLockPreview',
    'fit',
    'zoomSelection',
    'zoomNode',
    'zoomReset',
    'theme',
    'fullscreen',
    'palette',
    'viewPrevious',
    'viewNext',
    'cameraBack',
    'cameraForward',
    'tabPrevious',
    'tabNext',
    'focusLeft',
    'focusRight',
    'focusUp',
    'focusDown',
    'nodeLeft',
    'nodeRight',
    'nodeUp',
    'nodeDown',
    'prompts',
    'needsYouNext',
    'attentionQueue',
    'launchRun',
    'launchStop',
    'launchesStopAll',
    'launchesOutput',
    'launchesEdit',
    'launchesAfterSettleOff',
    'panelProcesses',
    'panelProblems',
    'usage',
    'models',
    'measureScene',
    'measureSceneGrid',
    'measureSceneFiles',
    'measureSceneChats',
    'measureSceneTerminals',
    'measureCopy',
    'settingsEditor',
    'settingsMachines',
    'settingsComputer',
    'onboarding',
    'releaseNotes',
    'settingsKeyboard',
    'addTerminal',
    'addChat',
    'addBrowser',
    'addNote',
    'addText',
    'addFile',
    'addGroup',
    'groupSelection',
    'groupArrange',
    'viewPromote',
    'lock',
    'layoutSave',
    'terminalClear',
    'drawingCopyPng',
    'drawingCopySvg',
    'drawingSavePng',
    'drawingSaveSvg',
    'drawingShowOnCanvas',
    'diagramCopyJson',
    'diagramCopyPng',
    'diagramCopySvg',
    'diagramSavePng',
    'diagramSaveSvg',
    'diagramOpenJson',
    'diagramShowOnCanvas',
    'chatSendNew',
    'chatRestart',
    'chatEffortUp',
    'chatEffortDown',
    'chatMessagePrevious',
    'chatMessageNext',
    'viewFork',
    'viewOpenInChat',
    'viewOpenInTerminal',
    'viewDuplicate',
    'chatMakeProject',
    'chatMoveToProject',
    'viewPutOnCanvas',
    'viewDemote',
    'viewReveal',
    'viewShare',
    'flagToggle',
    'viewSettings',
    'viewDelete',
    'triggerCompletion',
    'parameterInfo',
    'quickInfo',
    'codeActions',
    'refactorThis',
    'renameSymbol',
    'organizeImports',
    'formatDocument',
    'nextAgentChange',
    'previousAgentChange',
    'selectionToChat',
    'inlineEdit',
    'showInlineEdit',
    'explain',
    'suggestInline',
    'goToSymbol',
    'goToDefinition',
    'goToDeclaration',
    'goToTypeDefinition',
    'peekDefinition',
    'peekReferences',
    'callHierarchy',
    'goToImplementation',
    'historyBack',
    'historyForward',
    'recentLocations',
    'toggleLineComment',
    'toggleBlockComment',
    'joinLines',
    'splitLine',
    'startNewLine',
    'startNewLineBefore',
    'toggleCase',
    'autoIndentLines',
    'collapseRegion',
    'expandRegion',
    'collapseRegionRecursively',
    'expandRegionRecursively',
    'collapseAllRegions',
    'expandAllRegions',
    'foldSelection',
    'collapseDocComments',
    'expandDocComments',
    'expandAllToLevel1',
    'expandAllToLevel2',
    'expandAllToLevel3',
    'expandAllToLevel4',
    'expandAllToLevel5',
    'selectNextOccurrence',
    'unselectOccurrence',
    'selectAllOccurrences',
    'addCaretAbove',
    'addCaretBelow',
    'toggleColumnMode',
    'addCaretPerSelectedLine',
    'sortLines',
    'reverseLines',
    'uniqueLines',
    'convertIndentsToSpaces',
    'convertIndentsToTabs',
    'increaseFontSize',
    'decreaseFontSize',
    'resetFontSize',
    'typeHierarchy',
    'lastEditLocation',
    'nextEditLocation',
    'pasteFromHistory',
    'wrapWithAbbreviation',
    'insertLiveTemplate',
    'surroundWith',
    'surroundWithLiveTemplate',
    'unwrap',
    'saveAsLiveTemplate',
    'completeCurrentStatement',
    'moveStatementUp',
    'moveStatementDown',
    'pasteAsPlainText',
    'hippieCompletion',
    'hippieBackwardCompletion',
    'nextChange',
    'previousChange',
    'methodUp',
    'methodDown',
    'codeBlockStart',
    'codeBlockEnd',
    'codeBlockStartWithSelection',
    'codeBlockEndWithSelection'
] as const;

export const USAGE_DESKTOP_GENERATED_COMMANDS = [
    'agentChat',
    'agentTerminal',
    'agentViewChat',
    'agentViewTerminal',
    'viewMove',
    'goView',
    'chatMoveProject',
    'launchStart',
    'launchRestart',
    'launchStopListed',
    'launchChoose',
    'launchAfterSettle',
    'layoutApply',
    'layoutDelete',
    'prShowIn'
] as const;

export type UsageDesktopCommand = (typeof USAGE_DESKTOP_COMMANDS)[number] | (typeof USAGE_DESKTOP_GENERATED_COMMANDS)[number];

// A command that came through the menu's accelerator because the page never saw the key counts as the menu's.
export const USAGE_COMMAND_SOURCES = ['menu', 'shortcut', 'palette'] as const;
export type UsageCommandSource = (typeof USAGE_COMMAND_SOURCES)[number];

// The client's `PanelKind`s; `apps/client/src/desktop/usage.test.ts` holds `PANELS` against them.
export const USAGE_DESKTOP_PANELS = ['files', 'git', 'databases', 'devices', 'output', 'processes', 'launches', 'problems', 'voice'] as const;
export type UsageDesktopPanel = (typeof USAGE_DESKTOP_PANELS)[number];

// The client's `SettingsSectionId`s, and `computer` and `storage`, which an older client still counts: they are under Agents and a machine's detail now.
export const USAGE_DESKTOP_SETTINGS_SECTIONS = [
    'appearance',
    'keyboard',
    'editor',
    'terminal',
    'views',
    'files',
    'storage',
    'providers',
    'voice',
    'computer',
    'agents',
    'usage',
    'machines',
    'about'
] as const;
export type UsageDesktopSettingsSection = (typeof USAGE_DESKTOP_SETTINGS_SECTIONS)[number];

export const USAGE_MACHINE_MODES = ['local', 'none'] as const;

const prefixed = <Prefix extends string, Value extends string>(prefix: Prefix, values: readonly Value[]): `${Prefix}.${Value}`[] =>
    values.map((value) => `${prefix}.${value}` as const);

const COMMANDS: readonly UsageDesktopCommand[] = [...USAGE_DESKTOP_COMMANDS, ...USAGE_DESKTOP_GENERATED_COMMANDS];

export const USAGE_DESKTOP_COUNTERS = [
    'windows.opened',
    'updates.installed',
    'dialogs.settings',
    // A start by the machine mode it ran in.
    ...prefixed('starts', USAGE_MACHINE_MODES),
    ...prefixed('panels', USAGE_DESKTOP_PANELS),
    ...prefixed('settingsSections', USAGE_DESKTOP_SETTINGS_SECTIONS),
    ...USAGE_COMMAND_SOURCES.flatMap((source) => prefixed(`commands.${source}`, COMMANDS))
] as const;
export type UsageDesktopCounter = (typeof USAGE_DESKTOP_COUNTERS)[number];

const DESKTOP_COUNTERS: ReadonlySet<string> = new Set(USAGE_DESKTOP_COUNTERS);

/* Whether a name the page handed over is one of the list; anything else is never counted. */
export function isUsageDesktopCounter(name: unknown): name is UsageDesktopCounter {
    return typeof name === 'string' && DESKTOP_COUNTERS.has(name);
}

const CountSchema = z.number().int().min(1).max(USAGE_MAX_COUNT);

export const UsageDesktopDaySchema = z
    .strictObject({
        ...USAGE_DAY_DESCRIPTION,
        // Zeros are left out.
        counts: z.partialRecord(z.enum(USAGE_DESKTOP_COUNTERS), CountSchema)
    })
    .refine((day) => !usageCohortProblem(day), { message: 'The cohort week is after the day', path: ['cohortWeek'] })
    .refine((day) => Object.keys(day.counts).length <= USAGE_REPORT_MAX_COUNTERS, { message: 'Too many counters in a day', path: ['counts'] });
export type UsageDesktopDay = z.infer<typeof UsageDesktopDaySchema>;

export const UsageDesktopBatchSchema = z
    .strictObject({ days: z.array(UsageDesktopDaySchema).min(1).max(USAGE_MAX_DAYS_PER_BATCH) })
    .refine((batch) => new Set(batch.days.map((day) => day.date)).size === batch.days.length, { message: 'A day appears twice', path: ['days'] });
export type UsageDesktopBatch = z.infer<typeof UsageDesktopBatchSchema>;
