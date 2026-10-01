(() => {
"use strict";

/* =========================================================
   PB EDITOR v3.0 — EDITOR REBUILD
========================================================= */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

const DB_NAME = "PBEditorV3";
const STORE = "media";
const PROJECT_KEY = "pb-editor-v3-projects";

let projects = [];
let projectId = null;

let S = freshState();

let mediaURLs = new Map();
let canvasNodes = new Map();

let timelineZoom = 1;
let timelineBusy = false;
let playingRAF = 0;
let lastFrame = 0;

let pointers = new Map();
let canvasGesture = null;
let timelineGesture = null;

let pendingSheetApply = null;
let textBackup = null;

function freshState() {
  return {
    duration: 10,
    time: 0,
    aspect: "9:16",
    background: "#111111",
    items: [],
    selected: null,
    playing: false,
    undo: [],
    redo: []
  };
}

/* =========================================================
   HELPERS
========================================================= */

function selectedItem() {
  return S.items.find(x => x.id === S.selected) || null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function formatTime(v) {
  v = Math.max(0, Number(v) || 0);

  const m = Math.floor(v / 60);
  const s = v % 60;

  return (
    String(m).padStart(2, "0") +
    ":" +
    s.toFixed(2).padStart(5, "0")
  );
}

function toast(message) {
  const e = $("#toast");

  e.textContent = message;
  e.style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    e.style.display = "none";
  }, 1400);
}

function showScreen(name) {
  $("#homeScreen").classList.toggle("active", name === "home");
  $("#editorScreen").classList.toggle("active", name === "editor");
}

/* =========================================================
   INDEXED DB
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(id, blob) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBlob(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBlob(id) {
  const db = await openDB();

  return new Promise(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
  });
}

async function getMediaURL(it) {
  if (!it.mediaId) return "";

  if (mediaURLs.has(it.mediaId)) {
    return mediaURLs.get(it.mediaId);
  }

  const blob = await loadBlob(it.mediaId);

  if (!blob) return "";

  const url = URL.createObjectURL(blob);

  mediaURLs.set(it.mediaId, url);

  return url;
}

function releaseMediaURLs() {
  for (const url of mediaURLs.values()) {
    URL.revokeObjectURL(url);
  }

  mediaURLs.clear();
}

/* =========================================================
   PROJECT STORAGE
========================================================= */

function loadProjectList() {
  try {
    projects = JSON.parse(localStorage.getItem(PROJECT_KEY)) || [];
  } catch {
    projects = [];
  }

  renderHome();
}

function persistProjects() {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(projects));
}

function currentProject() {
  return projects.find(x => x.id === projectId);
}

function createProject() {
  const p = {
    id: uid(),
    name: "新しいプロジェクト",
    created: Date.now(),
    updated: Date.now(),
    duration: 10,
    aspect: "9:16",
    background: "#111111",
    items: []
  };

  projects.unshift(p);
  persistProjects();

  return p;
}

function saveProject() {
  const p = currentProject();

  if (!p) return;

  p.name = $("#projectName").value.trim() || "名称未設定";
  p.updated = Date.now();

  p.duration = S.duration;
  p.aspect = S.aspect;
  p.background = S.background;
  p.items = structuredClone(S.items);

  persistProjects();

  $("#saveStatus").textContent = "保存済み";
}

/* =========================================================
   HISTORY
========================================================= */

function stateSnapshot() {
  return structuredClone({
    duration: S.duration,
    aspect: S.aspect,
    background: S.background,
    items: S.items
  });
}

function pushHistory() {
  S.undo.push(stateSnapshot());

  if (S.undo.length > 50) {
    S.undo.shift();
  }

  S.redo.length = 0;

  $("#saveStatus").textContent = "編集中";
}

function restoreSnapshot(snapshot) {
  S.duration = snapshot.duration;
  S.aspect = snapshot.aspect;
  S.background = snapshot.background;
  S.items = structuredClone(snapshot.items);

  S.selected = null;
  S.time = clamp(S.time, 0, S.duration);

  rebuildCanvas();
  renderTimeline();
  renderScene();
  updateToolbar();
  saveProject();
}

/* =========================================================
   HOME
========================================================= */

async function renderHome() {
  const grid = $("#projectGrid");
  grid.innerHTML = "";

  $("#storageStatus").textContent = "IndexedDB";

  if (!projects.length) {
    grid.innerHTML = `
      <div style="
        grid-column:1/-1;
        text-align:center;
        padding:45px;
        border:1px dashed #343a43;
        border-radius:14px;
        color:#8f97a2;
      ">
        🎬<br><br>
        まだプロジェクトがありません
      </div>
    `;

    return;
  }

  for (const p of projects) {
    const card = document.createElement("article");
    card.className = "projectCard";

    const thumb = document.createElement("div");
    thumb.className = "projectThumbnail";

    const first =
      p.items.find(x => x.type === "image" || x.type === "video");

    if (first) {
      try {
        const url = await getMediaURL(first);

        const media = document.createElement(
          first.type === "video" ? "video" : "img"
        );

        media.src = url;

        if (first.type === "video") {
          media.muted = true;
          media.playsInline = true;
          media.preload = "metadata";
        }

        thumb.append(media);
      } catch {
        thumb.textContent = "🎬";
      }
    } else {
      thumb.textContent = "🎬";
    }

    const duration = document.createElement("span");
    duration.className = "duration";
    duration.textContent = formatTime(p.duration || 0);

    thumb.append(duration);

    const info = document.createElement("div");
    info.className = "projectInfo";

    const title = document.createElement("b");
    title.textContent = p.name;

    const date = document.createElement("small");
    date.textContent = new Date(p.updated).toLocaleString("ja-JP");

    info.append(title, date);
    card.append(thumb, info);

    card.onclick = () => openProject(p.id);

    let longTimer = null;

    card.addEventListener("pointerdown", () => {
      longTimer = setTimeout(() => {
        projectMenu(p.id);
      }, 650);
    });

    card.addEventListener("pointerup", () => clearTimeout(longTimer));
    card.addEventListener("pointermove", () => clearTimeout(longTimer));

    grid.append(card);
  }
}

