"use strict";

window.MetaBasemap = (() => {
  const providers = {
    street: {
      maxZoom: 19,
      name: "도로지도",
      url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      credits: [["© OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"]]
    },
    satellite: {
      maxZoom: 14,
      name: "위성영상",
      url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
      credits: [
        ["EOxCloudless", "https://cloudless.eox.at/"],
        ["by EOX IT Services GmbH", "https://eox.at/"],
        ["(Contains modified Copernicus Sentinel data 2016 & 2017) · CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"]
      ]
    }
  };

  function create(container, credit, onStatus = () => {}) {
    const tiles = new Map();
    let mode = null;
    let lastMessage = null;

    function report(message) {
      if (message === lastMessage) return;
      lastMessage = message;
      onStatus(message);
    }

    function setMode(next) {
      mode = next;
      tiles.clear();
      container.replaceChildren();
      credit.replaceChildren();
      container.hidden = credit.hidden = !mode;
      if (mode) {
        providers[mode].credits.forEach(([label, url], i) => {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = label;
          if (i) credit.append(" ");
          credit.append(link);
        });
      }
      report("");
    }

    function reportTileStatus() {
      if (!mode) return;
      const visible = Array.from(tiles.values());
      if (!visible.length || visible.some(tile => !tile.dataset.state)) return;
      const anyFailure = visible.some(tile => tile.dataset.state === "error");
      report(anyFailure ? providers[mode].name + "의 일부를 불러오지 못했습니다. 다시 선택하거나 범람예상도로 돌아가세요." : "");
    }

    function makeTile(url, key) {
      const image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      image.referrerPolicy = "strict-origin-when-cross-origin";
      image.style.cssText = "position:absolute;max-width:none;max-height:none;margin:0;pointer-events:none;user-select:none;border:0;";
      function finish(state) {
        if (tiles.get(key) !== image) return;
        image.dataset.state = state;
        if (state === "error") image.style.visibility = "hidden";
        reportTileStatus();
      }
      image.onload = () => finish("loaded");
      image.onerror = () => finish("error");
      tiles.set(key, image);
      container.append(image);
      image.src = url;
      return image;
    }

    function render({mode: next, lon, lat, zoom, width, height}) {
      const provider = providers[next];
      if (!provider || ![lon, lat, zoom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
      if (next !== mode) setMode(next);
      const z = Math.max(0, Math.min(provider.maxZoom, Math.round(zoom)));
      const count = 2 ** z;
      const size = 256 * 2 ** (zoom - z);
      const left = (lon + 180) / 360 * count - width / (2 * size);
      const phi = Math.min(85.05112878, Math.max(-85.05112878, lat)) * Math.PI / 180;
      const top = (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * count - height / (2 * size);
      const right = Math.ceil(left + width / size);
      const bottom = Math.min(count, Math.ceil(top + height / size));
      const needed = new Set();
      for (let y = Math.max(0, Math.floor(top)); y < bottom; y++) {
        for (let x = Math.floor(left); x < right; x++) {
          const key = `${z}/${x}/${y}`;
          needed.add(key);
          const tileX = ((x % count) + count) % count;
          const tile = tiles.get(key) || makeTile(provider.url(z, tileX, y), key);
          // Round both edges so neighboring scaled tiles meet at the same screen pixel.
          const px = Math.round((x - left) * size);
          const py = Math.round((y - top) * size);
          tile.style.left = px + "px";
          tile.style.top = py + "px";
          tile.style.width = Math.round((x + 1 - left) * size) - px + "px";
          tile.style.height = Math.round((y + 1 - top) * size) - py + "px";
        }
      }
      for (const [key, tile] of tiles) {
        if (!needed.has(key)) {
          tiles.delete(key);
          tile.remove();
        }
      }
      reportTileStatus();
    }
    return { render, hide: () => setMode(null) };
  }
  return { create };
})();
