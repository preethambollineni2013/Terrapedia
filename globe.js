// globe.js
// Satellite Earth behind the page (CesiumJS + satellite imagery).
// Controls stay off until EarthMode switches them on (triple-click or G, see earth-mode.js).
//
// This file is written so one failing piece cannot break the page:
//  - Cesium is loaded here, from jsDelivr first and unpkg second.
//  - Imagery is probed first (Esri World Imagery, then NASA Blue Marble) so a dead tile server
//    does not leave a black globe.
//  - Render-loop errors and lost WebGL contexts rebuild the globe once, then give up quietly.
//  - If the globe cannot run at all, the page keeps its plain dark background and EarthMode is
//    disabled, so triple-click and G never hide the text with nothing behind it.
// Every failure is logged to the browser console with the prefix "Terrapedia globe".

(function () {
  const VERSION = "1.120.0";
  const BASES = [
    "https://cdn.jsdelivr.net/npm/cesium@" + VERSION + "/Build/Cesium/",
    "https://unpkg.com/cesium@" + VERSION + "/Build/Cesium/"
  ];

  const START = { lon: 78, lat: 20, height: 17000000 }; // whole-Earth starting view

  // Tried in order. "probe" is one small tile used to check the source works before we commit to it.
  const IMAGERY = [
    {
      name: "Esri World Imagery",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      probe: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/0",
      maximumLevel: 19,
      credit: "Imagery © Esri, Maxar, Earthstar Geographics",
      label: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
    },
    {
      name: "NASA Blue Marble",
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/EPSG3857_500m/{z}/{y}/{x}.jpeg",
      probe: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/EPSG3857_500m/1/0/0.jpeg",
      maximumLevel: 8,
      credit: "Imagery © NASA Earth Observatory (Blue Marble)",
      label: "Imagery &copy; NASA Earth Observatory (Blue Marble)"
    }
  ];

  const MAX_REBUILDS = 1;

  let viewer = null;
  let imagery = IMAGERY[0];
  let rebuilds = 0;
  let wired = false;       // EarthMode.init must run only once
  let givenUp = false;

  function log(message, detail) {
    if (detail !== undefined) console.warn("Terrapedia globe: " + message, detail);
    else console.warn("Terrapedia globe: " + message);
  }

  // ---------- loading Cesium ----------

  function addStylesheet(href) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src, ok, fail) {
    const script = document.createElement("script");
    script.src = src;
    script.onload = ok;
    script.onerror = function () { script.remove(); fail(); };
    document.head.appendChild(script);
  }

  function loadCesium(i, done) {
    if (window.Cesium) { done(true); return; }
    if (i >= BASES.length) { done(false); return; }
    window.CESIUM_BASE_URL = BASES[i];          // where Cesium finds its workers and assets
    addStylesheet(BASES[i] + "Widgets/widgets.css");
    loadScript(BASES[i] + "Cesium.js", function () {
      if (window.Cesium) done(true);
      else { log("Cesium.js loaded from " + BASES[i] + " but did not define Cesium"); loadCesium(i + 1, done); }
    }, function () {
      log("could not load Cesium from " + BASES[i]);
      loadCesium(i + 1, done);
    });
  }

  // ---------- choosing imagery ----------

  // Loads one tile the same way Cesium would (cross-origin), so we learn about blocked or dead sources early
  function probeTile(url, done) {
    const img = new Image();
    let finished = false;
    function end(ok) { if (!finished) { finished = true; done(ok); } }
    img.crossOrigin = "anonymous";
    img.onload = function () { end(true); };
    img.onerror = function () { end(false); };
    setTimeout(function () { end(false); }, 7000);
    img.src = url;
  }

  function pickImagery(i, done) {
    if (i >= IMAGERY.length) { log("no imagery source answered, using " + IMAGERY[0].name + " anyway"); done(IMAGERY[0]); return; }
    probeTile(IMAGERY[i].probe, function (ok) {
      if (ok) done(IMAGERY[i]);
      else { log(IMAGERY[i].name + " tiles are not reachable"); pickImagery(i + 1, done); }
    });
  }

  // ---------- the viewer ----------

  function destroyViewer() {
    const old = viewer;
    viewer = null;
    try { if (old && !old.isDestroyed()) old.destroy(); } catch (err) { log("destroy failed", err); }
    const host = document.getElementById("globe");
    if (host) host.innerHTML = "";
  }

  function giveUp(reason) {
    if (givenUp) return;
    givenUp = true;
    log("giving up, the page will use its plain background", reason);
    destroyViewer();
    EarthMode.disable();
  }

  // A render error stops Cesium's loop for good, so the only fix is a fresh viewer.
  // Done on a timer because destroying a viewer from inside its own render loop is unsafe.
  function recover(reason) {
    if (givenUp || !viewer) return;
    log("render problem", reason);
    destroyViewer();
    EarthMode.exit();                            // bring the text back while we rebuild
    if (rebuilds >= MAX_REBUILDS) { giveUp("too many render problems"); return; }
    rebuilds += 1;
    setTimeout(function () { if (!createViewer()) giveUp("rebuild failed"); }, 400);
  }

  function createViewer() {
    const Cesium = window.Cesium;
    let v;
    try {
      v = new Cesium.Viewer("globe", {
        baseLayer: false,
        baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
        navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false,
        scene3DOnly: true,
        showRenderLoopErrors: false            // no red error panel: we handle errors ourselves
      });
    } catch (err) {
      log("could not create the viewer", err);
      return false;
    }
    viewer = v;

    try {
      v.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: imagery.url,
        maximumLevel: imagery.maximumLevel,
        credit: imagery.credit
      }));

      const controls = v.scene.screenSpaceCameraController;
      controls.minimumZoomDistance = 300;
      controls.maximumZoomDistance = START.height * 1.15;
      v.scene.globe.baseColor = Cesium.Color.BLACK;
      v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(START.lon, START.lat, START.height) });

      v.scene.preRender.addEventListener(function () {
        try { EarthMode.height(v.camera.positionCartographic.height); }
        catch (err) { /* a hint-bar problem must never stop rendering */ }
      });

      v.scene.renderError.addEventListener(function (scene, error) {
        setTimeout(function () { if (viewer === v) recover(error); }, 0);
      });

      v.scene.canvas.addEventListener("webglcontextlost", function (event) {
        event.preventDefault();
        setTimeout(function () { if (viewer === v) recover("WebGL context lost"); }, 0);
      });
    } catch (err) {
      log("could not set up the globe", err);
      destroyViewer();
      return false;
    }

    const attrib = document.getElementById("attrib");
    if (attrib) attrib.innerHTML = imagery.label + " &middot; Globe by CesiumJS";

    if (!wired) {
      wired = true;
      EarthMode.init({
        start: START.height,
        // always talks to the current viewer, so a rebuilt globe is picked up automatically
        setInputs: function (on) {
          if (viewer && !viewer.isDestroyed()) viewer.scene.screenSpaceCameraController.enableInputs = on;
        }
      });
    } else {
      EarthMode.sync();                           // new viewer starts with inputs on; match the page state
    }
    return true;
  }

  // ---------- start ----------

  loadCesium(0, function (ok) {
    if (!ok) { log("Cesium could not be loaded from any source, using the plain background"); return; }
    pickImagery(0, function (chosen) {
      imagery = chosen;
      if (!createViewer()) giveUp("first start failed");
    });
  });
})();