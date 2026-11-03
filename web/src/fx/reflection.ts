import * as THREE from 'three';
import type { ReflectionController } from '../ctx';

/** Objects on this layer are omitted only by the mirror camera. */
export const REFLECTION_EXCLUDE_LAYER = 1;

const REFLECTION_SIZE = 512;

/**
 * Single horizontal-plane reflector. While disabled the last valid target is
 * retained, so materials that captured `reflection.texture` never need a
 * runtime texture swap (a never-rendered initial target is transparent-black).
 */
export class PlanarReflection implements ReflectionController {
  readonly texture: THREE.Texture;
  readonly textureMatrix = new THREE.Matrix4();

  private readonly target = new THREE.WebGLRenderTarget(REFLECTION_SIZE, REFLECTION_SIZE, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  private readonly mirrorCamera = new THREE.PerspectiveCamera();
  private readonly lastCameraMatrix = new THREE.Matrix4();
  private readonly lastProjectionMatrix = new THREE.Matrix4();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private enabled = true;
  private hasRendered = false;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.texture = this.target.texture;
    this.target.texture.name = 'neon-street-planar-reflection';
    this.mirrorCamera.layers.mask = camera.layers.mask & ~(1 << REFLECTION_EXCLUDE_LAYER);
  }

  render(): void {
    if (!this.enabled || this.disposed) return;

    this.camera.updateMatrixWorld();
    if (
      this.hasRendered &&
      this.lastCameraMatrix.equals(this.camera.matrixWorld) &&
      this.lastProjectionMatrix.equals(this.camera.projectionMatrix)
    ) {
      return;
    }

    this.syncMirrorCamera();
    const previousTarget = this.renderer.getRenderTarget();
    const previousToneMapping = this.renderer.toneMapping;
    // Tone mapping happens again in the composer; keep the mirror render linear.
    this.renderer.toneMapping = THREE.NoToneMapping;
    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.mirrorCamera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.toneMapping = previousToneMapping;
    }

    this.lastCameraMatrix.copy(this.camera.matrixWorld);
    this.lastProjectionMatrix.copy(this.camera.projectionMatrix);
    this.hasRendered = true;
  }

  resize(width: number, height: number): void {
    // Keep the target square and bounded. The camera projection, not target
    // dimensions, defines the projective mapping; this is only quality scale.
    const size = Math.min(REFLECTION_SIZE, Math.max(1, Math.round(Math.min(width, height))));
    if (this.target.width !== size || this.target.height !== size) this.target.setSize(size, size);
    this.hasRendered = false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.hasRendered = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.dispose();
  }

  private syncMirrorCamera(): void {
    const source = this.camera;
    this.cameraPosition.setFromMatrixPosition(source.matrixWorld);
    source.getWorldDirection(this.cameraTarget).add(this.cameraPosition);
    this.cameraUp.set(0, 1, 0).applyQuaternion(source.quaternion);

    // Reflect camera position, view target, and world-space up vector in y=0.
    this.cameraPosition.y *= -1;
    this.cameraTarget.y *= -1;
    this.cameraUp.y *= -1;

    const mirror = this.mirrorCamera;
    mirror.fov = source.fov;
    mirror.aspect = source.aspect;
    mirror.near = source.near;
    mirror.far = source.far;
    mirror.zoom = source.zoom;
    mirror.filmGauge = source.filmGauge;
    mirror.filmOffset = source.filmOffset;
    mirror.up.copy(this.cameraUp);
    mirror.position.copy(this.cameraPosition);
    mirror.layers.mask = source.layers.mask & ~(1 << REFLECTION_EXCLUDE_LAYER);
    mirror.updateProjectionMatrix();
    mirror.lookAt(this.cameraTarget);
    mirror.updateMatrixWorld();

    // bias * mirror projection * mirror view, for water world positions.
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    this.textureMatrix.multiply(mirror.projectionMatrix);
    this.textureMatrix.multiply(mirror.matrixWorldInverse);
  }
}
