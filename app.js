(() => {
"use strict";

/* =========================================================
   PB EDITOR v1.1
   HOME + PROJECTS + EDITOR
========================================================= */

const $ = q => document.querySelector(q);

const homeScreen = $("#homeScreen");
const editorScreen = $("#editorScreen");
const stage = $("#stage");
const tracks = $("#tracks");
const mainToolbar = $("#mainToolbar");
const clipToolbar = $("#clipToolbar");

const PROJECT_KEY = "pb-editor-projects-v11";

let projects = [];
let currentProjectId = null;
let menuProjectId = null;

let S = emptyState();

const DOM = new Map();
const pointers = new Map();

let gesture = null;
let lastFrame = 0;
let timelineZoom = 1;


/* =========================================================
   STATE
========================================================= */

function emptyState() {
  return {
    duration: 10,
    time: 0,
    aspect: "9:16",

    items: [],

    selected: null,

    playing: false,

    undo: [],
    redo: []
  };
}

function uid() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

function currentItem() {
  return S.items.find(
    x => x.id === S.selected
  );
}


/* =========================================================
   TOAST
========================================================= */

function toast(text) {

  const el = $("#toast");

  el.textContent = text;
  el.style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.style.display = "none";
  }, 1300);
}


/* =========================================================
   PROJECT STORAGE
========================================================= */

function loadProjects() {

  try {

    const data =
      JSON.parse(
        localStorage.getItem(PROJECT_KEY)
      );

    projects =
      Array.isArray(data)
        ? data
        : [];

  } catch {

    projects = [];

  }

  renderProjects();
}


function saveProjects() {

  try {

    localStorage.setItem(
      PROJECT_KEY,
      JSON.stringify(projects)
    );

    $("#saveStatus").textContent =
      "保存済み";

  } catch {

    $("#saveStatus").textContent =
      "保存失敗";

    toast(
      "保存容量が不足しています"
    );

  }
}


/* =========================================================
   PROJECT SNAPSHOT
========================================================= */

function editorData() {

  return {
    duration: S.duration,
    aspect: S.aspect,
    items: S.items
  };
}


function stateSnapshot() {

  return JSON.stringify(
    editorData()
  );
}


/* =========================================================
   HISTORY
========================================================= */

function history() {

  S.undo.push(
    stateSnapshot()
  );

  if (S.undo.length > 50) {
    S.undo.shift();
  }

  S.redo = [];

  $("#saveStatus").textContent =
    "編集中";
}


/* =========================================================
   CREATE PROJECT
========================================================= */

function createProject(name = "新しいプロジェクト") {

  const project = {
    id: uid(),

    name,

    created:
      Date.now(),

    updated:
      Date.now(),

    duration:
      10,

    aspect:
      "9:16",

    items:
      []
  };

  projects.unshift(
    project
  );

  saveProjects();

  return project;
}


/* =========================================================
   SAVE CURRENT PROJECT
========================================================= */

function saveCurrentProject(showToast = false) {

  if (!currentProjectId) {
    return;
  }

  const project =
    projects.find(
      p => p.id === currentProjectId
    );

  if (!project) {
    return;
  }

  project.name =
    $("#projectName").value.trim()
    ||
    "名称未設定";

  project.updated =
    Date.now();

  project.duration =
    S.duration;

  project.aspect =
    S.aspect;

  project.items =
    JSON.parse(
      JSON.stringify(
        S.items
      )
    );

  saveProjects();

  if (showToast) {
    toast("プロジェクトを保存しました");
  }
}


/* =========================================================
   HOME / EDITOR SWITCH
========================================================= */

function showHome() {

  S.playing = false;

  $("#play").textContent =
    "▶";

  pauseAllVideos();

  homeScreen.classList.add(
    "active"
  );

  editorScreen.classList.remove(
    "active"
  );

  renderProjects();
}


function showEditor() {

  homeScreen.classList.remove(
    "active"
  );

  editorScreen.classList.add(
    "active"
  );

  requestAnimationFrame(() => {
    clearDOM();
    renderScene();
    renderTimeline();
  });
}


/* =========================================================
   OPEN PROJECT
========================================================= */

function openProject(id) {

  const project =
    projects.find(
      p => p.id === id
    );

  if (!project) {
    return;
  }

  currentProjectId =
    project.id;

  S =
    emptyState();

  S.duration =
    project.duration || 10;

  S.aspect =
    project.aspect || "9:16";

  S.items =
    JSON.parse(
      JSON.stringify(
        project.items || []
      )
    );

  $("#projectName").value =
    project.name;

  $("#saveStatus").textContent =
    "保存済み";

  S.time = 0;
  S.selected = null;

  $("#seek").value = 0;

  showEditor();
}


