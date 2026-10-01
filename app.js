(() => {
"use strict";

/* =========================================================
   PB EDITOR v2.0 STUDIO
========================================================= */

const $ = q => document.querySelector(q);
const $$ = q => [...document.querySelectorAll(q)];

const DB = "PBEditorV2";
const STORE = "media";
const META = "pb-editor-v2-projects";

let projects = [];
let pid = null;

let S = blankState();

let nodes = new Map();
let urls = new Map();
let ptr = new Map();

let gesture = null;
let zoom = 1;
let last = 0;
let trimDrag = null;


/* =========================================================
   STATE
========================================================= */

function blankState() {
  return {
    duration: 10,
    time: 0,
    aspect: "9:16",
    bg: "#111111",

    items: [],

    selected: null,

    playing: false,

    undo: [],
    redo: []
  };
}


const uid = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2);


const item = () =>
  S.items.find(
    x => x.id === S.selected
  );


/* =========================================================
   TOAST
========================================================= */

function toast(t) {

  const e = $("#toast");

  e.textContent = t;
  e.style.display = "block";

  clearTimeout(toast.t);

  toast.t = setTimeout(() => {
    e.style.display = "none";
  }, 1300);
}


/* =========================================================
   TIME
========================================================= */

function fmt(t) {

  t = Math.max(
    0,
    +t || 0
  );

  const m =
    Math.floor(t / 60);

  const s =
    t % 60;

  return (
    String(m)
      .padStart(2, "0")
    +
    ":"
    +
    s
      .toFixed(2)
      .padStart(5, "0")
  );
}


/* =========================================================
   INDEXED DB
========================================================= */

function db() {

  return new Promise(
    (resolve, reject) => {

      const request =
        indexedDB.open(
          DB,
          1
        );


      request.onupgradeneeded =
        () => {

          if (
            !request.result
              .objectStoreNames
              .contains(STORE)
          ) {

            request.result
              .createObjectStore(
                STORE
              );
          }
        };


      request.onsuccess =
        () =>
          resolve(
            request.result
          );


      request.onerror =
        () =>
          reject(
            request.error
          );
    }
  );
}


/* =========================================================
   SAVE MEDIA BLOB
========================================================= */

async function putBlob(
  id,
  blob
) {

  const database =
    await db();

  return new Promise(
    (resolve, reject) => {

      const tx =
        database.transaction(
          STORE,
          "readwrite"
        );

      tx
        .objectStore(STORE)
        .put(
          blob,
          id
        );


      tx.oncomplete =
        resolve;


      tx.onerror =
        () =>
          reject(
            tx.error
          );
    }
  );
}


/* =========================================================
   GET MEDIA BLOB
========================================================= */

async function getBlob(id) {

  const database =
    await db();

  return new Promise(
    (resolve, reject) => {

      const request =
        database
          .transaction(STORE)
          .objectStore(STORE)
          .get(id);


      request.onsuccess =
        () =>
          resolve(
            request.result
          );


      request.onerror =
        () =>
          reject(
            request.error
          );
    }
  );
}


/* =========================================================
   DELETE MEDIA BLOB
========================================================= */

async function delBlob(id) {

  const database =
    await db();

  return new Promise(
    resolve => {

      const tx =
        database.transaction(
          STORE,
          "readwrite"
        );

      tx
        .objectStore(STORE)
        .delete(id);


      tx.oncomplete =
        resolve;
    }
  );
}


/* =========================================================
   PROJECTS
========================================================= */

function loadProjects() {

  try {

    projects =
      JSON.parse(
        localStorage.getItem(
          META
        )
      )
      ||
      [];

  } catch {

    projects = [];
  }

  renderProjects();
}


function persist() {

  localStorage.setItem(
    META,
    JSON.stringify(
      projects
    )
  );

  $("#saveState")
    .textContent =
      "保存済み";
}


function project() {

  return projects.find(
    p => p.id === pid
  );
}


/* =========================================================
   HISTORY
========================================================= */

function snapshot() {

  return JSON.stringify({
    duration: S.duration,
    aspect: S.aspect,
    bg: S.bg,
    items: S.items
  });
}


function history() {

  S.undo.push(
    snapshot()
  );

  if (
    S.undo.length > 40
  ) {
    S.undo.shift();
  }

  S.redo = [];

  $("#saveState")
    .textContent =
      "編集中";
}


/* =========================================================
   SAVE PROJECT
========================================================= */

function save() {

  const p =
    project();

  if (!p) {
    return;
  }


  p.name =
    $("#projectName")
      .value
      .trim()
    ||
    "名称未設定";


  p.updated =
    Date.now();

  p.duration =
    S.duration;

  p.aspect =
    S.aspect;

  p.bg =
    S.bg;

  p.items =
    JSON.parse(
      JSON.stringify(
        S.items
      )
    );


  persist();
}


/* =========================================================
   CREATE PROJECT
========================================================= */

function makeProject() {

  const p = {

    id:
      uid(),

    name:
      "新しいプロジェクト",

    created:
      Date.now(),

    updated:
      Date.now(),

    duration:
      10,

    aspect:
      "9:16",

    bg:
      "#111111",

    items:
      []
  };


  projects.unshift(
    p
  );

  persist();

  return p;
}


/* =========================================================
   MEDIA OBJECT URL
========================================================= */

async function mediaURL(m) {

  if (!m.mediaId) {
    return m.src || "";
  }


  if (
    urls.has(
      m.mediaId
    )
  ) {
    return urls.get(
      m.mediaId
    );
  }


  const blob =
    await getBlob(
      m.mediaId
    );


  if (!blob) {
    return "";
  }


  const url =
    URL.createObjectURL(
      blob
    );


  urls.set(
    m.mediaId,
    url
  );


  return url;
}


/* =========================================================
   SCREEN
========================================================= */

function show(which) {

  $("#home")
    .classList
    .toggle(
      "active",
      which === "home"
    );


  $("#editor")
    .classList
    .toggle(
      "active",
      which === "editor"
    );
}


/* =========================================================
   HOME PROJECT LIST
========================================================= */

async function renderProjects() {

  const box =
    $("#projects");

  box.innerHTML =
    "";


  $("#storageState")
    .textContent =
      "IndexedDB保存";


  if (
    !projects.length
  ) {

    box.innerHTML = `
      <div class="empty">
        🎬
        <br><br>
        まだプロジェクトがありません
      </div>
    `;

    return;
  }


  for (
    const p of projects
  ) {

    const card =
      document.createElement(
        "article"
      );

    card.className =
      "project";


    const thumb =
      document.createElement(
        "div"
      );

    thumb.className =
      "thumb";


    const media =
      p.items.find(
        x =>
          x.type === "image"
          ||
          x.type === "video"
      );


    if (media) {

      const el =
        document.createElement(
          media.type === "video"
            ?
            "video"
            :
            "img"
        );


      const url =
        await mediaURL(
          media
        );


      el.src =
        url;


      if (
        media.type ===
        "video"
      ) {

        el.muted =
          true;

        el.playsInline =
          true;
      }


      thumb.append(
        el
      );

    } else {

      thumb.textContent =
        "🎬";
    }


    const info =
      document.createElement(
        "div"
      );

    info.className =
      "pinfo";


    info.innerHTML = `
      <b></b>
      <small>
        ${
          new Date(
            p.updated
          ).toLocaleString(
            "ja-JP"
          )
        }
      </small>
    `;


    info
      .querySelector("b")
      .textContent =
        p.name;


    card.append(
      thumb,
      info
    );


    card.onclick =
      () =>
        openProject(
          p.id
        );


    card.oncontextmenu =
      event => {

        event.preventDefault();

        projectMenu(
          p.id
        );
      };


    box.append(
      card
    );
  }
}


/* =========================================================
   PROJECT MENU
========================================================= */

function projectMenu(id) {

  const p =
    projects.find(
      x => x.id === id
    );


  if (!p) {
    return;
  }


  const answer =
    prompt(
      "プロジェクト名を変更できます。\n削除する場合は DELETE と入力",
      p.name
    );


  if (
    answer === null
  ) {
    return;
  }


  if (
    answer === "DELETE"
  ) {

    if (
      confirm(
        "削除しますか？"
      )
    ) {

      projects =
        projects.filter(
          x =>
            x.id !== id
        );


      persist();

      renderProjects();
    }

    return;
  }


  if (
    answer.trim()
  ) {

    p.name =
      answer.trim();

    p.updated =
      Date.now();

    persist();

    renderProjects();
  }
}


/* =========================================================
   OPEN PROJECT
========================================================= */

async function openProject(id) {

  pid =
    id;


  const p =
    project();


  S =
    blankState();


  Object.assign(
    S,
    {
      duration:
        p.duration || 10,

      aspect:
        p.aspect || "9:16",

      bg:
        p.bg || "#111111",

      items:
        JSON.parse(
          JSON.stringify(
            p.items || []
          )
        )
    }
  );


  $("#projectName")
    .value =
      p.name;


  $("#saveState")
    .textContent =
      "保存済み";


  clearNodes();

  show(
    "editor"
  );


  await renderAll();
}


/* =========================================================
   CLEAR NODES
========================================================= */

function clearNodes() {

  nodes.forEach(
    e => e.remove()
  );

  nodes.clear();
}


/* =========================================================
   PROJECT DURATION
========================================================= */

function maxDuration() {

  const duration =
    Math.max(
      1,
      ...S.items.map(
        x => x.end || 0
      )
    );


  S.duration =
    Math.max(
      1,
      duration
    );
}


/* =========================================================
   ADD FILES
========================================================= */

async function addFiles(
  files,
  pip = false
) {

  if (!files.length) {
    return;
  }


  history();


  for (
    const file of files
  ) {

    const mediaId =
      uid();


    await putBlob(
      mediaId,
      file
    );


    const meta =
      await probe(
        file
      );


    const sw =
      $("#stage")
        .clientWidth
      ||
      300;


    const sh =
      $("#stage")
        .clientHeight
      ||
      533;


    const fit =
      fitRect(
        meta.w || sw,
        meta.h || sh,
        sw,
        sh,
        pip ? 0.5 : 1
      );


    const normalClips =
      S.items.filter(
        x => !x.pip
      );


    const start =
      pip
      ?
      S.time
      :
      normalClips.length
      ?
      Math.max(
        ...normalClips.map(
          x => x.end || 0
        ),
        0
      )
      :
      0;


    const duration =
      file.type.startsWith(
        "video"
      )
      ?
      (
        meta.duration
        ||
        5
      )
      :
      5;


    const it = {

      id:
        uid(),

      mediaId,

      type:
        file.type.startsWith(
          "video"
        )
        ?
        "video"
        :
        "image",

      name:
        file.name,

      pip,

      sourceIn:
        0,

      sourceOut:
        duration,

      start,

      end:
        start + duration,

      x:
        pip
        ?
        (
          sw -
          fit.w * 0.7
        )
        /
        2
        :
        fit.x,

      y:
        pip
        ?
        (
          sh -
          fit.h * 0.7
        )
        /
        2
        :
        fit.y,

      w:
        pip
        ?
        fit.w * 0.7
        :
        fit.w,

      h:
        pip
        ?
        fit.h * 0.7
        :
        fit.h,

      r:
        0,

      flip:
        false,

      opacity:
        100,

      speed:
        1,

      volume:
        100,

      brightness:
        100,

      contrast:
        100,

      saturate:
        100,

      keys:
        []
    };


    S.items.push(
      it
    );


    S.selected =
      it.id;
  }


  maxDuration();

  save();

  await renderAll();
}


/* =========================================================
   FIT MEDIA
========================================================= */

function fitRect(
  width,
  height,
  stageWidth,
  stageHeight,
  scale = 1
) {

  const ratio =
    Math.min(
      stageWidth / width,
      stageHeight / height
    )
    *
    scale;


  const w =
    width *
    ratio;


  const h =
    height *
    ratio;


  return {
    x:
      (
        stageWidth -
        w
      )
      /
      2,

    y:
      (
        stageHeight -
        h
      )
      /
      2,

    w,
    h
  };
}


/* =========================================================
   READ IMAGE / VIDEO METADATA
========================================================= */

function probe(file) {

  return new Promise(
    resolve => {

      const url =
        URL.createObjectURL(
          file
        );


      if (
        file.type.startsWith(
          "video"
        )
      ) {

        const video =
          document.createElement(
            "video"
          );


        video.preload =
          "metadata";


        video.onloadedmetadata =
          () => {

            resolve({
              w:
                video.videoWidth,

              h:
                video.videoHeight,

              duration:
                video.duration
            });


            URL.revokeObjectURL(
              url
            );
          };


        video.onerror =
          () => {

            URL.revokeObjectURL(
              url
            );

            resolve({});
          };


        video.src =
          url;

      } else {

        const image =
          new Image();


        image.onload =
          () => {

            resolve({
              w:
                image.naturalWidth,

              h:
                image.naturalHeight
            });


            URL.revokeObjectURL(
              url
            );
          };


        image.onerror =
          () => {

            URL.revokeObjectURL(
              url
            );

            resolve({});
          };


        image.src =
          url;
      }
    }
  );
}


/* =========================================================
   CREATE PREVIEW NODE
========================================================= */

async function makeNode(it) {

  const el =
    document.createElement(
      "div"
    );


  el.className =
    "layer "
    +
    it.type;


  el.dataset.id =
    it.id;


  if (
    it.type === "text"
  ) {

    el.textContent =
      it.text;

  } else {

    const media =
      document.createElement(
        it.type === "video"
          ?
          "video"
          :
          "img"
      );


    media.src =
      await mediaURL(
        it
      );


    if (
      it.type === "video"
    ) {

      media.playsInline =
        true;

      media.preload =
        "auto";

      media.muted =
        it.volume === 0;
    }


    el.append(
      media
    );
  }


  $("#stage")
    .append(
      el
    );


  nodes.set(
    it.id,
    el
  );


  return el;
}


/* =========================================================
   KEYFRAME EASING
========================================================= */

function eased(t) {

  return (
    t < 0.5
      ?
      2 * t * t
      :
      1 -
      Math.pow(
        -2 * t + 2,
        2
      )
      /
      2
  );
}


/* =========================================================
   KEYFRAME EVALUATION
========================================================= */

function evaluated(it) {

  if (
    !it.keys?.length
  ) {
    return it;
  }


  const keys =
    [...it.keys]
      .sort(
        (a, b) =>
          a.t - b.t
      );


  let a =
    keys[0];

  let b =
    keys[
      keys.length - 1
    ];


  if (
    S.time <= a.t
  ) {

    return {
      ...it,
      ...a
    };
  }


  if (
    S.time >= b.t
  ) {

    return {
      ...it,
      ...b
    };
  }


  for (
    let i = 0;
    i < keys.length - 1;
    i++
  ) {

    if (
      S.time >= keys[i].t
      &&
      S.time <= keys[i + 1].t
    ) {

      a =
        keys[i];

      b =
        keys[i + 1];

      break;
    }
  }


  const q =
    eased(
      (
        S.time -
        a.t
      )
      /
      (
        b.t -
        a.t
      )
    );


  const out = {
    ...it
  };


  for (
    const k of [
      "x",
      "y",
      "w",
      "h",
      "r",
      "opacity"
    ]
  ) {

    out[k] =
      a[k]
      +
      (
        b[k] -
        a[k]
      )
      *
      q;
  }


  return out;
}


/* =========================================================
   RENDER PREVIEW
========================================================= */

async function renderScene() {

  const stage =
    $("#stage");


  const [
    aw,
    ah
  ] =
    S.aspect.split(":");


  stage.style.aspectRatio =
    `${aw}/${ah}`;


  stage.style.background =
    S.bg;


  for (
    const it of S.items
  ) {

    const el =
      nodes.get(
        it.id
      )
      ||
      await makeNode(
        it
      );


    const value =
      evaluated(
        it
      );


    el.classList.toggle(
      "selected",
      it.id === S.selected
    );


    el.style.width =
      value.w + "px";


    el.style.height =
      value.h + "px";


    el.style.transform =
      `
      translate3d(
        ${value.x}px,
        ${value.y}px,
        0
      )
      rotate(
        ${value.r || 0}deg
      )
      scaleX(
        ${value.flip ? -1 : 1}
      )
      `;


    el.style.opacity =
      (
        value.opacity ??
        100
      )
      /
      100;


    el.style.zIndex =
      S.items.indexOf(
        it
      )
      +
      1;


    el.style.visibility =
      (
        S.time >= it.start
        &&
        S.time <= it.end
      )
      ?
      "visible"
      :
      "hidden";


    el.style.filter =
      `
      brightness(
        ${it.brightness || 100}%
      )
      contrast(
        ${it.contrast || 100}%
      )
      saturate(
        ${it.saturate || 100}%
      )
      `;


    /* TEXT */

    if (
      it.type === "text"
    ) {

      el.textContent =
        it.text;


      el.style.fontSize =
        (
          it.fontSize ||
          32
        )
        +
        "px";


      el.style.color =
        it.color
        ||
        "#ffffff";
    }


    /* VIDEO */

    if (
      it.type === "video"
    ) {

      const video =
        el.querySelector(
          "video"
        );


      let target =
        it.sourceIn
        +
        (
          S.time -
          it.start
        )
        *
        (
          it.speed ||
          1
        );


      video.volume =
        Math.min(
          1,
          (
            it.volume ??
            100
          )
          /
          100
        );


      if (
        S.time < it.start
        ||
        S.time > it.end
      ) {

        video.pause();

      } else {

        target =
          Math.min(
            it.sourceOut
            ||
            video.duration
            ||
            target,

            Math.max(
              0,
              target
            )
          );


        if (
          !S.playing
          &&
          Number.isFinite(
            target
          )
          &&
          Math.abs(
            video.currentTime -
            target
          )
          >
          0.12
        ) {

          try {

            video.currentTime =
              target;

          } catch {}
        }


        video.playbackRate =
          Math.max(
            0.25,
            Math.min(
              4,
              it.speed ||
              1
            )
          );


        if (
          S.playing
        ) {

          video
            .play()
            .catch(
              () => {}
            );

        } else {

          video.pause();
        }
      }
    }
  }


  /* Remove old DOM nodes */

  for (
    const [
      id,
      el
    ]
    of nodes
  ) {

    if (
      !S.items.some(
        x =>
          x.id === id
      )
    ) {

      el.remove();

      nodes.delete(
        id
      );
    }
  }


  $("#clock")
    .textContent =
      `${fmt(S.time)} / ${fmt(S.duration)}`;
}


/* =========================================================
   TIMELINE SCALE
========================================================= */

function pxs() {

  return (
    80 *
    zoom
  );
}


/* =========================================================
   RENDER TIMELINE
========================================================= */

function renderTimeline() {

  const tracks =
    $("#tracks");


  tracks.innerHTML =
    "";


  const width =
    Math.max(
      $("#tlScroll")
        .clientWidth,

      S.duration *
      pxs()
      +
      120
    );


  $("#tlContent")
    .style
    .width =
      width +
      "px";


  for (
    const it of S.items
  ) {

    const row =
      document.createElement(
        "div"
      );


    row.className =
      "track";


    const clip =
      document.createElement(
        "div"
      );


    clip.className =
      `clip ${it.type}${
        it.id === S.selected
          ?
          " selected"
          :
          ""
      }`;


    clip.dataset.id =
      it.id;


    clip.style.left =
      (
        it.start *
        pxs()
      )
      +
      "px";


    clip.style.width =
      Math.max(
        24,
        (
          it.end -
          it.start
        )
        *
        pxs()
      )
      +
      "px";


    clip.textContent =
      it.name;


    if (
      it.id ===
      S.selected
    ) {

      const left =
        document.createElement(
          "i"
        );


      const right =
        document.createElement(
          "i"
        );


      left.className =
        "trimHandle l";


      right.className =
        "trimHandle r";


      left.dataset.trim =
        "l";


      right.dataset.trim =
        "r";


      clip.append(
        left,
        right
      );
    }


    row.append(
      clip
    );


    tracks.append(
      row
    );
  }


  updatePlayhead();
}


/* =========================================================
   PLAYHEAD
========================================================= */

function updatePlayhead() {

  $("#playhead")
    .style
    .left =
      (
        S.time *
        pxs()
      )
      +
      "px";
}


/* =========================================================
   RENDER EVERYTHING
========================================================= */

async function renderAll() {

  await renderScene();

  renderTimeline();

  toggleBars();
}


/* =========================================================
   TOOLBARS
========================================================= */

function toggleBars() {

  const selected =
    !!S.selected;


  $("#mainbar")
    .hidden =
      selected;


  $("#clipbar")
    .hidden =
      !selected;
}


/* =========================================================
   SELECT TIMELINE CLIP
========================================================= */

$("#tracks").onclick =
  event => {

    const clip =
      event.target.closest(
        ".clip"
      );


    if (
      clip
      &&
      !event.target.dataset.trim
    ) {

      select(
        clip.dataset.id
      );
    }
  };


/* =========================================================
   SELECT ITEM
========================================================= */

function select(id) {

  S.selected =
    id;

  renderAll();
}


/* =========================================================
   TIMELINE TRIM START
========================================================= */

$("#tracks").onpointerdown =
  event => {

    const handle =
      event.target.closest(
        ".trimHandle"
      );


    if (!handle) {
      return;
    }


    event.preventDefault();


    const clip =
      handle.closest(
        ".clip"
      );


    const it =
      S.items.find(
        x =>
          x.id ===
          clip.dataset.id
      );


    history();


    trimDrag = {

      it,

      side:
        handle.dataset.trim,

      startX:
        event.clientX,

      start:
        it.start,

      end:
        it.end,

      sourceIn:
        it.sourceIn,

      sourceOut:
        it.sourceOut
    };


    handle
      .setPointerCapture?.(
        event.pointerId
      );
  };


/* =========================================================
   TIMELINE TRIM MOVE
========================================================= */

$("#tracks").onpointermove =
  event => {

    if (!trimDrag) {
      return;
    }


    const delta =
      (
        event.clientX -
        trimDrag.startX
      )
      /
      pxs();


    const it =
      trimDrag.it;


    /* LEFT */

    if (
      trimDrag.side ===
      "l"
    ) {

      const newStart =
        Math.min(
          trimDrag.end - 0.1,

          Math.max(
            0,
            trimDrag.start +
            delta
          )
        );


      const difference =
        newStart -
        trimDrag.start;


      it.start =
        newStart;


      if (
        it.type === "video"
      ) {

        it.sourceIn =
          Math.max(
            0,

            trimDrag.sourceIn
            +
            difference
            *
            (
              it.speed ||
              1
            )
          );
      }

    }


    /* RIGHT */

    else {

      const newEnd =
        Math.max(
          trimDrag.start + 0.1,
          trimDrag.end +
          delta
        );


      it.end =
        newEnd;


      if (
        it.type === "video"
      ) {

        it.sourceOut =
          Math.max(
            it.sourceIn + 0.1,

            trimDrag.sourceOut
            +
            delta
            *
            (
              it.speed ||
              1
            )
          );
      }
    }


    maxDuration();

    renderTimeline();

    renderScene();
  };


/* =========================================================
   TIMELINE TRIM END
========================================================= */

$("#tracks").onpointerup =
  () => {

    if (
      trimDrag
    ) {

      trimDrag =
        null;

      save();
    }
  };


/* =========================================================
   TIMELINE SEEK
========================================================= */

$("#tlScroll").onclick =
  event => {

    if (
      event.target.closest(
        ".clip"
      )
    ) {
      return;
    }


    const rect =
      $("#tlContent")
        .getBoundingClientRect();


    S.time =
      Math.max(
        0,

        Math.min(
          S.duration,

          (
            event.clientX -
            rect.left
          )
          /
          pxs()
        )
      );


    renderAll();
  };


/* =========================================================
   ZOOM
========================================================= */

$("#zoomIn").onclick =
  () => {

    zoom =
      Math.min(
        4,
        zoom * 1.25
      );


    renderTimeline();
  };


$("#zoomOut").onclick =
  () => {

    zoom =
      Math.max(
        0.5,
        zoom / 1.25
      );


    renderTimeline();
  };


/* =========================================================
   NEW PROJECT WITH MEDIA
========================================================= */

$("#newMedia").onchange =
  async event => {

    const files =
      [...event.target.files];


    if (!files.length) {
      return;
    }


    const p =
      makeProject();


    await openProject(
      p.id
    );


    await addFiles(
      files,
      false
    );


    event.target.value =
      "";
  };


/* =========================================================
   BLANK PROJECT
========================================================= */

$("#blank").onclick =
  async () => {

    const p =
      makeProject();


    await openProject(
      p.id
    );
  };


/* =========================================================
   ADD MAIN MEDIA
========================================================= */

$("#media").onchange =
  async event => {

    await addFiles(
      [...event.target.files],
      false
    );


    event.target.value =
      "";
  };


/* =========================================================
   ADD PIP
========================================================= */

$("#pip").onchange =
  async event => {

    await addFiles(
      [...event.target.files],
      true
    );


    event.target.value =
      "";
  };


/* =========================================================
   BACK HOME
========================================================= */

$("#back").onclick =
  () => {

    save();

    S.playing =
      false;


    nodes.forEach(
      el =>
        el
          .querySelector(
            "video"
          )
          ?.pause()
    );


    show(
      "home"
    );


    renderProjects();
  };


/* =========================================================
   PROJECT NAME
========================================================= */

$("#projectName").oninput =
  () => {

    $("#saveState")
      .textContent =
        "編集中";
  };


$("#projectName").onchange =
  save;


/* =========================================================
   MAIN TOOLBAR
========================================================= */

$("#mainbar").onclick =
  event => {

    const button =
      event.target.closest(
        "[data-tool]"
      );


    if (!button) {
      return;
    }


    const tool =
      button.dataset.tool;


    /* CANVAS */

    if (
      tool === "canvas"
    ) {

      sheet(
        "キャンバス",
        `
        <div class="options">

          ${
            [
              "9:16",
              "16:9",
              "1:1",
              "4:5",
              "4:3"
            ]
            .map(
              x =>
                `
                <button
                  data-ratio="${x}"
                >
                  ${x}
                </button>
                `
            )
            .join("")
          }

        </div>
        `
      );
    }


    /* TEXT */

    if (
      tool === "text"
    ) {

      history();


      const sw =
        $("#stage")
          .clientWidth
        ||
        300;


      const sh =
        $("#stage")
          .clientHeight
        ||
        533;


      const it = {

        id:
          uid(),

        type:
          "text",

        name:
          "テキスト",

        text:
          "TEXT",

        start:
          S.time,

        end:
          S.duration,

        x:
          sw * 0.2,

        y:
          sh * 0.4,

        w:
          sw * 0.6,

        h:
          60,

        r:
          0,

        opacity:
          100,

        flip:
          false,

        fontSize:
          32,

        color:
          "#ffffff",

        keys:
          []
      };


      S.items.push(
        it
      );


      S.selected =
        it.id;


      save();

      renderAll();

      editText(
        it
      );
    }


    /* ADJUST */

    if (
      tool === "adjust"
    ) {

      toast(
        "調整する素材を選択してください"
      );
    }


    /* BACKGROUND */

    if (
      tool === "background"
    ) {

      sheet(
        "背景",
        `
        <div class="options">

          ${
            [
              "#000000",
              "#ffffff",
              "#1d1d1d",
              "#355070",
              "#6d597a"
            ]
            .map(
              x =>
                `
                <button
                  data-bg="${x}"
                  style="background:${x}"
                >
                  ${x}
                </button>
                `
            )
            .join("")
          }

        </div>
        `
      );
    }
  };


/* =========================================================
   SHEET
========================================================= */

function sheet(
  title,
  body
) {

  $("#sheetTitle")
    .textContent =
      title;


  $("#sheetBody")
    .innerHTML =
      body;


  $("#sheet")
    .hidden =
      false;
}


function closeSheet() {

  $("#sheet")
    .hidden =
      true;
}


$("#sheetClose").onclick =
  closeSheet;


/* =========================================================
   EDIT TEXT
========================================================= */

function editText(it) {

  sheet(
    "テキスト",
    `
    <div class="fields">

      <label class="wide">

        文字

        <textarea id="txt">${
          it.text
        }</textarea>

      </label>


      <label>

        サイズ

        <input
          id="font"
          type="number"
          value="${
            it.fontSize || 32
          }"
        >

      </label>


      <label>

        色

        <input
          id="color"
          type="color"
          value="${
            it.color ||
            "#ffffff"
          }"
        >

      </label>

    </div>
    `
  );
}


/* =========================================================
   SHEET INPUT
========================================================= */

$("#sheetBody").oninput =
  event => {

    const it =
      item();


    /* TEXT */

    if (
      event.target.id === "txt"
      &&
      it
    ) {

      it.text =
        event.target.value;


      it.name =
        event.target.value
        ||
        "テキスト";


      renderScene();
    }


    /* FONT SIZE */

    if (
      event.target.id === "font"
      &&
      it
    ) {

      it.fontSize =
        +event.target.value;


      renderScene();
    }


    /* COLOR */

    if (
      event.target.id === "color"
      &&
      it
    ) {

      it.color =
        event.target.value;


      renderScene();
    }


    /* NUMERIC TRANSFORM */

    for (
      const key of [
        "x",
        "y",
        "w",
        "h",
        "r",
        "opacity",
        "brightness",
        "contrast",
        "saturate"
      ]
    ) {

      if (
        event.target.id === key
        &&
        it
      ) {

        it[key] =
          +event.target.value;


        renderScene();
      }
    }


    /* VOLUME */

    if (
      event.target.id === "volume"
      &&
      it
    ) {

      it.volume =
        +event.target.value;


      renderScene();
    }
  };


/* =========================================================
   SHEET CHANGE
========================================================= */

$("#sheetBody").onchange =
  event => {

    const it =
      item();


    /* ASPECT */

    if (
      event.target.dataset.ratio
    ) {

      history();


      S.aspect =
        event.target.dataset.ratio;


      save();

      renderAll();

      closeSheet();
    }


    /* BACKGROUND */

    if (
      event.target.dataset.bg
    ) {

      history();


      S.bg =
        event.target.dataset.bg;


      save();

      renderScene();

      closeSheet();
    }


    /* SPEED */

    if (
      event.target.dataset.speed
      &&
      it
    ) {

      history();


      it.speed =
        +event.target.dataset.speed;


      if (
        it.type === "video"
      ) {

        it.end =
          it.start
          +
          (
            it.sourceOut -
            it.sourceIn
          )
          /
          it.speed;
      }


      maxDuration();

      save();

      renderAll();

      closeSheet();
    }


    /* LAYER */

    if (
      event.target.dataset.layer
      &&
      it
    ) {

      history();


      const index =
        S.items.indexOf(
          it
        );


      const action =
        event.target.dataset.layer;


      S.items.splice(
        index,
        1
      );


      if (
        action === "front"
      ) {

        S.items.push(
          it
        );

      } else if (
        action === "back"
      ) {

        S.items.unshift(
          it
        );

      } else {

        const destination =
          Math.max(
            0,

            Math.min(
              S.items.length,

              index
              +
              (
                action === "forward"
                  ?
                  1
                  :
                  -1
              )
            )
          );


        S.items.splice(
          destination,
          0,
          it
        );
      }


      save();

      renderAll();

      closeSheet();
    }


    save();
  };


/* =========================================================
   CLIP TOOLBAR
========================================================= */

$("#clipbar").onclick =
  event => {

    const button =
      event.target.closest(
        "[data-act]"
      );


    const it =
      item();


    if (
      !button
      ||
      !it
    ) {
      return;
    }


    const action =
      button.dataset.act;


    /* DONE */

    if (
      action === "done"
    ) {

      select(
        null
      );

      return;
    }


    /* DELETE */

    if (
      action === "delete"
    ) {

      history();


      S.items =
        S.items.filter(
          x =>
            x.id !== it.id
        );


      select(
        null
      );


      maxDuration();

      save();

      return;
    }


    /* DUPLICATE */

    if (
      action === "duplicate"
    ) {

      history();


      const copy =
        structuredClone(
          it
        );


      copy.id =
        uid();


      copy.name +=
        " コピー";


      copy.x +=
        15;


      copy.y +=
        15;


      S.items.push(
        copy
      );


      S.selected =
        copy.id;


      save();

      renderAll();

      return;
    }


    /* ROTATE */

    if (
      action === "rotate"
    ) {

      history();


      it.r =
        (
          it.r +
          90
        )
        %
        360;


      save();

      renderScene();

      return;
    }


    /* FLIP */

    if (
      action === "flip"
    ) {

      history();


      it.flip =
        !it.flip;


      save();

      renderScene();

      return;
    }


    /* SPLIT */

    if (
      action === "split"
    ) {

      if (
        S.time <= it.start
        ||
        S.time >= it.end
      ) {

        toast(
          "クリップ内に再生ヘッドを置いてください"
        );

        return;
      }


      history();


      const copy =
        structuredClone(
          it
        );


      const oldEnd =
        it.end;


      copy.id =
        uid();


      copy.name +=
        " 2";


      copy.start =
        S.time;


      it.end =
        S.time;


      if (
        it.type === "video"
      ) {

        const cut =
          it.sourceIn
          +
          (
            S.time -
            it.start
          )
          *
          (
            it.speed ||
            1
          );


        it.sourceOut =
          cut;


        copy.sourceIn =
          cut;
      }


      copy.end =
        oldEnd;


      S.items.splice(
        S.items.indexOf(
          it
        )
        +
        1,

        0,

        copy
      );


      save();

      renderAll();

      return;
    }


    /* TRIM */

    if (
      action === "trim"
    ) {

      sheet(
        "トリミング",
        `
        <p
          style="
            font-size:11px;
            color:#aaa
          "
        >
          タイムライン上の白い左右ハンドルを
          直接ドラッグできます。
        </p>

        <div class="fields">

          <label>

            開始

            <input
              id="start"
              type="number"
              step=".01"
              value="${it.start}"
            >

          </label>


          <label>

            終了

            <input
              id="end"
              type="number"
              step=".01"
              value="${it.end}"
            >

          </label>

        </div>
        `
      );

      return;
    }


    /* SPEED */

    if (
      action === "speed"
    ) {

      sheet(
        "速度",
        `
        <div class="options">

          ${
            [
              0.25,
              0.5,
              1,
              1.5,
              2,
              3,
              4
            ]
            .map(
              x =>
                `
                <button
                  data-speed="${x}"
                >
                  ${x}×
                </button>
                `
            )
            .join("")
          }

        </div>
        `
      );

      return;
    }


    /* VOLUME */

    if (
      action === "volume"
    ) {

      sheet(
        "音量",
        `
        <div class="fields">

          <label class="wide">

            音量

            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              value="${
                it.volume ??
                100
              }"
            >

          </label>

        </div>
        `
      );

      return;
    }


    /* TRANSFORM */

    if (
      action === "transform"
    ) {

      sheet(
        "変形・調整",
        `
        <div class="fields">

          ${
            [
              "x",
              "y",
              "w",
              "h",
              "r",
              "opacity"
            ]
            .map(
              key =>
                `
                <label>

                  ${key.toUpperCase()}

                  <input
                    id="${key}"
                    type="number"
                    step=".1"
                    value="${
                      it[key] ?? 0
                    }"
                  >

                </label>
                `
            )
            .join("")
          }


          ${
            it.type !== "text"
            ?
            [
              "brightness",
              "contrast",
              "saturate"
            ]
            .map(
              key =>
                `
                <label>

                  ${key}

                  <input
                    id="${key}"
                    type="range"
                    min="0"
                    max="200"
                    value="${
                      it[key] ||
                      100
                    }"
                  >

                </label>
                `
            )
            .join("")
            :
            ""
          }


          ${
            it.type === "text"
            ?
            `
            <button
              class="wide"
              id="editTextBtn"
            >
              テキストを編集
            </button>
            `
            :
            ""
          }

        </div>
        `
      );


      setTimeout(
        () => {

          $("#editTextBtn")
            ?.addEventListener(
              "click",
              () =>
                editText(
                  it
                )
            );
        }
      );


      return;
    }


    /* LAYER */

    if (
      action === "layer"
    ) {

      sheet(
        "レイヤー",
        `
        <div class="options">

          <button data-layer="front">
            最前面
          </button>

          <button data-layer="forward">
            前へ
          </button>

          <button data-layer="backward">
            後ろへ
          </button>

          <button data-layer="back">
            最背面
          </button>

        </div>
        `
      );

      return;
    }


    /* KEYFRAME */

    if (
      action === "key"
    ) {

      history();


      it.keys =
        it.keys ||
        [];


      const key = {

        t:
          S.time,

        x:
          it.x,

        y:
          it.y,

        w:
          it.w,

        h:
          it.h,

        r:
          it.r,

        opacity:
          it.opacity
      };


      const old =
        it.keys.findIndex(
          x =>
            Math.abs(
              x.t -
              S.time
            )
            <
            0.03
        );


      if (
        old >= 0
      ) {

        it.keys[old] =
          key;

      } else {

        it.keys.push(
          key
        );
      }


      it.keys.sort(
        (a, b) =>
          a.t -
          b.t
      );


      save();


      toast(
        "◆ キーフレーム追加"
      );

      return;
    }
  };


