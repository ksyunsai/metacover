/* Screen display of the 50-year local river raster, rendered for the current map extent. */
(() => {
  'use strict';

  const server = 'https://portal.esrikr.com/arcgis/rest/services/LocalRiver_Flood_50year/ImageServer/exportImage';
  const palette = [[135, 213, 222], [58, 168, 199], [54, 126, 196], [83, 85, 168], [106, 51, 137]];
  const labels = ['0.5m 이하', '0.5~1m', '1~2m', '2~5m', '5m 이상'];
  const colorKey = (r, g, b) => r * 65536 + g * 256 + b;
  const classes = new Map(palette.map(([r, g, b], i) => [colorKey(r, g, b), i + 1]));
  const limit = 20037508.342789244;
  // ImageServer/rasterAttributeTable maps values 5,1,2,3,4 to N330..N334.
  const sourceValues = [5, 1, 2, 3, 4];
  const renderRule = JSON.stringify({
    rasterFunction: 'Colormap',
    rasterFunctionArguments: {Colormap: palette.map((rgb, i) => [sourceValues[i], ...rgb])}
  });

  function project(lon, lat) {
    return [lon / 180 * limit, Math.asinh(Math.tan(lat * Math.PI / 180)) * limit / Math.PI];
  }

  function projectedAreas() {
    const result = {};
    for (const [id, geom] of Object.entries(window.MetaDistrictShapes || {})) {
      const rings = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
      result[id] = rings.map(poly => poly.map(ring => ring.map(([x, y]) => project(x, y))));
    }
    return result;
  }

  function boundsOf(polygons) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygons) for (const ring of poly) for (const [x, y] of ring) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
    return box;
  }

  function create(container, onStatus = () => {}, onReady = () => {}) {
    container.style.cssText += ';position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    container.append(canvas);
    const ctx = canvas.getContext('2d');
    const geometry = projectedAreas();
    const districts = {all: Object.values(geometry).flat(), ...geometry};
    const bounds = Object.fromEntries(Object.entries(districts).map(([id, polygons]) => [id, boundsOf(polygons)]));
    let view, patch, timer, pending, nextExtent, lastStatus;
    const notes = message => {
      if (lastStatus === message) return;
      lastStatus = message;
      onStatus(message);
    };

    function draw() {
      if (!view) return;
      const {width, height, x, y, unit, district} = view;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      if (!view.visible || !patch || patch.district !== district) return;
      const [west, south, east, north] = patch.box;
      ctx.drawImage(patch.display, (west - x) / unit + width / 2, (y - north) / unit + height / 2,
        (east - west) / unit, (north - south) / unit);
    }

    function extent() {
      const {width, height, x, y, district, unit} = view;
      const boundsForArea = bounds[district];
      if (!boundsForArea || !Number.isFinite(boundsForArea[0])) return null;
      const halfW = width * unit * 0.64, halfH = height * unit * 0.64;
      const west = Math.max(boundsForArea[0], x - halfW), south = Math.max(boundsForArea[1], y - halfH);
      const east = Math.min(boundsForArea[2], x + halfW), north = Math.min(boundsForArea[3], y + halfH);
      if (west >= east || south >= north) return null;
      // Use square on-the-ground pixels. Rounding the bounds to this same grid prevents
      // the server from silently expanding an imprecise aspect ratio on extremely narrow extents.
      const cell = Math.max(unit / 2, (east - west) / 1376, (north - south) / 1200);
      const w = Math.ceil((east - west) / cell), h = Math.ceil((north - south) / cell);
      return {box:[west, north - h * cell, west + w * cell, north], w, h, cell, district, zoom:view.zoom, unit};
    }

    function covers(saved, desired) {
      if (!saved || !desired || saved.district !== desired.district || Math.abs(saved.zoom - desired.zoom) > 0.25) return false;
      const {x, y, width, height, unit, district} = view, [w,s,e,n] = saved.box, boundsForArea = bounds[district];
      const tolerance = saved.cell;
      return Math.max(boundsForArea[0], x - width * unit / 2) >= w - tolerance &&
        Math.max(boundsForArea[1], y - height * unit / 2) >= s - tolerance &&
        Math.min(boundsForArea[2], x + width * unit / 2) <= e + tolerance &&
        Math.min(boundsForArea[3], y + height * unit / 2) <= n + tolerance;
    }

    function clipPolygon(target, spec) {
      const path = new Path2D();
      const [west,,, north] = spec.box;
      for (const polygon of districts[spec.district]) for (const ring of polygon) {
        ring.forEach(([x, y], i) => {
          const px = (x - west) / spec.cell, py = (north - y) / spec.cell;
          if (i === 0) path.moveTo(px, py);
          else path.lineTo(px, py);
        });
        path.closePath();
      }
      target.clip(path, 'evenodd');
    }

    function buildPatch(img, spec) {
      const picture = document.createElement('canvas');
      picture.width = spec.w;
      picture.height = spec.h;
      const g = picture.getContext('2d', {willReadFrequently:true});
      g.save();
      clipPolygon(g, spec);
      g.drawImage(img, 0, 0, spec.w, spec.h);
      g.restore();
      const raster = g.getImageData(0, 0, spec.w, spec.h);
      const data = raster.data;
      const ids = new Uint8Array(spec.w * spec.h);
      let opaque = 0, unexpected = 0;
      for (let j = 0, i = 0; j < data.length; j += 4, i++) {
        if (data[j + 3] < 128) { data[j + 3] = 0; continue; }
        opaque++;
        ids[i] = classes.get(colorKey(data[j],data[j + 1],data[j + 2])) || 0;
        if (!ids[i]) { unexpected++; data[j + 3] = 0; }
      }
      if (opaque && unexpected > opaque * 0.5) throw new Error('Unrecognized flood image');
      g.putImageData(raster, 0, 0);
      const showEdge = spec.zoom <= 13;
      if (showEdge) {
        const outline = document.createElement('canvas');
        outline.width = spec.w; outline.height = spec.h;
        const outlineCtx = outline.getContext('2d');
        outlineCtx.drawImage(picture, 0, 0);
        outlineCtx.globalCompositeOperation = 'source-in';
        outlineCtx.fillStyle = '#bd2357'; outlineCtx.fillRect(0, 0, spec.w, spec.h);
        const r = Math.max(1, Math.min(6, Math.round((spec.zoom < 11.8 ? 2 : 1.15) * spec.unit / spec.cell)));
        g.save(); clipPolygon(g, spec); g.globalCompositeOperation = 'destination-over';
        for (let i = 0; i < 12; i++) {
          const a = Math.PI * i / 6;
          g.drawImage(outline, Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)));
        }
        g.restore();
      }
      return {...spec, display:picture, ids};
    }

    async function load(spec) {
      const controller = new AbortController();
      pending = {spec, controller};
      const timeLimit = setTimeout(() => controller.abort(), 26000);
      const url = new URL(server);
      url.search = new URLSearchParams({
        f:'image', bbox:spec.box.join(','), bboxSR:'3857', imageSR:'3857',
        size:spec.w + ',' + spec.h, format:'png32',
        interpolation:'RSP_NearestNeighbor', renderingRule:renderRule
      });
      try {
        const response = await fetch(url, {signal:controller.signal, credentials:'omit'});
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image service unavailable');
        const image = await createImageBitmap(await response.blob());
        try {
          if (pending?.controller !== controller || !view.visible || view.district !== spec.district) return;
          patch = buildPatch(image, spec);
          draw(); notes(''); onReady();
        } finally { image.close(); }
      } catch {
        if (pending?.controller === controller) notes('범람 지도를 불러오지 못했습니다. 레이어를 다시 켜거나 공식 지도를 열어 주세요.');
      } finally {
        clearTimeout(timeLimit);
        if (pending?.controller === controller) pending = null;
      }
    }

    function render(camera) {
      const {lon, lat, zoom} = camera;
      if (![lon, lat, zoom, camera.width, camera.height].every(Number.isFinite) || camera.width < 1 || camera.height < 1) return;
      const [x, y] = project(lon, lat);
      view = {...camera, x, y, width:Math.round(camera.width), height:Math.round(camera.height),
        district:String(camera.district || 'all'), visible:camera.visible !== false, unit:limit * 2 / (256 * 2 ** zoom)};
      container.hidden = !view.visible;
      draw();
      nextExtent = view.visible ? extent() : null;
      clearTimeout(timer);
      if (!nextExtent) {
        pending?.controller.abort(); pending = null; notes(''); return;
      }
      if (covers(patch, nextExtent)) {
        pending?.controller.abort(); pending = null; notes(''); return;
      }
      if (covers(pending?.spec, nextExtent)) return;
      pending?.controller.abort(); pending = null;
      notes('예상 침수 깊이를 불러오는 중입니다.');
      timer = setTimeout(() => load(nextExtent), patch ? 140 : 60);
    }

    function depthAt(lon, lat) {
      if (!view?.visible || !patch || view.district !== patch.district ||
          Math.abs(view.zoom - patch.zoom) > 0.25 || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const [x,y] = project(lon,lat), [w,,,n] = patch.box;
      const col = Math.floor((x - w) / patch.cell), row = Math.floor((n - y) / patch.cell);
      if (col < 0 || row < 0 || col >= patch.w || row >= patch.h) return null;
      return labels[patch.ids[row * patch.w + col] - 1] || null;
    }
    return {render, depthAt};
  }
  window.MetaFlood = {create};
})();
