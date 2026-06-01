import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

/**
 * Loads a `.vrm` avatar and adds it to the scene, applying the @pixiv/three-vrm
 * v3 optimization passes and the VRM0 facing-direction fix.
 *
 * Works for both VRM 0.x and VRM 1.0 models; the library normalizes VRM0's
 * A/I/U/E/O blendshapes onto the 1.0 `aa/ih/ou/ee/oh` expression presets, so the
 * lip-sync code keyed on `aa` works for either.
 */
export async function loadVrm(url: string, scene: THREE.Scene): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error("loaded glTF has no VRM extension");
  }

  // v3 perf passes (removeUnnecessaryVertices + combineSkeletons replace the
  // deprecated removeUnnecessaryJoints).
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.combineMorphs(vrm);

  // Expression / springbone-deformed meshes must not be frustum-culled.
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });

  scene.add(vrm.scene);

  // VRM0.0 faces away from the camera; rotate 180°. No-op for VRM1.0.
  VRMUtils.rotateVRM0(vrm);

  // VRMs load in a T-pose; relax into a natural standing pose by default.
  setRelaxedPose(vrm);

  return vrm;
}

/**
 * Lowers the arms from the default T-pose into a relaxed "standing still" pose.
 *
 * Operates on the normalized humanoid bones (consistent for VRM0 and VRM1), so
 * `vrm.update()` / `humanoid.update()` propagates it to the rendered mesh and it
 * persists every frame.
 */
export function setRelaxedPose(vrm: VRM): void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const ARM_DOWN = THREE.MathUtils.degToRad(72); // T-pose -> arms near the sides
  const ELBOW = THREE.MathUtils.degToRad(8); // tiny inward bend so hands aren't rigid

  const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
  const leftLowerArm = humanoid.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = humanoid.getNormalizedBoneNode("rightLowerArm");

  if (leftUpperArm) leftUpperArm.rotation.z = -ARM_DOWN;
  if (rightUpperArm) rightUpperArm.rotation.z = ARM_DOWN;
  if (leftLowerArm) leftLowerArm.rotation.z = -ELBOW;
  if (rightLowerArm) rightLowerArm.rotation.z = ELBOW;

  humanoid.update();
}
