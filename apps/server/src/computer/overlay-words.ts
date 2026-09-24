/*
 * What the helper's cursor, session bar and menu bar item say, in the languages the interface has,
 * written to `overlay.json` (`OverlayConfig.swift` holds the keys and the English it falls back to).
 * `presence` holds the labels the daemon sends itself, since only it knows the app a card is about.
 */
export interface OverlayWords {
    title: string;
    menuTitle: string;
    pause: string;
    resume: string;
    takeOver: string;
    stop: string;
    // While the agent works behind the person's work; `{app}` is the app it works in.
    backgroundTitle: string;
    backgroundMenuTitle: string;
    // `{target}` is the element or app an action is aimed at; the helper drops it when there is none.
    steps: Record<string, string>;
}

export interface PresenceWords {
    permission: (app: string) => string;
    agentError: string;
}

const ENGLISH: OverlayWords = {
    title: 'Ruimte is using your computer',
    menuTitle: 'Ruimte is using this Mac',
    pause: 'Pause',
    resume: 'Resume',
    takeOver: 'Take over',
    stop: 'Stop session',
    backgroundTitle: 'Ruimte is working in {app} in the background',
    backgroundMenuTitle: 'Ruimte is using {app} in the background',
    steps: {
        idle: 'Ready',
        move: 'Moving to {target}',
        hover: 'Pointing at {target}',
        click: 'Clicking {target}',
        drag: 'Dragging {target}',
        type: 'Typing in {target}',
        scroll: 'Scrolling {target}',
        look: 'Looking at {target}',
        think: 'Deciding what to do next',
        waiting: 'Needs you',
        permission: 'Waiting for permission',
        error: 'Something went wrong',
        done: 'Done',
        takeover: 'You have control',
        paused: 'Paused',
        tap: 'Tapping {target}'
    }
};

const DUTCH: OverlayWords = {
    title: 'Ruimte bedient je computer',
    menuTitle: 'Ruimte bedient deze Mac',
    pause: 'Pauzeren',
    resume: 'Hervatten',
    takeOver: 'Overnemen',
    stop: 'Sessie stoppen',
    backgroundTitle: 'Ruimte werkt op de achtergrond in {app}',
    backgroundMenuTitle: 'Ruimte gebruikt {app} op de achtergrond',
    steps: {
        idle: 'Gereed',
        move: 'Gaat naar {target}',
        hover: 'Wijst {target} aan',
        click: 'Klikt op {target}',
        drag: 'Sleept {target}',
        type: 'Typt in {target}',
        scroll: 'Scrollt in {target}',
        look: 'Bekijkt {target}',
        think: 'Bedenkt de volgende stap',
        waiting: 'Wacht op jou',
        permission: 'Wacht op toestemming',
        error: 'Er ging iets mis',
        done: 'Klaar',
        takeover: 'Jij hebt de controle',
        paused: 'Gepauzeerd',
        tap: 'Tikt op {target}'
    }
};

const PRESENCE: Record<string, PresenceWords> = {
    en: { permission: (app) => `Waiting for permission for ${app}`, agentError: 'The agent stopped with an error' },
    nl: { permission: (app) => `Wacht op toestemming voor ${app}`, agentError: 'De agent stopte met een fout' }
};

const OVERLAY: Record<string, OverlayWords> = { en: ENGLISH, nl: DUTCH };

/* The language of a tag such as `nl-NL`, or English for one the interface does not have. */
const languageOf = (language: string | undefined): string => {
    const base = (language ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
    return base in OVERLAY ? base : 'en';
};

export const overlayWords = (language: string | undefined): OverlayWords => OVERLAY[languageOf(language)]!;

export const presenceWords = (language: string | undefined): PresenceWords => PRESENCE[languageOf(language)]!;
