(() => {
"use strict";

/* =========================================================
   PB EDITOR v3.1 STUDIO
========================================================= */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const uid = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2);

const clamp = (v, min, max) =>
  Math.max(min, Math.min(max, v));

const clone = v => structuredClone(v);

const DB_NAME = "PBEditorV31";
const DB_STORE = "media";
const META_KEY = "pb-editor-v31-projects";

let projects = [];
let currentProjectId = null;

let S = freshState();

let mediaURLs = new Map();
let canvasNodes = new Map();

let zoom = 1;
let scrollSync = false;

let raf = 0;
let lastFrame = 0;

let pointers = new Map();
let canvasGesture = null;
let timelineGesture = null;

let copiedItem = null;

let selectedAnimationTab = "in";
let selectedAnimationName = null;

let currentAudioMode = "music";

let cropBackup = null;
let cropState = null;

let historyGestureStarted = false;

let audioContext = null;

/* =========================================================
   STATE
========================================================= */

function freshState() {
  return {
    duration: 10,
    time: 0,

    aspect: "9:16",
    background: "#111111",

    playing: false,
    selected: null,

    items: [],

    undo: [],
    redo: []
  };
}

/* =========================================================
   DEFAULT ITEM
========================================================= */

function baseItem() {
  return {
    id: uid(),

    type: "image",
    track: "pip",

    name: "素材",

    start: 0,
    end: 5,

    mediaId: null,

    sourceDuration: 5,
    sourceIn: 0,
    sourceOut: 5,

    x: 20,
    y: 20,
    w: 200,
    h: 200,

    rotation: 0,

    flipX: false,
    flipY: false,

    opacity: 100,

    speed: 1,
    volume: 100,

    fadeIn: 0,
    fadeOut: 0,

    brightness: 100,
    contrast: 100,
    saturation: 100,

    crop: {
      x: 0,
      y: 0,
      w: 1,
      h: 1
    },

    locked: false,
    visible: true,

    keyframes: [],

    animation: {
      in: null,
      out: null,
      loop: null,
      pb: null
    }
  };
}

/* =========================================================
   FORMAT
========================================================= */

function formatTime(value) {
  value = Math.max(0, Number(value) || 0);

  const min = Math.floor(value / 60);
  const sec = value % 60;

  return (
    String(min).padStart(2, "0") +
    ":" +
    sec.toFixed(2).padStart(5, "0")
  );
}

function toast(message) {
  const el = $("#toast");

  el.textContent = message;
  el.style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.style.display = "none";
  }, 1500);
}

function selectedItem() {
  return (
    S.items.find(x => x.id === S.selected) ||
    null
  );
}

/* =========================================================
   SCREEN
========================================================= */

function showScreen(name) {
  $("#homeScreen").classList.toggle(
    "active",
    name === "home"
  );

  $("#editorScreen").classList.toggle(
    "active",
    name === "editor"
  );
}

/* =========================================================
   DATABASE
========================================================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request =
      indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (
        !db.objectStoreNames.contains(DB_STORE)
      ) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () =>
      resolve(request.result);

    request.onerror = () =>
      reject(request.error);
  });
}

async function putBlob(id, blob) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx =
      db.transaction(DB_STORE, "readwrite");

    tx.objectStore(DB_STORE).put(blob, id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(id) {
  if (!id) return null;

  const db = await openDB();

  return new Promise((resolve, reject) => {
    const req =
      db.transaction(DB_STORE)
        .objectStore(DB_STORE)
        .get(id);

    req.onsuccess = () =>
      resolve(req.result || null);

    req.onerror = () =>
      reject(req.error);
  });
}

async function removeBlob(id) {
  const db = await openDB();

  return new Promise(resolve => {
    const tx =
      db.transaction(DB_STORE, "readwrite");

    tx.objectStore(DB_STORE).delete(id);

    tx.oncomplete = resolve;
  });
}

/* =========================================================
   OBJECT URL CACHE
========================================================= */

async function mediaURL(item) {
  if (!item.mediaId) return "";

  if (mediaURLs.has(item.mediaId)) {
    return mediaURLs.get(item.mediaId);
  }

  const blob = await getBlob(item.mediaId);

  if (!blob) return "";

  const url =
    URL.createObjectURL(blob);

  mediaURLs.set(item.mediaId, url);

  return url;
}

function releaseObjectURLs() {
  for (const url of mediaURLs.values()) {
    URL.revokeObjectURL(url);
  }

  mediaURLs.clear();
}

/* =========================================================
   PROJECT STORAGE
========================================================= */

function loadProjects() {
  try {
    projects =
      JSON.parse(
        localStorage.getItem(META_KEY)
      ) || [];
  } catch {
    projects = [];
  }

  renderHome();
}

function persistProjects() {
  localStorage.setItem(
    META_KEY,
    JSON.stringify(projects)
  );
}

function currentProject() {
  return projects.find(
    p => p.id === currentProjectId
  );
}

function makeProject() {
  const project = {
    id: uid(),

    name: "新しいプロジェクト",

    created: Date.now(),
    updated: Date.now(),

    duration: 10,

    aspect: "9:16",
    background: "#111111",

    items: []
  };

  projects.unshift(project);

  persistProjects();

  return project;
}

function saveProject() {
  const p = currentProject();

  if (!p) return;

  p.name =
    $("#projectName").value.trim() ||
    "名称未設定";

  p.updated = Date.now();

  p.duration = S.duration;
  p.aspect = S.aspect;
  p.background = S.background;

  p.items = clone(S.items);

  persistProjects();

  $("#saveStatus").textContent =
    "保存済み";
}

/* =========================================================
   HISTORY
========================================================= */

function snapshot() {
  return clone({
    duration: S.duration,
    aspect: S.aspect,
    background: S.background,
    items: S.items
  });
}

function pushHistory() {
  S.undo.push(snapshot());

  if (S.undo.length > 60) {
    S.undo.shift();
  }

  S.redo.length = 0;

  $("#saveStatus").textContent =
    "編集中";
}

