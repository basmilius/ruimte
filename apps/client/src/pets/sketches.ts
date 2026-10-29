import { cloud, snore, type Cell, type DrawnSprite, type Parts, type PetPose } from '@/pets/pixel';

/*
 * The figures of the pet catalog past the four first ones: each drawn from its shape, in a palette of
 * its own, and moved by the rig of that shape. The buddies of Claude and Codex, the fox and the frog
 * keep their own code (`buddies.ts`, `animals.ts`), so they move as they always did.
 */

/* Pixel art is drawn into a 2D canvas that no theme reaches, so these are colors as such, not tokens. */
export interface PetPalette {
    outline: string;
    body: string;
    shade: string;
    light: string;
    ink: string;
    accent: string;
}

export interface PetDesign {
    id: string;
    shape: string;
    palette: PetPalette;
}

type Pose = PetPose;

function sketchPartsOf(pet: PetDesign, pose: Pose, frame: number): Parts {
    const colors = pet.palette;
    const silhouette: Cell[] = [];
    const details: Cell[] = [];
    const props: Cell[] = [];
    const sleeping = pose === 'sleep';
    const step = pose === 'walk' ? frame % 2 : 0;
    const base = sleeping ? 2 : 0;

    const add = (target: Cell[], x: number, y: number, w: number, h: number, color: string): void => {
        target.push({ x, y, w, h, color });
    };
    const body = (x: number, y: number, w: number, h: number, color = colors.body): void => add(silhouette, x, y, w, h, color);
    const detail = (x: number, y: number, w = 1, h = 1, color = colors.shade): void => add(details, x, y, w, h, color);
    const eye = (x: number, y: number, color = colors.ink): void => {
        detail(x, y, sleeping ? 2 : 1, 1, color);
    };
    const feet = (left = 6, right = 14): void => {
        body(left, 14, 3, 3 - step);
        body(right, 14, 3, 2 + step);
        detail(left, 16 - step, 3, 1);
        detail(right, 15 + step, 3, 1);
    };
    const face = (x = 10, y = 7): void => {
        eye(x, y);
        eye(x + 5, y);
        detail(x + 2, y + 3, 2, 1, colors.shade);
    };
    const roundBody = (): void => {
        body(6, 8 + base, 11, 8 - base);
        body(8, 6 + base, 7, 2);
        detail(7, 10 + base, 2, 3, colors.light);
        feet();
    };
    const quad = (ear = true): void => {
        body(5, 10 + base, 10, 5 - base);
        body(13, 6 + base, 6, 6);
        body(18, 9 + base, 2, 2, colors.light);

        if (ear) {
            body(13, 4 + base, 2, 3);
            body(17, 4 + base, 2, 3);
        }

        eye(17, 8 + base);
        detail(19, 9 + base, 1, 1, colors.ink);
        feet();
    };

    switch (pet.shape) {
        case 'rabbit': {
            const nox = pet.id === 'nox';
            const head = nox ? colors.body : '#856044';
            const muzzle = nox ? '#fff7e4' : '#c49c67';
            const ear = nox ? '#e8e1cf' : '#644936';
            const rearY = sleeping ? 11 - (frame % 2) : 8;
            body(5, rearY, 8, 8 - (rearY - 8));
            body(3, rearY + 2, 12, 5);
            body(2, 12, 2, 2, colors.light);
            body(12, 11, 5, 5);
            body(6, 15, 6, 2, colors.light);
            body(15, 15, 5, 2 - step);
            detail(6, rearY + 1, 5, 1, colors.light);
            detail(4, rearY + 3, 1, 3, colors.shade);
            detail(10, 13, 2, 2, colors.shade);

            if (sleeping) {
                body(15, 11, 4, 1, head);
                body(13, 12, 8, 3, head);
                body(14, 15, 6, 1, head);
                body(19, 13, 3, 2, muzzle);
                body(21, 14, 1, 1, muzzle);
                body(12, 12, 2, 3, ear);
                body(13, 15, 2, 1, ear);
                detail(13, 13, 1, 2, nox ? '#d9c9b1' : '#8d6848');
                detail(18, 13, 2, 1, nox ? '#655950' : '#33251f');
                detail(21, 14, 1, 1, nox ? '#b19788' : '#51382a');
                detail(20, 15, 1, 1, nox ? '#d3c2ab' : '#9c744c');
            } else {
                body(14, 5, 4, 1, head);
                body(13, 6, 7, 2, head);
                body(13, 8, 8, 4, head);
                body(14, 12, 6, 1, head);
                body(15, 13, 4, 1, head);
                body(20, 9, 2, 2, muzzle);
                body(18, 10, 3, 2, muzzle);
                body(19, 12, 1, 1, muzzle);
                body(11, 7, 3, 5, ear);
                body(12, 12, 3, 2, ear);
                detail(12, 8, 1, 4, nox ? '#d6c6ad' : '#96704d');
                detail(13, 12, 1, 1, nox ? '#f2e6ce' : '#ab8157');
                detail(15, 6, 3, 1, nox ? colors.light : '#b38a58');
                detail(16, 7, 2, 2, nox ? '#eee9dc' : '#6a4a34');
                detail(18, 8, 1, 1, nox ? '#655950' : '#2f241e');
                detail(21, 10, 1, 1, nox ? '#b19788' : '#51382a');
                detail(20, 11, 1, 1, nox ? '#d3c2ab' : '#9c744c');
            }

            if (!nox) {
                detail(6, rearY + 2, 2, 1, '#c89c62');
                detail(9, rearY + 4, 2, 2, '#76513b');
                detail(4, rearY + 5, 2, 1, '#c3955e');
            }

            break;
        }
        case 'fluffy-cat':
        case 'tabby-cat': {
            const fluffy = pet.shape === 'fluffy-cat';

            if (sleeping) {
                body(4, 11, 13, 5);
                body(6, 9, 8, 3);
                body(15, 11, 6, 5);
                body(15, 9, 2, 3);
                body(19, 10, 1, 2);
                body(20, 13, 2, 2, colors.light);
                body(3, 13, 7, 3, fluffy ? colors.light : colors.shade);
                detail(7, 13, 4, 1, colors.shade);
                detail(18, 13, 2, 1, colors.ink);
                detail(21, 14, 1, 1, '#a77e78');

                if (fluffy) {
                    body(3, 11, 2, 3);
                    body(13, 12, 3, 4, colors.light);
                    detail(6, 10, 3, 1, colors.light);
                    detail(4, 14, 4, 1, '#eee4d0');
                } else {
                    detail(6, 10, 1, 2, colors.shade);
                    detail(9, 10, 1, 2, colors.shade);
                    detail(5, 14, 1, 2, colors.body);
                    detail(8, 14, 1, 2, colors.body);
                    detail(16, 11, 2, 1, colors.shade);
                }

                break;
            }

            body(5, 9, 10, 6);
            body(4, 11, 6, 4);
            body(12, 9, 6, 6);
            body(14, 4, 6, 6);
            body(13, 7, 7, 4);
            body(14, 2, 2, 3);
            body(19, 2, 2, 3);
            body(19, 8, 3, 2, colors.light);
            body(6, 14, 3, 3);
            body(15, 14, 3, 3);
            detail(15, 3, 1, 1, '#d0b4ad');
            detail(19, 3, 1, 1, '#d0b4ad');
            detail(18, 6, 2, 2, colors.accent);
            detail(18, 7, 1, 1, colors.ink);
            detail(21, 8, 1, 1, '#a77e78');
            detail(20, 10, 1, 1, colors.shade);
            detail(7, 16, 2, 1, colors.light);
            detail(15, 16, 3, 1, colors.light);

            if (fluffy) {
                body(2, 7, 3, 7);
                body(1, 6, 3, 4);
                body(2, 4, 3, 3);
                body(12, 7, 2, 6, colors.light);
                body(11, 10, 2, 3, colors.light);
                body(13, 12, 5, 3, colors.light);
                body(12, 14, 2, 2, colors.light);
                body(19, 9, 2, 4, colors.light);
                body(18, 12, 3, 2, colors.light);
                body(17, 14, 3, 1, colors.light);
                body(10, 15, 4, 1);
                body(5, 8, 4, 2);
                body(14, 1, 1, 2);
                body(20, 1, 1, 2);
                detail(18, 11, 1, 1, '#eee4cf');
                detail(19, 11, 1, 2, '#eee4cf');
                detail(2, 7, 1, 4, colors.light);
                detail(5, 10, 2, 1, colors.shade);
                detail(8, 9, 3, 1, colors.shade);
                detail(14, 5, 2, 1, colors.shade);
                detail(16, 5, 1, 1, '#c5b8a2');
                detail(14, 11, 3, 3, '#fff8e8');
            } else {
                body(2, 6, 2, 7);
                body(3, 12, 3, 2);
                detail(2, 7, 2, 1, colors.shade);
                detail(2, 10, 2, 1, colors.shade);
                detail(4, 12, 1, 2, colors.shade);
                detail(6, 10, 1, 3, colors.shade);
                detail(9, 9, 1, 3, colors.shade);
                detail(12, 10, 1, 2, colors.shade);
                detail(15, 5, 1, 2, colors.shade);
                detail(17, 4, 1, 2, colors.shade);
                detail(15, 9, 2, 1, colors.shade);
                detail(16, 11, 2, 2, colors.light);
            }

            break;
        }
        case 'ufo':
            body(8, 5 + base, 9, 5, colors.light);
            body(6, 8 + base, 13, 5);
            body(3, 10 + base, 19, 2);
            detail(8, 12 + base, 9, 1);
            detail(8, 6 + base, 3, 1, '#e6f6f9');
            eye(11, 8 + base);
            eye(15, 8 + base);
            body(6, 14, 2, 3 - step, colors.shade);
            body(17, 14, 2, 2 + step, colors.shade);
            detail(5, 11 + base, 2, 1, colors.accent);
            detail(18, 11 + base, 2, 1, colors.accent);
            break;
        case 'visor':
        case 'robot':
        case 'nanobot':
        case 'relay':
        case 'cyclops':
        case 'seedbot':
            body(6, 4 + base, 12, 10 - base);
            body(4, 8, 2, 3);
            body(18, 8, 2, 3);
            detail(7, 4 + base, 10, 1, colors.light);
            detail(16, 5 + base, 2, 8 - base);
            feet();

            if (pet.shape === 'cyclops') {
                body(8, 2 + base, 3, 2, colors.light);
                body(11, 3 + base, 3, 1, colors.light);
                detail(9, 7 + base, 6, 4, colors.outline);
                detail(11, 8 + base, 2, 2, colors.ink);
            } else if (pet.shape === 'visor') {
                detail(7, 7 + base, 10, 4, colors.outline);
                detail(8, 8 + base, 3, 2, colors.light);
                detail(13, 8 + base, 3, 2, colors.light);
                body(5, 2 + base, 1, 3);
                body(18, 2 + base, 1, 3);
            } else if (pet.shape === 'seedbot') {
                body(12, 1 + base, 2, 3, '#6a8c55');
                body(14, 1 + base, 3, 2, '#a8bb7b');
                face(8, 8 + base);
            } else {
                detail(8, 7 + base, 8, 4, colors.outline);
                eye(9, 8 + base, colors.accent);
                eye(14, 8 + base, colors.accent);

                if (pet.shape === 'robot') {
                    body(11, 1 + base, 2, 2, colors.accent);
                } else if (pet.shape === 'nanobot') {
                    body(11, 1 + base, 1, 3, colors.light);
                    body(10, 1 + base, 3, 1, colors.accent);
                    detail(4, 9, 1, 1, colors.accent);
                    detail(19, 9, 1, 1, colors.accent);
                } else {
                    detail(17, 10, 4, 3, colors.outline);
                    detail(18, 11, 2, 1, colors.accent);
                }
            }

            break;
        case 'bee':
        case 'firefly':
            body(6, 5 + base, 4, 4, '#d8edf0');
            body(11, 4 + base, 4, 4, '#d8edf0');
            body(5, 9 + base, 12, 5);
            body(14, 7 + base, 5, 6);
            detail(8, 9 + base, 2, 5, colors.outline);
            detail(12, 9 + base, 2, 5, colors.outline);
            eye(17, 9 + base);
            body(17, 5 + base, 1, 2);
            feet(7, 14);

            if (pet.shape === 'firefly') {
                detail(5, 10 + base, 4, 3, '#e2e997');
                detail(6, 10 + base, 2, 1, '#fbf5bf');
            }

            break;
        case 'penguin':
        case 'owl':
        case 'hamster':
        case 'astronaut':
            roundBody();
            body(7, 4 + base, 9, 6);
            body(4, 10, 2, 4);
            body(17, 10, 2, 4);
            detail(8, 9 + base, 7, 5 - base, colors.light);

            if (pet.shape === 'penguin') {
                detail(8, 5 + base, 7, 4, '#d7e6ee');
                detail(8, 6 + base, 3, 2, '#506c94');
                detail(12, 6 + base, 3, 2, '#506c94');
                detail(11, 9 + base, 2, 1, '#d4ab63');
            } else if (pet.shape === 'owl') {
                body(6, 2 + base, 2, 3);
                body(15, 2 + base, 2, 3);
                detail(7, 5 + base, 4, 4, colors.light);
                detail(12, 5 + base, 4, 4, colors.light);
                eye(9, 7 + base);
                eye(13, 7 + base);
                detail(11, 9 + base, 1, 2, colors.shade);
                detail(9, 12, 1, 1);
                detail(13, 13, 1, 1);
            } else if (pet.shape === 'hamster') {
                body(6, 3 + base, 3, 3, colors.accent);
                body(14, 3 + base, 3, 3, colors.accent);
                detail(6, 9 + base, 3, 2, '#eccda7');
                detail(15, 9 + base, 3, 2, '#eccda7');
                face(9, 7 + base);
            } else {
                body(4, 7 + base, 2, 7 - base, '#7097be');
                detail(8, 5 + base, 7, 4, '#314c64');
                detail(9, 5 + base, 3, 1, '#a2ccd7');
                detail(10, 11, 4, 2, '#7599c4');
            }

            break;
        case 'cat':
        case 'fox':
        case 'raccoon':
        case 'redpanda':
        case 'dog':
        case 'deer':
        case 'llama':
        case 'beaver':
            quad(pet.shape !== 'llama');

            if (pet.shape === 'cat') {
                body(2, 6 + base, 2, 8);
                body(3, 12, 3, 2);
                detail(13, 10, 2, 1, colors.light);
                detail(14, 5 + base, 1, 2, colors.accent);

                if (pet.id === 'soot') {
                    detail(14, 15, 3, 1, '#d2c9b0');
                    eye(17, 8 + base, '#f0d38a');
                }
            } else if (pet.shape === 'dog') {
                body(2, 8 + base, 2, 5);
                body(13, 6 + base, 2, 6, '#9b7657');
                detail(17, 11, 2, 1, '#9b7657');
            } else if (pet.shape === 'deer') {
                body(12, 3 + base, 2, 2);
                body(18, 3 + base, 3, 2);
                detail(6, 11, 1, 1, colors.light);
                detail(9, 12, 1, 1, colors.light);
                detail(11, 10, 1, 1, colors.light);
            } else if (pet.shape === 'llama') {
                body(13, 5 + base, 4, 8);
                body(13, 2 + base, 7, 4);
                body(14, 1 + base, 1, 2);
                body(18, 1 + base, 1, 2);
                eye(18, 4 + base);
                detail(6, 10, 1, 1, colors.shade);
                detail(9, 12, 1, 1, colors.shade);
            } else if (pet.shape === 'beaver') {
                body(1, 12, 5, 3, colors.shade);
                detail(2, 13, 3, 1, colors.outline);
                detail(18, 11, 1, 2, '#f3e6c7');
                detail(20, 11, 1, 2, '#f3e6c7');
            } else {
                body(1, 9 + base, 3, 5);
                body(3, 12, 4, 2);
                detail(1, 9 + base, 2, 2, colors.light);

                if (pet.shape === 'raccoon' || pet.shape === 'redpanda') {
                    detail(14, 8 + base, 5, 2, colors.outline);
                    eye(17, 8 + base, colors.light);
                    detail(2, 12, 2, 1, colors.outline);
                    detail(4, 13, 2, 1, colors.outline);
                    detail(14, 10 + base, 2, 1, colors.light);
                } else {
                    detail(14, 10 + base, 4, 2, colors.light);
                    detail(13, 12, 5, 1, colors.accent);
                }
            }

            break;
        case 'squirrel':
            body(2, 5 + base, 5, 9);
            body(3, 3 + base, 5, 4);
            body(5, 5 + base, 3, 5);
            detail(4, 5 + base, 1, 6, colors.light);
            body(8, 10, 7, 6);
            body(12, 5 + base, 6, 6);
            body(13, 3 + base, 2, 2);
            body(17, 3 + base, 1, 3);
            eye(16, 7 + base);
            body(17, 9 + base, 3, 2, colors.light);
            feet(8, 14);
            break;
        case 'hedgehog':
            body(3, 8 + base, 12, 7 - base, colors.shade);
            body(5, 6 + base, 8, 2, colors.shade);
            body(3, 6 + base, 2, 3, colors.outline);
            body(7, 4 + base, 2, 3, colors.outline);
            body(12, 5 + base, 2, 3, colors.outline);
            body(14, 10 + base, 5, 5 - base, colors.light);
            body(18, 12 + base, 3, 2, colors.light);
            eye(17, 11 + base);
            detail(20, 12 + base, 1, 1, colors.ink);
            detail(6, 9 + base, 1, 2, colors.light);
            detail(10, 8 + base, 1, 2, colors.body);
            feet();
            break;
        case 'hummingbird':
        case 'raven':
        case 'parakeet':
        case 'windbird':
            body(7, 9 + base, 9, 6 - base);
            body(12, 5 + base, 6, 6);
            body(4, 12 + base, 4, 2);
            body(2, 14, 4, 2);
            body(17, 7 + base, pet.shape === 'hummingbird' ? 6 : 3, 1, colors.accent);
            body(7, 8 + base - step, 5, 3, colors.shade);
            eye(16, 6 + base);
            body(10, 15, 1, 2, colors.shade);
            body(14, 15, 1, 2, colors.shade);

            if (pet.shape === 'parakeet') {
                body(5, 13, 2, 4, '#5a83ab');
                detail(13, 9 + base, 3, 2, colors.light);
                detail(16, 8 + base, 1, 1, '#4b6ca7');
            } else if (pet.shape === 'raven') {
                detail(8, 10 + base, 1, 3, colors.light);
                body(17, 8 + base, 3, 1, colors.shade);
            } else if (pet.shape === 'windbird') {
                body(3, 6 + base, 4, 2, '#e6b66c');
                body(1, 9 + base, 6, 2, '#ecc886');
                body(3, 12, 4, 2, '#e6b66c');
            }

            break;
        case 'octopus':
            body(7, 5 + base, 11, 8 - base);
            body(9, 3 + base, 7, 3);
            body(5, 12, 3, 4 - step);
            body(9, 12, 2, 5);
            body(14, 12, 2, 5 - step);
            body(18, 11, 2, 5);
            detail(8, 5 + base, 2, 3, colors.light);
            face(10, 8 + base);
            break;
        case 'axolotl':
            body(7, 6 + base, 11, 7);
            body(8, 12, 9, 3);
            body(4, 6 + base, 2, 6, colors.shade);
            body(19, 6 + base, 2, 6, colors.shade);
            body(2, 5 + base, 3, 1, colors.accent);
            body(2, 8 + base, 3, 1, colors.accent);
            body(2, 11 + base, 3, 1, colors.accent);
            body(21, 5 + base, 2, 1, colors.accent);
            body(21, 8 + base, 2, 1, colors.accent);
            body(21, 11 + base, 2, 1, colors.accent);
            face(9, 8 + base);
            feet(8, 15);
            break;
        case 'turtle':
            body(4, 9 + base, 12, 6 - base);
            body(6, 7 + base, 8, 3);
            body(17, 10 + base, 5, 4, colors.light);
            detail(7, 9 + base, 3, 2);
            detail(11, 11 + base, 3, 2);
            detail(4, 14, 12, 1);
            eye(20, 11 + base);
            feet(6, 16);
            break;
        case 'ray':
            body(9, 7 + base, 7, 7 - base);
            body(6, 9 + base, 13, 4);
            body(3, 10 + base, 3, 2);
            body(19, 10 + base, 3, 2);
            body(11, 14, 2, 3);
            detail(7, 12 + base, 11, 1, colors.light);
            face(9, 9 + base);
            break;
        case 'alien':
            body(7, 6 + base, 11, 6);
            body(9, 11, 7, 4);
            body(7, 2 + base, 2, 5);
            body(16, 2 + base, 2, 5);
            detail(7, 2 + base, 2, 2, colors.light);
            detail(16, 2 + base, 2, 2, colors.light);
            eye(8, 3 + base);
            eye(16, 3 + base);
            detail(11, 9 + base, 3, 1, colors.outline);
            feet(8, 15);
            break;
        case 'comet':
            body(12, 8 + base, 8, 7 - base);
            body(10, 10 + base, 2, 3);
            body(3, 4 + base, 3, 2, '#d88655');
            body(6, 6 + base, 3, 2, '#e8ab65');
            body(9, 8 + base, 3, 2, '#efd18f');
            detail(15, 9 + base, 3, 1, colors.light);
            eye(14, 11 + base);
            eye(18, 11 + base);
            feet(13, 18);
            break;
        case 'rover':
            body(4, 10 + base, 16, 4);
            body(13, 5 + base, 2, 5);
            body(11, 3 + base, 8, 3, colors.light);
            detail(16, 4 + base, 2, 1, colors.ink);
            body(7, 7 + base, 4, 3, '#7899ba');
            body(5, 15, 3, 2, colors.outline);
            body(11, 15, 3, 2, colors.outline);
            body(17, 15, 3, 2, colors.outline);
            detail(6, 15, 1, 1, colors.light);
            detail(12, 15, 1, 1, colors.light);
            detail(18, 15, 1, 1, colors.light);
            break;
        case 'snail':
            body(3, 14, 17, 2, colors.light);
            body(5, 7 + base, 9, 7 - base);
            body(7, 5 + base, 5, 2);
            detail(7, 8 + base, 5, 1, colors.outline);
            detail(7, 9 + base, 1, 3, colors.outline);
            detail(8, 11 + base, 4, 1, colors.outline);
            detail(11, 9 + base, 1, 2, colors.outline);
            body(17, 9 + base, 3, 6, colors.light);
            body(16, 6 + base, 1, 4, colors.light);
            body(20, 6 + base, 1, 4, colors.light);
            eye(16, 6 + base);
            eye(20, 6 + base);
            break;
        case 'crab':
            body(7, 10 + base, 11, 5 - base);
            body(3, 7 + base, 3, 6);
            body(20, 7 + base, 3, 6);
            body(2, 5 + base, 2, 3);
            body(5, 5 + base, 2, 3);
            body(19, 5 + base, 2, 3);
            body(22, 5 + base, 2, 3);
            body(9, 7 + base, 1, 3, colors.light);
            body(15, 7 + base, 1, 3, colors.light);
            eye(9, 7 + base);
            eye(15, 7 + base);
            feet();
            break;
        case 'mushroom':
            body(9, 9 + base, 7, 7 - base, '#eddec1');
            body(4, 7 + base, 17, 4);
            body(6, 4 + base, 13, 3);
            body(9, 2 + base, 7, 2);
            detail(7, 5 + base, 3, 2, '#f0e5c9');
            detail(15, 6 + base, 3, 2, '#f0e5c9');
            detail(12, 3 + base, 2, 1, '#f0e5c9');
            eye(10, 12);
            eye(14, 12);
            feet(8, 15);
            break;
        case 'sprout':
        case 'cactus':
        case 'sunflower':
            body(7, 12, 11, 4, '#b78262');
            body(6, 11, 13, 2, '#d2a079');
            body(11, 5 + base, 3, 6 - base, '#6e9461');

            if (pet.shape === 'sprout') {
                body(6, 3 + base, 5, 3);
                body(14, 2 + base, 5, 3);
                detail(7, 4 + base, 3, 1, colors.light);
            } else if (pet.shape === 'cactus') {
                body(10, 3 + base, 5, 8 - base);
                body(6, 6 + base, 2, 4);
                body(8, 8, 2, 2);
                body(17, 5 + base, 2, 4);
                body(15, 7 + base, 2, 2);
                detail(11, 4 + base, 1, 2, colors.light);
                body(13, 2 + base, 3, 2, '#d18eab');
            } else {
                body(8, 2 + base, 9, 6);
                body(6, 4 + base, 13, 2);
                body(11, 2 + base, 3, 8);
                detail(9, 3 + base, 7, 4, '#77573e');
                detail(10, 4 + base, 1, 1, '#f3deb0');
                detail(14, 4 + base, 1, 1, '#f3deb0');
                body(7, 8 + base, 4, 2, '#88a66b');
            }

            eye(9, 13, '#4d362c');
            eye(15, 13, '#4d362c');
            feet(8, 15);
            break;
        case 'bat':
        case 'moth':
            body(10, 6 + base, 5, 9 - base);
            body(3, 6 + base, 6, 6);
            body(16, 6 + base, 6, 6);
            body(5, 12, 4, 2);
            body(16, 12, 4, 2);
            body(2, 5 + base, 2, 4);
            body(21, 5 + base, 2, 4);
            body(10, 3 + base, 1, 3);
            body(14, 3 + base, 1, 3);
            eye(11, 7 + base, colors.light);
            eye(14, 7 + base, colors.light);

            if (pet.shape === 'moth') {
                detail(5, 7 + base, 2, 2, colors.light);
                detail(18, 7 + base, 2, 2, colors.light);
                detail(6, 11, 2, 1, colors.accent);
                detail(17, 11, 2, 1, colors.accent);
            } else {
                detail(4, 10, 4, 1, colors.shade);
                detail(17, 10, 4, 1, colors.shade);
            }

            feet(10, 14);
            break;
        case 'whale':
            body(7, 8 + base, 14, 7 - base);
            body(9, 6 + base, 9, 2);
            body(2, 8 + base, 4, 2);
            body(3, 10 + base, 4, 2);
            detail(12, 13, 8, 1, colors.light);
            eye(18, 10 + base);
            detail(19, 12, 2, 1, colors.outline);
            body(14, 3 + base, 1, 3, colors.light);
            body(12, 2 + base, 2, 1, colors.light);
            body(15, 1 + base, 2, 1, colors.light);
            break;
        case 'moonrabbit':
            roundBody();
            body(8, 5 + base, 9, 6);
            body(8, 2 + base, 2, 4);
            body(14, 2 + base, 2, 4);
            detail(9, 3 + base, 1, 2, colors.accent);
            detail(15, 3 + base, 1, 2, colors.accent);
            face(9, 7 + base);
            detail(12, 5 + base, 2, 1, '#e8d79a');
            break;
        case 'twinstar':
            body(5, 7 + base, 5, 6);
            body(3, 9 + base, 9, 2);
            body(7, 5 + base, 1, 10);
            body(15, 7 + base, 5, 6, colors.light);
            body(13, 9 + base, 9, 2, colors.light);
            body(17, 5 + base, 1, 10, colors.light);
            eye(6, 9 + base);
            eye(9, 9 + base);
            eye(16, 9 + base);
            eye(19, 9 + base);
            body(8, 15, 10, 2, colors.shade);
            break;
    }

    if (pose === 'work') {
        props.push(
            { x: 22, y: 9, w: 1, h: 6, color: '#82919b', outlined: true },
            { x: 21, y: 10, w: 1, h: 4, color: '#a5daca' },
            { x: 18, y: 15, w: 6, h: 1, color: '#61707e', outlined: true },
            { x: 19 + (frame % 3), y: 15, w: 1, h: 1, color: '#d9e8d5' }
        );
    }

    if (sleeping) {
        props.push(
            { x: 22, y: 3 + (frame % 2), w: 3, h: 1, color: '#8995bb' },
            { x: 23, y: 4 + (frame % 2), w: 1, h: 1, color: '#8995bb' },
            { x: 22, y: 5 + (frame % 2), w: 3, h: 1, color: '#8995bb' }
        );
    }

    if (pose === 'stopped') {
        const flip = (cells: Cell[]): Cell[] => cells.map((part) => ({ ...part, y: 17 - part.y - part.h }));

        return { silhouette: flip(silhouette), details: flip(details), props: [{ x: 22, y: 8, w: 2, h: 2, color: '#9ea5ae' }] };
    }

    return { silhouette, details, props };
}