/* =========================================================
   TRIM NUMBER INPUTS
========================================================= */

$("#sheetBody")
  .addEventListener(
    "change",
    event => {

      const it =
        item();


      if (!it) {
        return;
      }


      if (
        event.target.id ===
        "start"
      ) {

        history();


        it.start =
          Math.max(
            0,

            Math.min(
              +event.target.value,

              it.end -
              0.1
            )
          );


        save();

        renderAll();
      }


      if (
        event.target.id ===
        "end"
      ) {

        history();


        it.end =
          Math.max(
            it.start + 0.1,

            +event.target.value
          );


        maxDuration();

        save();

        renderAll();
      }
    }
  );


/* =========================================================
   STAGE POINTER DOWN
========================================================= */

$("#stage").onpointerdown =
  event => {

    const layer =
      event.target.closest(
        ".layer"
      );


    if (!layer) {

      select(
        null
      );

      return;
    }


    select(
      layer.dataset.id
    );


    $("#stage")
      .setPointerCapture?.(
        event.pointerId
      );


    ptr.set(
      event.pointerId,
      {
        x:
          event.clientX,

        y:
          event.clientY
      }
    );


    const it =
      item();


    if (
      ptr.size === 1
    ) {

      history();


      gesture = {

        type:
          "move",

        x:
          it.x,

        y:
          it.y,

        sx:
          event.clientX,

        sy:
          event.clientY
      };

    } else if (
      ptr.size === 2
    ) {

      const points =
        [...ptr.values()];


      const dx =
        points[1].x -
        points[0].x;


      const dy =
        points[1].y -
        points[0].y;


      gesture = {

        type:
          "pinch",

        d:
          Math.hypot(
            dx,
            dy
          ),

        a:
          Math.atan2(
            dy,
            dx
          ),

        w:
          it.w,

        h:
          it.h,

        r:
          it.r
      };
    }
  };