/* =========================================================
   PROJECT HOME CARDS
========================================================= */

function renderProjects() {

  const list =
    $("#projectList");

  list.innerHTML = "";

  if (!projects.length) {

    list.innerHTML = `
      <div
        id="emptyProjects"
        class="emptyProjects"
      >
        <div class="emptyIcon">
          🎬
        </div>

        <b>
          まだプロジェクトがありません
        </b>

        <span>
          「ビデオ」から最初の作品を作ってみよう
        </span>
      </div>
    `;

    return;
  }

  for (const project of projects) {

    const card =
      document.createElement("article");

    card.className =
      "projectCard";

    card.dataset.id =
      project.id;


    /* Thumbnail */

    const thumb =
      document.createElement("div");

    thumb.className =
      "projectThumb";


    const firstMedia =
      project.items.find(
        x =>
          x.type === "image" ||
          x.type === "video"
      );


    if (firstMedia) {

      if (
        firstMedia.type === "image"
      ) {

        const img =
          document.createElement("img");

        img.src =
          firstMedia.src;

        thumb.append(
          img
        );

      } else {

        const video =
          document.createElement("video");

        video.src =
          firstMedia.src;

        video.muted =
          true;

        video.playsInline =
          true;

        thumb.append(
          video
        );

      }

    } else {

      const icon =
        document.createElement("div");

      icon.className =
        "projectThumbIcon";

      icon.textContent =
        "🎬";

      thumb.append(
        icon
      );

    }


    const duration =
      document.createElement("span");

    duration.className =
      "projectDuration";

    duration.textContent =
      formatTime(
        project.duration || 10
      );

    thumb.append(
      duration
    );


    /* Info */

    const info =
      document.createElement("div");

    info.className =
      "projectInfo";


    const text =
      document.createElement("div");

    text.className =
      "projectInfoText";


    const title =
      document.createElement("b");

    title.textContent =
      project.name;


    const date =
      document.createElement("small");

    date.textContent =
      formatDate(
        project.updated
      );


    text.append(
      title,
      date
    );


    const more =
      document.createElement("button");

    more.className =
      "projectMore";

    more.textContent =
      "⋯";


    info.append(
      text,
      more
    );


    card.append(
      thumb,
      info
    );


    card.onclick =
      event => {

        if (
          event.target.closest(
            ".projectMore"
          )
        ) {
          return;
        }

        openProject(
          project.id
        );
      };


    more.onclick =
      event => {

        event.stopPropagation();

        openProjectMenu(
          project.id
        );
      };


    list.append(
      card
    );
  }
}


/* =========================================================
   DATE
========================================================= */

function formatDate(time) {

  if (!time) {
    return "";
  }

  const d =
    new Date(time);

  return (
    (d.getMonth() + 1)
    +
    "/"
    +
    d.getDate()
    +
    " "
    +
    String(
      d.getHours()
    ).padStart(2, "0")
    +
    ":"
    +
    String(
      d.getMinutes()
    ).padStart(2, "0")
  );
}


/* =========================================================
   PROJECT MENU
========================================================= */

function openProjectMenu(id) {

  menuProjectId =
    id;

  const project =
    projects.find(
      p => p.id === id
    );

  if (!project) {
    return;
  }

  $("#projectMenuTitle")
    .textContent =
      project.name;

  $("#projectMenu")
    .hidden =
      false;
}


$("#closeProjectMenu").onclick =
  () => {

    $("#projectMenu").hidden =
      true;

    menuProjectId =
      null;
  };


$("#renameProject").onclick =
  () => {

    const project =
      projects.find(
        p => p.id === menuProjectId
      );

    if (!project) {
      return;
    }

    const name =
      prompt(
        "プロジェクト名",
        project.name
      );

    if (
      name !== null &&
      name.trim()
    ) {

      project.name =
        name.trim();

      project.updated =
        Date.now();

      saveProjects();
      renderProjects();
    }

    $("#projectMenu").hidden =
      true;
  };


$("#duplicateProject").onclick =
  () => {

    const project =
      projects.find(
        p => p.id === menuProjectId
      );

    if (!project) {
      return;
    }

    const copy =
      JSON.parse(
        JSON.stringify(
          project
        )
      );

    copy.id =
      uid();

    copy.name +=
      " コピー";

    copy.created =
      Date.now();

    copy.updated =
      Date.now();

    projects.unshift(
      copy
    );

    saveProjects();
    renderProjects();

    $("#projectMenu").hidden =
      true;

    toast(
      "複製しました"
    );
  };


