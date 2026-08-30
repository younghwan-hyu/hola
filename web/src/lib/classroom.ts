import * as THREE from "three";

/**
 * A procedural university lecture room (한국 대학 강의실) for the avatar to stand
 * in — no external assets, just boxes, planes and a handful of canvas-drawn
 * textures: a whiteboard, a pulled-down projector screen
 * showing a slide, an electronic lectern, rows of long shared tables with
 * blue chairs, a tiled floor, a grid ceiling with fluorescent panels and a
 * projector, blinds on the windows, a door, a notice board and a wall AC.
 *
 * Frame of reference (see Avatar.tsx): the avatar stands at the origin, feet
 * at y=0, facing +z toward the camera. So the board wall is behind it at -z,
 * and the student tables sit in front of it at +z, either side of a clear
 * centre aisle so the camera can dolly straight out without passing through
 * furniture. The room is longer toward the camera than behind the avatar
 * because OrbitControls lets the camera back off to 6 m.
 *
 * Everything reacts to the scene's existing lights (key/rim/hemisphere), which
 * are tuned for the avatar, except surfaces that are light sources or face
 * away from every light (screen, lamps, ceiling), which are unlit. All large
 * surfaces are double-sided so the room still looks solid if the camera pokes
 * through a wall.
 */

const ROOM_W = 8; // x: -4 .. 4
const ROOM_H = 3.2;
// The board wall sits well back so the backdrop reads as distant even in the
// narrow 문서 조회 pane, where the default framing shows only ~2 m of wall
// width at this depth — (almost) the whole screen, not a slice of it.
const BACK_Z = -4.0; // board wall, behind the avatar
const FRONT_Z = 7.5; // wall behind the camera
const DEPTH = FRONT_Z - BACK_Z;
const CENTER_Z = (FRONT_Z + BACK_Z) / 2;

// Whiteboard across the front wall; the screen hangs over its middle.
const BOARD_W = 7.0;
const BOARD_H = 1.2;
const BOARD_BOTTOM = 0.95;
const SCREEN_W = 2.2; // a 100-inch 16:10 screen
const SCREEN_H = 1.375;
const SCREEN_BOTTOM = 0.95;

const KOREAN_FONT =
  "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

function plane(w: number, h: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

function makeCanvas(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [canvas, ctx];
}

/** Deterministic pseudo-random sequence so the room looks the same every load. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function canvasTexture(
  canvas: HTMLCanvasElement,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/** Vinyl floor tiles, 60 cm each (one canvas = 2 × 2 tiles = 1.2 m). */
function floorTexture(): THREE.Texture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.fillStyle = "#cdcbc4";
  ctx.fillRect(0, 0, size, size);
  const rnd = lcg(11);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.09)";
    ctx.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  ctx.strokeStyle = "#b5b3ac";
  ctx.lineWidth = 3;
  for (const p of [0, size / 2, size]) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  return canvasTexture(canvas, [ROOM_W / 1.2, DEPTH / 1.2]);
}

/** Suspended ceiling tiles, 60 cm grid. */
function ceilingTexture(): THREE.Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.fillStyle = "#e9e9e4";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#d0d0cb";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  return canvasTexture(canvas, [ROOM_W / 0.6, DEPTH / 0.6]);
}

/** Closed venetian blinds: light slats with a sliver of daylight between. */
function blindTexture(): THREE.Texture {
  const [canvas, ctx] = makeCanvas(64, 256);
  ctx.fillStyle = "#e6e8e5";
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    ctx.fillStyle = "#b9c7d3";
    ctx.fillRect(0, y, 64, 3);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, y + 3, 64, 2);
  }
  return canvasTexture(canvas, [1, 7]);
}

/**
 * The slide on the projector screen (16:10): the course's table of contents,
 * text only. Laid out in two columns with the middle left empty because the
 * avatar's head sits in front of the screen's centre in the default framing.
 */
