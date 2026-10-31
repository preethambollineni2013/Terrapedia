// globe.js
// Satellite Earth behind the page (CesiumJS + Esri World Imagery).
// Controls stay off until EarthMode switches them on (triple-click in earth-mode.js).
// If Cesium fails to load (offline), the page keeps its plain dark background.

(function () {
  if (!window.Cesium) return;

  const START = { lon: 78, lat: 20, height: 17000000 }; // whole-Earth starting view

  let viewer;
  try {
    viewer = new Cesium.Viewer("globe", {
      baseLayer: false,
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false
    });
  } catch (err) {
    console.warn("Globe unavailable:", err);
    return;
  }

  // Satellite imagery, sharp enough to see streets at city level
  viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit: "Imagery © Esri, Maxar, Earthstar Geographics"
  }));

  const controls = viewer.scene.screenSpaceCameraController;
  controls.minimumZoomDistance = 300;
  controls.maximumZoomDistance = START.height * 1.15;
  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(START.lon, START.lat, START.height) });

  viewer.scene.preRender.addEventListener(function () {
    EarthMode.height(viewer.camera.positionCartographic.height);
  });

  EarthMode.init({
    start: START.height,
    setInputs: function (on) { controls.enableInputs = on; }
  });
})();
