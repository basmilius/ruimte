import {
    AnimationMixer,
    Box3,
    MOUSE,
    NeutralToneMapping,
    PerspectiveCamera,
    PMREMGenerator,
    Scene,
    WebGLRenderer,
    type BufferGeometry,
    type Material,
    type Mesh,
    type Object3D,
    type SkinnedMesh,
    type Texture,
    type WebGLRenderTarget
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { isSpaceDown, subscribeSpacePan } from '@/surface/canvas/space-pan';
import { ModelGrid } from '@/surface/panels/model-grid';
import { parseModel } from '@/surface/panels/model-parse';
import { ModelStudio } from '@/surface/panels/model-studio';
import { countGeometry, fitCamera, gridCellSize, type ModelBounds, type ModelCounts } from '@/surface/panels/model-view';

const FIELD_OF_VIEW = 45;

// A frame after a long pause (a hidden window) would jump the animation ahead by the whole pause.
const MAX_FRAME_SECONDS = 0.1;

// Under studio light the room only lifts the shadows and gives the reflections; the studio's lights shape the model.
const STUDIO_ENVIRONMENT_INTENSITY = 0.35;

export interface LoadedModel extends ModelCounts {
    animated: boolean;
}

let webgl2: boolean | null = null;

/* Whether this page can make the WebGL 2 context the renderer needs, probed once; the probe gives its context back. */
export function canDrawWebgl(): boolean {
    if (webgl2 === null) {
        const context = document.createElement('canvas').getContext('webgl2');
        webgl2 = context !== null;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return webgl2;
}

function disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
        if ((value as Texture | null)?.isTexture === true) {
            (value as Texture).dispose();
        }
    }
    material.dispose();
}