async function restoreSnapshot(snap) {
  S.duration = snap.duration;
  S.aspect = snap.aspect;
  S.background = snap.background;

  S.items = clone(snap.items);

  S.selected = null;

  S.time = clamp(
    S.time,
    0,
    S.duration
  );

  await rebuildCanvas();

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

  $("#storageStatus").textContent =
    "IndexedDB";

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
    const card =
      document.createElement("article");

    card.className =
      "projectCard";

    const thumb =
      document.createElement("div");

    thumb.className =
      "projectThumbnail";

    const first =
      p.items.find(
        x =>
          x.type === "image" ||
          x.type === "video"
      );

    if (first) {
      try {
        const url =
          await mediaURL(first);

        const media =
          document.createElement(
            first.type === "video"
              ? "video"
              : "img"
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

    const duration =
      document.createElement("span");

    duration.className =
      "duration";

    duration.textContent =
      formatTime(p.duration || 0);

    thumb.append(duration);

    const info =
      document.createElement("div");

    info.className =
      "projectInfo";

    const name =
      document.createElement("b");

    name.textContent =
      p.name || "名称未設定";

    const date =
      document.createElement("small");

    date.textContent =
      new Date(
        p.updated
      ).toLocaleString("ja-JP");

    info.append(name, date);

    card.append(thumb, info);

    card.onclick = () =>
      openProject(p.id);

    let timer = null;

    card.addEventListener(
      "pointerdown",
      () => {
        timer = setTimeout(
          () => projectMenu(p.id),
          650
        );
      }
    );

    for (
      const type of [
        "pointerup",
        "pointercancel",
        "pointermove"
      ]
    ) {
      card.addEventListener(
        type,
        () => clearTimeout(timer)
      );
    }

    grid.append(card);
  }
}

/* =========================================================
   PROJECT MENU
========================================================= */

function projectMenu(id) {
  const p =
    projects.find(x => x.id === id);

  if (!p) return;

  const answer = prompt(
    "名前を変更できます。\n" +
    "COPY = プロジェクト複製\n" +
    "DELETE = 削除",
    p.name
  );

  if (answer === null) return;

  if (
    answer.trim().toUpperCase() ===
    "COPY"
  ) {
    const copy = clone(p);

    copy.id = uid();

    copy.name =
      p.name + " コピー";

    copy.created = Date.now();
    copy.updated = Date.now();

    projects.unshift(copy);

    persistProjects();
    renderHome();

    return;
  }

  if (
    answer.trim().toUpperCase() ===
    "DELETE"
  ) {
    deleteProject(id);
    return;
  }

  if (answer.trim()) {
    p.name = answer.trim();
    p.updated = Date.now();

    persistProjects();
    renderHome();
  }
}

/* =========================================================
   DELETE PROJECT
========================================================= */

async function deleteProject(id) {
  if (
    !confirm(
      "このプロジェクトを削除しますか？"
    )
  ) {
    return;
  }

  const project =
    projects.find(p => p.id === id);

  if (!project) return;

  const mediaIds =
    new Set(
      project.items
        .map(x => x.mediaId)
        .filter(Boolean)
    );

  projects =
    projects.filter(p => p.id !== id);

  persistProjects();

  for (const mediaId of mediaIds) {
    const usedElsewhere =
      projects.some(p =>
        p.items.some(
          x => x.mediaId === mediaId
        )
      );

    if (!usedElsewhere) {
      await removeBlob(mediaId)
        .catch(() => {});
    }
  }

  renderHome();
}

/* =========================================================
   OPEN PROJECT
========================================================= */

async function openProject(id) {
  stopPlayback();

  currentProjectId = id;

  const p = currentProject();

  if (!p) return;

  S = freshState();

  S.duration =
    p.duration || 10;

  S.aspect =
    p.aspect || "9:16";

  S.background =
    p.background || "#111111";

  S.items =
    clone(p.items || []);

  $("#projectName").value =
    p.name || "名称未設定";

  $("#saveStatus").textContent =
    "保存済み";

  showScreen("editor");

  updateCanvasAspect();

  await rebuildCanvas();

  renderTimeline();

  requestAnimationFrame(() => {
    syncTimelineGeometry();
    seekTo(0);
    renderScene();
  });

  updateToolbar();
}

/* =========================================================
   FILE PROBE
========================================================= */

function probeFile(file) {
  return new Promise(resolve => {
    const url =
      URL.createObjectURL(file);

    if (
      file.type.startsWith("video")
    ) {
      const video =
        document.createElement("video");

      video.preload = "metadata";

      video.onloadedmetadata = () => {
        const result = {
          width:
            video.videoWidth || 1920,

          height:
            video.videoHeight || 1080,

          duration:
            Number.isFinite(video.duration)
              ? video.duration
              : 5
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

      return;
    }

    if (
      file.type.startsWith("audio")
    ) {
      const audio =
        document.createElement("audio");

      audio.preload = "metadata";

      audio.onloadedmetadata = () => {
        const duration =
          Number.isFinite(audio.duration)
            ? audio.duration
            : 5;

        URL.revokeObjectURL(url);

        resolve({
          width: 0,
          height: 0,
          duration
        });
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);

        resolve({
          width: 0,
          height: 0,
          duration: 5
        });
      };

      audio.src = url;

      return;
    }

    const image = new Image();

    image.onload = () => {
      const result = {
        width:
          image.naturalWidth || 1000,

        height:
          image.naturalHeight || 1000,

        duration: 5
      };

      URL.revokeObjectURL(url);

      resolve(result);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);

      resolve({
        width: 1000,
        height: 1000,
        duration: 5
      });
    };

    image.src = url;
  });
}

/* =========================================================
   CANVAS ASPECT
========================================================= */

function updateCanvasAspect() {
  const [w, h] =
    S.aspect
      .split(":")
      .map(Number);

  $("#canvas").style.aspectRatio =
    `${w}/${h}`;

  $("#canvas").style.background =
    S.background;
}

/* =========================================================
   FIT RECT
========================================================= */

function fitRect(
  sourceW,
  sourceH,
  canvasW,
  canvasH,
  multiplier = 1
) {
  const ratio =
    Math.min(
      canvasW / sourceW,
      canvasH / sourceH
    ) * multiplier;

  const w =
    sourceW * ratio;

  const h =
    sourceH * ratio;

  return {
    x: (canvasW - w) / 2,
    y: (canvasH - h) / 2,
    w,
    h
  };
}

/* =========================================================
   MAIN TRACK
========================================================= */

function mainItems() {
  return S.items
    .filter(x => x.track === "main")
    .sort((a, b) => a.start - b.start);
}

function mainTrackEnd() {
  const list = mainItems();

  return list.length
    ? list[list.length - 1].end
    : 0;
}

/* =========================================================
   AUTOMATIC MAIN TRACK CONNECTION
========================================================= */

function reconnectMainTrack() {
  const list = mainItems();

  let cursor = 0;

  for (const it of list) {
    const duration =
      Math.max(
        0.05,
        it.end - it.start
      );

    it.start = cursor;
    it.end =
      cursor + duration;

    cursor = it.end;
  }
}

/* =========================================================
   ADD MEDIA
========================================================= */

async function addMediaFiles(
  files,
  mode = "main"
) {
  if (!files.length) return;

  pushHistory();

  for (const file of files) {
    const mediaId = uid();

    try {
      await putBlob(mediaId, file);
    } catch (error) {
      console.error(error);

      toast(
        "素材の保存に失敗しました"
      );

      continue;
    }

    const meta =
      await probeFile(file);

    const canvas =
      $("#canvas");

    const cw =
      canvas.clientWidth || 300;

    const ch =
      canvas.clientHeight || 533;

    const item =
      baseItem();

    item.mediaId = mediaId;
    item.name = file.name;

    const isVideo =
      file.type.startsWith("video");

    item.type =
      isVideo
        ? "video"
        : "image";

    item.track =
      mode === "pip"
        ? "pip"
        : "main";

    item.sourceDuration =
      isVideo
        ? meta.duration
        : 5;

    item.sourceIn = 0;
    item.sourceOut =
      item.sourceDuration;

    item.start =
      mode === "pip"
        ? S.time
        : mainTrackEnd();

    item.end =
      item.start +
      item.sourceDuration;

    const fit =
      fitRect(
        meta.width || cw,
        meta.height || ch,
        cw,
        ch,
        mode === "pip" ? .48 : 1
      );

    Object.assign(item, fit);

    S.items.push(item);

    S.selected = item.id;
  }

  reconnectMainTrack();

  recalcDuration();

  await rebuildCanvas();

  renderTimeline();
  renderScene();
  updateToolbar();

  saveProject();
}

/* =========================================================
   AUDIO FILE
========================================================= */

async function addAudioFile(
  file,
  track = "music"
) {
  pushHistory();

  const mediaId = uid();

  await putBlob(mediaId, file);

  const meta =
    await probeFile(file);

  const item =
    baseItem();

  item.id = uid();

  item.mediaId = mediaId;

  item.type = "audio";
  item.track = track;

  item.name = file.name;

  item.start = S.time;

  item.sourceDuration =
    meta.duration || 5;

  item.sourceIn = 0;
  item.sourceOut =
    item.sourceDuration;

  item.end =
    item.start +
    item.sourceDuration;

  item.volume = 100;

  S.items.push(item);

  S.selected = item.id;

  recalcDuration();

  await generateWaveform(item);

  renderTimeline();
  updateToolbar();

  saveProject();

  toast(
    track === "music"
      ? "音楽を追加しました"
      : "効果音を追加しました"
  );
}

/* =========================================================
   WAVEFORM
========================================================= */

async function generateWaveform(item) {
  try {
    const blob =
      await getBlob(item.mediaId);

    if (!blob) return;

    audioContext ||=
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

    const arrayBuffer =
      await blob.arrayBuffer();

    const buffer =
      await audioContext.decodeAudioData(
        arrayBuffer.slice(0)
      );

    const data =
      buffer.getChannelData(0);

    const samples = 120;

    const step =
      Math.max(
        1,
        Math.floor(
          data.length / samples
        )
      );

    const peaks = [];

    for (
      let i = 0;
      i < samples;
      i++
    ) {
      let max = 0;

      const start =
        i * step;

      const end =
        Math.min(
          data.length,
          start + step
        );

      for (
        let j = start;
        j < end;
        j += 8
      ) {
        max =
          Math.max(
            max,
            Math.abs(data[j])
          );
      }

      peaks.push(max);
    }

    item.waveform = peaks;
  } catch (error) {
    console.warn(
      "waveform:",
      error
    );

    item.waveform = [];
  }
}

/* =========================================================
   DURATION
========================================================= */

function recalcDuration() {
  if (!S.items.length) {
    S.duration = 10;
    return;
  }

  S.duration =
    Math.max(
      1,
      ...S.items.map(
        x => x.end || 0
      )
    );

  S.time =
    clamp(
      S.time,
      0,
      S.duration
    );
}

/* =========================================================
   CANVAS NODE
========================================================= */

async function rebuildCanvas() {
  for (
    const node of
    canvasNodes.values()
  ) {
    node.remove();
  }

  canvasNodes.clear();

  for (const item of S.items) {
    if (
      item.type === "audio"
    ) {
      continue;
    }

    await createCanvasNode(item);
  }
}

async function createCanvasNode(item) {
  const node =
    document.createElement("div");

  node.className =
    "canvasLayer";

  node.dataset.id = item.id;

  if (item.type === "text") {
    node.classList.add("textLayer");

    const inner =
      document.createElement("span");

    inner.className =
      "textInner";

    node.append(inner);
  }

  else if (
    item.type === "sticker"
  ) {
    node.classList.add(
      "stickerLayer"
    );

    node.textContent =
      item.sticker || "✨";
  }

  else {
    const media =
      document.createElement(
        item.type === "video"
          ? "video"
          : "img"
      );

    media.src =
      await mediaURL(item);

    if (
      item.type === "video"
    ) {
      media.playsInline = true;
      media.preload = "auto";
    }

    node.append(media);
  }

  $("#canvas").append(node);

  canvasNodes.set(
    item.id,
    node
  );

  return node;
}

/* =========================================================
   EASING
========================================================= */

function easing(name, t) {
  t = clamp(t, 0, 1);

  switch (name) {

    case "linear":
      return t;

    case "easeIn":
      return t * t * t;

    case "easeOut":
      return (
        1 -
        Math.pow(1 - t, 3)
      );

    case "easeInOut":
      return (
        t < .5
          ? 4 * t * t * t
          : 1 -
            Math.pow(
              -2 * t + 2,
              3
            ) / 2
      );

    case "back": {
      const c1 = 1.70158;
      const c3 = c1 + 1;

      return (
        c3 * t * t * t -
        c1 * t * t
      );
    }

    case "bounce":
      return easeOutBounce(t);

    case "elastic": {
      if (
        t === 0 ||
        t === 1
      ) {
        return t;
      }

      const c =
        (2 * Math.PI) / 3;

      return (
        Math.pow(2, -10 * t) *
        Math.sin(
          (t * 10 - .75) * c
        ) +
        1
      );
    }

    case "spring":
      return (
        1 -
        Math.exp(-6 * t) *
        Math.cos(10 * t)
      );

    default:
      return t;
  }
}

function easeOutBounce(x) {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (x < 1 / d1) {
    return n1 * x * x;
  }

  if (x < 2 / d1) {
    x -= 1.5 / d1;

    return (
      n1 * x * x + .75
    );
  }

  if (x < 2.5 / d1) {
    x -= 2.25 / d1;

    return (
      n1 * x * x + .9375
    );
  }

  x -= 2.625 / d1;

  return (
    n1 * x * x + .984375
  );
}

/* =========================================================
   KEYFRAME VALUE
========================================================= */

function evaluatedItem(item) {
  const keys =
    [...(item.keyframes || [])]
      .sort(
        (a, b) =>
          a.time - b.time
      );

  if (!keys.length) {
    return { ...item };
  }

  if (
    S.time <= keys[0].time
  ) {
    return {
      ...item,
      ...keys[0]
    };
  }

  if (
    S.time >=
    keys[keys.length - 1].time
  ) {
    return {
      ...item,
      ...keys[keys.length - 1]
    };
  }

  let left = keys[0];
  let right = keys[1];

  for (
    let i = 0;
    i < keys.length - 1;
    i++
  ) {
    if (
      S.time >= keys[i].time &&
      S.time <= keys[i + 1].time
    ) {
      left = keys[i];
      right = keys[i + 1];

      break;
    }
  }

  const raw =
    (S.time - left.time) /
    Math.max(
      .0001,
      right.time - left.time
    );

  const t =
    easing(
      right.easing ||
      "easeInOut",
      raw
    );

  const value = {
    ...item
  };

  for (
    const property of [
      "x",
      "y",
      "w",
      "h",
      "rotation",
      "opacity"
    ]
  ) {
    value[property] =
      left[property] +
      (
        right[property] -
        left[property]
      ) *
      t;
  }

  return value;
}

/* =========================================================
   ANIMATION HELPERS
========================================================= */

function animationProgress(
  item,
  animation,
  position
) {
  if (!animation) return null;

  const duration =
    Math.max(
      .05,
      animation.duration || .5
    );

  if (position === "in") {
    const local =
      S.time - item.start;

    if (
      local < 0 ||
      local > duration
    ) {
      return null;
    }

    return clamp(
      local / duration,
      0,
      1
    );
  }

  if (position === "out") {
    const local =
      item.end - S.time;

    if (
      local < 0 ||
      local > duration
    ) {
      return null;
    }

    return clamp(
      local / duration,
      0,
      1
    );
  }

  return null;
}

/* =========================================================
   STANDARD ANIMATIONS
========================================================= */

function applyStandardAnimations(
  item,
  value
) {
  const result = { ...value };

  const inAnim =
    item.animation?.in;

  const outAnim =
    item.animation?.out;

  const loopAnim =
    item.animation?.loop;

  let p =
    animationProgress(
      item,
      inAnim,
      "in"
    );

  if (
    p !== null &&
    inAnim
  ) {
    const strength =
      (inAnim.strength || 100) /
      100;

    switch (inAnim.name) {

      case "フェード":
        result.opacity *= p;
        break;

      case "ポップ": {
        const s =
          .15 +
          .85 *
          easing("back", p);

        result.w *= s;
        result.h *= s;
        break;
      }

      case "左から":
        result.x -=
          (1 - p) *
          180 *
          strength;
        break;

      case "右から":
        result.x +=
          (1 - p) *
          180 *
          strength;
        break;

      case "上から":
        result.y -=
          (1 - p) *
          180 *
          strength;
        break;

      case "下から":
        result.y +=
          (1 - p) *
          180 *
          strength;
        break;
    }
  }

  p =
    animationProgress(
      item,
      outAnim,
      "out"
    );

  if (
    p !== null &&
    outAnim
  ) {
    const strength =
      (outAnim.strength || 100) /
      100;

    switch (outAnim.name) {

      case "フェード":
        result.opacity *= p;
        break;

      case "縮小":
        result.w *= p;
        result.h *= p;
        break;

      case "左へ":
        result.x -=
          (1 - p) *
          180 *
          strength;
        break;

      case "右へ":
        result.x +=
          (1 - p) *
          180 *
          strength;
        break;

      case "上へ":
        result.y -=
          (1 - p) *
          180 *
          strength;
        break;

      case "下へ":
        result.y +=
          (1 - p) *
          180 *
          strength;
        break;
    }
  }

  if (
    loopAnim &&
    S.time >= item.start &&
    S.time <= item.end
  ) {
    const local =
      S.time - item.start;

    const strength =
      (loopAnim.strength || 100) /
      100;

    switch (loopAnim.name) {

      case "揺れる":
        result.rotation +=
          Math.sin(local * 7) *
          5 *
          strength;
        break;

      case "浮く":
        result.y +=
          Math.sin(local * 4) *
          10 *
          strength;
        break;

      case "回転":
        result.rotation +=
          local * 90 * strength;
        break;

      case "脈動": {
        const s =
          1 +
          Math.sin(local * 5) *
          .035 *
          strength;

        result.w *= s;
        result.h *= s;

        break;
      }
    }
  }

  return result;
}

/* =========================================================
   PB ANIMATIONS — 10 TYPES
========================================================= */

function applyPBAnimation(
  item,
  value
) {
  const anim =
    item.animation?.pb;

  if (
    !anim ||
    S.time < item.start ||
    S.time > item.end
  ) {
    return value;
  }

  const result = { ...value };

  const local =
    S.time - item.start;

  const strength =
    (anim.strength || 100) /
    100;

  const duration =
    Math.max(
      .1,
      anim.duration || .7
    );

  const count =
    anim.count || 1;

  const cycle =
    (
      local /
      duration
    ) %
    1;

  switch (anim.name) {

    /* 1 */
    case "ぷるん": {
      const q =
        Math.sin(
          cycle *
          Math.PI *
          2 *
          count
        ) *
        Math.exp(
          -cycle * 2
        );

      result.w *=
        1 +
        q *
        .07 *
        strength;

      result.h *=
        1 -
        q *
        .07 *
        strength;

      break;
    }

    /* 2 */
    case "歩く": {
      const step =
        Math.sin(
          local * 10
        );

      result.y -=
        Math.abs(step) *
        5 *
        strength;

      result.rotation +=
        step *
        3 *
        strength;

      break;
    }

    /* 3 */
    case "走る": {
      const step =
        Math.sin(
          local * 18
        );

      result.y -=
        Math.abs(step) *
        9 *
        strength;

      result.rotation +=
        step *
        5 *
        strength;

      result.w *=
        1.04;

      result.h *=
        .96;

      break;
    }

    /* 4 */
    case "ジャンプ": {
      const jump =
        Math.sin(
          Math.PI * cycle
        );

      result.y -=
        jump *
        75 *
        strength;

      if (cycle < .15) {
        result.w *= 1.07;
        result.h *= .93;
      }

      break;
    }

    /* 5 */
    case "着地": {
      if (cycle < .3) {
        const q =
          1 -
          cycle / .3;

        result.w *=
          1 +
          q *
          .16 *
          strength;

        result.h *=
          1 -
          q *
          .16 *
          strength;
      }

      break;
    }

    /* 6 */
    case "怒り": {
      result.x +=
        Math.sin(
          local * 42
        ) *
        5 *
        strength;

      result.rotation +=
        Math.sin(
          local * 37
        ) *
        2.5 *
        strength;

      break;
    }

    /* 7 */
    case "衝突": {
      if (cycle < .2) {
        const impact =
          1 -
          cycle / .2;

        result.w *=
          1 +
          impact *
          .18 *
          strength;

        result.h *=
          1 -
          impact *
          .18 *
          strength;

        result.x -=
          impact *
          15 *
          strength;
      }

      break;
    }

    /* 8 */
    case "吹っ飛ぶ": {
      const p =
        clamp(
          local / duration,
          0,
          1
        );

      result.x +=
        p *
        280 *
        strength;

      result.y -=
        Math.sin(
          Math.PI * p
        ) *
        100 *
        strength;

      result.rotation +=
        p *
        420 *
        strength;

      break;
    }

    /* 9 */
    case "転がる": {
      const p =
        clamp(
          local / duration,
          0,
          1
        );

      result.x +=
        p *
        180 *
        strength;

      result.rotation +=
        p *
        720 *
        strength;

      break;
    }

    /* 10 */
    case "呼吸": {
      const q =
        Math.sin(
          local * 3.4
        );

      result.w *=
        1 +
        q *
        .018 *
        strength;

      result.h *=
        1 +
        q *
        .018 *
        strength;

      break;
    }
  }

  return result;
}

/* =========================================================
   CROP
========================================================= */

function applyCropToMedia(
  item,
  media
) {
  const crop =
    item.crop || {
      x: 0,
      y: 0,
      w: 1,
      h: 1
    };

  /*
    object-position + scale approximation.
    Dedicated crop editor modifies these values.
  */

  const scaleX =
    1 / Math.max(.01, crop.w);

  const scaleY =
    1 / Math.max(.01, crop.h);

  media.style.width =
    `${scaleX * 100}%`;

  media.style.height =
    `${scaleY * 100}%`;

  media.style.maxWidth = "none";
  media.style.maxHeight = "none";

  media.style.position =
    "absolute";

  media.style.left =
    `${-crop.x * scaleX * 100}%`;

  media.style.top =
    `${-crop.y * scaleY * 100}%`;

  media.style.objectFit =
    "cover";
}

/* =========================================================
   TEXT STYLE
========================================================= */

function renderText(item, node) {
  const inner =
    node.querySelector(".textInner");

  if (!inner) return;

  inner.textContent =
    item.text || "";

  node.style.fontSize =
    `${item.fontSize || 32}px`;

  node.style.color =
    item.color || "#ffffff";

  node.style.webkitTextStroke =
    item.stroke
      ? `${item.stroke}px ${
          item.strokeColor ||
          "#000000"
        }`
      : "0";

  const shadow =
    item.shadow || 0;

  node.style.textShadow =
    shadow
      ? `0 ${shadow / 3}px ${shadow}px #000`
      : "none";

  inner.style.background =
    item.textBackgroundEnabled
      ? (
          item.textBackground ||
          "#000000"
        )
      : "transparent";
}

/* =========================================================
   SCENE RENDER
========================================================= */

async function renderScene() {
  updateCanvasAspect();

  for (
    let index = 0;
    index < S.items.length;
    index++
  ) {
    const item =
      S.items[index];

    if (
      item.type === "audio"
    ) {
      continue;
    }

    let node =
      canvasNodes.get(item.id);

    if (!node) {
      node =
        await createCanvasNode(item);
    }

    let value =
      evaluatedItem(item);

    value =
      applyStandardAnimations(
        item,
        value
      );

    value =
      applyPBAnimation(
        item,
        value
      );

    const inRange =
      S.time >= item.start &&
      S.time <= item.end;

    const visible =
      inRange &&
      item.visible !== false;

    node.style.visibility =
      visible
        ? "visible"
        : "hidden";

    node.classList.toggle(
      "selected",
      item.id === S.selected
    );

    node.classList.toggle(
      "locked",
      !!item.locked
    );

    node.style.width =
      `${value.w}px`;

    node.style.height =
      `${value.h}px`;

    node.style.transform = `
      translate3d(
        ${value.x}px,
        ${value.y}px,
        0
      )
      rotate(
        ${value.rotation || 0}deg
      )
      scale(
        ${item.flipX ? -1 : 1},
        ${item.flipY ? -1 : 1}
      )
    `;

    node.style.opacity =
      (value.opacity ?? 100) /
      100;

    node.style.zIndex =
      index + 1;

    node.style.filter = `
      brightness(
        ${item.brightness ?? 100}%
      )
      contrast(
        ${item.contrast ?? 100}%
      )
      saturate(
        ${item.saturation ?? 100}%
      )
    `;

    if (
      item.type === "text"
    ) {
      renderText(
        item,
        node
      );
    }

    if (
      item.type === "sticker"
    ) {
      node.textContent =
        item.sticker || "✨";
    }

    if (
      item.type === "image"
    ) {
      const image =
        node.querySelector("img");

      if (image) {
        applyCropToMedia(
          item,
          image
        );
      }
    }

    if (
      item.type === "video"
    ) {
      const video =
        node.querySelector("video");

      if (!video) continue;

      applyCropToMedia(
        item,
        video
      );

      const target =
        item.sourceIn +
        (
          S.time -
          item.start
        ) *
        (item.speed || 1);

      video.volume =
        clamp(
          (item.volume ?? 100) /
          100,
          0,
          1
        );

      video.playbackRate =
        clamp(
          item.speed || 1,
          .25,
          4
        );

      if (!visible) {
        video.pause();
        continue;
      }

      const safeTarget =
        clamp(
          target,
          item.sourceIn,
          item.sourceOut
        );

      if (!S.playing) {
        video.pause();

        if (
          Number.isFinite(safeTarget) &&
          Math.abs(
            video.currentTime -
            safeTarget
          ) > .08
        ) {
          try {
            video.currentTime =
              safeTarget;
          } catch {}
        }
      }

      else {
        if (
          Math.abs(
            video.currentTime -
            safeTarget
          ) > .28
        ) {
          try {
            video.currentTime =
              safeTarget;
          } catch {}
        }

        video.play()
          .catch(() => {});
      }
    }
  }

  $("#timeDisplay").textContent =
    `${formatTime(S.time)} / ${formatTime(S.duration)}`;

  updateFloatingKeyButton();
}

/* =========================================================
   TIMELINE SCALE
========================================================= */

function pixelsPerSecond() {
  return 82 * zoom;
}

function centerPadding() {
  return (
    $("#timelineViewport")
      .clientWidth / 2
  );
}

function syncTimelineGeometry() {
  const padding =
    centerPadding();

  const width =
    S.duration *
    pixelsPerSecond();

  $("#timelineContent").style.width =
    `${padding * 2 + width}px`;

  $("#timelineRuler").style.left =
    `${padding}px`;

  $("#timelineRuler").style.width =
    `${width}px`;

  $("#trackContainer").style.marginLeft =
    `${padding}px`;

  $("#trackContainer").style.width =
    `${width}px`;

  renderRuler();
}

/* =========================================================
   RULER
========================================================= */

function renderRuler() {
  const ruler =
    $("#timelineRuler");

  ruler.innerHTML = "";

  const pps =
    pixelsPerSecond();

  let major = 1;

  if (pps < 45) major = 2;
  if (pps < 25) major = 5;
  if (pps > 160) major = .5;

  const minor =
    major / 4;

  for (
    let t = 0;
    t <= S.duration + .001;
    t += minor
  ) {
    const tick =
      document.createElement("i");

    tick.className =
      "rulerTick " +
      (
        Math.abs(
          (t / major) -
          Math.round(t / major)
        ) < .001
          ? "major"
          : "minor"
      );

    tick.style.left =
      `${t * pps}px`;

    ruler.append(tick);
  }

  for (
    let t = 0;
    t <= S.duration + .001;
    t += major
  ) {
    const label =
      document.createElement("span");

    label.className =
      "rulerTime";

    label.style.left =
      `${t * pps}px`;

    label.textContent =
      t < 60
        ? `${t.toFixed(
            major < 1 ? 1 : 0
          )}s`
        : formatTime(t).slice(0, 5);

    ruler.append(label);
  }
}

/* =========================================================
   TRACK FOR ITEM
========================================================= */

function trackElement(item) {
  switch (item.track) {
    case "main":
      return $("#mainTrackClips");

    case "text":
      return $("#textTrackClips");

    case "pip":
      return $("#pipTrackClips");

    case "sticker":
      return $("#stickerTrackClips");

    case "music":
      return $("#musicTrackClips");

    case "sfx":
      return $("#sfxTrackClips");

    default:
      return $("#pipTrackClips");
  }
}

/* =========================================================
   WAVEFORM DOM
========================================================= */

function makeWaveformCanvas(item) {
  const canvas =
    document.createElement("canvas");

  canvas.className =
    "clipWaveform";

  canvas.width = 600;
  canvas.height = 80;

  const ctx =
    canvas.getContext("2d");

  const peaks =
    item.waveform || [];

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.strokeStyle =
    "rgba(255,255,255,.85)";

  ctx.lineWidth = 1;

  ctx.beginPath();

  const mid =
    canvas.height / 2;

  if (peaks.length) {
    peaks.forEach(
      (value, index) => {
        const x =
          index /
          Math.max(
            1,
            peaks.length - 1
          ) *
          canvas.width;

        const h =
          value *
          canvas.height *
          .42;

        ctx.moveTo(
          x,
          mid - h
        );

        ctx.lineTo(
          x,
          mid + h
        );
      }
    );
  }

  ctx.stroke();

  return canvas;
}

/* =========================================================
   TIMELINE RENDER
========================================================= */

function renderTimeline() {
  for (
    const id of [
      "mainTrackClips",
      "textTrackClips",
      "pipTrackClips",
      "stickerTrackClips",
      "musicTrackClips",
      "sfxTrackClips"
    ]
  ) {
    $("#" + id).innerHTML = "";
  }

  syncTimelineGeometry();

  for (const item of S.items) {
    const clip =
      document.createElement("div");

    clip.className =
      `timelineClip ${item.track}` +
      (
        item.id === S.selected
          ? " selected"
          : ""
      ) +
      (
        item.locked
          ? " locked"
          : ""
      ) +
      (
        item.visible === false
          ? " invisibleClip"
          : ""
      );

    clip.dataset.id =
      item.id;

    clip.style.left =
      `${item.start *
        pixelsPerSecond()}px`;

    clip.style.width =
      `${Math.max(
        20,
        (
          item.end -
          item.start
        ) *
        pixelsPerSecond()
      )}px`;

    if (
      item.type === "audio"
    ) {
      clip.append(
        makeWaveformCanvas(item)
      );
    }

    const name =
      document.createElement("span");

    name.className =
      "clipName";

    name.textContent =
      item.name ||
      item.type;

    clip.append(name);

    if (
      item.id === S.selected
    ) {
      const left =
        document.createElement("i");

      left.className =
        "trimHandle left";

      left.dataset.trim =
        "left";

      const right =
        document.createElement("i");

      right.className =
        "trimHandle right";

      right.dataset.trim =
        "right";

      clip.append(
        left,
        right
      );

      for (
        const key of
        item.keyframes || []
      ) {
        const marker =
          document.createElement("i");

        marker.className =
          "keyframeMarker";

        if (
          Math.abs(
            key.time - S.time
          ) < .03
        ) {
          marker.classList.add(
            "current"
          );
        }

        marker.style.left =
          `${
            (
              key.time -
              item.start
            ) *
            pixelsPerSecond()
          }px`;

        clip.append(marker);
      }
    }

    trackElement(item)
      .append(clip);
  }
}

/* =========================================================
   SEEK
========================================================= */

function seekTo(time) {
  S.time =
    clamp(
      time,
      0,
      S.duration
    );

  scrollSync = true;

  $("#timelineViewport")
    .scrollLeft =
      S.time *
      pixelsPerSecond();

  requestAnimationFrame(() => {
    scrollSync = false;
  });

  renderScene();
}

/* =========================================================
   TIMELINE SCROLL
========================================================= */

$("#timelineViewport")
  .addEventListener(
    "scroll",
    () => {
      if (scrollSync) return;

      S.time =
        clamp(
          $("#timelineViewport")
            .scrollLeft /
            pixelsPerSecond(),

          0,
          S.duration
        );

      if (S.playing) {
        stopPlayback();
      }

      renderScene();
    },
    { passive: true }
  );

/* =========================================================
   ZOOM
========================================================= */

function changeZoom(multiplier) {
  const time = S.time;

  zoom =
    clamp(
      zoom * multiplier,
      .4,
      4
    );

  renderTimeline();

  requestAnimationFrame(
    () => seekTo(time)
  );
}

$("#timelineZoomIn").onclick =
  () => changeZoom(1.25);

$("#timelineZoomOut").onclick =
  () => changeZoom(.8);

$("#timelineFitBtn").onclick =
  () => {
    const viewport =
      $("#timelineViewport")
        .clientWidth;

    zoom =
      clamp(
        (
          viewport -
          30
        ) /
        Math.max(
          1,
          S.duration * 82
        ),
        .4,
        4
      );

    renderTimeline();

    requestAnimationFrame(
      () => seekTo(S.time)
    );
  };

/* =========================================================
   KEYFRAMES
========================================================= */

function transformKey(item) {
  return {
    time: S.time,

    x: item.x,
    y: item.y,

    w: item.w,
    h: item.h,

    rotation:
      item.rotation || 0,

    opacity:
      item.opacity ?? 100,

    easing:
      "easeInOut"
  };
}

function addKeyframe(item) {
  if (!item) return;

  item.keyframes ||= [];

  const existing =
    item.keyframes.findIndex(
      k =>
        Math.abs(
          k.time - S.time
        ) < .03
    );

  const key =
    transformKey(item);

  if (existing >= 0) {
    key.easing =
      item.keyframes[
        existing
      ].easing ||
      "easeInOut";

    item.keyframes[
      existing
    ] = key;
  }

  else {
    item.keyframes.push(key);
  }

  item.keyframes.sort(
    (a, b) =>
      a.time - b.time
  );

  saveProject();
  renderTimeline();
  renderScene();

  toast("◇ キーフレーム");
}

function currentKey(item) {
  if (!item) return null;

  return (
    item.keyframes?.find(
      k =>
        Math.abs(
          k.time - S.time
        ) < .035
    ) ||
    null
  );
}

function updateCurrentKey(item) {
  const key =
    currentKey(item);

  if (!key) return;

  const easingName =
    key.easing;

  Object.assign(
    key,
    transformKey(item)
  );

  key.easing =
    easingName;
}

function nearestKey(
  item,
  direction
) {
  if (!item?.keyframes?.length) {
    return null;
  }

  const sorted =
    [...item.keyframes]
      .sort(
        (a, b) =>
          a.time - b.time
      );

  if (direction < 0) {
    return (
      [...sorted]
        .reverse()
        .find(
          k =>
            k.time <
            S.time - .03
        ) ||
      null
    );
  }

  return (
    sorted.find(
      k =>
        k.time >
        S.time + .03
    ) ||
    null
  );
}

function jumpKey(direction) {
  const item =
    selectedItem();

  const key =
    nearestKey(
      item,
      direction
    );

  if (!key) {
    toast(
      direction < 0
        ? "前のキーはありません"
        : "次のキーはありません"
    );

    return;
  }

  seekTo(key.time);
}

function updateFloatingKeyButton() {
  const button =
    $("#floatingKeyframeBtn");

  const item =
    selectedItem();

  button.hidden =
    !item ||
    item.type === "audio";

  button.classList.toggle(
    "active",
    !!currentKey(item)
  );
}

$("#floatingKeyframeBtn").onclick =
  () => {
    const item =
      selectedItem();

    if (!item) return;

    pushHistory();

    addKeyframe(item);
  };

$("#previousKeyBtn").onclick =
  () => jumpKey(-1);

$("#nextKeyBtn").onclick =
  () => jumpKey(1);

/* =========================================================
   PLAYBACK
========================================================= */

function startPlayback() {
  if (
    S.time >= S.duration
  ) {
    seekTo(0);
  }

  S.playing = true;

  $("#playBtn").textContent =
    "Ⅱ";

  lastFrame = 0;

  playAudioTracks();

  raf =
    requestAnimationFrame(
      playbackTick
    );
}

function stopPlayback() {
  S.playing = false;

  cancelAnimationFrame(raf);

  $("#playBtn").textContent =
    "▶";

  lastFrame = 0;

  for (
    const node of
    canvasNodes.values()
  ) {
    node.querySelector("video")
      ?.pause();
  }

  stopAudioTracks();
}

function playbackTick(timestamp) {
  if (!S.playing) return;

  if (!lastFrame) {
    lastFrame = timestamp;
  }

  const delta =
    (
      timestamp -
      lastFrame
    ) / 1000;

  lastFrame = timestamp;

  S.time += delta;

  if (
    S.time >= S.duration
  ) {
    S.time = S.duration;

    seekTo(S.time);

    stopPlayback();

    return;
  }

  scrollSync = true;

  $("#timelineViewport")
    .scrollLeft =
      S.time *
      pixelsPerSecond();

  scrollSync = false;

  renderScene();

  raf =
    requestAnimationFrame(
      playbackTick
    );
}

$("#playBtn").onclick =
  () => {
    if (S.playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  };

$("#jumpStartBtn").onclick =
  () => {
    stopPlayback();
    seekTo(0);
  };

/* =========================================================
   AUDIO PLAYBACK
========================================================= */

const activeAudio =
  new Map();

async function playAudioTracks() {
  stopAudioTracks();

  for (
    const item of
    S.items.filter(
      x =>
        x.type === "audio" &&
        S.time >= x.start &&
        S.time < x.end
    )
  ) {
    const audio =
      new Audio(
        await mediaURL(item)
      );

    audio.volume =
      clamp(
        (item.volume ?? 100) /
        100,
        0,
        1
      );

    audio.playbackRate =
      item.speed || 1;

    const sourceTime =
      item.sourceIn +
      (
        S.time -
        item.start
      ) *
      (item.speed || 1);

    try {
      audio.currentTime =
        sourceTime;
    } catch {}

    audio.play()
      .catch(() => {});

    activeAudio.set(
      item.id,
      audio
    );
  }
}

function stopAudioTracks() {
  for (
    const audio of
    activeAudio.values()
  ) {
    audio.pause();
  }

  activeAudio.clear();
}

/* =========================================================
   CANVAS POINTERS
========================================================= */

$("#canvas").addEventListener(
  "pointerdown",
  event => {
    const layer =
      event.target.closest(
        ".canvasLayer"
      );

    if (!layer) {
      S.selected = null;

      updateToolbar();
      renderScene();
      renderTimeline();

      return;
    }

    const item =
      S.items.find(
        x =>
          x.id ===
          layer.dataset.id
      );

    if (!item) return;

    S.selected = item.id;

    updateToolbar();
    renderTimeline();
    renderScene();

    if (item.locked) {
      toast("🔒 ロック中");
      return;
    }

    pointers.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY
      }
    );

    $("#canvas")
      .setPointerCapture?.(
        event.pointerId
      );

    if (
      pointers.size === 1
    ) {
      pushHistory();

      historyGestureStarted =
        true;

      canvasGesture = {
        type: "move",

        x: item.x,
        y: item.y,

        startX:
          event.clientX,

        startY:
          event.clientY
      };
    }

    if (
      pointers.size === 2
    ) {
      const points =
        [...pointers.values()];

      const dx =
        points[1].x -
        points[0].x;

      const dy =
        points[1].y -
        points[0].y;

      canvasGesture = {
        type: "pinch",

        distance:
          Math.hypot(dx, dy),

        angle:
          Math.atan2(dy, dx),

        w: item.w,
        h: item.h,

        rotation:
          item.rotation || 0
      };
    }

    event.preventDefault();
  }
);

/* =========================================================
   CANVAS MOVE
========================================================= */

$("#canvas").addEventListener(
  "pointermove",
  event => {
    if (
      !pointers.has(
        event.pointerId
      )
    ) {
      return;
    }

    pointers.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY
      }
    );

    const item =
      selectedItem();

    if (
      !item ||
      item.locked
    ) {
      return;
    }

    const points =
      [...pointers.values()];

    if (
      points.length === 1 &&
      canvasGesture?.type ===
      "move"
    ) {
      item.x =
        canvasGesture.x +
        points[0].x -
        canvasGesture.startX;

      item.y =
        canvasGesture.y +
        points[0].y -
        canvasGesture.startY;

      applySnapping(item);

      updateCurrentKey(item);

      renderScene();
    }

    if (
      points.length === 2 &&
      canvasGesture?.type ===
      "pinch"
    ) {
      const dx =
        points[1].x -
        points[0].x;

      const dy =
        points[1].y -
        points[0].y;

      const distance =
        Math.hypot(dx, dy);

      const scale =
        distance /
        Math.max(
          1,
          canvasGesture.distance
        );

      item.w =
        Math.max(
          18,
          canvasGesture.w *
          scale
        );

      item.h =
        Math.max(
          18,
          canvasGesture.h *
          scale
        );

      item.rotation =
        canvasGesture.rotation +
        (
          Math.atan2(dy, dx) -
          canvasGesture.angle
        ) *
        180 /
        Math.PI;

      updateCurrentKey(item);

      renderScene();
    }

    event.preventDefault();
  }
);

