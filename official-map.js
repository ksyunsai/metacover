"use strict";

const area = document.getElementById("area");
const official = document.getElementById("open-official");
const originalMap = document.getElementById("official-map");
const serviceUrl = new URL(originalMap.dataset.src);

// Open the official 50-year layer around a point the visitor picked on the overview.
const requested = new URLSearchParams(window.location.search);
function boundedParam(name, min, max) {
  const raw = requested.get(name);
  if (!raw || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
const lon = boundedParam("lon", 126, 128.5);
const lat = boundedParam("lat", 36.5, 38.5);
if (lon !== null && lat !== null) {
  const point = new Option("선택한 위치", "point");
  point.dataset.center = lon.toFixed(5) + "," + lat.toFixed(5);
  point.dataset.range = String(Math.round(boundedParam("range", 1000, 100000) ?? 6000));
  area.add(point);
  area.value = point.value;
} else if (Array.from(area.options).some(option => option.value === requested.get("area"))) {
  area.value = requested.get("area");
}

function openArea() {
  const choice = area.selectedOptions[0];
  const next = new URL(serviceUrl);
  next.hash = "climate_rain#rfm_sgg_rgn_41_050&freq=50&center=" +
    choice.dataset.center + "&range=" + choice.dataset.range;
  official.href = next.href;

  // A fresh document also works when the provider reads its camera only on startup.
  const current = document.getElementById("official-map");
  if (current.getAttribute("src") === next.href) return;
  const frame = current.hasAttribute("src") ? current.cloneNode(false) : current;
  frame.title = "경기기후지도 · 지방하천 50년 빈도 · " + choice.textContent;
  frame.src = next.href;
  if (frame !== current) current.replaceWith(frame);
  document.getElementById("map-status").textContent = choice.textContent + " 중심의 공식 지도를 여는 중입니다.";
}
area.addEventListener("change", openArea);
openArea();
window.addEventListener("pageshow", openArea);

const help = document.getElementById("help");
document.getElementById("open-help").addEventListener("click", () => help.showModal());
document.getElementById("close-help").addEventListener("click", () => help.close());
help.addEventListener("click", event => {
  if (event.target !== help) return;
  const r = help.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) help.close();
});
