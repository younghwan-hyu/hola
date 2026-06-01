import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRMUtils, type VRM } from "@pixiv/three-vrm";

import { loadVrm } from "@/lib/vrm";

export type AvatarStatus = "loading" | "ready" | "error";

export type AvatarGesture = "happy" | "sad" | "wave";

export interface AvatarHandle {
  /** Trigger a one-shot gesture (facial expression or wave). */
  playGesture: (gesture: AvatarGesture) => void;
}

interface Props {
  /** URL of the .vrm model (default avatar lives at /avatar.vrm). */
  avatarUrl: string;
  /**
   * Returns the current audible loudness (RMS, ~0..0.3) of the TTS playback.
   * Read every frame to drive the mouth. Returns 0 when silent.
   */
  getMouthLevel: () => number;
  onStatus?: (status: AvatarStatus, message?: string) => void;
}

// Lip sync. Rather than mapping the exact RMS to a vowel shape (which looks off
// for non-English speech), we just detect that audio is playing and flap the
// mouth open/closed continuously while it is — the jaw ("aa") opens and closes
// the whole time the avatar is talking.
const MOUTH_SPEAK_FLOOR = 0.012; // RMS above this counts as "talking"
const MOUTH_HOLD = 0.18; // seconds to keep flapping across brief gaps between syllables
const MOUTH_FLAP_A = 26; // primary flap rate (rad/s, ~4 Hz)
const MOUTH_FLAP_B = 16.5; // detuned second oscillator so the flap isn't robotic
const MOUTH_MIN = 0.1; // openness floor while talking (mouth never fully shuts mid-speech)
const MOUTH_MAX = 0.85; // openness ceiling
const MOUTH_ATTACK = 0.55; // smoothing toward a more-open target
const MOUTH_DECAY = 0.4; // smoothing toward a more-closed target

const BLINK_DURATION = 0.12; // seconds for a full close+open
const VOWELS = ["ih", "ou", "ee", "oh"] as const;

// Gesture timing.
const EXPR_DURATION = 2.6; // happy / sad hold + fades
const WAVE_DURATION = 1.6; // shorter, snappier wave

// Right-arm rest rotations — must match setRelaxedPose() in lib/vrm.ts.
const REST_UPPER_Z = THREE.MathUtils.degToRad(72);
const REST_LOWER_Z = THREE.MathUtils.degToRad(8);
// Raised "waving" pose for the right arm (radians). Everything is kept in the
// FRONTAL plane (rotations about the bone z axis) so the arm never folds forward
// or backward: the upper arm lifts out to the side and the elbow bends so the
// forearm points up, with the hand up beside the head.
const WAVE_UPPER_Z = -0.4; // upper arm out to the side, a bit above horizontal
const WAVE_LOWER_Z = -1.3; // bend the elbow so the forearm points up
// The hand waves side-to-side by rocking the forearm about the world forward
// axis (toward the camera) — a clean horizontal sweep that stays in the frontal
// plane regardless of the bone's local frame.
const WAVE_SWING = 0.28; // sweep amplitude (radians)
const WAVE_SPEED = 10; // sweeps per second-ish
const WAVE_AXIS = new THREE.Vector3(0, 0, 1); // world forward (toward camera)
// Twist about the world-up axis so the palm (not the back of the hand) faces the
// camera, thumb toward the head. The total (~2.0 rad) is SPLIT between the
// forearm and the wrist so the elbow doesn't visibly twist (VRM forearms have no
// twist bone, so a single big forearm twist pinches the elbow).
const WAVE_PALM_FOREARM = 1.0;
const WAVE_PALM_HAND = 1.0;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Tip the whole raised arm slightly forward (toward the camera) so in profile it
// sits just in front of the head instead of behind. Applied about the axis
// perpendicular to the arm so it does not roll/twist the arm.
const WAVE_FORWARD = 0.3;

/** Trapezoid envelope: ramp up, hold at 1, ramp down. */
function envelope(t: number, dur: number, rise: number, fall: number): number {
  if (t <= 0) return 0;
  if (t < rise) return t / rise;
  if (t > dur - fall) return Math.max(0, (dur - t) / fall);
  return 1;
}