type MotionKind = 'step' | 'hop' | 'waddle' | 'fly' | 'hover' | 'paddle' | 'ripple' | 'glide' | 'roll' | 'pot-hop' | 'scuttle';

/* How a shape moves: its walk, where its eyes are to close or cross, how many ticks a walk cycle takes, and where its bow sits. */
interface MotionRig {
    kind: MotionKind;
    eyes: [number, number][];
    ticks: number;
    anchor: [number, number];
}

const MOTION_RIGS: Record<string, MotionRig> = {
    rabbit: {
        kind: 'hop',
        eyes: [[18, 8]],
        ticks: 8,
        anchor: [16, 5]
    },
    ufo: {
        kind: 'hover',
        eyes: [
            [11, 8],
            [15, 8]
        ],
        ticks: 16,
        anchor: [12, 5]
    },
    visor: {
        kind: 'step',
        eyes: [
            [9, 8],
            [14, 8]
        ],
        ticks: 8,
        anchor: [12, 4]
    },
    robot: {
        kind: 'step',
        eyes: [
            [9, 8],
            [14, 8]
        ],
        ticks: 8,
        anchor: [12, 4]
    },
    nanobot: {
        kind: 'step',
        eyes: [
            [9, 8],
            [14, 8]
        ],
        ticks: 8,
        anchor: [12, 4]
    },
    relay: {
        kind: 'step',
        eyes: [
            [9, 8],
            [14, 8]
        ],
        ticks: 8,
        anchor: [12, 4]
    },
    cyclops: {
        kind: 'step',
        eyes: [[11, 8]],
        ticks: 8,
        anchor: [13, 4]
    },
    seedbot: {
        kind: 'step',
        eyes: [
            [8, 8],
            [13, 8]
        ],
        ticks: 8,
        anchor: [10, 4]
    },
    bee: {
        kind: 'fly',
        eyes: [[17, 9]],
        ticks: 8,
        anchor: [16, 7]
    },
    firefly: {
        kind: 'fly',
        eyes: [[17, 9]],
        ticks: 16,
        anchor: [16, 7]
    },
    penguin: {
        kind: 'waddle',
        eyes: [
            [9, 7],
            [14, 7]
        ],
        ticks: 16,
        anchor: [12, 4]
    },
    owl: {
        kind: 'fly',
        eyes: [
            [9, 7],
            [13, 7]
        ],
        ticks: 16,
        anchor: [12, 4]
    },
    hamster: {
        kind: 'step',
        eyes: [
            [9, 7],
            [14, 7]
        ],
        ticks: 8,
        anchor: [12, 4]
    },
    astronaut: {
        kind: 'step',
        eyes: [],
        ticks: 16,
        anchor: [12, 4]
    },
    cat: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 8,
        anchor: [16, 5]
    },
    fox: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 8,
        anchor: [16, 5]
    },
    raccoon: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 16,
        anchor: [16, 5]
    },
    redpanda: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 16,
        anchor: [16, 5]
    },
    dog: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 8,
        anchor: [16, 5]
    },
    deer: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 16,
        anchor: [16, 5]
    },
    llama: {
        kind: 'step',
        eyes: [[18, 4]],
        ticks: 16,
        anchor: [16, 3]
    },
    beaver: {
        kind: 'step',
        eyes: [[17, 8]],
        ticks: 16,
        anchor: [16, 5]
    },
    squirrel: {
        kind: 'hop',
        eyes: [[16, 7]],
        ticks: 8,
        anchor: [15, 5]
    },
    hedgehog: {
        kind: 'step',
        eyes: [[17, 11]],
        ticks: 16,
        anchor: [16, 9]
    },
    hummingbird: {
        kind: 'fly',
        eyes: [[16, 6]],
        ticks: 8,
        anchor: [15, 5]
    },
    raven: {
        kind: 'hop',
        eyes: [[16, 6]],
        ticks: 16,
        anchor: [15, 5]
    },
    parakeet: {
        kind: 'hop',
        eyes: [[16, 6]],
        ticks: 8,
        anchor: [15, 5]
    },
    windbird: {
        kind: 'fly',
        eyes: [[16, 6]],
        ticks: 16,
        anchor: [15, 5]
    },
    octopus: {
        kind: 'ripple',
        eyes: [
            [10, 8],
            [15, 8]
        ],
        ticks: 16,
        anchor: [12, 4]
    },
    axolotl: {
        kind: 'paddle',
        eyes: [
            [9, 8],
            [14, 8]
        ],
        ticks: 16,
        anchor: [12, 6]
    },
    turtle: {
        kind: 'step',
        eyes: [[20, 11]],
        ticks: 16,
        anchor: [18, 9]
    },
    ray: {
        kind: 'ripple',
        eyes: [
            [9, 9],
            [14, 9]
        ],
        ticks: 16,
        anchor: [12, 7]
    },
    alien: {
        kind: 'waddle',
        eyes: [
            [8, 3],
            [16, 3]
        ],
        ticks: 16,
        anchor: [12, 6]
    },
    comet: {
        kind: 'glide',
        eyes: [
            [14, 11],
            [18, 11]
        ],
        ticks: 16,
        anchor: [16, 8]
    },
    rover: {
        kind: 'roll',
        eyes: [],
        ticks: 16,
        anchor: [14, 3]
    },
    snail: {
        kind: 'glide',
        eyes: [
            [16, 6],
            [20, 6]
        ],
        ticks: 16,
        anchor: [9, 6]
    },
    crab: {
        kind: 'scuttle',
        eyes: [
            [9, 7],
            [15, 7]
        ],
        ticks: 8,
        anchor: [12, 10]
    },
    mushroom: {
        kind: 'pot-hop',
        eyes: [
            [10, 12],
            [14, 12]
        ],
        ticks: 16,
        anchor: [12, 3]
    },
    sprout: {
        kind: 'pot-hop',
        eyes: [
            [9, 13],
            [15, 13]
        ],
        ticks: 16,
        anchor: [12, 6]
    },
    cactus: {
        kind: 'pot-hop',
        eyes: [
            [9, 13],
            [15, 13]
        ],
        ticks: 16,
        anchor: [12, 4]
    },
    sunflower: {
        kind: 'pot-hop',
        eyes: [
            [10, 4],
            [14, 4]
        ],
        ticks: 16,
        anchor: [12, 2]
    },
    bat: {
        kind: 'fly',
        eyes: [
            [11, 7],
            [14, 7]
        ],
        ticks: 16,
        anchor: [12, 5]
    },
    moth: {
        kind: 'fly',
        eyes: [
            [11, 7],
            [14, 7]
        ],
        ticks: 16,
        anchor: [12, 5]
    },
    whale: {
        kind: 'paddle',
        eyes: [[18, 10]],
        ticks: 16,
        anchor: [16, 7]
    },
    moonrabbit: {
        kind: 'hop',
        eyes: [
            [9, 7],
            [14, 7]
        ],
        ticks: 16,
        anchor: [12, 5]
    },
    twinstar: {
        kind: 'hover',
        eyes: [
            [6, 9],
            [9, 9],
            [16, 9],
            [19, 9]
        ],
        ticks: 16,
        anchor: [12, 7]
    },
    'fluffy-cat': {
        kind: 'step',
        eyes: [[18, 7]],
        ticks: 16,
        anchor: [17, 4]
    },
    'tabby-cat': {
        kind: 'step',
        eyes: [[18, 7]],
        ticks: 8,
        anchor: [17, 4]
    }
};

