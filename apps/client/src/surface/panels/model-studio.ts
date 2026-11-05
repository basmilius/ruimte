import { DirectionalLight, Group, HemisphereLight, Mesh, PlaneGeometry, ShadowMaterial, Vector3 } from 'three';
import { boundingSphere, type ModelBounds } from '@/surface/panels/model-view';

const UNIT_BOX: ModelBounds = { min: [-1, -1, -1], max: [1, 1, 1] };

// Where each light shines from, as seen from the model: in front, to the right and above, the way a product is photographed.
const KEY_DIRECTION = new Vector3(1, 1.5, 1.2).normalize();

// The ground that catches the shadow reaches this many radii out, past where the grid fades.
const GROUND_RADII = 20;

const SHADOW_MAP_SIZE = 2048;

/*
 * A key light from the front right and above that casts the model's shadow on the ground, a softer
 * fill from the left and a rim from behind that edges the outline. The ground itself draws nothing
 * but that shadow, so the grid and the surface behind the canvas stay visible.
 */
export class ModelStudio extends Group {
    private readonly key = new DirectionalLight(0xfff4e8, 2.6);
    private readonly ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.22, depthWrite: false }));

    constructor() {
        super();
        // A fill and a rim shine toward their target at the origin, so only their direction counts.
        const fill = new DirectionalLight(0xe8f0ff, 0.8);
        fill.position.set(-1.4, 0.4, 0.8);
        const rim = new DirectionalLight(0xffffff, 2);
        rim.position.set(-0.3, 1, -1.5);
        this.key.castShadow = true;
        this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        this.key.shadow.radius = 4;
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.add(new HemisphereLight(0xffffff, 0x8a8d93, 0.6), this.key, this.key.target, fill, rim, this.ground);
        this.visible = false;
    }

    /* Aims the key light at the model and sizes its shadow to it; no bounds light a cube of 2 around the origin. */
    fit(bounds: ModelBounds | null): void {
        const box = bounds ?? UNIT_BOX;
        const sphere = boundingSphere(box);
        const center = new Vector3(...sphere.center);
        const radius = sphere.radius;
        this.key.target.position.copy(center);
        this.key.position.copy(center).addScaledVector(KEY_DIRECTION, radius * 3);
        // The shadow of a model lit from above and aside falls past its own bounds, so the box is wider than the model.
        const camera = this.key.shadow.camera;
        camera.left = -radius * 2;
        camera.right = radius * 2;
        camera.top = radius * 2;
        camera.bottom = -radius * 2;
        camera.near = radius;
        camera.far = radius * 6;
        camera.updateProjectionMatrix();
        this.key.shadow.bias = -0.0005;
        // Scaled with the model, or a model in millimeters would draw stripes of its own shadow across itself.
        this.key.shadow.normalBias = radius * 0.01;
        this.ground.position.set(center.x, box.min[1], center.z);
        this.ground.scale.setScalar(radius * GROUND_RADII * 2);
    }

    override dispose(): void {
        this.key.shadow.dispose();
        this.ground.geometry.dispose();
        this.ground.material.dispose();
        super.dispose();
    }
}
