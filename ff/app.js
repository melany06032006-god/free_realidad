/* Copia de ../../vr/vr.js adaptada a IWSDK (ver src/shim.js): misma lógica, mismo recorrido y mismo diseño. */
/* Free Frequency VR — la página interactiva llevada a realidad virtual y aumentada (antes con A-Frame; aquí sobre IWSDK).
   Reutiliza los archivos originales del proyecto:
     · js/data.js ............ todos los textos (zonas, objetos, temas, historias, sintonizador, preparación)
     · js/characters-3d.js ... Mateo y Valeria con su lenguaje corporal (respirar, gestos al hablar, mirar, saludar, miedo, parpadeo)
     · js/scenery.js ......... los escenarios de Blender del Cauca y de Cali (con toon shader, nubes, árboles y el sismo)
     · js/toon-shader.js ..... el toon shader de Substance de los objetos
     · js/audio.js / tuner.js  los mismos sonidos y el mismo sintonizador
   Recorrido (solo zona rural, Cauca): Portada → «Comenzar» → Mateo con la radio y la linterna sobre la mesa → recorrido de cada objeto:
   Objeto · Práctica (el objeto se adapta a tus manos) · Personaje · Información → despedida. Tras la radio, el botón «Linterna» lleva a su práctica.
   Nada es real: no se envían mensajes ni se hacen llamadas. */