$("#deleteProject").onclick =
  () => {

    const project =
      projects.find(
        p => p.id === menuProjectId
      );

    if (!project) {
      return;
    }

    if (
      !confirm(
        `「${project.name}」を削除しますか？`
      )
    ) {
      return;
    }

    projects =
      projects.filter(
        p =>
          p.id !==
          menuProjectId
      );

    saveProjects();
    renderProjects();

    $("#projectMenu").hidden =
      true;

    toast(
      "削除しました"
    );
  };


/* =========================================================
   NEW PROJECT
========================================================= */

$("#newCanvas").onclick =
  () => {

    const project =
      createProject();

    openProject(
      project.id
    );
  };


$("#newVideo").onclick =
  () => {

    $("#homeMedia")
      .dataset.mode =
        "video";

    $("#homeMedia")
      .click();
  };


$("#newPhoto").onclick =
  () => {

    $("#homeMedia")
      .dataset.mode =
        "photo";

    $("#homeMedia")
      .click();
  };


$("#homeMedia").onchange =
  event => {

    const files =
      [...event.target.files];

    if (!files.length) {
      return;
    }

    const project =
      createProject();

    openProject(
      project.id
    );

    importFilesArray(
      files,
      false
    );

    event.target.value =
      "";
  };


/* =========================================================
   BACK HOME
========================================================= */

$("#backHome").onclick =
  () => {

    saveCurrentProject();

    S.selected =
      null;

    showHome();
  };


/* =========================================================
   PROJECT NAME
========================================================= */

$("#projectName").oninput =
  () => {

    $("#saveStatus").textContent =
      "編集中";
  };


$("#projectName").onchange =
  () => {

    saveCurrentProject();
  };


/* =========================================================
   TIME
========================================================= */