function projectMenu(id) {
  const p = projects.find(x => x.id === id);

  if (!p) return;

  const result = prompt(
    "名前を変更できます。\n削除する場合は DELETE と入力してください。",
    p.name
  );

  if (result === null) return;

  if (result === "DELETE") {
    if (!confirm("このプロジェクトを削除しますか？")) return;

    const usedMedia = new Set(p.items.map(x => x.mediaId).filter(Boolean));

    projects = projects.filter(x => x.id !== id);
    persistProjects();

    /* 他プロジェクトで使われていないBlobだけ消す */
    for (const mediaId of usedMedia) {
      const stillUsed = projects.some(project =>
        project.items.some(it => it.mediaId === mediaId)
      );

      if (!stillUsed) {
        deleteBlob(mediaId).catch(() => {});
      }
    }

    renderHome();
    return;
  }

  if (result.trim()) {
    p.name = result.trim();
    p.updated = Date.now();

    persistProjects();
    renderHome();
  }
}

/* =========================================================
   OPEN PROJECT
========================================================= */

async function openProject(id) {
  projectId = id;

  const p = currentProject();

  if (!p) return;

  S = freshState();

  S.duration = p.duration || 10;
  S.aspect = p.aspect || "9:16";
  S.background = p.background || "#111111";
  S.items = structuredClone(p.items || []);

  $("#projectName").value = p.name;
  $("#saveStatus").textContent = "保存済み";

  showScreen("editor");

  await rebuildCanvas();

  updateCanvasAspect();
  renderTimeline();

  /* 中央プレイヘッド = 0秒位置 */
  requestAnimationFrame(() => {
    syncTimelineGeometry();
    seekTimelineTo(0, false);
    renderScene();
  });

  updateToolbar();
}

/* =========================================================
   MEDIA PROBE
========================================================= */

function probeFile(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);

    if (file.type.startsWith("video")) {
      const video = document.createElement("video");

      video.preload = "metadata";

      video.onloadedmetadata = () => {
        const result = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: Number.isFinite(video.duration) ? video.duration : 5
        };

        URL.revokeObjectURL(url);
        resolve(result);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: 1920,
          height: 1080,
          duration: 5
        });
      };

      video.src = url;
    } else {
      const img = new Image();

      img.onload = () => {
        const result = {
          width: img.naturalWidth,
          height: img.naturalHeight,
          duration: 5
        };

        URL.revokeObjectURL(url);
        resolve(result);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: 1000,
          height: 1000,
          duration: 5
        });
      };

      img.src = url;
    }
  });
}

/* =========================================================
   FIT MEDIA
========================================================= */

function fittedRect(w, h, cw, ch, scale = 1) {
  const ratio = Math.min(cw / w, ch / h) * scale;

  const width = w * ratio;
  const height = h * ratio;

  return {
    x: (cw - width) / 2,
    y: (ch - height) / 2,
    w: width,
    h: height
  };
}

/* =========================================================
   MAIN TRACK END
========================================================= */

function mainTrackEnd() {
  const items = S.items.filter(x => x.track === "main");

  if (!items.length) return 0;

  return Math.max(...items.map(x => x.end));
}

/* =========================================================
   ADD FILES
========================================================= */

async function addFiles(files, mode = "main") {
  if (!files.length) return;

  pushHistory();

  for (const file of files) {
    const mediaId = uid();

    await saveBlob(mediaId, file);

    const meta = await probeFile(file);

    const cw = $("#canvas").clientWidth || 300;
    const ch = $("#canvas").clientHeight || 533;

    const pip = mode === "pip";

    const fit = fittedRect(
      meta.width || cw,
      meta.height || ch,
      cw,
      ch,
      pip ? 0.48 : 1
    );

    const start = pip ? S.time : mainTrackEnd();

    const sourceDuration = file.type.startsWith("video")
      ? meta.duration
      : 5;

    const it = {
      id: uid(),

      mediaId,

      type: file.type.startsWith("video") ? "video" : "image",

      track: pip ? "pip" : "main",
      pip,

      name: file.name,

      sourceDuration,
      sourceIn: 0,
      sourceOut: sourceDuration,

      start,
      end: start + sourceDuration,

      x: fit.x,
      y: fit.y,
      w: fit.w,
      h: fit.h,

      rotation: 0,
      flipX: false,

      opacity: 100,

      speed: 1,
      volume: 100,

      brightness: 100,
      contrast: 100,
      saturation: 100,

      keyframes: [],

      animation: {
        in: null,
        out: null,
        loop: null,
        pb: null
      }
    };

    S.items.push(it);
    S.selected = it.id;
  }

  recalcDuration();

  saveProject();

  await rebuildCanvas();
  renderTimeline();
  renderScene();
  updateToolbar();
}

/* =========================================================
   DURATION
========================================================= */

function recalcDuration() {
  if (!S.items.length) {
    S.duration = 10;
    return;
  }

  S.duration = Math.max(
    1,
    ...S.items.map(x => x.end || 0)
  );

  S.time = clamp(S.time, 0, S.duration);
}

/* =========================================================
   CANVAS
========================================================= */

function updateCanvasAspect() {
  const [w, h] = S.aspect.split(":").map(Number);

  $("#canvas").style.aspectRatio = `${w}/${h}`;
  $("#canvas").style.background = S.background;
}

/* =========================================================
   BUILD CANVAS NODES
========================================================= */

async function rebuildCanvas() {
  for (const node of canvasNodes.values()) {
    node.remove();
  }

  canvasNodes.clear();

  for (const it of S.items) {
    await createCanvasNode(it);
  }
}

async function createCanvasNode(it) {
  const node = document.createElement("div");

  node.className =
    "canvasLayer " +
    (it.type === "text" ? "textLayer" : "");

  node.dataset.id = it.id;

  if (it.type === "text") {
    node.textContent = it.text || "";
  } else {
    const media = document.createElement(
      it.type === "video" ? "video" : "img"
    );

    media.src = await getMediaURL(it);

    if (it.type === "video") {
      media.playsInline = true;
      media.preload = "auto";
      media.muted = false;
    }

    node.append(media);
  }

  $("#canvas").append(node);

  canvasNodes.set(it.id, node);

  return node;
}

/* =========================================================
   KEYFRAME EASING
========================================================= */