function endCanvasPointer(
  event
) {
  pointers.delete(
    event.pointerId
  );

  hideGuides();

  if (!pointers.size) {
    canvasGesture = null;

    historyGestureStarted =
      false;

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
   GUIDES / SNAP
========================================================= */

function hideGuides() {
  $$(".snapGuide").forEach(
    x =>
      x.classList.remove(
        "show"
      )
  );
}

function applySnapping(item) {
  hideGuides();

  const canvas =
    $("#canvas");

  const cw =
    canvas.clientWidth;

  const ch =
    canvas.clientHeight;

  const threshold = 8;

  let cx =
    item.x + item.w / 2;

  let cy =
    item.y + item.h / 2;

  if (
    Math.abs(
      cx - cw / 2
    ) < threshold
  ) {
    item.x =
      cw / 2 -
      item.w / 2;

    $("#guideX")
      .classList.add("show");
  }

  if (
    Math.abs(
      cy - ch / 2
    ) < threshold
  ) {
    item.y =
      ch / 2 -
      item.h / 2;

    $("#guideY")
      .classList.add("show");
  }

  if (
    Math.abs(item.x) <
    threshold
  ) {
    item.x = 0;

    $("#guideLeft")
      .classList.add("show");
  }

  if (
    Math.abs(item.y) <
    threshold
  ) {
    item.y = 0;

    $("#guideTop")
      .classList.add("show");
  }

  if (
    Math.abs(
      item.x +
      item.w -
      cw
    ) < threshold
  ) {
    item.x =
      cw - item.w;

    $("#guideRight")
      .classList.add("show");
  }

  if (
    Math.abs(
      item.y +
      item.h -
      ch
    ) < threshold
  ) {
    item.y =
      ch - item.h;

    $("#guideBottom")
      .classList.add("show");
  }

  /* Other-object snapping */

  cx =
    item.x + item.w / 2;

  cy =
    item.y + item.h / 2;

  for (
    const other of
    S.items
  ) {
    if (
      other.id === item.id ||
      other.type === "audio" ||
      other.visible === false
    ) {
      continue;
    }

    if (
      S.time < other.start ||
      S.time > other.end
    ) {
      continue;
    }

    const ox =
      other.x +
      other.w / 2;

    const oy =
      other.y +
      other.h / 2;

    if (
      Math.abs(
        cx - ox
      ) < threshold
    ) {
      item.x =
        ox -
        item.w / 2;

      const guide =
        $("#objectGuideX");

      guide.style.left =
        `${ox}px`;

      guide.classList.add(
        "show"
      );
    }

    if (
      Math.abs(
        cy - oy
      ) < threshold
    ) {
      item.y =
        oy -
        item.h / 2;

      const guide =
        $("#objectGuideY");

      guide.style.top =
        `${oy}px`;

      guide.classList.add(
        "show"
      );
    }
  }
}

/* =========================================================
   TOOLBAR
========================================================= */

function updateToolbar() {
  const selected =
    !!selectedItem();

  $("#mainToolbar").hidden =
    selected;

  $("#clipToolbar").hidden =
    !selected;

  $("#pasteButton").hidden =
    !copiedItem;
}

/* =========================================================
   END OF PART 1
   PART 2 CONTINUES DIRECTLY BELOW THIS LINE
========================================================= */
/* =========================================================
   TIMELINE POINTER / SELECT / TRIM / MOVE
========================================================= */

$("#trackContainer").addEventListener("pointerdown", event => {
  const clip = event.target.closest(".timelineClip");
  if (!clip) return;

  const item = S.items.find(x => x.id === clip.dataset.id);
  if (!item) return;

  S.selected = item.id;
  updateToolbar();
  renderTimeline();
  renderScene();

  if (item.locked) {
    toast("🔒 ロック中");
    return;
  }

  const trim = event.target.closest(".trimHandle");

  pushHistory();

  timelineGesture = {
    pointerId: event.pointerId,
    type: trim ? "trim" : "move",
    side: trim?.dataset.trim || null,
    startX: event.clientX,
    start: item.start,
    end: item.end,
    sourceIn: item.sourceIn,
    sourceOut: item.sourceOut
  };

  clip.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

$("#trackContainer").addEventListener("pointermove", event => {
  if (!timelineGesture || timelineGesture.pointerId !== event.pointerId) return;

  const item = selectedItem();
  if (!item || item.locked) return;

  const delta =
    (event.clientX - timelineGesture.startX) /
    pixelsPerSecond();

  if (timelineGesture.type === "move") {
    if (item.track === "main") {
      return;
    }

    const duration =
      timelineGesture.end -
      timelineGesture.start;

    item.start = Math.max(
      0,
      timelineGesture.start + delta
    );

    item.end =
      item.start + duration;
  }

  if (timelineGesture.type === "trim") {
    if (timelineGesture.side === "left") {
      const maxStart =
        timelineGesture.end - .05;

      const newStart =
        clamp(
          timelineGesture.start + delta,
          0,
          maxStart
        );

      const timelineDelta =
        newStart -
        timelineGesture.start;

      item.start = newStart;

      if (
        item.type === "video" ||
        item.type === "audio"
      ) {
        item.sourceIn =
          clamp(
            timelineGesture.sourceIn +
            timelineDelta *
            (item.speed || 1),
            0,
            item.sourceOut - .01
          );
      }
    }

    if (timelineGesture.side === "right") {
      const minEnd =
        item.start + .05;

      let newEnd =
        Math.max(
          minEnd,
          timelineGesture.end + delta
        );

      if (
        item.type === "video" ||
        item.type === "audio"
      ) {
        const maxSource =
          item.sourceDuration || item.sourceOut;

        const proposedSourceOut =
          timelineGesture.sourceOut +
          delta *
          (item.speed || 1);

        item.sourceOut =
          clamp(
            proposedSourceOut,
            item.sourceIn + .01,
            maxSource
          );

        newEnd =
          item.start +
          (
            item.sourceOut -
            item.sourceIn
          ) /
          (item.speed || 1);
      }

      item.end = newEnd;
    }

    if (item.track === "main") {
      reconnectMainTrack();
    }
  }

  recalcDuration();
  renderTimeline();
  renderScene();

  event.preventDefault();
});

function endTimelineGesture(event) {
  if (
    !timelineGesture ||
    timelineGesture.pointerId !== event.pointerId
  ) {
    return;
  }

  timelineGesture = null;

  reconnectMainTrack();
  recalcDuration();

  renderTimeline();
  renderScene();

  saveProject();
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
   SPLIT
========================================================= */

function splitSelected() {
  const item = selectedItem();

  if (!item) return;

  if (
    S.time <= item.start + .02 ||
    S.time >= item.end - .02
  ) {
    toast("再生ヘッドをクリップ内に置いてください");
    return;
  }

  pushHistory();

  const right = clone(item);

  right.id = uid();

  const oldEnd = item.end;

  if (
    item.type === "video" ||
    item.type === "audio"
  ) {
    const cut =
      item.sourceIn +
      (
        S.time -
        item.start
      ) *
      (item.speed || 1);

    item.sourceOut = cut;
    right.sourceIn = cut;
  }

  item.end = S.time;

  right.start = S.time;
  right.end = oldEnd;

  right.keyframes =
    (right.keyframes || [])
      .filter(k => k.time >= S.time);

  item.keyframes =
    (item.keyframes || [])
      .filter(k => k.time <= S.time);

  const index =
    S.items.indexOf(item);

  S.items.splice(
    index + 1,
    0,
    right
  );

  S.selected = right.id;

  reconnectMainTrack();
  recalcDuration();

  rebuildCanvas().then(() => {
    renderTimeline();
    renderScene();
  });

  saveProject();
  toast("分割しました");
}

/* =========================================================
   DELETE / DUPLICATE
========================================================= */

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  const id = item.id;

  S.items =
    S.items.filter(x => x.id !== id);

  canvasNodes.get(id)?.remove();
  canvasNodes.delete(id);

  S.selected = null;

  reconnectMainTrack();
  recalcDuration();

  renderTimeline();
  renderScene();
  updateToolbar();

  saveProject();

  toast("削除しました");
}

function duplicateSelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  const copy = clone(item);

  copy.id = uid();
  copy.name =
    (item.name || "素材") +
    " コピー";

  if (item.track === "main") {
    copy.start = item.end;
    copy.end =
      copy.start +
      (
        item.end -
        item.start
      );
  } else {
    const duration =
      item.end - item.start;

    copy.start =
      Math.min(
        S.duration,
        item.start + .2
      );

    copy.end =
      copy.start + duration;

    copy.x += 15;
    copy.y += 15;
  }

  copy.keyframes =
    (copy.keyframes || [])
      .map(k => ({
        ...k,
        time:
          k.time +
          (
            copy.start -
            item.start
          )
      }));

  S.items.push(copy);

  S.selected = copy.id;

  reconnectMainTrack();
  recalcDuration();

  rebuildCanvas().then(() => {
    renderTimeline();
    renderScene();
  });

  saveProject();

  toast("複製しました");
}

/* =========================================================
   COPY / PASTE
========================================================= */

function copySelected() {
  const item = selectedItem();
  if (!item) return;

  copiedItem = clone(item);

  $("#pasteButton").hidden = false;

  toast("コピーしました");
}

function pasteCopied() {
  if (!copiedItem) return;

  pushHistory();

  const copy = clone(copiedItem);

  copy.id = uid();

  const duration =
    Math.max(
      .1,
      copiedItem.end -
      copiedItem.start
    );

  copy.track =
    copiedItem.track === "main"
      ? "pip"
      : copiedItem.track;

  copy.start = S.time;
  copy.end =
    S.time + duration;

  copy.x += 18;
  copy.y += 18;

  const timeShift =
    copy.start -
    copiedItem.start;

  copy.keyframes =
    (copy.keyframes || [])
      .map(k => ({
        ...k,
        time:
          k.time + timeShift
      }));

  S.items.push(copy);

  S.selected = copy.id;

  recalcDuration();

  rebuildCanvas().then(() => {
    renderTimeline();
    renderScene();
  });

  updateToolbar();
  saveProject();

  toast("貼り付けました");
}

$("#pasteButton").onclick =
  pasteCopied;

/* =========================================================
   TEXT
========================================================= */

let editingTextId = null;

function createText() {
  pushHistory();

  const item = baseItem();

  item.type = "text";
  item.track = "text";

  item.name = "TEXT";
  item.text = "TEXT";

  item.fontSize = 32;
  item.color = "#ffffff";

  item.stroke = 0;
  item.strokeColor = "#000000";

  item.shadow = 0;

  item.textBackground =
    "#000000";

  item.textBackgroundEnabled =
    false;

  item.start = S.time;

  item.end =
    Math.max(
      S.time + 3,
      Math.min(
        S.duration,
        S.time + 5
      )
    );

  item.w = 220;
  item.h = 80;

  const canvas = $("#canvas");

  item.x =
    canvas.clientWidth / 2 -
    item.w / 2;

  item.y =
    canvas.clientHeight / 2 -
    item.h / 2;

  S.items.push(item);
  S.selected = item.id;

  recalcDuration();

  rebuildCanvas().then(() => {
    renderTimeline();
    renderScene();
  });

  updateToolbar();

  openTextEditor(item);
}

function openTextEditor(item) {
  if (!item || item.type !== "text") return;

  editingTextId = item.id;

  $("#textInput").value =
    item.text || "";

  $("#textSize").value =
    item.fontSize || 32;

  $("#textColor").value =
    item.color || "#ffffff";

  $("#textStroke").value =
    item.stroke || 0;

  $("#textStrokeColor").value =
    item.strokeColor || "#000000";

  $("#textShadow").value =
    item.shadow || 0;

  $("#textBackground").value =
    item.textBackground || "#000000";

  $("#textBackgroundEnabled").checked =
    !!item.textBackgroundEnabled;

  $("#textEditor").hidden = false;

  updateTextLivePreview();
}

function updateTextLivePreview() {
  const preview =
    $("#textLivePreview");

  preview.textContent =
    $("#textInput").value || "TEXT";

  preview.style.fontSize =
    `${$("#textSize").value}px`;

  preview.style.color =
    $("#textColor").value;

  preview.style.webkitTextStroke =
    `${$("#textStroke").value}px ${$("#textStrokeColor").value}`;

  const shadow =
    Number($("#textShadow").value);

  preview.style.textShadow =
    shadow
      ? `0 ${shadow / 3}px ${shadow}px #000`
      : "none";

  preview.style.background =
    $("#textBackgroundEnabled").checked
      ? $("#textBackground").value
      : "transparent";
}

[
  "#textInput",
  "#textSize",
  "#textColor",
  "#textStroke",
  "#textStrokeColor",
  "#textShadow",
  "#textBackground",
  "#textBackgroundEnabled"
].forEach(selector => {
  $(selector).addEventListener(
    "input",
    updateTextLivePreview
  );
});

$("#textApply").onclick = () => {
  const item =
    S.items.find(
      x => x.id === editingTextId
    );

  if (!item) {
    $("#textEditor").hidden = true;
    return;
  }

  item.text =
    $("#textInput").value || "TEXT";

  item.name =
    item.text.slice(0, 30);

  item.fontSize =
    Number($("#textSize").value);

  item.color =
    $("#textColor").value;

  item.stroke =
    Number($("#textStroke").value);

  item.strokeColor =
    $("#textStrokeColor").value;

  item.shadow =
    Number($("#textShadow").value);

  item.textBackground =
    $("#textBackground").value;

  item.textBackgroundEnabled =
    $("#textBackgroundEnabled").checked;

  $("#textEditor").hidden = true;

  renderScene();
  renderTimeline();

  saveProject();
};

$("#textCancel").onclick = () => {
  $("#textEditor").hidden = true;
};

/* =========================================================
   STICKERS
========================================================= */

function openStickerPanel() {
  $("#stickerPanel").hidden = false;
}

$$("[data-sticker]").forEach(button => {
  button.onclick = () => {
    pushHistory();

    const item = baseItem();

    item.type = "sticker";
    item.track = "sticker";

    item.sticker =
      button.dataset.sticker;

    item.name =
      button.dataset.sticker;

    item.start = S.time;
    item.end = S.time + 3;

    item.w = 90;
    item.h = 90;

    const canvas = $("#canvas");

    item.x =
      canvas.clientWidth / 2 - 45;

    item.y =
      canvas.clientHeight / 2 - 45;

    S.items.push(item);

    S.selected = item.id;

    recalcDuration();

    rebuildCanvas().then(() => {
      renderTimeline();
      renderScene();
    });

    $("#stickerPanel").hidden = true;

    updateToolbar();
    saveProject();
  };
});

$("#stickerClose").onclick =
$("#stickerDone").onclick =
  () => {
    $("#stickerPanel").hidden = true;
  };

/* =========================================================
   AUDIO PANEL
========================================================= */

function openAudioPanel(mode) {
  currentAudioMode = mode;

  $("#audioPanelTitle").textContent =
    mode === "music"
      ? "音楽"
      : "効果音";

  $("#audioPanel").hidden = false;
}

$("#audioFileInput").onchange =
  async event => {
    const file =
      event.target.files?.[0];

    if (!file) return;

    await addAudioFile(
      file,
      currentAudioMode
    );

    event.target.value = "";

    $("#audioPanel").hidden = true;
  };

$("#audioClose").onclick =
$("#audioDone").onclick =
  () => {
    $("#audioPanel").hidden = true;
  };

/*
  PB内蔵音は今のところUIプリセット。
  音声データそのものは外部ファイルに依存させない。
*/
$$("[data-audio-preset]").forEach(button => {
  button.onclick = () => {
    toast(
      `${button.textContent.trim()}：音声ファイルを割り当てる予定`
    );
  };
});

/* =========================================================
   ANIMATION PANEL
========================================================= */

const animationChoices = {
  in: [
    ["フェード", "◐"],
    ["ポップ", "✦"],
    ["左から", "→"],
    ["右から", "←"],
    ["上から", "↓"],
    ["下から", "↑"]
  ],

  out: [
    ["フェード", "◐"],
    ["縮小", "⊙"],
    ["左へ", "←"],
    ["右へ", "→"],
    ["上へ", "↑"],
    ["下へ", "↓"]
  ],

  loop: [
    ["揺れる", "〰"],
    ["浮く", "↕"],
    ["回転", "↻"],
    ["脈動", "◉"]
  ],

  pb: [
    ["ぷるん", "◉"],
    ["歩く", "🚶"],
    ["走る", "➜"],
    ["ジャンプ", "↑"],
    ["着地", "↓"],
    ["怒り", "💢"],
    ["衝突", "✹"],
    ["吹っ飛ぶ", "💨"],
    ["転がる", "↻"],
    ["呼吸", "◎"]
  ]
};

function openAnimationPanel() {
  const item = selectedItem();
  if (!item || item.type === "audio") return;

  selectedAnimationTab = "in";

  $$(".animationTabs button").forEach(
    x => x.classList.toggle(
      "active",
      x.dataset.animationTab === "in"
    )
  );

  renderAnimationList();

  $("#animationPanel").hidden = false;
}

function renderAnimationList() {
  const list =
    $("#animationList");

  list.innerHTML = "";

  const item = selectedItem();

  const current =
    item?.animation?.[
      selectedAnimationTab
    ];

  selectedAnimationName =
    current?.name || null;

  for (
    const [name, icon]
    of animationChoices[
      selectedAnimationTab
    ]
  ) {
    const button =
      document.createElement("button");

    button.className =
      "animationItem";

    if (
      selectedAnimationName === name
    ) {
      button.classList.add("active");
    }

    button.innerHTML =
      `${icon}<span>${name}</span>`;

    button.onclick = () => {
      selectedAnimationName = name;

      $$(".animationItem").forEach(
        x => x.classList.remove("active")
      );

      button.classList.add("active");
    };

    list.append(button);
  }

  if (current) {
    $("#animationDuration").value =
      current.duration || .5;

    $("#animationStrength").value =
      current.strength || 100;

    $("#animationCount").value =
      current.count || 1;
  }

  updateAnimationLabels();
}

$$("[data-animation-tab]").forEach(button => {
  button.onclick = () => {
    selectedAnimationTab =
      button.dataset.animationTab;

    $$(".animationTabs button").forEach(
      x => x.classList.remove("active")
    );

    button.classList.add("active");

    renderAnimationList();
  };
});

function updateAnimationLabels() {
  $("#animationDurationValue").textContent =
    `${Number($("#animationDuration").value).toFixed(1)}秒`;

  $("#animationStrengthValue").textContent =
    `${$("#animationStrength").value}%`;

  $("#animationCountValue").textContent =
    $("#animationCount").value;
}

[
  "#animationDuration",
  "#animationStrength",
  "#animationCount"
].forEach(selector => {
  $(selector).oninput =
    updateAnimationLabels;
});

$("#animationApply").onclick = () => {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.animation ||= {
    in: null,
    out: null,
    loop: null,
    pb: null
  };

  if (selectedAnimationName) {
    item.animation[
      selectedAnimationTab
    ] = {
      name: selectedAnimationName,
      duration:
        Number($("#animationDuration").value),

      strength:
        Number($("#animationStrength").value),

      count:
        Number($("#animationCount").value)
    };
  }

  $("#animationPanel").hidden = true;

  renderScene();
  saveProject();

  toast("アニメーションを設定しました");
};

$("#animationClose").onclick =
  () => {
    $("#animationPanel").hidden = true;
  };

/* =========================================================
   KEYFRAME EDITOR
========================================================= */

function openKeyframePanel() {
  const item = selectedItem();
  if (!item) return;

  $("#keyframePanel").hidden = false;

  const key = currentKey(item);

  $("#keyframeEasing").value =
    key?.easing || "easeInOut";

  drawEasingPreview(
    $("#keyframeEasing").value
  );
}

$("#keyAdd").onclick = () => {
  const item = selectedItem();
  if (!item) return;

  pushHistory();
  addKeyframe(item);

  openKeyframePanel();
};

$("#keyDelete").onclick = () => {
  const item = selectedItem();
  if (!item) return;

  const before =
    item.keyframes?.length || 0;

  pushHistory();

  item.keyframes =
    (item.keyframes || [])
      .filter(
        k =>
          Math.abs(
            k.time - S.time
          ) >= .035
      );

  if (
    item.keyframes.length === before
  ) {
    S.undo.pop();
    toast("この位置にキーはありません");
    return;
  }

  renderTimeline();
  renderScene();
  saveProject();

  toast("キーを削除しました");
};

$("#keyPrevious").onclick =
  () => jumpKey(-1);

$("#keyNext").onclick =
  () => jumpKey(1);

$("#keyframeEasing").onchange = () => {
  const item = selectedItem();
  const key = currentKey(item);

  if (key) {
    pushHistory();

    key.easing =
      $("#keyframeEasing").value;

    saveProject();
  }

  drawEasingPreview(
    $("#keyframeEasing").value
  );
};

$("#keyframeClose").onclick =
$("#keyframeDone").onclick =
  () => {
    $("#keyframePanel").hidden = true;
  };

function drawEasingPreview(name) {
  const canvas =
    $("#easingCanvas");

  const ctx =
    canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle =
    "rgba(255,255,255,.15)";

  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(30, h - 25);
  ctx.lineTo(w - 20, h - 25);
  ctx.moveTo(30, h - 25);
  ctx.lineTo(30, 15);
  ctx.stroke();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;

  ctx.beginPath();

  for (let i = 0; i <= 100; i++) {
    const t = i / 100;

    const x =
      30 +
      t *
      (w - 50);

    const y =
      h -
      25 -
      easing(name, t) *
      (h - 45);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

/* =========================================================
   TRANSFORM SHEET
========================================================= */

function openTransformSheet() {
  const item = selectedItem();
  if (!item) return;

  $("#sheetTitle").textContent =
    "変形";

  $("#sheetContent").innerHTML = `
    <div class="propertyGrid">
      <label>
        X
        <input id="propX" type="number" value="${item.x.toFixed(1)}">
      </label>

      <label>
        Y
        <input id="propY" type="number" value="${item.y.toFixed(1)}">
      </label>

      <label>
        幅
        <input id="propW" type="number" min="1" value="${item.w.toFixed(1)}">
      </label>

      <label>
        高さ
        <input id="propH" type="number" min="1" value="${item.h.toFixed(1)}">
      </label>

      <label>
        回転
        <input id="propRotation" type="number" value="${item.rotation || 0}">
      </label>

      <label>
        不透明度
        <input id="propOpacity" type="number" min="0" max="100" value="${item.opacity ?? 100}">
      </label>
    </div>
  `;

  $("#editSheet").hidden = false;

  $("#sheetApply").onclick = () => {
    pushHistory();

    item.x = Number($("#propX").value);
    item.y = Number($("#propY").value);

    item.w =
      Math.max(
        1,
        Number($("#propW").value)
      );

    item.h =
      Math.max(
        1,
        Number($("#propH").value)
      );

    item.rotation =
      Number($("#propRotation").value);

    item.opacity =
      clamp(
        Number($("#propOpacity").value),
        0,
        100
      );

    updateCurrentKey(item);

    closeSheet();

    renderScene();
    renderTimeline();

    saveProject();
  };
}

/* =========================================================
   FILTER / ADJUST
========================================================= */

function openFilterSheet() {
  const item = selectedItem();
  if (!item) return;

  $("#sheetTitle").textContent =
    "調整";

  $("#sheetContent").innerHTML = `
    <div class="propertyGrid">

      <label class="propertyWide">
        明るさ
        <input id="adjustBrightness"
          type="range"
          min="0"
          max="200"
          value="${item.brightness ?? 100}">
      </label>

      <label class="propertyWide">
        コントラスト
        <input id="adjustContrast"
          type="range"
          min="0"
          max="200"
          value="${item.contrast ?? 100}">
      </label>

      <label class="propertyWide">
        彩度
        <input id="adjustSaturation"
          type="range"
          min="0"
          max="200"
          value="${item.saturation ?? 100}">
      </label>

    </div>
  `;

  $("#editSheet").hidden = false;

  const live = () => {
    item.brightness =
      Number($("#adjustBrightness").value);

    item.contrast =
      Number($("#adjustContrast").value);

    item.saturation =
      Number($("#adjustSaturation").value);

    renderScene();
  };

  $("#adjustBrightness").oninput = live;
  $("#adjustContrast").oninput = live;
  $("#adjustSaturation").oninput = live;

  $("#sheetApply").onclick = () => {
    closeSheet();
    saveProject();
  };
}

/* =========================================================
   SPEED
========================================================= */

function openSpeedSheet() {
  const item = selectedItem();
  if (!item) return;

  $("#sheetTitle").textContent =
    "速度";

  $("#sheetContent").innerHTML = `
    <div class="optionRow">
      ${[.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4]
        .map(
          value =>
            `<button class="optionButton ${
              item.speed === value ? "active" : ""
            }" data-speed="${value}">
              ${value}×
            </button>`
        )
        .join("")}
    </div>
  `;

  $("#editSheet").hidden = false;

  $$("[data-speed]").forEach(button => {
    button.onclick = () => {
      pushHistory();

      item.speed =
        Number(button.dataset.speed);

      if (
        item.type === "video" ||
        item.type === "audio"
      ) {
        item.end =
          item.start +
          (
            item.sourceOut -
            item.sourceIn
          ) /
          item.speed;
      }

      if (item.track === "main") {
        reconnectMainTrack();
      }

      recalcDuration();

      closeSheet();
      renderTimeline();
      renderScene();
      saveProject();
    };
  });
}

/* =========================================================
   VOLUME
========================================================= */

function openVolumeSheet() {
  const item = selectedItem();
  if (!item) return;

  $("#sheetTitle").textContent =
    "音量";

  $("#sheetContent").innerHTML = `
    <div class="propertyGrid">

      <label class="propertyWide">
        音量 ${item.volume ?? 100}%
        <input id="volumeRange"
          type="range"
          min="0"
          max="100"
          value="${item.volume ?? 100}">
      </label>

      <label>
        フェードイン
        <input id="fadeInValue"
          type="number"
          min="0"
          step=".1"
          value="${item.fadeIn || 0}">
      </label>

      <label>
        フェードアウト
        <input id="fadeOutValue"
          type="number"
          min="0"
          step=".1"
          value="${item.fadeOut || 0}">
      </label>

    </div>
  `;

  $("#editSheet").hidden = false;

  $("#sheetApply").onclick = () => {
    pushHistory();

    item.volume =
      Number($("#volumeRange").value);

    item.fadeIn =
      Math.max(
        0,
        Number($("#fadeInValue").value)
      );

    item.fadeOut =
      Math.max(
        0,
        Number($("#fadeOutValue").value)
      );

    closeSheet();
    saveProject();
  };
}

/* =========================================================
   TRIM SHEET
========================================================= */

function openTrimSheet() {
  const item = selectedItem();
  if (!item) return;

  $("#sheetTitle").textContent =
    "トリム";

  $("#sheetContent").innerHTML = `
    <div class="propertyGrid">

      <label>
        開始
        <input id="trimStartValue"
          type="number"
          step=".01"
          value="${item.start.toFixed(2)}">
      </label>

      <label>
        終了
        <input id="trimEndValue"
          type="number"
          step=".01"
          value="${item.end.toFixed(2)}">
      </label>

      ${
        item.type === "video" ||
        item.type === "audio"
          ? `
          <label>
            素材開始
            <input id="sourceInValue"
              type="number"
              step=".01"
              value="${item.sourceIn.toFixed(2)}">
          </label>

          <label>
            素材終了
            <input id="sourceOutValue"
              type="number"
              step=".01"
              value="${item.sourceOut.toFixed(2)}">
          </label>
          `
          : ""
      }

    </div>
  `;

  $("#editSheet").hidden = false;

  $("#sheetApply").onclick = () => {
    pushHistory();

    item.start =
      Math.max(
        0,
        Number($("#trimStartValue").value)
      );

    item.end =
      Math.max(
        item.start + .05,
        Number($("#trimEndValue").value)
      );

    if (
      item.type === "video" ||
      item.type === "audio"
    ) {
      item.sourceIn =
        clamp(
          Number($("#sourceInValue").value),
          0,
          item.sourceDuration
        );

      item.sourceOut =
        clamp(
          Number($("#sourceOutValue").value),
          item.sourceIn + .01,
          item.sourceDuration
        );

      item.end =
        item.start +
        (
          item.sourceOut -
          item.sourceIn
        ) /
        (item.speed || 1);
    }

    if (item.track === "main") {
      reconnectMainTrack();
    }

    recalcDuration();

    closeSheet();

    renderTimeline();
    renderScene();

    saveProject();
  };
}

/* =========================================================
   CANVAS / BACKGROUND
========================================================= */

function openCanvasSheet() {
  $("#sheetTitle").textContent =
    "キャンバス";

  const ratios = [
    "9:16",
    "16:9",
    "1:1",
    "4:5",
    "4:3"
  ];

  $("#sheetContent").innerHTML = `
    <div class="optionRow">
      ${ratios.map(
        ratio =>
          `<button
             class="optionButton ${
               S.aspect === ratio ? "active" : ""
             }"
             data-ratio="${ratio}">
             ${ratio}
           </button>`
      ).join("")}
    </div>
  `;

  $("#editSheet").hidden = false;

  $$("[data-ratio]").forEach(button => {
    button.onclick = () => {
      pushHistory();

      S.aspect =
        button.dataset.ratio;

      updateCanvasAspect();

      closeSheet();

      renderScene();
      saveProject();
    };
  });
}

function openBackgroundSheet() {
  $("#sheetTitle").textContent =
    "背景";

  const colors = [
    "#000000",
    "#111111",
    "#ffffff",
    "#eeeeee",
    "#e94f64",
    "#ed8c3b",
    "#e6ca44",
    "#4caa65",
    "#4d86dd",
    "#7155c8"
  ];

  $("#sheetContent").innerHTML = `
    <div class="optionRow">
      ${colors.map(
        color =>
          `<button
             data-bg="${color}"
             style="
               flex:0 0 45px;
               height:45px;
               border-radius:50%;
               background:${color};
               border:2px solid #777;
             ">
           </button>`
      ).join("")}
    </div>
  `;

  $("#editSheet").hidden = false;

  $$("[data-bg]").forEach(button => {
    button.onclick = () => {
      pushHistory();

      S.background =
        button.dataset.bg;

      updateCanvasAspect();
      closeSheet();

      saveProject();
    };
  });
}

/* =========================================================
   SHEET
========================================================= */

function closeSheet() {
  $("#editSheet").hidden = true;
}

$("#sheetCancel").onclick =
  closeSheet;

/* =========================================================
   CROP
========================================================= */

function openCropEditor() {
  const item = selectedItem();

  if (
    !item ||
    !["image", "video"].includes(item.type)
  ) {
    toast("画像・動画を選択してください");
    return;
  }

  cropBackup =
    clone(item.crop);

  cropState =
    clone(
      item.crop || {
        x: 0,
        y: 0,
        w: 1,
        h: 1
      }
    );

  $("#cropEditor").hidden = false;

  const cropMedia =
    $("#cropMedia");

  cropMedia.innerHTML = "";

  const sourceNode =
    canvasNodes.get(item.id)
      ?.querySelector("img,video");

  if (sourceNode) {
    const cloneNode =
      sourceNode.cloneNode();

    cloneNode.src =
      sourceNode.src;

    if (
      cloneNode.tagName === "VIDEO"
    ) {
      cloneNode.muted = true;
      cloneNode.playsInline = true;
    }

    cropMedia.append(cloneNode);
  }

  renderCropBox();
}

function renderCropBox() {
  if (!cropState) return;

  const box =
    $("#cropBox");

  box.style.left =
    `${cropState.x * 100}%`;

  box.style.top =
    `${cropState.y * 100}%`;

  box.style.width =
    `${cropState.w * 100}%`;

  box.style.height =
    `${cropState.h * 100}%`;

  updateCropShades();
}

function updateCropShades() {
  const x =
    cropState.x * 100;

  const y =
    cropState.y * 100;

  const w =
    cropState.w * 100;

  const h =
    cropState.h * 100;

  Object.assign(
    $("#cropShadeTop").style,
    {
      left: "0",
      top: "0",
      width: "100%",
      height: `${y}%`
    }
  );

  Object.assign(
    $("#cropShadeBottom").style,
    {
      left: "0",
      top: `${y + h}%`,
      width: "100%",
      bottom: "0"
    }
  );

  Object.assign(
    $("#cropShadeLeft").style,
    {
      left: "0",
      top: `${y}%`,
      width: `${x}%`,
      height: `${h}%`
    }
  );

  Object.assign(
    $("#cropShadeRight").style,
    {
      left: `${x + w}%`,
      top: `${y}%`,
      right: "0",
      height: `${h}%`
    }
  );
}

let cropGesture = null;

$("#cropBox").addEventListener(
  "pointerdown",
  event => {
    cropGesture = {
      type:
        event.target.dataset.cropHandle
          ? "resize"
          : "move",

      handle:
        event.target.dataset.cropHandle,

      startX: event.clientX,
      startY: event.clientY,

      state: clone(cropState)
    };

    $("#cropBox").setPointerCapture?.(
      event.pointerId
    );

    event.preventDefault();
  }
);

$("#cropBox").addEventListener(
  "pointermove",
  event => {
    if (!cropGesture) return;

    const rect =
      $("#cropStage")
        .getBoundingClientRect();

    const dx =
      (
        event.clientX -
        cropGesture.startX
      ) / rect.width;

    const dy =
      (
        event.clientY -
        cropGesture.startY
      ) / rect.height;

    const s =
      cropGesture.state;

    if (
      cropGesture.type === "move"
    ) {
      cropState.x =
        clamp(
          s.x + dx,
          0,
          1 - s.w
        );

      cropState.y =
        clamp(
          s.y + dy,
          0,
          1 - s.h
        );
    }

    else {
      let left = s.x;
      let top = s.y;
      let right = s.x + s.w;
      let bottom = s.y + s.h;

      if (
        cropGesture.handle.includes("w")
      ) {
        left =
          clamp(
            s.x + dx,
            0,
            right - .05
          );
      }

      if (
        cropGesture.handle.includes("e")
      ) {
        right =
          clamp(
            right + dx,
            left + .05,
            1
          );
      }

      if (
        cropGesture.handle.includes("n")
      ) {
        top =
          clamp(
            s.y + dy,
            0,
            bottom - .05
          );
      }

      if (
        cropGesture.handle.includes("s")
      ) {
        bottom =
          clamp(
            bottom + dy,
            top + .05,
            1
          );
      }

      cropState.x = left;
      cropState.y = top;

      cropState.w =
        right - left;

      cropState.h =
        bottom - top;
    }

    renderCropBox();
    event.preventDefault();
  }
);

function endCrop() {
  cropGesture = null;
}

$("#cropBox").addEventListener(
  "pointerup",
  endCrop
);

$("#cropBox").addEventListener(
  "pointercancel",
  endCrop
);

$$("[data-crop-ratio]").forEach(button => {
  button.onclick = () => {
    const ratio =
      button.dataset.cropRatio;

    if (ratio === "free") return;

    const [rw, rh] =
      ratio.split(":").map(Number);

    const target =
      rw / rh;

    let w = cropState.w;
    let h = w / target;

    if (h > 1) {
      h = 1;
      w = h * target;
    }

    cropState.w =
      Math.min(w, 1);

    cropState.h =
      Math.min(h, 1);

    cropState.x =
      (1 - cropState.w) / 2;

    cropState.y =
      (1 - cropState.h) / 2;

    renderCropBox();
  };
});

$("#cropReset").onclick = () => {
  cropState = {
    x: 0,
    y: 0,
    w: 1,
    h: 1
  };

  renderCropBox();
};

$("#cropApply").onclick = () => {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.crop =
    clone(cropState);

  $("#cropEditor").hidden = true;

  renderScene();
  saveProject();
};

$("#cropCancel").onclick = () => {
  const item = selectedItem();

  if (item && cropBackup) {
    item.crop =
      clone(cropBackup);
  }

  $("#cropEditor").hidden = true;

  renderScene();
};

/* =========================================================
   LAYER
========================================================= */

function moveLayer(mode) {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  const index =
    S.items.indexOf(item);

  if (mode === "front") {
    S.items.splice(index, 1);
    S.items.push(item);
  }

  if (mode === "back") {
    S.items.splice(index, 1);
    S.items.unshift(item);
  }

  if (
    mode === "forward" &&
    index < S.items.length - 1
  ) {
    [
      S.items[index],
      S.items[index + 1]
    ] = [
      S.items[index + 1],
      S.items[index]
    ];
  }

  if (
    mode === "backward" &&
    index > 0
  ) {
    [
      S.items[index],
      S.items[index - 1]
    ] = [
      S.items[index - 1],
      S.items[index]
    ];
  }

  renderScene();
  saveProject();
}

function openLayerSheet() {
  $("#sheetTitle").textContent =
    "レイヤー";

  $("#sheetContent").innerHTML = `
    <div class="optionRow">
      <button class="optionButton" data-layer="front">最前面</button>
      <button class="optionButton" data-layer="forward">前へ</button>
      <button class="optionButton" data-layer="backward">後ろへ</button>
      <button class="optionButton" data-layer="back">最背面</button>
    </div>
  `;

  $("#editSheet").hidden = false;

  $$("[data-layer]").forEach(button => {
    button.onclick = () => {
      moveLayer(button.dataset.layer);
      closeSheet();
    };
  });
}

/* =========================================================
   TRACK MANAGER
========================================================= */

function openTrackManager() {
  renderTrackManager();

  $("#trackManager").hidden = false;
}

function renderTrackManager() {
  const list =
    $("#trackManagerList");

  list.innerHTML = "";

  [...S.items]
    .reverse()
    .forEach(item => {
      const row =
        document.createElement("div");

      row.className =
        "trackManagerItem";

      row.innerHTML = `
        <div class="trackManagerThumb">
          ${
            item.type === "text"
              ? "T"
              : item.type === "audio"
                ? "♫"
                : item.type === "sticker"
                  ? item.sticker
                  : "▣"
          }
        </div>

        <div class="trackManagerInfo">
          <b>${escapeHTML(item.name || item.type)}</b>
          <small>${item.track.toUpperCase()}</small>
        </div>

        <button data-track-visible="${item.id}">
          ${item.visible === false ? "○" : "◉"}
        </button>

        <button data-track-lock="${item.id}">
          ${item.locked ? "🔒" : "🔓"}
        </button>
      `;

      row.onclick = event => {
        if (
          event.target.closest(
            "[data-track-visible],[data-track-lock]"
          )
        ) {
          return;
        }

        S.selected = item.id;

        $("#trackManager").hidden = true;

        updateToolbar();
        renderTimeline();
        renderScene();
      };

      list.append(row);
    });

  $$("[data-track-visible]").forEach(button => {
    button.onclick = () => {
      const item =
        S.items.find(
          x =>
            x.id ===
            button.dataset.trackVisible
        );

      if (!item) return;

      pushHistory();

      item.visible =
        item.visible === false;

      renderTrackManager();
      renderTimeline();
      renderScene();

      saveProject();
    };
  });

  $$("[data-track-lock]").forEach(button => {
    button.onclick = () => {
      const item =
        S.items.find(
          x =>
            x.id ===
            button.dataset.trackLock
        );

      if (!item) return;

      pushHistory();

      item.locked =
        !item.locked;

      renderTrackManager();
      renderTimeline();
      renderScene();

      saveProject();
    };
  });
}

$("#trackManagerBtn").onclick =
  openTrackManager;

$("#trackManagerClose").onclick =
$("#trackManagerDone").onclick =
  () => {
    $("#trackManager").hidden = true;
  };

/* =========================================================
   ROTATE / FLIP / LOCK / VISIBILITY
========================================================= */

function rotateSelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.rotation =
    (
      (item.rotation || 0) +
      90
    ) % 360;

  updateCurrentKey(item);

  renderScene();
  saveProject();
}

function flipSelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.flipX =
    !item.flipX;

  renderScene();
  saveProject();
}

function lockSelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.locked =
    !item.locked;

  renderScene();
  renderTimeline();

  saveProject();

  toast(
    item.locked
      ? "🔒 ロックしました"
      : "🔓 ロック解除"
  );
}