function formatTime(t) {

  t =
    Math.max(
      0,
      Number(t) || 0
    );

  const m =
    Math.floor(
      t / 60
    );

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
   MEDIA DOM
========================================================= */

function createLayer(item) {

  const el =
    document.createElement(
      "div"
    );

  el.className =
    "layer " +
    item.type;

  el.dataset.id =
    item.id;


  if (
    item.type === "image" ||
    item.type === "video"
  ) {

    const media =
      document.createElement(
        item.type === "video"
          ? "video"
          : "img"
      );

    media.src =
      item.src;

    media.draggable =
      false;


    if (
      item.type === "video"
    ) {

      media.playsInline =
        true;

      media.preload =
        "metadata";

      media.muted =
        true;
    }

    el.append(
      media
    );
  }


  stage.append(
    el
  );

  DOM.set(
    item.id,
    el
  );

  return el;
}


/* =========================================================
   CLEAR DOM
========================================================= */

function clearDOM() {

  DOM.forEach(
    el => el.remove()
  );

  DOM.clear();
}


/* =========================================================
   RENDER SCENE
========================================================= */

function renderScene() {

  const [
    aw,
    ah
  ] =
    S.aspect.split(":");


  stage.style.aspectRatio =
    `${aw}/${ah}`;


  for (const item of S.items) {

    const el =
      DOM.get(item.id)
      ||
      createLayer(item);


    el.classList.toggle(
      "selected",
      item.id === S.selected
    );


    el.style.width =
      item.w + "px";

    el.style.height =
      item.h + "px";


    el.style.transform =
      `
      translate3d(
        ${item.x}px,
        ${item.y}px,
        0
      )
      rotate(
        ${item.r || 0}deg
      )
      scaleX(
        ${item.flip ? -1 : 1}
      )
      `;


    el.style.opacity =
      (
        item.opacity ??
        100
      )
      /
      100;


    el.style.zIndex =
      S.items.indexOf(
        item
      ) + 1;


    el.style.visibility =
      (
        S.time >= item.start &&
        S.time <= item.end
      )
      ?
      "visible"
      :
      "hidden";


    if (
      item.type === "text"
    ) {

      el.textContent =
        item.text;

      el.style.fontSize =
        (
          item.fontSize || 32
        )
        +
        "px";

      el.style.color =
        item.color ||
        "#ffffff";
    }
  }


  for (
    const [
      id,
      el
    ]
    of DOM
  ) {

    if (
      !S.items.some(
        x => x.id === id
      )
    ) {

      el.remove();

      DOM.delete(
        id
      );
    }
  }


  $("#seek").max =
    S.duration;

  $("#seek").value =
    S.time;

  $("#clock").textContent =
    formatTime(
      S.time
    )
    +
    " / "
    +
    formatTime(
      S.duration
    );


  syncVideoPreview();
}


/* =========================================================
   VIDEO PREVIEW
========================================================= */

function syncVideoPreview() {

  for (const item of S.items) {

    if (
      item.type !== "video"
    ) {
      continue;
    }

    const el =
      DOM.get(
        item.id
      );

    if (!el) {
      continue;
    }

    const video =
      el.querySelector(
        "video"
      );

    if (!video) {
      continue;
    }

    const visible =
      (
        S.time >= item.start &&
        S.time <= item.end
      );


    if (!visible) {

      video.pause();

      continue;
    }


    const speed =
      item.speed || 1;


    const target =
      Math.max(
        0,
        (
          S.time -
          item.start
        )
        *
        speed
      );


    if (
      !S.playing &&
      Number.isFinite(
        video.duration
      )
    ) {

      const safeTarget =
        Math.min(
          target,
          Math.max(
            0,
            video.duration - 0.01
          )
        );

      if (
        Math.abs(
          video.currentTime -
          safeTarget
        )
        >
        0.12
      ) {

        try {
          video.currentTime =
            safeTarget;
        } catch {}
      }
    }


    video.playbackRate =
      Math.min(
        4,
        Math.max(
          0.25,
          speed
        )
      );


    if (S.playing) {

      video.play()
        .catch(() => {});

    } else {

      video.pause();
    }
  }
}


function pauseAllVideos() {

  DOM.forEach(
    el => {

      const video =
        el.querySelector(
          "video"
        );

      if (video) {
        video.pause();
      }
    }
  );
}


/* =========================================================
   SELECT
========================================================= */

function selectItem(id) {

  S.selected =
    id;

  clipToolbar.hidden =
    !id;

  mainToolbar.hidden =
    !!id;

  renderScene();

  renderTimeline();
}


/* =========================================================
   TIMELINE
========================================================= */

function renderTimeline() {

  tracks.innerHTML =
    "";

  const pxPerSecond =
    85 *
    timelineZoom;

  const contentWidth =
    Math.max(
      $("#timelineScroll")
        .clientWidth,
      S.duration *
      pxPerSecond +
      100
    );


  $("#timelineContent")
    .style
    .width =
      contentWidth +
      "px";


  for (
    const item of S.items
  ) {

    const track =
      document.createElement(
        "div"
      );

    track.className =
      "track";


    const clip =
      document.createElement(
        "div"
      );

    clip.className =
      "clip "
      +
      item.type
      +
      (
        item.id === S.selected
          ?
          " selected"
          :
          ""
      );


    clip.dataset.id =
      item.id;


    clip.style.left =
      (
        item.start *
        pxPerSecond
      )
      +
      "px";


    clip.style.width =
      Math.max(
        20,
        (
          item.end -
          item.start
        )
        *
        pxPerSecond
      )
      +
      "px";


    clip.textContent =
      item.name;


    track.append(
      clip
    );

    tracks.append(
      track
    );
  }


  updatePlayhead();
}


/* =========================================================
   PLAYHEAD
========================================================= */

function updatePlayhead() {

  const pxPerSecond =
    85 *
    timelineZoom;

  $("#playhead")
    .style
    .left =
      (
        20 +
        S.time *
        pxPerSecond
      )
      +
      "px";
}


/* =========================================================
   TIMELINE ZOOM
========================================================= */

$("#timelinePlus").onclick =
  () => {

    timelineZoom =
      Math.min(
        4,
        timelineZoom * 1.25
      );

    renderTimeline();
  };


$("#timelineMinus").onclick =
  () => {

    timelineZoom =
      Math.max(
        0.5,
        timelineZoom / 1.25
      );

    renderTimeline();
  };


/* =========================================================
   TIMELINE CLICK
========================================================= */

tracks.onclick =
  event => {

    const clip =
      event.target.closest(
        ".clip"
      );

    if (!clip) {
      return;
    }

    selectItem(
      clip.dataset.id
    );
  };


/* =========================================================
   IMPORT MEDIA
========================================================= */

function importFilesArray(
  files,
  pip = false
) {

  if (!files.length) {
    return;
  }

  history();


  Promise.all(

    files.map(
      file =>
        new Promise(
          resolve => {

            const reader =
              new FileReader();


            reader.onload =
              () => {

                addMedia(
                  file,
                  reader.result,
                  pip
                );

                resolve();
              };


            reader.readAsDataURL(
              file
            );
          }
        )
    )

  ).then(() => {

    selectItem(
      S.selected
    );

    saveCurrentProject();

  });
}


function addMedia(
  file,
  src,
  pip
) {

  const sw =
    stage.clientWidth ||
    300;

  const sh =
    stage.clientHeight ||
    533;


  const item = {

    id:
      uid(),

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

    src,

    x:
      pip
      ?
      sw * 0.25
      :
      0,

    y:
      pip
      ?
      sh * 0.25
      :
      0,

    w:
      pip
      ?
      sw * 0.5
      :
      sw,

    h:
      pip
      ?
      sh * 0.5
      :
      sh,

    r:
      0,

    flip:
      false,

    opacity:
      100,

    start:
      0,

    end:
      S.duration,

    speed:
      1,

    volume:
      100,

    keys:
      []
  };


  S.items.push(
    item
  );

  S.selected =
    item.id;
}


$("#media").onchange =
  event => {

    importFilesArray(
      [...event.target.files],
      false
    );

    event.target.value =
      "";
  };


/* =========================================================
   SHEET
========================================================= */

function showSheet(
  title,
  html
) {

  $("#sheetTitle")
    .textContent =
      title;

  $("#sheetBody")
    .innerHTML =
      html;

  $("#sheet").hidden =
    false;
}


function closeSheet() {

  $("#sheet").hidden =
    true;
}


$("#sheetClose").onclick =
  closeSheet;


/* =========================================================
   MAIN TOOLBAR
========================================================= */

mainToolbar.onclick =
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


    /* Canvas */

    if (
      tool === "canvas"
    ) {

      showSheet(
        "キャンバス",
        `
        <div class="options">
          <button data-ratio="9:16">9:16</button>
          <button data-ratio="16:9">16:9</button>
          <button data-ratio="1:1">1:1</button>
          <button data-ratio="4:5">4:5</button>
          <button data-ratio="4:3">4:3</button>
        </div>
        `
      );
    }


    /* Text */

    if (
      tool === "text"
    ) {

      const text =
        prompt(
          "テキスト",
          "TEXT"
        );

      if (text === null) {
        return;
      }

      history();

      const item = {

        id:
          uid(),

        type:
          "text",

        name:
          text || "テキスト",

        text:
          text || "TEXT",

        x:
          40,

        y:
          100,

        w:
          190,

        h:
          60,

        r:
          0,

        flip:
          false,

        opacity:
          100,

        start:
          S.time,

        end:
          S.duration,

        fontSize:
          32,

        color:
          "#ffffff",

        keys:
          []
      };

      S.items.push(
        item
      );

      selectItem(
        item.id
      );

      saveCurrentProject();
    }


    /* PIP */

    if (
      tool === "pip"
    ) {

      showSheet(
        "PIP",
        `
        <label class="toolButton">
          <div class="toolIcon">＋</div>
          <span>PIPを追加</span>

          <input
            id="pipFile"
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
          >
        </label>
        `
      );

      requestAnimationFrame(
        () => {

          const input =
            $("#pipFile");

          input.onclick =
            () => {};

          input.onchange =
            event => {

              importFilesArray(
                [...event.target.files],
                true
              );

              event.target.value =
                "";

              closeSheet();
            };
        }
      );
    }


    /* Music */

    if (
      tool === "music"
    ) {

      showSheet(
        "音楽",
        `
        <p>
          音楽トラック・効果音・録音は
          次の編集機能追加でここに入ります。
        </p>
        `
      );
    }


    /* Sticker */

    if (
      tool === "sticker"
    ) {

      showSheet(
        "ステッカー",
        `
        <div class="options">
          <button data-sticker="😀">😀</button>
          <button data-sticker="💥">💥</button>
          <button data-sticker="⭐">⭐</button>
          <button data-sticker="❤️">❤️</button>
          <button data-sticker="⚡">⚡</button>
        </div>
        `
      );
    }


    /* Filter */

    if (
      tool === "filter"
    ) {

      showSheet(
        "フィルター",
        `
        <div class="options">
          <button>Original</button>
          <button>Warm</button>
          <button>Cool</button>
          <button>B&W</button>
        </div>
        `
      );
    }


    /* Background */

    if (
      tool === "background"
    ) {

      showSheet(
        "背景",
        `
        <div class="options">
          <button data-bg="#000000">黒</button>
          <button data-bg="#ffffff">白</button>
          <button data-bg="#1d1d1d">濃灰</button>
          <button data-bg="#eeeeee">薄灰</button>
        </div>
        `
      );
    }
  };