function easeInOut(t) {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function interpolatedItem(it) {
  if (!it.keyframes?.length) return { ...it };

  const keys = [...it.keyframes].sort((a, b) => a.time - b.time);

  if (S.time <= keys[0].time) {
    return {
      ...it,
      ...keys[0]
    };
  }

  if (S.time >= keys[keys.length - 1].time) {
    return {
      ...it,
      ...keys[keys.length - 1]
    };
  }

  let a = keys[0];
  let b = keys[1];

  for (let i = 0; i < keys.length - 1; i++) {
    if (
      S.time >= keys[i].time &&
      S.time <= keys[i + 1].time
    ) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }

  const raw =
    (S.time - a.time) /
    Math.max(0.0001, b.time - a.time);

  const t = easeInOut(raw);

  const value = {
    ...it
  };

  for (const key of [
    "x",
    "y",
    "w",
    "h",
    "rotation",
    "opacity"
  ]) {
    value[key] =
      a[key] +
      (b[key] - a[key]) * t;
  }

  return value;
}

/* =========================================================
   SIMPLE PB ANIMATION
========================================================= */

function applyAnimationValue(it, value) {
  const out = { ...value };

  const pb = it.animation?.pb;

  if (!pb) return out;

  const local = S.time - it.start;

  if (local < 0 || S.time > it.end) return out;

  const strength = (pb.strength ?? 100) / 100;

  if (pb.name === "ぷるん") {
    const q = Math.sin(local * 12) * Math.exp(-local * 1.5);

    out.w *= 1 + q * 0.04 * strength;
    out.h *= 1 - q * 0.04 * strength;
  }

  if (pb.name === "呼吸") {
    const q = Math.sin(local * 3.4);

    out.w *= 1 + q * 0.018 * strength;
    out.h *= 1 + q * 0.018 * strength;
  }

  if (pb.name === "怒り") {
    out.x += Math.sin(local * 40) * 4 * strength;
    out.rotation += Math.sin(local * 32) * 2 * strength;
  }

  if (pb.name === "ジャンプ") {
    const cycle = local % 1.2;
    const p = cycle / 1.2;

    out.y -= Math.sin(Math.PI * p) * 55 * strength;
  }

  return out;
}

/* =========================================================
   RENDER SCENE
========================================================= */

async function renderScene() {
  updateCanvasAspect();

  for (let z = 0; z < S.items.length; z++) {
    const it = S.items[z];

    let node = canvasNodes.get(it.id);

    if (!node) {
      node = await createCanvasNode(it);
    }

    let value = interpolatedItem(it);
    value = applyAnimationValue(it, value);

    const visible =
      S.time >= it.start &&
      S.time <= it.end;

    node.style.visibility = visible ? "visible" : "hidden";

    node.classList.toggle(
      "selected",
      it.id === S.selected
    );

    node.style.width = value.w + "px";
    node.style.height = value.h + "px";

    node.style.transform = `
      translate3d(${value.x}px, ${value.y}px, 0)
      rotate(${value.rotation || 0}deg)
      scaleX(${value.flipX ? -1 : 1})
    `;

    node.style.opacity = (value.opacity ?? 100) / 100;

    node.style.zIndex = z + 1;

    node.style.filter = `
      brightness(${it.brightness ?? 100}%)
      contrast(${it.contrast ?? 100}%)
      saturate(${it.saturation ?? 100}%)
    `;

    if (it.type === "text") {
      node.textContent = it.text || "";

      node.style.fontSize = (it.fontSize || 32) + "px";
      node.style.color = it.color || "#ffffff";

      const stroke = it.stroke || 0;

      node.style.webkitTextStroke =
        stroke
          ? `${stroke}px ${it.strokeColor || "#000000"}`
          : "0";
    }

    if (it.type === "video") {
      const video = node.querySelector("video");

      if (!video) continue;

      const target =
        it.sourceIn +
        (S.time - it.start) * (it.speed || 1);

      video.volume = clamp((it.volume ?? 100) / 100, 0, 1);
      video.playbackRate = clamp(it.speed || 1, 0.25, 4);

      if (!visible) {
        video.pause();
        continue;
      }

      const safeTarget = clamp(
        target,
        it.sourceIn,
        it.sourceOut
      );

      if (
        !S.playing &&
        Number.isFinite(safeTarget) &&
        Math.abs(video.currentTime - safeTarget) > 0.08
      ) {
        try {
          video.currentTime = safeTarget;
        } catch {}
      }

      if (S.playing) {
        if (
          Math.abs(video.currentTime - safeTarget) > 0.25
        ) {
          try {
            video.currentTime = safeTarget;
          } catch {}
        }

        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }

  for (const [id, node] of canvasNodes) {
    if (!S.items.some(x => x.id === id)) {
      node.remove();
      canvasNodes.delete(id);
    }
  }

  $("#timeDisplay").textContent =
    `${formatTime(S.time)} / ${formatTime(S.duration)}`;
}

/* =========================================================
   TIMELINE GEOMETRY
========================================================= */

function pixelsPerSecond() {
  return 82 * timelineZoom;
}

function centerPadding() {
  return $("#timelineViewport").clientWidth / 2;
}

function timelineTotalWidth() {
  return (
    centerPadding() * 2 +
    S.duration * pixelsPerSecond()
  );
}

function syncTimelineGeometry() {
  const padding = centerPadding();
  const total = timelineTotalWidth();

  $("#timelineContent").style.width = total + "px";

  $("#timelineRuler").style.left = padding + "px";
  $("#timelineRuler").style.width =
    S.duration * pixelsPerSecond() + "px";

  $("#trackContainer").style.marginLeft = padding + "px";
  $("#trackContainer").style.width =
    S.duration * pixelsPerSecond() + "px";

  renderRuler();
}

/* =========================================================
   RULER
========================================================= */

function renderRuler() {
  const ruler = $("#timelineRuler");

  ruler.innerHTML = "";

  const pps = pixelsPerSecond();

  let step = 1;

  if (pps < 50) step = 2;
  if (pps < 28) step = 5;
  if (pps > 180) step = 0.5;

  for (let t = 0; t <= S.duration + 0.001; t += step) {
    const mark = document.createElement("span");

    mark.className = "rulerTime";
    mark.style.left = t * pps + "px";
    mark.textContent =
      t < 60
        ? `${t.toFixed(step < 1 ? 1 : 0)}s`
        : formatTime(t).slice(0, 5);

    ruler.append(mark);
  }
}

/* =========================================================
   TRACK TARGET
========================================================= */

function trackForItem(it) {
  if (it.track === "main") return $("#mainTrackClips");
  if (it.track === "pip") return $("#pipTrackClips");
  if (it.track === "text") return $("#textTrackClips");
  if (it.track === "audio") return $("#audioTrackClips");

  return $("#pipTrackClips");
}

/* =========================================================
   RENDER TIMELINE
========================================================= */

function renderTimeline() {
  $("#mainTrackClips").innerHTML = "";
  $("#pipTrackClips").innerHTML = "";
  $("#textTrackClips").innerHTML = "";
  $("#audioTrackClips").innerHTML = "";

  syncTimelineGeometry();

  for (const it of S.items) {
    const clip = document.createElement("div");

    clip.className =
      `timelineClip ${it.track || it.type}` +
      (it.id === S.selected ? " selected" : "");

    clip.dataset.id = it.id;

    clip.style.left =
      it.start * pixelsPerSecond() + "px";

    clip.style.width =
      Math.max(
        20,
        (it.end - it.start) * pixelsPerSecond()
      ) + "px";

    if (it.type === "video") {
      const thumbs = document.createElement("div");
      thumbs.className = "clipThumbnails";

      clip.append(thumbs);

      /* 非同期でサムネイル生成 */
      requestAnimationFrame(() => {
        buildClipThumbnails(it, thumbs).catch(() => {});
      });
    }

    const name = document.createElement("span");
    name.className = "clipName";
    name.textContent = it.name || it.type;

    clip.append(name);

    if (it.id === S.selected) {
      const left = document.createElement("i");
      left.className = "trimHandle left";
      left.dataset.trim = "left";

      const right = document.createElement("i");
      right.className = "trimHandle right";
      right.dataset.trim = "right";

      clip.append(left, right);

      for (const key of it.keyframes || []) {
        if (key.time < it.start || key.time > it.end) continue;

        const marker = document.createElement("i");
        marker.className = "keyframeMarker";

        marker.style.left =
          (key.time - it.start) *
          pixelsPerSecond() +
          "px";

        clip.append(marker);
      }
    }

    trackForItem(it).append(clip);
  }
}

/* =========================================================
   VIDEO THUMBNAILS
========================================================= */

async function buildClipThumbnails(it, holder) {
  if (!holder.isConnected) return;

  const url = await getMediaURL(it);

  if (!url || !holder.isConnected) return;

  const video = document.createElement("video");

  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise(resolve => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }

    video.onloadedmetadata = resolve;
    video.onerror = resolve;
  });

  if (!Number.isFinite(video.duration)) return;

  const clipWidth =
    Math.max(
      20,
      (it.end - it.start) * pixelsPerSecond()
    );

  const count = clamp(
    Math.ceil(clipWidth / 55),
    1,
    14
  );

  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 70;

  const ctx = canvas.getContext("2d");

  for (let i = 0; i < count; i++) {
    if (!holder.isConnected) return;

    const p =
      count === 1
        ? 0
        : i / (count - 1);

    const time =
      it.sourceIn +
      (it.sourceOut - it.sourceIn) * p;

    await seekVideo(video, time);

    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const img = document.createElement("img");

      img.className = "clipThumb";
      img.src = canvas.toDataURL("image/jpeg", 0.55);

      holder.append(img);
    } catch {
      return;
    }
  }
}

