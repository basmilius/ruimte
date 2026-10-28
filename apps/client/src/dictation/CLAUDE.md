# Speech to Text

Local dictation on Nemotron streaming (`controller.ts`, `helper.ts`, `editor.ts`). The shell owns downloads, enablement and the helper's sixty-second idle timeout (`packages/desktop-bridge/src/speech.ts`).

- One microphone listener at a time, shared with Voice Control (`audio/ownership.ts`).
- A run owns one target and session ID; cancelling, unmounting, a replaced draft or stale IPC never inserts elsewhere.
- Live transcripts are previews. Only the final one is inserted, once, after stopping; Escape discards. Stop drains the last worklet block first.
- A terminal paste is sanitized text through xterm, never Enter, control characters or partial transcripts.
- The microphone closes on stop, cancellation and every failure.
- No word substitutions or spoken commands; recognition errors stay for the person to edit.
- A failure reaches a person only through `failure.ts`, as a `voice:dictation.errors` key, never a raw code or Chromium message.

## Product rules

Decisions the code cannot show. Do not reverse one without asking Bas.

- Speech to Text is optional and off by default. Enabling downloads one verified local streaming model and never opens the microphone. Audio is never uploaded or saved.
- Voice Control is the separate cloud feature. Both share the microphone and language settings and never record together.
- Dictation previews text and inserts only after stopping. A terminal gets an editable draft; only an explicit paste writes sanitized text, without Enter. Agents cannot start dictation.