function rigOf(pet: PetDesign): MotionRig {
    return (
        MOTION_RIGS[pet.shape] ?? {
            kind: 'step',
            eyes: [],
            ticks: 16,
            anchor: [12, 4]
        }
    );
}

function closedEyes(parts: Parts, pet: PetDesign, eyes: [number, number][]): void {
    for (const [x, y] of eyes) {
        const original = [...parts.details].reverse().find((part) => part.x === x && part.y === y && part.h <= 2);
        const ink = original?.color ?? pet.palette.ink;
        parts.details.push({ x, y, w: 2, h: 1, color: ink });
    }
}

function whaleParts(pet: PetDesign, pose: Pose, frame: number): Parts {
    const colors = pet.palette;
    const parts: Parts = { silhouette: [], details: [], props: [] };
    const phase = frame % 8;
    const wave = [0, -1, -2, -1, 0, 1, 2, 1][phase];
    const resting = pose === 'sleep' || pose === 'stopped';
    const cruising = pose === 'walk';
    const lift = cruising ? [0, 0, -1, -1, -1, 0, 1, 1][phase] : 0;
    const tail = resting ? 1 : cruising ? wave : Math.sign(wave);
    const bodyY = resting ? 10 : 7 + lift;
    const bodyHeight = resting ? 6 : 7;
    const add = (x: number, y: number, w: number, h: number, color = colors.body): void => {
        parts.silhouette.push({ x, y, w, h, color });
    };
    add(7, bodyY + 1, 14, bodyHeight - 1);
    add(9, bodyY, 10, 2);
    add(20, bodyY + 2, 2, 3);
    add(5, bodyY + 3, 3, 3);
    add(3, bodyY + 1 + tail, 3, 2);
    add(1, bodyY + tail, 3, 2);
    add(1, bodyY + 3 + tail, 2, 2);
    parts.details.push({ x: 10, y: bodyY + bodyHeight - 2, w: 11, h: 1, color: colors.light });
    const fin = resting ? 0 : cruising ? [0, 0, -1, -1, 0, 0, 1, 1][phase] : pose === 'work' ? phase % 2 : 0;
    parts.details.push({ x: 13, y: bodyY + 4, w: 2, h: 2, color: colors.shade }, { x: 14, y: bodyY + 5 + fin, w: 4, h: 1, color: colors.shade });
    parts.details.push({ x: 18, y: bodyY + 3, w: resting || (phase === 6 && pose === 'stand') ? 2 : 1, h: 1, color: colors.ink });
    parts.details.push({ x: 19, y: bodyY + 5, w: 2, h: 1, color: colors.outline });

    if (pose === 'work') {
        parts.details.push({ x: 17, y: 13 - (phase % 2), w: 4, h: 1, color: colors.shade });
    }

    if ((pose === 'stand' || pose === 'wait') && phase < 3) {
        parts.props.push(
            { x: 14, y: 4 - phase, w: 1, h: 2, color: colors.light },
            { x: 12, y: 3 - phase, w: 2, h: 1, color: colors.light },
            { x: 15, y: 2 - phase, w: 2, h: 1, color: colors.light }
        );
    }

    return parts;
}