function seekVideo(video, time) {
  return new Promise(resolve => {
    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    video.addEventListener("seeked", done, {
      once: true
    });

    try {
      video.currentTime = clamp(
        time,
        0,
        Math.max(0, (video.duration || time) - 0.01)
      );
    } catch {
      done();
    }

    setTimeout(done, 500);
  });
}

/* =========================================================
   FIXED-CENTER TIMELINE
========================================================= */

function timeFromTimelineScroll() {
  return clamp(
    $("#timelineViewport").scrollLeft /
      pixelsPerSecond(),
    0,
    S.duration
  );
}

function seekTimelineTo(time, smooth = false) {
  S.time = clamp(time, 0, S.duration);

  const left =
    S.time * pixelsPerSecond();

  timelineBusy = true;

  $("#timelineViewport").scrollTo({
    left,
    behavior: smooth ? "smooth" : "auto"
  });

  requestAnimationFrame(() => {
    timelineBusy = false;
  });

  renderScene();
}

/* User drags timeline -> current time changes */

$("#timelineViewport").addEventListener(
  "scroll",
  () => {
    if (timelineBusy) return;

    S.time = timeFromTimelineScroll();

    if (S.playing) {
      stopPlayback();
    }

    renderScene();
  },
  { passive: true }
);

/* =========================================================
   TIMELINE ZOOM
========================================================= */

function changeTimelineZoom(multiplier) {
  const oldTime = S.time;

  timelineZoom = clamp(
    timelineZoom * multiplier,
    0.45,
    4
  );

  renderTimeline();

  requestAnimationFrame(() => {
    seekTimelineTo(oldTime, false);
  });
}

$("#timelineZoomIn").onclick =
  () => changeTimelineZoom(1.25);

$("#timelineZoomOut").onclick =
  () => changeTimelineZoom(0.8);

/* =========================================================
   TIMELINE CLIP POINTER
========================================================= */

$("#trackContainer").addEventListener(
  "pointerdown",
  event => {
    const clip = event.target.closest(".timelineClip");

    if (!clip) return;

    const it = S.items.find(x => x.id === clip.dataset.id);

    if (!it) return;

    S.selected = it.id;

    updateToolbar();
    renderScene();
    renderTimeline();

    const handle = event.target.closest(".trimHandle");

    pushHistory();

    timelineGesture = {
      type: handle
        ? "trim"
        : "move",

      side: handle?.dataset.trim || null,

      item: it,

      startX: event.clientX,

      start: it.start,
      end: it.end,

      sourceIn: it.sourceIn,
      sourceOut: it.sourceOut
    };

    clip.setPointerCapture?.(event.pointerId);

    event.preventDefault();
    event.stopPropagation();
  }
);

$("#trackContainer").addEventListener(
  "pointermove",
  event => {
    if (!timelineGesture) return;

    const g = timelineGesture;
    const it = g.item;

    const delta =
      (event.clientX - g.startX) /
      pixelsPerSecond();

    if (g.type === "move") {
      const duration = g.end - g.start;

      const newStart = Math.max(
        0,
        g.start + delta
      );

      it.start = newStart;
      it.end = newStart + duration;
    }

    if (
      g.type === "trim" &&
      g.side === "left"
    ) {
      const maxStart = g.end - 0.1;

      const newStart = clamp(
        g.start + delta,
        0,
        maxStart
      );

      const actualDelta = newStart - g.start;

      it.start = newStart;

      if (it.type === "video") {
        it.sourceIn = clamp(
          g.sourceIn +
            actualDelta *
              (it.speed || 1),

          0,
          g.sourceOut - 0.05
        );
      }
    }

    if (
      g.type === "trim" &&
      g.side === "right"
    ) {
      let newEnd = Math.max(
        g.start + 0.1,
        g.end + delta
      );

      if (it.type === "video") {
        const maxExtra =
          (it.sourceDuration - g.sourceOut) /
          (it.speed || 1);

        newEnd = Math.min(
          newEnd,
          g.end + maxExtra
        );

        const actualDelta =
          newEnd - g.end;

        it.sourceOut = clamp(
          g.sourceOut +
            actualDelta *
              (it.speed || 1),

          it.sourceIn + 0.05,
          it.sourceDuration
        );
      }

      it.end = newEnd;
    }

    recalcDuration();

    renderTimeline();
    renderScene();

    event.preventDefault();
  }
);

