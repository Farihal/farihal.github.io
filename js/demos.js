// Interactive 3D demos (Three.js, loaded through the import map in index.html)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
(function () {
  'use strict';
  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = matchMedia('(pointer: fine)').matches && !REDUCE;
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  var V3 = THREE.Vector3;
  // Glowing parts: colours pushed above 1.0 so only they bloom
  // Scale a colour so its luminance clears the bloom threshold, whatever its hue
  function boost(c, k) { var l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return c.multiplyScalar(3 * (k || 1) / Math.max(l, 0.03)); }
  function glow(m, k) { boost(m.color, k); return m; }

  /* ---------- Shared bench ---------- */
  var benches = [];
  function mat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: color, metalness: o.metal != null ? o.metal : 0.4, roughness: o.rough != null ? o.rough : 0.5,
      transparent: o.opacity != null, opacity: o.opacity != null ? o.opacity : 1,
      emissive: o.emissive || 0x000000, side: o.side || THREE.FrontSide
    });
    if (o.opacity != null && o.opacity < 0.5) m.depthWrite = false;
    return m;
  }
  function label(text, bg) {
    var c = document.createElement('canvas'); c.width = 160; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = bg || 'rgba(22,26,31,0.86)'; g.fillRect(8, 10, 144, 44);
    g.fillStyle = '#ffffff'; g.font = '500 28px "72 Mono", ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 80, 33);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false }));
    s.scale.set(0.9, 0.36, 1); s.renderOrder = 10;
    return s;
  }

  // A shadow-catching floor with a drafting grid, coloured from the page theme
  function benchFloor(b, y, size, step) {
    var catcher = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
    catcher.position.y = y; catcher.receiveShadow = true; catcher.userData.noCast = true; b.scene.add(catcher);
    var pts = [], h = size / 2;
    for (var x = -h; x <= h + 1e-6; x += step) { pts.push(new V3(x, 0, -h), new V3(x, 0, h), new V3(-h, 0, x), new V3(h, 0, x)); }
    var gm = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
    b.gridMats.push(gm); b.applyTheme();
  }
  var pmremCache = new WeakMap();
  function Bench(stage, o) {
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'gl';
    stage.insertBefore(renderer.domElement, stage.firstChild);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(o.fov || 32, 1, 0.05, 300);
    // Image-based lighting for believable metal, copper and hydrogel
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x2a2f36, 1.1));
    var key = new THREE.DirectionalLight(0xffffff, 2.4); scene.add(key); scene.add(key.target);
    var SH = o.shadow || 6, LD = o.lightDist || 12;
    key.castShadow = true; key.shadow.mapSize.set(1536, 1536); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    key.shadow.camera.left = key.shadow.camera.bottom = -SH; key.shadow.camera.right = key.shadow.camera.top = SH;
    key.shadow.camera.near = 0.1; key.shadow.camera.far = LD * 3; key.shadow.radius = 4;
    var KOFF = new V3(4, 8, 6).normalize().multiplyScalar(LD);
    var rim = new THREE.DirectionalLight(0xffd2b0, 0.9); rim.position.set(-6, 2, -5); scene.add(rim);
    var composer = null;
    if (FINE && o.bloom !== false) {
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 1.7));
      composer.addPass(new OutputPass());
    }
    var b = {
      gridMats: [], keepBg: !!o.keepBg,
      applyTheme: function () {
        if (!b.keepBg) {
          // Grid paper drawn at 32 CSS px, matching the page's drafting style
          var dpr = renderer.getPixelRatio(), w = Math.max(2, Math.round(b.W * dpr)), h = Math.max(2, Math.round(b.H * dpr));
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          var g = c.getContext('2d'), cell = 32 * dpr;
          g.fillStyle = css('--bench') || '#FBFCFD'; g.fillRect(0, 0, w, h);
          g.strokeStyle = css('--line') || '#CBD2DA'; g.globalAlpha = 0.6; g.lineWidth = Math.max(1, Math.round(dpr));
          g.beginPath();
          for (var x = 0; x <= w; x += cell) { var xx = Math.round(x) + 0.5; g.moveTo(xx, 0); g.lineTo(xx, h); }
          for (var y = 0; y <= h; y += cell) { var yy = Math.round(y) + 0.5; g.moveTo(0, yy); g.lineTo(w, yy); }
          g.stroke();
          var tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
          if (scene.background && scene.background.isTexture) scene.background.dispose();
          scene.background = tex;
        }
        b.gridMats.forEach(function (m) { m.color.set(css('--line') || '#CBD2DA'); });
      },
      drawMain: function () {
        renderer.setScissorTest(false); renderer.setViewport(0, 0, b.W, b.H);
        if (composer) composer.render(); else renderer.render(scene, camera);
      },
      renderer: renderer, scene: scene, camera: camera, key: key, stage: stage,
      yaw: o.yaw, pitch: o.pitch, dist: o.dist, target: o.target || new V3(), yawBase: 0,
      minPitch: o.minPitch != null ? o.minPitch : -1.2, maxPitch: o.maxPitch != null ? o.maxPitch : 1.35,
      visible: false, idle: 0, drag: null, W: 1, H: 1, distScale: 1, update: null, render: null, onResize: null
    };
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, input, .pad')) return;
      b.drag = { x: e.clientX, y: e.clientY, yaw: b.yaw, pitch: b.pitch, touch: e.pointerType !== 'mouse' };
      if (!b.drag.touch) { try { stage.setPointerCapture(e.pointerId); } catch (er) {} }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!b.drag) return;
      b.yaw = b.drag.yaw - (e.clientX - b.drag.x) * 0.008;
      if (!b.drag.touch) b.pitch = clamp(b.drag.pitch + (e.clientY - b.drag.y) * 0.008, b.minPitch, b.maxPitch);
      b.idle = 0;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { stage.addEventListener(ev, function () { b.drag = null; }); });
    function resize() {
      b.W = Math.max(1, stage.clientWidth); b.H = Math.max(1, stage.clientHeight);
      renderer.setSize(b.W, b.H, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(b.W, b.H); }
      camera.aspect = b.W / b.H; camera.updateProjectionMatrix();
      if (!b.keepBg && (b.bgW !== b.W || b.bgH !== b.H)) { b.bgW = b.W; b.bgH = b.H; b.applyTheme(); }
      b.distScale = camera.aspect < 1 ? (o.portrait || 1.35) : camera.aspect < 1.3 ? 1.12 : 1;
      if (b.onResize) b.onResize(b.W, b.H);
    }
    b.resize = resize;
    new ResizeObserver(resize).observe(stage);
    new IntersectionObserver(function (en) { b.visible = en[0].isIntersecting; }).observe(stage);
    var shadowAcc = 1;
    b.tick = function (dt, t) {
      if (b.update) b.update(dt, t);
      // New meshes (cars, crates, tether) pick up shadows within a second
      shadowAcc += dt;
      if (shadowAcc > 1) {
        shadowAcc = 0;
        scene.traverse(function (ob) {
          if (!ob.isMesh || Array.isArray(ob.material)) { if (ob.isMesh) ob.castShadow = ob.receiveShadow = true; return; }
          var m = ob.material, see = !(m.transparent && m.opacity < 0.9) && !m.isMeshBasicMaterial && !m.isShadowMaterial;
          if (!ob.userData.noCast) ob.castShadow = see;
          ob.receiveShadow = !m.isMeshBasicMaterial;
        });
      }
      b.idle += dt;
      if (o.auto && !b.drag && !REDUCE && b.idle > 4) b.yaw += dt * 0.06;
      var y = b.yaw + b.yawBase, p = b.pitch, d = b.dist * b.distScale, tg = b.target;
      camera.position.set(tg.x + d * Math.cos(p) * Math.sin(y), tg.y + d * Math.sin(p), tg.z + d * Math.cos(p) * Math.cos(y));
      camera.lookAt(tg);
      key.target.position.copy(tg); key.position.copy(tg).add(KOFF);
      if (b.render) b.render(); else b.drawMain();
    };
    b.applyTheme();
    benches.push(b);
    return b;
  }
  function lazy(stage, init) {
    if (!stage) return; // demo not on this page: skip it instead of throwing and killing every demo after it
    var io = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return;
      io.disconnect();
      try { var b = init(); b.resize(); } catch (err) { console.error(err); }
    }, { rootMargin: '300px 0px' });
    io.observe(stage);
  }
  function retheme() { benches.forEach(function (bb) { bb.applyTheme(); }); }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  var last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (var i = 0; i < benches.length; i++) if (benches[i].visible) benches[i].tick(dt, now / 1000);
  }
  requestAnimationFrame(loop);

  /* ================= 1. PMSM ================= */
  lazy($('st-pmsm'), function () {
    var b = Bench($('st-pmsm'), { yaw: -0.8, pitch: 0.42, dist: 10.5, auto: true, portrait: 1.4, shadow: 5.5, lightDist: 12, bloom: false });
    benchFloor(b, -2.2, 16, 0.5);
    var root = new THREE.Group(); b.scene.add(root);
    var L = 1.6, parts = {};
    function part(id, name, color, parent) { var g = new THREE.Group(); g.userData = { name: name, color: color }; parts[id] = g; parent.add(g); return g; }

    var statorAsm = new THREE.Group(); root.add(statorAsm);
    var stator = part('stator', 'Stator core', '#8D99A6', statorAsm);
    var mSt = mat(0x8d99a6, { metal: 0.6, rough: 0.4 });
    var ys = new THREE.Shape(); ys.absarc(0, 0, 1.62, 0, Math.PI * 2, false);
    var hole = new THREE.Path(); hole.absarc(0, 0, 1.33, 0, Math.PI * 2, true); ys.holes.push(hole);
    var yg = new THREE.ExtrudeGeometry(ys, { depth: L, bevelEnabled: false, curveSegments: 96 }); yg.translate(0, 0, -L / 2);
    stator.add(new THREE.Mesh(yg, mSt));
    var toothG = new THREE.BoxGeometry(0.36, 0.085, L), tipG = new THREE.BoxGeometry(0.05, 0.13, L);
    var i, a;
    for (i = 0; i < 48; i++) {
      a = i / 48 * Math.PI * 2;
      var t1 = new THREE.Mesh(toothG, mSt); t1.position.set(Math.cos(a) * 1.16, Math.sin(a) * 1.16, 0); t1.rotation.z = a; stator.add(t1);
      var t2 = new THREE.Mesh(tipG, mSt); t2.position.set(Math.cos(a) * 1.005, Math.sin(a) * 1.005, 0); t2.rotation.z = a; stator.add(t2);
    }
    var wind = part('winding', 'Copper windings', '#B8733A', statorAsm);
    var mCu = mat(0xb8733a, { metal: 0.85, rough: 0.32 });
    var coilG = new THREE.BoxGeometry(0.27, 0.062, L + 0.3);
    for (i = 0; i < 48; i++) {
      a = (i + 0.5) / 48 * Math.PI * 2;
      var c = new THREE.Mesh(coilG, mCu); c.position.set(Math.cos(a) * 1.185, Math.sin(a) * 1.185, 0); c.rotation.z = a; wind.add(c);
    }
    var endG = new THREE.TorusGeometry(1.185, 0.11, 12, 96);
    [-1, 1].forEach(function (s) { var e = new THREE.Mesh(endG, mCu); e.position.z = s * (L / 2 + 0.2); e.scale.z = 0.8; wind.add(e); });

    var housing = part('housing', 'Water jacket', '#3D8EC9', root);
    housing.add(new THREE.Mesh(new THREE.CylinderGeometry(1.86, 1.86, L + 0.6, 96, 1, true).rotateX(Math.PI / 2), mat(0xa8bccd, { metal: 0.3, rough: 0.25, opacity: 0.16, side: THREE.DoubleSide })));
    var mW = mat(0x3d8ec9, { metal: 0.1, rough: 0.2, opacity: 0.85, emissive: 0x0c2a40 });
    var chG = new THREE.TorusGeometry(1.74, 0.07, 10, 96);
    for (i = 0; i < 7; i++) { var ch = new THREE.Mesh(chG, mW); ch.position.z = -0.72 + i * 0.24; housing.add(ch); }

    var rotorAsm = new THREE.Group(); root.add(rotorAsm);
    var spin = new THREE.Group(); rotorAsm.add(spin);
    var rotor = part('rotor', 'Rotor core', '#6F7A86', spin);
    var rs = new THREE.Shape(); rs.absarc(0, 0, 0.96, 0, Math.PI * 2, false);
    var bore = new THREE.Path(); bore.absarc(0, 0, 0.235, 0, Math.PI * 2, true); rs.holes.push(bore);
    for (var dI = 0; dI < 8; dI++) { var da = dI / 8 * Math.PI * 2 + Math.PI / 8, duct = new THREE.Path(); duct.absarc(Math.cos(da) * 0.46, Math.sin(da) * 0.46, 0.08, 0, Math.PI * 2, true); rs.holes.push(duct); }
    var rg = new THREE.ExtrudeGeometry(rs, { depth: L, bevelEnabled: false, curveSegments: 72 }); rg.translate(0, 0, -L / 2);
    rotor.add(new THREE.Mesh(rg, mat(0x6f7a86, { metal: 0.6, rough: 0.45 })));
    var mags = part('magnets', 'V-shaped NdFeB magnets', '#B23A48', spin);
    var mN = mat(0xb23a48, { metal: 0.35, rough: 0.35 }), mS = mat(0x3c5fa6, { metal: 0.35, rough: 0.35 });
    var segLen = L / 3, segs = [], guideM = new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true });
    for (var k = 0; k < 3; k++) {
      var sg = new THREE.Group(); sg.position.z = (k - 1) * segLen; mags.add(sg); segs.push(sg);
      for (var p = 0; p < 8; p++) {
        var th = p / 8 * Math.PI * 2;
        for (var s = -1; s <= 1; s += 2) {
          var ax = Math.cos(th + s * 0.05) * 0.6, ay = Math.sin(th + s * 0.05) * 0.6;
          var bx = Math.cos(th + s * 0.3) * 0.89, by = Math.sin(th + s * 0.3) * 0.89;
          var mg = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, by - ay), 0.07, segLen * 0.97 + 0.012), p % 2 ? mS : mN);
          mg.position.set((ax + bx) / 2, (ay + by) / 2, 0); mg.rotation.z = Math.atan2(by - ay, bx - ax); sg.add(mg);
        }
        // a line along each magnet row, so the slice-to-slice step is easy to see
        var gl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(Math.cos(th) * 0.975, Math.sin(th) * 0.975, -segLen / 2), new V3(Math.cos(th) * 0.975, Math.sin(th) * 0.975, segLen / 2)]), guideM);
        sg.add(gl);
      }
    }
    var shaft = part('shaft', 'Shaft', '#C9CFD6', spin);
    var mSh = mat(0xc9cfd6, { metal: 0.9, rough: 0.2 });
    shaft.add(new THREE.Mesh(new THREE.CylinderGeometry(0.232, 0.232, 4.0, 48).rotateX(Math.PI / 2), mSh));
    var kk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.7), mSh); kk.position.set(0, 0.25, 1.55); shaft.add(kk);

    var leg = $('pm-legend'), active = null, order = ['stator', 'winding', 'rotor', 'magnets', 'shaft', 'housing'];
    function focus() {
      order.forEach(function (id) {
        var dim = active && active !== id;
        parts[id].traverse(function (ob) {
          if (!ob.material) return;
          var m = ob.material;
          if (m.userData.base == null) { m.userData.base = m.opacity; m.userData.dw = m.depthWrite; }
          m.transparent = true;
          m.opacity = dim ? Math.min(0.08, m.userData.base) : m.userData.base;
          m.depthWrite = dim ? false : m.userData.dw;
          m.needsUpdate = true;
          if (ob.isMesh) { ob.castShadow = !dim; ob.userData.noCast = dim; }
        });
      });
      Array.prototype.forEach.call(leg.children, function (x) { x.setAttribute('aria-pressed', String(x.dataset.id === (active || 'all'))); });
    }
    // Whole-motor view first, then each component on its own
    var all = document.createElement('button'); all.className = 'chip'; all.type = 'button'; all.dataset.id = 'all'; all.setAttribute('aria-pressed', 'true');
    all.innerHTML = '<i style="background:conic-gradient(#8D99A6 0 25%, #B8733A 0 50%, #B23A48 0 75%, #3D8EC9 0)"></i>Whole motor';
    all.addEventListener('click', function () { active = null; focus(); });
    leg.appendChild(all);
    order.forEach(function (id) {
      var x = document.createElement('button'); x.className = 'chip'; x.type = 'button'; x.dataset.id = id; x.setAttribute('aria-pressed', 'false');
      x.innerHTML = '<i style="background:' + parts[id].userData.color + '"></i>' + parts[id].userData.name;
      x.addEventListener('click', function () { active = id; focus(); });
      leg.appendChild(x);
    });
    var ex = 0, exT = 0, sk = 1, skT = 1, rpm = REDUCE ? 0 : 1100;
    var sp = $('pm-speed'); sp.value = rpm;
    function setRpm(v) { rpm = +v; $('pm-rpm').textContent = rpm; $('pm-f').textContent = (rpm * 8 / 120).toFixed(1); $('pm-speed-o').textContent = rpm + ' rpm'; }
    setRpm(rpm); sp.addEventListener('input', function () { setRpm(sp.value); });
    $('pm-explode').addEventListener('click', function () { exT = exT ? 0 : 1; this.setAttribute('aria-pressed', String(!!exT)); this.textContent = exT ? 'Assemble' : 'Explode view'; });
    $('pm-skew').addEventListener('click', function () {
      skT = skT ? 0 : 1; this.setAttribute('aria-pressed', String(!!skT)); this.textContent = '3-step skew: ' + (skT ? 'on' : 'off');
      if (active !== 'magnets') { active = 'magnets'; focus(); }
    });
    // Assumed: total skew of one cogging period (360° / 48 = 7.5°) in three 2.5° steps
    var step = 2.5 * Math.PI / 180;
    // Cogging torque (N·m) read from Fig. 6 of the paper, one point every 1.5°, starting at -0.4°
    var COG_X0 = -0.4, COG_DX = 1.5, COG_P = 15;
    var COG_OFF = [0.82, -1.95, 1.68, 0.27, 1.42, 0.85, -1.65, -0.95, 0.10, 1.60];
    var COG_ON = [0.13, -0.10, 0.55, 0.08, 0.03, 0.10, 0.12, -0.33, 0.02, 0.08];
    function cogAt(arr, deg) {
      var u = (((deg - COG_X0) % COG_P) + COG_P) % COG_P / COG_DX, i = Math.floor(u), t = u - i, n = arr.length;
      var p0 = arr[(i - 1 + n) % n], p1 = arr[i % n], p2 = arr[(i + 1) % n], p3 = arr[(i + 2) % n];
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    var cog = $('pm-cogc'), cctx = cog.getContext('2d'), cogCol = {}, cogAge = 9;
    function drawCog(deg) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cog.clientWidth, h = cog.clientHeight; if (!w) return;
      if (cog.width !== Math.round(w * dpr)) { cog.width = Math.round(w * dpr); cog.height = Math.round(h * dpr); }
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0); cctx.clearRect(0, 0, w, h);
      var L0 = 44, R0 = w - 12, T0 = 22, B0 = h - 30;
      function X(x) { return L0 + (x - COG_X0) / COG_P * (R0 - L0); } function Y(v) { return T0 + (2.2 - v) / 4.4 * (B0 - T0); }
      cctx.font = '10px "72 Mono", monospace'; cctx.lineWidth = 1; cctx.strokeStyle = cogCol.line; cctx.fillStyle = cogCol.muted;
      cctx.textAlign = 'right'; cctx.textBaseline = 'middle';
      [-2, -1, 0, 1, 2].forEach(function (v) { cctx.beginPath(); cctx.moveTo(L0, Y(v)); cctx.lineTo(R0, Y(v)); cctx.stroke(); cctx.fillText(v, L0 - 6, Y(v)); });
      cctx.textAlign = 'center'; cctx.textBaseline = 'top';
      [0, 3, 6, 9, 12].forEach(function (x) { cctx.fillText(x + '°', X(x), B0 + 6); });
      cctx.fillText('rotor position (mechanical)', (L0 + R0) / 2, B0 + 18);
      cctx.save(); cctx.translate(10, (T0 + B0) / 2); cctx.rotate(-Math.PI / 2); cctx.textBaseline = 'middle'; cctx.fillText('N·m', 0, 0); cctx.restore();
      function curve(arr, col, width, dash, alpha) {
        cctx.globalAlpha = alpha; cctx.strokeStyle = col; cctx.lineWidth = width; cctx.setLineDash(dash); cctx.beginPath();
        for (var x = COG_X0; x <= COG_X0 + COG_P + 1e-6; x += 0.1) { var yy = Y(cogAt(arr, x)); if (x === COG_X0) cctx.moveTo(X(x), yy); else cctx.lineTo(X(x), yy); }
        cctx.stroke(); cctx.setLineDash([]); cctx.globalAlpha = 1;
        cctx.fillStyle = col; for (var k = 0; k < arr.length; k++) { cctx.globalAlpha = alpha; cctx.fillRect(X(COG_X0 + k * COG_DX) - 2, Y(arr[k]) - 2, 4, 4); } cctx.globalAlpha = 1;
      }
      var on = skT === 1;
      curve(COG_OFF, cogCol.cool, on ? 1.2 : 2.2, [5, 4], on ? 0.4 : 1);
      curve(COG_ON, cogCol.copper, on ? 2.2 : 1.2, [], on ? 1 : 0.4);
      // legend
      cctx.textAlign = 'left'; cctx.textBaseline = 'middle'; cctx.font = '10px "72 Mono", monospace';
      cctx.fillStyle = cogCol.copper; cctx.fillRect(L0, 7, 14, 2.5); cctx.fillStyle = cogCol.fg; cctx.fillText('with skew · peak 0.675', L0 + 20, 8);
      cctx.strokeStyle = cogCol.cool; cctx.setLineDash([5, 4]); cctx.lineWidth = 2; cctx.beginPath(); cctx.moveTo(L0 + 168, 8); cctx.lineTo(L0 + 184, 8); cctx.stroke(); cctx.setLineDash([]);
      cctx.fillText('without skew · peak 1.672', L0 + 190, 8);
      // current rotor position
      var x0 = COG_X0 + ((((deg - COG_X0) % COG_P) + COG_P) % COG_P), v = cogAt(on ? COG_ON : COG_OFF, x0);
      cctx.strokeStyle = cogCol.fg; cctx.lineWidth = 1; cctx.globalAlpha = 0.35; cctx.beginPath(); cctx.moveTo(X(x0), T0); cctx.lineTo(X(x0), B0); cctx.stroke(); cctx.globalAlpha = 1;
      cctx.fillStyle = on ? cogCol.copper : cogCol.cool; cctx.beginPath(); cctx.arc(X(x0), Y(v), 5, 0, 7); cctx.fill();
      cctx.strokeStyle = cogCol.bg; cctx.lineWidth = 2; cctx.stroke();
      return v;
    }
    var cogRO = 0;
    b.update = function (dt) {
      ex += (exT - ex) * Math.min(1, dt * 5); sk += (skT - sk) * Math.min(1, dt * 5);
      housing.position.z = -2.7 * ex; rotorAsm.position.z = 2.5 * ex;
      // Keep every part in frame: fit a bounding sphere that grows as the motor explodes
      var R = 3.0 + (4.4 - 3.0) * ex, cam = b.camera, half = Math.min(cam.fov / 2, Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) * 180 / Math.PI) * Math.PI / 180;
      b.distScale = 1; b.dist = R / Math.sin(half); b.target.set(0, 0, 0.35 * ex);
      segs.forEach(function (g, j) { g.rotation.z = (j - 1) * step * sk; });
      // slowed well below shaft speed so the position can be followed on the chart
      spin.rotation.z += rpm / 60 * Math.PI * 2 * dt * 0.004;
      cogAge += dt; if (cogAge > 1) { cogAge = 0; cogCol = { line: css('--line'), muted: css('--muted'), fg: css('--fg'), bg: css('--surface'), copper: css('--accent'), cool: css('--highlight') }; }
      var deg = spin.rotation.z * 180 / Math.PI, v = drawCog(deg);
      cogRO += dt; if (cogRO > 0.1 && v != null) { cogRO = 0; $('pm-cog').innerHTML = (skT ? 'with skew' : 'without skew') + ' · now <b>' + (v >= 0 ? '+' : '') + v.toFixed(2) + ' N·m</b>'; }
    };
    return b;
  });

  /* ================= 4. R3ARM ================= */
  lazy($('st-arm'), function () {
    var b = Bench($('st-arm'), { yaw: 0.45, pitch: 0.5, dist: 10, target: new V3(-0.4, 0.6, -0.9), portrait: 1.45, minPitch: 0.05, shadow: 5, lightDist: 12, bloom: false });
    var root = b.scene;
    var floor = new THREE.Mesh(new THREE.CircleGeometry(5.6, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 })); floor.receiveShadow = true; floor.userData.noCast = true; root.add(floor);
    var chassisM = mat(0x3a4148, { rough: 0.55 }), alu = mat(0xb9c0c8, { metal: 0.75, rough: 0.35 }), servo = mat(0x22252a, { rough: 0.5 }), tyre = mat(0x1a1c1f, { rough: 0.9, metal: 0 });
    var robot = new THREE.Group(); root.add(robot);
    var base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.2), chassisM); base.position.y = 0.36; robot.add(base);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.5), mat(0xd07a32, { rough: 0.6 })); nose.position.set(0.86, 0.4, 0); robot.add(nose);
    var wheels = [];
    [[-0.6, 0.66], [0.6, 0.66], [-0.6, -0.66], [0.6, -0.66]].forEach(function (q) {
      var w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24).rotateX(Math.PI / 2), tyre); w.position.set(q[0], 0.22, q[1]); robot.add(w);
      var hubM = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.15), mat(0x6b747e)); w.add(hubM);
      wheels.push({ m: w, side: q[1] });
    });
    var turret = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.16, 32), servo); turret.position.y = 0.58; robot.add(turret);
    var yawG = new THREE.Group(); yawG.position.y = 0.66; robot.add(yawG);
    var sh = new THREE.Group(); sh.position.y = 0.14; yawG.add(sh);
    var shS = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.3), servo); sh.add(shS);
    var up = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.2, 0.13), alu); up.position.y = 0.6; sh.add(up);
    var el = new THREE.Group(); el.position.y = 1.2; sh.add(el);
    var elS = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.26), servo); el.add(elS);
    var fo = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.0, 0.11), alu); fo.position.y = 0.5; el.add(fo);
    var wr = new THREE.Group(); wr.position.y = 1.0; el.add(wr);
    var palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.14), servo); palm.position.y = 0.04; wr.add(palm);
    var fL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.12), alu), fR = fL.clone(); fL.position.y = fR.position.y = 0.2; wr.add(fL); wr.add(fR);
    var tip = new THREE.Object3D(); tip.position.y = 0.24; wr.add(tip);
    var phone = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.08), mat(0x111317)); phone.position.set(0, 0.0, 0.11); wr.add(phone);
    var cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.03, 50); cam.position.set(0, 0.04, 0.12); cam.rotation.x = Math.PI / 2; wr.add(cam);
    // Crate to rescue
    var crate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), mat(0xd07a32, { rough: 0.6, metal: 0.1 }));
    var crossM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var cr1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.245, 0.04), crossM), cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.245, 0.16), crossM); crate.add(cr1); crate.add(cr2);
    var home = new V3(1.56, 0.12, -0.9); crate.position.copy(home); root.add(crate);
    var ZP = new V3(-2.6, 0, -2.2);
    var zoneL = label('drop zone', 'rgba(10,110,209,0.92)'); zoneL.position.set(ZP.x, 0.75, ZP.z); root.add(zoneL);
    var zoneM = new THREE.MeshBasicMaterial({ color: 0x0a6ed1 });
    var zone = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 48).rotateX(-Math.PI / 2), zoneM); zone.position.set(ZP.x, 0.012, ZP.z); root.add(zone);
    var zoneFill = new THREE.Mesh(new THREE.CircleGeometry(0.36, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a6ed1, transparent: true, opacity: 0.18 })); zoneFill.position.set(ZP.x, 0.01, ZP.z); root.add(zoneFill);
    var spots = [[1.56, -0.9], [2.4, 1.5], [0.6, 2.6], [3.0, -2.2]], spotI = 0, delivered = 0, flash = 0, respawnT = -1, counted = false;
    var rb = { x: 0, z: 0, h: 0, v: 0, w: 0 }, drv = { v: 0, w: 0 }, drvBtn = {}, drvKey = {};

    var st = { yaw: 30, sh: 40, el: 70, grip: false };
    var cur = { yaw: 30, sh: 40, el: 70, f: 0.12 }, holding = false, vy = 0;
    var pad = $('ar-pad'), dot = pad.querySelector('i');
    function padPos() { var px = (st.yaw + 90) / 180, py = st.sh / 80; dot.style.left = (px * 100) + '%'; dot.style.top = (py * 100) + '%'; pad.setAttribute('aria-valuetext', 'base ' + Math.round(st.yaw) + '°, shoulder ' + Math.round(st.sh) + '°'); }
    padPos();
    var pd = false;
    function fromPad(e) { var r = pad.getBoundingClientRect(); st.yaw = clamp((e.clientX - r.left) / r.width, 0, 1) * 180 - 90; st.sh = clamp((e.clientY - r.top) / r.height, 0, 1) * 80; padPos(); }
    pad.addEventListener('pointerdown', function (e) { pd = true; try { pad.setPointerCapture(e.pointerId); } catch (er) {} fromPad(e); });
    pad.addEventListener('pointermove', function (e) { if (pd) fromPad(e); });
    pad.addEventListener('pointerup', function () { pd = false; });
    pad.addEventListener('pointercancel', function () { pd = false; });
    pad.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft') st.yaw = clamp(st.yaw - 5, -90, 90); else if (k === 'ArrowRight') st.yaw = clamp(st.yaw + 5, -90, 90);
      else if (k === 'ArrowUp') st.sh = clamp(st.sh - 4, 0, 80); else if (k === 'ArrowDown') st.sh = clamp(st.sh + 4, 0, 80); else return;
      e.preventDefault(); padPos();
    });
    $('ar-elbow').addEventListener('input', function () { st.el = +this.value; $('ar-elbow-o').textContent = st.el + '°'; });
    $('ar-pinch').addEventListener('click', function () {
      st.grip = !st.grip; this.setAttribute('aria-pressed', String(st.grip)); this.textContent = st.grip ? 'Open gripper' : 'Close gripper';
      $('ar-grip').textContent = st.grip ? 'closed' : 'open';
      if (st.grip) {
        var tp = new V3(); tip.getWorldPosition(tp);
        if (!holding && tp.distanceTo(crate.position) < 0.32) { holding = true; wr.attach(crate); $('ar-hold').textContent = 'crate'; }
      } else if (holding) { holding = false; root.attach(crate); crate.rotation.set(0, crate.rotation.y, 0); vy = 0; counted = false; $('ar-hold').textContent = 'nothing'; }
    });
    function placeCrate(i) { if (holding) { holding = false; } root.attach(crate); crate.rotation.set(0, 0, 0); crate.position.set(spots[i][0], 0.12, spots[i][1]); vy = 0; counted = false; $('ar-hold').textContent = 'nothing'; }
    $('ar-reset').addEventListener('click', function () {
      rb.x = rb.z = rb.h = rb.v = rb.w = 0; spotI = 0; placeCrate(0); respawnT = -1;
      st.yaw = 30; st.sh = 40; st.el = 70; $('ar-elbow').value = 70; $('ar-elbow-o').textContent = '70°'; padPos();
      if (st.grip) $('ar-pinch').click();
      $('ar-msg').textContent = '';
    });
    function drvRecompute() {
      drv.v = clamp((drvBtn['v:1'] || drvKey.ArrowUp ? 1 : 0) - (drvBtn['v:-1'] || drvKey.ArrowDown ? 1 : 0), -1, 1);
      drv.w = clamp((drvBtn['w:1'] || drvKey.ArrowLeft ? 1 : 0) - (drvBtn['w:-1'] || drvKey.ArrowRight ? 1 : 0), -1, 1);
      Array.prototype.forEach.call($('ar-drive').querySelectorAll('button[data-dr]'), function (bt) {
        var k = bt.dataset.dr + ':' + bt.dataset.v, kk = { 'v:1': 'ArrowUp', 'v:-1': 'ArrowDown', 'w:1': 'ArrowLeft', 'w:-1': 'ArrowRight' }[k];
        bt.classList.toggle('held', !!drvBtn[k] || !!drvKey[kk]);
      });
    }
    Array.prototype.forEach.call($('ar-drive').querySelectorAll('button[data-dr]'), function (bt) {
      var k = bt.dataset.dr + ':' + bt.dataset.v;
      bt.addEventListener('pointerdown', function (e) { e.preventDefault(); drvBtn[k] = true; try { bt.setPointerCapture(e.pointerId); } catch (er) {} drvRecompute(); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { bt.addEventListener(ev, function () { drvBtn[k] = false; drvRecompute(); }); });
      bt.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); drvBtn[k] = true; drvRecompute(); } });
      bt.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') { drvBtn[k] = false; drvRecompute(); } });
      bt.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
    var ARROWS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    document.addEventListener('keydown', function (e) {
      if (!ARROWS[e.key] || !b.visible || e.target === pad || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      e.preventDefault(); if (!drvKey[e.key]) { drvKey[e.key] = true; drvRecompute(); }
    });
    document.addEventListener('keyup', function (e) { if (drvKey[e.key]) { drvKey[e.key] = false; drvRecompute(); } });
    window.addEventListener('blur', function () { drvBtn = {}; drvKey = {}; drvRecompute(); });
    var inset = $('ar-inset'), ir = { x: 0, y: 0, w: 0, h: 0 };
    b.onResize = function (W, H) {
      var w = Math.round(clamp(W * 0.32, 120, 230)), h = Math.round(w * 9 / 16);
      ir = { x: W - w - 12, y: 12, w: w, h: h };
      inset.style.width = w + 'px'; inset.style.height = h + 'px'; inset.style.right = '12px'; inset.style.bottom = '12px';
    };
    var hexAcc = 0, tmpT = new V3();
    function hx(n) { return ('0' + (n & 255).toString(16).toUpperCase()).slice(-2); }
    b.update = function (dt) {
      var k = Math.min(1, dt * 6);
      cur.yaw += (st.yaw - cur.yaw) * k; cur.sh += (st.sh - cur.sh) * k; cur.el += (st.el - cur.el) * k;
      var fT = st.grip ? (holding ? 0.145 : 0.05) : 0.13; cur.f += (fT - cur.f) * k;
      yawG.rotation.y = cur.yaw * Math.PI / 180; sh.rotation.z = -cur.sh * Math.PI / 180; el.rotation.z = -cur.el * Math.PI / 180;
      fL.position.x = -cur.f; fR.position.x = cur.f;
      // Drive the base
      rb.v += (drv.v * 1.3 - rb.v) * Math.min(1, dt * 4); rb.w += (drv.w * 1.4 - rb.w) * Math.min(1, dt * 5);
      rb.h += rb.w * dt;
      var nx = rb.x + Math.cos(rb.h) * rb.v * dt, nz = rb.z - Math.sin(rb.h) * rb.v * dt, rr = Math.hypot(nx, nz);
      if (rr > 4.4) { nx *= 4.4 / rr; nz *= 4.4 / rr; }
      rb.x = nx; rb.z = nz;
      robot.position.set(rb.x, 0, rb.z); robot.rotation.y = rb.h;
      wheels.forEach(function (w) { w.m.rotation.z -= (rb.v + rb.w * w.side) / 0.22 * dt; });
      b.target.lerp(tmpT.set(rb.x + 0.4, 0.8, rb.z), Math.min(1, dt * 3));
      // Crate falls when released, then check for delivery
      if (!holding && crate.parent === root && crate.position.y > 0.12) { vy -= 9.8 * dt; crate.position.y = Math.max(0.12, crate.position.y + vy * dt); if (crate.position.y === 0.12) { vy = 0; crate.rotation.x = crate.rotation.z = 0; } }
      if (!holding && !counted && crate.parent === root && crate.position.y === 0.12 && Math.hypot(crate.position.x - ZP.x, crate.position.z - ZP.z) < 0.44) {
        counted = true; delivered++; flash = 1; respawnT = 1.6;
        $('ar-del').textContent = delivered; $('ar-msg').textContent = 'Crate delivered. A new one is on its way.';
      }
      if (respawnT >= 0) { respawnT -= dt; if (respawnT < 0) { spotI = (spotI + 1) % spots.length; placeCrate(spotI); $('ar-msg').textContent = ''; } }
      flash = Math.max(0, flash - dt * 0.8);
      zoneM.color.setHex(flash > 0 ? 0x2e9d5f : 0x0a6ed1); zoneFill.material.opacity = 0.18 + flash * 0.4;
      hexAcc += dt;
      if (hexAcc > 0.1) {
        hexAcc = 0;
        var s0 = Math.round(90 + st.yaw), s1 = Math.round(90 - st.sh), s2 = Math.round(st.el), g0 = st.grip ? 1 : 0;
        var ax = ((st.yaw / 90)).toFixed(2), ay = ((st.sh / 40) - 1).toFixed(2);
        $('ar-packet').innerHTML = 'accel <b>x ' + (ax >= 0 ? '+' : '') + ax + ' g · y ' + (ay >= 0 ? '+' : '') + ay + ' g</b><br>nRF24L01 TX <b>[' + [hx(s0), hx(s1), hx(s2), hx(g0)].join(' ') + ']</b> → servos ' + s0 + '° / ' + s1 + '° / ' + s2 + '°';
      }
    };
    b.render = function () {
      var r = b.renderer;
      b.drawMain();
      if (ir.w) {
        r.setScissorTest(true); r.setScissor(ir.x, ir.y, ir.w, ir.h); r.setViewport(ir.x, ir.y, ir.w, ir.h);
        cam.aspect = ir.w / ir.h; cam.updateProjectionMatrix();
        r.render(root, cam); r.setScissorTest(false);
      }
    };
    return b;
  });

  /* ================= 5. R3DIVER ================= */
  lazy($('st-rov'), function () {
    var stage = $('st-rov');
    var b = Bench(stage, { yaw: 0.7, pitch: 0.28, dist: 5.2, portrait: 1.35, minPitch: -0.4, maxPitch: 1.2, keepBg: true, shadow: 7, lightDist: 14 });
    var root = b.scene, WATER = 0x0b3550;
    root.background = new THREE.Color(WATER); root.fog = new THREE.FogExp2(WATER, 0.06);
    b.key.color.set(0xbfe3ff); b.key.position.set(2, 10, 3);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26, 40, 40).rotateX(-Math.PI / 2), mat(0x7d7258, { rough: 1, metal: 0 }));
    var fp = floor.geometry.attributes.position; for (var i = 0; i < fp.count; i++) fp.setY(i, Math.sin(fp.getX(i) * 0.7) * 0.12 + Math.cos(fp.getZ(i) * 0.9) * 0.1); floor.geometry.computeVertexNormals(); root.add(floor);
    var rockM = mat(0x4d5250, { rough: 0.95, metal: 0 });
    var solids = [];
    function ground(x, z) { return Math.sin(x * 0.7) * 0.12 + Math.cos(z * 0.9) * 0.1; }
    [[-4, -5, 0.9], [6, 4, 1.2], [-6, 5, 0.7], [2, -7, 1.0], [7, -3, 0.6], [-2, 7, 0.8]].forEach(function (q) { var r = new THREE.Mesh(new THREE.DodecahedronGeometry(q[2], 0), rockM); r.position.set(q[0], q[2] * 0.4, q[1]); r.rotation.set(q[0], q[1], 0); root.add(r); solids.push({ x: q[0], y: q[2] * 0.4, z: q[1], r: q[2] * 0.9 }); });
    var surf = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5fa8d0, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); surf.position.y = 12; root.add(surf);
    // Specks
    var sp = new Float32Array(900); for (i = 0; i < 300; i++) { sp[i * 3] = (Math.random() - 0.5) * 22; sp[i * 3 + 1] = Math.random() * 12; sp[i * 3 + 2] = (Math.random() - 0.5) * 22; }
    var spG = new THREE.BufferGeometry(); spG.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    root.add(new THREE.Points(spG, new THREE.PointsMaterial({ color: 0x9cc8e0, size: 0.05, transparent: true, opacity: 0.6 })));
    // Person on the seabed (orange suit)
    var person = new THREE.Group(), suit = mat(0xd9772b, { rough: 0.7, metal: 0 }), skin = mat(0xc69a7a, { rough: 0.8, metal: 0 });
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.8, 12).rotateZ(Math.PI / 2), suit); person.add(torso);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin); head.position.x = 0.58; person.add(head);
    [[-0.75, 0.1], [-0.75, -0.1]].forEach(function (q) { var lg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.8, 8).rotateZ(Math.PI / 2), suit); lg.position.set(q[0], 0, q[1]); person.add(lg); });
    [[0.15, 0.32, 0.4], [0.05, -0.34, -0.3]].forEach(function (q) { var ar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.6, 8).rotateZ(Math.PI / 2), suit); ar.position.set(q[0], 0, q[1]); ar.rotation.y = q[2]; person.add(ar); });
    person.position.set(5, 0.28, -4.2); person.rotation.y = 0.6; root.add(person);
    [-0.45, 0.45].forEach(function (o) { solids.push({ x: 5 + Math.cos(0.6) * o, y: 0.3, z: -4.2 - Math.sin(0.6) * o, r: 0.4 }); });
    var pBox = new THREE.Box3().setFromObject(person), corners = [];
    for (i = 0; i < 8; i++) corners.push(new V3(i & 1 ? pBox.max.x : pBox.min.x, i & 2 ? pBox.max.y : pBox.min.y, i & 4 ? pBox.max.z : pBox.min.z));
    // ROV
    var rov = new THREE.Group(); root.add(rov);
    // Built from the project photo: a flat PVC rectangle, a fitting block at each end,
    // open green 3D-printed propellers, and a blue CAT6 tether bundle leaving the rear block.
    var pvc = mat(0xdcdad2, { rough: 0.6, metal: 0 }), pvcEdge = mat(0xcfccc3, { rough: 0.65, metal: 0 });
    var RP = 0.05;
    function pipe(x0, z0, x1, z1, y) {
      var dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
      var m = new THREE.Mesh(new THREE.CylinderGeometry(RP, RP, L, 14).rotateZ(Math.PI / 2), pvc);
      m.position.set((x0 + x1) / 2, y || 0, (z0 + z1) / 2); m.rotation.y = -Math.atan2(dz, dx); rov.add(m); return m;
    }
    function fitting(x, y, z, sx, sy, sz) {
      var f = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), pvc); f.position.set(x, y, z); rov.add(f);
      // socket rims make the blocks read as joined pipe fittings
      var rim = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.012, 0.02, sz + 0.012), pvcEdge); rim.position.set(x, y + sy / 2 - 0.03, z); rov.add(rim);
      return f;
    }
    // Rear block: two joined fittings housing the electronics
    fitting(-0.72, 0.02, -0.15, 0.26, 0.2, 0.28); fitting(-0.72, 0.02, 0.15, 0.26, 0.2, 0.28);
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 18), pvcEdge); cap.position.set(-0.72, 0.145, -0.15); rov.add(cap);
    // Front block: corner tees joined by a cross pipe, camera in the middle
    fitting(0.66, 0, -0.3, 0.16, 0.15, 0.16); fitting(0.66, 0, 0.3, 0.16, 0.15, 0.16);
    pipe(0.66, -0.22, 0.66, 0.22);
    // Long sides with a tee at mid-length and short outward stubs for the vertical thrusters
    pipe(-0.58, -0.3, 0.58, -0.3); pipe(-0.58, 0.3, 0.58, 0.3);
    fitting(0.02, 0, -0.3, 0.15, 0.14, 0.15); fitting(0.02, 0, 0.3, 0.15, 0.14, 0.15);
    pipe(0.02, -0.37, 0.02, -0.5); pipe(0.02, 0.37, 0.02, 0.5);
    // Red power lead on the rear block
    var lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new V3(-0.62, 0.13, 0.15), new V3(-0.5, 0.2, 0.12), new V3(-0.4, 0.12, 0.05)]), 12, 0.012, 6), mat(0xc0392b, { rough: 0.5, metal: 0 })); rov.add(lead);
    // Camera housing and lens at the front
    var camBox = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 18).rotateZ(Math.PI / 2), pvcEdge); camBox.position.set(0.76, 0.04, 0); rov.add(camBox);
    var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16).rotateZ(Math.PI / 2), glow(new THREE.MeshBasicMaterial({ color: 0x4fa3d9 }), 0.7)); lens.position.set(0.825, 0.04, 0); rov.add(lens);
    var lamp = new THREE.PointLight(0xdff2ff, 4, 10, 1.4); lamp.position.set(1.3, 0.06, 0); rov.add(lamp);
    var lampGlow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glow(new THREE.MeshBasicMaterial({ color: 0xdff2ff }), 1.2)); lampGlow.position.set(0.8, 0.1, 0.07); rov.add(lampGlow);
    // Thrusters: small motor pod with an open, bright green 3-blade propeller
    var motorM = mat(0xdedcd5, { rough: 0.45, metal: 0.1 }), propM = mat(0x5cc93c, { rough: 0.45, metal: 0, side: THREE.DoubleSide });
    var bladeG = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14, 1, false, 0, 0.9); bladeG.translate(0, 0, 0);
    function thruster(x, y, z, axis) {
      var g = new THREE.Group(); g.position.set(x, y, z); rov.add(g);
      if (axis === 'x') g.rotation.z = Math.PI / 2; // horizontal: spin axis along the hull
      if (axis === 'up') g.rotation.z = Math.PI; // vertical, propeller above the motor
      var pod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.12, 14), motorM); pod.position.y = 0.04; g.add(pod);
      var hub = new THREE.Group(); hub.position.y = -0.04; g.add(hub);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 12), propM); cone.rotation.x = Math.PI; cone.position.y = -0.02; hub.add(cone);
      for (var k = 0; k < 3; k++) {
        var bl = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.06), propM);
        bl.geometry.translate(0.075, 0, 0); bl.rotation.y = k * Math.PI * 2 / 3; bl.rotation.x = 0.45; hub.add(bl);
      }
      return hub;
    }
    // Two horizontal thrusters at the rear corners; two vertical thrusters on the side stubs, propellers facing up
    var thL = thruster(-0.93, 0.02, 0.24, 'x'), thR = thruster(-0.93, 0.02, -0.24, 'x');
    var thF = thruster(0.02, 0.06, 0.52, 'up'), thB = thruster(0.02, 0.06, -0.52, 'up');
    var feed = new THREE.PerspectiveCamera(58, 4 / 3, 0.05, 40); feed.rotation.order = 'YXZ'; feed.rotation.y = -Math.PI / 2; feed.rotation.x = -0.28; feed.position.set(0.84, 0.04, 0); rov.add(feed);
    // Tether
    var anchor = new V3(-9, 12, -9), tetherM = mat(0x3d7fc4, { rough: 0.6, metal: 0 }), tether = null, tLen = 0;
    // State
    var bump = 0, s = { x: -3, y: 8.8, z: 2, h: -0.5, v: 0, vy: 0, w: 0, pitch: 0 }, inp = { fwd: 0, turn: 0, vert: 0, tilt: 0 };
    var keys = { w: ['fwd', 1], s: ['fwd', -1], a: ['turn', 1], d: ['turn', -1], r: ['vert', 1], f: ['vert', -1], t: ['tilt', 1], g: ['tilt', -1] }, down = {};
    var btnHeld = {};
    function recompute() {
      inp = { fwd: 0, turn: 0, vert: 0, tilt: 0 };
      Object.keys(down).forEach(function (k) { if (down[k]) inp[keys[k][0]] += keys[k][1]; });
      Object.keys(btnHeld).forEach(function (k) { if (btnHeld[k]) { var p = k.split(':'); inp[p[0]] += +p[1]; } });
      Object.keys(inp).forEach(function (k) { inp[k] = clamp(inp[k], -1, 1); });
      Array.prototype.forEach.call($('rv-pad').querySelectorAll('button[data-in]'), function (bt) {
        var k = bt.dataset.in + ':' + bt.dataset.v, kb = Object.keys(keys).filter(function (q) { return keys[q][0] === bt.dataset.in && String(keys[q][1]) === bt.dataset.v; })[0];
        bt.classList.toggle('held', !!btnHeld[k] || !!down[kb]);
        bt.setAttribute('aria-pressed', String(!!btnHeld[k]));
      });
    }
    Array.prototype.forEach.call($('rv-pad').querySelectorAll('button[data-in]'), function (bt) {
      var k = bt.dataset.in + ':' + bt.dataset.v;
      bt.setAttribute('aria-pressed', 'false');
      bt.addEventListener('click', function () {
        var on = !btnHeld[k];
        // Opposite directions on the same axis cancel, so switching one on switches its partner off
        btnHeld[bt.dataset.in + ':' + (-bt.dataset.v)] = false;
        btnHeld[k] = on; recompute();
      });
    });
    document.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (!keys[k] || !b.visible || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      e.preventDefault(); if (!down[k]) { down[k] = true; recompute(); }
    });
    document.addEventListener('keyup', function (e) { var k = e.key.toLowerCase(); if (down[k]) { down[k] = false; recompute(); } });
    window.addEventListener('blur', function () { down = {}; recompute(); });
    $('rv-stop').addEventListener('click', function () { btnHeld = {}; down = {}; recompute(); });
    // Inset + overlay
    var inset = $('rv-inset'), ov = $('rv-ov'), octx = ov.getContext('2d'), ir = { x: 0, y: 0, w: 0, h: 0 };
    b.onResize = function (W, H) {
      var w = Math.round(clamp(W * 0.36, 130, 270)), h = Math.round(w * 0.75);
      ir = { x: W - w - 12, y: 12, w: w, h: h };
      inset.style.width = w + 'px'; inset.style.height = h + 'px'; inset.style.right = '12px'; inset.style.bottom = '12px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2); ov.width = w * dpr; ov.height = h * dpr; octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    var seen = false, count = 0, tmp = new V3(), roAcc = 0;
    b.update = function (dt, t) {
      s.v += (inp.fwd * 1.6 - s.v * 1.2) * dt;
      s.w += (inp.turn * 1.4 - s.w * 2.5) * dt;
      s.vy += (inp.vert * 1.1 - s.vy * 1.4) * dt;
      s.pitch += (inp.tilt * 0.3 - s.pitch) * Math.min(1, dt * 2.5);
      s.h += s.w * dt;
      var fx = Math.cos(s.h), fz = -Math.sin(s.h);
      s.x = clamp(s.x + fx * s.v * dt * Math.cos(s.pitch), -10, 10); s.z = clamp(s.z + fz * s.v * dt * Math.cos(s.pitch), -10, 10);
      s.y = clamp(s.y + (s.vy + s.v * Math.sin(s.pitch)) * dt, 0.3, 11.5);
      // Collisions: the hull is three spheres along its length; rocks, the seabed and the person are solid
      bump -= dt;
      for (var it = 0; it < 2; it++) {
        for (var hs = -1; hs <= 1; hs++) {
          var cx = s.x + Math.cos(s.h) * hs * 0.6, cz = s.z - Math.sin(s.h) * hs * 0.6, cy = s.y + hs * 0.6 * Math.sin(s.pitch);
          for (var si = 0; si < solids.length; si++) {
            var o = solids[si], ddx = cx - o.x, ddy = cy - o.y, ddz = cz - o.z, dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz), mm = o.r + 0.36;
            if (dd < mm && dd > 1e-4) { var kk = (mm - dd) / dd; s.x += ddx * kk; s.y += ddy * kk; s.z += ddz * kk; cx += ddx * kk; cy += ddy * kk; cz += ddz * kk; s.v *= 0.9; bump = 0.6; }
          }
          var gy = ground(cx, cz) + 0.2;
          if (cy < gy) { s.y += gy - cy; if (s.vy < 0) s.vy = 0; bump = 0.6; }
        }
      }
      rov.position.set(s.x, s.y + Math.sin(t * 1.3) * 0.02, s.z); rov.rotation.set(0, s.h, s.pitch, 'YZX');
      var lp = inp.fwd - inp.turn * 0.8, rp = inp.fwd + inp.turn * 0.8, fv = inp.vert + inp.tilt, bv = inp.vert - inp.tilt;
      thL.rotation.y += lp * dt * 25; thR.rotation.y += rp * dt * 25; thF.rotation.y += fv * dt * 25; thB.rotation.y += bv * dt * 25;
      b.target.set(s.x, s.y, s.z); b.yawBase = s.h - Math.PI / 2;
      // Tether
      rov.updateMatrixWorld();
      var start = new V3(-0.86, 0.06, 0).applyMatrix4(rov.matrixWorld);
      var mid = start.clone().add(anchor).multiplyScalar(0.5); mid.y -= 2.5;
      var curve = new THREE.QuadraticBezierCurve3(start, mid, anchor);
      if (tether) { root.remove(tether); tether.geometry.dispose(); }
      tether = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.03, 6, false), tetherM); root.add(tether);
      tLen = curve.getLength();
      roAcc += dt;
      if (roAcc > 0.1) {
        roAcc = 0;
        $('rv-d').textContent = ((12 - s.y) / 12 * 30).toFixed(1);
        var hd = ((-s.h * 180 / Math.PI) % 360 + 360) % 360; $('rv-h').textContent = ('00' + Math.round(hd) % 360).slice(-3);
        $('rv-t').textContent = (tLen * 2.5).toFixed(1);
        var rc = $('rv-c'); rc.textContent = bump > 0 ? 'contact' : 'clear'; rc.style.color = bump > 0 ? '#ff8a80' : '';
      }
    };
    b.render = function () {
      var r = b.renderer;
      b.drawMain();
      if (!ir.w) return;
      r.setScissorTest(true); r.setScissor(ir.x, ir.y, ir.w, ir.h); r.setViewport(ir.x, ir.y, ir.w, ir.h);
      feed.aspect = ir.w / ir.h; feed.updateProjectionMatrix(); r.render(root, feed); r.setScissorTest(false);
      // Detection box
      octx.clearRect(0, 0, ir.w, ir.h);
      var minX = 1, minY = 1, maxX = -1, maxY = -1, front = true;
      for (var i = 0; i < 8; i++) {
        tmp.copy(corners[i]).applyMatrix4(feed.matrixWorldInverse); if (tmp.z > -0.1) { front = false; break; }
        tmp.copy(corners[i]).project(feed);
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x); minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      var fw = new V3(); feed.getWorldPosition(fw);
      var dist = fw.distanceTo(person.position);
      var vis = front && dist < 9 && maxX > -0.9 && minX < 0.9 && maxY > -0.9 && minY < 0.9 && (maxX - minX) > 0.06;
      if (vis) {
        var x0 = (clamp(minX, -1, 1) + 1) / 2 * ir.w, x1 = (clamp(maxX, -1, 1) + 1) / 2 * ir.w, y0 = (1 - clamp(maxY, -1, 1)) / 2 * ir.h, y1 = (1 - clamp(minY, -1, 1)) / 2 * ir.h;
        octx.strokeStyle = '#7CFC9A'; octx.lineWidth = 2; octx.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
        octx.fillStyle = '#7CFC9A'; octx.font = '600 10px "72 Mono", monospace';
        var lbl = 'HUMAN · HOG+Haar', ty = y0 - 6 < 24 ? y1 + 15 : y0 - 6; octx.fillText(lbl, clamp(x0 - 3, 2, ir.w - 110), ty);
        if (!seen) { seen = true; count++; $('rv-n').textContent = count; }
      } else if (seen && !vis) seen = false;
    };
    return b;
  });

  /* ================= 7. FLOOD RESCUE ================= */
  lazy($('st-res'), function () {
    var stage = $('st-res');
    var b = Bench(stage, { yaw: -0.3, pitch: 0.95, dist: 27, portrait: 1.45, minPitch: 0.3, target: new V3(-0.5, 0, 1), shadow: 18, lightDist: 34 });
    var root = b.scene;
    var water = new THREE.Mesh(new THREE.PlaneGeometry(34, 26, 34, 26).rotateX(-Math.PI / 2), mat(0x6d7f72, { rough: 0.22, metal: 0.35 }));
    root.add(water);
    var wp = water.geometry.attributes.position, wbase = new Float32Array(wp.count); for (var i = 0; i < wp.count; i++) wbase[i] = wp.getX(i) * 0.37 + wp.getZ(i) * 0.53;
    var obstacles = [];
    // Shelter island
    var SH = new V3(-11, 0, 5);
    var isl = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.7, 40), mat(0x7f9a6a, { rough: 0.95, metal: 0 })); isl.position.set(SH.x, 0.05, SH.z); root.add(isl);
    var shel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.6), mat(0xd8d4c8, { rough: 0.8, metal: 0 })); shel.position.set(SH.x - 0.5, 1.05, SH.z - 0.4); root.add(shel);
    var shRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.8), mat(0x0a6ed1)); shRoof.position.set(SH.x - 0.5, 1.76, SH.z - 0.4); root.add(shRoof);
    var shL = label('shelter', 'rgba(10,110,209,0.92)'); shL.position.set(SH.x - 0.5, 2.5, SH.z - 0.4); shL.scale.set(1.3, 0.52, 1); root.add(shL);
    obstacles.push({ x: SH.x, z: SH.z, r: 3.4 });
    // Village
    var housePos = [[-5, -6], [-2.5, -2.5], [-6, 1], [-1, 4], [1.5, -6.5], [3, -2], [2.5, 2.5], [5.5, 6], [6.5, -5], [8, -1], [9.5, 3.5], [11.5, -6.5], [12, 1], [-3.5, 7.5], [8, 8.5], [4.5, 9]];
    var wallM = mat(0xb9ab8c, { rough: 0.9, metal: 0 }), tinM = mat(0x9aa4ad, { metal: 0.3, rough: 0.55 }), rustM = mat(0x8a5a3c, { metal: 0.4, rough: 0.6 });
    var houses = [], pick = [];
    housePos.forEach(function (q, k) {
      var g = new THREE.Group(); g.position.set(q[0], 0, q[1]); g.rotation.y = (k * 0.7) % 1.2 - 0.6; root.add(g);
      var wall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8, 1.1), wallM); wall.position.y = 0.15; g.add(wall);
      var roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.85, 0.55, 4, 1).rotateY(Math.PI / 4), k % 3 ? tinM : rustM); roof.scale.set(1.25, 1, 0.9); roof.position.y = 0.82; g.add(roof);
      var bc = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), glow(new THREE.MeshBasicMaterial({ color: 0xff3b30 }))); bc.position.y = 1.35; bc.visible = false; g.add(bc);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 32).rotateX(Math.PI / 2), glow(new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true }), 0.8)); ring.position.y = 1.35; ring.visible = false; g.add(ring);
      var h = { g: g, k: k, beacon: bc, ring: ring, req: null, pos: new V3(q[0], 0, q[1]) };
      wall.userData.house = h; roof.userData.house = h; pick.push(wall, roof); houses.push(h);
      obstacles.push({ x: q[0], z: q[1], r: 0.95 });
    });
    var trunkM = mat(0x5b4636, { rough: 0.9, metal: 0 }), leafM = mat(0x4e6b3c, { rough: 0.9, metal: 0 });
    [[-8, -4], [-4, -8.5], [0, 0.5], [4.5, -8.5], [10.5, -3], [6, 0.5], [0.5, 8], [-7.5, -1], [13, 8], [11, 9.5], [-0.5, -4]].forEach(function (q, k) {
      var rr = 0.55 + (k % 3) * 0.12;
      var t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), trunkM); t.position.set(q[0], 0.4, q[1]); root.add(t);
      var c = new THREE.Mesh(new THREE.SphereGeometry(rr, 10, 8), leafM); c.position.set(q[0], 1.15, q[1]); root.add(c);
      obstacles.push({ x: q[0], z: q[1], r: rr * 0.8 });
    });

    // ---- Navigation: occupancy grid, distance fields and line-of-sight smoothing ----
    var CELL = 0.5, X0 = -16.5, Z0 = -12.5, NX = 67, NZ = 51, CLEAR = 0.7;
    var free = new Uint8Array(NX * NZ);
    function cx(i) { return X0 + i * CELL; } function cz(j) { return Z0 + j * CELL; }
    for (var gi = 0; gi < NX; gi++) for (var gj = 0; gj < NZ; gj++) {
      var ok = 1, x = cx(gi), z = cz(gj);
      for (var oi = 0; oi < obstacles.length; oi++) { var o = obstacles[oi]; if (Math.hypot(x - o.x, z - o.z) < o.r + CLEAR) { ok = 0; break; } }
      free[gi + gj * NX] = ok;
    }
    function cellOf(x, z) {
      var i = clamp(Math.round((x - X0) / CELL), 0, NX - 1), j = clamp(Math.round((z - Z0) / CELL), 0, NZ - 1), best = i + j * NX, bd = 1e9;
      if (free[best]) return best;
      for (var di = -3; di <= 3; di++) for (var dj = -3; dj <= 3; dj++) {
        var ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || !free[ii + jj * NX]) continue;
        var d = Math.hypot(cx(ii) - x, cz(jj) - z); if (d < bd) { bd = d; best = ii + jj * NX; }
      }
      return best;
    }
    var NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    function fieldTo(x, z) {
      var f = new Float64Array(NX * NZ).fill(Infinity), start = cellOf(x, z); f[start] = 0;
      // Dijkstra with a small binary heap
      var heap = [[0, start]];
      function push(it) { heap.push(it); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; var tmp = heap[p]; heap[p] = heap[c]; heap[c] = tmp; c = p; } }
      function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r2 = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === c) break; var tmp = heap[m]; heap[m] = heap[c]; heap[c] = tmp; c = m; } } return top; }
      while (heap.length) {
        var it = pop(), d = it[0], c = it[1]; if (d > f[c]) continue;
        var i = c % NX, j = (c - i) / NX;
        for (var k = 0; k < 8; k++) {
          var ii = i + NB[k][0], jj = j + NB[k][1]; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
          var n = ii + jj * NX; if (!free[n]) continue;
          if (NB[k][2] > 1 && (!free[i + jj * NX] || !free[ii + j * NX])) continue; // no corner cutting
          var nd = d + NB[k][2] * CELL; if (nd < f[n]) { f[n] = nd; push([nd, n]); }
        }
      }
      return f;
    }
    function clearLine(ax, az, bx, bz) {
      var dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i], t = clamp(((o.x - ax) * dx + (o.z - az) * dz) / L2, 0, 1), px = ax + dx * t - o.x, pz = az + dz * t - o.z;
        if (px * px + pz * pz < Math.pow(o.r + CLEAR - 0.08, 2)) return false;
      }
      return true;
    }
    // Stops: an approach point beside each house (on the shelter side when possible) and a dock per boat
    // Only accept approach points that connect to open water around the shelter
    var mainField = fieldTo(SH.x + 4.4, SH.z);
    function approachFor(h) {
      var base = Math.atan2(SH.z - h.pos.z, SH.x - h.pos.x);
      for (var dd = 0; dd < 3; dd++) for (var a = 0; a < 16; a++) {
        var ang = base + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * Math.PI / 8, d = 0.95 + CLEAR + 0.3 + dd * 0.4;
        var px = h.pos.x + Math.cos(ang) * d, pz = h.pos.z + Math.sin(ang) * d, c = Math.round((px - X0) / CELL) + Math.round((pz - Z0) / CELL) * NX;
        if (free[c] && isFinite(mainField[c])) return new V3(px, 0, pz);
      }
      return h.pos.clone().add(new V3(2, 0, 0));
    }
    houses.forEach(function (h) { h.stop = approachFor(h); h.field = fieldTo(h.stop.x, h.stop.z); });
    function travel(fromX, fromZ, field) { var c = cellOf(fromX, fromZ), i = c % NX, j = (c - i) / NX; return field[c] + Math.hypot(cx(i) - fromX, cz(j) - fromZ); }
    function pathTo(fx, fz, tx, tz, field) {
      var pts = [new V3(fx, 0, fz)], c = cellOf(fx, fz), goal = cellOf(tx, tz), guard = 0;
      while (c !== goal && guard++ < 600) {
        var i = c % NX, j = (c - i) / NX, best = c, bv = field[c];
        for (var k = 0; k < 8; k++) {
          var ii = i + NB[k][0], jj = j + NB[k][1]; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
          var n = ii + jj * NX; if (field[n] < bv) { bv = field[n]; best = n; }
        }
        if (best === c) break; c = best; i = c % NX; j = (c - i) / NX; pts.push(new V3(cx(i), 0, cz(j)));
      }
      pts.push(new V3(tx, 0, tz));
      // String-pulling: keep only the points needed to stay clear of houses, trees and the island
      var out = [pts[0]], a = 0;
      while (a < pts.length - 1) {
        var bI = pts.length - 1;
        while (bI > a + 1 && !clearLine(pts[a].x, pts[a].z, pts[bI].x, pts[bI].z)) bI--;
        out.push(pts[bI]); a = bI;
      }
      return out;
    }

    // ---- Boats ----
    var CAP = 20, SPEED = 2.4, PICK_T = 1.2, DROP_T = 1.0, MAX_RIDE = 30, MAX_DELAY = 8;
    function tag(text, bg) {
      var c = document.createElement('canvas'); c.width = 320; c.height = 64; var g = c.getContext('2d');
      var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, toneMapped: false })); s.scale.set(1.9, 0.38, 1); s.renderOrder = 10;
      s.userData.set = function (txt) {
        if (s.userData.txt === txt) return; s.userData.txt = txt;
        g.clearRect(0, 0, 320, 64); g.fillStyle = bg; g.fillRect(8, 8, 304, 48);
        g.fillStyle = '#fff'; g.font = '500 28px "72 Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 160, 33); t.needsUpdate = true;
      };
      s.userData.set(text); return s;
    }
    var BC = ['#E9730C', '#0A6ED1', '#256F3A'], boats = [];
    BC.forEach(function (c, k) {
      var g = new THREE.Group(); root.add(g);
      var hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 0.5), mat(new THREE.Color(c).getHex(), { rough: 0.5, metal: 0.2 })); hull.position.y = 0.1; g.add(hull);
      var bow = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.25, 0.4, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4), hull.material); bow.scale.set(1, 1, 1.4); bow.position.set(0.78, 0.1, 0); g.add(bow);
      var eng = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.2), mat(0x23272e)); eng.position.set(-0.62, 0.3, 0); g.add(eng);
      var tg = tag('B' + (k + 1) + ' · 0/' + CAP, 'rgba(22,26,31,0.86)'); tg.position.set(0, 1.0, 0); g.add(tg);
      var dock = new V3(SH.x + 4.4, 0, SH.z - 1.6 + k * 1.6);
      g.position.copy(dock);
      var lineM = new THREE.LineDashedMaterial({ color: new THREE.Color(c).getHex(), dashSize: 0.3, gapSize: 0.2 });
      var route = new THREE.Line(new THREE.BufferGeometry(), lineM); route.visible = false; root.add(route);
      boats.push({ k: k, name: 'B' + (k + 1), col: c, g: g, tag: tg, dock: dock, dockField: fieldTo(dock.x, dock.z), state: 'home', wait: 0,
        stops: [], onboard: [], path: [], wpI: 0, route: route, trips: 0, addedT: -99 });
    });
    function seatsUsed(bt) { var n = bt.state === 'pickup' && bt.cur ? bt.cur.people : 0; bt.onboard.forEach(function (r) { n += r.people; }); bt.stops.forEach(function (s) { if (s.req) n += s.req.people; }); return n; }
    function onboardCount(bt) { var n = 0; bt.onboard.forEach(function (r) { n += r.people; }); return n; }
    function stopPoint(bt, s) { return s.req ? s.req.house.stop : bt.dock; }
    function stopField(bt, s) { return s.req ? s.req.house.field : bt.dockField; }
    // Arrival time at each stop for a proposed stop list
    function timeline(bt, stops) {
      var t = simT + (bt.state === 'pickup' || bt.state === 'unload' ? Math.max(0, bt.wait) : 0), px = bt.g.position.x, pz = bt.g.position.z, out = [];
      for (var i = 0; i < stops.length; i++) {
        t += travel(px, pz, stopField(bt, stops[i])) / SPEED; out.push(t);
        t += stops[i].req ? PICK_T : DROP_T; var p = stopPoint(bt, stops[i]); px = p.x; pz = p.z;
      }
      return out;
    }
    function routeCost(bt, stops) { var tl = timeline(bt, stops); return tl.length ? tl[tl.length - 1] - simT : 0; }
    // Try to add a request to a boat's trip; returns the best insertion or null
    function bestInsertion(bt, r) {
      if (CAP - seatsUsed(bt) < r.people) return null;
      var picks = bt.stops.filter(function (s) { return s.req; }), base = picks.concat([{ drop: true }]);
      var oldT = timeline(bt, base), oldCost = routeCost(bt, base), best = null;
      for (var i = 0; i <= picks.length; i++) {
        var cand = picks.slice(0, i).concat([{ req: r }], picks.slice(i), [{ drop: true }]);
        var tl = timeline(bt, cand), tDrop = tl[tl.length - 1], ok = true;
        bt.onboard.forEach(function (q) { if (tDrop - q.tPick > MAX_RIDE) ok = false; });
        for (var j = 0; j < cand.length - 1 && ok; j++) {
          if (tDrop - tl[j] > MAX_RIDE) ok = false;
          var q = cand[j].req; if (q !== r) { var oi = picks.indexOf(cand[j]); if (oi >= 0 && tl[j] - oldT[oi] > MAX_DELAY) ok = false; }
        }
        if (!ok) continue;
        var tPick = tl[i] - simT, score = (routeCost(bt, cand) - oldCost) + 0.6 * tPick;
        if (!best || score < best.score) best = { score: score, stops: cand, tPick: tPick, pos: i, before: i };
      }
      return best;
    }
    function assign() {
      var waiting = reqs.filter(function (r) { return r.status === 'waiting'; }).sort(function (a, c) { return a.t0 - c.t0; });
      waiting.forEach(function (r) {
        var pickB = null, pickI = null;
        boats.forEach(function (bt) { var ins = bestInsertion(bt, r); if (ins && (!pickI || ins.score < pickI.score)) { pickI = ins; pickB = bt; } });
        if (!pickB) return;
        var firstChanged = !pickB.stops.length || pickB.stops[0] !== pickI.stops[0];
        // keep the existing stop objects so references stay valid
        pickB.stops = pickI.stops.map(function (s) { return s.drop ? (pickB.stops.filter(function (x) { return x.drop; })[0] || s) : s; });
        r.status = 'assigned'; r.boat = pickB; pickB.addedT = simT; r.pooled = pickB.onboard.length + pickB.stops.filter(function (s) { return s.req && s.req !== r; }).length > 0;
        if (pickB.state === 'home') pickB.state = 'moving';
        if (firstChanged && pickB.state === 'moving') planLeg(pickB);
      });
    }
    function planLeg(bt) {
      if (!bt.stops.length) { bt.path = []; return; }
      var s = bt.stops[0], p = stopPoint(bt, s);
      bt.path = pathTo(bt.g.position.x, bt.g.position.z, p.x, p.z, stopField(bt, s)); bt.wpI = 1;
    }
    function routePoints(bt) {
      var pts = [new V3(bt.g.position.x, 0.15, bt.g.position.z)];
      for (var i = bt.wpI; i < bt.path.length; i++) pts.push(new V3(bt.path[i].x, 0.15, bt.path[i].z));
      var prev = bt.stops.length ? stopPoint(bt, bt.stops[0]) : null;
      for (var k2 = 1; k2 < bt.stops.length; k2++) {
        var s = bt.stops[k2], p = stopPoint(bt, s), seg = pathTo(prev.x, prev.z, p.x, p.z, stopField(bt, s));
        for (var m = 1; m < seg.length; m++) pts.push(new V3(seg[m].x, 0.15, seg[m].z));
        prev = p;
      }
      return pts;
    }

    // ---- Requests ----
    var reqs = [], reqId = 0, saved = 0, waits = [], tripLoads = [], simT = 0, auto = !REDUCE, autoT = 3, lastReq = null, selBoat = 0;
    function sos(h) {
      if (!h || h.req) return;
      var r = { id: ++reqId, house: h, people: 2 + Math.floor(Math.random() * 8), t0: simT, status: 'waiting', boat: null, tPick: 0 };
      h.req = r; h.beacon.visible = true; h.ring.visible = true; reqs.push(r); lastReq = r; assign();
    }
    $('rs-sos').addEventListener('click', function () {
      var fr = houses.filter(function (h) { return !h.req; }); if (fr.length) sos(fr[Math.floor(Math.random() * fr.length)]);
    });
    $('rs-auto').addEventListener('click', function () { auto = !auto; this.setAttribute('aria-pressed', String(auto)); this.textContent = 'Automatic SOS: ' + (auto ? 'on' : 'off'); });
    if (REDUCE) { $('rs-auto').setAttribute('aria-pressed', 'false'); $('rs-auto').textContent = 'Automatic SOS: off'; }
    // Tap a house
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), downAt = null;
    stage.addEventListener('pointerdown', function (e) { downAt = { x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', function (e) {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { downAt = null; return; }
      downAt = null;
      var rc = b.renderer.domElement.getBoundingClientRect();
      ndc.set((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, b.camera);
      var hit = ray.intersectObjects(pick, false)[0];
      if (hit) sos(hit.object.userData.house);
    });
    // Phones
    var chips = $('rs-boats');
    boats.forEach(function (bt, k) {
      var c = document.createElement('button'); c.type = 'button'; c.className = 'bchip'; c.setAttribute('aria-pressed', String(k === 0));
      c.innerHTML = '<span class="dot" style="background:' + bt.col + '"></span>' + bt.name;
      c.addEventListener('click', function () { selBoat = k; Array.prototype.forEach.call(chips.children, function (x, j) { x.setAttribute('aria-pressed', String(j === k)); }); renderPhones(); });
      chips.appendChild(c);
    });
    var STEPS = ['SOS sent', 'Boat assigned', 'Picked up', 'Safe at shelter'];
    function mins(t) { return Math.max(1, Math.round(t)) + ' min'; }
    function renderPhones() {
      var v = $('rs-vic'), r = lastReq;
      if (!r) v.innerHTML = '<p class="ph-big">Tap a house</p><p class="ph-sub">to send an SOS from its roof.</p>';
      else {
        var si = { waiting: 0, assigned: 1, picked: 2, safe: 3 }[r.status], big, sub;
        if (r.status === 'waiting') {
          var pos = reqs.filter(function (q) { return q.status === 'waiting' && q.t0 <= r.t0; }).length;
          big = 'Finding a boat…'; sub = 'All boats are full or busy. You are <b>#' + pos + '</b> in the queue.';
        } else if (r.status === 'assigned') {
          var bt = r.boat, idx = bt.stops.findIndex(function (s) { return s.req === r; }), tl = timeline(bt, bt.stops), before = bt.stops.slice(0, idx).filter(function (s) { return s.req; }).length;
          big = bt.name + ' is coming'; sub = 'ETA <b>' + mins(tl[idx] - simT) + '</b>' + (before ? ' · collecting <b>' + before + '</b> other ' + (before > 1 ? 'families' : 'family') + ' first' : '');
        } else if (r.status === 'picked') {
          var b2 = r.boat, tl2 = timeline(b2, b2.stops);
          big = 'On board ' + b2.name; sub = '<b>' + onboardCount(b2) + '/' + CAP + '</b> seats taken · shelter in <b>' + mins(tl2[tl2.length - 1] - simT) + '</b>';
        } else { big = 'Safe at the shelter'; sub = 'Waited <b>' + mins(r.tPick - r.t0) + '</b> for pickup'; }
        v.innerHTML = '<p class="ph-sub">House ' + (r.house.k + 1) + ' · <b>' + r.people + '</b> people</p><p class="ph-big">' + big + '</p><p class="ph-sub">' + sub + '</p><ol class="steps">' +
          STEPS.map(function (s, j) { return '<li class="' + (j < si || (si === 3 && j === 3) ? 'done' : j === si ? 'now' : '') + '">' + s + '</li>'; }).join('') + '</ol>';
      }
      var bt3 = boats[selBoat], rr = $('rs-res'), used = seatsUsed(bt3), on = onboardCount(bt3);
      var head = '<p class="ph-sub">Seats <b>' + used + '/' + CAP + '</b> · ' + on + ' on board, ' + (used - on) + ' booked</p>';
      if (!bt3.stops.length) rr.innerHTML = head + '<p class="ph-big">' + (bt3.state === 'unload' ? 'Unloading' : 'Ready') + '</p><p class="ph-sub">' + (bt3.state === 'unload' ? 'At the shelter.' : 'Docked at the shelter, waiting for the next SOS.') + '</p>';
      else {
        var tl3 = timeline(bt3, bt3.stops), s0 = bt3.stops[0];
        var big3 = bt3.state === 'pickup' ? 'Picking up' : bt3.state === 'unload' ? 'Unloading' : s0.req ? 'Go to House ' + (s0.req.house.k + 1) : 'Return to shelter';
        rr.innerHTML = head + '<p class="ph-big">' + big3 + '</p>' + (simT - bt3.addedT < 3 ? '<p class="ph-sub"><b>New stop added to your trip</b></p>' : '') +
          '<ol class="steps">' + bt3.stops.map(function (s, j) { return '<li class="' + (j === 0 ? 'now' : '') + '">' + (s.req ? 'House ' + (s.req.house.k + 1) + ' · ' + s.req.people + ' people' : 'Shelter') + ' · ' + mins(tl3[j] - simT) + '</li>'; }).join('') + '</ol>';
      }
    }
    var phAcc = 0, lineAcc = 0;
    b.update = function (dt, t) {
      var sdt = REDUCE ? dt * 0.6 : dt; simT += sdt;
      for (var i = 0; i < wp.count; i++) wp.setY(i, Math.sin(t * 0.8 + wbase[i]) * 0.04);
      wp.needsUpdate = true;
      if (auto) { autoT -= sdt; if (autoT <= 0) { autoT = 2.5 + Math.random() * 2.5; $('rs-sos').click(); } }
      houses.forEach(function (h) { if (h.ring.visible) { var s = 1 + ((t * 0.8) % 1) * 1.4; h.ring.scale.set(s, 1, s); h.ring.material.opacity = 1 - ((t * 0.8) % 1); } });
      boats.forEach(function (bt) {
        var p = bt.g.position;
        if (bt.state === 'moving') {
          if (!bt.stops.length) { bt.state = 'home'; }
          else {
            if (!bt.path.length) planLeg(bt);
            var w = bt.path[bt.wpI] || stopPoint(bt, bt.stops[0]);
            var dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz), step = SPEED * sdt;
            if (d <= step) {
              p.x = w.x; p.z = w.z; bt.wpI++;
              if (bt.wpI >= bt.path.length) {
                var s = bt.stops.shift(); bt.path = [];
                if (s.req) { bt.state = 'pickup'; bt.wait = PICK_T; bt.cur = s.req; }
                else { bt.state = 'unload'; bt.wait = DROP_T; }
              }
            } else {
              p.x += dx / d * step; p.z += dz / d * step;
              var want = Math.atan2(-dz, dx), cur = bt.g.rotation.y, df = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
              bt.g.rotation.y = cur + df * Math.min(1, sdt * 6);
            }
          }
        } else if (bt.state === 'pickup') {
          bt.wait -= sdt;
          if (bt.wait <= 0) {
            var r = bt.cur; r.status = 'picked'; r.tPick = simT; waits.push(simT - r.t0); r.house.beacon.visible = false; r.house.ring.visible = false; bt.onboard.push(r);
            if (!bt.stops.some(function (x) { return x.drop; })) bt.stops.push({ drop: true });
            bt.state = 'moving'; planLeg(bt); assign();
          }
        } else if (bt.state === 'unload') {
          bt.wait -= sdt;
          if (bt.wait <= 0) {
            var load = onboardCount(bt);
            if (load) { tripLoads.push(load); bt.trips++; }
            bt.onboard.forEach(function (q) { q.status = 'safe'; saved += q.people; q.house.req = null; reqs.splice(reqs.indexOf(q), 1); });
            bt.onboard = [];
            bt.state = bt.stops.length ? 'moving' : 'home'; if (bt.state === 'moving') planLeg(bt);
            assign();
          }
        }
        p.y = Math.sin(t * 2 + bt.k) * 0.04;
        bt.tag.userData.set(bt.name + ' · ' + onboardCount(bt) + '/' + CAP);
      });
      lineAcc += dt;
      if (lineAcc > 0.15) {
        lineAcc = 0;
        boats.forEach(function (bt) {
          var act = bt.stops.length > 0;
          bt.route.visible = act;
          if (act) { var old = bt.route.geometry; bt.route.geometry = new THREE.BufferGeometry().setFromPoints(routePoints(bt)); bt.route.computeLineDistances(); old.dispose(); }
        });
      }
      phAcc += dt;
      if (phAcc > 0.25) {
        phAcc = 0; renderPhones();
        $('rs-wait').textContent = reqs.filter(function (q) { return q.status === 'waiting'; }).length;
        $('rs-way').textContent = reqs.filter(function (q) { return q.status === 'assigned'; }).length;
        $('rs-saved').textContent = saved;
        $('rs-avg').textContent = waits.length ? (waits.reduce(function (a, c) { return a + c; }, 0) / waits.length).toFixed(1) + ' min' : '—';
        $('rs-trip').textContent = tripLoads.length ? (tripLoads.reduce(function (a, c) { return a + c; }, 0) / tripLoads.length).toFixed(1) : '—';
      }
    };
    [6, 9, 3, 12].forEach(function (k) { sos(houses[k]); });
    renderPhones();
    return b;
  });
})();