/* =========================================================
   SHEET BUTTONS
========================================================= */

$("#sheetBody").onclick =
  event => {

    const ratio =
      event.target.dataset.ratio;

    if (ratio) {

      history();

      S.aspect =
        ratio;

      renderScene();
      saveCurrentProject();

      closeSheet();

      return;
    }


    const bg =
      event.target.dataset.bg;

    if (bg) {

      stage.style.background =
        bg;

      return;
    }


    const sticker =
      event.target.dataset.sticker;

    if (sticker) {

      history();

      const item = {

        id:
          uid(),

        type:
          "text",

        name:
          sticker,

        text:
          sticker,

        x:
          70,

        y:
          100,

        w:
          80,

        h:
          80,

        r:
          0,

        flip:
          false,

        opacity:
          100,

        start:
          S.time,

        end:
          S.duration,

        fontSize:
          60,

        color:
          "#ffffff",

        keys:
          []
      };

      S.items.push(
        item
      );

      closeSheet();

      selectItem(
        item.id
      );

      saveCurrentProject();
    }
  };


/* =========================================================
   POINTER EDITING
========================================================= */

stage.onpointerdown =
  event => {

    const layer =
      event.target.closest(
        ".layer"
      );

    if (!layer) {

      selectItem(null);

      return;
    }


    const id =
      layer.dataset.id;

    selectItem(
      id
    );


    try {
      stage.setPointerCapture(
        event.pointerId
      );
    } catch {}


    pointers.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY
      }
    );


    const item =
      currentItem();

    if (!item) {
      return;
    }


    if (
      pointers.size === 1
    ) {

      history();

      gesture = {
        type: "move",

        itemX:
          item.x,

        itemY:
          item.y,

        startX:
          event.clientX,

        startY:
          event.clientY
      };

    } else if (
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


      gesture = {
        type: "pinch",

        distance:
          Math.hypot(
            dx,
            dy
          ),

        angle:
          Math.atan2(
            dy,
            dx
          ),

        w:
          item.w,

        h:
          item.h,

        r:
          item.r
      };
    }
  };