function endTimelineGesture() {
  if (!timelineGesture) return;

  timelineGesture = null;

  recalcDuration();
  saveProject();

  renderTimeline();
  renderScene();
}

$("#trackContainer").addEventListener(
  "pointerup",
  endTimelineGesture
);

$("#trackContainer").addEventListener(
  "pointercancel",
  endTimelineGesture
);

/* =========================================================
   CANVAS SELECT / MOVE / PINCH
========================================================= */

$("#canvas").addEventListener(
  "pointerdown",
  event => {
    const layer = event.target.closest(".canvasLayer");

    if (!layer) {
      S.selected = null;

      updateToolbar();
      renderScene();
      renderTimeline();

      return;
    }

    const it = S.items.find(x => x.id === layer.dataset.id);

    if (!it) return;

    S.selected = it.id;

    updateToolbar();
    renderScene();
    renderTimeline();

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    $("#canvas").setPointerCapture?.(event.pointerId);

    if (pointers.size === 1) {
      pushHistory();

      canvasGesture = {
        type: "move",

        x: it.x,
        y: it.y,

        startX: event.clientX,
        startY: event.clientY
      };
    }

    if (pointers.size === 2) {
      const pts = [...pointers.values()];

      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;

      canvasGesture = {
        type: "pinch",

        distance: Math.hypot(dx, dy),
        angle: Math.atan2(dy, dx),

        w: it.w,
        h: it.h,
        rotation: it.rotation || 0
      };
    }

    event.preventDefault();
  }
);

$("#canvas").addEventListener(
  "pointermove",
  event => {
    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    });

    const it = selectedItem();

    if (!it) return;

    const pts = [...pointers.values()];

    if (
      pts.length === 1 &&
      canvasGesture?.type === "move"
    ) {
      it.x =
        canvasGesture.x +
        pts[0].x -
        canvasGesture.startX;

      it.y =
        canvasGesture.y +
        pts[0].y -
        canvasGesture.startY;

      applySnapping(it);

      autoUpdateKeyframe(it);

      renderScene();
    }

    if (
      pts.length === 2 &&
      canvasGesture?.type === "pinch"
    ) {
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;

      const distance = Math.hypot(dx, dy);

      const scale =
        distance /
        Math.max(1, canvasGesture.distance);

      it.w = Math.max(
        20,
        canvasGesture.w * scale
      );

      it.h = Math.max(
        20,
        canvasGesture.h * scale
      );

      it.rotation =
        canvasGesture.rotation +
        (
          Math.atan2(dy, dx) -
          canvasGesture.angle
        ) *
        180 /
        Math.PI;

      autoUpdateKeyframe(it);

      renderScene();
    }

    event.preventDefault();
  }
);

function endCanvasPointer(event) {
  pointers.delete(event.pointerId);

  hideGuides();

  if (!pointers.size) {
    canvasGesture = null;

    saveProject();
    renderTimeline();
  }
}

$("#canvas").addEventListener(
  "pointerup",
  endCanvasPointer
);

$("#canvas").addEventListener(
  "pointercancel",
  endCanvasPointer
);

/* =========================================================
   SNAP
========================================================= */

function hideGuides() {
  $$(".snapGuide").forEach(x =>
    x.classList.remove("show")
  );
}

function applySnapping(it) {
  hideGuides();

  const canvas = $("#canvas");

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;

  const threshold = 8;

  if (Math.abs(cx - cw / 2) < threshold) {
    it.x = cw / 2 - it.w / 2;
    $("#guideX").classList.add("show");
  }

  if (Math.abs(cy - ch / 2) < threshold) {
    it.y = ch / 2 - it.h / 2;
    $("#guideY").classList.add("show");
  }

  if (Math.abs(it.x) < threshold) {
    it.x = 0;
    $("#guideLeft").classList.add("show");
  }

  if (Math.abs(it.y) < threshold) {
    it.y = 0;
    $("#guideTop").classList.add("show");
  }

  if (Math.abs(it.x + it.w - cw) < threshold) {
    it.x = cw - it.w;
    $("#guideRight").classList.add("show");
  }

  if (Math.abs(it.y + it.h - ch) < threshold) {
    it.y = ch - it.h;
    $("#guideBottom").classList.add("show");
  }
}

/* =========================================================
   KEYFRAME
========================================================= */

function currentTransformKey(it) {
  return {
    time: S.time,

    x: it.x,
    y: it.y,

    w: it.w,
    h: it.h,

    rotation: it.rotation || 0,
    opacity: it.opacity ?? 100
  };
}

function addKeyframe(it) {
  it.keyframes ||= [];

  const key = currentTransformKey(it);

  const index = it.keyframes.findIndex(
    x => Math.abs(x.time - S.time) < 0.025
  );

  if (index >= 0) {
    it.keyframes[index] = key;
  } else {
    it.keyframes.push(key);
  }

  it.keyframes.sort((a, b) => a.time - b.time);

  toast("◇ キーフレーム");

  saveProject();
  renderTimeline();
}

function autoUpdateKeyframe(it) {
  if (!it.keyframes?.length) return;

  const key = it.keyframes.find(
    x => Math.abs(x.time - S.time) < 0.035
  );

  if (!key) return;

  Object.assign(key, currentTransformKey(it));
}

/* =========================================================
   PLAYBACK
========================================================= */

function stopPlayback() {
  S.playing = false;

  cancelAnimationFrame(playingRAF);

  $("#playBtn").textContent = "▶";

  for (const node of canvasNodes.values()) {
    node.querySelector("video")?.pause();
  }

  lastFrame = 0;
}

function startPlayback() {
  if (S.time >= S.duration) {
    seekTimelineTo(0, false);
  }

  S.playing = true;

  $("#playBtn").textContent = "Ⅱ";

  lastFrame = 0;

  playingRAF = requestAnimationFrame(playTick);
}

function playTick(timestamp) {
  if (!S.playing) return;

  if (!lastFrame) {
    lastFrame = timestamp;
  }

  const delta =
    (timestamp - lastFrame) / 1000;

  lastFrame = timestamp;

  S.time += delta;

  if (S.time >= S.duration) {
    S.time = S.duration;

    timelineBusy = true;

    $("#timelineViewport").scrollLeft =
      S.time * pixelsPerSecond();

    timelineBusy = false;

    renderScene();
    stopPlayback();

    return;
  }

  timelineBusy = true;

  $("#timelineViewport").scrollLeft =
    S.time * pixelsPerSecond();

  timelineBusy = false;

  renderScene();

  playingRAF =
    requestAnimationFrame(playTick);
}