function visibilitySelected() {
  const item = selectedItem();
  if (!item) return;

  pushHistory();

  item.visible =
    item.visible === false;

  renderScene();
  renderTimeline();

  saveProject();
}

/* =========================================================
   MAIN TOOLBAR
========================================================= */

$$("[data-main-tool]").forEach(button => {
  button.onclick = () => {
    const tool =
      button.dataset.mainTool;

    switch (tool) {
      case "canvas":
        openCanvasSheet();
        break;

      case "music":
        openAudioPanel("music");
        break;

      case "sfx":
        openAudioPanel("sfx");
        break;

      case "text":
        createText();
        break;

      case "sticker":
        openStickerPanel();
        break;

      case "background":
        openBackgroundSheet();
        break;

      case "safearea":
        $("#safeArea").hidden =
          !$("#safeArea").hidden;
        break;
    }
  };
});

/* =========================================================
   CLIP TOOLBAR
========================================================= */

$$("[data-clip-tool]").forEach(button => {
  button.onclick = () => {
    const tool =
      button.dataset.clipTool;

    switch (tool) {
      case "done":
        S.selected = null;
        updateToolbar();
        renderTimeline();
        renderScene();
        break;

      case "split":
        splitSelected();
        break;

      case "trim":
        openTrimSheet();
        break;

      case "speed":
        openSpeedSheet();
        break;

      case "volume":
        openVolumeSheet();
        break;

      case "animation":
        openAnimationPanel();
        break;

      case "keyframe":
        pushHistory();
        addKeyframe(selectedItem());
        break;

      case "keyframeEditor":
        openKeyframePanel();
        break;

      case "transform":
        if (selectedItem()?.type === "text") {
          openTextEditor(selectedItem());
        } else {
          openTransformSheet();
        }
        break;

      case "crop":
        openCropEditor();
        break;

      case "filter":
        openFilterSheet();
        break;

      case "layer":
        openLayerSheet();
        break;

      case "lock":
        lockSelected();
        break;

      case "visibility":
        visibilitySelected();
        break;

      case "rotate":
        rotateSelected();
        break;

      case "flip":
        flipSelected();
        break;

      case "copy":
        copySelected();
        break;

      case "duplicate":
        duplicateSelected();
        break;

      case "delete":
        deleteSelected();
        break;
    }
  };
});