export const Avatar = forwardRef<AvatarHandle, Props>(function Avatar(
  { avatarUrl, getMouthLevel, onStatus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without restarting the render loop.
  const levelRef = useRef(getMouthLevel);
  levelRef.current = getMouthLevel;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  // Active gesture, read every frame by the render loop.
  const gestureRef = useRef<{ type: AvatarGesture; t: number } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      playGesture(gesture) {
        gestureRef.current = { type: gesture, t: 0 };
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let rafId = 0;
    let vrm: VRM | null = null;
    let rightUpperArm: THREE.Object3D | null = null;
    let rightLowerArm: THREE.Object3D | null = null;
    let rightHand: THREE.Object3D | null = null;

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
    camera.position.set(0, 1.45, 1.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 0.8;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.95;
    controls.target.set(0, 1.3, 0);
    controls.update();

    // Lighting: a soft three-point-ish setup.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 1.6, 1.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-1.2, 1.2, -1);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.0));

    const clock = new THREE.Clock();
    let mouth = 0;
    let speakHold = 0; // seconds of "still talking" remaining (bridges syllable gaps)
    let baseRotationY = 0;
    let nextBlinkAt = 1.5;
    let blinkT = -1; // -1 = not currently blinking
    let reportedReady = false;
    const tmpQuat = new THREE.Quaternion();
    const tmpAxis = new THREE.Vector3();
    const vShoulder = new THREE.Vector3();
    const vElbow = new THREE.Vector3();
    const vArmDir = new THREE.Vector3();

    statusRef.current?.("loading");

    loadVrm(avatarUrl, scene)
      .then((loaded) => {
        if (disposed) {
          VRMUtils.deepDispose(loaded.scene);
          return;
        }
        vrm = loaded;
        baseRotationY = loaded.scene.rotation.y;
        rightUpperArm =
          loaded.humanoid?.getNormalizedBoneNode("rightUpperArm") ?? null;
        rightLowerArm =
          loaded.humanoid?.getNormalizedBoneNode("rightLowerArm") ?? null;
        rightHand =
          loaded.humanoid?.getNormalizedBoneNode("rightHand") ?? null;

        // Make the avatar follow the camera with its gaze.
        if (loaded.lookAt) loaded.lookAt.target = camera;

        // Frame the upper body with headroom: raise the whole camera rig so the
        // avatar sits lower in frame, leaving empty space above the head.
        const head = loaded.humanoid?.getNormalizedBoneNode("head");
        if (head) {
          const headPos = new THREE.Vector3();
          head.getWorldPosition(headPos);
          camera.position.set(headPos.x, headPos.y + 0.05, headPos.z + 1.8);
          controls.target.set(headPos.x, headPos.y - 0.1, headPos.z);
          controls.update();
        }
        // "ready" is reported from the render loop on the first painted frame
        // (see renderLoop) so the overlay clears exactly when the avatar shows.
      })
      .catch((err) => {
        console.error("VRM load failed", err);
        if (!disposed) {
          statusRef.current?.(
            "error",
            err instanceof Error ? err.message : "아바타를 불러오지 못했습니다",
          );
        }
      });

    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);
      const delta = clock.getDelta();
      const t = clock.elapsedTime;

      if (vrm) {
        // --- Advance the active gesture ---
        let happy = 0;
        let sad = 0;
        let waveAmt = 0;
        let waveSwing = 0;
        const g = gestureRef.current;
        if (g) {
          g.t += delta;
          if (g.type === "happy") {
            happy = envelope(g.t, EXPR_DURATION, 0.25, 0.6);
          } else if (g.type === "sad") {
            sad = envelope(g.t, EXPR_DURATION, 0.25, 0.6);
          } else if (g.type === "wave") {
            waveAmt = envelope(g.t, WAVE_DURATION, 0.4, 0.4);
            waveSwing = Math.sin(g.t * WAVE_SPEED) * WAVE_SWING * waveAmt;
          }
          const dur = g.type === "wave" ? WAVE_DURATION : EXPR_DURATION;
          if (g.t >= dur) gestureRef.current = null;
        }

        const em = vrm.expressionManager;
        if (em) {
          // --- Lip sync: flap the mouth while audio is playing ---
          const level = levelRef.current();
          if (level > MOUTH_SPEAK_FLOOR) speakHold = MOUTH_HOLD;
          else speakHold = Math.max(0, speakHold - delta);

          let target = 0;
          if (speakHold > 0) {
            // Two detuned oscillators -> a lively, non-robotic open/close.
            const flap =
              0.5 +
              0.34 * Math.sin(t * MOUTH_FLAP_A) +
              0.16 * Math.sin(t * MOUTH_FLAP_B);
            const f = Math.max(0, Math.min(1, flap));
            target = MOUTH_MIN + (MOUTH_MAX - MOUTH_MIN) * f;
          }
          const k = target > mouth ? MOUTH_ATTACK : MOUTH_DECAY;
          mouth += (target - mouth) * k;
          em.setValue("aa", mouth);
          for (const v of VOWELS) em.setValue(v, 0);

          // --- Blink ---
          let blink = 0;
          if (blinkT >= 0) {
            blinkT += delta;
            const half = BLINK_DURATION / 2;
            blink =
              blinkT < half ? blinkT / half : 1 - (blinkT - half) / half;
            blink = Math.max(0, Math.min(1, blink));
            if (blinkT >= BLINK_DURATION) {
              blinkT = -1;
              nextBlinkAt = t + 2 + Math.random() * 4;
            }
          } else if (t >= nextBlinkAt) {
            blinkT = 0;
          }
          em.setValue("blink", blink);

          // --- Gesture expressions ---
          em.setValue("happy", happy);
          em.setValue("sad", sad);
        }

        // --- Right arm: rest by default, wave overrides it ---
        if (rightUpperArm && rightLowerArm) {
          rightUpperArm.rotation.set(
            0,
            0,
            REST_UPPER_Z + (WAVE_UPPER_Z - REST_UPPER_Z) * waveAmt,
          );
          rightLowerArm.rotation.set(
            0,
            0,
            REST_LOWER_Z + (WAVE_LOWER_Z - REST_LOWER_Z) * waveAmt,
          );
          if (rightHand) rightHand.rotation.set(0, 0, 0);
          // Orient the arm in world space. The palm-forward twist is split
          // between the forearm and the wrist (so the elbow doesn't pinch), and
          // the side-to-side rock is about the world forward axis. Each step
          // converts the world axis into the bone's current local frame so it is
          // independent of the bone's rest orientation.
          if (waveAmt > 0) {
            // Tip the whole arm slightly forward (toward the camera) at the
            // shoulder so it sits just in front of the head in profile. Rotate
            // about the axis perpendicular to the arm (armDir × forward) so the
            // arm tips WITHOUT rolling/twisting along its length.
            rightUpperArm.updateWorldMatrix(true, false);
            rightLowerArm.updateWorldMatrix(true, false);
            rightUpperArm.getWorldPosition(vShoulder);
            rightLowerArm.getWorldPosition(vElbow);
            vArmDir.subVectors(vElbow, vShoulder).normalize();
            tmpAxis.crossVectors(vArmDir, WAVE_AXIS).normalize();
            rightUpperArm.getWorldQuaternion(tmpQuat).invert();
            tmpAxis.applyQuaternion(tmpQuat).normalize();
            rightUpperArm.rotateOnAxis(tmpAxis, WAVE_FORWARD * waveAmt);

            rightLowerArm.updateWorldMatrix(true, false);
            rightLowerArm.getWorldQuaternion(tmpQuat).invert();
            tmpAxis.copy(WORLD_UP).applyQuaternion(tmpQuat).normalize();
            rightLowerArm.rotateOnAxis(tmpAxis, WAVE_PALM_FOREARM * waveAmt);

            rightLowerArm.updateWorldMatrix(true, false);
            rightLowerArm.getWorldQuaternion(tmpQuat).invert();
            tmpAxis.copy(WAVE_AXIS).applyQuaternion(tmpQuat).normalize();
            rightLowerArm.rotateOnAxis(tmpAxis, waveSwing);

            if (rightHand) {
              rightHand.updateWorldMatrix(true, false);
              rightHand.getWorldQuaternion(tmpQuat).invert();
              tmpAxis.copy(WORLD_UP).applyQuaternion(tmpQuat).normalize();
              rightHand.rotateOnAxis(tmpAxis, WAVE_PALM_HAND * waveAmt);
            }
          }
        }

        // --- Subtle idle sway ---
        vrm.scene.rotation.y = baseRotationY + Math.sin(t * 0.5) * 0.04;

        vrm.update(delta);

        // Report ready once the avatar has actually rendered a frame.
        if (!reportedReady) {
          reportedReady = true;
          statusRef.current?.("ready");
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    renderLoop();

    const onResize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [avatarUrl]);

  return <div ref={containerRef} className="h-full w-full" />;
});
