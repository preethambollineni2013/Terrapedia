// earth-mode.js
// Triple-click the background (or press G) to hand the screen to the Earth. Text hides, the globe
// takes scroll, drag and pinch. Zoom back out to the starting view (or press Esc) and the text returns.
// There is no banner on the normal page; a small hint shows only while the globe is active.
// The globe itself (Cesium in globe.js) only has to give this file three things:
//   start: the starting camera height, setInputs(bool): turn globe controls on or off,
//   and call EarthMode.height(h) whenever the camera height changes.
// globe.js can also call exit() (leave globe mode), sync() (re-apply controls to a rebuilt globe)
// and disable() (the globe is unusable, so triple-click and G do nothing).

const EarthMode = (function () {
  const root = document.documentElement;
  const ui = document.getElementById("ui");
  const hint = document.getElementById("hint");
  const ACTIVE = "Scroll to zoom, drag to rotate. Zoom all the way out or press Esc to return.";
  const SKIP = "input,button,a,.card,.entry,.ans,.back,#sug,nav,table,dl";

  let api = null, on = false, armed = false, available = false, clicks = [];

  function set(value) {
    on = value;
    armed = false;                       // must zoom in first, so entering never exits at once
    root.classList.toggle("globe-mode", on);
    ui.inert = on;                       // blocks clicks and keyboard focus on hidden text
    try { api.setInputs(on); } catch (err) { /* globe is being rebuilt or is gone */ }
    hint.textContent = ACTIVE;
    hint.hidden = !on;                   // only visible while the globe is in use
    if (on && window.getSelection) window.getSelection().removeAllRanges();
  }

  function height(h) {
    if (!on) return;
    if (!armed && h < api.start * 0.6) armed = true;
    else if (armed && h >= api.start * 0.85) set(false);   // back at the starting zoom: text returns
  }

  function init(options) {
    api = options;
    available = true;
    set(false);

    // Three quick clicks in nearly the same spot, on background or plain text
    document.addEventListener("pointerup", function (e) {
      if (!available || on || e.button > 0) return;
      if (e.target.closest(SKIP)) { clicks = []; return; }
      const now = performance.now();
      clicks = clicks.filter(function (c) {
        return now - c.t < 700 && Math.hypot(c.x - e.clientX, c.y - e.clientY) < 30;
      });
      clicks.push({ t: now, x: e.clientX, y: e.clientY });
      if (clicks.length >= 3) { clicks = []; set(true); }
    });

    // Stop the triple-click from selecting a paragraph
    document.addEventListener("mousedown", function (e) {
      if (available && e.detail > 1 && !e.target.closest(SKIP)) e.preventDefault();
    });

    document.addEventListener("keydown", function (e) {
      if (!available) return;
      if (e.key === "Escape" && on) set(false);
      else if ((e.key === "g" || e.key === "G") && !on && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) set(true);
    });
  }

  function exit() { if (api && on) set(false); }

  function sync() { if (api) { try { api.setInputs(on); } catch (err) { /* ignore */ } } }

  function disable() { exit(); available = false; }

  return { init: init, height: height, exit: exit, sync: sync, disable: disable };
})();