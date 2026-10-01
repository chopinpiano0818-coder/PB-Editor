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
