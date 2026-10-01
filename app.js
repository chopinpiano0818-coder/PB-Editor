(() => {
  "use strict";

  const $ = q => document.querySelector(q);

  const stage = $("#stage");
  const tracks = $("#tracks");

  let S = {
    duration: 10,
    time: 0,
    aspect: "9:16",

    items: [],

    selected: null,

    playing: false,

    undo: [],
    redo: []
  };


  // ============================
  // 軽量化用
  // ============================

  const D = new Map();
  const P = new Map();

  let G = null;
  let last = 0;


  // ============================
  // 基本
  // ============================

  const uid = () =>
    Math.random()
      .toString(36)
      .slice(2);


  const cur = () =>
    S.items.find(
      x => x.id === S.selected
    );


  const snapshot = () =>
    JSON.stringify({
      duration: S.duration,
      aspect: S.aspect,
      items: S.items
    });


  // ============================
  // Toast
  // ============================

  function toast(text) {

    const e = $("#toast");

    e.textContent = text;

    e.style.display = "block";

    clearTimeout(toast.t);

    toast.t = setTimeout(
      () => {

        e.style.display = "none";

      },
      1200
    );

  }


  // ============================
  // Undo履歴
  // ============================

  function hist() {

    S.undo.push(
      snapshot()
    );

    if (
      S.undo.length > 50
    ) {

      S.undo.shift();

    }

    S.redo = [];

  }


  // ============================
  // 保存
  // ============================

  function save(
    show = false
  ) {

    try {

      localStorage.setItem(
        "pb-v1",
        snapshot()
      );


      if (show) {

        toast(
          "保存しました"
        );

      }

    }

    catch {

      toast(
        "保存容量不足"
      );

    }

  }


  function load() {

    try {

      const data =
        JSON.parse(
          localStorage.getItem(
            "pb-v1"
          )
        );


      if (data) {

        Object.assign(
          S,
          data
        );

      }

    }

    catch {}

  }


  // ============================
  // 時間表示
  // ============================

  function fmt(t) {

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


  // ============================
  // レイヤーDOM生成
  // ============================

  function make(item) {

    const e =
      document.createElement(
        "div"
      );


    e.className =
      "layer " +
      item.type;


    e.dataset.id =
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


      if (
        item.type === "video"
      ) {

        media.playsInline =
          true;

        media.muted =
          true;

        media.preload =
          "metadata";

      }


      e.append(
        media
      );

    }


    stage.append(
      e
    );


    D.set(
      item.id,
      e
    );


    return e;

  }


  // ============================
  // プレビュー更新
  // ============================

  function scene() {

    const [
      a,
      b
    ] =
      S.aspect.split(":");


    stage.style.aspectRatio =
      a + "/" + b;


    for (
      const item of S.items
    ) {

      const e =
        D.get(item.id) ||
        make(item);


      e.classList.toggle(
        "selected",
        item.id === S.selected
      );


      e.style.width =
        item.w + "px";


      e.style.height =
        item.h + "px";


      e.style.transform =
        `
        translate3d(
          ${item.x}px,
          ${item.y}px,
          0
        )
        rotate(
          ${item.r}deg
        )
        scaleX(
          ${item.flip ? -1 : 1}
        )
        `;


      e.style.opacity =
        item.opacity / 100;


      e.style.zIndex =
        S.items.indexOf(
          item
        ) + 1;


      // 時間範囲外だけ非表示

      e.style.visibility =
        (
          S.time >= item.start &&
          S.time <= item.end
        )
          ? "visible"
          : "hidden";


      // テキスト

      if (
        item.type === "text"
      ) {

        e.textContent =
          item.text;


        e.style.fontSize =
          item.fontSize +
          "px";


        e.style.color =
          item.color;

      }

    }


    // 削除されたDOMを掃除

    for (
      const [
        id,
        element
      ] of D
    ) {

      if (
        !S.items.some(
          x => x.id === id
        )
      ) {

        element.remove();

        D.delete(id);

      }

    }


    $("#seek").max =
      S.duration;


    $("#seek").value =
      S.time;


    $("#clock").textContent =
      fmt(S.time)
      +
      " / "
      +
      fmt(S.duration);

  }


  // ============================
  // タイムライン
  // ============================

  function timeline() {

    tracks.innerHTML =
      "";


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
            ? " selected"
            : ""
        );


      clip.dataset.id =
        item.id;


      clip.style.left =
        (
          item.start /
          S.duration *
          100
        )
        +
        "%";


      clip.style.width =
        Math.max(
          0.5,

          (
            item.end -
            item.start
          )
          /
          S.duration
          *
          100
        )
        +
        "%";


      clip.textContent =
        item.name;


      track.append(
        clip
      );


      tracks.append(
        track
      );

    }

  }


  // ============================
  // 選択
  // ============================

  function select(id) {

    S.selected =
      id;


    $("#clipbar").hidden =
      !id;


    $("#toolbar")
      .style
      .visibility =
        id
          ? "hidden"
          : "visible";


    scene();

    timeline();

  }


  // ============================
  // 素材追加
  // ============================

  function add(
    file,
    src,
    pip
  ) {

    const w =
      stage.clientWidth;


    const h =
      stage.clientHeight;


    const scale =
      0.5;


    const item = {

      id:
        uid(),

      type:
        file.type
          .startsWith("video")
          ? "video"
          : "image",

      name:
        file.name,

      src,

      x:
        pip
          ? w * 0.25
          : 0,

      y:
        pip
          ? h * 0.25
          : 0,

      w:
        pip
          ? w * scale
          : w,

      h:
        pip
          ? h * scale
          : h,

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


  // ============================
  // ファイル読み込み
  // ============================

  function importFiles(
    input,
    pip = false
  ) {

    const files =
      [
        ...input.files
      ];


    if (
      !files.length
    ) {

      return;

    }


    hist();


    Promise.all(

      files.map(
        file =>

          new Promise(
            done => {

              const reader =
                new FileReader();


              reader.onload =
                () => {

                  add(
                    file,
                    reader.result,
                    pip
                  );

                  done();

                };


              reader.readAsDataURL(
                file
              );

            }
          )

      )

    ).then(
      () => {

        select(
          S.selected
        );

        save();

      }
    );


    input.value =
      "";

  }


  $("#media").onchange =
    event => {

      importFiles(
        event.target
      );

    };


  // ============================
  // 下から出る設定画面
  // ============================

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


    $("#sheet").hidden =
      false;

  }


  $("#sheetClose").onclick =
    () => {

      $("#sheet").hidden =
        true;

    };


  // ============================
  // メインツール
  // ============================

  $("#toolbar").onclick =
    event => {

      const button =
        event.target.closest(
          "[data-tool]"
        );


      if (
        !button
      ) {

        return;

      }


      const tool =
        button.dataset.tool;


      // キャンバス

      if (
        tool === "canvas"
      ) {

        sheet(
          "キャンバス",

          `
          <div class="options">

            <button data-r="9:16">
              9:16
            </button>

            <button data-r="16:9">
              16:9
            </button>

            <button data-r="1:1">
              1:1
            </button>

            <button data-r="4:5">
              4:5
            </button>

            <button data-r="4:3">
              4:3
            </button>

          </div>
          `
        );

      }


      // テキスト

      if (
        tool === "text"
      ) {

        const value =
          prompt(
            "テキスト",
            "TEXT"
          );


        if (
          value == null
        ) {

          return;

        }


        hist();


        const item = {

          id:
            uid(),

          type:
            "text",

          name:
            value,

          text:
            value,

          x:
            40,

          y:
            100,

          w:
            180,

          h:
            55,

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


        select(
          item.id
        );


        save();

      }


      // PIP

      if (
        tool === "pip"
      ) {

        sheet(
          "PIP",

          `
          <label class="tool">

            ＋ PIP追加

            <input
              id="pipFile"
              type="file"
              accept="image/*,video/*"
              hidden
            >

          </label>
          `
        );


        setTimeout(
          () => {

            $("#pipFile")
              .onchange =
                event => {

                  importFiles(
                    event.target,
                    true
                  );

                };

          }
        );

      }


      // 調整

      if (
        tool === "filter"
      ) {

        sheet(
          "調整",

          `
          <div class="fields">

            <label>

              透明度

              <input
                id="opacity"
                type="range"
                min="0"
                max="100"
                value="100"
              >

            </label>

          </div>
          `
        );

      }

    };


  // ============================
  // キャンバス比率
  // ============================

  $("#sheetBody").onclick =
    event => {

      const ratio =
        event.target.dataset.r;


      if (
        ratio
      ) {

        hist();


        S.aspect =
          ratio;


        scene();

        save();


        $("#sheet").hidden =
          true;

      }

    };


  // ============================
  // PIP タッチ開始
  // ============================

  stage.onpointerdown =
    event => {

      const element =
        event.target.closest(
          ".layer"
        );


      if (
        !element
      ) {

        select(null);

        return;

      }


      select(
        element.dataset.id
      );


      P.set(
        event.pointerId,

        {
          x:
            event.clientX,

          y:
            event.clientY
        }
      );


      const item =
        cur();


      // 1本指

      if (
        P.size === 1
      ) {

        hist();


        G = {

          type:
            "move",

          x:
            item.x,

          y:
            item.y,

          px:
            event.clientX,

          py:
            event.clientY

        };

      }


      // 2本指

      else {

        const points =
          [
            ...P.values()
          ];


        const dx =
          points[1].x -
          points[0].x;


        const dy =
          points[1].y -
          points[0].y;


        G = {

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
            item.w,

          h:
            item.h,

          r:
            item.r

        };

      }

    };


  // ============================
  // PIP 移動 / 拡縮 / 回転
  // ============================

  stage.onpointermove =
    event => {

      if (
        !P.has(
          event.pointerId
        )
        ||
        !cur()
      ) {

        return;

      }


      P.set(
        event.pointerId,

        {
          x:
            event.clientX,

          y:
            event.clientY
        }
      );


      const item =
        cur();


      const points =
        [
          ...P.values()
        ];


      // 移動

      if (
        points.length === 1 &&
        G?.type === "move"
      ) {

        item.x =
          G.x
          +
          points[0].x
          -
          G.px;


        item.y =
          G.y
          +
          points[0].y
          -
          G.py;


        // 中央スナップ

        const cx =
          item.x +
          item.w / 2;


        const cy =
          item.y +
          item.h / 2;


        if (
          Math.abs(
            cx -
            stage.clientWidth / 2
          )
          <
          8
        ) {

          item.x =
            stage.clientWidth / 2
            -
            item.w / 2;

        }


        if (
          Math.abs(
            cy -
            stage.clientHeight / 2
          )
          <
          8
        ) {

          item.y =
            stage.clientHeight / 2
            -
            item.h / 2;

        }


        scene();

      }


      // 2本指

      else if (
        points.length === 2
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
          G.d;


        item.w =
          Math.max(
            10,
            G.w * scale
          );


        item.h =
          Math.max(
            10,
            G.h * scale
          );


        item.r =
          G.r
          +
          (
            Math.atan2(
              dy,
              dx
            )
            -
            G.a
          )
          *
          180
          /
          Math.PI;


        scene();

      }

    };


  // ============================
  // タッチ終了
  // ============================

  function pointerUp(
    event
  ) {

    P.delete(
      event.pointerId
    );


    if (
      !P.size
    ) {

      G =
        null;


      save();

      timeline();

    }

  }


  stage.onpointerup =
    pointerUp;


  stage.onpointercancel =
    pointerUp;


  // ============================
  // タイムライン選択
  // ============================

  tracks.onclick =
    event => {

      const clip =
        event.target.closest(
          ".clip"
        );


      if (
        clip
      ) {

        select(
          clip.dataset.id
        );

      }

    };


  // ============================
  // クリップ編集
  // ============================

  $("#clipbar").onclick =
    event => {

      const button =
        event.target.closest(
          "[data-action]"
        );


      const item =
        cur();


      if (
        !button ||
        !item
      ) {

        return;

      }


      const action =
        button.dataset.action;


      // 削除

      if (
        action === "delete"
      ) {

        hist();


        S.items =
          S.items.filter(
            x =>
              x.id !==
              item.id
          );


        select(null);

        save();

      }


      // 複製

      if (
        action === "duplicate"
      ) {

        hist();


        const copy =
          JSON.parse(
            JSON.stringify(
              item
            )
          );


        copy.id =
          uid();


        copy.name +=
          " copy";


        copy.x +=
          15;


        copy.y +=
          15;


        S.items.push(
          copy
        );


        select(
          copy.id
        );


        save();

      }


      // 回転

      if (
        action === "rotate"
      ) {

        hist();


        item.r =
          (
            item.r +
            90
          )
          %
          360;


        scene();

        save();

      }


      // 反転

      if (
        action === "flip"
      ) {

        hist();


        item.flip =
          !item.flip;


        scene();

        save();

      }


      // 分割

      if (
        action === "split"
      ) {

        if (
          S.time <= item.start ||
          S.time >= item.end
        ) {

          return toast(
            "クリップ内に再生ヘッドを置いてください"
          );

        }


        hist();


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


        timeline();

        save();

      }


      // トリム

      if (
        action === "trim"
      ) {

        sheet(
          "トリム",

          `
          <div class="fields">

            <label>

              開始

              <input
                id="trimS"
                type="number"
                step=".01"
                value="${item.start}"
              >

            </label>


            <label>

              終了

              <input
                id="trimE"
                type="number"
                step=".01"
                value="${item.end}"
              >

            </label>

          </div>
          `
        );

      }


      // 速度

      if (
        action === "speed"
      ) {

        sheet(
          "速度",

          `
          <div class="options">

            ${[
              0.25,
              0.5,
              1,
              1.5,
              2,
              3,
              4
            ]
              .map(
                value =>
                  `
                  <button
                    data-speed="${value}"
                  >
                    ${value}×
                  </button>
                  `
              )
              .join("")
            }

          </div>
          `
        );

      }


      // 音量

      if (
        action === "volume"
      ) {

        sheet(
          "音量",

          `
          <div class="fields">

            <label>

              音量 %

              <input
                id="vol"
                type="range"
                min="0"
                max="100"
                value="${item.volume}"
              >

            </label>

          </div>
          `
        );

      }


      // キーフレーム

      if (
        action === "key"
      ) {

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


        toast(
          "◇ キーフレーム追加"
        );


        save();

      }

    };


  // ============================
  // 速度ボタン
  // ============================

  $("#sheetBody")
    .addEventListener(
      "click",

      event => {

        const value =
          event.target
            .dataset
            .speed;


        if (
          value &&
          cur()
        ) {

          hist();


          cur().speed =
            +value;


          toast(
            value +
            "×"
          );


          save();

        }

      }
    );


  // ============================
  // 設定値変更
  // ============================

  $("#sheetBody").onchange =
    event => {

      const item =
        cur();


      if (
        !item
      ) {

        return;

      }


      // トリム開始

      if (
        event.target.id ===
        "trimS"
      ) {

        hist();


        item.start =
          Math.max(
            0,

            Math.min(
              +event.target.value,
              item.end
            )
          );


        timeline();

        scene();

        save();

      }


      // トリム終了

      if (
        event.target.id ===
        "trimE"
      ) {

        hist();


        item.end =
          Math.min(
            S.duration,

            Math.max(
              +event.target.value,
              item.start
            )
          );


        timeline();

        scene();

        save();

      }


      // 音量

      if (
        event.target.id ===
        "vol"
      ) {

        item.volume =
          +event.target.value;


        save();

      }


      // 透明度

      if (
        event.target.id ===
        "opacity"
      ) {

        item.opacity =
          +event.target.value;


        scene();

        save();

      }

    };


  // ============================
  // シーク
  // ============================

  $("#seek").oninput =
    event => {

      S.time =
        +event.target.value;


      scene();

    };


  // ============================
  // 再生
  // ============================

  function tick(
    time
  ) {

    if (
      !S.playing
    ) {

      return;

    }


    if (
      !last
    ) {

      last =
        time;

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
        0;


      S.playing =
        false;


      $("#play")
        .textContent =
          "▶";


      scene();

      return;

    }


    scene();


    requestAnimationFrame(
      tick
    );

  }


  $("#play").onclick =
    () => {

      S.playing =
        !S.playing;


      $("#play").textContent =
        S.playing
          ? "Ⅱ"
          : "▶";


      last =
        0;


      if (
        S.playing
      ) {

        requestAnimationFrame(
          tick
        );

      }

      else {

        scene();

      }

    };


  // ============================
  // 保存
  // ============================

  $("#save").onclick =
    () => {

      save(true);

    };


  // ============================
  // Undo
  // ============================

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


      Object.assign(
        S,

        JSON.parse(
          S.undo.pop()
        )
      );


      D.forEach(
        e => e.remove()
      );


      D.clear();


      select(null);

    };


  // ============================
  // Redo
  // ============================

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


      Object.assign(
        S,

        JSON.parse(
          S.redo.pop()
        )
      );


      D.forEach(
        e => e.remove()
      );


      D.clear();


      select(null);

    };


  // ============================
  // 書き出し
  // ============================

  $("#export").onclick =
    () => {

      toast(
        "書き出しエンジンは次段階で接続"
      );

    };


  // ============================
  // 起動
  // ============================

  load();

  scene();

  timeline();

})();