$("#playBtn").onclick = () => {
  if (S.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
};

$("#jumpStartBtn").onclick = () => {
  stopPlayback();
  seekTimelineTo(0, false);
};

/* =========================================================
   TOOLBAR STATE
========================================================= */

function updateToolbar() {
  const selected = !!S.selected;

  $("#mainToolbar").hidden = selected;
  $("#clipToolbar").hidden = !selected;
}

/* =========================================================
   MAIN TOOLBAR
========================================================= */

$("#mainToolbar").addEventListener(
  "click",
  event => {
    const button =
      event.target.closest("[data-main-tool]");

    if (!button) return;

    const tool = button.dataset.mainTool;

    if (tool === "canvas") {
      openCanvasSheet();
    }

    if (tool === "text") {
      createText();
    }

    if (tool === "music") {
      toast("音楽トラックは次の実装段階");
    }

    if (tool === "sticker") {
      toast("ステッカーライブラリは次の実装段階");
    }

    if (tool === "background") {
      openBackgroundSheet();
    }
  }
);

/* =========================================================
   CANVAS SHEET
========================================================= */

function openSheet(title, html, onApply = null) {
  $("#sheetTitle").textContent = title;
  $("#sheetContent").innerHTML = html;
  $("#editSheet").hidden = false;

  pendingSheetApply = onApply;
}

function closeSheet() {
  $("#editSheet").hidden = true;
  pendingSheetApply = null;
}

$("#sheetCancel").onclick = closeSheet;

$("#sheetApply").onclick = () => {
  pendingSheetApply?.();
  closeSheet();

  saveProject();
  renderTimeline();
  renderScene();
};

function openCanvasSheet() {
  openSheet(
    "キャンバス",
    `
      <div class="optionRow">
        ${["9:16", "16:9", "1:1", "4:5", "4:3"]
          .map(x => `
            <button
              class="optionButton ${S.aspect === x ? "active" : ""}"
              data-aspect="${x}"
            >
              ${x}
            </button>
          `)
          .join("")}
      </div>
    `
  );
}

function openBackgroundSheet() {
  openSheet(
    "背景",
    `
      <div class="optionRow">
        ${[
          "#000000",
          "#111111",
          "#ffffff",
          "#355070",
          "#6d597a",
          "#b56576"
        ]
          .map(x => `
            <button
              class="optionButton"
              data-background="${x}"
              style="background:${x};min-height:48px"
            >
            </button>
          `)
          .join("")}
      </div>
    `
  );
}

$("#sheetContent").addEventListener(
  "click",
  event => {
    const aspect = event.target.dataset.aspect;

    if (aspect) {
      pushHistory();

      S.aspect = aspect;

      $$("#sheetContent [data-aspect]").forEach(x =>
        x.classList.toggle(
          "active",
          x.dataset.aspect === aspect
        )
      );

      updateCanvasAspect();
      renderScene();
    }

    const bg = event.target.dataset.background;

    if (bg) {
      pushHistory();

      S.background = bg;

      updateCanvasAspect();
      renderScene();
    }

    const speed = event.target.dataset.speed;

    if (speed) {
      const it = selectedItem();

      if (!it) return;

      pushHistory();

      it.speed = Number(speed);

      if (it.type === "video") {
        it.end =
          it.start +
          (it.sourceOut - it.sourceIn) /
          it.speed;
      }

      recalcDuration();

      renderTimeline();
      renderScene();
    }

    const layer = event.target.dataset.layer;

    if (layer) {
      changeLayer(layer);
    }
  }
);

/* =========================================================
   TEXT
========================================================= */

function createText() {
  pushHistory();

  const cw = $("#canvas").clientWidth || 300;
  const ch = $("#canvas").clientHeight || 533;

  const it = {
    id: uid(),

    type: "text",
    track: "text",

    name: "テキスト",
    text: "TEXT",

    start: S.time,
    end: Math.max(S.time + 3, S.duration),

    x: cw * 0.15,
    y: ch * 0.42,

    w: cw * 0.7,
    h: 70,

    rotation: 0,
    opacity: 100,

    flipX: false,

    fontSize: 32,
    color: "#ffffff",

    stroke: 0,
    strokeColor: "#000000",

    keyframes: [],

    animation: {
      in: null,
      out: null,
      loop: null,
      pb: null
    }
  };

  S.items.push(it);
  S.selected = it.id;

  recalcDuration();

  rebuildCanvas().then(() => {
    renderScene();
  });

  renderTimeline();
  updateToolbar();

  openTextEditor(it);
}

function openTextEditor(it) {
  textBackup = structuredClone(it);

  $("#textInput").value = it.text || "";
  $("#textSize").value = it.fontSize || 32;
  $("#textColor").value = it.color || "#ffffff";
  $("#textStroke").value = it.stroke || 0;

  $("#textEditor").hidden = false;
}

$("#textInput").oninput = () => {
  const it = selectedItem();

  if (!it || it.type !== "text") return;

  it.text = $("#textInput").value;
  it.name = it.text || "テキスト";

  renderScene();
};

$("#textSize").oninput = () => {
  const it = selectedItem();

  if (!it || it.type !== "text") return;

  it.fontSize = Number($("#textSize").value);

  renderScene();
};

$("#textColor").oninput = () => {
  const it = selectedItem();

  if (!it || it.type !== "text") return;

  it.color = $("#textColor").value;

  renderScene();
};

$("#textStroke").oninput = () => {
  const it = selectedItem();

  if (!it || it.type !== "text") return;

  it.stroke = Number($("#textStroke").value);

  renderScene();
};

$("#textApply").onclick = () => {
  $("#textEditor").hidden = true;

  textBackup = null;

  saveProject();
  renderTimeline();
  renderScene();
};

$("#textCancel").onclick = () => {
  const it = selectedItem();

  if (it && textBackup) {
    Object.assign(it, textBackup);
  }

  $("#textEditor").hidden = true;

  textBackup = null;

  renderTimeline();
  renderScene();
};

/* =========================================================
   CLIP TOOLBAR
========================================================= */

$("#clipToolbar").addEventListener(
  "click",
  event => {
    const button =
      event.target.closest("[data-clip-tool]");

    if (!button) return;

    const it = selectedItem();

    if (!it) return;

    const tool = button.dataset.clipTool;

    if (tool === "done") {
      S.selected = null;

      updateToolbar();
      renderTimeline();
      renderScene();

      return;
    }

    if (tool === "split") {
      splitSelected();
      return;
    }

    if (tool === "trim") {
      toast("白い左右ハンドルをドラッグ");
      return;
    }

    if (tool === "speed") {
      openSpeedSheet(it);
      return;
    }

    if (tool === "volume") {
      openVolumeSheet(it);
      return;
    }

    if (tool === "animation") {
      openAnimationPanel(it);
      return;
    }

    if (tool === "keyframe") {
      pushHistory();
      addKeyframe(it);
      return;
    }

    if (tool === "transform") {
      openTransformSheet(it);
      return;
    }

    if (tool === "crop") {
      toast("クロップUIは次段階");
      return;
    }

    if (tool === "filter") {
      openFilterSheet(it);
      return;
    }

    if (tool === "layer") {
      openLayerSheet();
      return;
    }

    if (tool === "rotate") {
      pushHistory();

      it.rotation =
        ((it.rotation || 0) + 90) % 360;

      autoUpdateKeyframe(it);

      saveProject();
      renderScene();

      return;
    }

    if (tool === "flip") {
      pushHistory();

      it.flipX = !it.flipX;

      saveProject();
      renderScene();

      return;
    }

    if (tool === "duplicate") {
      duplicateSelected();
      return;
    }

    if (tool === "delete") {
      deleteSelected();
    }
  }
);

/* =========================================================
   SPLIT
========================================================= */

function splitSelected() {
  const it = selectedItem();

  if (!it) return;

  if (
    S.time <= it.start + 0.02 ||
    S.time >= it.end - 0.02
  ) {
    toast("白線をクリップの途中に置いてください");
    return;
  }

  pushHistory();

  const right = structuredClone(it);

  right.id = uid();
  right.name = it.name + " 2";

  const oldEnd = it.end;

  if (it.type === "video") {
    const sourceCut =
      it.sourceIn +
      (S.time - it.start) *
      (it.speed || 1);

    it.sourceOut = sourceCut;
    right.sourceIn = sourceCut;
  }

  it.end = S.time;

  right.start = S.time;
  right.end = oldEnd;

  const index = S.items.indexOf(it);

  S.items.splice(index + 1, 0, right);

  S.selected = right.id;

  saveProject();

  rebuildCanvas().then(renderScene);

  renderTimeline();
  updateToolbar();
}

/* =========================================================
   SPEED
========================================================= */

function openSpeedSheet(it) {
  openSheet(
    "速度",
    `
      <div class="optionRow">
        ${[0.25, 0.5, 1, 1.5, 2, 3, 4]
          .map(x => `
            <button
              class="optionButton ${it.speed === x ? "active" : ""}"
              data-speed="${x}"
            >
              ${x}×
            </button>
          `)
          .join("")}
      </div>
    `
  );
}

/* =========================================================
   VOLUME
========================================================= */

function openVolumeSheet(it) {
  openSheet(
    "音量",
    `
      <div class="propertyGrid">
        <label class="propertyWide">
          音量
          <input
            id="volumeSlider"
            type="range"
            min="0"
            max="100"
            value="${it.volume ?? 100}"
          >
        </label>
      </div>
    `
  );

  $("#volumeSlider").oninput = () => {
    it.volume = Number($("#volumeSlider").value);

    renderScene();
  };
}

/* =========================================================
   TRANSFORM
========================================================= */

function openTransformSheet(it) {
  openSheet(
    "変形",
    `
      <div class="propertyGrid">

        ${[
          ["transformX", "X", it.x],
          ["transformY", "Y", it.y],
          ["transformW", "幅", it.w],
          ["transformH", "高さ", it.h],
          ["transformR", "回転", it.rotation || 0],
          ["transformO", "透明度", it.opacity ?? 100]
        ]
          .map(([id, label, value]) => `
            <label>
              ${label}
              <input
                id="${id}"
                type="number"
                step=".1"
                value="${value}"
              >
            </label>
          `)
          .join("")}

      </div>
    `
  );

  const map = {
    transformX: "x",
    transformY: "y",
    transformW: "w",
    transformH: "h",
    transformR: "rotation",
    transformO: "opacity"
  };

  for (const [id, property] of Object.entries(map)) {
    $("#" + id).oninput = () => {
      it[property] = Number($("#" + id).value);

      autoUpdateKeyframe(it);
      renderScene();
    };
  }
}

/* =========================================================
   FILTER
========================================================= */

function openFilterSheet(it) {
  openSheet(
    "調整",
    `
      <div class="propertyGrid">

        <label class="propertyWide">
          明るさ
          <input
            id="brightnessSlider"
            type="range"
            min="0"
            max="200"
            value="${it.brightness ?? 100}"
          >
        </label>

        <label class="propertyWide">
          コントラスト
          <input
            id="contrastSlider"
            type="range"
            min="0"
            max="200"
            value="${it.contrast ?? 100}"
          >
        </label>

        <label class="propertyWide">
          彩度
          <input
            id="saturationSlider"
            type="range"
            min="0"
            max="200"
            value="${it.saturation ?? 100}"
          >
        </label>

      </div>
    `
  );

  $("#brightnessSlider").oninput = () => {
    it.brightness = Number($("#brightnessSlider").value);
    renderScene();
  };

  $("#contrastSlider").oninput = () => {
    it.contrast = Number($("#contrastSlider").value);
    renderScene();
  };

  $("#saturationSlider").oninput = () => {
    it.saturation = Number($("#saturationSlider").value);
    renderScene();
  };
}

/* =========================================================
   LAYER
========================================================= */

function openLayerSheet() {
  openSheet(
    "レイヤー",
    `
      <div class="optionRow">
        <button class="optionButton" data-layer="front">
          最前面
        </button>

        <button class="optionButton" data-layer="forward">
          前へ
        </button>

        <button class="optionButton" data-layer="backward">
          後ろへ
        </button>

        <button class="optionButton" data-layer="back">
          最背面
        </button>
      </div>
    `
  );
}

function changeLayer(action) {
  const it = selectedItem();

  if (!it) return;

  pushHistory();

  let index = S.items.indexOf(it);

  S.items.splice(index, 1);

  if (action === "front") {
    S.items.push(it);
  }

  if (action === "back") {
    S.items.unshift(it);
  }

  if (action === "forward") {
    index = Math.min(S.items.length, index + 1);
    S.items.splice(index, 0, it);
  }

  if (action === "backward") {
    index = Math.max(0, index - 1);
    S.items.splice(index, 0, it);
  }

  saveProject();
  renderScene();
}

/* =========================================================
   DUPLICATE / DELETE
========================================================= */

function duplicateSelected() {
  const it = selectedItem();

  if (!it) return;

  pushHistory();

  const copy = structuredClone(it);

  copy.id = uid();
  copy.name += " コピー";

  copy.x += 14;
  copy.y += 14;

  copy.start += 0.1;
  copy.end += 0.1;

  S.items.push(copy);

  S.selected = copy.id;

  recalcDuration();
  saveProject();

  rebuildCanvas().then(renderScene);

  renderTimeline();
}

function deleteSelected() {
  const it = selectedItem();

  if (!it) return;

  pushHistory();

  S.items = S.items.filter(x => x.id !== it.id);

  S.selected = null;

  recalcDuration();
  saveProject();

  rebuildCanvas().then(renderScene);

  renderTimeline();
  updateToolbar();
}

/* =========================================================
   ANIMATION
========================================================= */

let animationTab = "in";
let chosenAnimation = null;

const animations = {
  in: [
    ["フェード", "◌"],
    ["ポップ", "✦"],
    ["左から", "→"],
    ["右から", "←"],
    ["上から", "↓"],
    ["下から", "↑"]
  ],

  out: [
    ["フェード", "◌"],
    ["縮小", "•"],
    ["左へ", "←"],
    ["右へ", "→"],
    ["上へ", "↑"],
    ["下へ", "↓"]
  ],

  loop: [
    ["揺れる", "↔"],
    ["浮く", "↕"],
    ["回転", "↻"],
    ["脈動", "◎"]
  ],

  pb: [
    ["ぷるん", "◉"],
    ["歩く", "🚶"],
    ["走る", "➜"],
    ["ジャンプ", "↑"],
    ["着地", "↓"],
    ["怒り", "〰"],
    ["衝突", "✹"],
    ["吹っ飛ぶ", "➤"],
    ["転がる", "↻"],
    ["呼吸", "◎"]
  ]
};

function openAnimationPanel(it) {
  animationTab = "in";
  chosenAnimation = it.animation?.in?.name || null;

  $("#animationPanel").hidden = false;

  renderAnimationList();
}

function renderAnimationList() {
  $$(".animationTabs button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.animationTab === animationTab
    );
  });

  $("#animationList").innerHTML =
    animations[animationTab]
      .map(([name, icon]) => `
        <button
          class="animationItem ${
            chosenAnimation === name ? "active" : ""
          }"
          data-animation="${name}"
        >
          ${icon}
          <span>${name}</span>
        </button>
      `)
      .join("");
}

