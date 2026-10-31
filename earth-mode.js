// earth-mode.js
// Triple-click the background to hand the screen to the Earth. Text hides, the globe takes
// scroll, drag and pinch. Zoom back out to the starting view (or press Esc) and the text returns.
// The globe itself (Cesium in globe.js) only has to give this file three things:
//   start: the starting camera height, setInputs(bool): turn globe controls on or off,
//   and call EarthMode.height(h) whenever the camera height changes.

const EarthMode = (function () {
  const root = document.documentElement;
  const ui = document.getElementById("ui");
  const hint = document.getElementById("hint");
  const IDLE = "Triple-click the background to explore the Earth";
  const ACTIVE = "Scroll to zoom, drag to rotate. Zoom all the way out or press Esc to return.";
  const SKIP = "input,button,a,.card,.entry,.ans,.back,#sug,nav,table,dl";

  let api = null, on = false, armed = false, clicks = [];

  function set(value) {
    on = value;
    armed = false;                       // must zoom in first, so entering never exits at once
    root.classList.toggle("globe-mode", on);
    ui.inert = on;                       // blocks clicks and keyboard focus on hidden text
    api.setInputs(on);
    hint.textContent = on ? ACTIVE : IDLE;
    if (on && window.getSelection) window.getSelection().removeAllRanges();
  }

  function height(h) {
    if (!on) return;
    if (!armed && h < api.start * 0.6) armed = true;
    else if (armed && h >= api.start * 0.85) set(false);   // back at the starting zoom: text returns
  }

  function init(options) {
    api = options;
    hint.hidden = false;
    set(false);

    // Three quick clicks in nearly the same spot, on background or plain text
    document.addEventListener("pointerup", function (e) {
      if (on || e.button > 0) return;
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
      if (e.detail > 1 && !e.target.closest(SKIP)) e.preventDefault();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && on) set(false);
      else if ((e.key === "g" || e.key === "G") && !on && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) set(true);
    });
  }

  return { init: init, height: height };
})();