stage.onpointermove =
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
      currentItem();

    if (!item) {
      return;
    }


    const points =
      [...pointers.values()];


    /* MOVE */

    if (
      points.length === 1 &&
      gesture?.type === "move"
    ) {

      item.x =
        gesture.itemX
        +
        points[0].x
        -
        gesture.startX;


      item.y =
        gesture.itemY
        +
        points[0].y
        -
        gesture.startY;


      const centerX =
        item.x +
        item.w / 2;

      const centerY =
        item.y +
        item.h / 2;


      let snapX =
        false;

      let snapY =
        false;


      if (
        Math.abs(
          centerX -
          stage.clientWidth / 2
        )
        <
        9
      ) {

        item.x =
          stage.clientWidth / 2
          -
          item.w / 2;

        snapX =
          true;
      }


      if (
        Math.abs(
          centerY -
          stage.clientHeight / 2
        )
        <
        9
      ) {

        item.y =
          stage.clientHeight / 2
          -
          item.h / 2;

        snapY =
          true;
      }


      $("#guideX")
        .classList.toggle(
          "show",
          snapX
        );

      $("#guideY")
        .classList.toggle(
          "show",
          snapY
        );


      renderScene();
    }


    /* PINCH + ROTATE */

    else if (
      points.length === 2 &&
      gesture?.type === "pinch"
    ) {

      const dx =
        points[1].x -
        points[0].x;

      const dy =
        points[1].y -
        points[0].y;


      const distance =
        Math.hypot(
          dx,
          dy
        );


      const scale =
        distance /
        gesture.distance;


      item.w =
        Math.max(
          20,
          gesture.w *
          scale
        );


      item.h =
        Math.max(
          20,
          gesture.h *
          scale
        );


      item.r =
        gesture.r
        +
        (
          Math.atan2(
            dy,
            dx
          )
          -
          gesture.angle
        )
        *
        180
        /
        Math.PI;


      renderScene();
    }
  };


function pointerEnd(event) {

  pointers.delete(
    event.pointerId
  );

  $("#guideX")
    .classList.remove(
      "show"
    );

  $("#guideY")
    .classList.remove(
      "show"
    );


  if (
    pointers.size === 0
  ) {

    gesture =
      null;

    renderTimeline();

    saveCurrentProject();
  }
}


stage.onpointerup =
  pointerEnd;

stage.onpointercancel =
  pointerEnd;


/* =========================================================
   CLIP TOOLBAR
========================================================= */

