/*
 * Anxiety Bookshelf
 * A glass-fronted wooden cabinet holding 200–260 miniature foam books.
 * Shake it to scramble the books, then open the door and sort them back.
 *
 * Physics runs in the cabinet's own frame of reference: the shelves never
 * move inside the simulation. When the cabinet is shaken we move it on
 * screen and feed the opposite of its acceleration into gravity, which is
 * exactly what the books inside would feel.
 */
(() => {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events, Query } = Matter;

  // ---------------------------------------------------------------- layout
  const W = 600;
  const H = 884;
  const DESK_Y = 860; // where spilled books come to rest, in front of the cabinet
  const CASE = { x: 50, y: 34, w: 500, h: 752 };
  const FRAME = 24;
  const BASE = 40;
  const BOARD = 12;
  const SHELVES = 5;
  const INNER = {
    l: CASE.x + FRAME,
    r: CASE.x + CASE.w - FRAME,
    t: CASE.y + FRAME,
    b: CASE.y + CASE.h - BASE,
  };
  const INNER_W = INNER.r - INNER.l;
  const COMP_H = (INNER.b - INNER.t - BOARD * (SHELVES - 1)) / SHELVES;
  const COMPS = Array.from({ length: SHELVES }, (_, i) => {
    const top = INNER.t + i * (COMP_H + BOARD);
    return { top, floor: top + COMP_H };
  });
  const KNOB = { x: INNER.r - 4, y: (INNER.t + INNER.b) / 2, r: 9 };

  // --------------------------------------------------------------- physics
  const STEP_MS = 1000 / 120;
  const GRAVITY_SCALE = 0.0025;
  const G_PX = GRAVITY_SCALE * 1e6; // px/s² for gravity = 1
  const SHAKE_GAIN = 0.2; // how strongly cabinet acceleration reaches the books
  const SPRING_K = 2000; // cabinet "hand" spring
  const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.22;
  const MAX_OFFSET = { x: 46, y: 30 };

  const CAT_WALL = 0x0001;
  const CAT_BOOK = 0x0002;
  const CAT_DESK = 0x0004;
  const CAT_OUT = 0x0008;
  const SHELF_FILTER = () => ({ group: 0, category: CAT_BOOK, mask: CAT_WALL | CAT_BOOK });
  const DESK_FILTER = () => ({ group: 0, category: CAT_OUT, mask: CAT_DESK | CAT_OUT });
  const SPILL_RATE = 0.0022; // per physics step, scaled by how hard the shake is

  const engineOpts = { positionIterations: 10, velocityIterations: 8, constraintIterations: 2, enableSleeping: false };
  // Books on the shelves live in the cabinet's (shaking) frame...
  const engine = Engine.create(engineOpts);
  engine.gravity.scale = GRAVITY_SCALE;
  const world = engine.world;
  // ...books that spill out land on the desk, which stays still.
  const deskEngine = Engine.create(engineOpts);
  deskEngine.gravity.scale = GRAVITY_SCALE;
  const deskWorld = deskEngine.world;
  {
    const opts = { isStatic: true, friction: 0.9, restitution: 0.08, collisionFilter: { category: CAT_DESK } };
    const desk = [
      Bodies.rectangle(W / 2, DESK_Y + 50, W * 3, 100, opts),
      Bodies.rectangle(-50, H / 2, 100, H * 3, opts),
      Bodies.rectangle(W + 50, H / 2, 100, H * 3, opts),
    ];
    desk.forEach((d) => { d.label = 'desk'; });
    Composite.add(deskWorld, desk);
  }

  function addWalls() {
    const opts = { isStatic: true, friction: 0.8, restitution: 0.05, collisionFilter: { category: CAT_WALL } };
    const thick = 100;
    const walls = [
      Bodies.rectangle(INNER.l - thick / 2, H / 2, thick, H * 2, opts),
      Bodies.rectangle(INNER.r + thick / 2, H / 2, thick, H * 2, opts),
      Bodies.rectangle(W / 2, INNER.t - thick / 2, W * 2, thick, opts),
    ];
    COMPS.forEach((c, i) => {
      const h = i === SHELVES - 1 ? thick : BOARD;
      walls.push(Bodies.rectangle(W / 2, c.floor + h / 2, W * 2, h, opts));
    });
    walls.forEach((w) => { w.label = 'wall'; });
    Composite.add(world, walls);
  }
  addWalls();

  // ---------------------------------------------------------------- books
  const PALETTE = [
    '#c8553d', '#e0a458', '#588b8b', '#2f4858', '#86bbd8', '#f6ae2d', '#33658a',
    '#9a031e', '#5f0f40', '#0b6e4f', '#c9a7e8', '#8ccfe8', '#a8d8b9', '#efe3a2',
    '#ff99c8', '#3d405b', '#81b29a', '#f2cc8f', '#e07a5f', '#264653', '#2a9d8f',
    '#e9c46a', '#f4a261', '#e76f51', '#6d597a', '#b56576', '#eaac8b', '#355070',
    '#f1ede4', '#4a4e69', '#a3b18a', '#d62828', '#277da1', '#f9844a', '#90be6d',
  ];
  const TRIMS = ['#e2c275', '#f5eddc', '#2b2321', '#c9a24a', '#ffffff'];

  let books = [];
  let rng = mulberry32(Date.now() & 0xffffffff);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  function hsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h, s, l };
  }

  // Every book is generated from its own seed, so a saved shelf only needs
  // the seed plus where the book is.
  function bookSpec(seed) {
    const r = mulberry32(seed);
    const rr = (a, b) => a + (b - a) * r();
    const pk = (arr) => arr[Math.floor(r() * arr.length)];
    const w = rr(5.5, 9);
    const tall = r();
    const h = tall < 0.15 ? rr(88, 102) : tall < 0.75 ? rr(66, 88) : rr(54, 66);
    const color = pk(PALETTE);
    const trim = pk(TRIMS.filter((t) => t !== color));
    const style = r();
    const bands = [];
    let label = null;
    if (style < 0.32) {
      const t = rr(0.05, 0.1);
      bands.push({ y: t, h: 0.035 }, { y: 1 - t - 0.035, h: 0.035 });
    } else if (style < 0.55) {
      bands.push({ y: rr(0.28, 0.45), h: rr(0.12, 0.22) });
    } else if (style < 0.75) {
      label = { y: rr(0.12, 0.2), h: rr(0.22, 0.32) };
    } else if (style < 0.9) {
      bands.push({ y: 0.06, h: 0.05 });
    }
    const look = { color, trim, bands, label, title: { y: rr(0.3, 0.42), len: rr(0.22, 0.4) }, dot: r() < 0.25 };
    return { w, h, look };
  }

  function makeBook(seed, x, y, angle, out) {
    const sp = bookSpec(seed);
    const body = Bodies.rectangle(x, y, sp.w, sp.h, {
      angle,
      friction: 0.55,
      frictionStatic: 0.9,
      frictionAir: 0.012,
      restitution: 0.04,
      density: 0.0015,
      slop: 0.03,
      collisionFilter: out ? DESK_FILTER() : SHELF_FILTER(),
    });
    body.label = 'book';
    const c = hsl(sp.look.color);
    body.book = { seed, w: sp.w, h: sp.h, look: sp.look, hue: c.h, sat: c.s, lig: c.l, lift: 0, out: !!out };
    Composite.add(out ? deskWorld : world, body);
    books.push(body);
    return body;
  }

  function clearBooks() {
    books.forEach((bd) => { Composite.remove(world, bd); Composite.remove(deskWorld, bd); });
    books = [];
    held = null;
    tweens.clear();
  }

  const newSeed = () => (Math.floor(rng() * 0xffffffff) >>> 0) || 1;

  function createBooks(count) {
    clearBooks();
    const perShelf = Array.from({ length: SHELVES }, (_, i) =>
      Math.floor(count / SHELVES) + (i < count % SHELVES ? 1 : 0));

    perShelf.forEach((n, s) => {
      const seeds = Array.from({ length: n }, newSeed);
      const specs = seeds.map(bookSpec);
      const sum = specs.reduce((a, b) => a + b.w, 0);
      const gap = Math.min(0.9, Math.max(0.2, (INNER_W - 6 - sum) / (n + 1)));
      let x = INNER.l + 2;
      specs.forEach((sp, i) => {
        makeBook(seeds[i], x + sp.w / 2, COMPS[s].floor - sp.h / 2 - 0.2, 0, false);
        x += sp.w + gap;
      });
    });
    total.textContent = books.length;
    everMessy = false;
    celebrated = true;
    saveState();
  }

  // ------------------------------------------------------------ save/load
  // About 35 bytes per book: [seed, onDesk, x, y, angle]. 260 books ≈ 9 KB.
  const STATE_VERSION = 1;

  function saveState() {
    if (!books.length) return;
    const r1 = (v) => Math.round(v * 10) / 10;
    const data = books.map((bd) => {
      const tw = tweens.get(bd);
      if (tw) return [bd.book.seed, 0, r1(tw.tx), r1(tw.ty), 0];
      const out = bd.book.out || (held && held.body === bd);
      return [bd.book.seed, out ? 1 : 0, r1(bd.position.x), r1(bd.position.y), Math.round(normAngle(bd.angle) * 1000) / 1000];
    });
    store.set('state', { v: STATE_VERSION, door: door.target > 0.5 ? 1 : 0, books: data });
  }

  function loadState() {
    const st = store.get('state', null);
    if (!st || st.v !== STATE_VERSION || !Array.isArray(st.books)) return false;
    if (st.books.length < 200 || st.books.length > 260) return false;
    clearBooks();
    try {
      for (const [seed, out, x, y, a] of st.books) {
        if (![seed, x, y, a].every(Number.isFinite)) throw new Error('bad book');
        makeBook(seed >>> 0, x, y, a, !!out);
      }
    } catch (e) {
      clearBooks();
      return false;
    }
    if (st.door) { door.target = 1; door.open = 1; btnDoor.textContent = 'Close door'; }
    total.textContent = books.length;
    everMessy = !books.every(isStanding);
    celebrated = !everMessy;
    return true;
  }

  // ---------------------------------------------------------- cabinet shake
  const shake = {
    off: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    acc: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    program: null, // scripted shake
  };
  const motion = { x: 0, y: 0 };

  function startShake(strength = 1) {
    shake.program = { t: 0, dur: 1150, amp: 15 * strength, seed: rng() * 10, fx: rand(4.6, 5.6), fy: rand(6.5, 7.5) };
    Sound.init();
  }

  function knock(dir, power = 1) {
    shake.vel.x += dir * 260 * power;
    shake.vel.y -= 60 * power;
    Sound.init();
    Sound.knock(0.6 * power);
    vibrate(12);
  }

  function stepShake(dtMs) {
    const dt = dtMs / 1000;
    let tx = shake.target.x;
    let ty = shake.target.y;
    const p = shake.program;
    if (p) {
      p.t += dtMs;
      const k = p.t / p.dur;
      if (k >= 1) {
        shake.program = null;
      } else {
        const env = Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k * 0.3);
        const s = p.t / 1000;
        tx += p.amp * env * Math.sin(2 * Math.PI * p.fx * s + p.seed);
        ty += p.amp * 0.45 * env * Math.sin(2 * Math.PI * p.fy * s + p.seed * 2);
      }
    }
    const ax = SPRING_K * (tx - shake.off.x) - SPRING_C * shake.vel.x;
    const ay = SPRING_K * (ty - shake.off.y) - SPRING_C * shake.vel.y;
    shake.vel.x += ax * dt;
    shake.vel.y += ay * dt;
    shake.off.x += shake.vel.x * dt;
    shake.off.y += shake.vel.y * dt;
    // keep the cabinet on the desk
    if (Math.abs(shake.off.x) > MAX_OFFSET.x) { shake.off.x = Math.sign(shake.off.x) * MAX_OFFSET.x; shake.vel.x *= -0.3; }
    if (Math.abs(shake.off.y) > MAX_OFFSET.y) { shake.off.y = Math.sign(shake.off.y) * MAX_OFFSET.y; shake.vel.y *= -0.3; }
    shake.acc.x = ax;
    shake.acc.y = ay;

    const gx = clamp(-SHAKE_GAIN * ax / G_PX + motion.x, -3.5, 3.5);
    const gy = clamp(1 - SHAKE_GAIN * ay / G_PX + motion.y, -1.2, 3.5);
    engine.gravity.x = gx;
    engine.gravity.y = gy;

    // a little chaos so identical books don't move in lockstep
    const jolt = Math.hypot(gx, gy - 1);
    if (jolt > 0.8) {
      for (let i = 0; i < books.length; i++) {
        if (rng() < 0.04) Body.setAngularVelocity(books[i], books[i].angularVelocity + rand(-0.02, 0.02) * jolt);
      }
      if (jolt > 1.5) everMessy = true;
    }
    if (jolt > 1.3 && isDoorOpen()) spill(jolt);
  }

  // With the door open, a hard shake tips books out onto the desk.
  // Books that are already leaning or lying down go first.
  function spill(jolt) {
    for (const bd of books) {
      if (bd.book.out || tweens.has(bd) || (held && held.body === bd)) continue;
      const a = Math.abs(normAngle(bd.angle));
      const tilt = Math.min(a, Math.PI - a);
      const p = SPILL_RATE * (jolt - 1.3) * (0.25 + Math.min(1, tilt / 0.9));
      if (rng() < p) fallOut(bd);
    }
  }

  function fallOut(bd) {
    const wp = caseToWorld(bd.position);
    Composite.remove(world, bd);
    bd.book.out = true;
    bd.collisionFilter = DESK_FILTER();
    Body.setPosition(bd, wp);
    Body.setAngle(bd, bd.angle + caseTilt());
    Body.setVelocity(bd, { x: bd.velocity.x * 0.5 + shake.vel.x * 0.004 + rand(-2.2, 2.2), y: rand(-3, -0.6) });
    Body.setAngularVelocity(bd, rand(-0.16, 0.16));
    Composite.add(deskWorld, bd);
    everMessy = true;
    if (!hinted.has('spill')) hintOnce('spill', 'Whoops, some books fell out. Pick them up off the desk.');
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ----------------------------------------------------------------- door
  const door = { open: 0, target: 0 };
  const isDoorOpen = () => door.open > 0.85;

  function setDoor(open) {
    door.target = open ? 1 : 0;
    btnDoor.textContent = open ? 'Close door' : 'Open door';
    Sound.init();
    Sound.door(open);
    if (open) toast('Door open. Pick up a book and drop it where it belongs.');
  }

  // --------------------------------------------------------- holding books
  // While held, a book belongs to neither physics world. Its position is in
  // screen-space (world) coordinates so it can be carried anywhere.
  let held = null; // { body, dx, dy, px, py }

  const shelfBooks = () => books.filter((bd) => !bd.book.out && !(held && held.body === bd));
  const deskBooks = () => books.filter((bd) => bd.book.out && !(held && held.body === bd));

  function bookAt(list, p) {
    const hits = Query.point(list, p);
    if (hits.length) return hits[hits.length - 1];
    // thin spines are fiddly on touch screens: search a little around the finger
    for (const d of [3, -3, 6, -6, 9, -9]) {
      const h = Query.point(list, { x: p.x + d, y: p.y });
      if (h.length) return h[h.length - 1];
    }
    return null;
  }

  function grab(body, w) {
    tweens.delete(body);
    body.book.lift = 0;
    if (body.book.out) {
      Composite.remove(deskWorld, body);
    } else {
      Composite.remove(world, body);
      Body.setPosition(body, caseToWorld(body.position));
      Body.setAngle(body, body.angle + caseTilt());
    }
    held = { body, dx: body.position.x - w.x, dy: body.position.y - w.y, px: w.x, py: w.y };
    Sound.pick();
  }

  function compAtY(y) {
    let best = 0, bestD = Infinity;
    COMPS.forEach((c, i) => {
      const d = y < c.top ? c.top - y : y > c.floor ? y - c.floor : 0;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function release() {
    if (!held) return;
    const body = held.body;
    const b = body.book;
    held = null;
    const cp = toCase(body.position);
    const overCabinet = cp.x > INNER.l - 8 && cp.x < INNER.r + 8 && cp.y > INNER.t - 8 && cp.y < INNER.b + 8;
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);

    if (overCabinet && isDoorOpen()) {
      // back onto a shelf, standing up, in the nearest gap
      const s = compAtY(cp.y);
      const x = clamp(cp.x, INNER.l + b.w / 2 + 0.5, INNER.r - b.w / 2 - 0.5);
      const y = COMPS[s].floor - b.h / 2 - 0.4;
      b.out = false;
      body.collisionFilter = SHELF_FILTER();
      Body.setAngle(body, 0);
      Body.setPosition(body, { x: findSlot(body, s, x), y });
      Composite.add(world, body);
      Sound.drop();
      vibrate(6);
    } else {
      // dropped outside (or the glass is shut): it falls to the desk
      if (overCabinet) hintOnce('closed-drop', 'Open the glass door to put books back on the shelves.');
      b.out = true;
      body.collisionFilter = DESK_FILTER();
      Body.setPosition(body, { x: clamp(body.position.x, 8, W - 8), y: Math.min(body.position.y, DESK_Y - b.h / 2 - 1) });
      Composite.add(deskWorld, body);
    }
  }

  // Look for the nearest x where this book fits between its neighbours.
  function findSlot(body, s, x) {
    const b = body.book;
    const c = COMPS[s];
    const spans = [];
    for (const o of books) {
      if (o === body || o.book.out) continue;
      const bb = o.bounds;
      if (bb.max.y < c.top || bb.min.y > c.floor) continue;
      // only things near the floor block a standing book
      if (bb.max.y < c.floor - b.h) continue;
      spans.push([bb.min.x, bb.max.x]);
    }
    const fits = (cx) => {
      const l = cx - b.w / 2, r = cx + b.w / 2;
      if (l < INNER.l || r > INNER.r) return false;
      for (const [a, z] of spans) if (r > a + 0.3 && l < z - 0.3) return false;
      return true;
    };
    if (fits(x)) return x;
    for (let d = 1; d < 70; d += 1) {
      if (fits(x - d)) return x - d;
      if (fits(x + d)) return x + d;
    }
    return x; // packed solid: let the physics shove neighbours aside
  }

  // ------------------------------------------------------------- auto-sort
  const tweens = new Map(); // body -> tween

  function currentShelfGroups(fromDesk) {
    const groups = COMPS.map(() => []);
    books.forEach((bd) => { if (!fromDesk.includes(bd)) groups[compAtY(bd.position.y)].push(bd); });
    groups.forEach((g) => g.sort((a, b) => a.position.x - b.position.x));
    // books rescued from the desk go onto whichever shelf has the most room
    const width = (g) => g.reduce((a, bd) => a + bd.book.w, 0);
    fromDesk.forEach((bd) => {
      let best = groups[0];
      groups.forEach((g) => { if (width(g) < width(best)) best = g; });
      best.push(bd);
    });
    return groups;
  }

  function evenGroups(list) {
    const groups = COMPS.map(() => []);
    const per = list.length / SHELVES;
    list.forEach((bd, i) => groups[Math.min(SHELVES - 1, Math.floor(i / per))].push(bd));
    return groups;
  }

  function rebalance(groups) {
    const cap = INNER_W - 4;
    const width = (g) => g.reduce((a, bd) => a + bd.book.w + 0.4, 0);
    for (let i = 0; i < SHELVES - 1; i++) {
      while (width(groups[i]) > cap) groups[i + 1].unshift(groups[i].pop());
    }
    for (let i = SHELVES - 1; i > 0; i--) {
      while (width(groups[i]) > cap) groups[i - 1].push(groups[i].shift());
    }
    return groups;
  }

  function autoSort(mode) {
    if (held) release();
    // pull everything off the desk back into the cabinet's frame first
    const fromDesk = books.filter((bd) => bd.book.out);
    fromDesk.forEach((bd) => {
      Composite.remove(deskWorld, bd);
      bd.book.out = false;
      bd.collisionFilter = SHELF_FILTER();
      Body.setPosition(bd, toCase(bd.position));
      Body.setAngle(bd, bd.angle - caseTilt());
      Composite.add(world, bd);
    });
    let groups;
    if (mode === 'rainbow') {
      const colorful = (bd) => bd.book.sat > 0.18 && bd.book.lig > 0.12 && bd.book.lig < 0.92;
      const list = books.slice().sort((a, b) => {
        const ca = colorful(a), cb = colorful(b);
        if (ca !== cb) return ca ? -1 : 1;
        if (!ca) return b.book.lig - a.book.lig;
        return a.book.hue - b.book.hue || b.book.lig - a.book.lig;
      });
      groups = evenGroups(list);
    } else {
      groups = currentShelfGroups(fromDesk);
      if (mode === 'height') groups.forEach((g) => g.sort((a, b) => b.book.h - a.book.h));
    }
    rebalance(groups);

    let order = 0;
    groups.forEach((g, s) => {
      let x = INNER.l + 1.5;
      g.forEach((bd) => {
        const b = bd.book;
        const tx = x + b.w / 2;
        const ty = COMPS[s].floor - b.h / 2 - 0.3;
        x += b.w + 0.4;
        const a = normAngle(bd.angle);
        const moving = Math.hypot(tx - bd.position.x, ty - bd.position.y) > 1 || Math.abs(a) > 0.02;
        if (!moving) return;
        bd.collisionFilter.mask = 0;
        tweens.set(bd, {
          fx: bd.position.x, fy: bd.position.y, fa: a,
          tx, ty, delay: order * 5, t: 0, dur: 420 + rng() * 120, fromDesk: fromDesk.includes(bd),
        });
        order++;
      });
    });
    if (order === 0) toast('Already perfectly tidy.');
    Sound.init();
  }

  function normAngle(a) {
    a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return a;
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function stepTweens(dtMs) {
    if (!tweens.size) return;
    const done = [];
    tweens.forEach((tw, bd) => {
      tw.t += dtMs;
      const t = clamp((tw.t - tw.delay) / tw.dur, 0, 1);
      if (t <= 0) {
        Body.setVelocity(bd, { x: 0, y: 0 });
        Body.setPosition(bd, { x: tw.fx, y: tw.fy });
        Body.setAngle(bd, tw.fa);
        // books waiting on the desk must stay visible outside the cabinet
        bd.book.lift = tw.fromDesk ? 0.02 : 0;
        return;
      }
      const e = ease(t);
      Body.setPosition(bd, { x: tw.fx + (tw.tx - tw.fx) * e, y: tw.fy + (tw.ty - tw.fy) * e });
      Body.setAngle(bd, tw.fa * (1 - e));
      Body.setVelocity(bd, { x: 0, y: 0 });
      Body.setAngularVelocity(bd, 0);
      bd.book.lift = Math.max(tw.fromDesk ? 0.02 : 0, Math.sin(Math.PI * t));
      if (t >= 1) done.push(bd);
    });
    done.forEach((bd) => {
      tweens.delete(bd);
      bd.book.lift = 0;
      bd.book.lift = 0;
      bd.collisionFilter = SHELF_FILTER();
      Sound.tick();
    });
  }

  // ---------------------------------------------------------------- status
  let everMessy = false;
  let celebrated = true;

  function isStanding(bd) {
    if (bd.book.out) return false;
    const a = Math.abs(normAngle(bd.angle));
    const tilt = Math.min(a, Math.PI - a);
    if (tilt > 0.1) return false;
    const c = COMPS[compAtY(bd.position.y)];
    const bottom = bd.position.y + bd.book.h / 2;
    return Math.abs(c.floor - bottom) < 4;
  }

  function updateStatus() {
    let n = 0;
    let onDesk = 0;
    for (const bd of books) {
      if (bd.book.out || (held && held.body === bd)) onDesk += bd.book.out ? 1 : 0;
      else if (isStanding(bd) && !tweens.has(bd)) n++;
    }
    standing.textContent = n;
    deskNote.textContent = onDesk ? ` · ${onDesk} on the desk` : '';
    const pct = books.length ? (n / books.length) * 100 : 0;
    meterFill.style.width = pct.toFixed(1) + '%';
    if (n < books.length - 2) celebrated = false;
    if (n === books.length && everMessy && !celebrated && !held && !tweens.size) {
      celebrated = true;
      everMessy = false;
      Sound.chime();
      toast('Every book is standing. Nicely done. Take a slow breath.', 4200);
    }
  }

  // --------------------------------------------------------------- sound
  const Sound = {
    ctx: null,
    master: null,
    noise: null,
    enabled: true,
    lastHit: 0,

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          this.ctx = new AC();
        } catch (e) {
          return;
        }
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.7 : 0;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.master) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.02);
    },

    ready() {
      return this.ctx && this.enabled && this.ctx.state === 'running';
    },

    // a soft, woody "tok" — filtered noise with a fast decay
    burst(vol, freq, q, decay, when = 0) {
      if (!this.ready()) return;
      const c = this.ctx;
      const t = c.currentTime + when;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.1, decay + 0.02);
    },

    tone(freq, vol, decay, type = 'sine', when = 0) {
      if (!this.ready()) return;
      const c = this.ctx;
      const t = c.currentTime + when;
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + decay + 0.05);
    },

    hit(speed, onWood) {
      const now = performance.now();
      if (now - this.lastHit < 18) return;
      this.lastHit = now;
      const vol = Math.min(0.9, 0.06 + speed * 0.06);
      if (onWood) this.burst(vol, 500 + Math.random() * 400, 3, 0.07);
      else this.burst(vol * 0.8, 1400 + Math.random() * 1400, 5, 0.045);
    },
    tick() {
      const now = performance.now();
      if (now - this.lastHit < 22) return;
      this.lastHit = now;
      this.burst(0.18, 1800 + Math.random() * 900, 6, 0.04);
    },
    pick() { this.burst(0.25, 2400, 4, 0.035); },
    drop() { this.burst(0.45, 700, 3, 0.08); this.burst(0.2, 2000, 5, 0.04, 0.012); },
    knock(v) { this.burst(v, 260, 2, 0.14); this.burst(v * 0.5, 900, 3, 0.08); },
    tink() { this.tone(2900, 0.12, 0.25); this.tone(4350, 0.05, 0.18); },
    door(open) { this.burst(0.25, open ? 1100 : 800, 2, 0.1); this.tone(open ? 520 : 440, 0.03, 0.15, 'triangle', 0.03); },
    chime() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.09, 1.4, 'sine', i * 0.12));
    },
  };

  const onCollide = (ev) => {
    let best = 0, wood = false;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const sp = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (sp > best) { best = sp; wood = a.isStatic || b.isStatic; }
    }
    if (best > 1.4) {
      Sound.hit(best - 1.4, wood);
      if (best > 6) vibrate(5);
    }
  };
  Events.on(engine, 'collisionStart', onCollide);
  Events.on(deskEngine, 'collisionStart', onCollide);

  let lastVibe = 0;
  function vibrate(ms) {
    const now = performance.now();
    if (now - lastVibe < 80 || !navigator.vibrate) return;
    lastVibe = now;
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------- rendering
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  let backLayer = null;
  let frontLayer = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const s = Math.min(rect.width / W, rect.height / H);
    view = { s, ox: (rect.width - W * s) / 2, oy: (rect.height - H * s) / 2, dpr };
    backLayer = makeLayer(drawCaseBack);
    frontLayer = makeLayer(drawCaseFront);
  }

  function makeLayer(fn) {
    const c = document.createElement('canvas');
    const k = view.s * view.dpr;
    c.width = Math.max(1, Math.ceil(W * k));
    c.height = Math.max(1, Math.ceil(H * k));
    const g = c.getContext('2d');
    g.scale(k, k);
    fn(g);
    return c;
  }

  // deterministic wood grain so the cabinet looks the same on every resize
  function grain(g, x, y, w, h, base, vertical, seed) {
    const r = mulberry32(seed);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = base;
    g.fillRect(x, y, w, h);
    const len = vertical ? h : w;
    const across = vertical ? w : h;
    const lines = Math.max(6, Math.floor(across / 2.2));
    for (let i = 0; i < lines; i++) {
      const p = (i + r()) * (across / lines);
      const amp = 0.6 + r() * 2.2;
      const freq = 0.004 + r() * 0.012;
      const phase = r() * 10;
      g.beginPath();
      for (let t = 0; t <= len; t += 6) {
        const o = Math.sin(t * freq + phase) * amp + Math.sin(t * freq * 3.1 + phase) * amp * 0.3;
        if (vertical) g.lineTo(x + p + o, y + t);
        else g.lineTo(x + t, y + p + o);
      }
      const dark = r() < 0.7;
      g.strokeStyle = dark ? `rgba(45,22,8,${0.06 + r() * 0.14})` : `rgba(255,220,170,${0.04 + r() * 0.07})`;
      g.lineWidth = 0.4 + r() * 1.3;
      g.stroke();
    }
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  const WOOD = '#8a5532';
  const WOOD_LIGHT = '#a26a40';
  const WOOD_BACK = '#3f2617';

  function drawCaseBack(g) {
    const { x, y, w, h } = CASE;
    // body
    g.save();
    roundRect(g, x, y, w, h, 6);
    g.clip();
    grain(g, x, y, w, h, WOOD, true, 11);
    grain(g, x, y, w, FRAME, WOOD_LIGHT, false, 12);
    grain(g, x, y + h - BASE, w, BASE, WOOD, false, 13);
    // lighting: a soft lamp from the upper left
    const light = g.createLinearGradient(x, y, x + w, y + h);
    light.addColorStop(0, 'rgba(255,230,190,0.18)');
    light.addColorStop(0.6, 'rgba(0,0,0,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = light;
    g.fillRect(x, y, w, h);
    g.restore();

    // crown moulding and plinth
    g.save();
    roundRect(g, x - 8, y - 10, w + 16, 14, 4);
    g.clip();
    grain(g, x - 8, y - 10, w + 16, 14, WOOD_LIGHT, false, 14);
    g.fillStyle = 'rgba(255,235,200,0.25)';
    g.fillRect(x - 8, y - 10, w + 16, 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x - 8, y + 2, w + 16, 2);
    g.restore();
    g.save();
    roundRect(g, x - 8, y + h - 16, w + 16, 20, 4);
    g.clip();
    grain(g, x - 8, y + h - 16, w + 16, 20, WOOD_LIGHT, false, 15);
    g.fillStyle = 'rgba(255,235,200,0.22)';
    g.fillRect(x - 8, y + h - 16, w + 16, 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x - 8, y + h + 1, w + 16, 3);
    g.restore();

    // interior back panel, in vertical planks
    const iw = INNER.r - INNER.l, ih = INNER.b - INNER.t;
    grain(g, INNER.l, INNER.t, iw, ih, WOOD_BACK, true, 21);
    const planks = 6;
    for (let i = 1; i < planks; i++) {
      const px = INNER.l + (iw / planks) * i;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(px - 0.6, INNER.t, 1.2, ih);
      g.fillStyle = 'rgba(255,220,180,0.05)';
      g.fillRect(px + 0.6, INNER.t, 1, ih);
    }
    const vign = g.createRadialGradient(W / 2, (INNER.t + INNER.b) / 2, 60, W / 2, (INNER.t + INNER.b) / 2, 420);
    vign.addColorStop(0, 'rgba(255,200,140,0.06)');
    vign.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = vign;
    g.fillRect(INNER.l, INNER.t, iw, ih);

    // shelf boards
    COMPS.forEach((c, i) => {
      if (i === SHELVES - 1) return;
      grain(g, INNER.l, c.floor, iw, BOARD, WOOD_LIGHT, false, 30 + i);
    });
    // bottom of the interior
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(INNER.l, INNER.b, iw, 2);
  }

  function drawCaseFront(g) {
    const iw = INNER.r - INNER.l;
    COMPS.forEach((c, i) => {
      // shadow cast by the board (or top) above
      const sh = g.createLinearGradient(0, c.top, 0, c.top + 26);
      sh.addColorStop(0, 'rgba(10,4,0,0.55)');
      sh.addColorStop(1, 'rgba(10,4,0,0)');
      g.fillStyle = sh;
      g.fillRect(INNER.l, c.top, iw, 26);
      // side walls' shadows
      const sl = g.createLinearGradient(INNER.l, 0, INNER.l + 14, 0);
      sl.addColorStop(0, 'rgba(10,4,0,0.45)');
      sl.addColorStop(1, 'rgba(10,4,0,0)');
      g.fillStyle = sl;
      g.fillRect(INNER.l, c.top, 14, COMP_H);
      const sr = g.createLinearGradient(INNER.r, 0, INNER.r - 10, 0);
      sr.addColorStop(0, 'rgba(10,4,0,0.35)');
      sr.addColorStop(1, 'rgba(10,4,0,0)');
      g.fillStyle = sr;
      g.fillRect(INNER.r - 10, c.top, 10, COMP_H);

      // front lip of the board each shelf rests on
      const lipY = c.floor - 0.8;
      const lipH = i === SHELVES - 1 ? 4 : BOARD + 0.8;
      grain(g, INNER.l, lipY, iw, lipH, i === SHELVES - 1 ? WOOD : WOOD_LIGHT, false, 40 + i);
      g.fillStyle = 'rgba(255,232,195,0.28)';
      g.fillRect(INNER.l, lipY, iw, 1);
      if (i < SHELVES - 1) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(INNER.l, lipY + lipH - 1.2, iw, 1.2);
      }
    });
  }

  function drawBook(g, bd, scale) {
    const b = bd.book;
    const L = b.look;
    const w = b.w, h = b.h;
    g.save();
    g.translate(bd.position.x, bd.position.y);
    g.rotate(bd.angle);
    if (scale !== 1) g.scale(scale, scale);
    const x = -w / 2, y = -h / 2;
    g.fillStyle = L.color;
    g.fillRect(x, y, w, h);
    for (const band of L.bands) {
      g.fillStyle = L.trim;
      g.fillRect(x, y + band.y * h, w, band.h * h);
    }
    if (L.label) {
      g.fillStyle = L.trim;
      g.fillRect(x + 1.2, y + L.label.y * h, w - 2.4, L.label.h * h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(-0.4, y + (L.label.y + 0.04) * h, 0.8, (L.label.h - 0.08) * h);
    } else {
      g.fillStyle = L.trim;
      g.globalAlpha = 0.75;
      g.fillRect(-0.45, y + L.title.y * h, 0.9, L.title.len * h);
      g.globalAlpha = 1;
    }
    if (L.dot) {
      g.fillStyle = L.trim;
      g.beginPath();
      g.arc(0, y + h * 0.88, Math.min(1.6, w * 0.22), 0, Math.PI * 2);
      g.fill();
    }
    // rounded foam shading: light left edge, dark right edge, top highlight
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(x, y, 1, h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + w - 1.4, y, 1.4, h);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(x, y, w, 1);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(x, y + h - 1, w, 1);
    g.restore();
  }

  // shadows for a set of books, in one pass
  function drawShadows(g, list, dx, dy, alpha) {
    g.fillStyle = `rgba(8,3,0,${alpha})`;
    g.beginPath();
    for (const bd of list) {
      const v = bd.vertices;
      g.moveTo(v[0].x + dx, v[0].y + dy);
      for (let i = 1; i < v.length; i++) g.lineTo(v[i].x + dx, v[i].y + dy);
      g.closePath();
    }
    g.fill();
  }

  function drawBooks(g) {
    const flat = [];
    const lifted = [];
    for (const bd of books) {
      if (bd.book.out || (held && held.body === bd)) continue;
      (bd.book.lift > 0.01 ? lifted : flat).push(bd);
    }
    drawShadows(g, flat, 2.6, 1.6, 0.38);
    for (const bd of flat) drawBook(g, bd, 1);
    return lifted;
  }

  function drawDesk(g) {
    const list = books.filter((bd) => bd.book.out && !(held && held.body === bd));
    if (!list.length) return;
    drawShadows(g, list, 1.5, 2.5, 0.3);
    for (const bd of list) drawBook(g, bd, 1);
  }

  function drawLifted(g, lifted, liftOverride) {
    for (const bd of lifted) {
      const lift = liftOverride != null ? liftOverride : bd.book.lift;
      const sc = 1 + 0.14 * lift;
      g.save();
      g.globalAlpha = 0.35 * lift + 0.1;
      g.fillStyle = '#000';
      g.translate(bd.position.x + 5 + 6 * lift, bd.position.y + 4 + 6 * lift);
      g.rotate(bd.angle);
      g.fillRect(-bd.book.w / 2 * sc, -bd.book.h / 2 * sc, bd.book.w * sc, bd.book.h * sc);
      g.restore();
      drawBook(g, bd, sc);
    }
  }

  function quad(theta) {
    // glass door hinged on the left, swinging toward the viewer
    const hx = INNER.l - 7;
    const w0 = INNER.r + 7 - hx;
    const top = INNER.t - 7, bot = INNER.b + 7;
    const fx = hx + w0 * Math.cos(theta);
    const grow = (bot - top) * 0.07 * Math.sin(theta);
    return {
      p: [
        { x: hx, y: top },
        { x: fx, y: top - grow },
        { x: fx, y: bot + grow },
        { x: hx, y: bot },
      ],
      at(u, v) {
        const a = this.p;
        const tx = a[0].x + (a[1].x - a[0].x) * u, ty = a[0].y + (a[1].y - a[0].y) * u;
        const bx = a[3].x + (a[2].x - a[3].x) * u, by = a[3].y + (a[2].y - a[3].y) * u;
        return { x: tx + (bx - tx) * v, y: ty + (by - ty) * v };
      },
    };
  }

  function drawDoor(g) {
    const theta = ease(door.open) * Math.PI * 0.52;
    const q = quad(theta);
    const facing = Math.cos(theta);
    const w0 = INNER.r - INNER.l + 14;
    const h0 = INNER.b - INNER.t + 14;
    const ru = 9 / w0, rv = 9 / h0;
    const inner = [q.at(ru, rv), q.at(1 - ru, rv), q.at(1 - ru, 1 - rv), q.at(ru, 1 - rv)];
    const poly = (pts) => { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); };

    // glass
    g.save();
    g.beginPath();
    poly(inner);
    g.clip();
    const minX = Math.min(inner[0].x, inner[1].x), maxX = Math.max(inner[0].x, inner[1].x);
    g.fillStyle = `rgba(190,220,235,${0.07 + 0.08 * (1 - Math.abs(facing))})`;
    g.fillRect(minX - 2, INNER.t - 40, maxX - minX + 4, INNER.b - INNER.t + 80);
    // reflections slide across the glass as it turns
    const shift = (1 - facing) * 300;
    g.globalCompositeOperation = 'lighter';
    [[0.18, 70, 0.13], [0.42, 22, 0.08], [0.78, 46, 0.06]].forEach(([pos, width, alpha]) => {
      const cx = minX + (maxX - minX) * pos + shift;
      const grd = g.createLinearGradient(cx - width, 0, cx + width, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, `rgba(255,250,240,${alpha})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(cx - width - 120, INNER.b + 40);
      g.lineTo(cx + width - 120, INNER.b + 40);
      g.lineTo(cx + width + 120, INNER.t - 40);
      g.lineTo(cx - width + 120, INNER.t - 40);
      g.fill();
    });
    g.restore();

    // wooden door rails
    g.save();
    g.beginPath();
    poly(q.p);
    poly(inner.slice().reverse());
    g.fillStyle = WOOD_LIGHT;
    g.fill('evenodd');
    g.clip('evenodd');
    const lg = g.createLinearGradient(q.p[0].x, 0, q.p[1].x, 0);
    lg.addColorStop(0, 'rgba(255,230,190,0.18)');
    lg.addColorStop(1, `rgba(0,0,0,${0.15 + 0.35 * (1 - facing)})`);
    g.fillStyle = lg;
    g.fillRect(Math.min(q.p[0].x, q.p[1].x) - 5, INNER.t - 60, Math.abs(q.p[1].x - q.p[0].x) + 10, INNER.b - INNER.t + 120);
    g.restore();
    g.strokeStyle = 'rgba(30,14,4,0.55)';
    g.lineWidth = 0.8;
    g.beginPath();
    poly(inner);
    g.stroke();

    // hinges
    g.fillStyle = '#c9a24a';
    [0.15, 0.85].forEach((v) => {
      const p = q.at(0, v);
      g.fillRect(p.x - 2.5, p.y - 9, 5, 18);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(p.x - 2.5, p.y - 1, 5, 2);
      g.fillStyle = '#c9a24a';
    });

    // brass knob
    const k = q.at(1 - ru * 0.5, 0.5);
    const kr = KNOB.r * (0.6 + 0.4 * Math.max(0.2, facing)) * (1 + 0.1 * Math.sin(theta));
    const kg = g.createRadialGradient(k.x - kr * 0.35, k.y - kr * 0.4, kr * 0.1, k.x, k.y, kr);
    kg.addColorStop(0, '#fff3c4');
    kg.addColorStop(0.4, '#d8b25a');
    kg.addColorStop(1, '#7a5a1e');
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(k.x + 2, k.y + 3, kr, kr, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kg;
    g.beginPath();
    g.ellipse(k.x, k.y, kr * Math.max(0.35, Math.abs(facing)), kr, 0, 0, Math.PI * 2);
    g.fill();
    door.knobAt = k;
  }

  function draw() {
    const { s, ox, oy, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);

    // shadow on the desk stays put while the cabinet moves
    ctx.save();
    const deskY = CASE.y + CASE.h + 6;
    const sg = ctx.createRadialGradient(W / 2, deskY, 20, W / 2, deskY, CASE.w * 0.62);
    sg.addColorStop(0, 'rgba(30,15,5,0.35)');
    sg.addColorStop(1, 'rgba(30,15,5,0)');
    ctx.fillStyle = sg;
    ctx.translate(0, deskY);
    ctx.scale(1, 0.09);
    ctx.translate(0, -deskY);
    ctx.beginPath();
    ctx.arc(W / 2 + shake.off.x * 0.6, deskY, CASE.w * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(shake.off.x, Math.min(0, shake.off.y));
    ctx.rotate(shake.off.x * 0.0009);
    ctx.drawImage(backLayer, 0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(INNER.l, INNER.t, INNER.r - INNER.l, INNER.b - INNER.t);
    ctx.clip();
    const lifted = drawBooks(ctx);
    ctx.restore();
    ctx.drawImage(frontLayer, 0, 0, W, H);
    drawLifted(ctx, lifted);
    drawDoor(ctx);
    ctx.restore();

    // spilled books sit on the desk in front of the cabinet
    drawDesk(ctx);
    if (held) drawLifted(ctx, [held.body], 1);
  }

  // ---------------------------------------------------------------- input
  const pointer = { mode: null, id: null, sx: 0, sy: 0, t0: 0, moved: 0 };

  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.ox) / view.s,
      y: (e.clientY - rect.top - view.oy) / view.s,
    };
  }

  // the cabinet sways, so convert into its local frame
  function toCase(p) {
    const a = -shake.off.x * 0.0009;
    const x = p.x - shake.off.x, y = p.y - Math.min(0, shake.off.y);
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }

  function caseTilt() {
    return shake.off.x * 0.0009;
  }

  function caseToWorld(p) {
    const a = caseTilt();
    const x = p.x * Math.cos(a) - p.y * Math.sin(a);
    const y = p.x * Math.sin(a) + p.y * Math.cos(a);
    return { x: x + shake.off.x, y: y + Math.min(0, shake.off.y) };
  }

  const inside = (p, r) => p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b;

  canvas.addEventListener('pointerdown', (e) => {
    if (pointer.id !== null) return;
    Sound.init();
    const w = toWorld(e);
    const p = toCase(w);
    pointer.id = e.pointerId;
    pointer.sx = w.x; pointer.sy = w.y;
    pointer.t0 = performance.now();
    pointer.moved = 0;
    canvas.setPointerCapture(e.pointerId);

    const k = door.knobAt;
    if (k && Math.hypot(p.x - k.x, p.y - k.y) < 18) {
      pointer.mode = 'knob';
      return;
    }
    const onDesk = bookAt(deskBooks(), w);
    const bd = onDesk || (isDoorOpen() && inside(p, INNER) ? bookAt(shelfBooks(), p) : null);
    {
      if (bd) {
        pointer.mode = 'book';
        grab(bd, w);
        canvas.classList.add('grabbing');
        return;
      }
    }
    pointer.mode = 'case';
    canvas.classList.add('grabbing');
  });

  canvas.addEventListener('pointermove', (e) => {
    const w = toWorld(e);
    if (pointer.id === null) {
      const p = toCase(w);
      const over = !!bookAt(deskBooks(), w) || (isDoorOpen() && inside(p, INNER) && !!bookAt(shelfBooks(), p));
      canvas.classList.toggle('over-book', over);
      return;
    }
    if (e.pointerId !== pointer.id) return;
    pointer.moved = Math.max(pointer.moved, Math.hypot(w.x - pointer.sx, w.y - pointer.sy));
    if (pointer.mode === 'book' && held) {
      held.px = clamp(w.x, 4, W - 4);
      held.py = clamp(w.y, 4, DESK_Y - 4);
    } else if (pointer.mode === 'case') {
      shake.target.x = clamp(w.x - pointer.sx, -MAX_OFFSET.x, MAX_OFFSET.x);
      shake.target.y = clamp(w.y - pointer.sy, -MAX_OFFSET.y, MAX_OFFSET.y);
    }
  });

  function endPointer(e) {
    if (e.pointerId !== pointer.id) return;
    const quick = performance.now() - pointer.t0 < 300 && pointer.moved < 5;
    const p = toCase(toWorld(e));
    if (pointer.mode === 'knob' && quick) setDoor(door.target < 0.5);
    else if (pointer.mode === 'book') release();
    else if (pointer.mode === 'case') {
      shake.target.x = 0;
      shake.target.y = 0;
      if (quick) {
        if (door.open < 0.15 && inside(p, INNER)) {
          Sound.tink();
          shake.vel.x += (p.x < W / 2 ? 1 : -1) * 40;
          hintOnce('glass', 'The glass door is closed. Tap the brass knob to open it.');
        } else if (!inside(p, INNER)) {
          knock(p.x < W / 2 ? 1 : -1, 0.8);
        }
      }
    }
    pointer.id = null;
    pointer.mode = null;
    canvas.classList.remove('grabbing');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); startShake(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); knock(-1); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); knock(1); }
    else if (e.key === 'o' || e.key === 'O') setDoor(door.target < 0.5);
  });

  // --------------------------------------------------------- phone motion
  let lastMotion = 0;
  function onMotion(e) {
    const a = e.acceleration;
    if (!a || a.x == null) return;
    const ax = Math.abs(a.x) > 1.5 ? a.x : 0;
    const ay = Math.abs(a.y) > 1.5 ? a.y : 0;
    // phone moves right → books feel a push to the left
    motion.x = clamp(-ax / 9.81 * 1.6, -3, 3);
    motion.y = clamp(ay / 9.81 * 1.6, -2, 2);
    shake.vel.x += ax * 6;
    shake.vel.y -= ay * 4;
    lastMotion = performance.now();
    if (Math.abs(ax) + Math.abs(ay) > 6) everMessy = true;
  }

  function enableMotion() {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      DME.requestPermission().then((r) => {
        if (r === 'granted') {
          window.addEventListener('devicemotion', onMotion);
          btnMotion.hidden = true;
          toast('Phone motion on. Give it a shake.');
        } else {
          toast('Motion access was declined.');
        }
      }).catch(() => toast('Motion access is not available.'));
    } else {
      window.addEventListener('devicemotion', onMotion);
      btnMotion.hidden = true;
    }
  }

  // ---------------------------------------------------------------- UI
  const $ = (id) => document.getElementById(id);
  const standing = $('standing');
  const total = $('total');
  const meterFill = $('meterFill');
  const deskNote = $('deskNote');
  const toastEl = $('toast');
  const btnDoor = $('btnDoor');
  const btnSound = $('btnSound');
  const btnMotion = $('btnMotion');
  const countInput = $('count');
  const countOut = $('countOut');
  const helpEl = $('help');
  const btnHelp = $('btnHelp');

  let toastTimer = 0;
  function toast(msg, ms = 2800) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  const hinted = new Set();
  function hintOnce(key, msg) {
    if (hinted.has(key)) return;
    hinted.add(key);
    toast(msg, 3400);
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('anxiety-bookshelf:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('anxiety-bookshelf:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  $('btnShake').addEventListener('click', () => startShake());
  btnDoor.addEventListener('click', () => setDoor(door.target < 0.5));
  $('btnTidy').addEventListener('click', () => autoSort('tidy'));
  $('btnRainbow').addEventListener('click', () => autoSort('rainbow'));
  $('btnHeight').addEventListener('click', () => autoSort('height'));
  btnSound.addEventListener('click', () => {
    Sound.init();
    Sound.setEnabled(!Sound.enabled);
    btnSound.setAttribute('aria-pressed', String(Sound.enabled));
    btnSound.textContent = Sound.enabled ? 'Sound on' : 'Sound off';
    store.set('sound', Sound.enabled);
  });
  btnMotion.addEventListener('click', enableMotion);
  btnHelp.addEventListener('click', () => {
    helpEl.hidden = !helpEl.hidden;
    btnHelp.setAttribute('aria-expanded', String(!helpEl.hidden));
    resize();
  });
  countInput.addEventListener('input', () => { countOut.textContent = countInput.value; });
  countInput.addEventListener('change', () => {
    const n = clamp(parseInt(countInput.value, 10) || 230, 200, 260);
    store.set('count', n);
    createBooks(n);
    btnDoor.textContent = door.target > 0.5 ? 'Close door' : 'Open door';
    toast(`A fresh shelf of ${n} books.`);
  });

  if ('DeviceMotionEvent' in window && matchMedia('(pointer: coarse)').matches) {
    btnMotion.hidden = false;
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let acc = 0;
  let statusTimer = 0;

  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= STEP_MS && steps < 5) {
      if (performance.now() - lastMotion > 120) { motion.x *= 0.6; motion.y *= 0.6; }
      stepShake(STEP_MS);
      door.open += (door.target - door.open) * Math.min(1, STEP_MS / 110);
      if (held) {
        const bd = held.body;
        const tx = held.px + held.dx * 0.6, ty = held.py + held.dy * 0.6;
        Body.setPosition(bd, { x: bd.position.x + (tx - bd.position.x) * 0.5, y: bd.position.y + (ty - bd.position.y) * 0.5 });
        Body.setAngle(bd, normAngle(bd.angle) * 0.82);
        Body.setVelocity(bd, { x: 0, y: 0 });
        Body.setAngularVelocity(bd, 0);
      }
      stepTweens(STEP_MS);
      Engine.update(engine, STEP_MS);
      Engine.update(deskEngine, STEP_MS);
      acc -= STEP_MS;
      steps++;
    }
    if (steps === 5) acc = 0;

    statusTimer += dt;
    if (statusTimer > 200) { statusTimer = 0; updateStatus(); }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- start
  Sound.enabled = store.get('sound', true);
  btnSound.setAttribute('aria-pressed', String(Sound.enabled));
  btnSound.textContent = Sound.enabled ? 'Sound on' : 'Sound off';
  const startCount = clamp(store.get('count', 230), 200, 260);
  countInput.value = startCount;
  countOut.textContent = startCount;

  new ResizeObserver(resize).observe(canvas);
  resize();
  const restored = loadState();
  if (restored) {
    countInput.value = books.length;
    countOut.textContent = books.length;
  } else {
    createBooks(startCount);
  }
  updateStatus();
  requestAnimationFrame((t) => { last = t; frame(t); });
  setTimeout(() => toast(restored
    ? 'Welcome back. Your shelf is just as you left it.'
    : 'Grab the cabinet and give it a shake, or press Space.', 3600), 400);

  // keep the shelf between visits
  setInterval(() => { if (!document.hidden && !held) saveState(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  window.addEventListener('pagehide', saveState);

  // handy for poking at things from the console
  window.bookshelf = { engine, books: () => books, shake: startShake, sort: autoSort, door: setDoor };
})();