/* =========================================================
   FILE INPUTS
========================================================= */

$("#addMainMedia").onchange =
  async event => {
    await addMediaFiles(
      [...event.target.files],
      "main"
    );

    event.target.value = "";
  };

$("#addPipMedia").onchange =
  async event => {
    await addMediaFiles(
      [...event.target.files],
      "pip"
    );

    event.target.value = "";
  };

$("#newProjectMedia").onchange =
  async event => {
    const files =
      [...event.target.files];

    if (!files.length) return;

    const project =
      makeProject();

    await openProject(
      project.id
    );

    await addMediaFiles(
      files,
      "main"
    );

    event.target.value = "";
  };

$("#newBlankProject").onclick =
  async () => {
    const project =
      makeProject();

    await openProject(
      project.id
    );
  };

/* =========================================================
   UNDO / REDO
========================================================= */

$("#undoBtn").onclick =
  async () => {
    if (!S.undo.length) {
      toast("これ以上戻せません");
      return;
    }

    stopPlayback();

    S.redo.push(
      snapshot()
    );

    const previous =
      S.undo.pop();

    await restoreSnapshot(
      previous
    );
  };

$("#redoBtn").onclick =
  async () => {
    if (!S.redo.length) {
      toast("これ以上進めません");
      return;
    }

    stopPlayback();

    S.undo.push(
      snapshot()
    );

    const next =
      S.redo.pop();

    await restoreSnapshot(
      next
    );
  };

