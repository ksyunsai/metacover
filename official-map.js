"use strict";

const area = document.getElementById("area");
const official = document.getElementById("open-official");
const originalMap = document.getElementById("official-map");
const serviceUrl = new URL(originalMap.src);

function openArea() {
  const choice = area.selectedOptions[0];
  const next = new URL(serviceUrl);
  next.hash = "climate_rain#rfm_sgg_rgn_41_050&freq=50&center=" +
    choice.dataset.center + "&range=" + choice.dataset.range;
  official.href = next.href;

  // A fresh document also works when the provider reads its camera only on startup.
  const current = document.getElementById("official-map");
  if (current.src === next.href) return;
  const frame = current.cloneNode(false);
  frame.title = "경기기후지도 · 지방하천 50년 빈도 · " + choice.textContent;
  frame.src = next.href;
  current.replaceWith(frame);
  document.getElementById("map-status").textContent = choice.textContent + " 중심의 공식 지도를 여는 중입니다.";
}
area.addEventListener("change", openArea);
window.addEventListener("pageshow", openArea);

const help = document.getElementById("help");
document.getElementById("open-help").addEventListener("click", () => help.showModal());
document.getElementById("close-help").addEventListener("click", () => help.close());
help.addEventListener("click", event => {
  if (event.target !== help) return;
  const r = help.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) help.close();
});
