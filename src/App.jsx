import { useEffect, useRef, useState } from "react";
import "@mediapipe/camera_utils/camera_utils.js";
import "@mediapipe/hands/hands.js";
import "@mediapipe/face_mesh/face_mesh.js";

const HandsCtor = globalThis.Hands;
const CameraCtor = globalThis.Camera;
const HAND_CONNECTIONS = globalThis.HAND_CONNECTIONS;
const FaceMeshCtor = globalThis.FaceMesh;
const FACEMESH_CONTOURS = globalThis.FACEMESH_CONTOURS;

const INDEX_FINGER_TIP = 8;

const MEDIAPIPE_HANDS_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/";
const MEDIAPIPE_FACE_MESH_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/";

const LOG_DEBOUNCE_MS = 750;

/**
 * Map normalized landmark (0–1) to canvas pixels (object-fit: contain box).
 */
function normalizedToCanvas(lm, videoWidth, videoHeight, cw, ch) {
  const vr = videoWidth / videoHeight;
  const cr = cw / ch;
  let sx;
  let sy;
  let sw;
  let sh;
  if (cr > vr) {
    sh = ch;
    sw = ch * vr;
    sx = (cw - sw) / 2;
    sy = 0;
  } else {
    sw = cw;
    sh = cw / vr;
    sx = 0;
    sy = (ch - sh) / 2;
  }
  return { x: sx + lm.x * sw, y: sy + lm.y * sh };
}

function canvasPointToClient(containerEl, canvasWidth, canvasHeight, x, y) {
  const rect = containerEl.getBoundingClientRect();
  return {
    clientX: rect.left + (x / canvasWidth) * rect.width,
    clientY: rect.top + (y / canvasHeight) * rect.height,
  };
}

function mirrorClientXInRect(rect, clientX) {
  return rect.left + rect.width - (clientX - rect.left);
}

/** Tip closer to wrist than PIP → finger curled (MediaPipe hand indices). */
function isFingerCurled(lm, tipIdx, pipIdx) {
  const w = lm[0];
  const dTip = Math.hypot(lm[tipIdx].x - w.x, lm[tipIdx].y - w.y);
  const dPip = Math.hypot(lm[pipIdx].x - w.x, lm[pipIdx].y - w.y);
  return dTip < dPip * 0.99;
}

/** Tip farther from wrist than PIP → finger extended. */
function isFingerExtended(lm, tipIdx, pipIdx) {
  const w = lm[0];
  const dTip = Math.hypot(lm[tipIdx].x - w.x, lm[tipIdx].y - w.y);
  const dPip = Math.hypot(lm[pipIdx].x - w.x, lm[pipIdx].y - w.y);
  return dTip > dPip * 1.03;
}

function handScale(lm) {
  const w = lm[0];
  const d = (i) => Math.hypot(lm[i].x - w.x, lm[i].y - w.y);
  return Math.max(0.055, d(5), d(9), d(17));
}

/**
 * Point: index extended; thumb, middle, ring, pinky curled.
 */
function isPointingPose(lm) {
  if (!lm || lm.length < 21) return false;
  if (!isFingerExtended(lm, 8, 6)) return false;
  if (!isFingerCurled(lm, 4, 3)) return false;
  if (!isFingerCurled(lm, 12, 10)) return false;
  if (!isFingerCurled(lm, 16, 14)) return false;
  if (!isFingerCurled(lm, 20, 18)) return false;
  const scale = handScale(lm);
  if (Math.hypot(lm[8].x - lm[0].x, lm[8].y - lm[0].y) < scale * 0.85) {
    return false;
  }
  return true;
}

/**
 * Thumb extended (tip past IP joint relative to wrist).
 */
function isThumbExtended(lm) {
  const w = lm[0];
  const d = (i) => Math.hypot(lm[i].x - w.x, lm[i].y - w.y);
  return d(4) > d(3) * 1.04 && d(4) > d(2) * 0.92;
}

/** Index, middle, ring, pinky all curled — palm clear for thumb gestures. */
function areNonThumbFingersCurled(lm) {
  return (
    isFingerCurled(lm, 8, 6) &&
    isFingerCurled(lm, 12, 10) &&
    isFingerCurled(lm, 16, 14) &&
    isFingerCurled(lm, 20, 18)
  );
}

/**
 * Thumbs up / down: only thumb extended; vertical tip vs MCP, scale-normalized.
 */
function isThumbsUpPose(lm) {
  if (!lm || lm.length < 21) return false;
  if (!areNonThumbFingersCurled(lm)) return false;
  if (!isThumbExtended(lm)) return false;
  const scale = handScale(lm);
  const dy = (lm[4].y - lm[2].y) / scale;
  return dy < -0.22;
}

