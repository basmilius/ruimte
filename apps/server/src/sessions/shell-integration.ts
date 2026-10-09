import { mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { writeAtomic } from '@adecore/agents/fs';

export type ShellEnvironment = (shell: string, env: Record<string, string>) => void;

const ZSH_INIT = String.raw`if [[ -n "\${RUIMTE_USER_ZDOTDIR-}" ]]; then
    ZDOTDIR="$RUIMTE_USER_ZDOTDIR"
else
    unset ZDOTDIR
fi
if [[ -r "\${ZDOTDIR:-$HOME}/.zshenv" ]]; then
    source "\${ZDOTDIR:-$HOME}/.zshenv"
fi
# The person's startup options stay in effect outside our bootstrap and hooks.
() {
    emulate -L zsh
    unsetopt errexit nounset errreturn
    typeset -g _ruimte_editor_path="\${RUIMTE_EDITOR_SOCKET-}" _ruimte_editor_secret="\${RUIMTE_EDITOR_SECRET-}" _ruimte_editor_permits="\${RUIMTE_EDITOR_PERMITS-}"
    unset RUIMTE_EDITOR_SOCKET RUIMTE_EDITOR_SECRET RUIMTE_EDITOR_PERMITS RUIMTE_ZLE_INTEGRATION
    # These markers describe output only. The private editor socket remains the sole input authority.
    function _ruimte_output_cwd() {
        local previous_status=$?
        emulate -L zsh
        unsetopt errexit nounset errreturn
        local directory="$PWD" marker=$'\e]7;unknown\a'
        if [[ "$directory" == /* && "$directory" != *[[:cntrl:]]* ]] && (( ZSH_SUBSHELL == 0 )); then
            directory="\${directory//\%/%25}"
            directory="\${directory//\#/%23}"
            directory="\${directory//\?/%3F}"
            directory="\${directory// /%20}"
            directory="\${directory//\\/%5C}"
            marker=$'\e]7;file://localhost'"$directory"$'\a'
        fi
        # Only this subshell write bypasses tostop; emulate -L restores the person's TTOU disposition.
        if (( ZSH_SUBSHELL > 0 )); then
            builtin trap '' TTOU
        fi
        # The PTY preserves ordering across redirected cd; an unavailable terminal must stay quiet.
        { print -rn -- "$marker" >/dev/tty; } 2>/dev/null
        return $previous_status
    }
    typeset -ga chpwd_functions preexec_functions precmd_functions
    chpwd_functions+=(_ruimte_output_cwd)
    preexec_functions+=(_ruimte_output_cwd)
    precmd_functions=(_ruimte_output_cwd "\${precmd_functions[@]}")
    _ruimte_output_cwd
    function _ruimte_editor_close() {
        emulate -L zsh
        unsetopt errexit nounset errreturn
        if [[ -n "\${_ruimte_editor_fd-}" ]]; then
            zle -F "$_ruimte_editor_fd" 2>/dev/null
            exec {_ruimte_editor_fd}>&-
            unset _ruimte_editor_fd
        fi
        return 0
    }
    function _ruimte_editor_open() {
        emulate -L zsh
        unsetopt errexit nounset errreturn
        _ruimte_editor_close
        [[ "\${CONTEXT-}" == start ]] || return 0
        zsocket "$_ruimte_editor_path" 2>/dev/null || return 0
        typeset -g _ruimte_editor_fd=$REPLY
        print -r -u "$_ruimte_editor_fd" -- $'hello\t'"$_ruimte_editor_secret"$'\t'"$$"$'\t2' || { _ruimte_editor_close; return 0; }
        zle -F -w "$_ruimte_editor_fd" _ruimte_editor_read || _ruimte_editor_close
        return 0
    }
    function _ruimte_editor_read() {
        emulate -L zsh
        unsetopt errexit nounset errreturn
        local request kind deadline expected command
        if [[ -n "\${2-}" ]] || ! IFS=$'\t' read -r -u "$1" request kind deadline expected command; then
            _ruimte_editor_close
            return 0
        fi
        # KEYS contains an unfinished key sequence inside the decoder, beyond PENDING.
        local idle=0
        if [[ -z "$BUFFER" && -z "\${KEYS-unavailable}" ]] && (( \${PENDING:-1} == 0 && \${KEYS_QUEUED_COUNT:-1} == 0 )); then
            idle=1
        fi
        if ! zle || [[ "\${CONTEXT-}" != start ]] || [[ "$deadline" != <-> ]] || (( EPOCHREALTIME * 1000 > deadline )) || [[ "$PWD" == *[[:cntrl:]]* ]]; then
            print -r -u "$1" -- "$request"$'\trefused'
        elif [[ "$kind" == inspect ]]; then
            local state=occupied
            (( idle )) && state=empty
            print -r -u "$1" -- "$request"$'\tstate\t'"$PWD"$'\t'"$state"
        elif [[ "$kind" == prepare && "$request" != *[^a-zA-Z0-9-]* && -n "$request" && "$PWD" == "$expected" && -n "$command" && "$command" != *[[:cntrl:]]* ]] && (( idle )); then
            # Rename and cancellation's unlink arbitrate insertion before later tty input can arrive.
            if zf_mv -- "$_ruimte_editor_permits/$request.permit" "$_ruimte_editor_permits/$request.claimed" 2>/dev/null; then
                BUFFER="$command"
                CURSOR=$#BUFFER
                print -r -u "$1" -- "$request"$'\tprepared'
                zle -R
            else
                print -r -u "$1" -- "$request"$'\trefused'
            fi
        else
            print -r -u "$1" -- "$request"$'\trefused'
        fi
        return 0
    }
    function _ruimte_editor_install() {
        emulate -L zsh
        unsetopt errexit nounset errreturn
        precmd_functions=("\${(@)precmd_functions:#_ruimte_editor_install}")
        zmodload zsh/net/socket && zmodload zsh/datetime && zmodload -F zsh/files b:zf_mv || return 0
        autoload -Uz add-zle-hook-widget
        zle -N _ruimte_editor_read || return 0
        add-zle-hook-widget line-init _ruimte_editor_open || return 0
        add-zle-hook-widget line-finish _ruimte_editor_close || return 0
        return 0
    }
    typeset -ga precmd_functions
    precmd_functions+=(_ruimte_editor_install)
    return 0
}
`.replaceAll('\\${', '${');

/* The shim leaves startup files and prompts intact. Other shells have no verified editor channel. */
export async function prepareShellIntegration(home: string): Promise<ShellEnvironment> {
    const zshDirectory = join(home, 'shell-integration', 'zsh');
    await mkdir(zshDirectory, { recursive: true, mode: 0o700 });
    await writeAtomic(join(zshDirectory, '.zshenv'), ZSH_INIT, 0o600);
    return (shell, env) => {
        if (basename(shell) === 'zsh') {
            env.RUIMTE_USER_ZDOTDIR = env.ZDOTDIR ?? '';
            env.ZDOTDIR = zshDirectory;
            env.RUIMTE_ZLE_INTEGRATION = '1';
        }
    };
}