$(".animationTabs").onclick = event => {
  const button =
    event.target.closest("[data-animation-tab]");

  if (!button) return;

  animationTab = button.dataset.animationTab;

  const it = selectedItem();

  chosenAnimation =
    it?.animation?.[animationTab]?.name || null;

  renderAnimationList();
};

$("#animationList").onclick = event => {
  const button =
    event.target.closest("[data-animation]");

  if (!button) return;

  chosenAnimation = button.dataset.animation;

  renderAnimationList();
};

$("#animationClose").onclick = () => {
  $("#animationPanel").hidden = true;
};

$("#animationApply").onclick = () => {
  const it = selectedItem();

  if (!it) return;

  pushHistory();

  it.animation ||= {
    in: null,
    out: null,
    loop: null,
    pb: null
  };

  it.animation[animationTab] = chosenAnimation
    ? {
        name: chosenAnimation,
        duration: Number($("#animationDuration").value),
        strength: Number($("#animationStrength").value)
      }
    : null;

  $("#animationPanel").hidden = true;

  saveProject();
  renderScene();

  toast(`${chosenAnimation || "なし"} を設定`);
};

/* =========================================================
   FILE INPUTS
========================================================= */

$("#newProjectMedia").onchange =
  async event => {
    const files = [...event.target.files];

    if (!files.length) return;

    const p = createProject();

    await openProject(p.id);
    await addFiles(files, "main");

    event.target.value = "";
  };