function slideTexture(): THREE.Texture {
  const W = 2048;
  const H = 1280;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  // Header band
  ctx.fillStyle = "#1f3b73";
  ctx.fillRect(0, 0, W, 210);
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(0, 210, W, 10);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 88px ${KOREAN_FONT}`;
  ctx.fillText("운영체제", 100, 140);
  ctx.font = `50px ${KOREAN_FONT}`;
  ctx.fillText("Operating Systems", 520, 138);
  ctx.textAlign = "right";
  ctx.fillText("강의 목차", W - 100, 138);
  ctx.textAlign = "left";
  // Table of contents, two columns of five.
  const chapters = [
    "컴퓨터 시스템 개요",
    "운영체제 개요",
    "프로세스와 스레드",
    "CPU 스케줄링",
    "프로세스 동기화",
    "교착상태",
    "메모리 관리",
    "가상 메모리",
    "파일 시스템",
    "대용량 저장장치와 I/O",
  ];
  chapters.forEach((title, i) => {
    const col = i < 5 ? 0 : 1;
    const x = 130 + col * 1010;
    const y = 400 + (i % 5) * 150;
    ctx.fillStyle = "#1f3b73";
    ctx.font = `bold 60px ${KOREAN_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), x + 80, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1f2937";
    ctx.font = `60px ${KOREAN_FONT}`;
    ctx.fillText(title, x + 130, y);
  });
  // Footer
  ctx.fillStyle = "#d1d5db";
  ctx.fillRect(100, 1170, W - 200, 3);
  ctx.fillStyle = "#6b7280";
  ctx.font = `38px ${KOREAN_FONT}`;
  ctx.fillText("운영체제 · 강의 목차", 100, 1230);
  ctx.textAlign = "right";
  ctx.fillText("2 / 38", W - 100, 1230);
  ctx.textAlign = "left";
  return canvasTexture(canvas);
}