function isThumbsDownPose(lm) {
  if (!lm || lm.length < 21) return false;
  if (!areNonThumbFingersCurled(lm)) return false;
  if (!isThumbExtended(lm)) return false;
  const scale = handScale(lm);
  const dy = (lm[4].y - lm[2].y) / scale;
  return dy > 0.22;
}

/**
 * Scale-invariant head pose proxies: divide by inter-eye distance so thresholds
 * work at different distances from the camera.
 */
function faceHeadMetricsNormalized(lm) {
  const nose = lm[1];
  const le = lm[33];
  const re = lm[263];
  const eyeMidX = (le.x + re.x) / 2;
  const eyeMidY = (le.y + re.y) / 2;
  const faceScale = Math.max(0.042, Math.hypot(re.x - le.x, re.y - le.y));
  // Nod "yes": nose moves down in image (y+) then back — track vs eyes.
  const pitchNorm = (nose.y - eyeMidY) / faceScale;
  // Shake "no": nose shifts horizontally vs eye midline.
  const yawNorm = (nose.x - eyeMidX) / faceScale;
  return { pitchNorm, yawNorm, faceScale };
}

export default function App() {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const buttonRef = useRef(null);
  const nameRef = useRef("User");
  const setClickCountRef = useRef(() => {});

  const [name, setName] = useState("User");
  const [handCount, setHandCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [pointerHud, setPointerHud] = useState(null);
  const [actions, setActions] = useState([]);
  const [clickCount, setClickCount] = useState(0);
  const [buttonHovered, setButtonHovered] = useState(false);

  nameRef.current = (name.trim() || "User");
  setClickCountRef.current = setClickCount;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!video || !canvas || !container) return undefined;

    let disposed = false;
    const ctx = canvas.getContext("2d");

    if (
      !HandsCtor ||
      !CameraCtor ||
      !HAND_CONNECTIONS ||
      !FaceMeshCtor ||
      !FACEMESH_CONTOURS
    ) {
      console.error("MediaPipe globals missing after loading scripts.");
      return undefined;
    }


    const latestHands = { r: null };
    const latestFace = { r: null };

    let lastLogAt = 0;
    let gestureActive = {
      thumbUp: false,
      thumbDown: false,
      point: false,
    };

    /** ---- Nod (yes): down-then-up on scale-normalized pitch ---- */
    let nodBaseline = null;
    let nodSmooth = null;
    let nodState = "idle";
    let nodArmedAt = 0;
    let nodPeak = 0;
    let nodRefBaseline = 0;
    let nodCooldownUntil = 0;

    const NOD_BASELINE_ALPHA = 0.045;
    const NOD_SMOOTH_ALPHA = 0.32;
    /** Start nod when pitch clearly exceeds resting baseline. */
    const NOD_TRIGGER_DELTA = 0.082;
    /** Complete when pitch falls this far from the peak (return phase). */
    const NOD_RETURN_FROM_PEAK = 0.058;
    /** Peak must be this far above the baseline snapshot (real nod amplitude). */
    const NOD_MIN_PEAK_ABOVE_REF = 0.048;
    const NOD_ARM_MAX_MS = 1200;
    const NOD_COOLDOWN_MS = 280;

    /** ---- Shake (no): oscillating yaw in a short window ---- */
    let yawSmooth = null;
    const shakeBuf = [];
    const SHAKE_WIN = 32;
    const SHAKE_SMOOTH = 0.38;
    const SHAKE_MIN_SPREAD = 0.068;
    const SHAKE_MIN_PATH = 0.14;
    const SHAKE_MIN_REVERSALS = 4;
    const SHAKE_MIN_STEP = 0.006;

    let nextActionId = 0;

    const pointerOverButtonRef = { current: false };
    let lastPointerOverButtonAt = 0;
    /** After index leaves the button, thumbs-up can still “click” briefly. */
    const HOVER_LATCH_MS = 550;

    /** Forward poke: index tip z (depth) moves toward camera while over button. */
    let pokeZSmooth = null;
    const pokeZBuffer = [];
    const POKE_Z_SMOOTH = 0.38;
    const POKE_BUFFER_MAX = 9;
    /**
     * Tip vs wrist z (MediaPipe depth). Forward poke: mean early − mean late
     * positive (tip moves closer / more negative z relative to wrist). If it
     * never fires, flip the comparison in code below.
     */
    const POKE_DEPTH_DELTA = 0.028;
    const FORWARD_POKE_COOLDOWN_MS = 520;
    let lastForwardPokeAt = 0;

    function pointingHandsOverButton(results) {
      const list = [];
      const btn = buttonRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!btn || !vw || !vh) return list;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const br = btn.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      for (const lm of results.multiHandLandmarks ?? []) {
        if (!isPointingPose(lm)) continue;
        const tipCanvas = normalizedToCanvas(lm[8], vw, vh, cw, ch);
        const raw = canvasPointToClient(
          container,
          cw,
          ch,
          tipCanvas.x,
          tipCanvas.y,
        );
        const cx = mirrorClientXInRect(cr, raw.clientX);
        const cy = raw.clientY;
        if (
          cx >= br.left &&
          cx <= br.right &&
          cy >= br.top &&
          cy <= br.bottom
        ) {
          list.push(lm);
        }
      }
      return list;
    }

    function updateButtonHoverFromHands(results) {
      const now = performance.now();
      const btn = buttonRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!btn || !vw || !vh) {
        pointerOverButtonRef.current = false;
        setButtonHovered((prev) => (prev ? false : prev));
        return;
      }
      const over = pointingHandsOverButton(results).length > 0;
      pointerOverButtonRef.current = over;
      if (over) lastPointerOverButtonAt = now;
      setButtonHovered((prev) => (prev === over ? prev : over));
    }

    function detectForwardPokeClick(results) {
      const overHands = pointingHandsOverButton(results);
      const lm = overHands[0];
      const now = performance.now();
      if (!lm) {
        pokeZSmooth = null;
        pokeZBuffer.length = 0;
        return;
      }
      const z = lm[INDEX_FINGER_TIP].z - lm[0].z;
      pokeZSmooth =
        pokeZSmooth === null
          ? z
          : POKE_Z_SMOOTH * z + (1 - POKE_Z_SMOOTH) * pokeZSmooth;
      pokeZBuffer.push(pokeZSmooth);
      if (pokeZBuffer.length > POKE_BUFFER_MAX) pokeZBuffer.shift();

      if (now - lastForwardPokeAt < FORWARD_POKE_COOLDOWN_MS) return;
      if (pokeZBuffer.length < 6) return;

      const head = pokeZBuffer.slice(0, 3);
      const tail = pokeZBuffer.slice(-3);
      const meanHead = head.reduce((a, b) => a + b, 0) / head.length;
      const meanTail = tail.reduce((a, b) => a + b, 0) / tail.length;
      if (meanHead - meanTail > POKE_DEPTH_DELTA) {
        tryGestureButtonClick();
        lastForwardPokeAt = now;
        pokeZBuffer.length = 0;
        pokeZSmooth = null;
      }
    }

    function tryGestureButtonClick() {
      const now = performance.now();
      const overNow = pointerOverButtonRef.current;
      const latched =
        overNow || now - lastPointerOverButtonAt < HOVER_LATCH_MS;
      if (!latched) return;
      setClickCountRef.current((c) => c + 1);
    }

    function canLog(now) {
      return now - lastLogAt >= LOG_DEBOUNCE_MS;
    }

    function appendLog(kind) {
      const now = performance.now();
      if (!canLog(now)) return;
      lastLogAt = now;
      const n = nameRef.current || "User";
      let line;
      if (kind === "point") line = `${n} pointed`;
      else if (kind === "thumbUp") line = `${n} thumbs up`;
      else if (kind === "thumbDown") line = `${n} thumbs down`;
      else if (kind === "nod") line = `${n} nodded`;
      else line = `${n} shook head`;
      nextActionId += 1;
      setActions((prev) =>
        [{ id: nextActionId, text: line }, ...prev].slice(0, 200),
      );
    }

    function detectHandGestures(multiLandmarks) {
      const primary = multiLandmarks?.[0];
      if (!primary) {
        gestureActive = { thumbUp: false, thumbDown: false, point: false };
        return;
      }
      const thumbUp = isThumbsUpPose(primary);
      const thumbDown = isThumbsDownPose(primary);
      const point =
        !thumbUp && !thumbDown && isPointingPose(primary);

      if (thumbUp && !gestureActive.thumbUp) {
        appendLog("thumbUp");
        tryGestureButtonClick();
      } else if (thumbDown && !gestureActive.thumbDown) {
        appendLog("thumbDown");
      } else if (point && !gestureActive.point) appendLog("point");

      gestureActive = { thumbUp, thumbDown, point };
    }

    function resetShakeState() {
      shakeBuf.length = 0;
      yawSmooth = null;
    }

    function detectNodShake(faceLm) {
      if (!faceLm || faceLm.length < 264) return;
      const now = performance.now();
      const { pitchNorm, yawNorm } = faceHeadMetricsNormalized(faceLm);

      nodSmooth =
        nodSmooth === null
          ? pitchNorm
          : NOD_SMOOTH_ALPHA * pitchNorm +
            (1 - NOD_SMOOTH_ALPHA) * nodSmooth;

      if (nodState === "idle") {
        nodBaseline =
          nodBaseline === null
            ? pitchNorm
            : NOD_BASELINE_ALPHA * pitchNorm +
              (1 - NOD_BASELINE_ALPHA) * nodBaseline;

        if (
          now >= nodCooldownUntil &&
          nodSmooth > nodBaseline + NOD_TRIGGER_DELTA
        ) {
          nodState = "armed";
          nodArmedAt = now;
          nodRefBaseline = nodBaseline;
          nodPeak = nodSmooth;
        }
      } else if (nodState === "armed") {
        if (nodSmooth > nodPeak) nodPeak = nodSmooth;

        if (now - nodArmedAt > NOD_ARM_MAX_MS) {
          nodState = "idle";
          nodCooldownUntil = now + NOD_COOLDOWN_MS;
        } else if (
          nodPeak > nodRefBaseline + NOD_MIN_PEAK_ABOVE_REF &&
          nodPeak - nodSmooth > NOD_RETURN_FROM_PEAK
        ) {
          appendLog("nod");
          tryGestureButtonClick();
          nodState = "idle";
          nodCooldownUntil = now + NOD_COOLDOWN_MS;
          nodBaseline =
            nodBaseline === null
              ? pitchNorm
              : 0.55 * nodBaseline + 0.45 * pitchNorm;
          resetShakeState();
        }
      }

      yawSmooth =
        yawSmooth === null
          ? yawNorm
          : SHAKE_SMOOTH * yawNorm + (1 - SHAKE_SMOOTH) * yawSmooth;

      shakeBuf.push(yawSmooth);
      if (shakeBuf.length > SHAKE_WIN) shakeBuf.shift();

      if (shakeBuf.length < SHAKE_WIN || nodState === "armed") return;

      const mean =
        shakeBuf.reduce((s, v) => s + v, 0) / shakeBuf.length;
      const centered = shakeBuf.map((v) => v - mean);
      const spread = Math.max(...centered) - Math.min(...centered);
      if (spread < SHAKE_MIN_SPREAD) return;

      let path = 0;
      for (let i = 1; i < centered.length; i++) {
        path += Math.abs(centered[i] - centered[i - 1]);
      }
      if (path < SHAKE_MIN_PATH) return;

      let reversals = 0;
      for (let i = 2; i < centered.length; i++) {
        const d0 = centered[i - 1] - centered[i - 2];
        const d1 = centered[i] - centered[i - 1];
        if (
          d0 * d1 < 0 &&
          Math.abs(d0) > SHAKE_MIN_STEP &&
          Math.abs(d1) > SHAKE_MIN_STEP
        ) {
          reversals += 1;
        }
      }

      if (reversals >= SHAKE_MIN_REVERSALS) {
        appendLog("shake");
        resetShakeState();
        nodState = "idle";
        nodCooldownUntil = now + NOD_COOLDOWN_MS;
      }
    }

    function paint() {
      if (disposed) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;

      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      ctx.clearRect(0, 0, cw, ch);

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      const faceLm = latestFace.r;
      if (faceLm) {
        ctx.strokeStyle = "rgba(45, 212, 191, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b] of FACEMESH_CONTOURS) {
          const A = normalizedToCanvas(faceLm[a], vw, vh, cw, ch);
          const B = normalizedToCanvas(faceLm[b], vw, vh, cw, ch);
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
        }
        ctx.stroke();
      }

      const handsRes = latestHands.r;
      const landmarksList = handsRes?.multiHandLandmarks ?? [];
      for (let h = 0; h < landmarksList.length; h++) {
        const landmarks = landmarksList[h];
        ctx.strokeStyle = "rgba(192, 132, 252, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          const A = normalizedToCanvas(landmarks[a], vw, vh, cw, ch);
          const B = normalizedToCanvas(landmarks[b], vw, vh, cw, ch);
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
        }
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        for (const lm of landmarks) {
          const p = normalizedToCanvas(lm, vw, vh, cw, ch);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }

        const tipLm = landmarks[INDEX_FINGER_TIP];
        const tip = normalizedToCanvas(tipLm, vw, vh, cw, ch);
        ctx.strokeStyle = "#f0abfc";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 10, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.fillStyle = "rgba(240, 171, 252, 0.35)";
        ctx.fill();
      }
    }

    const hands = new HandsCtor({
      locateFile: (file) => `${MEDIAPIPE_HANDS_BASE}${file}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });

    hands.onResults((results) => {
      if (disposed) return;
      latestHands.r = results;
      setHandCount(results.multiHandLandmarks?.length ?? 0);

      updateButtonHoverFromHands(results);
      detectForwardPokeClick(results);
      detectHandGestures(results.multiHandLandmarks);

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const primary = results.multiHandLandmarks?.[0];
      if (!primary || !vw || !vh) {
        setPointerHud(null);
        pointerOverButtonRef.current = false;
        setButtonHovered((prev) => (prev ? false : prev));
      } else {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const tipCanvas = normalizedToCanvas(
          primary[INDEX_FINGER_TIP],
          vw,
          vh,
          cw,
          ch,
        );
        const raw = canvasPointToClient(
          container,
          cw,
          ch,
          tipCanvas.x,
          tipCanvas.y,
        );
        const rect = container.getBoundingClientRect();
        setPointerHud({
          clientX: Math.round(mirrorClientXInRect(rect, raw.clientX)),
          clientY: Math.round(raw.clientY),
          handedness: results.multiHandedness?.[0]?.label ?? "—",
        });
      }

      paint();
    });

    const faceMesh = new FaceMeshCtor({
      locateFile: (file) => `${MEDIAPIPE_FACE_MESH_BASE}${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results) => {
      if (disposed) return;
      const fl = results.multiFaceLandmarks?.[0] ?? null;
      latestFace.r = fl;
      setFaceCount(results.multiFaceLandmarks?.length ?? 0);
      if (fl) detectNodShake(fl);
      paint();
    });

    const camera = new CameraCtor(video, {
      onFrame: async () => {
        if (disposed) return;
        await hands.send({ image: video });
        await faceMesh.send({ image: video });
      },
      width: 1280,
      height: 720,
      facingMode: "user",
    });

    camera.start().catch((err) => {
      console.error("Camera error:", err);
    });

    return () => {
      disposed = true;
      camera.stop();
      hands.close();
      faceMesh.close();
    };
  }, []);

  return (
    <div className="hand-test">
      <h1>Hand &amp; face gestures</h1>

      <p className="hand-test__lede">
        Mirrored camera, MediaPipe Hands + Face Mesh. Center button: point to
        hover; nod, thumbs up, or push index forward (depth) to click (+1). Mouse
        too. Action log below.
      </p>

      <div className="hand-test__camera-card">
        <div className="hand-test__stage-header">
          <label className="hand-test__name-label" htmlFor="user-name">
            Name
          </label>
          <input
            id="user-name"
            className="hand-test__name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="User"
            autoComplete="name"
            maxLength={48}
          />
        </div>

        <div
          ref={containerRef}
          className="hand-test__stage"
          aria-label="Camera, face mesh, and hand overlay"
        >
          <div className="hand-test__mirror">
            <video
              ref={videoRef}
              className="hand-test__video"
              autoPlay
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="hand-test__canvas"
              aria-hidden
            />
          </div>
          <div className="hand-test__stage-ui">
            <button
              type="button"
              ref={buttonRef}
              className={
                buttonHovered
                  ? "hand-test__click-btn hand-test__click-btn--hover"
                  : "hand-test__click-btn"
              }
              onClick={() => setClickCount((c) => c + 1)}
            >
              click me ({clickCount})
            </button>
          </div>
        </div>
      </div>

      <div className="hand-test__hud">
        <span>Hands: {handCount}</span>
        <span>Face: {faceCount}</span>
        {pointerHud ? (
          <span>
            Pointer ({pointerHud.handedness}):{" "}
            <code>
              {pointerHud.clientX}, {pointerHud.clientY}
            </code>
          </span>
        ) : (
          <span>Show a hand for index tip</span>
        )}
      </div>

      <section className="hand-test__actions-section" aria-label="Action log">
        <h2 className="hand-test__actions-title">
          Actions
          <span className="hand-test__actions-count">
            {actions.length} recorded
          </span>
        </h2>
        <ul className="hand-test__actions">
          {actions.length === 0 ? (
            <li className="hand-test__actions-empty">No actions yet.</li>
          ) : (
            actions.map((entry) => (
              <li key={entry.id} className="hand-test__actions-item">
                <span
                  className="hand-test__actions-num"
                  title="Running count (newest = highest)"
                >
                  {entry.id}
                </span>
                <span className="hand-test__actions-text">{entry.text}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
