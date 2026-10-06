import type { EditorPosition } from '@adecore/editor';

/* A place in a file of the project, as a caret stood there. */
export interface Place {
    readonly uri: string;
    readonly position: EditorPosition;
}

const LIMIT = 100;

/* Two places on one line of one file are one place: a jump lands wherever, and walking back should not stop twice on the same line. */
function samePlace(left: Place, right: Place): boolean {
    return left.uri === right.uri && left.position.line === right.position.line;
}

/*
 * Where the caret was before each jump, for Back and Forward. A jump records the place it left and
 * forgets what Forward knew; walking back moves the place it left onto Forward, and the other way round.
 * One history serves every editor of a project, so it walks across files.
 */
export class NavigationHistory {
    private backs: Place[] = [];
    private forwards: Place[] = [];

    record(from: Place): void {
        if (this.backs.length > 0 && samePlace(this.backs[this.backs.length - 1]!, from)) {
            this.backs[this.backs.length - 1] = from;
        } else {
            this.backs.push(from);
            if (this.backs.length > LIMIT) {
                this.backs.shift();
            }
        }
        this.forwards = [];
    }

    /* The place before `current`, which Forward then returns to; null when there is none. */
    back(current: Place): Place | null {
        return this.walk(this.backs, this.forwards, current);
    }

    forward(current: Place): Place | null {
        return this.walk(this.forwards, this.backs, current);
    }

    canGoBack(current: Place): boolean {
        return this.backs.some((place) => !samePlace(place, current));
    }

    canGoForward(current: Place): boolean {
        return this.forwards.some((place) => !samePlace(place, current));
    }

    /* Every place in the history but the one the caret is on, the latest first: where Back would go, then where Forward would. */
    recent(current: Place): Place[] {
        return [...this.backs.toReversed(), ...this.forwards.toReversed()].filter((place) => !samePlace(place, current));
    }

    private walk(from: Place[], to: Place[], current: Place): Place | null {
        while (from.length > 0) {
            const place = from.pop()!;
            if (!samePlace(place, current)) {
                to.push(current);
                return place;
            }
        }
        return null;
    }
}