/** A clean whiteboard: white with the faint grey haze of past erasing. */
function whiteboardTexture(): THREE.Texture {
  const W = 2048;
  const H = 352;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.fillStyle = "#f6f6f3";
  ctx.fillRect(0, 0, W, H);
  const rnd = lcg(5);
  for (let i = 0; i < 30; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 60 + rnd() * 140;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(110,120,135,0.07)");
    g.addColorStop(1, "rgba(110,120,135,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return canvasTexture(canvas);
}

/** Soft dark disc for under the avatar's feet (the scene casts no shadows). */
function contactShadowTexture(): THREE.Texture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.05,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.55, "rgba(0,0,0,0.16)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createClassroom(): THREE.Group {
  const room = new THREE.Group();
  room.name = "classroom";

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf0efea,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture(),
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  // Unlit: the ceiling faces away from every light in the scene (the key and
  // hemisphere lights come from above), so a lit material renders it as the
  // hemisphere's dark ground colour. Real ceilings are lit by bounce anyway.
  const ceilingMat = new THREE.MeshBasicMaterial({
    map: ceilingTexture(),
    side: THREE.DoubleSide,
  });
  const kickMat = new THREE.MeshStandardMaterial({
    color: 0x8a8d90,
    roughness: 0.8,
  });
  const alumMat = new THREE.MeshStandardMaterial({
    color: 0xd4d6d8,
    roughness: 0.4,
    metalness: 0.6,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2f3237,
    roughness: 0.7,
  });
  const greyMat = new THREE.MeshStandardMaterial({
    color: 0x5a5e64,
    roughness: 0.6,
  });
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0xdcd6c6,
    roughness: 0.6,
  });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0xc4bdad,
    roughness: 0.7,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d42,
    roughness: 0.5,
    metalness: 0.4,
  });
  const chairMat = new THREE.MeshStandardMaterial({
    color: 0x4a5d7a,
    roughness: 0.9,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf7f7f4,
    roughness: 0.9,
  });
  const corkMat = new THREE.MeshStandardMaterial({
    color: 0xb98d5c,
    roughness: 1,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x6b6f75,
    roughness: 0.7,
  });
  const boardMat = new THREE.MeshStandardMaterial({
    map: whiteboardTexture(),
    roughness: 0.45,
  });
  // Unlit: light sources and lit-from-within surfaces.
  const screenMat = new THREE.MeshBasicMaterial({ map: slideTexture() });
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xd6e9ff });
  const blindMat = new THREE.MeshBasicMaterial({ map: blindTexture() });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfdfdf8 });
  const monitorMat = new THREE.MeshBasicMaterial({ color: 0xcfe3ff });

  // ── Shell ────────────────────────────────────────────────────────────────
  const floor = plane(ROOM_W, DEPTH, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, CENTER_Z);
  const ceiling = plane(ROOM_W, DEPTH, ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ROOM_H, CENTER_Z);
  const backWall = plane(ROOM_W, ROOM_H, wallMat);
  backWall.position.set(0, ROOM_H / 2, BACK_Z);
  const frontWall = plane(ROOM_W, ROOM_H, wallMat);
  frontWall.rotation.y = Math.PI;
  frontWall.position.set(0, ROOM_H / 2, FRONT_Z);
  const leftWall = plane(DEPTH, ROOM_H, wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, CENTER_Z);
  const rightWall = plane(DEPTH, ROOM_H, wallMat);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_W / 2, ROOM_H / 2, CENTER_Z);
  room.add(floor, ceiling, backWall, frontWall, leftWall, rightWall);

  // Kickboards along every wall.
  const KB = 0.1;
  const kbBack = box(ROOM_W, KB, 0.03, kickMat);
  kbBack.position.set(0, KB / 2, BACK_Z + 0.015);
  const kbFront = box(ROOM_W, KB, 0.03, kickMat);
  kbFront.position.set(0, KB / 2, FRONT_Z - 0.015);
  const kbLeft = box(0.03, KB, DEPTH, kickMat);
  kbLeft.position.set(-ROOM_W / 2 + 0.015, KB / 2, CENTER_Z);
  const kbRight = box(0.03, KB, DEPTH, kickMat);
  kbRight.position.set(ROOM_W / 2 - 0.015, KB / 2, CENTER_Z);
  room.add(kbBack, kbFront, kbLeft, kbRight);

  // ── Front wall: whiteboard, projector screen, clock, speakers ────────────
  const boardY = BOARD_BOTTOM + BOARD_H / 2;
  const board = plane(BOARD_W, BOARD_H, boardMat);
  board.position.set(0, boardY, BACK_Z + 0.03);
  const F = 0.03; // aluminium frame width
  const frameZ = BACK_Z + 0.035;
  const frameTop = box(BOARD_W + 2 * F, F, 0.03, alumMat);
  frameTop.position.set(0, boardY + BOARD_H / 2 + F / 2, frameZ);
  const frameBottom = box(BOARD_W + 2 * F, F, 0.03, alumMat);
  frameBottom.position.set(0, boardY - BOARD_H / 2 - F / 2, frameZ);
  const frameLeft = box(F, BOARD_H, 0.03, alumMat);
  frameLeft.position.set(-BOARD_W / 2 - F / 2, boardY, frameZ);
  const frameRight = box(F, BOARD_H, 0.03, alumMat);
  frameRight.position.set(BOARD_W / 2 + F / 2, boardY, frameZ);
  const trayY = boardY - BOARD_H / 2 - F - 0.015;
  const tray = box(BOARD_W * 0.96, 0.025, 0.07, alumMat);
  tray.position.set(0, trayY, BACK_Z + 0.055);
  room.add(board, frameTop, frameBottom, frameLeft, frameRight, tray);
  // Markers and an eraser on the tray.
  const markerColors = [0x1d4ed8, 0x1f2937, 0xdc2626];
  markerColors.forEach((color, i) => {
    const marker = box(
      0.12,
      0.018,
      0.018,
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    marker.position.set(-2.6 + i * 0.16, trayY + 0.022, BACK_Z + 0.06);
    room.add(marker);
  });
  const eraser = box(0.13, 0.04, 0.05, darkMat);
  eraser.position.set(2.5, trayY + 0.032, BACK_Z + 0.06);
  room.add(eraser);

  // Pulled-down screen in front of the board's middle, with its housing.
  const screenY = SCREEN_BOTTOM + SCREEN_H / 2;
  const housing = box(SCREEN_W + 0.2, 0.12, 0.12, whiteMat);
  housing.position.set(0, SCREEN_BOTTOM + SCREEN_H + 0.07, BACK_Z + 0.12);
  const screenBorder = plane(SCREEN_W + 0.06, SCREEN_H + 0.06, darkMat);
  screenBorder.position.set(0, screenY, BACK_Z + 0.095);
  const screen = plane(SCREEN_W, SCREEN_H, screenMat);
  screen.position.set(0, screenY, BACK_Z + 0.1);
  const weightBar = box(SCREEN_W + 0.06, 0.04, 0.03, darkMat);
  weightBar.position.set(0, SCREEN_BOTTOM - 0.03, BACK_Z + 0.1);
  room.add(housing, screenBorder, screen, weightBar);

  // Clock above the board's left half, speakers in the top corners.
  const clock = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.17, 40),
    new THREE.MeshBasicMaterial({ color: 0xf4f4ef }),
  );
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.19, 40), darkMat);
  rim.position.z = 0.001;
  const hand = (len: number, width: number, angle: number): THREE.Mesh => {
    const geom = new THREE.BoxGeometry(width, len, 0.004);
    geom.translate(0, len / 2, 0); // pivot at the centre of the face
    const m = new THREE.Mesh(geom, darkMat);
    m.position.z = 0.004;
    m.rotation.z = -angle; // clockwise from 12
    return m;
  };
  clock.add(
    face,
    rim,
    hand(0.1, 0.014, ((10 + 10 / 60) / 12) * Math.PI * 2),
    hand(0.14, 0.01, (10 / 60) * Math.PI * 2),
  );
  clock.position.set(-3.0, 2.72, BACK_Z + 0.02);
  room.add(clock);
  for (const x of [-3.55, 3.55]) {
    const speaker = box(0.22, 0.32, 0.2, darkMat);
    speaker.position.set(x, 2.85, BACK_Z + 0.12);
    room.add(speaker);
  }

  // ── Left wall (-x): door by the lectern, notice board, wall AC ───────────
  const DOOR_Z = BACK_Z + 1.2;
  const door = box(0.05, 2.1, 0.95, doorMat);
  door.position.set(-ROOM_W / 2 + 0.03, 1.05, DOOR_Z);
  const doorGlass = box(0.02, 0.6, 0.25, skyMat);
  doorGlass.position.set(-ROOM_W / 2 + 0.06, 1.55, DOOR_Z);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), alumMat);
  knob.position.set(-ROOM_W / 2 + 0.075, 1.0, DOOR_Z + 0.38);
  room.add(door, doorGlass, knob);
  const notice = box(0.03, 1.0, 1.4, corkMat);
  notice.position.set(-ROOM_W / 2 + 0.02, 1.6, 1.6);
  room.add(notice);
  const rnd = lcg(3);
  for (let i = 0; i < 5; i++) {
    const paper = box(0.01, 0.3, 0.21, whiteMat);
    paper.position.set(
      -ROOM_W / 2 + 0.04,
      1.6 + (rnd() - 0.5) * 0.5,
      1.6 + (rnd() - 0.5) * 1.0,
    );
    paper.rotation.x = (rnd() - 0.5) * 0.15;
    room.add(paper);
  }
  const ac = box(0.22, 0.3, 0.9, whiteMat);
  ac.position.set(-ROOM_W / 2 + 0.12, 2.6, 3.8);
  const acVent = box(0.01, 0.06, 0.8, greyMat);
  acVent.position.set(-ROOM_W / 2 + 0.235, 2.48, 3.8);
  room.add(ac, acVent);

  // ── Right wall (+x): windows with the blinds down ────────────────────────
  for (const z of [-2.6, -0.4, 1.8, 4.0, 6.2]) {
    const w = new THREE.Group();
    const frame = box(0.06, 1.55, 1.65, alumMat);
    const pane = box(0.02, 1.42, 1.52, skyMat);
    pane.position.x = -0.03;
    const blind = plane(1.5, 1.4, blindMat);
    blind.rotation.y = -Math.PI / 2;
    blind.position.set(-0.05, 0, 0);
    const sill = box(0.14, 0.04, 1.7, alumMat);
    sill.position.set(-0.04, -0.8, 0);
    w.add(frame, pane, blind, sill);
    w.position.set(ROOM_W / 2 - 0.03, 1.85, z);
    room.add(w);
  }

  // ── Electronic lectern at the front, off to the avatar's left ────────────
  const lectern = new THREE.Group();
  const body = box(0.7, 1.05, 0.6, darkMat);
  body.position.y = 0.525;
  const top = box(0.74, 0.03, 0.64, greyMat);
  top.position.y = 1.065;
  const monitor = box(0.46, 0.3, 0.02, darkMat);
  monitor.position.set(0, 1.25, -0.05);
  monitor.rotation.x = -0.35;
  const monitorScreen = plane(0.42, 0.26, monitorMat);
  monitorScreen.position.set(0, 1.25, -0.05 + 0.011);
  monitorScreen.rotation.x = -0.35;
  const micStand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.35, 8),
    frameMat,
  );
  micStand.position.set(0.22, 1.24, 0.1);
  micStand.rotation.z = -0.35;
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), darkMat);
  micHead.position.set(0.28, 1.41, 0.1);
  lectern.add(body, top, monitor, monitorScreen, micStand, micHead);
  lectern.position.set(1.6, 0, BACK_Z + 1.4);
  room.add(lectern);

  // ── Student seating: long shared tables, four rows, centre aisle clear ───
  const TABLE_W = 2.4;
  const tableProto = new THREE.Group();
  const tableTop = box(TABLE_W, 0.03, 0.55, tableMat);
  tableTop.position.y = 0.74;
  const modesty = box(TABLE_W, 0.4, 0.02, panelMat);
  modesty.position.set(0, 0.52, -0.26);
  tableProto.add(tableTop, modesty);
  for (const lx of [-TABLE_W / 2 + 0.03, TABLE_W / 2 - 0.03]) {
    const leg = box(0.04, 0.72, 0.5, frameMat);
    leg.position.set(lx, 0.36, 0);
    tableProto.add(leg);
  }
  // Chairs face the board (-z), so they sit at +z of the table.
  const chairLegGeom = new THREE.BoxGeometry(0.025, 0.45, 0.025);
  for (const cx of [-0.83, -0.28, 0.28, 0.83]) {
    const seat = box(0.42, 0.04, 0.42, chairMat);
    seat.position.set(cx, 0.45, 0.5);
    const backrest = box(0.42, 0.4, 0.03, chairMat);
    backrest.position.set(cx, 0.68, 0.7);
    tableProto.add(seat, backrest);
    for (const [lx, lz] of [
      [-0.18, 0.31],
      [0.18, 0.31],
      [-0.18, 0.69],
      [0.18, 0.69],
    ]) {
      const leg = new THREE.Mesh(chairLegGeom, frameMat);
      leg.position.set(cx + lx, 0.225, lz);
      tableProto.add(leg);
    }
  }
  for (const x of [-2.0, 2.0]) {
    for (const z of [2.3, 3.8, 5.3, 6.8]) {
      const table = tableProto.clone();
      table.position.set(x, 0, z);
      room.add(table);
    }
  }

  // ── Ceiling: fluorescent panels and the projector ────────────────────────
  for (const x of [-2, 2]) {
    for (const z of [-3, -1, 1, 3, 5, 7]) {
      const lamp = box(1.2, 0.04, 0.32, lampMat);
      lamp.position.set(x, ROOM_H - 0.02, z);
      room.add(lamp);
    }
  }
  const projector = new THREE.Group();
  const pole = box(0.03, 0.3, 0.03, greyMat);
  pole.position.y = 0.21;
  const projBody = box(0.42, 0.12, 0.32, darkMat);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16),
    greyMat,
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0.1, 0, -0.17);
  projector.add(pole, projBody, lens);
  projector.position.set(0, ROOM_H - 0.36, 1.0);
  room.add(projector);

  // ── Contact shadow under the avatar ──────────────────────────────────────
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  room.add(shadow);

  return room;
}