clipToolbar.onclick =
  event => {

    const button =
      event.target.closest(
        "[data-action]"
      );

    const item =
      currentItem();

    if (
      !button ||
      !item
    ) {
      return;
    }


    const action =
      button.dataset.action;


    /* DELETE */

    if (
      action === "delete"
    ) {

      history();

      S.items =
        S.items.filter(
          x =>
            x.id !== item.id
        );

      selectItem(null);

      saveCurrentProject();

      return;
    }


    /* DUPLICATE */

    if (
      action === "duplicate"
    ) {

      history();

      const copy =
        JSON.parse(
          JSON.stringify(
            item
          )
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

      selectItem(
        copy.id
      );

      saveCurrentProject();

      return;
    }


    /* ROTATE */

    if (
      action === "rotate"
    ) {

      history();

      item.r =
        (
          item.r +
          90
        )
        %
        360;

      renderScene();

      saveCurrentProject();

      return;
    }


    /* FLIP */

    if (
      action === "flip"
    ) {

      history();

      item.flip =
        !item.flip;

      renderScene();

      saveCurrentProject();

      return;
    }


    /* SPLIT */

    if (
      action === "split"
    ) {

      if (
        S.time <= item.start ||
        S.time >= item.end
      ) {

        toast(
          "クリップ内に再生ヘッドを置いてください"
        );

        return;
      }


      history();


      const copy =
        JSON.parse(
          JSON.stringify(
            item
          )
        );


      copy.id =
        uid();

      copy.name +=
        " 2";

      copy.start =
        S.time;

      item.end =
        S.time;


      S.items.splice(
        S.items.indexOf(
          item
        ) + 1,
        0,
        copy
      );


      renderTimeline();

      saveCurrentProject();

      return;
    }


    /* TRIM */

    if (
      action === "trim"
    ) {

      showSheet(
        "トリミング",
        `
        <div class="fields">

          <label>
            開始
            <input
              id="trimStart"
              type="number"
              step="0.01"
              value="${item.start}"
            >
          </label>

          <label>
            終了
            <input
              id="trimEnd"
              type="number"
              step="0.01"
              value="${item.end}"
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

      showSheet(
        "速度",
        `
        <div class="options">
          <button data-speed="0.25">0.25×</button>
          <button data-speed="0.5">0.5×</button>
          <button data-speed="1">1×</button>
          <button data-speed="1.5">1.5×</button>
          <button data-speed="2">2×</button>
          <button data-speed="3">3×</button>
          <button data-speed="4">4×</button>
        </div>
        `
      );

      return;
    }


    /* VOLUME */

    if (
      action === "volume"
    ) {

      showSheet(
        "音量",
        `
        <div class="fields">
          <label>
            音量 ${item.volume ?? 100}%
            <input
              id="volumeSlider"
              type="range"
              min="0"
              max="100"
              value="${item.volume ?? 100}"
            >
          </label>
        </div>
        `
      );

      return;
    }


    /* CROP */

    if (
      action === "crop"
    ) {

      toast(
        "クロップ画面は次段階で実装"
      );

      return;
    }


    /* LAYER */

    if (
      action === "layer"
    ) {

      showSheet(
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
      action === "keyframe"
    ) {

      if (!item.keys) {
        item.keys = [];
      }

      item.keys.push({
        t:
          S.time,

        x:
          item.x,

        y:
          item.y,

        w:
          item.w,

        h:
          item.h,

        r:
          item.r,

        opacity:
          item.opacity
      });


      item.keys.sort(
        (a, b) =>
          a.t - b.t
      );


      saveCurrentProject();

      toast(
        "◇ キーフレーム追加"
      );
    }
  };


/* =========================================================
   SHEET INTERACTION
========================================================= */

$("#sheetBody").addEventListener(
  "click",
  event => {

    const item =
      currentItem();


    /* SPEED */

    if (
      event.target.dataset.speed &&
      item
    ) {

      history();

      item.speed =
        Number(
          event.target.dataset.speed
        );

      saveCurrentProject();

      toast(
        item.speed +
        "×"
      );

      closeSheet();

      return;
    }


    /* LAYER */

    const layerAction =
      event.target.dataset.layer;

    if (
      layerAction &&
      item
    ) {

      history();

      const index =
        S.items.indexOf(
          item
        );


      if (
        layerAction === "front"
      ) {

        S.items.splice(
          index,
          1
        );

        S.items.push(
          item
        );
      }


      if (
        layerAction === "back"
      ) {

        S.items.splice(
          index,
          1
        );

        S.items.unshift(
          item
        );
      }


      if (
        layerAction === "forward" &&
        index <
        S.items.length - 1
      ) {

        [
          S.items[index],
          S.items[index + 1]
        ] =
        [
          S.items[index + 1],
          S.items[index]
        ];
      }


      if (
        layerAction === "backward" &&
        index > 0
      ) {

        [
          S.items[index],
          S.items[index - 1]
        ] =
        [
          S.items[index - 1],
          S.items[index]
        ];
      }


      renderScene();
      renderTimeline();

      saveCurrentProject();

      closeSheet();
    }
  }
);


/* =========================================================
   SHEET CHANGE
========================================================= */

$("#sheetBody").addEventListener(
  "input",
  event => {

    const item =
      currentItem();

    if (!item) {
      return;
    }


    if (
      event.target.id ===
      "volumeSlider"
    ) {

      item.volume =
        Number(
          event.target.value
        );

      saveCurrentProject();
    }
  }
);


$("#sheetBody").addEventListener(
  "change",
  event => {

    const item =
      currentItem();

    if (!item) {
      return;
    }


    if (
      event.target.id ===
      "trimStart"
    ) {

      history();

      item.start =
        Math.max(
          0,
          Math.min(
            Number(
              event.target.value
            ),
            item.end
          )
        );

      renderScene();
      renderTimeline();

      saveCurrentProject();
    }


    if (
      event.target.id ===
      "trimEnd"
    ) {

      history();

      item.end =
        Math.min(
          S.duration,
          Math.max(
            Number(
              event.target.value
            ),
            item.start
          )
        );

      renderScene();
      renderTimeline();

      saveCurrentProject();
    }
  }
);


/* =========================================================
   SEEK
========================================================= */

$("#seek").oninput =
  event => {

    S.time =
      Number(
        event.target.value
      );

    renderScene();
    updatePlayhead();
  };


/* =========================================================
   PLAY
========================================================= */

function playbackTick(time) {

  if (!S.playing) {
    return;
  }


  if (!lastFrame) {
    lastFrame = time;
  }


  const delta =
    (
      time -
      lastFrame
    )
    /
    1000;


  lastFrame =
    time;


  S.time +=
    delta;


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

    pauseAllVideos();

    renderScene();
    updatePlayhead();

    return;
  }


  renderScene();

  updatePlayhead();


  requestAnimationFrame(
    playbackTick
  );
}


$("#play").onclick =
  () => {

    S.playing =
      !S.playing;


    $("#play").textContent =
      S.playing
      ?
      "Ⅱ"
      :
      "▶";


    lastFrame =
      0;


    if (S.playing) {

      if (
        S.time >=
        S.duration
      ) {
        S.time = 0;
      }

      requestAnimationFrame(
        playbackTick
      );

    } else {

      pauseAllVideos();

      renderScene();
    }
  };


/* =========================================================
   UNDO
========================================================= */

$("#undo").onclick =
  () => {

    if (!S.undo.length) {
      return;
    }


    S.redo.push(
      stateSnapshot()
    );


    const previous =
      JSON.parse(
        S.undo.pop()
      );


    S.duration =
      previous.duration;

    S.aspect =
      previous.aspect;

    S.items =
      previous.items;


    S.selected =
      null;


    clearDOM();

    selectItem(null);

    saveCurrentProject();
  };


/* =========================================================
   REDO
========================================================= */

$("#redo").onclick =
  () => {

    if (!S.redo.length) {
      return;
    }


    S.undo.push(
      stateSnapshot()
    );


    const next =
      JSON.parse(
        S.redo.pop()
      );


    S.duration =
      next.duration;

    S.aspect =
      next.aspect;

    S.items =
      next.items;


    S.selected =
      null;


    clearDOM();

    selectItem(null);

    saveCurrentProject();
  };


/* =========================================================
   FULLSCREEN
========================================================= */

$("#previewFullscreen").onclick =
  () => {

    if (
      stage.requestFullscreen
    ) {

      stage.requestFullscreen()
        .catch(() => {});

    } else {

      toast(
        "このブラウザでは全画面表示を利用できません"
      );
    }
  };


/* =========================================================
   EXPORT
========================================================= */

$("#export").onclick =
  () => {

    saveCurrentProject();

    toast(
      "動画書き出しエンジンは次の段階で接続"
    );
  };


/* =========================================================
   HOME SETTINGS
========================================================= */

$("#homeSettings").onclick =
  () => {

    alert(
      "PB Editor v1.1\n\nホーム画面＋複数プロジェクト対応"
    );
  };


$("#projectManage").onclick =
  () => {

    toast(
      "各プロジェクトの「⋯」から管理できます"
    );
  };


/* =========================================================
   START
========================================================= */

loadProjects();

showHome();

})();
