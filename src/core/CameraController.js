import * as THREE from 'three';

export default class CameraController {
  constructor(scene, input) {
    this.input = input;
    this.sensitivity = 0.002;
    this.keyTurnSpeed = 1.2;
    this.pitchLimit = Math.PI / 2 - 0.12;
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 180);
    this.yawObject = new THREE.Object3D();
    this.pitchObject = new THREE.Object3D();
    this.yawObject.add(this.pitchObject);
    this.pitchObject.add(this.camera);
    scene.add(this.yawObject);
    this.isFirstPerson = true;
    this.isBodyOccluded = false;
    this.motionEnabled = true;
    this.occluders = [];
    this.tpDistance = 2.6;
    this.shakeIntensity = 0;
    this._height = 1.25;
    this._phase = 0;
    this._bob = 0;
    this._recoil = 0;
    this._offset = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._rayOrigin = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._hits = [];
    this._corners = [[0, 0], [-0.12, -0.09], [0.12, -0.09], [-0.12, 0.09], [0.12, 0.09]];

    // Tactical flashlight — a spotlight parented to the camera so it always
    // illuminates exactly where you look (toggle with F). No shadows: a
    // moving shadow-casting spotlight costs a second shadow map per frame.
    this.flashlightOn = true;
    this.flashlight = new THREE.SpotLight(0xfff1d6, 0, 26, 0.5, 0.45, 1.7);
    this.flashlight.position.set(0.18, -0.12, 0.05);
    this.flashlight.target.position.set(0, 0, -8);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
  }

  toggleView() {
    this.isFirstPerson = !this.isFirstPerson;
  }

  reset() {
    this.yawObject.rotation.set(0, 0, 0);
    this.pitchObject.rotation.set(0, 0, 0);
    this._offset.set(0, 0, 0);
    this.shakeIntensity = this._recoil = this._bob = 0;
    this._height = 1.25;
  }

  update(dt, position, state = {}) {
    if (this.input.justPressed('KeyV')) this.toggleView();
    if (this.input.justPressed('KeyF')) this.flashlightOn = !this.flashlightOn;
    this.flashlight.intensity = this.flashlightOn ? (this.isFirstPerson ? 34 : 24) : 0;
    const aim = !!state.aiming;
    const lookScale = aim ? 0.5 : 1;
    const keys = this.input.keys;
    if (this.input.mouse.locked) {
      this.yawObject.rotation.y -= this.input.mouse.dx * this.sensitivity * lookScale;
      this.pitchObject.rotation.x -= this.input.mouse.dy * this.sensitivity * lookScale;
    }
    const turn = (aim || keys.ShiftLeft || keys.ShiftRight ? 0.32 : this.keyTurnSpeed) * dt;
    if (keys.ArrowLeft) this.yawObject.rotation.y += turn;
    if (keys.ArrowRight) this.yawObject.rotation.y -= turn;
    if (keys.ArrowUp) this.pitchObject.rotation.x += turn;
    if (keys.ArrowDown) this.pitchObject.rotation.x -= turn;
    this.pitchObject.rotation.x = THREE.MathUtils.clamp(this.pitchObject.rotation.x, -this.pitchLimit, this.pitchLimit);

    const blend = 1 - Math.exp(-12 * dt);
    const height = state.crouching ? 0.72 : this.isFirstPerson ? 1.25 : 1.12;
    this._height += (height - this._height) * blend;
    this.yawObject.position.set(position.x, position.y + this._height, position.z);
    this._target.set(this.isFirstPerson ? 0 : aim ? 0.42 : 0.52, this.isFirstPerson ? 0 : 0.12,
      this.isFirstPerson ? 0 : aim ? 1.5 : this.tpDistance);
    this._offset.lerp(this._target, blend);
    this.camera.position.copy(this._offset);
    this.yawObject.updateMatrixWorld(true);

    // Sweep the camera's near-plane corners, not just its centre, around cover.
    if (this._offset.lengthSq() > 0.01) {
      this.pitchObject.getWorldPosition(this._origin);
      this.camera.getWorldPosition(this._end);
      this._direction.subVectors(this._end, this._origin);
      const distance = this._direction.length();
      this._direction.normalize();
      this._right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this._up.setFromMatrixColumn(this.camera.matrixWorld, 1);
      let allowed = distance;
      this._ray.far = distance + 0.18;
      for (const [x, y] of this._corners) {
        this._rayOrigin.copy(this._origin).addScaledVector(this._right, x).addScaledVector(this._up, y);
        this._ray.set(this._rayOrigin, this._direction);
        this._hits.length = 0;
        this._ray.intersectObjects(this.occluders, false, this._hits);
        if (this._hits.length) allowed = Math.min(allowed, Math.max(0, this._hits[0].distance - 0.18));
      }
      this.camera.position.multiplyScalar(allowed / distance);
    }
    this.isBodyOccluded = !this.isFirstPerson && this.camera.position.length() < 0.65;

    const moving = state.moving && state.grounded;
    this._phase += dt * (state.sprinting ? 12 : 8);
    const bobTarget = moving && this.motionEnabled ? (state.sprinting ? 0.025 : 0.012) * (aim ? 0.3 : 1) : 0;
    this._bob += (bobTarget - this._bob) * blend;
    if (this.isFirstPerson) {
      this.camera.position.y += Math.sin(this._phase * 2) * this._bob;
      this.camera.position.x += Math.cos(this._phase) * this._bob * 0.5;
    }
    this._recoil *= Math.exp(-18 * dt);
    this.camera.rotation.x = this._recoil;
    this.camera.rotation.z = this.motionEnabled && this.isFirstPerson ? Math.sin(this._phase) * this._bob * 0.12 : 0;
    if (this.motionEnabled) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.25;
    }
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.5);
    const fov = aim ? 56 : state.sprinting && this.motionEnabled ? 80 : 74;
    this.camera.fov += (fov - this.camera.fov) * blend;
    this.camera.updateProjectionMatrix();
    this.yawObject.updateMatrixWorld(true);
  }

  recoil() {
    if (this.motionEnabled) this._recoil = 0.022;
  }

  shake(intensity = 0.3) {
    this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(intensity, 0.7));
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
  }
}