(function () {
  "use strict";
  var UI = window.VRUI, C = UI.C, FF = window.FF, AU = window.FFAudio, TU = window.FFTuner;
  var V3 = THREE.Vector3, D2R = Math.PI / 180;
  var sceneEl, root, camEl, lobbyEl, worldEl;
  var tmpV = new V3(), tmpV2 = new V3(), tmpV3 = new V3(), tmpQ = new THREE.Quaternion();
  /* REALIDAD AUMENTADA SOBRE UNA MESA: todo el contenido vive en la raíz (src/main.js), que se coloca sobre la superficie real que el usuario
     eligió al escanear. En la raíz: y = 0 es la superficie de la mesa, −Z se aleja del usuario y +Z va hacia él. Las medidas son metros reales.
     Nada flota: los personajes caminan sobre la mesa, los objetos se apoyan en ella y las tarjetas están de pie sobre un soporte. */
  var CHAR_H = 0.3;     // alto de los personajes sobre la mesa (30 cm, como una figura)
  var CHAR_Z = -0.12;   // fondo de la mesa donde camina el personaje
  var WALK = { x0: -0.2, x1: 0.2, z0: -0.2, z1: -0.05, speed: 0.055 };   // zona por la que camina (m) y velocidad (m/s)
  /* SOLO LA ZONA RURAL (Cauca, con Mateo) y solo dos objetos: la radio y la linterna. La zona urbana y el teléfono se quitaron de la experiencia.
     «Comenzar» lleva directo al menú rural (Mateo y los dos objetos sobre la mesa). */
  if (FF.zones) delete FF.zones.urbano;
  var ORDER = ["radio", "linterna"];
  var JT = new V3(), JI = new V3(), JA = new V3(), JB = new V3();   // articulaciones de los dedos (FFX.hands.joint)

  /* ---------- compatibilidad: el toon shader se escribió para Three.js r149; A-Frame 1.6 trae r164 (el fragmento se llama «opaque_fragment») ---------- */
  (function () {
    var T = window.FFToon; if (!T) return;
    ["apply", "soft"].forEach(function (k) {
      var f = T[k];
      T[k] = function (m, o) {
        if (!m || m.userData.ffToonVR) return m;
        f(m, o); var ob = m.onBeforeCompile; m.userData.ffToonVR = true;
        m.onBeforeCompile = function (sh, r) {
          sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", "#include <output_fragment>");
          ob(sh, r);
          sh.fragmentShader = sh.fragmentShader.replace("#include <output_fragment>", "#include <opaque_fragment>");
        };
        return m;
      };
    });
  })();

  /* ---------- materiales (los mismos de js/hub.js) ---------- */
  var ramp = null;
  function toon(color, extra) {
    if (!ramp) { ramp = new THREE.DataTexture(new Uint8Array([105, 175, 255]), 3, 1, THREE.RedFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true; }
    var m = new THREE.MeshToonMaterial(Object.assign({ color: color, gradientMap: ramp }, extra || {}));
    m.userData.base = new THREE.Color(color); return m;
  }
  function otoon(color, extra) { var m = toon(color, extra); return window.FFToon ? window.FFToon.apply(m) : m; }
  function basic(color, extra) { var m = new THREE.MeshBasicMaterial(Object.assign({ color: color }, extra || {})); m.userData.base = new THREE.Color(color); return m; }
  function canvasTex(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  function radial(stops) { return canvasTex(256, 256, function (x, w, h) { var g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); x.fillStyle = g; x.fillRect(0, 0, w, h); }); }
  var SHADOW_TEX = null;
  function contactShadow(r) {
    if (!SHADOW_TEX) SHADOW_TEX = radial([[0, "rgba(20,24,16,.6)"], [0.55, "rgba(20,24,16,.3)"], [1, "rgba(20,24,16,0)"]]);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.2), new THREE.MeshBasicMaterial({ map: SHADOW_TEX, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.006; m.renderOrder = 1; return m;
  }

  /* ---------- objetos de Blender (assets/models/objetos) con el toon shader, como en el menú de la página ---------- */
  var OBJ = {
    radio: { file: "assets/models/objetos/Radio.glb", ref: /^Cuerpo_Radio/ },
    torch: { file: "assets/models/objetos/Linterna.glb" }
  };
  var glb = {};
  function loadGLB(file) {
    if (!glb[file]) glb[file] = new Promise(function (ok, ko) { new THREE.GLTFLoader().load(encodeURI(file), function (g) { ok(g.scene); }, undefined, ko); });
    return glb[file];
  }
  function kindFor(item) { return item === "linterna" ? "torch" : "radio"; }
  /* size: metros (alto para teléfono y linterna; ancho del cuerpo para la radio). Devuelve un grupo con la base en y = 0 */
  function makeObject(kind, size) {
    var spec = OBJ[kind];
    return loadGLB(spec.file).then(function (src) {
      var o = src.clone(true), mats = new Map();
      o.traverse(function (n) {
        if (!n.isMesh) return; var s = n.material;
        if (!mats.has(s.uuid)) { var m = otoon(0xffffff, { side: s.side }); m.name = s.name; m.color.copy(s.color); m.userData.base.copy(m.color); if (s.map) m.map = s.map; mats.set(s.uuid, m); }
        n.material = mats.get(s.uuid);
      });
      o.updateMatrixWorld(true);
      var ref = new THREE.Box3(); if (spec.ref) o.traverse(function (n) { if (n.isMesh && spec.ref.test(n.name)) ref.expandByObject(n); });
      var sz = (ref.isEmpty() ? new THREE.Box3().setFromObject(o) : ref).getSize(new V3());
      o.scale.setScalar(kind.indexOf("radio") === 0 ? size / sz.x : size / sz.y); o.updateMatrixWorld(true);
      var box = new THREE.Box3().setFromObject(o), c = box.getCenter(new V3());
      o.position.set(-c.x, -box.min.y, -c.z);
      var g = new THREE.Group(); g.add(o); g.updateMatrixWorld(true);
      var b2 = new THREE.Box3().setFromObject(g); g.userData = { box: b2, size: b2.getSize(new V3()), kind: kind };
      return g;
    });
  }

  /* ---------- personajes: los modelos y el lenguaje corporal de js/characters-3d.js ---------- */
  function Char(zone, parent, scale) {
    var self = this; this.zone = zone; this.g = new THREE.Group(); this.g.scale.setScalar(scale); parent.add(this.g);
    this.kind = "none"; this.topic = "x"; this.farewell = false; this.look = null; this.fear = 0; this.hold = null; this.light = null;
    this.g.add(contactShadow(1.1));
    window.FFCharacters.load(zone, this.g).then(function (api) { self.api = api; if (self.onReady) self.onReady(api); })
      .catch(function (e) { console.error("Personaje 3D:", e); });
  }
  var HP = new V3(), HA = new V3(), HK = new V3();
  Char.prototype.update = function (t) {
    var a = this.api; if (!a) return;
    a.lookAt = this.look; a.fear = this.fear;
    a.update(t, this.topic, this.fear > 0.01 ? "quake" : this.kind, false, !!a.talking, 1, this.farewell);
    /* objeto en la mano izquierda (la que sostiene): se coloca con el hueco de la mano que calcula characters-3d.js */
    var h = this.hold; if (!h || !h.obj) return;
    if (!a.holdFrame(HP, HA, HK)) return;
    var q = a.root.getWorldQuaternion(tmpQ), up = tmpV.set(0, 1, 0).applyQuaternion(q), fw = tmpV2.set(0, 0, 1).applyQuaternion(q), side = tmpV3.set(1, 0, 0).applyQuaternion(q);
    var o = h.obj, s = o.userData.size;
    o.quaternion.copy(q);
    if (h.kind === "radio") { o.position.copy(HP).addScaledVector(up, -s.y * 0.98).addScaledVector(fw, 0.01); }
    else { o.position.copy(HK).addScaledVector(fw, 0.0); o.rotateY(0.9); o.rotateX(Math.PI / 2 - 0.15); o.translateY(-s.y * 0.45); }
  };
  Char.prototype.say = function (text, ms) {
    var a = this.api, self = this; if (!a) return;
    a.say(text); a.talking = true; a.pose = "talk"; clearTimeout(this.sayT);
    this.sayT = setTimeout(function () { if (self.api) { self.api.talking = false; if (self.api.pose === "talk") self.api.pose = "relief"; } }, ms || Math.max(1800, text.length * 65));
  };

  /* ---------- estado ---------- */
  var S = { view: "home", zone: null, item: null, ti: 0, step: 0, token: 0, explored: { rural: {} }, hubSel: null, hubPrev: null };
  function later(ms, fn) { var tk = S.token; return setTimeout(function () { if (tk === S.token) fn(); }, ms); }
  function zoneData() { return FF.zones[S.zone]; }
  function itemExplored(z, id) { return FF.zones[z].items[id].objects.filter(function (o) { return S.explored[z][id + ":" + o.id]; }).length; }
  var P = {};   // paneles

  /* =====================================================================================
     PORTADA Y SELECTOR DE ZONA (lobby): cielo del atardecer de la portada, resplandor, anillos de señal y suelo
     ===================================================================================== */
  var lobby = { chars: [], rings: [] };
  function buildLobby() {
    var g = lobbyEl.object3D;
    /* cielo: el degradado de #view-home (de arriba hacia el horizonte) */
    var skyT = canvasTex(8, 512, function (x, w, h) {
      var gr = x.createLinearGradient(0, 0, 0, h);
      [[0, "#0f2e38"], [0.17, "#1f4f5a"], [0.31, "#8f8b6c"], [0.41, "#f0b27a"], [0.5, "#f8d89e"], [0.5, "#4a3823"], [1, "#2f2216"]].forEach(function (s) { gr.addColorStop(s[0], s[1]); });
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; g.add(sky);
    /* resplandor cálido detrás del título (.home-glow) */
    var glow = new THREE.Mesh(new THREE.PlaneGeometry(38, 38), new THREE.MeshBasicMaterial({ map: radial([[0, "rgba(255,214,140,.75)"], [0.45, "rgba(255,214,140,0)"], [1, "rgba(255,214,140,0)"]]), transparent: true, depthWrite: false, fog: false }));
    glow.position.set(0, 0.5, -20); g.add(glow);
    /* anillos que se expanden (.rings): ondas de señal, acostadas sobre la mesa alrededor de la escena */
    for (var i = 0; i < 4; i++) {
      var r = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128), new THREE.MeshBasicMaterial({ color: 0xf5b335, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2; r.position.set(0, 0.002, -0.08); g.add(r); lobby.rings.push(r);
    }
    lobby.bg = [sky, glow];   // en realidad aumentada se ocultan: se ve el cuarto real (en el computador queda la mesa virtual de src/main.js)

    /* portada: título, frase, «Comenzar» y la nota educativa (mismos textos que index.html), de pie sobre la mesa */
    P.home = new UI.Panel({ parent: lobbyEl, pos: [0, 0, -0.2], rot: [-8, 0, 0], w: 0.62, anchor: "bottom", stand: true, onClick: act, spec: homeSpec() });
    /* personajes de la portada (igual que antes): Mateo a la izquierda y la chica a la derecha, de pie sobre la mesa y saludando (js/home-chars.js) */
    [["rural", -0.4, 0.45], ["urbano", 0.4, -0.45]].forEach(function (d, i) {
      var holder = new THREE.Group(); holder.position.set(d[1], 0, -0.06); holder.rotation.y = d[2]; g.add(holder);
      var c = new Char(d[0], holder, CHAR_H / 4.4); c.slot = { delay: i ? 1.1 : 0.3, wave: i ? "left" : "right", inner: i ? "right" : "left", k: i, phase: i * 1.3 };
      c.onReady = function (api) { api.waveSide = c.slot.wave; api.gestureSide = c.slot.inner; api.mood = "happy"; };
      lobby.chars.push(c);
    });
  }
  function homeSpec() {
    var xr = window.FFX && FFX.immersive && FFX.immersive();
    return { w: 1300, pad: [46, 50, 46, 50], bg: "rgba(10,24,32,.86)", radius: 48, items: [
      { t: "text", size: 150, weight: 700, lh: 1.0, ls: -0.025, align: "center", color: "#ffffff", shadow: true, parts: [["Free ", {}], ["Frequency", { italic: true, color: C.signal }]], mb: 22 },
      { t: "text", size: 48, weight: 700, italic: true, align: "center", color: "#ffffff", shadow: true, text: "Cuando la señal se apaga, la comunicación no.", mb: 38 },
      { t: "buttons", align: "center", size: 36, h: 96, padX: 70, gap: 24, list: [{ id: "start", label: "Comenzar", kind: "cream" }, xr ? { id: "replace", label: "Mover a otra mesa", kind: "light" } : null], mb: 34 },
      { t: "text", size: 30, weight: 600, lh: 1.45, align: "center", color: "#ffffff", shadow: true, text: "Experiencia educativa: ninguna alternativa garantiza la\ncomunicación. Combínalas y prepárate con tiempo.", mb: 18 },
      { t: "text", size: 26, weight: 600, lh: 1.45, align: "center", color: C.peach, text: "Usa tus manos: toca los botones con la punta del índice o pellízcalos (pulgar + índice) a distancia." }
    ] };
  }
  /* coreografía de bienvenida (js/home-chars.js): saludan por turnos, después un gesto distinto cada 5–8 s; al apuntar a «Comenzar» lo miran y lo señalan */
  var ACTS = ["nod", "center", "tilt", "present", "wave"], ACTS_Z = ["nod", "tilt", "wave"], ctaOn = false, ctaN = 0;
  function choreo(c, t) {
    var s = c.slot, api = c.api, home = !c.zoneCard, list = home ? ACTS : ACTS_Z;
    if (!s.on) { s.on = true; s.greet = t + s.delay; s.waveUntil = s.greet + 3.2; s.next = s.waveUntil + 2 + Math.random() * 2; s.lookUntil = 0; }
    var wave = t >= s.greet && t < s.waveUntil;
    if (t >= s.next && !wave) {
      var a = list[s.k++ % list.length];
      if (a === "wave") { s.greet = t; s.waveUntil = t + 2.4; } else if (a === "center") { s.lookUntil = t + 3; api.gesture("nod"); } else if (a === "present") { s.lookUntil = t + 2.6; api.gesture("palm"); } else api.gesture(a);
      s.next = t + 5 + Math.random() * 3;
    }
    var look = t < s.lookUntil;
    if (home && ctaOn) { look = true; if (s.cta !== ctaN) { s.cta = ctaN; api.gesture("point"); api.gesture("nod"); } }
    c.look = look ? P.home.el.object3D.localToWorld(tmpV.set(0, -0.15, 0)).clone() : null;
    api.pose = home && ctaOn ? "focus" : "relief";
    c.farewell = wave;
  }

  /* =====================================================================================
     MUNDO DE LA ZONA: escenario de js/scenery.js + personaje + plataforma con los tres objetos
     ===================================================================================== */
  var W = { zone: null };
  function buildWorld(zone) {
    if (W.zone === zone) return;
    if (W.stage) { root.remove(W.stage); root.remove(W.sky); root.remove(W.extra); Object.keys(W.slots || {}).forEach(function (id) { W.slots[id].el.remove(); }); }
    W = { zone: zone, heldEl: W.heldEl, heldBox: W.heldBox, spot: W.spot, beam: W.beam };
    var stage = W.stage = new THREE.Group(); root.add(stage);
    var env = new THREE.Group(); stage.add(env); W.env = env;
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), toon(0x3a3440)); ground.rotation.x = -Math.PI / 2; ground.position.z = 6; env.add(ground);
    var M = { toon: toon, canvasTex: canvasTex };
    var loadingP = P.loading;
    loadingP.show(true);
    W.scenery = window.FFScenery.build({ THREE: THREE, M: M, env: env, envMat: function (m) { return m; }, V: function (x, y, z) { return new V3(x, y, z); },
      bg: new THREE.Object3D(), ground: ground, camera: camEl.getObject3D("camera"),
      status: function (s) { if (W.zone === zone && s !== "loading") loadingP.show(false); } }, zone);
    /* el personaje mide CHAR_H sobre la mesa; el escenario de Blender queda oculto (env): en AR se ve el cuarto real */
    var CK = W.scenery.charScale || 1, k = CHAR_H * (zone === "rural" ? 1 : 1.06) / (4.4 * CK);
    W.k = k; stage.scale.setScalar(k); stage.position.set(0, 0, CHAR_Z);
    /* suelo lejano en todas las direcciones (en VR se puede mirar hacia atrás) */
    var far = new THREE.Mesh(new THREE.CircleGeometry(700, 64), toon(zone === "rural" ? 0x3f6a22 : 0x9c8f7e)); far.rotation.x = -Math.PI / 2; far.position.y = -0.08; env.add(far);
    /* cielo del escenario en una esfera (el degradado llega hasta el horizonte) */
    var st = W.scenery.sky; st.colorSpace = THREE.SRGBColorSpace; st.repeat.set(1, 2); st.offset.set(0, -1); st.needsUpdate = true;
    W.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide, fog: false, depthWrite: false }));
    W.sky.renderOrder = -10; root.add(W.sky);
    W.skyNight = new THREE.Color(0x0a0d16);
    /* personaje */
    var cg = new THREE.Group(); cg.scale.setScalar(CK); stage.add(cg); W.cg = cg;
    W.char = new Char(zone, cg, 1);
    W.char.onReady = function (api) { api.pose = "relief"; };
    /* caminata sobre la mesa (ver walkUpdate): posición en metros de la raíz, rumbo y pausas */
    W.walk = { x: 0, z: CHAR_Z, yaw: 0, tx: 0, tz: CHAR_Z, pause: 1.5, phase: 0, k: 0 };
    W.extra = new THREE.Group(); root.add(W.extra);
    buildPodium(zone);
  }
  function setNight(on) {
    W.night = !!on;
    if (W.scenery && W.scenery.setNight) W.scenery.setNight(on);
    if (W.sky) W.sky.material.color.set(on ? 0x222a44 : 0xffffff);
    FFX.byId("key").setAttribute("light", "intensity", on ? 0.4 : 2.1); FFX.byId("amb").setAttribute("light", "intensity", on ? 0.12 : 0.45);
    FFX.byId("fill").setAttribute("light", "intensity", on ? 0.5 : 1.5);
  }

  /* ---------- menú de la zona (js/hub.js): los dos objetos (radio y linterna) sobre sus bases, apoyados directamente en la mesa real ---------- */
  var HUB = { layout: { radio: [-0.09, 0.09], linterna: [0.09, 0.09] }, accent: { radio: 0xa64630, linterna: 0x5f5a92 },
    size: { radio: 0.36, torch: 0.36 }, scale: 0.5 };
  function buildPodium(zone) {
    var g = W.podium = new THREE.Group(); W.extra.add(g);   // la mesa real hace de plataforma
    W.slots = {};
    ORDER.forEach(function (id, i) {
      var p = HUB.layout[id], el = FFX.entity(); el.setAttribute("vr-hit", ""); worldEl.appendChild(el);
      el.object3D.position.set(p[0], 0, p[1]); el.object3D.scale.setScalar(HUB.scale);
      var box = new THREE.Group(); el.setObject3D("mesh", box);   // setObject3D: así el raycaster lo encuentra
      box.add(contactShadow(0.2));
      var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.168, 0.03, 48), toon(HUB.accent[id])); ped.position.y = 0.015; box.add(ped);
      var pt = new THREE.Mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.006, 48), toon(0xf6ecd6)); pt.position.y = 0.033; box.add(pt);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.144, 0.006, 8, 60), basic(0xf5b335, { transparent: true, opacity: 0.35 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.036; box.add(ring);
      var hit = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.45, 16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.y = 0.22; box.add(hit);
      var holder = new THREE.Group(); holder.position.y = 0.036; box.add(holder);
      tagEl(box, el);
      var kind = kindFor(id);
      makeObject(kind, HUB.size[kind]).then(function (o) { if (W.zone !== zone) return; holder.add(o); tagEl(o, el); o.rotation.y = id === "linterna" ? 0.3 : 0; });
      var slot = W.slots[id] = { el: el, holder: holder, ring: ring, st: { y: 0, vy: 0, rot: 0, vr: 0 }, phase: i * 1.7 };
      el.addEventListener("mouseenter", function () { if (S.view !== "hub") return; S.hubPrev = id; kick(slot, 0.6); AU.click(false); updateHubCard(); });
      el.addEventListener("mouseleave", function () { if (S.hubPrev === id) { S.hubPrev = null; updateHubCard(); } });
      el.addEventListener("click", function () { if (S.view !== "hub") return; S.hubSel = id; kick(slot, 1.4); openItem(id); });
    });
  }
  /* A-Frame solo acepta los clics sobre piezas que llevan la referencia a su entidad (.el). Las que se agregan después de setObject3D
     (los modelos que terminan de cargar) no la tienen: sin esto, el rayo las atraviesa y el clic no hace nada. */
  function tagEl(obj, el) { obj.traverse(function (c) { c.el = el; }); }
  function kick(s, k) { s.st.vy += 1.1 * k; s.st.vr += (Math.random() < 0.5 ? -1 : 1) * 6 * k; }

  /* =====================================================================================
     PANELES DEL MUNDO
     ===================================================================================== */
  function buildWorldPanels() {
    /* todas las tarjetas están de pie sobre la mesa (soporte de UI.Panel «stand»), a los lados del personaje */
    P.loading = new UI.Panel({ parent: worldEl, pos: [0, 0, 0.12], rot: [-10, 0, 0], w: 0.22, anchor: "bottom", stand: true, spec: { w: 360, bg: "rgba(10,13,22,.8)", radius: 999, pad: [12, 20, 12, 20], items: [{ t: "text", size: 16, weight: 600, align: "center", color: "#fff", text: "Cargando el personaje 3D…" }] } });
    /* globo de diálogo: sigue la cabeza del personaje mientras camina (walkUpdate) */
    P.bubble = new UI.Panel({ parent: worldEl, pos: [0, CHAR_H + 0.05, CHAR_Z], w: 0.2, anchor: "bottom", order: 3 });
    P.seq = new UI.Panel({ parent: worldEl, pos: [0.33, 0, -0.03], rot: [-6, -30, 0], w: 0.3, anchor: "bottom", stand: true, onClick: act });
    P.hubHead = new UI.Panel({ parent: worldEl, pos: [-0.34, 0, -0.06], rot: [-6, 30, 0], w: 0.28, anchor: "bottom", stand: true, onClick: act });
    P.hubCard = new UI.Panel({ parent: worldEl, pos: [0.33, 0, -0.03], rot: [-6, -30, 0], w: 0.24, anchor: "bottom", stand: true, onClick: act });
    /* objeto en las manos del usuario (práctica): en el Quest sigue a las manos reales (placeHeld); en el computador va delante de la cámara */
    var held = FFX.entity(); held.setAttribute("vr-hit", ""); worldEl.appendChild(held);
    held.noTouch = function () { return AR; };   // en AR las manos lo sostienen: tocarlo no debe activar nada por accidente
    W.heldEl = held;
    W.heldBox = new THREE.Group(); held.setObject3D("mesh", W.heldBox);
    held.addEventListener("click", function (e) { practiceObjClick(e); });
    held.addEventListener("mousedown", function () { torchHold(true); });
    held.addEventListener("mouseup", function () { torchHold(false); });
    held.addEventListener("mouseleave", function () { torchHold(false); });
    /* luz de la linterna (práctica y personaje) */
    W.spot = new THREE.SpotLight(0xfff3c4, 0, 14, 0.42, 0.45, 1.2); W.spot.target.position.set(0, 0, -1);
    var lens = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false }));
    var cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    W.beam = { lens: lens, cone: cone };
  }
  function hideWorldPanels() { ["bubble", "seq", "hubHead", "hubCard"].forEach(function (k) { P[k].show(false); }); }
  function bubble(text, opts) {
    if (!text) { P.bubble.show(false); return; }
    opts = opts || {};
    P.bubble.set({ w: 300, bg: opts.think ? "#fffaf0" : C.paper, radius: opts.think ? 999 : 18, shadow: true, tail: "left", pad: [12, 17, 12, 17], items: [
      opts.tag ? { t: "tag", text: opts.tag, color: C.moss } : null,
      { t: "text", size: opts.think ? 21 : 16.5, weight: opts.think ? 700 : 600, italic: !opts.think, lh: 1.35, color: opts.think ? "#b3261e" : C.ink, align: opts.think ? "center" : "left", text: text }] });
    P.bubble.show(true);
  }

  /* =====================================================================================
     NAVEGACIÓN
     ===================================================================================== */
  function go(view) {
    S.token++; S.view = view;
    AU.sceneStop(); torchLight(false);
    var lob = view === "home";
    lobbyEl.object3D.visible = lob; worldEl.object3D.visible = !lob;
    if (W.stage) { W.stage.visible = !lob; W.sky.visible = !lob; W.extra.visible = !lob; }
    P.home.show(view === "home");
    lobby.chars.forEach(function (c) { c.g.visible = view === "home"; if (c.slot) c.slot.on = false; });
    if (lob) { sceneEl.removeAttribute("fog"); setLightsDay(); }
    hideWorldPanels(); clearHeld(); showcase(null);
    if (W.char && W.char.hold && W.char.hold.obj) W.extra.remove(W.char.hold.obj);
    W.charTorch = null;
    if (W.char) { W.char.hold = null; W.char.kind = "none"; W.char.fear = 0; W.char.farewell = false; if (W.char.api) { W.char.api.mood = null; W.char.api.pose = "relief"; W.char.api.talking = false; } }
    if (W.podium) setPodium(view === "hub");
    arApply();
    UI.refresh();
  }
  /* ---------- realidad aumentada (Meta Quest: botón «AR», passthrough) ----------
     Se oculta todo lo que es «ambiente» (cielos y escenario de Blender) y quedan los personajes, los objetos y las tarjetas sobre la mesa real.
     En el computador se ve el cielo de fondo y la mesa virtual de src/main.js; el escenario de Blender nunca se muestra (no cabe en una mesa). */
  var AR = false;
  function arApply() {
    if (lobby.bg) lobby.bg.forEach(function (o) { o.visible = !AR; });
    if (W.sky) W.sky.visible = !AR && S.view !== "home";
    if (W.env) W.env.visible = false;
    sceneEl.removeAttribute("fog");
    if (P.home) P.home.set(homeSpec());
    if (P.hubHead && S.view === "hub") hub(true);
    UI.refresh();
  }
  function setLightsDay() { FFX.byId("key").setAttribute("light", "intensity", 2.1); FFX.byId("fill").setAttribute("light", "intensity", 1.5); FFX.byId("amb").setAttribute("light", "intensity", 0.45); }
  function setPodium(v) { W.podium.visible = v; Object.keys(W.slots).forEach(function (id) { W.slots[id].el.object3D.visible = v; }); UI.refresh(); }

  /* «Comenzar»: entra a la zona rural y muestra directo a Mateo con los objetos sobre la mesa (menú de la zona) */
  function enterZone(z) {
    S.zone = z; document.body.setAttribute("data-zone", z);
    buildWorld(z);
    hub();
  }

  /* ---------- menú de la zona ---------- */
  function hub(redrawOnly) {
    if (!redrawOnly) { go("hub"); setNight(false); S.hubSel = null; S.hubPrev = null; }
    var Z = zoneData(), xr = FFX.immersive();
    P.hubHead.set({ w: 420, bg: "rgba(10,24,32,.86)", radius: 22, pad: [18, 22, 20, 22], items: [
      { t: "kicker", color: C.peach, text: Z.name },
      { t: "h1", size: 27, color: "#fff", text: "Elige un objeto para empezar", mb: 8 },
      { t: "text", size: 13.5, lh: 1.5, weight: 500, color: "rgba(255,255,255,.85)", text: xr ? "Toca un objeto de la mesa con la punta del índice (o pellízcalo a distancia) para ver su vista previa y comenzar su recorrido." : "Pasa el cursor sobre un objeto de la mesa para ver una vista previa. Haz clic para comenzar su recorrido.", mb: 6 },
      { t: "text", size: 12, lh: 1.45, weight: 600, color: C.peach, text: xr ? "En la práctica sostendrás el objeto con tus propias manos." : "En el computador: rueda del ratón o teclas + / − para acercar o alejar (0 = normal).", mb: 14 },
      { t: "buttons", size: 13.5, gap: 8, list: [{ id: "sound", label: AU.enabled() ? "🔊 Sonido" : "🔇 Sin sonido", kind: "light" }, xr ? { id: "replace", label: "Mover a otra mesa", kind: "light" } : null] }
    ] }).show(true);
    if (redrawOnly) return;
    updateHubCard();
    var who = Z.who;
    later(500, function () {
      var line = "¡Hola, soy " + who + "! Aquí la señal a veces falla. ¿Qué quieres explorar?";
      bubble(line); W.char.say(line, 4200);
    });
    later(7500, function () { if (S.view === "hub") bubble(null); });
  }
  function updateHubCard() {
    if (S.view !== "hub") return;
    var id = S.hubPrev || S.hubSel; if (!id) { P.hubCard.show(false); return; }
    var it = FF.menu.filter(function (m) { return m.id === id; })[0], n = FF.zones[S.zone].items[id].objects.length;
    var sel = id === S.hubSel && !S.hubPrev;
    P.hubCard.set({ w: 340, bg: "rgba(251,245,230,.98)", radius: 18, shadow: true, border: sel ? C.signal : null, pad: [15, 17, 17, 17], items: [
      { t: "tag", color: sel ? C.gold : C.moss, text: sel ? "Seleccionado" : "Vista previa" },
      { t: "name", text: it.name },
      { t: "text", size: 13.5, lh: 1.5, justify: true, text: it.text, mb: 8 },
      { t: "small", text: itemExplored(S.zone, id) + " de " + n + (n === 1 ? " tema explorado" : " temas explorados"), mb: 12 },
      { t: "buttons", size: 14.5, list: [{ id: "open:" + id, label: "Comenzar recorrido →", kind: "ink" }] }
    ] }).show(true);
    W.slots && Object.keys(W.slots).forEach(function (k) { W.slots[k].ring.material.opacity = k === id ? 0.95 : 0.35; });
  }

  /* =====================================================================================
     RECORRIDO DE CADA OBJETO: Objeto → Práctica → Personaje → Información → despedida
     ===================================================================================== */
  var PR = {};   // estado de la práctica
  function item() { return zoneData().items[S.item]; }
  function topic() { return item().objects[S.ti]; }
  function stepNames() { return topic().story ? FF.seq.storySteps : FF.seq.steps; }
  function openItem(id) { S.item = id; S.ti = 0; startTopic(); }
  function startTopic() { seqStep(0); }
  function seqCard(spec) {
    var s = Object.assign({ w: 420, bg: "rgba(251,245,230,.98)", radius: 20, shadow: true, pad: [18, 22, 20, 22] }, spec);
    P.seq.set(s).show(true);
  }
  function stepsStrip(i) { return { t: "steps", list: stepNames(), active: i, clickable: true, mb: 14 }; }
  function seqStep(n) {
    var keepNight = S.item === "linterna";
    go("seq"); S.step = n; setNight(keepNight && n < 3);
    if (keepNight && n < 3) sceneEl.setAttribute("fog", { type: "linear", color: "#0a0d16", near: 8, far: 40 });
    var it = item(), tp = topic(), kind = kindFor(S.item, S.zone), c = W.char;
    if (c.api) c.api.pose = n === 1 ? "listen" : "relief";
    if (n === 0) {   /* 1 · el objeto protagonista */
      showcase(kind);
      seqCard({ items: [stepsStrip(0), { t: "kicker", text: it.kicker }, { t: "h2", text: tp.name }, { t: "p", justify: true, text: tp.lead },
        tp.intro ? { t: "h3", text: tp.introTitle || "¿Cómo funciona?" } : null, tp.intro ? { t: "p", justify: true, text: tp.intro } : null,
        { t: "buttons", list: [{ id: "next", label: "Practicar →", kind: "signal" }, { id: "to-hub", label: "Menú", kind: "outline" }] }] });
      if (S.item === "linterna") later(300, function () { W.showGlow = 0.001; });
    } else if (n === 1) { startPractice(kind); }
    else if (n === 2) { characterStep(kind); }
    else if (n === 3) { infoStep(); }
    else { byeStep(kind); }
  }

  /* ---------- el objeto protagonista: apoyado sobre una base giratoria en la mesa, delante del usuario (no flota) ---------- */
  function showcase(kind) {
    if (W.show) { W.extra.remove(W.show); W.extra.remove(W.showBase); W.show = null; }
    W.showGlow = 0;
    if (!kind) return;
    var base = W.showBase = new THREE.Group(); base.position.set(-0.08, 0, 0.1); W.extra.add(base);
    base.add(contactShadow(0.11));
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.012, 48), toon(0xf6ecd6)); disc.position.y = 0.006; base.add(disc);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.003, 8, 64), basic(0xf5b335)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.012; base.add(rim);
    var g = new THREE.Group(); g.position.set(-0.08, 0.012, 0.1); W.extra.add(g); W.show = g;
    var size = kind === "torch" ? 0.16 : 0.17;
    var tk = S.token;
    makeObject(kind, size).then(function (o) { if (tk !== S.token) return; var piv = new THREE.Group(); piv.position.y = o.userData.size.y / 2; o.position.y = -o.userData.size.y / 2; piv.add(o); g.add(piv); if (kind === "torch") { attachBeam(piv, o, true); g.userData.lens = piv.userData.lens; } });
  }

  /* ---------- objeto en las manos del usuario ---------- */
  function clearHeld() {
    if (!W.heldEl) return;
    var hb = W.heldBox; hb.children.slice().forEach(function (c) { hb.remove(c); });
    W.heldEl.object3D.visible = false; W.heldObj = null; W.radioPose = null; UI.refresh();
  }
  function setHeld(kind, size, done) {
    clearHeld(); var tk = S.token, h = W.heldEl.object3D; h.visible = true; h.rotation.set(0, 0, 0); W.heldKind = kind; W.heldTilt = null; placeHeld();
    makeObject(kind, size).then(function (o) {
      if (tk !== S.token) return;
      var piv = new THREE.Group(); piv.add(o); o.position.y = -o.userData.size.y / 2; W.heldBox.add(piv); tagEl(piv, W.heldEl); W.heldObj = { piv: piv, obj: o, kind: kind };
      if (done) done(piv, o); UI.refresh();
    });
  }

  /* ---------- el objeto se adapta a las manos reales (como en las imágenes de referencia) ----------
     · Radio: entre las dos manos. Al empezar, su ancho se ajusta a la distancia entre tus palmas (encaja justo entre tus manos) y después sigue
       a las dos manos (posición, giro e inclinación). Mientras un dedo está sobre una perilla, la radio se queda quieta para poder tocarla o girarla.
     · Linterna: empuñada en la mano derecha, apuntando hacia donde apunta el puño, con el interruptor justo debajo de la yema del pulgar derecho:
       la linterna gira sobre su eje y se desliza para que el botón quede donde está tu pulgar.
     Si no se ven las manos (o en el computador), el objeto queda delante de la cámara. */
  var HM = new THREE.Matrix4(), HP2 = new V3(), HQ = new THREE.Quaternion(), HS = new V3(1, 1, 1), HPI = new THREE.Matrix4();
  var HELD_CAM = { torch: [0.07, -0.16, -0.38, 0.05, 0, 0], radio: [0, -0.15, -0.55, 0.25, 0, 0] };
  var RADIO_W = 0.24;   // ancho del cuerpo de la radio en la práctica (m) antes de ajustarlo a tus manos
  var QX = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2), ZAX = new V3(0, 0, 1);
  function heldSide(pref) { var H = FFX.hands; if (H.tracked(pref)) return pref; var o = pref === "left" ? "right" : "left"; return H.tracked(o) ? o : null; }
  function placeHeld() {
    var h = W.heldEl && W.heldEl.object3D; if (!h || !h.visible || !W.heldKind) return;
    var kind = W.heldKind, H = FFX.hands, done = false, torchSide = null;
    if (FFX.immersive()) {
      var eye = FFX.head().getWorldPosition(new V3());
      if (kind === "radio") done = radioPose(H, eye);
      else { var t = heldSide("right"); if (t) { var g = H.grip(t); g.getWorldPosition(HP2); g.getWorldQuaternion(HQ); done = true; W.torchSide = torchSide = t; } }
    }
    if (!done) {   /* computador o manos no visibles: delante de la cámara */
      var cam = camEl.object3D, c = HELD_CAM[kind]; cam.updateMatrixWorld(true);
      HP2.set(c[0], c[1], c[2]).applyMatrix4(cam.matrixWorld); cam.getWorldQuaternion(HQ);
      HQ.multiply(tmpQ.setFromEuler(new THREE.Euler(c[3], c[4], c[5])));
      W.torchSide = "right";
    }
    HM.compose(HP2, HQ, HS);
    h.parent.updateMatrixWorld(true); HPI.copy(h.parent.matrixWorld).invert(); HM.premultiply(HPI);
    HM.decompose(h.position, h.quaternion, tmpV);
    if (kind === "torch") torchFit(torchSide);
  }

  /* radio entre las dos manos: eje X de la radio = de la palma izquierda a la derecha; el frente mira hacia tus ojos */
  function radioPose(H, eye) {
    var pose = W.radioPose, l = H.tracked("left") && H.grip("left"), r = H.tracked("right") && H.grip("right");
    var keep = function () { if (!pose) return false; HP2.copy(pose.p); HQ.copy(pose.q); return true; };
    if (pose && (PR.nearKnob || PR.grab)) return keep();   // un dedo sobre una perilla: la radio se queda quieta
    if (!l || !r) return keep();
    var a = l.getWorldPosition(JA), b = r.getWorldPosition(JB), xA = new V3().subVectors(b, a), dist = xA.length();
    if (dist < 0.06) return keep();
    xA.divideScalar(dist);
    var mid = new V3().addVectors(a, b).multiplyScalar(0.5), zA = new V3().subVectors(eye, mid);
    zA.addScaledVector(xA, -zA.dot(xA)).normalize();
    var yA = new V3().crossVectors(zA, xA);
    var pv = W.heldObj && W.heldObj.piv, rig = PR.rig;
    /* al principio: el ancho de la radio = la distancia entre tus palmas (menos el grosor de las manos), para que encaje justo entre ellas */
    if (pv && !PR.fitW) { PR.fitW = Math.max(0.18, Math.min(0.42, dist - 0.035)); pv.scale.setScalar(PR.fitW / RADIO_W); }
    var s = pv ? pv.scale.x : 1, body = rig && rig.body;
    HM.makeBasis(xA, yA, zA); HQ.setFromRotationMatrix(HM);
    HP2.copy(mid);
    /* las palmas tocan los costados del cuerpo de la radio, un poco por debajo de su centro */
    if (body) HP2.addScaledVector(xA, -body.x * s).addScaledVector(yA, (-body.y + body.h * 0.12) * s);
    if (pose) { pose.p.lerp(HP2, 0.35); pose.q.slerp(HQ, 0.35); HP2.copy(pose.p); HQ.copy(pose.q); }
    else W.radioPose = { p: HP2.clone(), q: HQ.clone() };
    return true;
  }
  /* caja de una pieza del modelo en el espacio del pivote del objeto en las manos (metros) */
  function relBox(piv, n) {
    piv.updateMatrixWorld(true);
    var M = new THREE.Matrix4().copy(piv.matrixWorld).invert().multiply(n.matrixWorld);
    n.geometry.computeBoundingBox(); return n.geometry.boundingBox.clone().applyMatrix4(M);
  }
  function findMesh(o, re) { var r = null; o.traverse(function (n) { if (!r && n.isMesh && re.test(n.name)) r = n; }); return r; }
  /* perillas de la radio (Radio.glb): «Perilla1» (izquierda: encender) y «Perilla» (derecha: girar para pasar de AM a FM), cada una con su
     indicador. Cada perilla y su indicador se ponen dentro de un pivote en el centro de la perilla, para que giren juntos sobre su eje. */
  function radioRig(piv, o) {
    var knob = function (kRe, iRe) {
      var k = findMesh(o, kRe), ind = findMesh(o, iRe); if (!k) return null;
      var bb = relBox(piv, k), c = bb.getCenter(new V3());
      var pv = new THREE.Group(); pv.position.copy(k.position); k.parent.add(pv); pv.updateMatrixWorld(true);
      pv.attach(k); if (ind) pv.attach(ind);
      return { pv: pv, front: new V3(c.x, c.y, bb.max.z), r: (bb.max.x - bb.min.x) / 2 };
    };
    var bodyM = findMesh(o, /^Cuerpo_Radio/), bb = bodyM ? relBox(piv, bodyM) : null, bc = bb ? bb.getCenter(new V3()) : null;
    return { piv: piv, t0: performance.now(), latch: false,
      power: knob(/^Perilla1$/, /^Perilla-Indicador$/), tune: knob(/^Perilla$/, /^Perilla-Indicador1$/),
      body: bb ? { x: bc.x, y: bc.y, h: bb.max.y - bb.min.y } : null };
  }
  /* interruptor de la linterna (Linterna.glb: «Interruptor_Linterna1/2»): radio de su cara exterior y altura sobre el mango */
  function torchRig(piv, o) {
    var btns = [], box = new THREE.Box3();
    o.traverse(function (n) { if (n.isMesh && /^Interruptor/.test(n.name)) { btns.push({ m: n, x0: n.position.x }); box.union(relBox(piv, n)); } });
    if (box.isEmpty()) return { rb: 0.016, yb: 0.04, btns: btns, rest: null, pressed: false };
    return { rb: box.max.x, yb: (box.min.y + box.max.y) / 2, btns: btns, rest: null, pressed: false };
  }
  function pressBtn(rg, on) { rg.btns.forEach(function (b) { b.m.position.x = on ? b.x0 - 0.07 : b.x0; }); }
  /* la linterna en el puño derecho con el interruptor bajo la yema del pulgar. «rest» es la posición de reposo del pulgar (se actualiza poco a
     poco mientras no presiona): la linterna se coloca respecto de ella, así el botón queda quieto bajo el dedo y se nota cuando el pulgar se hunde. */
  function torchFit(side) {
    var pv = W.heldObj && W.heldObj.piv, rg = PR.trig; if (!pv || !rg) return;
    var th = side && FFX.hands.joint(side, "thumb-tip", JT);
    if (!th) { pv.position.set(0, 0, 0); pv.quaternion.copy(QX); rg.rest = null; rg.pressed = false; pressBtn(rg, W.lightOn); return; }
    var h = W.heldEl.object3D; h.updateMatrixWorld(true);
    var T = h.worldToLocal(th);   // pulgar en el espacio del agarre (−Z = hacia donde apunta el puño)
    if (!rg.rest) rg.rest = T.clone();
    var rT = Math.hypot(T.x, T.y), rR = Math.hypot(rg.rest.x, rg.rest.y);
    /* presionar = el pulgar se hunde hacia el mango (6 mm o más respecto de su reposo); soltar = vuelve */
    if (!rg.pressed && rT < rR - 0.006) rg.pressed = true;
    else if (rg.pressed && rT > rR - 0.003) rg.pressed = false;
    if (!rg.pressed) rg.rest.lerp(T, 0.04);
    var phi = Math.atan2(rg.rest.y, rg.rest.x);
    pv.quaternion.setFromAxisAngle(ZAX, phi).multiply(QX);   // el botón (lado +X de la linterna) mira hacia el pulgar
    var sr = Math.max(-0.02, Math.min(0.03, rR - rg.rb - 0.004)), sz = Math.max(-0.1, Math.min(0.1, rg.rest.z + rg.yb));
    pv.position.set(Math.cos(phi) * sr, Math.sin(phi) * sr, sz);
    pressBtn(rg, rg.pressed || W.lightOn);
  }

  /* ---------- luz de la linterna ---------- */
  function attachBeam(parent, obj, glowOnly) {
    var s = obj.userData.size, top = s.y / 2 + 0.002;
    var lens = W.beam.lens.clone(); lens.material = W.beam.lens.material.clone(); lens.scale.setScalar(s.x * 0.42); lens.position.y = top; lens.rotation.x = -Math.PI / 2; parent.add(lens);
    parent.userData.lens = lens;
    if (glowOnly) return;
    var cone = W.beam.cone.clone(); cone.material = W.beam.cone.material.clone(); var cf = Math.min(1, s.y / 0.19); cone.scale.set(0.55 * cf, 2.2 * cf, 0.55 * cf); cone.position.y = top + 1.1 * cf; cone.rotation.x = Math.PI; parent.add(cone);
    var spot = W.spot; spot.position.set(0, top, 0); spot.target.position.set(0, top + 3, 0); parent.add(spot); parent.add(spot.target);
    parent.userData.cone = cone;
  }
  function torchLight(on) {
    W.lightOn = !!on;
    if (W.spot) W.spot.intensity = on ? 9 : 0;
    [W.heldObj && W.heldObj.piv, W.charTorch].forEach(function (p) {
      if (!p) return;
      if (p.userData.lens) p.userData.lens.material.opacity = on ? 1 : 0;
      if (p.userData.cone) p.userData.cone.material.opacity = on ? 0.13 : 0;
    });
    if (PR.trig && PR.mode === "torch") pressBtn(PR.trig, on || PR.trig.pressed);
  }

  /* =====================================================================================
     2 · PRÁCTICA
     ===================================================================================== */
  function practiceDone(extra) {
    PR.done = true;
    renderPractice(extra);
  }
  function donePrompt() {
    return [{ t: "hr" }, { t: "text", size: 16, weight: 700, text: "Mmm… ¿quieres repetir la práctica?", mb: 10 },
      { t: "buttons", list: [{ id: "next", label: "Continuar →", kind: "signal" }, { id: "redo", label: "Repetir práctica", kind: "outline" }] }];
  }
  /* al terminar la práctica de código Morse: botón «Terminar práctica» (lleva a «¡Recorrido terminado!») */
  function torchDone() { return [{ t: "hr" }, { t: "buttons", list: [{ id: "bye", label: "Terminar práctica", kind: "signal" }] }]; }
  function startPractice(kind) {
    var tp = topic(); PR = { kind: kind, id: tp.id, done: false, t0: performance.now() };
    if (kind === "radio") {
      PR.mode = "radio"; TU.set(FF.tuner.start); TU.audioCap = 1; PR.locked = false; PR.knob = 0; PR.fitW = 0; PR.grab = null; PR.nearKnob = false;
      setHeld("radio", RADIO_W, function (piv, o) { PR.rig = radioRig(piv, o); });
    } else {
      PR.mode = "torch"; PR.g = "s1"; PR.log = ""; PR.sos = -1;
      setHeld("torch", 0.19, function (piv, o) { piv.quaternion.copy(QX); attachBeam(piv, o); PR.trig = torchRig(piv, o); torchLight(false); });
    }
    renderPractice();
  }
  function renderPractice() {
    var tp = topic(), items = [stepsStrip(1), { t: "kicker", text: "Práctica · " + tp.name }];
    if (PR.mode === "radio") {
      items.push({ t: "p", text: tp.hint + (FFX.immersive() ? " Sostén la radio con las dos manos: toca la perilla izquierda para encenderla y gira la perilla derecha para pasar de AM a FM." : " (También puedes hacer clic en la perilla izquierda de la radio para encenderla y en la perilla derecha para girarla.)") });
      items.push(tunerUI());
      items.push({ t: "small", text: FF.tuner.note });
    } else if (PR.mode === "torch") {
      torchItems(items);
    }
    if (PR.done) items = items.concat(PR.mode === "torch" ? torchDone() : donePrompt());
    else items.push({ t: "buttons", mb: 0, list: [{ id: "next", label: "Saltar práctica", kind: "outline" }, { id: "to-hub", label: "Menú", kind: "outline" }] });
    seqCard({ items: items });
    coach(practiceLine());
  }
  /* el personaje camina por la mesa y va diciendo la instrucción de cada paso de la práctica (globo sobre su cabeza) */
  function coach(line) {
    if (!line || line === PR.coach) return;
    PR.coach = line; bubble(line); if (W.char) W.char.say(line, Math.max(2600, line.length * 70));
  }
  function practiceLine() {
    var xr = FFX.immersive();
    if (PR.mode === "radio") {
      if (PR.done) return "¡Ahí está la emisora! Escucha cómo se oye clara.";
      if (!TU.state.on) return xr ? "Sostén la radio con las dos manos y toca la perilla del lado izquierdo para encenderla." : "Haz clic en la perilla del lado izquierdo de la radio para encenderla.";
      return xr ? "Ahora gira la perilla del lado derecho para cambiar de AM a FM hasta que la señal se oiga clara." : "Ahora gira la perilla del lado derecho (haz clic en ella) para cambiar de AM a FM hasta que la señal se oiga clara.";
    }
    if (PR.mode === "torch") {
      var g = item().guide[PR.g];
      if (PR.g === "s1") return (xr ? "Empuña la linterna con tu mano derecha: el botón queda bajo tu pulgar. " : "") + g.title + ".";
      if (PR.g === "s2") return "Destello corto = punto (·) y destello largo = raya (—). Pruébalos con los botones de la tarjeta.";
      if (PR.g === "s3") return "Mira la señal SOS: tres cortos, tres largos y tres cortos.";
      if (PR.done) return "¡Muy bien! Cuando quieras, toca «Terminar práctica».";
      return xr ? "¡Tu turno! Presiona el botón de la linterna con tu pulgar derecho: toque corto = punto, largo = raya. Haz SOS." : "¡Tu turno! Mantén presionada la linterna: clic corto = punto, largo = raya. Haz SOS.";
    }
    return null;
  }

  /* ---------- radio: el mismo sintonizador ilustrativo (js/tuner.js + FF.tuner) ---------- */
  function tunerUI() {
    var D = FF.tuner, s = TU.state, c = TU.clarity(), n = nearestStation(), msg = !s.on ? D.off : c >= 0.75 ? n.name + " (" + s.band + "). Suena «Si tu amor no vuelve», del Binomio de Oro de América." : c >= 0.3 ? D.near : D.noise;
    return { t: "custom", h: 214, draw: function (ctx, x, y, w, h, S) {
      UI.rr(ctx, x, y, w, h, 16); ctx.fillStyle = "#2a241f"; ctx.fill();
      var b = function (id, label, bx, on) { var bw = id === "power" ? 150 : 62; UI.rr(ctx, x + bx, y + 14, bw, 38, 999); ctx.fillStyle = on ? C.signal : S.hover === id ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.1)"; ctx.fill(); ctx.fillStyle = on ? C.ink : "#fff"; ctx.font = UI.font(13.5, 700); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + bx + bw / 2, y + 34); ctx.textAlign = "left"; S.region(id, x + bx, y + 14, bw, 38); };
      b("power", s.on ? "⏻  Apagar la radio" : "⏻  Encender la radio", 14, s.on); b("band:AM", "AM", 178, s.band === "AM"); b("band:FM", "FM", 248, s.band === "FM");
      /* dial */
      var dx = x + 50, dw = w - 100, dy = y + 70;
      UI.rr(ctx, dx, dy, dw, 54, 10); ctx.fillStyle = s.on ? "#f3e6c4" : "#bfb49a"; ctx.fill();
      ctx.fillStyle = "rgba(35,37,31,.55)"; for (var i = 0; i <= 20; i++) { var tx = dx + 10 + (dw - 20) * i / 20; ctx.fillRect(tx, dy + 8, 1.5, i % 5 ? 10 : 18); }
      if (s.on) { ctx.globalAlpha = (1 - c) * 0.45; for (var j = 0; j < 90; j++) { ctx.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; ctx.fillRect(dx + Math.random() * dw, dy + 30 + Math.random() * 20, 2, 2); } ctx.globalAlpha = 1; }
      var nx = dx + 10 + (dw - 20) * s.pos / 100; ctx.fillStyle = C.red; ctx.fillRect(nx - 1.5, dy + 4, 3, 46);
      S.region("dial", dx, dy, dw, 54);
      var arrow = function (id, label, ax) { UI.rr(ctx, ax, dy + 7, 36, 40, 12); ctx.fillStyle = S.hover === id ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.12)"; ctx.fill(); ctx.fillStyle = "#fff"; ctx.font = UI.font(20, 700); ctx.textAlign = "center"; ctx.fillText(label, ax + 18, dy + 28); ctx.textAlign = "left"; S.region(id, ax, dy + 7, 36, 40); };
      arrow("dial-", "‹", x + 8); arrow("dial+", "›", x + w - 44);
      /* medidor de claridad y mensaje */
      UI.rr(ctx, x + 14, y + 136, w - 28, 8, 4); ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fill(); UI.rr(ctx, x + 14, y + 136, (w - 28) * c, 8, 4); ctx.fillStyle = c >= 0.75 ? "#5fd08a" : C.signal; ctx.fill();
      UI.drawText(ctx, { size: 13, weight: 600, lh: 1.4, color: c >= 0.75 ? "#8be0a4" : "#f3e6c4", text: msg }, x + 14, y + 152, w - 28, true);
    } };
  }
  function nearestStation() { var s = TU.state, best = null, bd = 1e9; FF.tuner.bands[s.band].forEach(function (st) { var d = Math.abs(st.pos - s.pos); if (d < bd) { bd = d; best = st; } }); return best; }
  function radioSet(patch) {
    TU.set(patch, true);
    /* señal clara: el dial se asienta en la emisora (el medidor queda lleno, en verde) y empieza a sonar la canción */
    if (!PR.locked && TU.clarity() >= 0.75) { PR.locked = true; PR.grab = null; TU.set({ pos: nearestStation().pos }, true); practiceDone(); return; }
    renderPractice();
  }
  /* girar la perilla derecha: al empezar a girarla la radio pasa a FM y el dial avanza con el giro; con un cuarto de vuelta llega a la emisora */
  function turnKnob(d) {
    if (!TU.state.on || PR.locked) return;
    PR.knob = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, PR.knob + d));
    var D = FF.tuner, p = Math.min(1, Math.abs(PR.knob) / (Math.PI / 2)), patch = {};
    if (p > 0.08 && TU.state.band !== "FM") patch.band = "FM";
    var from = D.start.pos, to = D.bands.FM[0].pos, pos = Math.round(from + (to - from) * p);
    if (pos !== TU.state.pos) patch.pos = pos;
    if (Object.keys(patch).length) radioSet(patch);
  }
  /* manos sobre las perillas (Meta Quest, hand tracking):
     · encender: tocar la perilla izquierda con la yema del índice o del pulgar;
     · cambiar de AM a FM: tomar la perilla derecha con el pulgar y el índice (como en pinza) y girar la muñeca: la perilla gira con tus dedos. */
  function radioHands() {
    var rig = PR.rig, H = FFX.hands; if (!rig || !rig.power || !rig.tune) { PR.nearKnob = false; return; }
    var pv = rig.piv, s = pv.scale.x; pv.updateMatrixWorld(true);
    var pw = pv.localToWorld(JA.copy(rig.power.front)), tw = pv.localToWorld(JB.copy(rig.tune.front));
    var rp = rig.power.r * s, rt = rig.tune.r * s, near = false, touch = false, grab = null;
    ["left", "right"].forEach(function (side) {
      var th = H.joint(side, "thumb-tip", JT) ? JT.clone() : null, ix = H.joint(side, "index-finger-tip", JI) ? JI.clone() : null;
      [th, ix].forEach(function (p) {
        if (!p) return; var dp = p.distanceTo(pw), dt = p.distanceTo(tw);
        if (dp < rp + 0.045 || dt < rt + 0.045) near = true;
        if (dp < rp + 0.012) touch = true;
      });
      if (!grab && th && ix) {
        var both = th.distanceTo(tw) < rt + 0.025 && ix.distanceTo(tw) < rt + 0.025;
        var pinch = H.pinch(side).active && th.clone().add(ix).multiplyScalar(0.5).distanceTo(tw) < rt + 0.03;
        if (both || pinch) grab = { side: side, th: th, ix: ix };
      }
    });
    PR.nearKnob = near;
    if (touch && !rig.latch && performance.now() - rig.t0 > 800) { rig.latch = true; if (!TU.state.on) radioSet({ on: true }); }
    else if (!touch) rig.latch = false;
    if (grab) {
      var a = pv.worldToLocal(grab.th.clone()), b = pv.worldToLocal(grab.ix.clone()), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (!PR.grab || PR.grab.side !== grab.side) PR.grab = { side: grab.side, prev: ang };
      else { var d = ang - PR.grab.prev; d = Math.atan2(Math.sin(d), Math.cos(d)); PR.grab.prev = ang; turnKnob(d); }
    } else PR.grab = null;
  }
  /* las perillas 3D siguen el estado: la izquierda gira al encender y la derecha gira con tus dedos (o con cada clic en el computador) */
  function radioKnobs() {
    var rig = PR.rig; if (!rig) return;
    if (rig.tune) rig.tune.pv.rotation.z += (PR.knob - rig.tune.pv.rotation.z) * 0.5;
    if (rig.power) rig.power.pv.rotation.z += ((TU.state.on ? -0.9 : 0) - rig.power.pv.rotation.z) * 0.2;
  }
  function knobAt(pt) {
    var rig = PR.rig; if (!pt || !rig || !rig.tune || !rig.power) return null;
    var pv = rig.piv; pv.updateMatrixWorld(true);
    var p = pv.worldToLocal(new V3(pt.x, pt.y, pt.z));
    var dt = Math.hypot(p.x - rig.tune.front.x, p.y - rig.tune.front.y), dp = Math.hypot(p.x - rig.power.front.x, p.y - rig.power.front.y);
    if (dt < rig.tune.r * 1.6 && dt < dp) return "tune";
    if (dp < rig.power.r * 1.6) return "power";
    return null;
  }

  /* ---------- linterna: recorrido guiado de código Morse (FF.zones[zona].items.linterna.guide) ---------- */
  function torchItems(items) {
    var G = item().guide, g = G[PR.g], xr = FFX.immersive();
    items.push({ t: "h2", size: 24, text: g.title });
    if (PR.g === "s1") { items.push({ t: "p", justify: true, text: g.text }); items.push({ t: "p", justify: true, text: g.morse }); items.push({ t: "buttons", list: [{ id: "g:s2", label: "Continuar →", kind: "signal" }], mb: 12 }); }
    else if (PR.g === "s2") {
      items.push({ t: "p", justify: true, text: g.text });
      items.push(morseRow([".", "-"], PR.flash));
      items.push({ t: "buttons", list: [{ id: "dot", label: "Destello corto", kind: "cream" }, { id: "dash", label: "Destello largo", kind: "cream" }, { id: "g:s3", label: "Continuar →", kind: "signal" }], mb: 12 });
    } else if (PR.g === "s3") {
      items.push({ t: "p", justify: true, text: g.text });
      items.push(morseRow("...---...".split(""), PR.sos));
      items.push({ t: "p", justify: true, text: g.msg }); items.push({ t: "small", text: g.zone }); items.push({ t: "small", text: g.note });
      items.push({ t: "buttons", list: [{ id: "sos", label: "▶  Reproducir SOS", kind: "cream" }, { id: "g:p", label: "Practicar →", kind: "signal" }], mb: 12 });
    } else {
      items.push({ t: "p", justify: true, text: g.text });
      items.push(morseRow(PR.log ? PR.log.split("") : [], PR.flashLog, true));
      if (/\.\.\.---\.\.\.$/.test(PR.log)) items.push({ t: "text", size: 15, weight: 700, color: C.moss, text: "¡Eso es SOS!", mb: 6 });
      items.push({ t: "buttons", size: 14, gap: 8, list: [{ id: "dot", label: "Destello corto", kind: "cream" }, { id: "dash", label: "Destello largo", kind: "cream" }, { id: "sos", label: "▶ Reproducir SOS", kind: "cream" }, { id: "clear", label: "Borrar", kind: "outline" }], mb: 8 });
      items.push({ t: "small", text: xr ? "Con la linterna en tu mano derecha, presiona el botón con el pulgar (o pellizca) y mantén: se enciende mientras lo sostienes." : "También puedes mantener presionada la linterna (clic sostenido): se enciende mientras la sostienes." });
      /* la práctica termina cuando formas SOS (o escribes al menos nueve puntos y rayas): aparece «Terminar práctica» */
      if (!PR.done) PR.done = /\.\.\.---\.\.\./.test(PR.log) || PR.log.length >= 9;
    }
  }
  function morseRow(sym, active, log) {
    return { t: "custom", h: 56, draw: function (ctx, x, y, w, h) {
      UI.rr(ctx, x, y, w, h, 14); ctx.fillStyle = "#10203a"; ctx.fill();
      if (!sym.length) { UI.drawText(ctx, { size: 13, weight: 500, color: "rgba(255,255,255,.55)", text: "Aquí aparecen tus puntos y rayas…", align: "center" }, x, y + 18, w, true); return; }
      var cx = x + 18, list = log ? sym.slice(-18) : sym;
      list.forEach(function (s, i) {
        var on = active === i, col = on ? C.signal : "rgba(255,255,255,.75)";
        if (!log && sym.length === 9 && (i === 3 || i === 6)) cx += 14;
        ctx.fillStyle = col; if (on) { ctx.shadowColor = C.signal; ctx.shadowBlur = 14; }
        if (s === ".") { ctx.beginPath(); ctx.arc(cx + 8, y + h / 2, 8, 0, Math.PI * 2); ctx.fill(); cx += 26; } else { UI.rr(ctx, cx, y + h / 2 - 8, 38, 16, 8); ctx.fill(); cx += 50; }
        ctx.shadowColor = "transparent";
      });
    } };
  }
  function flash(ms, cb) { torchLight(true); AU.click(true); later(ms, function () { torchLight(false); AU.click(false); if (cb) cb(); }); }
  function playSos() {
    var seq = "...---...".split(""), i = 0; PR.didSos = true;
    var stepF = function () {
      if (i >= seq.length) { PR.sos = -1; renderPractice(); return; }
      PR.sos = i; renderPractice();
      var s = seq[i]; flash(s === "." ? 200 : 600, function () { i++; later(i === 3 || i === 6 ? 600 : 200, stepF); });
    };
    stepF();
  }
  var holdT = 0;
  function torchHold(down) {
    if (S.view !== "seq" || S.step !== 1 || PR.mode !== "torch" || PR.g !== "p") { if (PR.mode === "torch" && !down && W.lightOn && holdT) { holdT = 0; torchLight(false); } return; }
    if (down) { holdT = performance.now(); torchLight(true); AU.click(true); }
    else if (holdT) { var d = performance.now() - holdT; holdT = 0; torchLight(false); AU.click(false); PR.log += d < 400 ? "." : "-"; renderPractice(); }
  }
  /* clic sobre el objeto en las manos (computador): perilla izquierda (o el cuerpo) = encender o apagar; perilla derecha = girarla */
  function practiceObjClick(e) {
    if (S.view !== "seq" || S.step !== 1 || PR.mode !== "radio") return;
    var pt = e && e.detail && e.detail.intersection && e.detail.intersection.point;
    if (knobAt(pt) === "tune") { if (TU.state.on) turnKnob(-Math.PI / 6); return; }
    radioSet({ on: !TU.state.on });
  }

  /* =====================================================================================
     3 · PERSONAJE · 4 · INFORMACIÓN · despedida
     ===================================================================================== */
  function characterStep(kind) {
    var tp = topic(), st = tp.story, c = W.char, line;
    c.kind = S.item === "radio" ? "radio" : "torch";
    if (st) line = st.bubble;
    else if (S.item === "radio") line = "Escuchemos: " + FF.tuner.bands.AM[0].msg.replace("Boletín de ejemplo: ", "");
    else if (S.item === "linterna") line = item().guide.s3.msg;
    else line = tp.lead.split(". ")[0] + ".";
    var tk = S.token;
    makeObject(kind, (kind === "torch" ? 0.22 : 0.27) * CHAR_H / 1.5).then(function (o) {
      if (tk !== S.token) return;
      var g = new THREE.Group(); g.add(o); g.userData.size = o.userData.size; W.extra.add(g); c.hold = { obj: g, kind: kind };
      if (kind === "torch") { var piv = new THREE.Group(); o.parent.remove(o); piv.add(o); g.add(piv); attachBeam(piv, o); W.charTorch = piv; setNight(true); torchLight(true); }
    });
    if (S.item === "radio") { TU.set({ on: true, band: "AM", pos: FF.tuner.bands.AM[0].pos }, true); }
    later(700, function () { bubble(line, st && st.box ? { tag: st.box } : null); c.say(line); });
    /* después de la radio: en lugar del texto, un solo botón «Linterna» que lleva directo a la práctica de la linterna */
    if (S.item === "radio") { seqCard({ w: 300, pad: [22, 22, 22, 22], items: [{ t: "buttons", align: "center", size: 18, list: [{ id: "torch-practice", label: "Linterna", kind: "signal" }] }] }); return; }
    seqCard({ items: [stepsStrip(2), { t: "kicker", text: item().kicker }, { t: "h2", text: tp.name },
      { t: "p", justify: true, text: st ? st.key : Array.isArray(tp.what) ? tp.what[0] : tp.what },
      { t: "buttons", list: [{ id: "next", label: "Continuar →", kind: "signal" }, { id: "back", label: "← Anterior", kind: "outline" }] }] });
  }
  function infoStep() {
    var it = item(), tp = topic(), st = tp.story, key = S.item + ":" + tp.id;
    S.explored[S.zone][key] = true;
    var what = Array.isArray(tp.what) ? tp.what : [tp.what], facts = st && st.facts ? st.facts : tp.net ? [[tp.net.internet[0] ? "yes" : "no", "Internet", tp.net.internet[1]], [tp.net.cellular[0] ? "yes" : "no", "Red celular", tp.net.cellular[1]]] : null;
    var last = S.ti >= it.objects.length - 1;
    var list = [stepsStrip(3), { t: "kicker", text: it.kicker }, { t: "h2", text: tp.name }, { t: "h3", text: tp.whatTitle || "¿Cómo ayuda?" }];
    what.forEach(function (p) { list.push({ t: "p", justify: true, text: p }); });
    if (facts) list.push({ t: "facts", list: facts, mb: 6 });
    if (tp.limit) { list.push({ t: "h3", text: "Condiciones y límites" }); list.push({ t: "p", justify: true, text: tp.limit }); }
    list.push({ t: "buttons", list: [{ id: last ? "bye" : "next-topic", label: last ? "Terminar recorrido →" : "Siguiente tema: " + it.objects[S.ti + 1].label + " →", kind: "signal" }, { id: "redo", label: "Repetir práctica", kind: "outline" }] });
    seqCard({ w: 440, items: list });
    if (W.char.api) { W.char.api.pose = "relief"; }
  }
  /* «¡Recorrido terminado!»: Mateo sostiene el objeto y saluda; botones al siguiente objeto y al menú de la zona */
  function byeStep(kind) {
    var it = item(), c = W.char, i = ORDER.indexOf(S.item), nextId = ORDER[(i + 1) % ORDER.length], nextName = FF.menu.filter(function (m) { return m.id === nextId; })[0].name;
    c.kind = S.item === "radio" ? "radio" : "torch"; c.farewell = true; if (c.api) c.api.mood = "happy";
    var tk = S.token;
    makeObject(kind, (kind === "torch" ? 0.22 : 0.27) * CHAR_H / 1.5).then(function (o) { if (tk !== S.token) return; var g = new THREE.Group(); g.add(o); g.userData.size = o.userData.size; W.extra.add(g); c.hold = { obj: g, kind: kind }; });
    later(500, function () { bubble("¡Gracias por acompañarme!"); });
    seqCard({ stripe: C.signal, items: [{ t: "kicker", color: C.gold, text: it.kicker }, { t: "h2", text: "¡Recorrido terminado!" }, { t: "p", justify: true, text: it.bye },
      { t: "buttons", list: [{ id: "item:" + nextId, label: "Siguiente: " + nextName + " →", kind: "signal" }, { id: "to-hub", label: "Volver al menú de la zona", kind: "outline" }] }] });
  }

  /* =====================================================================================
     ACCIONES (botones de los paneles)
     ===================================================================================== */
  function act(id) {
    AU.unlock();
    if (id === "start") { AU.click(true); enterZone("rural"); return; }
    if (id === "replace") { FFX.placement.start(); return; }
    if (id === "home") { go("home"); return; }
    if (id === "to-hub") { hub(); return; }
    if (id === "sound") { AU.setEnabled(!AU.enabled()); hub(); return; }
    if (id.indexOf("open:") === 0) { openItem(id.slice(5)); return; }
    if (id.indexOf("item:") === 0) { openItem(id.slice(5)); return; }
    if (id === "torch-practice") { S.item = "linterna"; S.ti = 0; seqStep(1); return; }   // botón «Linterna»: directo a su práctica
    if (id.indexOf("step:") === 0) { var n = +id.slice(5); if (n <= S.step + 1) seqStep(n); return; }
    if (id === "next") { seqStep(S.step + 1); return; }
    if (id === "back") { seqStep(Math.max(0, S.step - 1)); return; }
    if (id === "redo") { seqStep(1); return; }
    if (id === "next-topic") { S.ti++; seqStep(0); return; }
    if (id === "bye") { seqStep(4); return; }
    /* práctica */
    if (id === "power") { radioSet({ on: !TU.state.on }); return; }
    if (id.indexOf("band:") === 0) { radioSet({ band: id.slice(5) }); return; }
    if (id === "dial-" || id === "dial+") { if (TU.state.on) radioSet({ pos: Math.max(0, Math.min(100, TU.state.pos + (id === "dial+" ? 2 : -2))) }); return; }
    if (id === "dial") { return; }
    if (id.indexOf("g:") === 0) { PR.g = id.slice(2); torchLight(false); renderPractice(); return; }
    if (id === "dot" || id === "dash") {
      var sym = id === "dot" ? "." : "-";
      if (PR.g === "p") { PR.log += sym; PR.flashLog = PR.log.length - 1; } else PR.flash = id === "dot" ? 0 : 1;
      renderPractice(); flash(id === "dot" ? 200 : 600, function () { PR.flash = -1; PR.flashLog = -1; renderPractice(); }); return;
    }
    if (id === "sos") { playSos(); return; }
    if (id === "clear") { PR.log = ""; renderPractice(); return; }
  }

  /* =====================================================================================
     CADA FOTOGRAMA
     ===================================================================================== */
  window.FFApp = { act: function (id) { act(id); }, state: function () { return { view: S.view, zone: S.zone, item: S.item, step: S.step, mode: PR.mode, log: PR.log, light: W.lightOn, radio: TU.state, walk: W.walk, heldKind: W.heldKind }; }, debug: function () { return { PR: PR, W: W }; } };   // para depurar desde la consola
  AFRAME.registerComponent("vr-hit", {});
  AFRAME.registerComponent("ff-app", {
    init: function () {
      sceneEl = this.el; root = sceneEl.object3D; camEl = FFX.byId("cam");
      lobbyEl = FFX.byId("lobby"); worldEl = FFX.byId("world");
      var start = function () {
        buildLobby(); buildWorldPanels(); buildScanPanel();
        UI.loadFonts().then(function () { var l = FFX.byId("ff-loading"); l.style.opacity = 0; setTimeout(function () { l.remove(); }, 700); });
        go("home");
        sceneEl.addEventListener("enter-vr", function () { AR = true; arApply(); });
        sceneEl.addEventListener("exit-vr", function () { AR = false; arApply(); });
        /* zoom en el computador: rueda del ratón o teclas + / − (0 vuelve al normal). En el Quest no aplica: ahí te acercas a la mesa */
        var FOV0 = 70, zoomTo = function (f) {
          if (sceneEl.is("vr-mode")) return;
          f = Math.max(25, Math.min(95, f)); camEl.setAttribute("camera", "fov", f);
        };
        sceneEl.canvas.addEventListener("wheel", function (e) { e.preventDefault(); zoomTo(camEl.getAttribute("camera").fov + (e.deltaY > 0 ? 4 : -4)); }, { passive: false });
        window.addEventListener("keydown", function (e) {
          var f = camEl.getAttribute("camera").fov;
          if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") zoomTo(f - 6);
          else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") zoomTo(f + 6);
          else if (e.key === "0" || e.code === "Numpad0") zoomTo(FOV0);
        });
        /* la portada señala «Comenzar» cuando el rayo pasa por encima */
        var orig = P.home.setHover.bind(P.home);
        P.home.setHover = function (id) { if (id === "start" && !ctaOn) ctaN++; ctaOn = id === "start"; orig(id); };
        /* clic en el dial de la radio: posición exacta */
        P.seq.el.addEventListener("click", function (e) {
          var hit = e.detail && e.detail.intersection; if (!hit || !hit.uv || PR.mode !== "radio" || !TU.state.on) return;
          var r = P.seq.regions.filter(function (q) { return q.id === "dial"; })[0]; if (!r) return;
          var x = hit.uv.x * P.seq.W, y = (1 - hit.uv.y) * P.seq.H; if (y < r.y || y > r.y + r.h || x < r.x || x > r.x + r.w) return;
          radioSet({ pos: Math.round(Math.max(0, Math.min(100, (x - r.x - 10) / (r.w - 20) * 100))) });
        });
      };
      if (sceneEl.hasLoaded) start(); else sceneEl.addEventListener("loaded", start);
    },
    tick: function (time, dt) {
      if (!P.home) return;
      var t = time / 1000, camPos = camEl.object3D.getWorldPosition(new V3());
      scanTick();
      if (S.view === "home") {
        lobby.rings.forEach(function (r, i) { var p = ((t + i * 2.25) % 9) / 9, s = 0.04 + p * 0.42; r.scale.setScalar(s); r.material.opacity = 0.8 * (1 - p) * 0.6; });
        lobby.chars.forEach(function (c) { if (!c.api || !c.g.visible) return; choreo(c, t); c.update(t + c.slot.phase); });
        return;
      }
      if (!W.char) return;
      W.stage.position.x = 0; W.stage.position.z = CHAR_Z;
      if (W.scenery) W.scenery.update(t, 0);
      var c = W.char, ft = W.fearTarget || 0; c.fear += (ft - c.fear) * Math.min(1, dt / 400);
      if (c.fear < 0.01 && ft === 0) c.fear = 0;
      walkUpdate(t, dt, camPos);
      c.look = S.view === "intro" && S.introPhase === "during" ? null : camPos;
      c.update(t);
      followBubble(camPos);
      /* objetos de la mesa: quietos sobre su base; solo dan un saltito al tocarlos y vuelven a apoyarse */
      if (S.view === "hub" && W.slots) Object.keys(W.slots).forEach(function (id) {
        var s = W.slots[id], st = s.st, k = Math.min(0.05, dt / 1000);
        st.vy += (-st.y * 60 - st.vy * 8) * k; st.y += st.vy * k; st.vr += (-st.rot * 50 - st.vr * 7) * k; st.rot += st.vr * k;
        s.holder.position.y = 0.036 + Math.max(0, st.y) * 0.05;
        s.holder.rotation.y = Math.sin(t * 0.5 + s.phase) * 0.18 + st.rot * 0.1;
      });
      if (W.show) { W.show.rotation.y = t * 0.45;
        if (W.showGlow > 0) { W.showGlow = Math.min(1, W.showGlow + dt / 2500); var ln = W.show.userData.lens; if (ln) ln.material.opacity = W.showGlow; } }
      /* práctica: el objeto se adapta a las manos; la radio se enciende tocando su perilla izquierda y se sintoniza girando la derecha;
         la linterna se enciende presionando su botón con el pulgar derecho (o pellizcando) */
      placeHeld();
      handGestures();
      if (S.view === "seq" && S.step === 1 && PR.mode === "radio") radioKnobs();
    }
  });

  /* =====================================================================================
     PERSONAJE CAMINANDO SOBRE LA MESA
     api.walk = { phase, k } (js/characters-3d.js) mueve las piernas y los brazos; aquí se mueve el cuerpo por la mesa: va hacia un punto,
     se detiene un momento mirando al usuario y sigue. Mientras camina sigue hablando (globo con las instrucciones de la práctica).
     En la entrada de la zona (sin señal / sismo) se queda quieto en el centro.
     ===================================================================================== */
  function walkUpdate(t, dt, camPos) {
    var wk = W.walk, c = W.char; if (!wk || !W.cg) return;
    var sec = Math.min(0.05, dt / 1000), still = S.view === "intro" || c.fear > 0.05;
    var me = root.worldToLocal(camPos.clone());   // el usuario, en coordenadas de la mesa
    if (still) { wk.tx = 0; wk.tz = CHAR_Z; }
    var dx = wk.tx - wk.x, dz = wk.tz - wk.z, d = Math.hypot(dx, dz), moving = false;
    if (wk.pause > 0 && !still) wk.pause -= sec;
    else if (d > 0.008) {
      moving = true; var step = Math.min(d, WALK.speed * sec); wk.x += dx / d * step; wk.z += dz / d * step;
      turnTo(wk, Math.atan2(dx, dz), sec * 4);
    } else if (!still) {
      /* llegó: pausa mirando al usuario y elige el siguiente punto (al menos 8 cm más allá) */
      wk.pause = 1.2 + Math.random() * 2.2;
      for (var i = 0; i < 8; i++) { var nx = WALK.x0 + Math.random() * (WALK.x1 - WALK.x0), nz = WALK.z0 + Math.random() * (WALK.z1 - WALK.z0); if (Math.hypot(nx - wk.x, nz - wk.z) > 0.08) { wk.tx = nx; wk.tz = nz; break; } }
    }
    if (!moving) turnTo(wk, Math.atan2(me.x - wk.x, me.z - wk.z), sec * 3);
    wk.k += ((moving ? 1 : 0) - wk.k) * Math.min(1, sec * 6);
    wk.phase += sec * (WALK.speed / 0.05) * Math.PI;
    if (c.api) c.api.walk = wk.k > 0.02 ? { phase: wk.phase, k: wk.k } : null;
    /* W.cg vive dentro del escenario (escala W.k, en z = CHAR_Z) */
    W.cg.position.set(wk.x / W.k, 0, (wk.z - CHAR_Z) / W.k); W.cg.rotation.y = wk.yaw;
  }
  function turnTo(wk, yaw, k) { var d = yaw - wk.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); wk.yaw += d * Math.min(1, k); }
  /* el globo de diálogo va sobre la cabeza del personaje y mira al usuario */
  function followBubble(camPos) {
    if (!P.bubble.el.object3D.visible || !W.walk) return;
    var o = P.bubble.el.object3D; o.position.set(W.walk.x + 0.02, CHAR_H * 1.02, W.walk.z);
    var me = root.worldToLocal(camPos.clone()); o.rotation.set(0, Math.atan2(me.x - o.position.x, me.z - o.position.z), 0);
  }

  /* =====================================================================================
     GESTOS CON LAS MANOS (Meta Quest, hand tracking)
     · Linterna: mientras el pulgar derecho presiona el botón (o dura el pellizco de esa mano), la luz está encendida (punto o raya).
     · Radio: tocar la perilla izquierda la enciende; tomar y girar la perilla derecha cambia de AM a FM y sintoniza (radioHands).
     ===================================================================================== */
  var torchPinch = false;
  function handGestures() {
    var H = FFX.hands;
    if (!FFX.immersive() || S.view !== "seq" || S.step !== 1) { if (torchPinch) { torchPinch = false; torchLight(false); } return; }
    if (PR.mode === "torch") {
      var side = W.torchSide || "right", on = !!H.pinch(side).active || !!(PR.trig && PR.trig.pressed);
      if (on && !torchPinch) { torchPinch = true; if (PR.g === "p") torchHold(true); else { torchLight(true); AU.click(true); } }
      else if (!on && torchPinch) { torchPinch = false; if (PR.g === "p") torchHold(false); else { torchLight(false); AU.click(false); } }
    } else if (PR.mode === "radio") radioHands();
  }

  /* =====================================================================================
     ESCANEO DE LA MESA (src/main.js hace la detección): cartel que acompaña la mirada con los pasos
     ===================================================================================== */
  var hudEl = null, scanStatus = "";
  function buildScanPanel() {
    hudEl = FFX.entity(); hudEl._ensureEntity();   // fuera de la raíz: la raíz está oculta mientras se escanea
    P.scan = new UI.Panel({ parent: hudEl, w: 0.34, onClick: act });
    hudEl.object3D.visible = false;
    FFX.placement.on(function (st) {
      hudEl.object3D.visible = st === "placing"; scanStatus = "";
      if (st === "placing") { AU.sceneStop(); torchLight(false); }
      if (st === "placed") { var v = S.view; arApply(); if (v === "home") go(v); else if (S.zone) hub(); else go("home"); }
      UI.refresh();
    });
  }
  function scanSpec(status) {
    return { w: 460, bg: "rgba(10,24,32,.9)", radius: 24, pad: [20, 24, 22, 24], items: [
      { t: "kicker", color: C.peach, text: "Realidad aumentada · Free Frequency" },
      { t: "h1", size: 30, color: "#fff", text: "Escanea tu mesa", mb: 10 },
      { t: "text", size: 15, lh: 1.5, weight: 500, color: "rgba(255,255,255,.9)", text: "1. Deja los controles: aquí se usan las manos.\n2. Mira despacio hacia una mesa o escritorio. La cuadrícula amarilla muestra las superficies que detecta el visor.\n3. Cuando el anillo amarillo quede sobre la mesa, pellizca (junta pulgar e índice) para colocar ahí la experiencia.", mb: 12 },
      { t: "text", size: 16, lh: 1.45, weight: 700, color: status.ok ? "#8be0a4" : C.signal, text: status.text }
    ] };
  }
  function scanTick() {
    if (!hudEl || FFX.placement.state !== "placing") return;
    var head = FFX.head(), o = hudEl.object3D, hp = head.getWorldPosition(new V3()), hq = head.getWorldQuaternion(new THREE.Quaternion());
    /* el cartel acompaña la mirada (también al mirar hacia la mesa), un poco por encima de donde se mira */
    var d = new V3(0, 0, -1).applyQuaternion(hq), f = new V3(d.x, 0, d.z); if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    var pitch = Math.max(-0.6, Math.min(0.2, Math.asin(Math.max(-1, Math.min(1, d.y))) + 0.45));
    var target = hp.clone().addScaledVector(f, 0.65 * Math.cos(pitch)); target.y = hp.y + 0.65 * Math.sin(pitch);
    if (!o.userData.init) { o.position.copy(target); o.userData.init = true; } else o.position.lerp(target, 0.04);
    o.lookAt(hp);
    var cand = FFX.placement.candidate, late = FFX.placement.since() > 5000;
    var st = cand ? { ok: true, text: (cand.table ? "✓ Mesa detectada." : "✓ Superficie detectada.") + " Pellizca para colocar la experiencia aquí." }
      : late ? { ok: false, text: "¿No aparece el anillo? Acércate a la mesa y mírala de frente. O pellizca para usar una mesa virtual delante de ti." }
      : { ok: false, text: "Buscando superficies…" };
    if (st.text !== scanStatus) { scanStatus = st.text; P.scan.set(scanSpec(st)); }
  }
})();
