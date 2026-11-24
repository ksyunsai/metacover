(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const select = $("area");
  const checkbox = $("flood-layer");
  const legend = document.querySelector(".legend");
  const notice = $("loading");
  const menu = $("layer-menu");
  const help = $("help");
  const floodRenderer = "publicRaster";
  const sources = {
    road: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxNativeZoom: 19,
      credit: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'
    },
    satellite: {
      url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg",
      maxNativeZoom: 14,
      credit: '<a href="https://cloudless.eox.at/">EOxCloudless</a> by <a href="https://eox.at/">EOX</a> · Contains modified Copernicus Sentinel data 2016 &amp; 2017 · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>'
    }
  };

  // Use the same district boundaries for the camera and the display mask.
  const regions = [
    ["41111", "수원시 장안구"], ["41113", "수원시 권선구"],
    ["41115", "수원시 팔달구"], ["41117", "수원시 영통구"],
    ["41461", "용인시 처인구"], ["41463", "용인시 기흥구"],
    ["41465", "용인시 수지구"], ["41370", "오산시"]
  ];

  function status(message, loading = false) {
    notice.hidden = !message;
    $("notice-link").hidden = loading;
    notice.querySelector("span").textContent = message;
  }

  $("help-open").addEventListener("click", () => help.showModal());
  $("help-close").addEventListener("click", () => help.close());
  help.addEventListener("click", event => {
    if (event.target !== help) return;
    const r = help.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) help.close();
  });

  if (!window.L) {
    status("지도를 불러오지 못했습니다.");
    return;
  }
  const all = L.latLngBounds([]);
  const boundsById = new Map();
  if (!regions.every(([id]) => window.MetaDistrictShapes?.[id])) {
    status("8개 지역의 지도 범위를 불러오지 못했습니다.");
    return;
  }
  for (const [id, name] of regions) {
    const extent = L.geoJSON(window.MetaDistrictShapes[id]).getBounds();
    boundsById.set(id, extent);
    all.extend(extent);
    select.add(new Option(name, id));
  }
  const map = L.map("viewport", {
    zoomControl: false, zoomAnimation: false, minZoom: 7, maxZoom: 19, zoomSnap: 0.25, zoomDelta: 1,
    maxBounds: all.pad(1.5), maxBoundsViscosity: 1, scrollWheelZoom: true
  });
  map.attributionControl.setPrefix(false);
  L.control.scale({ imperial: false }).addTo(map);
  let mode = "road";
  let background, backgroundMode, forecast, chosenPoint;
  let rasterStatus = "";
  const unavailable = { base: new Set(), forecast: new Set() };
  const pane = map.createPane("forecastDisplay");
  pane.style.zIndex = "350";
  pane.style.pointerEvents = "none";
  const canvasHost = L.DomUtil.create("div", "geographic-forecast leaflet-zoom-hide", pane);
  const raster = floodRenderer === "publicRaster" && window.MetaFlood
    ? window.MetaFlood.create(canvasHost, message => {
        rasterStatus = message;
        showTileStatus();
      }, () => {
        const popup = chosenPoint?.getPopup();
        if (popup?.isOpen()) updateDepth(popup.getContent(), chosenPoint.getLatLng());
      })
    : null;
  const rasterCredit = '범람 · 한강홍수통제소 / <a href="https://livingatlas.arcgis.com/">한국에스리 Living Atlas</a>';
  let rasterCredited = false;
  let frame = 0;

  function drawRaster() {
    frame = 0;
    if (!raster) return;
    const size = map.getSize();
    const center = map.getCenter();
    L.DomUtil.setPosition(canvasHost, map.containerPointToLayerPoint([0, 0]));
    canvasHost.style.width = size.x + "px";
    canvasHost.style.height = size.y + "px";
    canvasHost.hidden = !checkbox.checked;
    raster.render({ lon: center.lng, lat: center.lat, zoom: map.getZoom(),
      width: size.x, height: size.y, district: select.value, visible: checkbox.checked });
  }
  function scheduleDraw() {
    if (!frame && raster) frame = requestAnimationFrame(drawRaster);
  }

  function officialLink(point) {
    const args = new URLSearchParams({
      lon: point.lng.toFixed(5),
      lat: point.lat.toFixed(5),
      range: "6000"
    });
    return "./live/?" + args;
  }

  function showTileStatus() {
    if (checkbox.checked && floodRenderer === "publicRaster" && !window.MetaFlood) {
      status("범람 지도 연결을 불러오지 못했습니다.");
    } else if (checkbox.checked && rasterStatus) {
      status(rasterStatus, rasterStatus.includes("불러오는 중"));
    } else if (unavailable.forecast.size && checkbox.checked) {
      status("이 범위의 범람 지도를 불러오지 못했습니다.");
    } else if (unavailable.base.size) {
      status("배경지도의 일부를 불러오지 못했습니다.");
    } else {
      status("");
    }
  }

  function watchTiles(layer, kind) {
    const errors = unavailable[kind];
    layer.on("tileerror", e => { errors.add(e.tile); showTileStatus(); });
    layer.on("tileload tileunload", e => { errors.delete(e.tile); showTileStatus(); });
    return layer;
  }

  function changeLayers() {
    if (forecast) forecast.remove();
    unavailable.forecast.clear();
    if (backgroundMode !== mode) {
      if (background) background.remove();
      unavailable.base.clear();
      const source = sources[mode];
      background = watchTiles(L.tileLayer(source.url, {
        attribution: source.credit, maxNativeZoom: source.maxNativeZoom, minZoom: 7, maxZoom: 19,
        noWrap: true, keepBuffer: 1
      }), "base").addTo(map);
      backgroundMode = mode;
    }
    forecast = null;
    if (checkbox.checked && floodRenderer === "composite") {
      const tileSource = "https://metacover-flood-atlas-kr.ksyunsai.chatgpt.site/map/" + mode + "/{z}/{x}/{y}.png";
      forecast = watchTiles(L.tileLayer(tileSource, {
        attribution: '<a href="https://www.floodmap.go.kr/nation/">한강홍수통제소</a>',
        bounds: all.pad(0.04), minZoom: 7, maxZoom: 19,
        noWrap: true, keepBuffer: 1, zIndex: 2
      }), "forecast").addTo(map);
    }
    const needsCredit = Boolean(raster && checkbox.checked);
    if (needsCredit !== rasterCredited) {
      if (needsCredit) map.attributionControl.addAttribution(rasterCredit);
      else map.attributionControl.removeAttribution(rasterCredit);
      rasterCredited = needsCredit;
    }
    $("raster-source").hidden = floodRenderer !== "publicRaster";
    scheduleDraw();
    const popup = chosenPoint?.getPopup();
    if (popup?.isOpen()) updateDepth(popup.getContent(), chosenPoint.getLatLng());
    legend.classList.toggle("off", !checkbox.checked);
    $("road").setAttribute("aria-pressed", String(mode === "road"));
    $("satellite").setAttribute("aria-pressed", String(mode === "satellite"));
    showTileStatus();
  }

  function fit() {
    if (chosenPoint) map.removeLayer(chosenPoint);
    chosenPoint = null;
    map.closePopup();
    const bounds = boundsById.get(select.value) || all;
    const padding = map.getSize().x < 600 ? [17, 38] : [50, 39];
    map.fitBounds(bounds, { padding, maxZoom: 15, animate: false });
    $("view-label").textContent = select.selectedOptions[0].textContent;
    const link = select.value === "all" ? "./live/" : officialLink(bounds.getCenter());
    $("official-link").href = $("notice-link").href = link;
    scheduleDraw();
  }

  function updateDepth(content, point) {
    const text = content.querySelector(".depth");
    const depth = checkbox.checked && raster?.depthAt(point.lng, point.lat);
    text.hidden = !depth;
    text.textContent = depth ? "예상 침수 깊이 " + depth : "";
  }

  function selectPoint(event) {
    const point = event.latlng;
    if (chosenPoint) map.removeLayer(chosenPoint);
    chosenPoint = L.circleMarker(point, {
      radius: 6, weight: 2, color: "#fff", fillColor: "#133c58", fillOpacity: 1
    }).addTo(map);
    const content = $("point-template").content.firstElementChild.cloneNode(true);
    content.querySelector(".coordinates").textContent = point.lat.toFixed(5) + "°N, " + point.lng.toFixed(5) + "°E";
    updateDepth(content, point);
    content.querySelector("a").href = officialLink(point);
    const zoomHere = content.querySelector("button");
    zoomHere.disabled = map.getZoom() >= map.getMaxZoom();
    zoomHere.addEventListener("click", () => {
      map.closePopup();
      map.setView(point, Math.min(map.getMaxZoom(), map.getZoom() + 2));
    });
    chosenPoint.bindPopup(content, { offset: [0, -5], maxWidth: 230, autoPanPadding: [15, 45] }).openPopup();
  }

  function menuOpen(open) {
    menu.hidden = !open;
    $("layers").setAttribute("aria-expanded", String(open));
  }
  $("layers").addEventListener("click", () => menuOpen(menu.hidden));
  document.addEventListener("click", e => {
    if (!menu.hidden && !menu.contains(e.target) && !$("layers").contains(e.target)) menuOpen(false);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") menuOpen(false); });
  select.addEventListener("change", fit);
  $("reset").addEventListener("click", () => { select.value = "all"; fit(); });
  $("zoom-in").addEventListener("click", () => map.zoomIn());
  $("zoom-out").addEventListener("click", () => map.zoomOut());
  for (const type of Object.keys(sources)) {
    $(type).addEventListener("click", () => { if (type !== mode) { mode = type; changeLayers(); } });
  }
  checkbox.addEventListener("change", changeLayers);
  map.on("click", selectPoint);
  map.on("move zoom resize viewreset", scheduleDraw);
  map.on("zoomend", () => {
    $("zoom-in").disabled = map.getZoom() >= map.getMaxZoom();
    $("zoom-out").disabled = map.getZoom() <= map.getMinZoom();
  });
  map.on("moveend", () => { $("notice-link").href = officialLink(map.getCenter()); });
  fit();
  changeLayers();
})();