/* =========================================================
   STAGE POINTER MOVE
========================================================= */

$("#stage").onpointermove =
  event => {

    if (
      !ptr.has(
        event.pointerId
      )
    ) {
      return;
    }


    ptr.set(
      event.pointerId,
      {
        x:
          event.clientX,

        y:
          event.clientY
      }
    );


    const it =
      item();


    const points =
      [...ptr.values()];


    if (!it) {
      return;
    }


    /* MOVE */

    if (
      points.length === 1
      &&
      gesture?.type === "move"
    ) {

      it.x =
        gesture.x
        +
        points[0].x
        -
        gesture.sx;


      it.y =
        gesture.y
        +
        points[0].y
        -
        gesture.sy;


      const centerX =
        it.x +
        it.w / 2;


      const centerY =
        it.y +
        it.h / 2;


      const snapX =
        Math.abs(
          centerX -
          $("#stage")
            .clientWidth
          /
          2
        )
        <
        9;


      const snapY =
        Math.abs(
          centerY -
          $("#stage")
            .clientHeight
          /
          2
        )
        <
        9;


      if (
        snapX
      ) {

        it.x =
          $("#stage")
            .clientWidth
          /
          2
          -
          it.w / 2;
      }


      if (
        snapY
      ) {

        it.y =
          $("#stage")
            .clientHeight
          /
          2
          -
          it.h / 2;
      }


      $("#gx")
        .classList
        .toggle(
          "show",
          snapX
        );


      $("#gy")
        .classList
        .toggle(
          "show",
          snapY
        );


      renderScene();
    }


    /* PINCH */

    else if (
      points.length === 2
      &&
      gesture?.type === "pinch"
    ) {

      const dx =
        points[1].x -
        points[0].x;


      const dy =
        points[1].y -
        points[0].y;


      const scale =
        Math.hypot(
          dx,
          dy
        )
        /
        gesture.d;


      it.w =
        Math.max(
          20,

          gesture.w *
          scale
        );


      it.h =
        Math.max(
          20,

          gesture.h *
          scale
        );


      it.r =
        gesture.r
        +
        (
          Math.atan2(
            dy,
            dx
          )
          -
          gesture.a
        )
        *
        180
        /
        Math.PI;


      renderScene();
    }
  };


