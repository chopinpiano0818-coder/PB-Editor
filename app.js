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

    undo: [],
    redo: [],

    playing: false
  };


  /*
   * v0.3ではPIPのDOMを毎フレーム作り直さない。
   * ここがv0.2からの大きな軽量化ポイント。
   */

  const E = new Map();

  const P = new Map();

  let G = null;

  let last = 0;


  const uid = () =>
    Math.random()
      .toString(36)
      .slice(2);


  const cur = () =>
    S.items.find(
      x => x.id === S.selected
    );


  const cp = o =>
    JSON.parse(
      JSON.stringify(o)
    );


  function toast(text) {

    const e = $("#toast");

    e.textContent = text;

    e.style.display =
      "block";

    setTimeout(() => {

      e.style.display =
        "none";

    }, 1000);

  }


  /* ======================
     Undo履歴
  ====================== */

  function hist() {

    S.undo.push(
      JSON.stringify({
        duration:
          S.duration,

        aspect:
          S.aspect,

        items:
          S.items
      })
    );

    if (
      S.undo.length > 50
    ) {

      S.undo.shift();

    }

    S.redo = [];

  }


  /* ======================
     保存
  ====================== */

  function save(show = 0) {

    try {

      localStorage.setItem(
        "pb-v03",

        JSON.stringify({
          duration:
            S.duration,

          aspect:
            S.aspect,

          items:
            S.items
        })
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

      Object.assign(
        S,

        JSON.parse(
          localStorage.getItem(
            "pb-v03"
          )
        ) || {}
      );

    }

    catch {}

  }


  /* ======================
     イージング
  ====================== */

  function ease(
    u,
    type
  ) {

    if (
      type === "linear"
    ) {

      return u;

    }


    if (
      type === "in"
    ) {

      return u * u;

    }


    if (
      type === "out"
    ) {

      return (
        1 -
        (1 - u) ** 2
      );

    }


    return (
      u *
      u *
      (3 - 2 * u)
    );

  }


  /* ======================
     キーフレーム値
  ====================== */

  function val(
    item,
    time
  ) {

    const keys =
      [
        ...(item.keys || [])
      ].sort(
        (a, b) =>
          a.t - b.t
      );


    if (
      !keys.length
    ) {

      return item;

    }


    if (
      time <= keys[0].t
    ) {

      return {
        ...item,
        ...keys[0]
      };

    }


    if (
      time >=
      keys.at(-1).t
    ) {

      return {
        ...item,
        ...keys.at(-1)
      };

    }


    let a;
    let b;


    for (
      let i = 0;
      i < keys.length - 1;
      i++
    ) {

      if (
        time >= keys[i].t &&
        time <= keys[i + 1].t
      ) {

        a = keys[i];
        b = keys[i + 1];

        break;

      }

    }


    let u =
      (
        time - a.t
      ) /
      (
        b.t - a.t
      );


    u = ease(
      u,
      a.ease
    );


    const out = {
      ...item
    };


    [
      "x",
      "y",
      "w",
      "h",
      "r",
      "o"
    ].forEach(
      name => {

        out[name] =
          a[name] +
          (
            b[name] -
            a[name]
          ) *
          u;

      }
    );


    return out;

  }


  /* ======================
     PIP DOM生成
  ====================== */

  function makeElement(
    item
  ) {

    const e =
      document.createElement(
        "div"
      );


    e.className =
      "pip " +
      (
        item.type === "text"
          ? "text"
          : ""
      );


    e.dataset.id =
      item.id;


    if (
      item.type === "image"
    ) {

      const image =
        new Image();

      image.src =
        item.src;

      e.append(image);

    }


    else if (
      item.type === "video"
    ) {

      const video =
        document.createElement(
          "video"
        );

      video.src =
        item.src;

      video.muted =
        true;

      video.playsInline =
        true;

      e.append(video);

    }


    stage.append(e);

    E.set(
      item.id,
      e
    );


    return e;

  }


  /* ======================
     軽量プレビュー更新
  ====================== */

  function sync() {

    const [
      aw,
      ah
    ] =
      S.aspect.split(":");


    stage.style.aspectRatio =
      aw + "/" + ah;


    $("#aspect").textContent =
      S.aspect;


    for (
      const item of S.items
    ) {

      const e =
        E.get(item.id) ||
        makeElement(item);


      const v =
        val(
          item,
          S.time
        );


      e.classList.toggle(
        "selected",

        item.id ===
          S.selected
      );


      e.style.width =
        v.w + "px";


      e.style.height =
        v.h + "px";


      e.style.transform =
        `translate3d(${v.x}px, ${v.y}px, 0)
         rotate(${v.r}deg)`;


      e.style.opacity =
        v.o / 100;


      /*
       * display:noneではなく
       * visibilityを使う。
       *
       * v0.2の「突然消える」
       * 問題対策の一つ。
       */

      e.style.visibility =
        (
          S.time >=
            item.start &&

          S.time <=
            item.end
        )
          ? "visible"
          : "hidden";


      if (
        item.type === "text"
      ) {

        e.textContent =
          item.text;


        e.style.fontSize =
          (
            item.fontSize ||
            32
          ) +
          "px";


        e.style.color =
          item.color ||
          "#111";

      }

    }


    /*
     * 削除済みPIPだけ
     * DOMから消す。
     */

    for (
      const [
        id,
        element
      ] of E
    ) {

      if (
        !S.items.some(
          x => x.id === id
        )
      ) {

        element.remove();

        E.delete(id);

      }

    }


    $("#seek").max =
      S.duration;


    $("#seek").value =
      S.time;


    $("#clock").textContent =
      S.time.toFixed(2) +
      " / " +
      S.duration.toFixed(2);

  }


  /* ======================
     タイムライン
  ====================== */

  function timeline() {

    tracks.innerHTML =
      "";


    S.items.forEach(
      item => {

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
          "clip" +
          (
            item.id ===
              S.selected
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
          ) +
          "%";


        clip.style.width =
          (
            (
              item.end -
              item.start
            ) /
            S.duration *
            100
          ) +
          "%";


        clip.textContent =
          (
            item.keys?.length
              ? "◇ "
              : ""
          ) +
          item.name;


        track.append(
          clip
        );


        tracks.append(
          track
        );

      }
    );

  }


  /* ======================
     選択
  ====================== */

  function select(
    id
  ) {

    S.selected =
      id;


    $("#selectionBar").hidden =
      !id;


    $("#mainTools")
      .style
      .visibility =
        id
          ? "hidden"
          : "visible";


    sync();

    timeline();

  }


  /* ======================
     画像・動画PIP追加
  ====================== */

  $("#files").onchange =
    event => {

      const files =
        [
          ...event.target.files
        ];


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

                    const size =
                      Math.min(
                        stage.clientWidth,
                        stage.clientHeight
                      ) *
                      0.34;


                    const item = {

                      id:
                        uid(),

                      type:
                        file.type
                          .startsWith(
                            "video"
                          )
                          ? "video"
                          : "image",

                      name:
                        file.name,

                      src:
                        reader.result,

                      x:
                        (
                          stage.clientWidth -
                          size
                        ) /
                        2,

                      y:
                        (
                          stage.clientHeight -
                          size
                        ) /
                        2,

                      w:
                        size,

                      h:
                        size,

                      r:
                        0,

                      o:
                        100,

                      start:
                        0,

                      end:
                        S.duration,

                      keys:
                        [],

                      ease:
                        "ease"

                    };


                    S.items.push(
                      item
                    );


                    S.selected =
                      item.id;


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

    };


  /* ======================
     テキスト追加
  ====================== */

  $("#addText").onclick =
    () => {

      const text =
        prompt(
          "文字",
          "TEXT"
        );


      if (
        text == null
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
          text,

        text,

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

        o:
          100,

        start:
          0,

        end:
          S.duration,

        fontSize:
          32,

        color:
          "#111111",

        keys:
          [],

        ease:
          "ease"

      };


      S.items.push(
        item
      );


      select(
        item.id
      );


      save();

    };


  /* ======================
     タッチ開始
  ====================== */

  stage.onpointerdown =
    event => {

      const element =
        event.target.closest(
          ".pip"
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


      if (
        P.size === 1
      ) {

        hist();


        G = {

          mode:
            "move",

          x:
            item.x,

          y:
            item.y,

          p: [
            event.clientX,
            event.clientY
          ]

        };

      }


      else {

        const a =
          [
            ...P.values()
          ];


        const dx =
          a[1].x -
          a[0].x;


        const dy =
          a[1].y -
          a[0].y;


        G = {

          mode:
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


  /* ======================
     タッチ移動
  ====================== */

  stage.onpointermove =
    event => {

      if (
        !P.has(
          event.pointerId
        ) ||
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


      /*
       * 1本指
       * 移動
       */

      if (
        points.length === 1 &&
        G?.mode === "move"
      ) {

        item.x =
          G.x +
          points[0].x -
          G.p[0];


        item.y =
          G.y +
          points[0].y -
          G.p[1];


        const cx =
          item.x +
          item.w / 2;


        const cy =
          item.y +
          item.h / 2;


        /*
         * 中央スナップ
         */

        if (
          Math.abs(
            cx -
            stage.clientWidth /
            2
          ) <
          9
        ) {

          item.x =
            stage.clientWidth /
            2 -
            item.w /
            2;

        }


        if (
          Math.abs(
            cy -
            stage.clientHeight /
            2
          ) <
          9
        ) {

          item.y =
            stage.clientHeight /
            2 -
            item.h /
            2;

        }


        sync();

      }


      /*
       * 2本指
       * 拡大縮小＋回転
       */

      else if (
        points.length === 2
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


        const angle =
          Math.atan2(
            dy,
            dx
          );


        const scale =
          distance /
          G.d;


        item.w =
          Math.max(
            8,
            G.w * scale
          );


        item.h =
          Math.max(
            8,
            G.h * scale
          );


        item.r =
          G.r +
          (
            angle -
            G.a
          ) *
          180 /
          Math.PI;


        sync();

      }

    };


  /* ======================
     タッチ終了
  ====================== */

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

    }


    else {

      const item =
        cur();


      const point =
        [
          ...P.values()
        ][0];


      G = {

        mode:
          "move",

        x:
          item.x,

        y:
          item.y,

        p: [
          point.x,
          point.y
        ]

      };

    }

  }


  stage.onpointerup =
    pointerUp;


  stage.onpointercancel =
    pointerUp;


  /* ======================
     タイムライン選択
  ====================== */

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


  /* ======================
     選択メニュー
  ====================== */

  $("#selectionBar").onclick =
    event => {

      const button =
        event.target.closest(
          "button"
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
        button.dataset.act;


      if (
        action === "edit"
      ) {

        fillPanel();

        $("#panel").hidden =
          false;

      }


      else if (
        action === "key"
      ) {

        hist();


        item.keys =
          item.keys ||
          [];


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

          o:
            item.o,

          ease:
            item.ease

        });


        timeline();

        save();

        toast(
          "◇追加"
        );

      }


      else if (
        action === "anim"
      ) {

        $("#animSheet").hidden =
          false;

      }


      else if (
        action === "center"
      ) {

        hist();


        item.x =
          (
            stage.clientWidth -
            item.w
          ) /
          2;


        item.y =
          (
            stage.clientHeight -
            item.h
          ) /
          2;


        sync();

        save();

      }


      else if (
        action === "dup"
      ) {

        hist();


        const copy =
          cp(item);


        copy.id =
          uid();


        copy.x +=
          12;


        copy.y +=
          12;


        S.items.push(
          copy
        );


        select(
          copy.id
        );


        save();

      }


      else if (
        action === "del"
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

    };


  /* ======================
     詳細パネル
  ====================== */

  function fillPanel() {

    const item =
      cur();


    $("#pname").textContent =
      item.name;


    [
      ["x", "x"],
      ["y", "y"],
      ["w", "w"],
      ["h", "h"],
      ["r", "r"],
      ["o", "o"],
      ["start", "start"],
      ["end", "end"]
    ].forEach(
      ([id, key]) => {

        $("#" + id).value =
          item[key];

      }
    );


    $("#ease").value =
      item.ease;


    $("#textOpts").hidden =
      item.type !==
      "text";


    if (
      item.type === "text"
    ) {

      $("#txt").value =
        item.text;


      $("#fs").value =
        item.fontSize;


      $("#color").value =
        item.color;

    }

  }


  [
    ["x", "x"],
    ["y", "y"],
    ["w", "w"],
    ["h", "h"],
    ["r", "r"],
    ["o", "o"],
    ["start", "start"],
    ["end", "end"]
  ].forEach(
    ([id, key]) => {

      $("#" + id).onchange =
        event => {

          const item =
            cur();


          hist();


          item[key] =
            +event.target.value;


          sync();

          timeline();

          save();

        };

    }
  );


  $("#ease").onchange =
    event => {

      cur().ease =
        event.target.value;

      save();

    };


  $("#txt").onchange =
    event => {

      const item =
        cur();


      item.text =
        event.target.value;


      item.name =
        event.target.value;


      sync();

      timeline();

      save();

    };


  $("#fs").onchange =
    event => {

      cur().fontSize =
        +event.target.value;


      sync();

      save();

    };


  $("#color").oninput =
    event => {

      cur().color =
        event.target.value;


      sync();

    };


  $("#close").onclick =
    () => {

      $("#panel").hidden =
        true;

    };


  /* ======================
     アニメーション
  ====================== */

  $("#animSheet").onclick =
    event => {

      const button =
        event.target.closest(
          "[data-a]"
        );


      const item =
        cur();


      if (
        !button ||
        !item
      ) {

        return;

      }


      hist();


      const t =
        S.time;


      const base = {

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

        o:
          item.o,

        ease:
          item.ease

      };


      let keys =
        [];


      const type =
        button.dataset.a;


      if (
        type === "pop"
      ) {

        keys = [

          {
            ...base,
            t,
            w:
              item.w *
              0.2,
            h:
              item.h *
              0.2,
            o:
              0
          },

          {
            ...base,
            t:
              t +
              0.3
          }

        ];

      }


      if (
        type === "slide"
      ) {

        keys = [

          {
            ...base,
            t,
            x:
              item.x -
              150,
            o:
              0
          },

          {
            ...base,
            t:
              t +
              0.4
          }

        ];

      }


      if (
        type === "bounce"
      ) {

        keys = [

          {
            ...base,
            t
          },

          {
            ...base,
            t:
              t +
              0.16,
            y:
              item.y -
              45
          },

          {
            ...base,
            t:
              t +
              0.35
          }

        ];

      }


      if (
        type === "shake"
      ) {

        keys = [

          {
            ...base,
            t
          },

          {
            ...base,
            t:
              t +
              0.08,
            x:
              item.x -
              12
          },

          {
            ...base,
            t:
              t +
              0.16,
            x:
              item.x +
              12
          },

          {
            ...base,
            t:
              t +
              0.25
          }

        ];

      }


      if (
        type === "squash"
      ) {

        keys = [

          {
            ...base,
            t,
            w:
              item.w *
              1.15,
            h:
              item.h *
              0.75
          },

          {
            ...base,
            t:
              t +
              0.13,
            w:
              item.w *
              0.92,
            h:
              item.h *
              1.08
          },

          {
            ...base,
            t:
              t +
              0.28
          }

        ];

      }


      item.keys =
        (
          item.keys ||
          []
        ).concat(
          keys
        );


      $("#animSheet").hidden =
        true;


      timeline();

      save();

    };


  $("#animClose").onclick =
    () => {

      $("#animSheet").hidden =
        true;

    };


  /* ======================
     シーク
  ====================== */

  $("#seek").oninput =
    event => {

      S.time =
        +event.target.value;

      sync();

    };


  /* ======================
     動画長さ
  ====================== */

  $("#duration").onchange =
    event => {

      S.duration =
        Math.max(
          1,
          +event.target.value
        );


      sync();

      timeline();

      save();

    };


  /* ======================
     縦横比
  ====================== */

  $("#aspect").onclick =
    () => {

      S.aspect =
        S.aspect ===
        "9:16"
          ? "16:9"
          : "9:16";


      sync();

      save();

    };


  /* ======================
     再生

     タイムラインDOMは
     作り直さない。
  ====================== */

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
      ) /
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


      $("#play").textContent =
        "▶︎";


      sync();

      return;

    }


    sync();


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
          ? "⏸"
          : "▶︎";


      last =
        0;


      if (
        S.playing
      ) {

        requestAnimationFrame(
          tick
        );

      }

    };


  /* ======================
     保存
  ====================== */

  $("#save").onclick =
    () => {

      save(1);

    };


  /* ======================
     動画書き出し
  ====================== */

  $("#export").onclick =
    () => {

      toast(
        "書き出しレンダラーは次段階"
      );

    };


  /* ======================
     Undo
  ====================== */

  $("#undo").onclick =
    () => {

      if (
        !S.undo.length
      ) {

        return;

      }


      S.redo.push(

        JSON.stringify({

          duration:
            S.duration,

          aspect:
            S.aspect,

          items:
            S.items

        })

      );


      Object.assign(
        S,
        JSON.parse(
          S.undo.pop()
        )
      );


      E.forEach(
        e => e.remove()
      );


      E.clear();


      select(null);

      sync();

      timeline();

    };


  /* ======================
     Redo
  ====================== */

  $("#redo").onclick =
    () => {

      if (
        !S.redo.length
      ) {

        return;

      }


      S.undo.push(

        JSON.stringify({

          duration:
            S.duration,

          aspect:
            S.aspect,

          items:
            S.items

        })

      );


      Object.assign(
        S,
        JSON.parse(
          S.redo.pop()
        )
      );


      E.forEach(
        e => e.remove()
      );


      E.clear();


      select(null);

      sync();

      timeline();

    };


  /* ======================
     起動
  ====================== */

  load();

  sync();

  timeline();

})();