function disposeModel(root: Object3D): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    root.traverse((object) => {
        const mesh = object as Mesh;
        if (mesh.geometry !== undefined) {
            geometries.add(mesh.geometry);
        }
        if (mesh.material !== undefined) {
            for (const material of [mesh.material].flat()) {
                materials.add(material);
            }
        }
        (object as SkinnedMesh).skeleton?.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach(disposeMaterial);
}

/*
 * One model on one canvas, drawn only when something changed: the camera moved, a setting flipped,
 * or an animation plays. Everything it made on the GPU goes with `dispose`, the context included.
 */
export class ModelViewer {
    private readonly renderer: WebGLRenderer;
    private readonly scene = new Scene();
    private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 1000);
    private readonly controls: OrbitControls;
    private readonly environment: WebGLRenderTarget;
    private readonly grid = new ModelGrid();
    private readonly studio = new ModelStudio();
    private readonly observer: ResizeObserver;
    private readonly unsubscribeSpace: () => void;
    private model: Object3D | null = null;
    private bounds: ModelBounds | null = null;
    private mixer: AnimationMixer | null = null;
    private playing = false;
    private lastTime: number | null = null;
    private frame: number | null = null;
    private disposed = false;

    /* Throws when the page cannot make a WebGL context after all. */
    constructor(host: HTMLElement) {
        this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = NeutralToneMapping;
        this.renderer.shadowMap.enabled = true;
        const canvas = this.renderer.domElement;
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.touchAction = 'none';
        canvas.addEventListener('webglcontextrestored', () => this.requestRender());
        host.append(canvas);

        const generator = new PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.environment = generator.fromScene(room, 0.04);
        room.dispose();
        generator.dispose();
        this.scene.environment = this.environment.texture;
        this.scene.add(this.grid, this.studio);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        // A right-click is the file's menu, as on every other preview; panning is Shift or Space and drag.
        this.controls.mouseButtons.RIGHT = null;
        this.controls.addEventListener('change', () => this.requestRender());
        // Space and drag pans here as it does on the canvas; inside a canvas node the canvas takes that press first.
        this.unsubscribeSpace = subscribeSpacePan(() => this.followSpace());
        this.followSpace();

        this.observer = new ResizeObserver(([entry]) => this.resize(entry.contentRect.width, entry.contentRect.height));
        this.observer.observe(host);
        // The observer answers a frame later, and a model that loads before that is framed for this size already.
        this.resize(host.clientWidth, host.clientHeight);
    }

    /* Any bytes of a model mime, wherever they came from. `nestedRoot` is the words for a USDZ this viewer refuses to open. */
    async load(bytes: ArrayBuffer, mime: string, nestedRoot: string): Promise<LoadedModel> {
        const { root, animations } = await parseModel(bytes, mime, nestedRoot);
        const loaded = { ...countGeometry(root), animated: animations.length > 0 };
        if (this.disposed) {
            disposeModel(root);
            return loaded;
        }
        this.model = root;
        this.scene.add(root);
        const box = new Box3().setFromObject(root);
        this.bounds = box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
        this.grid.fit(this.bounds?.min[1] ?? 0, gridCellSize(this.bounds));
        this.studio.fit(this.bounds);
        root.traverse((object) => {
            object.castShadow = true;
        });
        if (animations.length > 0) {
            // The first clip only: a file that carries several usually means them as alternatives, a walk and a run.
            this.mixer = new AnimationMixer(root);
            this.mixer.clipAction(animations[0]).play();
            this.mixer.update(0);
        }
        this.resetCamera();
        return loaded;
    }

    resetCamera(): void {
        const fit = fitCamera(this.bounds, FIELD_OF_VIEW, this.camera.aspect);
        this.camera.near = fit.near;
        this.camera.far = fit.far;
        this.camera.position.set(...fit.position);
        this.camera.updateProjectionMatrix();
        this.controls.target.set(...fit.target);
        this.controls.maxDistance = fit.far / 10;
        this.controls.update();
        this.requestRender();
    }

    setWireframe(wireframe: boolean): void {
        this.model?.traverse((object) => {
            const mesh = object as Mesh;
            if (mesh.material === undefined) {
                return;
            }
            for (const material of [mesh.material].flat()) {
                if ('wireframe' in material) {
                    material.wireframe = wireframe;
                }
            }
        });
        this.requestRender();
    }

    setGrid(visible: boolean): void {
        this.grid.visible = visible;
        this.requestRender();
    }

    setDark(dark: boolean): void {
        this.grid.setDark(dark);
        this.requestRender();
    }

    setStudioLight(studio: boolean): void {
        this.studio.visible = studio;
        this.scene.environmentIntensity = studio ? STUDIO_ENVIRONMENT_INTENSITY : 1;
        this.requestRender();
    }

    setPlaying(playing: boolean): void {
        this.playing = playing && this.mixer !== null;
        this.lastTime = null;
        this.requestRender();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        this.observer.disconnect();
        this.unsubscribeSpace();
        this.controls.dispose();
        if (this.model !== null) {
            this.mixer?.stopAllAction();
            this.mixer?.uncacheRoot(this.model);
            disposeModel(this.model);
            this.model = null;
        }
        this.grid.dispose();
        this.studio.dispose();
        this.environment.dispose();
        this.renderer.dispose();
        // The page keeps only a handful of live contexts, and the terminals hold most of them.
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }

    private followSpace(): void {
        const down = isSpaceDown();
        this.controls.mouseButtons.LEFT = down ? MOUSE.PAN : MOUSE.ROTATE;
        this.renderer.domElement.style.cursor = down ? 'grab' : '';
    }

    private resize(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            return;
        }
        this.renderer.setSize(Math.round(width), Math.round(height), false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    private requestRender(): void {
        if (this.frame === null && !this.disposed) {
            this.frame = requestAnimationFrame((time) => this.draw(time));
        }
    }

    private draw(time: number): void {
        this.frame = null;
        if (this.playing && this.mixer !== null) {
            this.mixer.update(this.lastTime === null ? 0 : Math.min((time - this.lastTime) / 1000, MAX_FRAME_SECONDS));
            this.lastTime = time;
        }
        // While the camera still glides after a drag, this changes it again and asks for the next frame.
        this.controls.update();
        this.grid.follow(this.camera, this.camera.position.distanceTo(this.controls.target));
        this.renderer.render(this.scene, this.camera);
        if (this.playing) {
            this.requestRender();
        }
    }
}