$("#newBlankProject").onclick =
  async () => {
    const p = createProject();

    await openProject(p.id);
  };

$("#addMainMedia").onchange =
  async event => {
    await addFiles(
      [...event.target.files],
      "main"
    );

    event.target.value = "";
  };

$("#addPipMedia").onchange =
  async event => {
    await addFiles(
      [...event.target.files],
      "pip"
    );

    event.target.value = "";
  };

/* =========================================================
   BACK
========================================================= */

$("#editorBack").onclick = () => {
  stopPlayback();

  saveProject();

  S.selected = null;

  showScreen("home");

  renderHome();
};

/* =========================================================
   PROJECT NAME
========================================================= */

$("#projectName").oninput = () => {
  $("#saveStatus").textContent = "編集中";
};

$("#projectName").onchange = saveProject;

/* =========================================================
   UNDO / REDO
========================================================= */

$("#undoBtn").onclick = () => {
  if (!S.undo.length) return;

  stopPlayback();

  S.redo.push(stateSnapshot());

  const previous = S.undo.pop();

  restoreSnapshot(previous);
};

$("#redoBtn").onclick = () => {
  if (!S.redo.length) return;

  stopPlayback();

  S.undo.push(stateSnapshot());

  const next = S.redo.pop();

  restoreSnapshot(next);
};

/* =========================================================
   EXPORT PLACEHOLDER
========================================================= */

$("#exportBtn").onclick = () => {
  saveProject();

  toast(
    "プロジェクトを保存しました。動画書き出しはまだ未実装です"
  );
};

/* =========================================================
   SETTINGS
========================================================= */

$("#settingsBtn").onclick = () => {
  alert(
    "PB Editor v3.0\n\n" +
    "プロジェクト情報: localStorage\n" +
    "画像・動画: IndexedDB\n\n" +
    "v3.0 Editor Rebuild"
  );
};

/* =========================================================
   FULLSCREEN PREVIEW
========================================================= */

$("#fullscreenPreview").onclick = async () => {
  const viewport = $("#previewViewport");

  try {
    if (!document.fullscreenElement) {
      await viewport.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  } catch {
    toast("このブラウザでは全画面表示できません");
  }
};

/* =========================================================
   RESIZE
========================================================= */

window.addEventListener("resize", () => {
  if (!$("#editorScreen").classList.contains("active")) return;

  const time = S.time;

  renderTimeline();

  requestAnimationFrame(() => {
    seekTimelineTo(time, false);
  });
});

/* =========================================================
   INITIALIZE
========================================================= */

loadProjectList();

showScreen("home");

})();