function partsOf(pet: PetDesign, pose: Pose, frame: number): Parts {
    const rig = rigOf(pet);
    const phase = frame % 8;
    const wave = [0, -1, -1, 0, 1, 1, 0, 0][phase];
    const hop = [0, 0, -1, -2, -2, -1, 0, 0][phase];
    const plants = ['sprout', 'cactus', 'sunflower'].includes(pet.shape);
    const machines = ['visor', 'robot', 'nanobot', 'relay', 'cyclops', 'seedbot', 'astronaut'].includes(pet.shape);
    const birds = ['raven', 'hummingbird', 'parakeet', 'windbird'].includes(pet.shape);
    const nativeBuddy = ['visor', 'robot', 'nanobot', 'relay', 'cyclops', 'seedbot'].includes(pet.shape);
    const ownSleep = ['rabbit', 'fluffy-cat', 'tabby-cat'].includes(pet.shape) && pose === 'sleep';
    const parts =
        pet.shape === 'whale'
            ? whaleParts(pet, pose === 'stopped' ? 'stand' : pose, pose === 'stopped' ? 4 : frame)
            : sketchPartsOf(pet, ownSleep ? 'sleep' : 'stand', ownSleep && phase >= 4 ? 1 : 0);
    parts.props = pet.shape === 'whale' ? parts.props : [];

    if (nativeBuddy) {
        parts.silhouette = parts.silhouette.filter((part) => part.y < 14);
        parts.details = parts.details.filter((part) => part.y < 14);

        for (let index = 0; index < 4; index++) {
            const x = 7 + index * 3;
            const lift = pose === 'walk' && index % 2 === phase % 2 ? 1 : pose === 'wait' && index === 3 ? phase % 2 : 0;
            parts.details.push({ x, y: 14, w: 1, h: 3 - lift, color: pet.palette.outline }, { x, y: 14, w: 1, h: 2 - lift, color: pet.palette.body });
        }
    }

    if (plants) {
        parts.silhouette = parts.silhouette.filter((part) => part.y < 14);
        parts.details = parts.details.filter((part) => part.y < 15);
    }

    if (['comet', 'bat', 'moth'].includes(pet.shape)) {
        parts.silhouette = parts.silhouette.filter((part) => part.y < 14);
        parts.details = parts.details.filter((part) => part.y < 14);
    }

    if (((pose === 'stand' && phase === 6) || pose === 'sleep') && pet.shape !== 'whale' && !ownSleep) {
        closedEyes(parts, pet, rig.eyes);
    }

    const transform = (change: (part: Cell) => Cell): void => {
        parts.silhouette = parts.silhouette.map(change);
        parts.details = parts.details.map(change);
    };

    if (pose === 'walk' && pet.shape !== 'whale' && !nativeBuddy) {
        if (rig.kind === 'step' || rig.kind === 'waddle' || rig.kind === 'scuttle') {
            transform((part) => {
                if (part.y >= 14) {
                    const front = part.x >= 12;
                    const raised = phase < 4 === front;
                    return { ...part, x: part.x + (raised ? 1 : -1), y: part.y - (raised ? 1 : 0), h: Math.max(1, part.h - (raised ? 1 : 0)) };
                }

                const sway = rig.kind === 'waddle' ? (phase < 4 ? -1 : 1) : 0;
                const tail = part.x < 6 && part.y < 14 ? wave : 0;

                return { ...part, x: part.x + sway, y: part.y + tail };
            });
        } else if (rig.kind === 'hop' || rig.kind === 'pot-hop') {
            transform((part) => ({
                ...part,
                y: part.y + hop + (part.y < 8 && phase === 5 ? 1 : 0),
                h: part.y >= 14 && hop < 0 ? Math.max(1, part.h - 1) : part.h
            }));
        } else if (rig.kind === 'fly') {
            parts.silhouette = parts.silhouette.filter((part) => part.y < 14);
            parts.details = parts.details.filter((part) => part.y < 15);
            const wings = [0, -2, -3, -1, 1, 2, 1, 0][phase];

            transform((part) => {
                const wing = ['bee', 'firefly'].includes(pet.shape)
                    ? part.color === '#d8edf0'
                    : birds
                      ? part.x === 7 && part.w === 5
                      : pet.shape === 'owl'
                        ? part.x === 4 || part.x === 17
                        : part.x < 10 || part.x > 15;

                return { ...part, y: part.y + (wing ? wings : Math.min(0, wave)), h: wing ? Math.max(1, part.h + (phase < 4 ? -1 : 1)) : part.h };
            });
        } else if (rig.kind === 'ripple' || rig.kind === 'paddle') {
            transform((part) => {
                const appendage = pet.shape === 'ray' ? part.x <= 6 || part.x >= 19 : part.y >= 11 && part.w <= 3;
                const delayed = [0, -1, 0, 1, 1, 0, -1, 0][(phase + Math.floor(part.x / 4)) % 8];

                return { ...part, y: part.y + (appendage ? delayed : 0), h: appendage ? Math.max(1, part.h - Math.max(0, delayed)) : part.h };
            });
        } else if (rig.kind === 'roll') {
            transform((part) => ({ ...part, y: part.y < 10 ? part.y + Math.max(0, wave) : part.y }));
            const spokes = [
                [1, 0],
                [2, 1],
                [1, 1],
                [0, 1]
            ][phase % 4];

            for (const x of [5, 11, 17]) {
                parts.details.push({ x: x + spokes[0], y: 15 + spokes[1], w: 1, h: 1, color: pet.palette.light });
            }
        } else if (rig.kind === 'glide') {
            if (pet.shape === 'snail') {
                parts.details.push({ x: 4 + phase * 2, y: 15, w: 2, h: 1, color: pet.palette.shade });
                transform((part) => ({ ...part, x: part.y < 10 && part.x >= 16 ? part.x + (phase < 4 ? 0 : -1) : part.x }));
            } else {
                transform((part) => ({ ...part, y: part.y + (part.x < 12 ? wave : 0) }));
            }
        } else if (rig.kind === 'hover') {
            if (pet.shape === 'ufo') {
                parts.silhouette = parts.silhouette.filter((part) => part.y < 14);
                parts.details = parts.details.filter((part) => part.y < 14);
                parts.details.push({ x: 5 + phase * 2, y: 11, w: 2, h: 1, color: pet.palette.accent });
            }

            transform((part) => ({ ...part, y: part.y + (part.x < 13 ? Math.min(0, wave) : Math.min(0, -wave)) }));
        }
    }

    if (pose === 'work') {
        if (pet.shape !== 'whale') {
            const reach = phase % 2;

            if (plants) {
                transform((part) => ({ ...part, x: part.y < 11 && part.x > 12 ? part.x + reach : part.x }));
            } else if (birds) {
                transform((part) => ({ ...part, x: part.x >= 12 && part.y < 11 ? part.x + reach : part.x }));
                parts.details.push({ x: 20, y: 9 + reach, w: 2, h: 1, color: pet.palette.accent });
            } else if (pet.shape === 'rover') {
                parts.details.push({ x: 17, y: 5 + (phase % 3), w: 4, h: 1, color: pet.palette.accent });
            } else if (['ufo', 'comet', 'twinstar', 'firefly', 'moth', 'mushroom'].includes(pet.shape)) {
                parts.details.push({ x: 18 + (phase % 3), y: 10 + (phase % 2), w: 1, h: 1, color: pet.palette.accent });
            } else {
                parts.silhouette.push({
                    x: pet.shape === 'octopus' ? 17 : 18,
                    y: 13 - reach,
                    w: 3,
                    h: pet.shape === 'octopus' ? 2 : 1,
                    color: pet.palette.body
                });
            }
        }

        parts.props.push(
            { x: 23, y: 9, w: 1, h: 6, color: '#82919b', outlined: true },
            { x: 22, y: 10, w: 1, h: 4, color: phase % 2 ? '#a5daca' : '#c6ecdf' },
            { x: 19, y: 15, w: 5, h: 1, color: '#61707e', outlined: true },
            { x: 20 + (phase % 3), y: 15, w: 1, h: 1, color: '#d9e8d5' }
        );
    }

    if (pose === 'wait' && pet.shape !== 'whale') {
        if (machines) {
            parts.details.push({ x: 5, y: 9, w: 1, h: 1, color: phase < 4 ? pet.palette.accent : pet.palette.shade });
        } else if (plants) {
            transform((part) => ({ ...part, x: part.y < 10 && phase >= 4 ? part.x + 1 : part.x }));
        } else {
            transform((part) => ({ ...part, y: part.x >= 12 && part.y < 12 && phase >= 4 ? part.y - 1 : part.y }));
        }
    }

    if (pose === 'sleep') {
        if (pet.shape !== 'whale' && !ownSleep) {
            const breath = phase < 4 ? 0 : -1;

            transform((part) => {
                if (nativeBuddy) {
                    if (part.y >= 14) {
                        return part;
                    }

                    const y = part.y + 1;

                    return { ...part, y, h: Math.max(1, Math.min(part.h, 14 - y)) };
                }

                if (plants) {
                    if (part.y >= 11) {
                        return part;
                    }

                    const y = part.y + (part.y < 8 ? 2 : 1);

                    return { ...part, y, h: Math.max(1, Math.min(part.h, 11 - y)) };
                }

                const y = 5 + Math.round(part.y * 0.7) + (part.y < 12 ? breath : 0);

                return { ...part, y, h: Math.max(1, Math.min(Math.round(part.h * 0.8), 17 - y)) };
            });
        }

        parts.props = snore(19, frame);
    }

    if (pose === 'stand' && pet.shape !== 'whale' && phase >= 4) {
        transform((part) => ({ ...part, y: part.y + (part.y >= 5 && part.y < 12 ? 1 : 0) }));
    }

    let [anchorX, anchorY] = rig.anchor;

    if (pose === 'walk' && (rig.kind === 'hop' || rig.kind === 'pot-hop')) {
        anchorY += hop;
    } else if (pose === 'walk' && pet.shape === 'whale') {
        anchorY += [0, 0, -1, -1, -1, 0, 1, 1][phase];
    } else if (pose === 'sleep') {
        anchorY = ownSleep || pet.shape === 'whale' ? 10 : nativeBuddy ? anchorY + 1 : plants ? anchorY + 2 : 5 + Math.round(anchorY * 0.7);
    } else if (pose === 'stand' && phase >= 4 && anchorY >= 5 && anchorY < 12) {
        anchorY++;
    }

    if (pose === 'walk' && rig.kind === 'waddle' && !nativeBuddy) {
        anchorX += phase < 4 ? -1 : 1;
    }

    if (pose === 'walk' && rig.kind === 'fly') {
        anchorY += Math.min(0, wave);
    }

    if (pose === 'wait' && pet.shape !== 'whale' && !machines && !plants && anchorX >= 12 && phase >= 4) {
        anchorY--;
    }

    if (pose === 'work' && birds) {
        anchorX += phase % 2;
    }

    if (pose === 'sleep' && !ownSleep && !nativeBuddy && !plants && pet.shape !== 'whale' && phase >= 4) {
        anchorY--;
    }

    anchorX = Math.max(4, Math.min(21, anchorX));
    anchorY = Math.max(2, Math.min(14, anchorY));

    parts.bow = [
        { x: anchorX - 4, y: anchorY - 2, w: 3, h: 3, tone: 'base' },
        { x: anchorX + 1, y: anchorY - 2, w: 3, h: 3, tone: 'base' },
        { x: anchorX - 1, y: anchorY - 1, w: 2, h: 2, tone: 'base' },
        { x: anchorX - 4, y: anchorY - 2, w: 1, h: 1, tone: 'light' },
        { x: anchorX + 1, y: anchorY - 2, w: 1, h: 1, tone: 'light' },
        { x: anchorX - 3, y: anchorY - 1, w: 1, h: 1, tone: 'shade' },
        { x: anchorX + 2, y: anchorY - 1, w: 1, h: 1, tone: 'shade' },
        { x: anchorX - 1, y: anchorY - 1, w: 2, h: 2, tone: 'shade' }
    ];

    if (pose === 'stopped') {
        const eyes: [number, number][] = rig.eyes.length > 0 ? rig.eyes : pet.shape === 'astronaut' ? [[11, 7]] : pet.shape === 'rover' ? [[16, 4]] : [];

        for (const [x, y] of eyes) {
            const original = [...parts.details].reverse().find((part) => part.x === x && part.y === y && part.w <= 2 && part.h <= 2);
            const color = pet.shape === 'astronaut' ? '#c5e3dc' : (original?.color ?? pet.palette.ink);
            parts.details = parts.details.filter(
                (part) => !(part.w <= 2 && part.h <= 2 && part.x >= x - 1 && part.x <= x + 1 && part.y >= y - 1 && part.y <= y + 1)
            );
            parts.details.push(
                { x: x - 1, y: y - 1, w: 1, h: 1, color },
                { x: x + 1, y: y - 1, w: 1, h: 1, color },
                { x, y, w: 1, h: 1, color },
                { x: x - 1, y: y + 1, w: 1, h: 1, color },
                { x: x + 1, y: y + 1, w: 1, h: 1, color }
            );
        }

        const left = Math.min(...parts.silhouette.map((part) => part.x)) - 1;
        const drop = Math.min(3, Math.min(...parts.silhouette.map((part) => part.y)));
        const fallen = <T extends { x: number; y: number; w: number; h: number }>(part: T): T =>
            nativeBuddy ? { ...part, x: 18 - part.y - part.h, y: part.x - left, w: part.h, h: part.w } : { ...part, y: 17 - part.y - part.h + drop };

        return {
            silhouette: parts.silhouette.map(fallen),
            details: parts.details.map(fallen),
            bow: parts.bow.map(fallen),
            props: nativeBuddy ? cloud(frame) : []
        };
    }

    return parts;
}

/* A figure of the catalog. Its walk runs at its rig's pace, so a hop takes as long as it should on the shared clock. */
export function sketchedSprite(pet: PetDesign): DrawnSprite {
    const rig = rigOf(pet);

    return {
        id: pet.id,
        outline: pet.palette.outline,
        poses: {
            stand: (frame) => partsOf(pet, 'stand', frame),
            walk: (frame) => partsOf(pet, 'walk', Math.floor(frame / (rig.ticks / 8))),
            work: (frame) => partsOf(pet, 'work', frame),
            wait: (frame) => partsOf(pet, 'wait', frame),
            sleep: (frame) => partsOf(pet, 'sleep', frame),
            stopped: (frame) => partsOf(pet, 'stopped', frame)
        }
    };
}