/* =========================================================
   POINTER END
========================================================= */

function pointerEnd(
  event
) {

  ptr.delete(
    event.pointerId
  );


  $("#gx")
    .classList
    .remove(
      "show"
    );


  $("#gy")
    .classList
    .remove(
      "show"
    );


  if (
    !ptr.size
  ) {

    gesture =
      null;

    save();

    renderTimeline();
  }
}


$("#stage").onpointerup =
  pointerEnd;


$("#stage").onpointercancel =
  pointerEnd;


/* =========================================================
   PLAY / PAUSE
========================================================= */

$("#play").onclick =
  () => {

    S.playing =
      !S.playing;


    $("#play")
      .textContent =
        S.playing
        ?
        "Ⅱ"
        :
        "▶";


    last =
      0;


    if (
      S.playing
    ) {

      if (
        S.time >=
        S.duration
      ) {
        S.time = 0;
      }


      requestAnimationFrame(
        tick
      );

    } else {

      nodes.forEach(
        el =>
          el
            .querySelector(
              "video"
            )
            ?.pause()
      );


      renderScene();
    }
  };


function tick(time) {

  if (
    !S.playing
  ) {
    return;
  }


  if (!last) {
    last = time;
  }


  S.time +=
    (
      time -
      last
    )
    /
    1000;


  last =
    time;


  if (
    S.time >=
    S.duration
  ) {

    S.time =
      S.duration;


    S.playing =
      false;


    $("#play")
      .textContent =
        "▶";
  }


  renderScene();

  updatePlayhead();


  if (
    S.playing
  ) {

    requestAnimationFrame(
      tick
    );
  }
}