/* =========================================================
   CONTEXT MENU
========================================================= */

let contextTimer = null;

$("#canvas").addEventListener(
  "pointerdown",
  event => {
    const layer =
      event.target.closest(
        ".canvasLayer"
      );

    if (!layer) return;

    contextTimer =
      setTimeout(() => {
        openContextMenu(
          event.clientX,
          event.clientY
        );
      }, 700);
  }
);

["pointerup", "pointermove", "pointercancel"]
  .forEach(type => {
    $("#canvas").addEventListener(
      type,
      () => {
        clearTimeout(contextTimer);
      }
    );
  });

function openContextMenu(x, y) {
  const menu =
    $("#contextMenu");

  menu.hidden = false;

  const width = 150;
  const height = 280;

  menu.style.left =
    `${Math.min(
      x,
      innerWidth - width - 8
    )}px`;

  menu.style.top =
    `${Math.min(
      y,
      innerHeight - height - 8
    )}px`;
}

document.addEventListener(
  "pointerdown",
  event => {
    if (
      !event.target.closest(
        "#contextMenu"
      ) &&
      !event.target.closest(
        ".canvasLayer"
      )
    ) {
      $("#contextMenu").hidden = true;
    }
  }
);

$$("[data-context]").forEach(button => {
  button.onclick = () => {
    const action =
      button.dataset.context;

    $("#contextMenu").hidden = true;

    switch (action) {
      case "edit":
        if (selectedItem()?.type === "text") {
          openTextEditor(selectedItem());
        } else {
          openTransformSheet();
        }
        break;

      case "copy":
        copySelected();
        break;

      case "duplicate":
        duplicateSelected();
        break;

      case "front":
        moveLayer("front");
        break;

      case "back":
        moveLayer("back");
        break;

      case "lock":
        lockSelected();
        break;

      case "visibility":
        visibilitySelected();
        break;

      case "delete":
        deleteSelected();
        break;
    }
  };
});

