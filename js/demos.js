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

  /* ================= 6. ACCIDENT RISK ================= */
  lazy($('st-acc'), function () {
    var stage = $('st-acc');
    var b = Bench(stage, { yaw: 0.65, pitch: 0.82, dist: 23, portrait: 1.45, minPitch: 0.25, shadow: 15, lightDist: 30 });
    var root = b.scene, R = 12.5;
    var grass = new THREE.Mesh(new THREE.BoxGeometry(27, 0.1, 27), mat(0x8e9a8a, { rough: 0.95, metal: 0 })); grass.position.y = -0.06; root.add(grass);
    var asphalt = mat(0x454b52, { rough: 0.9, metal: 0 });
    var r1 = new THREE.Mesh(new THREE.BoxGeometry(27, 0.02, 2.6), asphalt); r1.position.y = 0.0; root.add(r1);
    var r2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.021, 27), asphalt); root.add(r2);
    var paint = new THREE.MeshBasicMaterial({ color: 0xe8e6df }), dashG = new THREE.BoxGeometry(0.7, 0.03, 0.07), zebG = new THREE.BoxGeometry(0.55, 0.03, 0.2);
    var i, j;
    for (i = -12; i <= 12; i += 1.6) {
      if (Math.abs(i) < 4.5) continue;
      var d1 = new THREE.Mesh(dashG, paint); d1.position.set(i, 0.012, 0); root.add(d1);
      var d2 = new THREE.Mesh(dashG, paint); d2.rotation.y = Math.PI / 2; d2.position.set(0, 0.012, i); root.add(d2);
    }
    [-3.6, 3.6].forEach(function (c) {
      for (j = -1.1; j <= 1.15; j += 0.37) {
        var z1 = new THREE.Mesh(zebG, paint); z1.position.set(c, 0.013, j); root.add(z1);
        var z2 = new THREE.Mesh(zebG, paint); z2.rotation.y = Math.PI / 2; z2.position.set(j, 0.013, c); root.add(z2);
      }
    });
    var bldM = [mat(0xc9c3b6, { rough: 0.85, metal: 0 }), mat(0xb5b9bd, { rough: 0.85, metal: 0 }), mat(0xd3c2a8, { rough: 0.85, metal: 0 })];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q, k) {
      for (var n = 0; n < 3; n++) {
        var h = 1.2 + ((k * 3 + n) * 37 % 10) / 4, w = 2.2 + (n % 2) * 0.8;
        var bd = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.2), bldM[(k + n) % 3]);
        bd.position.set(q[0] * (5.6 + n * 2.8), h / 2, q[1] * (4.6 + (n % 2) * 2.4)); root.add(bd);
      }
    });
    // Lanes (left-hand traffic)
    var lanes = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(function (q) {
      var d = new V3(q[0], 0, q[1]), left = new V3(d.z, 0, -d.x);
      return { d: d, left: left, axis: q[0] ? 'EW' : 'NS', cars: [], spawnT: Math.random() * 2 };
    });
    // Signals
    var lampG = new THREE.SphereGeometry(0.16, 12, 8), poleM = mat(0x3a3f46);
    lanes.forEach(function (L) {
      var p = L.d.clone().multiplyScalar(-2.5).add(L.left.clone().multiplyScalar(1.65));
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), poleM); pole.position.set(p.x, 0.85, p.z); root.add(pole);
      L.lampM = new THREE.MeshBasicMaterial({ color: 0x2e7d4f });
      var lamp = new THREE.Mesh(lampG, L.lampM); lamp.position.set(p.x, 1.8, p.z); root.add(lamp);
    });
    var CYC = 16;
    function light(axis, t) {
      var u = ((t % CYC) + CYC) % CYC; if (axis === 'NS') u = (u + 8) % CYC;
      return u < 6 ? 'g' : u < 7.5 ? 'y' : 'r';
    }
    // Objects
    var carCols = [0x0a6ed1, 0xd8d4c8, 0x8a2f2f, 0x3c3f45, 0x2e7d4f, 0xc49a3a], objId = 0, cars = [], peds = [];
    function makeCar() {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.32, 0.56), mat(carCols[Math.floor(Math.random() * carCols.length)], { metal: 0.5, rough: 0.35 })); body.position.y = 0.27; g.add(body);
      var cab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.5), mat(0x1d2228, { metal: 0.3, rough: 0.2 })); cab.position.set(-0.06, 0.53, 0); g.add(cab);
      var bk = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow(new THREE.MeshBasicMaterial({ color: 0xff3b30 }))); bk.position.set(0, 0.72, 0); bk.visible = false; g.add(bk);
      g.userData.beacon = bk;
      return g;
    }
    function spawnCar(L) {
      var m = makeCar(); root.add(m);
      var c = { id: ++objId, kind: 'car', L: L, s: -R, v: 3, vmax: 3.4 + Math.random() * 1.1, mesh: m, r: 0.4, runner: false, hx: 0.55, hz: 0.3, hy: 0.7 };
      if (pendingRun && light(L.axis, simT) !== 'g') { c.runner = true; pendingRun = false; }
      L.cars.push(c); cars.push(c); return c;
    }
    function makePed(jay) {
      var g = new THREE.Group();
      var bodyM = mat(jay ? 0xe0782a : [0x5d6a78, 0x7a4b3a, 0x2f5446][Math.floor(Math.random() * 3)], { rough: 0.7, metal: 0 });
      var bd = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.55, 10), bodyM); bd.position.y = 0.55; g.add(bd);
      var lg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), mat(0x2b3036)); lg.position.y = 0.15; g.add(lg);
      var hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), mat(0xc69a7a, { rough: 0.8, metal: 0 })); hd.position.y = 0.93; g.add(hd);
      root.add(g); return g;
    }
    function spawnPed(from, to, speed, jay) {
      var p = { id: ++objId, kind: 'ped', pos: from.clone(), to: to.clone(), dir: to.clone().sub(from).normalize(), speed: speed, mesh: makePed(jay), r: 0.2, hx: 0.22, hz: 0.22, hy: 1.05 };
      p.mesh.position.copy(p.pos); p.mesh.rotation.y = Math.atan2(-p.dir.z, p.dir.x);
      peds.push(p); return p;
    }
    var simT = 0, paused = false, pendingRun = false, speedF = 1, pedT = 1.5;
    $('ac-speed').addEventListener('input', function () { speedF = this.value / 100; $('ac-speed-o').textContent = speedF.toFixed(2) + '×'; });
    $('ac-pause').addEventListener('click', function () { paused = !paused; this.setAttribute('aria-pressed', String(paused)); this.textContent = paused ? 'Resume' : 'Pause'; });
    $('ac-run').addEventListener('click', function () {
      var best = null;
      cars.forEach(function (c) { if (!c.runner && light(c.L.axis, simT) !== 'g' && c.s < -2.4 && c.s > -9 && (!best || c.s > best.s)) best = c; });
      if (best) best.runner = true; else pendingRun = true;
    });
    $('ac-jay').addEventListener('click', function () {
      var x = (Math.random() < 0.5 ? -1 : 1) * (5.5 + Math.random() * 3.5), sgn = Math.random() < 0.5 ? -1 : 1;
      spawnPed(new V3(x, 0, 2.2 * sgn), new V3(x, 0, -2.2 * sgn), 1.15, true);
    });
    function carPos(c, out) { return out.copy(c.L.d).multiplyScalar(c.s).addScaledVector(c.L.left, 0.62); }
    var tmpA = new V3(), tmpB = new V3(), rel = new V3();
    function stepSim(dt) {
      simT += dt;
      lanes.forEach(function (L) {
        L.spawnT -= dt;
        var last = L.cars.length ? Math.min.apply(null, L.cars.map(function (c) { return c.s; })) : 99;
        if (L.spawnT <= 0 && last > -R + 3 && L.cars.length < 4) { spawnCar(L); L.spawnT = 1.6 + Math.random() * 2.8; }
      });
      pedT -= dt;
      if (pedT <= 0) {
        pedT = 2.2 + Math.random() * 2.5;
        var cross = Math.random() < 0.5 ? 'EW' : 'NS';
        if (light(cross, simT) === 'r' || light(cross, simT + 1.5) === 'r') {
          var c0 = (Math.random() < 0.5 ? -1 : 1) * 3.6, sg = Math.random() < 0.5 ? -1 : 1;
          if (cross === 'EW') spawnPed(new V3(c0, 0, 2.2 * sg), new V3(c0, 0, -2.2 * sg), 0.85 + Math.random() * 0.25, false);
          else spawnPed(new V3(2.2 * sg, 0, c0), new V3(-2.2 * sg, 0, c0), 0.85 + Math.random() * 0.25, false);
        }
      }
      cars.forEach(function (c) {
        var target = c.vmax * speedF, L = c.L;
        if (!c.runner) {
          var lt = light(L.axis, simT), stopD = -2.6 - c.s;
          if (lt !== 'g' && c.s < -2.35 && stopD < 8 && (lt === 'r' || stopD > 1.4)) target = Math.min(target, Math.max(0, stopD * 1.3));
        }
        carPos(c, tmpA);
        L.cars.forEach(function (o) { if (o !== c && o.s > c.s) target = Math.min(target, Math.max(0, (o.s - c.s - 1.25) * 1.3)); });
        // Anything else in the lane ahead within sight distance
        function look(p, rr) {
          rel.copy(p).sub(tmpA); var ahead = rel.dot(L.d), lat = Math.abs(rel.dot(L.left));
          if (ahead > 0.2 && ahead < 3.2 && lat < 0.55 + rr) target = Math.min(target, Math.max(0, (ahead - 0.95) * 1.5));
        }
        peds.forEach(function (p) { look(p.pos, 0.15); });
        cars.forEach(function (o) { if (o.L !== L) look(carPos(o, tmpB), 0.3); });
        var dv = target - c.v; c.v += Math.max(-7 * dt, Math.min(2.6 * dt, dv));
        c.s += c.v * dt;
        carPos(c, tmpA); c.mesh.position.copy(tmpA); c.mesh.rotation.y = Math.atan2(-L.d.z, L.d.x);
        c.mesh.userData.beacon.visible = c.runner && (simT * 4 % 1) < 0.5;
        if (c.runner && c.s > 3) c.runner = false;
      });
      for (var k = cars.length - 1; k >= 0; k--) if (cars[k].s > R) { var cc = cars[k]; root.remove(cc.mesh); cc.L.cars.splice(cc.L.cars.indexOf(cc), 1); cars.splice(k, 1); }
      peds.forEach(function (p) { p.pos.addScaledVector(p.dir, p.speed * dt); p.mesh.position.copy(p.pos); p.mesh.position.y = Math.abs(Math.sin(simT * 9 + p.id)) * 0.03; });
      for (k = peds.length - 1; k >= 0; k--) if (peds[k].pos.distanceTo(peds[k].to) < 0.1 || peds[k].pos.clone().sub(peds[k].to).dot(peds[k].dir) > 0) { root.remove(peds[k].mesh); peds.splice(k, 1); }
      lanes.forEach(function (L) { var lt = light(L.axis, simT); boost(L.lampM.color.setHex(lt === 'g' ? 0x2fbf6a : lt === 'y' ? 0xf2b134 : 0xe2463a), 0.8); });
    }
    // Risk
    var pairs = [], alertOn = {}, alerts = 0;
    function velOf(o, out) { return o.kind === 'car' ? out.copy(o.L.d).multiplyScalar(o.v) : out.copy(o.dir).multiplyScalar(o.speed); }
    var pA = new V3(), pB = new V3(), vA = new V3(), vB = new V3(), dpv = new V3(), dvv = new V3();
    function computeRisk() {
      pairs = [];
      var objs = cars.concat(peds), mx = { V2V: 0, V2H: 0 };
      objs.forEach(function (o) { o.risk = 0; o.wp = o.kind === 'car' ? carPos(o, new V3()) : o.pos.clone(); });
      for (var a = 0; a < objs.length; a++) for (var c = a + 1; c < objs.length; c++) {
        var A = objs[a], B = objs[c]; if (A.kind === 'ped' && B.kind === 'ped') continue;
        dpv.copy(B.wp).sub(A.wp); var D = dpv.length(); if (D > 7) continue;
        velOf(A, vA); velOf(B, vB); dvv.copy(vB).sub(vA);
        // Closest point of approach: how near the two will get if both keep moving as they are
        var rs = A.r + B.r, gap = Math.max(0, D - rs), dv2 = dvv.lengthSq(), p = 0;
        if (dv2 > 0.04) {
          var tc = -dpv.dot(dvv) / dv2;
          if (tc > 0 && tc < 4) {
            var dmin = Math.sqrt(Math.max(0, D * D - Math.pow(dpv.dot(dvv), 2) / dv2));
            p = Math.exp(-Math.max(0, dmin - rs) / 0.3) / (1 + Math.exp((tc - 1.6) * 2.2));
          }
          p = Math.max(p, 0.6 * Math.exp(-gap / 0.45));
        }
        p = Math.min(0.99, p);
        var kind = A.kind === 'car' && B.kind === 'car' ? 'V2V' : 'V2H', key = A.id + '-' + B.id;
        mx[kind] = Math.max(mx[kind], p); A.risk = Math.max(A.risk, p); B.risk = Math.max(B.risk, p);
        if (p > 0.7 && !alertOn[key]) { alertOn[key] = true; alerts++; } else if (p < 0.4 && alertOn[key]) delete alertOn[key];
        if (p > 0.25) pairs.push({ A: A, B: B, p: p, kind: kind });
      }
      return mx;
    }
    // Risk lines in 3D
    var MAXL = 48, lpos = new Float32Array(MAXL * 6), lcol = new Float32Array(MAXL * 6);
    var lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3)); lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
    var lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })); lines.renderOrder = 5; root.add(lines);
    function riskCol(p) { return p > 0.7 ? [0.89, 0.27, 0.23] : p > 0.4 ? [0.95, 0.69, 0.2] : [0.2, 0.75, 0.45]; }
    function updLines() {
      var n = Math.min(MAXL, pairs.length);
      for (var k = 0; k < n; k++) {
        var P = pairs[k], col = riskCol(P.p);
        lpos.set([P.A.wp.x, 0.75, P.A.wp.z, P.B.wp.x, 0.75, P.B.wp.z], k * 6); lcol.set(col.concat(col), k * 6);
      }
      lgeo.setDrawRange(0, n * 2); lgeo.attributes.position.needsUpdate = true; lgeo.attributes.color.needsUpdate = true;
    }
    // CCTV
    var cctv = new THREE.PerspectiveCamera(48, 4 / 3, 0.1, 80); cctv.position.set(-6.5, 7.5, 7); cctv.lookAt(0.5, 0, -0.5); root.add(cctv);
    var camBox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.2), mat(0xd8d4c8)); camBox.position.copy(cctv.position); camBox.lookAt(0, 0, 0); root.add(camBox);
    var cpole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7.5, 8), poleM); cpole.position.set(-6.5, 3.7, 7); root.add(cpole);
    var inset = $('ac-inset'), ov = $('ac-ov'), octx = ov.getContext('2d'), ir = { x: 0, y: 0, w: 0, h: 0 };
    b.onResize = function (W) {
      var w = Math.round(clamp(W * 0.36, 140, 280)), h = Math.round(w * 0.75);
      ir = { x: W - w - 12, y: 12, w: w, h: h };
      inset.style.width = w + 'px'; inset.style.height = h + 'px'; inset.style.right = '12px'; inset.style.bottom = '12px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2); ov.width = w * dpr; ov.height = h * dpr; octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    var cv = new V3();
    function screenBox(o) {
      var minX = 2, minY = 2, maxX = -2, maxY = -2, ax = o.kind === 'car' ? o.L.d : X1, az = o.kind === 'car' ? o.L.left : Z1;
      for (var k = 0; k < 8; k++) {
        cv.copy(o.wp).addScaledVector(ax, (k & 1 ? 1 : -1) * o.hx).addScaledVector(az, (k & 2 ? 1 : -1) * o.hz); cv.y = k & 4 ? o.hy : 0;
        cv.project(cctv); minX = Math.min(minX, cv.x); maxX = Math.max(maxX, cv.x); minY = Math.min(minY, cv.y); maxY = Math.max(maxY, cv.y);
      }
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return null;
      return { x0: (minX + 1) / 2 * ir.w, x1: (maxX + 1) / 2 * ir.w, y0: (1 - maxY) / 2 * ir.h, y1: (1 - minY) / 2 * ir.h };
    }
    var X1 = new V3(1, 0, 0), Z1 = new V3(0, 0, 1);
    function drawOverlay() {
      octx.clearRect(0, 0, ir.w, ir.h); octx.lineWidth = 1.5; octx.font = '600 9px "72 Mono", monospace';
      var objs = cars.concat(peds);
      objs.forEach(function (o) {
        var bx = screenBox(o); o.sb = bx; if (!bx) return;
        var col = o.risk > 0.7 ? '#ff5a4e' : o.risk > 0.4 ? '#ffc04d' : o.kind === 'car' ? '#6fd3ff' : '#c9f27a';
        octx.strokeStyle = col; octx.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
        octx.fillStyle = col; octx.fillText((o.kind === 'car' ? 'car ' : 'person ') + o.id, bx.x0, bx.y0 - 3);
      });
      pairs.forEach(function (P) {
        if (P.p < 0.4 || !P.A.sb || !P.B.sb) return;
        var ax = (P.A.sb.x0 + P.A.sb.x1) / 2, ay = (P.A.sb.y0 + P.A.sb.y1) / 2, bx = (P.B.sb.x0 + P.B.sb.x1) / 2, by = (P.B.sb.y0 + P.B.sb.y1) / 2;
        var col = P.p > 0.7 ? '#ff5a4e' : '#ffc04d';
        octx.strokeStyle = col; octx.beginPath(); octx.moveTo(ax, ay); octx.lineTo(bx, by); octx.stroke();
        var t = P.kind + ' ' + Math.round(P.p * 100) + '%', mx = (ax + bx) / 2, my = (ay + by) / 2, tw = octx.measureText(t).width;
        octx.fillStyle = 'rgba(0,0,0,0.6)'; octx.fillRect(mx - tw / 2 - 3, my - 9, tw + 6, 12); octx.fillStyle = col; octx.fillText(t, mx - tw / 2, my);
      });
    }
    var roAcc = 0;
    b.update = function (dt) {
      if (!paused && !REDUCE) stepSim(dt);
      else if (!paused && REDUCE) stepSim(dt * 0.5);
      var mx = computeRisk(); updLines();
      roAcc += dt;
      if (roAcc > 0.1) {
        roAcc = 0;
        $('ac-v2v').textContent = Math.round(mx.V2V * 100) + '%'; $('ac-v2h').textContent = Math.round(mx.V2H * 100) + '%';
        $('ac-alerts').textContent = alerts;
        var lt = light('EW', simT); $('ac-sig').textContent = lt === 'g' ? 'green' : lt === 'y' ? 'amber' : 'red';
      }
    };
    b.render = function () {
      var r = b.renderer;
      b.drawMain();
      if (!ir.w) return;
      lines.visible = false;
      r.setScissorTest(true); r.setScissor(ir.x, ir.y, ir.w, ir.h); r.setViewport(ir.x, ir.y, ir.w, ir.h);
      cctv.aspect = ir.w / ir.h; cctv.updateProjectionMatrix(); r.render(root, cctv);
      r.setScissorTest(false); lines.visible = true;
      drawOverlay();
    };
    // Warm up so the junction is busy on first view
    for (var w = 0; w < 260; w++) stepSim(1 / 30);
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

  /* ================= 9. SOFT MAGNETIC MICROROBOT ================= */
  lazy($('st-mr'), function () {
    var stage = $('st-mr');
    // World units are millimetres.
    var curve = new THREE.CatmullRomCurve3([new V3(-15, 0, 3.5), new V3(-9, 0, 0.5), new V3(-3, 0.4, 2.2), new V3(3, 0, -0.5), new V3(8.5, -0.3, -3.2), new V3(15, 0, -1.8)]);
    var LEN = curve.getLength(), ST = LEN * 0.66, S0 = ST - 10, UP = new V3(0, 1, 0), XA = new V3(1, 0, 0);
    var b = Bench(stage, { yaw: 0.25, pitch: 0.95, dist: 30, portrait: 1.45, minPitch: 0.2, target: curve.getPointAt(0.55), shadow: 19, lightDist: 36, bloom: false });
    benchFloor(b, -3.4, 64, 2);
    var root = b.scene;
    function at(s) { return curve.getPointAt(clamp(s / LEN, 0, 1)); }
    function tan(s) { return curve.getTangentAt(clamp(s / LEN, 0, 1)); }
    function side(s) { return new V3().crossVectors(tan(s), UP).normalize(); }
    // Vessel
    var vessel = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 1.5, 28, false), mat(0xd9958d, { opacity: 0.22, rough: 0.6, metal: 0, side: THREE.DoubleSide }));
    root.add(vessel);
    var wallLine = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 1.52, 28, false), new THREE.MeshBasicMaterial({ color: 0xb46a62, wireframe: true, transparent: true, opacity: 0.035 }));
    root.add(wallLine);
    // Target band ±1 mm
    var bandCurve = new THREE.CatmullRomCurve3([at(ST - 1), at(ST), at(ST + 1)]);
    var band = new THREE.Mesh(new THREE.TubeGeometry(bandCurve, 12, 1.56, 28, false), new THREE.MeshBasicMaterial({ color: 0x2e9d5f, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    root.add(band);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.58, 0.05, 8, 48), glow(new THREE.MeshBasicMaterial({ color: 0x2e9d5f }), 0.7));
    ring.position.copy(at(ST)); ring.quaternion.setFromUnitVectors(new V3(0, 0, 1), tan(ST)); root.add(ring);
    var tl = label('target', 'rgba(46,125,79,0.92)'); tl.position.copy(at(ST)).add(new V3(0, 2.6, 0)); tl.scale.set(2.4, 0.96, 1); root.add(tl);
    // Coil array (8 coils, OctoMag-style) around the workspace
    var cu = mat(0xb8733a, { metal: 0.85, rough: 0.35 }), core = mat(0x6b747e, { metal: 0.7, rough: 0.4 }), ctr = curve.getPointAt(0.5);
    for (var k = 0; k < 8; k++) {
      var az = k / 8 * Math.PI * 2 + 0.7, el = k % 2 ? 0.18 : -0.32, Rr = 27;
      var g = new THREE.Group(); g.position.set(ctr.x + Math.cos(az) * Math.cos(el) * Rr, ctr.y + Math.sin(el) * Rr * 0.6, ctr.z + Math.sin(az) * Math.cos(el) * Rr * 0.75);
      g.add(new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.75, 12, 36), cu));
      var cc = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 20).rotateX(Math.PI / 2), core); g.add(cc);
      g.lookAt(ctr); root.add(g);
    }
    // Robot: chain of five soft units with gold radiopaque markers at the ends
    var robot = new THREE.Group(); root.add(robot);
    var gelM = mat(0x8fd0c4, { opacity: 0.8, rough: 0.25, metal: 0.05 }), feM = mat(0x2b3036, { rough: 0.6 }), auM = mat(0xd4a63a, { metal: 0.9, rough: 0.25 });
    var units = [];
    for (k = 0; k < 5; k++) {
      var u = new THREE.Group(); robot.add(u);
      u.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), gelM));
      for (var q = 0; q < 3; q++) { var dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), feM); dot.position.set(Math.cos(q * 2.1) * 0.1, Math.sin(q * 2.1) * 0.1, (q - 1) * 0.06); u.add(dot); }
      if (k === 0 || k === 4) { var au = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), auM); au.position.y = 0.0; u.add(au); }
      units.push(u);
    }
    // Payload (e.g. a drug dose) carried in the middle unit
    var payM = mat(0xe0782a, { rough: 0.4, metal: 0, emissive: 0x5a2a08 }), payload = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), payM); units[2].add(payload);
    var NP = 60, pPos = new Float32Array(NP * 3), pVel = [], pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    var pMat = new THREE.PointsMaterial({ color: 0xe0782a, size: 0.12, transparent: true, opacity: 0 }), cloud = new THREE.Points(pGeo, pMat); cloud.frustumCulled = false; root.add(cloud);
    var relT = -99, cloudAge = 99;
    function doRelease() {
      if (!S.payload) { pmsg.innerHTML = 'Release decoded, but there is <b>no payload left</b>. Start the challenge to reload it.'; return; }
      S.payload = false; payload.visible = false; relT = S.t; cloudAge = 0;
      var c = new V3(); payload.getWorldPosition(c);
      for (var q = 0; q < NP; q++) { pPos[q * 3] = c.x; pPos[q * 3 + 1] = c.y; pPos[q * 3 + 2] = c.z; pVel[q] = new V3(rnd(), rnd(), rnd()).multiplyScalar(0.35); }
      pGeo.attributes.position.needsUpdate = true;
      var dmm = Math.abs(S.s - ST);
      pmsg.innerHTML = task ? 'Payload <b>released</b>. The true position is shown again.' : 'Payload <b>released</b> ' + (dmm <= 1 ? '<b>on target</b>, ' : '') + dmm.toFixed(2) + ' mm from the target centre.';
      if (task) finishTask(false);
    }
    var halo = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.05, 40), new THREE.MeshBasicMaterial({ color: 0x0a6ed1, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
    root.add(halo);
    // Ghost: where the surgeon's display shows the robot
    var ghost = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), new THREE.MeshBasicMaterial({ color: 0xe0782a, transparent: true, opacity: 0.35, depthWrite: false }));
    ghost.scale.set(1.6, 0.6, 0.6); root.add(ghost);
    var gl2 = label('display', 'rgba(224,120,42,0.92)'); gl2.scale.set(2.2, 0.88, 1); root.add(gl2);
    var arrow = new THREE.ArrowHelper(UP, new V3(), 2.4, 0x0a6ed1, 0.6, 0.35); root.add(arrow);

    // ---- Simulation state ----
    var S = { s: S0 - 4, lat: 0, kappa: 0, spacing: 0.28, roll: 0, applied: 'hold', heading: 1, v: 0, t: 0, payload: true };
    var cfg = { speed: 1.2, fps: 15, tcmd: 410, xray: true };
    var TPROC = 0.05, THUM = 0.2, GAMMA = 0.85, SIGMA = 0.25, DRIFT = 0.05;
    var inflight = [], frames = [], shown = null, nextCap = 0, lossT = -1, task = null, attempts = [];
    function rnd() { var u1 = Math.random() || 1e-9, u2 = Math.random(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }
    function tloop() { return 1000 / cfg.fps + TPROC * 1000 + THUM * 1000 + cfg.tcmd; }
    // Budget bar
    function renderBudget() {
      var ti = 1000 / cfg.fps, T = tloop(), sc = 100 / 1000;
      $('mr-budget').innerHTML =
        '<span class="b-img" style="flex:0 0 ' + (ti * sc) + '%" title="Imaging">' + (ti * sc > 6 ? Math.round(ti) : '') + '</span>' +
        '<span class="b-proc" style="flex:0 0 ' + (50 * sc) + '%" title="Processing and display"></span>' +
        '<span class="b-hum" style="flex:0 0 ' + (200 * sc) + '%" title="Surgeon reaction">human 200</span>' +
        '<span class="b-cmd" style="flex:0 0 ' + (cfg.tcmd * sc) + '%" title="Command path">command ' + cfg.tcmd + '</span>';
      $('mr-bnote').innerHTML = 'Simulated delays: imaging <b>' + Math.round(ti) + '</b> + processing <b>50</b> + reaction <b>200</b> + command <b>' + cfg.tcmd + '</b> = <b>' + Math.round(T) + ' ms</b>. At <b>' + cfg.speed.toFixed(1) + ' mm/s</b> the robot moves <b>' + (cfg.speed * T / 1000).toFixed(2) + ' mm</b> in that time.';
      $('mr-tl').textContent = Math.round(T);
      drawPlot();
    }
    // Controls
    $('mr-speed').addEventListener('input', function () { cfg.speed = +this.value; $('mr-speed-o').textContent = cfg.speed.toFixed(1) + ' mm/s'; renderBudget(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fps]'), function (x) {
      x.addEventListener('click', function () { cfg.fps = +x.dataset.fps; document.querySelectorAll('[data-fps]').forEach(function (y) { y.setAttribute('aria-pressed', String(y === x)); }); renderBudget(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tc]'), function (x) {
      x.addEventListener('click', function () { cfg.tcmd = +x.dataset.tc; document.querySelectorAll('[data-tc]').forEach(function (y) { y.setAttribute('aria-pressed', String(y === x)); }); renderBudget(); });
    });
    $('mr-xray').addEventListener('click', function () {
      cfg.xray = !cfg.xray; this.setAttribute('aria-pressed', String(!cfg.xray)); this.textContent = cfg.xray ? 'Interrupt X-ray' : 'Restore X-ray';
      if (cfg.xray) { lossT = -1; nextCap = S.t; } else lossT = 0;
    });
    function setHeading(hd) { S.heading = hd; document.querySelectorAll('[data-hd]').forEach(function (y) { y.setAttribute('aria-pressed', String(+y.dataset.hd === hd)); }); }
    document.querySelectorAll('[data-hd]').forEach(function (x) { x.addEventListener('click', function () { setHeading(+x.dataset.hd); }); });
    var pmsg = $('mr-pmsg');
    function gesture(g) {
      var conf = 0.9 + Math.random() * 0.09, cmd = g;
      if (!task && Math.random() < 0.06) { conf = 0.6 + Math.random() * 0.2; cmd = 'hold'; }
      var dec = cfg.tcmd === 410 ? 0.3 : 0.1, T = cfg.tcmd / 1000;
      inflight.push({ g: g, cmd: cmd, conf: conf, heading: S.heading, t0: S.t, tDec: S.t + dec, tCtl: S.t + dec + (T - dec) * 0.5, tAct: S.t + T, said: false });
      var bt = document.querySelector('.gb[data-g="' + g + '"]'); if (bt) { bt.classList.add('sent'); setTimeout(function () { bt.classList.remove('sent'); }, 300); }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.gb'), function (x) { x.addEventListener('click', function () { gesture(x.dataset.g); }); });
    var KEYS = { '1': 'steer', '2': 'hold', '3': 'release', ' ': 'hold' };
    document.addEventListener('keydown', function (e) {
      if (!b.visible || !KEYS[e.key] || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      e.preventDefault(); gesture(KEYS[e.key]);
    });
    // Delivery challenge: steer to the target, hold, release; scored on where the payload is released
    $('mr-task').addEventListener('click', function () {
      inflight = []; frames = []; shown = null; nextCap = S.t;
      S.s = S0; S.lat = 0; S.kappa = 0; S.v = 0; S.applied = 'hold'; S.payload = true; payload.visible = true; setHeading(1);
      if (!cfg.xray) $('mr-xray').click();
      task = { phase: 'run', start: S.t, vmax: 0 };
      this.blur();
      $('mr-tres').className = 'tnote'; $('mr-tres').innerHTML = 'Challenge running. The true position is hidden: <b>Steer</b> (1) towards the target, <b>Hold</b> (2 or Space) on it, then <b>Release</b> (3).';
      this.textContent = 'Try again';
    });
    function finishTask(missed) {
      var err = S.s - ST, ok = !missed && Math.abs(err) <= 1, secs = Math.round(S.t - task.start);
      if (!missed) { attempts.push({ v: task.vmax || cfg.speed, os: err, ok: ok }); if (attempts.length > 40) attempts.shift(); }
      $('mr-tres').className = 'tnote ' + (ok ? 'good' : 'bad');
      $('mr-tres').textContent = missed ? 'Missed: the robot went well past the target before any release. Try a slower steer speed.' :
        (ok ? 'On target: ' : 'Off target: ') + 'payload released ' + Math.abs(err).toFixed(2) + ' mm ' + (err >= 0 ? 'past' : 'short of') + ' the target centre, in ' + secs + ' s.';
      task = null; drawPlot();
    }
    // Plot of attempts
    var plot = $('mr-plot'), pctx = plot.getContext('2d');
    function drawPlot() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = plot.clientWidth, h = plot.clientHeight; if (!w) return;
      if (plot.width !== Math.round(w * dpr)) { plot.width = Math.round(w * dpr); plot.height = Math.round(h * dpr); }
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0); pctx.clearRect(0, 0, w, h);
      var L0 = 40, R0 = w - 10, T0 = 10, B0 = h - 30, X = function (v) { return L0 + v / 2.5 * (R0 - L0); }, Y = function (o) { return B0 - (o + 3) / 6 * (B0 - T0); };
      var cMuted = css('--muted'), cLine = css('--line'), cGood = css('--good'), cBad = css('--bad'), cFg = css('--fg');
      pctx.fillStyle = cGood; pctx.globalAlpha = 0.12; pctx.fillRect(L0, Y(1), R0 - L0, Y(-1) - Y(1)); pctx.globalAlpha = 1;
      pctx.font = '10px "72 Mono", monospace'; pctx.fillStyle = cMuted; pctx.strokeStyle = cLine; pctx.lineWidth = 1;
      pctx.textAlign = 'right'; pctx.textBaseline = 'middle';
      [-3, -2, -1, 0, 1, 2, 3].forEach(function (o) { pctx.beginPath(); pctx.moveTo(L0, Y(o)); pctx.lineTo(R0, Y(o)); pctx.stroke(); pctx.fillText((o > 0 ? '+' : '') + o, L0 - 5, Y(o)); });
      pctx.textAlign = 'center'; pctx.textBaseline = 'top';
      [0, 0.5, 1, 1.5, 2, 2.5].forEach(function (v) { pctx.fillText(v, X(v), B0 + 5); });
      pctx.fillText('steer speed (mm/s)', (L0 + R0) / 2, B0 + 17);
      pctx.save(); pctx.translate(10, (T0 + B0) / 2); pctx.rotate(-Math.PI / 2); pctx.fillText('release error (mm)', 0, -4); pctx.restore();
      attempts.forEach(function (a) {
        pctx.fillStyle = a.ok ? cGood : cBad; pctx.beginPath(); pctx.arc(X(a.v), Y(clamp(a.os, -3, 3)), 4, 0, 7); pctx.fill();
      });
      if (!attempts.length) { pctx.fillStyle = cMuted; pctx.textAlign = 'center'; pctx.textBaseline = 'middle'; pctx.fillText('Your attempts appear here', (L0 + R0) / 2, Y(2.2)); }
    }
    // Fluoroscopy display (2D canvas)
    var fl = $('mr-fl'), fctx = fl.getContext('2d'), inset = $('mr-inset'), noise = document.createElement('canvas'), nctx = noise.getContext('2d');
    noise.width = 96; noise.height = 60;
    var pts2 = curve.getSpacedPoints(160), bx0 = -16.5, bx1 = 16.5, bz0 = -5.5, bz1 = 6.5;
    b.onResize = function (W) {
      var w = Math.round(clamp(W * 0.4, 150, 300)), h = Math.round(w * 0.62);
      inset.style.width = w + 'px'; inset.style.height = h + 'px'; inset.style.right = '12px'; inset.style.bottom = '12px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2); fl.width = w * dpr; fl.height = h * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0); fl.dataset.w = w; fl.dataset.h = h;
    };
    var noiseAcc = 1;
    function drawFluoro(dt) {
      var w = +fl.dataset.w, h = +fl.dataset.h; if (!w) return;
      var sc = Math.min(w / (bx1 - bx0), h / (bz1 - bz0)), ox = (w - (bx1 - bx0) * sc) / 2, oz = (h - (bz1 - bz0) * sc) / 2;
      function P(v) { return [ox + (v.x - bx0) * sc, oz + (v.z - bz0) * sc]; }
      noiseAcc += dt;
      if (noiseAcc > 1 / cfg.fps && cfg.xray) {
        noiseAcc = 0; var id = nctx.createImageData(96, 60);
        for (var i = 0; i < id.data.length; i += 4) { var n = 170 + Math.random() * 55; id.data[i] = id.data[i + 1] = id.data[i + 2] = n; id.data[i + 3] = 255; }
        nctx.putImageData(id, 0, 0);
      }
      fctx.imageSmoothingEnabled = true; fctx.drawImage(noise, 0, 0, w, h);
      var grd = fctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)'); fctx.fillStyle = grd; fctx.fillRect(0, 0, w, h);
      fctx.lineCap = 'round'; fctx.lineJoin = 'round';
      fctx.strokeStyle = 'rgba(70,70,70,0.25)'; fctx.lineWidth = 3 * sc; fctx.beginPath();
      pts2.forEach(function (v, j) { var p = P(v); if (j) fctx.lineTo(p[0], p[1]); else fctx.moveTo(p[0], p[1]); }); fctx.stroke();
      [-1, 0, 1].forEach(function (d) {
        var c = at(ST + d), n = side(ST + d), a = P(c.clone().addScaledVector(n, 1.7)), e = P(c.clone().addScaledVector(n, -1.7));
        fctx.strokeStyle = d ? 'rgba(30,110,60,0.6)' : 'rgba(30,110,60,0.95)'; fctx.lineWidth = d ? 1 : 2; fctx.setLineDash(d ? [3, 2] : []);
        fctx.beginPath(); fctx.moveTo(a[0], a[1]); fctx.lineTo(e[0], e[1]); fctx.stroke(); fctx.setLineDash([]);
      });
      if (shown) {
        [-0.56, 0.56].forEach(function (o) {
          var c = at(shown.s + o).addScaledVector(side(shown.s + o), shown.lat), p = P(c);
          fctx.fillStyle = 'rgba(15,15,15,0.9)'; fctx.beginPath(); fctx.arc(p[0], p[1], Math.max(2.2, 0.17 * sc), 0, 7); fctx.fill();
        });
        var mid = P(at(shown.s).addScaledVector(side(shown.s), shown.lat));
        fctx.strokeStyle = 'rgba(15,15,15,0.35)'; fctx.lineWidth = 0.4 * sc; fctx.beginPath();
        var a1 = P(at(shown.s - 0.56).addScaledVector(side(shown.s), shown.lat)), a2 = P(at(shown.s + 0.56).addScaledVector(side(shown.s), shown.lat));
        fctx.moveTo(a1[0], a1[1]); fctx.lineTo(a2[0], a2[1]); fctx.stroke();
      }
      fctx.font = '600 10px "72 Mono", monospace'; fctx.textAlign = 'right'; fctx.textBaseline = 'bottom';
      if (!cfg.xray) { fctx.fillStyle = '#c0261d'; fctx.fillText('FEEDBACK LOST', w - 6, h - 6); }
      else { fctx.fillStyle = 'rgba(20,20,20,0.85)'; fctx.fillText(cfg.fps + ' fps · image age ' + (shown ? Math.round((S.t - shown.tc) * 1000) : 0) + ' ms', w - 6, h - 6); }
    }
    // Field magnitudes per applied command (illustrative, within the 40 mT cap)
    var FIELD_ON = { steer: 1, hold: 1, release: 1 };
    var tmp = new V3(), qd = new THREE.Quaternion(), pAcc = 0;
    b.update = function (dt) {
      S.t += dt;
      // Command path
      for (var i = 0; i < inflight.length; i++) {
        var c = inflight[i];
        if (!c.said && S.t >= c.tDec) {
          c.said = true;
          pmsg.innerHTML = c.cmd === c.g ? 'Decoded <b>' + c.g + '</b> (' + Math.round(c.conf * 100) + '% sure)' : 'The decoder wasn\'t sure this was <b>' + c.g + '</b> (' + Math.round(c.conf * 100) + '% sure), so it sends <b>hold</b> instead to stay safe.';
        }
      }
      while (inflight.length && S.t >= inflight[0].tAct) {
        var a = inflight.shift();
        S.applied = a.cmd; if (a.cmd === 'steer') S.heading = a.heading;
        if (a.cmd === 'release') doRelease();
      }
      var cur = inflight[0], ph = -1;
      if (cur) ph = S.t < cur.tDec - (cur.tDec - cur.t0) * 0.5 ? 0 : S.t < cur.tDec ? 1 : S.t < cur.tCtl ? 2 : 3;
      document.querySelectorAll('.pst').forEach(function (x) { x.classList.toggle('on', +x.dataset.p === ph); });
      if (!cur && pmsg.textContent.indexOf('No command') !== 0 && S.t - (S.lastMsg || 0) > 4) { pmsg.textContent = 'No command in flight'; }
      if (cur) S.lastMsg = S.t;
      // Safety supervisor: lost feedback → hold at once
      if (!cfg.xray) {
        var prev = lossT; lossT += dt;
        if (prev < 0.2 && lossT >= 0.2) { S.applied = 'hold'; inflight = []; pmsg.innerHTML = 'Imaging lost: the safety supervisor sets <b>hold</b> directly, without waiting for the surgeon.'; }
      }
      // Low-Reynolds dynamics: velocity follows the field almost instantly
      var target = S.applied === 'steer' ? cfg.speed * S.heading : 0;
      if (task && S.applied === 'steer') task.vmax = Math.max(task.vmax, cfg.speed);
      var drift = S.applied === 'hold' ? 0 : DRIFT;
      S.v += (target - S.v) * Math.min(1, dt / 0.06);
      S.s = clamp(S.s + (S.v + drift) * dt, 1.2, LEN - 1.2);
      S.lat += ((S.applied === 'hold' ? 1.22 : 0) - S.lat) * Math.min(1, dt * 4);
      // Release: the body briefly bends open to let the payload out, then relaxes
      var opening = S.t - relT < 1.2, kT = opening ? 2.6 : 0, spT = S.applied === 'steer' ? 0.31 : 0.28;
      S.kappa += (kT - S.kappa) * Math.min(1, dt * (opening ? 4 : 2));
      S.spacing += (spT - S.spacing) * Math.min(1, dt * 4);
      S.roll += (S.v + drift) * dt / 0.2;
      // Fluoroscopy frames: captured at the frame rate, shown after processing delay
      if (cfg.xray && S.t >= nextCap) { frames.push({ tc: S.t, s: S.s + rnd() * SIGMA, lat: S.lat + rnd() * SIGMA * 0.5 }); nextCap = S.t + 1 / cfg.fps; }
      while (frames.length && S.t >= frames[0].tc + TPROC) shown = frames.shift();
      if (!shown) shown = { tc: S.t, s: S.s, lat: S.lat };
      // Task bookkeeping
      if (task) {
        if (S.s > ST + 8) { S.applied = 'hold'; inflight = []; finishTask(true); }
      }
      // Payload cloud drifts with the flow and fades
      if (cloudAge < 6) {
        cloudAge += dt; var fl = tan(S.s);
        for (var q = 0; q < NP; q++) { pPos[q * 3] += (pVel[q].x + fl.x * 0.25) * dt; pPos[q * 3 + 1] += pVel[q].y * dt; pPos[q * 3 + 2] += (pVel[q].z + fl.z * 0.25) * dt; pVel[q].multiplyScalar(1 - dt * 0.8); }
        pGeo.attributes.position.needsUpdate = true; pMat.opacity = Math.max(0, 1 - cloudAge / 6);
      }
      // Pose the robot
      var hide = !!(task && task.phase !== 'done');
      var base = at(S.s).addScaledVector(side(S.s), S.lat), tg = tan(S.s);
      robot.position.copy(base); robot.quaternion.setFromUnitVectors(XA, tg);
      for (var k2 = 0; k2 < 5; k2++) {
        var uu = (k2 - 2) * S.spacing, x = uu, y = 0;
        if (Math.abs(S.kappa) > 1e-3) { x = Math.sin(S.kappa * uu) / S.kappa; y = (1 - Math.cos(S.kappa * uu)) / S.kappa; }
        units[k2].position.set(x, y, 0); units[k2].rotation.set(0, 0, -S.roll);
      }
      robot.visible = !hide; halo.visible = !hide;
      halo.position.copy(base); halo.quaternion.setFromUnitVectors(new V3(0, 0, 1), tg);
      var gp = at(shown.s).addScaledVector(side(shown.s), shown.lat);
      ghost.position.copy(gp); ghost.quaternion.setFromUnitVectors(XA, tan(shown.s)); gl2.position.copy(gp).add(new V3(0, 1.9, 0));
      // Field arrow
      arrow.visible = !!FIELD_ON[S.applied] && !hide;
      if (arrow.visible) {
        var dir;
        if (S.applied === 'steer') dir = tmp.copy(tg).multiplyScalar(Math.cos(S.roll)).addScaledVector(UP, Math.sin(S.roll)).normalize();
        else if (S.applied === 'hold') dir = tmp.copy(side(S.s));
        else dir = tmp.copy(UP);
        arrow.position.copy(base); arrow.setDirection(dir);
      }
      pAcc += dt;
      if (pAcc > 0.1) {
        pAcc = 0;
        $('mr-state').textContent = S.applied; $('mr-pay').textContent = S.payload ? 'loaded' : 'released'; $('mr-v').textContent = hide ? '—' : Math.abs(S.v + (S.applied === 'hold' ? 0 : DRIFT)).toFixed(2);
        $('mr-truth').textContent = hide ? 'true position hidden · watch the display' : 'orange = surgeon\'s display';
      }
      drawFluoro(dt);
    };
    renderBudget();
    new ResizeObserver(drawPlot).observe(plot);
    return b;
  });
})();
