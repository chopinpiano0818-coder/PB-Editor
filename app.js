(()=>{"use strict";
const $=q=>document.querySelector(q), stage=$("#stage"), tracks=$("#tracks");
let S={duration:10,time:0,aspect:"9:16",items:[],selected:null,undo:[],redo:[],playing:false};
let pointers=new Map(), gesture=null, last=0, raf=0;
const uid=()=>crypto.randomUUID?.()||Math.random().toString(36).slice(2);
const copy=o=>JSON.parse(JSON.stringify(o));
const current=()=>S.items.find(x=>x.id===S.selected);
const toast=t=>{let e=$("#toast");e.textContent=t;e.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display="none",1500)};
function history(){S.undo.push(JSON.stringify({duration:S.duration,aspect:S.aspect,items:S.items}));if(S.undo.length>60)S.undo.shift();S.redo=[]}
function save(silent=false){try{localStorage.setItem("pb-editor-v02",JSON.stringify({duration:S.duration,aspect:S.aspect,items:S.items}));if(!silent)toast("保存しました")}catch{toast("保存容量を超えました")}}
function load(){try{let d=JSON.parse(localStorage.getItem("pb-editor-v02"));if(d)Object.assign(S,d)}catch{}}
function fmt(t){let m=Math.floor(t/60),s=t%60;return String(m).padStart(2,"0")+":"+s.toFixed(2).padStart(5,"0")}
function applyAspect(){let[a,b]=S.aspect.split(":").map(Number);stage.style.aspectRatio=a+"/"+b;if(innerWidth>innerHeight){stage.style.height="min(62vh,calc(100vw*.44))";stage.style.width="auto"}else{stage.style.height="auto";stage.style.width=`min(${a/b*75}vh,92vw)`}$("#aspect").textContent=S.aspect}
function ease(u,type){if(type==="linear")return u;if(type==="in")return u*u;if(type==="out")return 1-(1-u)*(1-u);return u*u*(3-2*u)}
function at(x,t){if(!x.keys?.length)return x;let k=[...x.keys].sort((a,b)=>a.t-b.t);if(t<=k[0].t)return {...x,...k[0]};if(t>=k.at(-1).t)return {...x,...k.at(-1)};let a,b;for(let i=0;i<k.length-1;i++)if(t>=k[i].t&&t<=k[i+1].t){a=k[i];b=k[i+1];break}let u=ease((t-a.t)/(b.t-a.t),a.ease||"ease"),o={...x};["x","y","w","h","r","o"].forEach(n=>o[n]=a[n]+(b[n]-a[n])*u);return o}
function render(){
 applyAspect(); stage.querySelectorAll(".pip").forEach(e=>e.remove()); tracks.innerHTML="";
 S.items.forEach((raw,z)=>{
   let x=at(raw,S.time),e=document.createElement("div");
   e.className="pip "+(x.type==="text"?"txt ":"")+(x.id===S.selected?"sel":"");e.dataset.id=x.id;
   e.style.cssText=`width:${x.w}px;height:${x.h}px;transform:translate(${x.x}px,${x.y}px) rotate(${x.r}deg);opacity:${x.o/100};z-index:${z+1};display:${S.time>=x.start&&S.time<=x.end?"":"none"};color:${x.color||"#111"}`;
   if(x.type==="image"){let im=new Image();im.src=x.src;e.append(im)}
   else if(x.type==="video"){let v=document.createElement("video");v.src=x.src;v.muted=true;v.playsInline=true;try{v.currentTime=Math.max(0,S.time-x.start)}catch{}e.append(v)}
   else{e.textContent=x.text;e.style.fontSize=(x.fontSize||32)+"px"}
   stage.append(e);
   let tr=document.createElement("div");tr.className="track";let c=document.createElement("div");c.className="clip "+(x.id===S.selected?"sel":"");c.dataset.id=x.id;c.style.left=x.start/S.duration*100+"%";c.style.width=(x.end-x.start)/S.duration*100+"%";c.textContent=(x.keys?.length?"◇ ":"")+x.name;tr.append(c);tracks.append(tr);
 });
 $("#seek").max=S.duration;$("#seek").value=S.time;$("#duration").value=S.duration;$("#clock").textContent=fmt(S.time)+" / "+fmt(S.duration);inspect();
}
function select(id){S.selected=id;render();$("#inspector").hidden=!id}
function inspect(){let x=current();if(!x)return;$("#iname").textContent=x.name;[["ix","x"],["iy","y"],["iw","w"],["ih","h"],["ir","r"],["io","o"],["is","start"],["ie","end"]].forEach(([a,b])=>$("#"+a).value=Math.round(x[b]*100)/100);$("#textPanel").hidden=x.type!=="text";$("#videoPanel").hidden=x.type!=="video";if(x.type==="text"){$("#itext").value=x.text;$("#ifs").value=x.fontSize||32;$("#icolor").value=x.color||"#111111"}if(x.type==="video")$("#ivol").value=x.volume??100}
function addFile(f,src){let w=stage.clientWidth,h=stage.clientHeight,s=Math.min(w,h)*.34,type=f.type.startsWith("video")?"video":"image";let n={id:uid(),type,name:f.name,src,x:w/2-s/2,y:h/2-s/2,w:s,h:s,r:0,o:100,start:0,end:S.duration,keys:[],volume:100};S.items.push(n);S.selected=n.id}
$("#files").onchange=e=>{let fs=[...e.target.files];if(!fs.length)return;history();Promise.all(fs.map(f=>new Promise(ok=>{let r=new FileReader();r.onload=()=>{addFile(f,r.result);ok()};r.readAsDataURL(f)}))).then(()=>{render();save(true)});e.target.value=""};
$("#text").onclick=()=>{let t=prompt("文字を入力","TEXT");if(t===null)return;history();let w=stage.clientWidth,h=stage.clientHeight,n={id:uid(),type:"text",name:t,text:t,x:w*.25,y:h*.45,w:w*.5,h:55,r:0,o:100,start:0,end:S.duration,fontSize:32,color:"#111111",keys:[]};S.items.push(n);S.selected=n.id;render();save(true)};
stage.addEventListener("pointerdown",e=>{let el=e.target.closest(".pip");if(!el){select(null);return}if(S.selected!==el.dataset.id)select(el.dataset.id);let x=current();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});try{stage.setPointerCapture(e.pointerId)}catch{}if(pointers.size===1){history();gesture={mode:"move",x:x.x,y:x.y,p:[e.clientX,e.clientY]}}else if(pointers.size===2){let a=[...pointers.values()],dx=a[1].x-a[0].x,dy=a[1].y-a[0].y;gesture={mode:"pinch",dist:Math.hypot(dx,dy),ang:Math.atan2(dy,dx),w:x.w,h:x.h,r:x.r}}});
stage.addEventListener("pointermove",e=>{if(!pointers.has(e.pointerId)||!current())return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});let x=current(),a=[...pointers.values()];
 if(a.length===1&&gesture?.mode==="move"){let nx=gesture.x+a[0].x-gesture.p[0],ny=gesture.y+a[0].y-gesture.p[1],sw=stage.clientWidth,sh=stage.clientHeight,t=9,cx=nx+x.w/2,cy=ny+x.h/2,gx=false,gy=false;if(Math.abs(cx-sw/2)<t){nx=sw/2-x.w/2;gx=true}if(Math.abs(cy-sh/2)<t){ny=sh/2-x.h/2;gy=true}for(let o of S.items)if(o.id!==x.id){let ox=o.x+o.w/2,oy=o.y+o.h/2;if(Math.abs(cx-ox)<t){nx=ox-x.w/2;gx=true}if(Math.abs(cy-oy)<t){ny=oy-x.h/2;gy=true}}x.x=nx;x.y=ny;render();$("#gv").style.display=gx?"block":"none";$("#gh").style.display=gy?"block":"none"}
 else if(a.length===2){let dx=a[1].x-a[0].x,dy=a[1].y-a[0].y,d=Math.hypot(dx,dy),ang=Math.atan2(dy,dx);if(gesture?.mode!=="pinch")gesture={mode:"pinch",dist:d,ang,w:x.w,h:x.h,r:x.r};let k=d/gesture.dist;x.w=Math.max(10,gesture.w*k);x.h=Math.max(10,gesture.h*k);x.r=gesture.r+(ang-gesture.ang)*180/Math.PI;render()}
});
function up(e){pointers.delete(e.pointerId);if(!pointers.size){gesture=null;$("#gv").style.display=$("#gh").style.display="none";save(true)}else{let x=current(),a=[...pointers.values()][0];gesture={mode:"move",x:x.x,y:x.y,p:[a.x,a.y]}}}
stage.addEventListener("pointerup",up);stage.addEventListener("pointercancel",up);tracks.onclick=e=>{let c=e.target.closest(".clip");if(c)select(c.dataset.id)};
[["ix","x"],["iy","y"],["iw","w"],["ih","h"],["ir","r"],["io","o"],["is","start"],["ie","end"]].forEach(([a,b])=>$("#"+a).onchange=e=>{let x=current();if(!x)return;history();x[b]=+e.target.value;if(b==="start")x.start=Math.max(0,Math.min(x.start,x.end));if(b==="end")x.end=Math.min(S.duration,Math.max(x.start,x.end));render();save(true)});
$("#itext").onchange=e=>{let x=current();if(x?.type==="text"){history();x.text=x.name=e.target.value;render();save(true)}};$("#ifs").onchange=e=>{let x=current();if(x?.type==="text"){history();x.fontSize=+e.target.value;render();save(true)}};$("#icolor").oninput=e=>{let x=current();if(x?.type==="text"){x.color=e.target.value;render();save(true)}};$("#ivol").onchange=e=>{let x=current();if(x?.type==="video"){history();x.volume=+e.target.value;save(true)}};
$("#key").onclick=()=>{let x=current();if(!x)return;history();x.keys=x.keys||[];x.keys=x.keys.filter(k=>Math.abs(k.t-S.time)>.015);x.keys.push({t:S.time,x:x.x,y:x.y,w:x.w,h:x.h,r:x.r,o:x.o,ease:"ease"});render();save(true);toast("◇ キーフレーム追加")};
$("#anim").onclick=()=>{let x=current();if(!x)return;let a=prompt("pop / slide / bounce / shake","pop");if(!a)return;history();let t=S.time,b={x:x.x,y:x.y,w:x.w,h:x.h,r:x.r,o:x.o,ease:"out"},K=[];if(a==="pop")K=[{...b,t,w:x.w*.2,h:x.h*.2,o:0},{...b,t:t+.35}];else if(a==="slide")K=[{...b,t,x:x.x-150,o:0},{...b,t:t+.45}];else if(a==="bounce")K=[{...b,t},{...b,t:t+.18,y:x.y-45,ease:"in"},{...b,t:t+.38,ease:"out"}];else if(a==="shake")K=[{...b,t},{...b,t:t+.08,x:x.x-12},{...b,t:t+.16,x:x.x+12},{...b,t:t+.24,x:x.x-8},{...b,t:t+.32}];else return toast("その名前はまだありません");x.keys=(x.keys||[]).concat(K);render();save(true)};
$("#center").onclick=()=>{let x=current();if(!x)return;history();x.x=(stage.clientWidth-x.w)/2;x.y=(stage.clientHeight-x.h)/2;render();save(true)};
$("#fit").onclick=()=>{let x=current();if(!x)return;history();let k=Math.min(stage.clientWidth/x.w,stage.clientHeight/x.h)*.8;x.w*=k;x.h*=k;x.x=(stage.clientWidth-x.w)/2;x.y=(stage.clientHeight-x.h)/2;render();save(true)};
$("#front").onclick=()=>{let i=S.items.findIndex(x=>x.id===S.selected);if(i<0)return;history();S.items.push(S.items.splice(i,1)[0]);render();save(true)};
$("#back").onclick=()=>{let i=S.items.findIndex(x=>x.id===S.selected);if(i<0)return;history();S.items.unshift(S.items.splice(i,1)[0]);render();save(true)};
$("#dup").onclick=()=>{let x=current();if(!x)return;history();let n=copy(x);n.id=uid();n.name+=" copy";n.x+=15;n.y+=15;S.items.push(n);S.selected=n.id;render();save(true)};
$("#del").onclick=()=>{let i=S.items.findIndex(x=>x.id===S.selected);if(i<0)return;history();S.items.splice(i,1);S.selected=null;render();save(true)};
$("#close").onclick=()=>select(null);$("#aspect").onclick=()=>{history();S.aspect=S.aspect==="9:16"?"16:9":"9:16";requestAnimationFrame(render);save(true)};
$("#duration").onchange=e=>{history();S.duration=Math.max(1,+e.target.value||10);S.items.forEach(x=>x.end=Math.min(x.end,S.duration));S.time=Math.min(S.time,S.duration);render();save(true)};
$("#seek").oninput=e=>{S.time=+e.target.value;render()};
function tick(t){if(!S.playing)return;if(!last)last=t;S.time+=(t-last)/1000;last=t;if(S.time>=S.duration){S.time=0;S.playing=false;$("#play").textContent="▶︎";render();return}render();raf=requestAnimationFrame(tick)}
$("#play").onclick=()=>{S.playing=!S.playing;$("#play").textContent=S.playing?"⏸":"▶︎";last=0;if(S.playing)raf=requestAnimationFrame(tick);else cancelAnimationFrame(raf)};
$("#save").onclick=()=>save(false);
$("#undo").onclick=()=>{if(!S.undo.length)return;S.redo.push(JSON.stringify({duration:S.duration,aspect:S.aspect,items:S.items}));Object.assign(S,JSON.parse(S.undo.pop()));S.selected=null;render();save(true)};
$("#redo").onclick=()=>{if(!S.redo.length)return;S.undo.push(JSON.stringify({duration:S.duration,aspect:S.aspect,items:S.items}));Object.assign(S,JSON.parse(S.redo.pop()));S.selected=null;render();save(true)};
$("#export").onclick=()=>{toast("iPad用の本格動画書き出しはv0.3で実装予定");};
addEventListener("resize",()=>requestAnimationFrame(render));load();requestAnimationFrame(render);
})();