/* =========================================================
   UNDO
========================================================= */

$("#undo").onclick =
  () => {

    if (
      !S.undo.length
    ) {
      return;
    }


    S.redo.push(
      snapshot()
    );


    const previous =
      JSON.parse(
        S.undo.pop()
      );


    Object.assign(
      S,
      previous
    );


    S.selected =
      null;


    clearNodes();

    save();

    renderAll();
  };


/* =========================================================
   REDO
========================================================= */

$("#redo").onclick =
  () => {

    if (
      !S.redo.length
    ) {
      return;
    }


    S.undo.push(
      snapshot()
    );


    const next =
      JSON.parse(
        S.redo.pop()
      );


    Object.assign(
      S,
      next
    );


    S.selected =
      null;


    clearNodes();

    save();

    renderAll();
  };


/* =========================================================
   EXPORT
========================================================= */

$("#export").onclick =
  () => {

    save();

    toast(
      "編集内容を保存しました。動画レンダラーは次段階です"
    );
  };


/* =========================================================
   SETTINGS
========================================================= */

$("#settings").onclick =
  () => {

    alert(
      "PB Editor v2.0 Studio\n\nメディアはIndexedDBに保存します。"
    );
  };


/* =========================================================
   FIT BUTTON
========================================================= */

$("#fit").onclick =
  () => {

    toast(
      "プレビューをキャンバスにフィット"
    );
  };


/* =========================================================
   START
========================================================= */

loadProjects();

show(
  "home"
);

})();
