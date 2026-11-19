import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Runs the actual app and Matter.js with a minimal DOM/canvas adapter.
// This checks startup/control/physics logic; it is not a browser rendering test.
export async function runStartupChecks(onApp) {
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const matter = await fs.readFile(new URL('../vendor/matter.min.js', import.meta.url), 'utf8');
  const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('class BattleRoyaleApp'))[1];
  const results = [];
  for (const mode of ['fresh', 'saved', 'high-count', 'storage-blocked']) {
    const warnings = [];
    const gradient = { addColorStop() {} };
    function canvasContext() {
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack = [];
      function multiply([a,b,c,d,e,f]) {
        const [A,B,C,D,E,F] = matrix;
        matrix = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F];
      }
      return new Proxy({
        getTransform: () => [...matrix], stackDepth: () => stack.length,
        save() {stack.push([...matrix]);}, restore() {if (stack.length) matrix = stack.pop();},
        scale(x,y) {multiply([x,0,0,y,0,0]);}, translate(x,y) {multiply([1,0,0,1,x,y]);},
        rotate(angle) {multiply([Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0]);},
        createRadialGradient: () => gradient, createLinearGradient: () => gradient, measureText: () => ({width: 40})
      }, {get: (target, key) => target[key] ?? (() => {})});
    }
    function element(id = '') {
      const canvas = canvasContext();
      return {id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [], listeners: {},
        classList: {add() {}, remove() {}, toggle() {}, contains() {return false;}},
        addEventListener(type, fn) {this.listeners[type] = fn;}, setAttribute() {},
        click() {this.listeners.click?.({target:this});},
        removeChild(child) {this.children.splice(this.children.indexOf(child),1);},
        get firstChild() {return this.children[0];},
        appendChild(child) {this.children.push(child);}, querySelector() {return null;}, querySelectorAll() {return [];},
        getBoundingClientRect() {return {width: 540, height: 960};}, getContext() {return canvas;}, remove() {}, focus() {}};
    }
    const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], element(m[1])]));
    const data = new Map();
    if (mode === 'saved' || mode === 'high-count') data.set('flag_royale_streamer_config', JSON.stringify({durationMode: 'blitz', selectedBatchSize: mode === 'high-count' ? 120 : 40, arenaTemplate: 'hole'}));
    const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key)};
    const context = {
      console: {log() {}, warn(...args) {warnings.push(args.join(' '));}, error(...args) {warnings.push(args.join(' '));}},
      setTimeout() {return 1;}, clearTimeout() {}, setInterval() {return 1;}, clearInterval() {}, requestAnimationFrame() {},
      performance: {now: () => 0}, URL, URLSearchParams,
      navigator: {userAgent: 'Desktop test'}, location: {protocol: 'file:', search: '', hash: '', pathname: '/index.html', href: 'file:///index.html'},
      Image: class {set src(value) {}}, screen: {width: 1920, height: 1080, colorDepth: 24}, innerWidth: 1200, devicePixelRatio: 1, addEventListener() {},
      document: {hidden: false, body: element('body'), getElementById: id => elements.get(id) || null, createElement: element, querySelectorAll: () => [], addEventListener() {}}
    };
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(context, key, {get() {if (mode === 'storage-blocked') throw new Error('Storage denied'); return storage;}});
    context.window = context;
    vm.createContext(context);
    vm.runInContext(matter, context);
    vm.runInContext(main + '\n globalThis.TestApp = BattleRoyaleApp;', context);
    vm.runInContext(await fs.readFile(new URL('../activation-links.js', import.meta.url), 'utf8'), context);
    vm.runInContext(await fs.readFile(new URL('../client-access.js', import.meta.url), 'utf8'), context);
    const app = new context.TestApp();
    assert.equal(app.balls.length, mode === 'saved' ? 40 : 120);
    assert.equal(app.dom.sliderSpeed, elements.get('slider-speed'));
    assert.equal(app.dom.sliderGapSize, elements.get('slider-gap-size'));
    assert.equal(app.dom.sliderSpeed.value, app.baseRotationSpeed.toFixed(3));
    assert.equal(app.targetMatchSeconds, mode === 'saved' || mode === 'high-count' ? 140 : 300);
    app.dom.sliderSpeed.listeners.input({target: {value: '0.030'}});
    assert.equal(app.baseRotationSpeed, 0.030);
    app.dom.sliderGapSize.listeners.input({target: {value: '4'}});
    assert.equal(app.gapSegmentCount, 4);
    // drawArena must preserve its caller's DPI scale, zoom and canvas stack.
    for (const template of ['hole', 'ring']) {
      app.arenaTemplate = template;
      app.createCircularArena();
      for (const scale of [0.62, 0.93, 1.5]) {
        for (const zoom of [1, 1.12, 1.25]) {
          const ctx = app.ctx;
          ctx.save();
          ctx.scale(scale, scale);
          ctx.translate(270, 405);
          ctx.scale(zoom, zoom);
          ctx.translate(-270, -405);
          const before = ctx.getTransform();
          const depth = ctx.stackDepth();
          app.drawArena(ctx);
          assert.deepEqual(ctx.getTransform(), before, template + ': arena changed the ball coordinate system');
          assert.equal(ctx.stackDepth(), depth, template + ': unbalanced canvas save/restore');
          for (const ball of app.balls) app.drawBall(ctx, ball);
          assert.deepEqual(ctx.getTransform(), before);
          ctx.restore();
        }
      }
    }
    app.arenaTemplate = 'hole';
    app.createCircularArena();
    app.gameLoop(16.667); // Exercise the initial arena drawing path.
    for (let frame = 0; frame < 600; frame++) {
      app.Engine.update(app.engine, 1000 / 60);
      app.updateCircularArena(1);
      app.checkBallPhysicsAndEliminations(1 / 60);
      for (const ball of app.balls) assert.ok(Math.hypot(ball.body.position.x - app.arenaCenter.x, ball.body.position.y - app.arenaCenter.y) + ball.radius <= app.arenaRadius - 18 + 0.001);
    }
    app.isGameStarted = true;
    app.scaleX = app.scaleY = 0.93;
    for (const zoom of [1, 1.12, 1.25]) {
      app.currentZoom = app.targetZoom = zoom;
      const before = app.ctx.getTransform();
      const depth = app.ctx.stackDepth();
      app.gameLoop(50 + zoom * 100);
      assert.deepEqual(app.ctx.getTransform(), before, 'Live frame leaked canvas transform');
      assert.equal(app.ctx.stackDepth(), depth, 'Live frame leaked canvas state');
    }
    assert.deepEqual(warnings, [], 'Startup and game rendering must not log errors');
    if (onApp) await onApp(app, context, mode);
    results.push(mode + ': startup, settings, hole/ring transforms at 3 scales × 3 zooms, live frames and 600 physics steps passed');
  }
  return results;
}