/* =========================================================
   PROJECT NAME
========================================================= */

$("#projectName").addEventListener(
  "change",
  saveProject
);

/* =========================================================
   BACK
========================================================= */

$("#editorBack").onclick =
  async () => {
    stopPlayback();

    saveProject();

    releaseObjectURLs();

    canvasNodes.clear();

    $("#canvas")
      .querySelectorAll(
        ".canvasLayer"
      )
      .forEach(x => x.remove());

    currentProjectId = null;

    showScreen("home");

    await renderHome();
  };

/* =========================================================
   EXPORT
========================================================= */

$("#exportBtn").onclick = () => {
  saveProject();

  /*
    v3.1ではプロジェクト保存。
    実動画レンダラーはまだ別工程。
  */

  toast(
    "プロジェクトを保存しました"
  );
};

/* =========================================================
   FULLSCREEN PREVIEW
========================================================= */

$("#fullscreenPreview").onclick =
  async () => {
    const viewport =
      $("#previewViewport");

    try {
      if (!document.fullscreenElement) {
        await viewport.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      toast(
        "このブラウザでは全画面表示できません"
      );
    }
  };

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   RESIZE
========================================================= */

window.addEventListener(
  "resize",
  () => {
    if (
      !$("#editorScreen")
        .classList.contains("active")
    ) {
      return;
    }

    const time = S.time;

    renderTimeline();

    requestAnimationFrame(
      () => seekTo(time)
    );
  }
);

/* =========================================================
   VISIBILITY
========================================================= */

document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) {
      stopPlayback();

      if (currentProjectId) {
        saveProject();
      }
    }
  }
);

/* =========================================================
   INIT
========================================================= */

async function init() {
  loadProjects();

  showScreen("home");

  updateAnimationLabels();

  try {
    await openDB();

    $("#storageStatus").textContent =
      "IndexedDB ✓";
  } catch (error) {
    console.error(error);

    $("#storageStatus").textContent =
      "ストレージエラー";

    toast(
      "IndexedDBを使用できません"
    );
  }
}

init();

})();
