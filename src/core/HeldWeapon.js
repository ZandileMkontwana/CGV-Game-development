import * as THREE from 'three';
import { buildRifle } from './WeaponViewmodel.js';
import TwoBoneArm from './TwoBoneArm.js';

/** Third-person rifle with a two-handed grip and a world-space muzzle. */
export default class HeldWeapon {
  constructor(scene) {
    this.group = new THREE.Group();
    this.rifle = buildRifle(0.9);
    this.group.add(this.rifle);
    this.rifle.traverse(object => {
      if (object.isMesh) object.castShadow = object.receiveShadow = true;
    });
    this.muzzle = this.rifle.muzzle;
    this._rightGrip = new THREE.Vector3(0, -0.10, 0.17).multiplyScalar(0.9);
    this._leftGrip = new THREE.Vector3(-0.065, -0.015, -0.16).multiplyScalar(0.9);
    this._rightPole = new THREE.Vector3(0.65, -0.2, 0.35);
    this._leftPole = new THREE.Vector3(-0.55, -0.2, 0.2);
    this._grip = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._lookMatrix = new THREE.Matrix4();
    this._rightHandRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this._leftHandRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2));
    this._handRotation = new THREE.Quaternion();
    this._arms = new Map();
    this._kick = 0;
    const flashMaterial = new THREE.MeshBasicMaterial({ color: 0x8beaff, transparent: true, opacity: 0, depthWrite: false });
    this._flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), flashMaterial);
    this.muzzle.add(this._flash);
    this.group.visible = false;
    scene.add(this.group);
  }

  fire() {
    this._kick = 1;
    this._flash.material.opacity = 1;
  }

  update(dt, player, aimPoint) {
    const useOperator = player.operator.ready;
    const character = useOperator ? player.operator : player.character;
    if (!this._arms.has(character) && character.arms) {
      this._arms.set(character, {
        right: new TwoBoneArm(character.arms.right),
        left: new TwoBoneArm(character.arms.left),
      });
    }
    const crouchDrop = player._crouchBlend * (useOperator ? 0.43 : 0.32);
    const yaw = player.cameraPivot?.rotation.y || 0;
    this.group.position.set(player.position.x + Math.cos(yaw) * 0.22 - Math.sin(yaw) * 0.15,
      player.position.y - player.playerRadius + (useOperator ? 1.28 : 1.15) - crouchDrop,
      player.position.z - Math.sin(yaw) * 0.22 - Math.cos(yaw) * 0.15);
    this._lookMatrix.lookAt(this.group.position, aimPoint, this._up);
    this.group.quaternion.setFromRotationMatrix(this._lookMatrix);
    this._kick *= Math.exp(-18 * dt);
    this.group.translateZ(this._kick * 0.035);
    this._flash.material.opacity *= Math.exp(-35 * dt);
    this.group.updateWorldMatrix(true, true);
    const arms = this._arms.get(character);
    if (!arms) return;
    for (const side of ['right', 'left']) {
      this._grip.copy(side === 'right' ? this._rightGrip : this._leftGrip).applyMatrix4(this.group.matrixWorld);
      this._pole.copy(side === 'right' ? this._rightPole : this._leftPole).applyMatrix4(this.group.matrixWorld);
      this._handRotation.copy(this.group.quaternion).multiply(side === 'right' ? this._rightHandRotation : this._leftHandRotation);
      arms[side].solve(this._grip, this._pole, useOperator ? this._handRotation : null);
    }
  }
}
