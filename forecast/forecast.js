"use strict";
const river50ManifestUrl = './river50/manifest.json';
let river50ViewTimer = null;
let river50ViewKey = '';
const river50PartCache = new Map();
const river50Pending = new Map();
const river50AllId = '__all__';
const river50MaxRequests = 3;
// On unusually wide high-zoom views, keep an entire district's overview
// available while the user zooms in to a manageable set of original vectors.
const river50ViewVertexBudget = 550000;
let river50ActiveView = null;
let river50DrawnParts = [];

function river50DepthLegend(classes) {
  const verified = S.river50Manifest.depthVerified === true;
  $('river50-legend').querySelector('b').textContent = verified ? '50년 빈도 예상 침수심' : '50년 빈도 예상 범람 구역';
  if (!verified) {
    const strip = el('span');
    strip.style.gap = '0';
    strip.setAttribute('aria-hidden','true');
    for (const item of classes) {
      const swatch = el('i');
      swatch.style.backgroundColor = river50Color(item.grade);
      strip.append(swatch);
    }
    $('river50-depths').replaceChildren(strip);
    return;
  }
  const chips = classes.map(({grade, label}) => {
    const chip = el('span');
    const swatch = el('i');
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.backgroundColor = river50Color(grade);
    chip.append(swatch, document.createTextNode(label));
    return chip;
  });
  $('river50-depths').replaceChildren(...chips);
}

function river50Intersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

async function river50Part(part, signal) {
  const data = await readRiver50Json(part.url, signal);
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error();
  for (const feature of data.features) feature.river50DistrictId = part.district.id;
  if (!signal.aborted) {
    river50PartCache.set(part.key, data.features);
    if (river50PartCache.size > 6) river50PartCache.delete(river50PartCache.keys().next().value);
  }
  return data.features;
}

function scheduleRiver50View(delay) {
  clearTimeout(river50ViewTimer);
  river50ViewTimer = setTimeout(refreshRiver50View, delay);
}

function river50ViewGroups(selection, bounds) {
  const candidates = selection.id === river50AllId ? S.river50Manifest.districts : [selection];
  const groups = [];
  for (const district of candidates) {
    if (!river50Intersects(bounds,district.bbox)) continue;
    const overview = district.overview?.file ? {
      district,url:river50FileUrl(district.overview.file),
      highlightUrl:district.overview.highlight ? river50FileUrl(district.overview.highlight) : null
    } : null;
    const group = {district, overview, coarse:Boolean(overview && S.z <= 13), deferred:false, parts:[], cost:0};
    if (!group.coarse) {
      const files = district.files || (district.file ? [{file:district.file}] : []);
      for (const entry of files) {
        const file = typeof entry === 'string' ? entry : entry.file;
        if (!file || !river50Intersects(bounds,entry.bbox || district.bbox)) continue;
        const url = river50FileUrl(file);
        group.parts.push({district,url,key:district.id+'|'+url});
        group.cost += entry.vertexCount || Math.ceil((entry.bytes || 900000)/30);
      }
    }
    groups.push(group);
  }
  // Favor smaller adjoining districts so that one dense area cannot hold up
  // detail in the rest of the viewport. Source order still governs drawing.
  let remaining = river50ViewVertexBudget;
  for (const group of [...groups].sort((a,b)=>a.cost-b.cost)) {
    if (group.cost > remaining && group.overview) {
      group.deferred = true;
      group.parts = [];
    } else remaining -= group.cost;
  }
  return groups;
}

function stopRiver50View() {
  river50ActiveView?.resolve();
  river50ActiveView = null;
  river50ViewKey = '';
  river50DrawnParts = [];
  for (const request of river50Pending.values()) request.abort();
}

function publishRiver50View(view) {
  if (view !== river50ActiveView || S.source !== 'river50') return;
  const overviews = [], drawn = [];
  for (const group of view.groups) {
    const pending = group.parts.some(p => !view.loaded.has(p.key));
    if (group.overview && (group.coarse || group.deferred || pending)) overviews.push(group.overview);
    for (const part of group.parts) if (view.loaded.has(part.key)) drawn.push(view.loaded.get(part.key));
  }
  const previous = S.river50Overviews || [];
  const changedImages = previous.length !== overviews.length || previous.some((o,i) => o.url !== overviews[i].url);
  const changedParts = drawn.length !== river50DrawnParts.length || drawn.some((p,i) => p !== river50DrawnParts[i]);
  S.river50Overviews = overviews;
  if (changedParts) {
    river50DrawnParts = drawn;
    S.features = drawn.flat();
  }
  if (changedParts || changedImages) drawMap();
  const source = S.river50Manifest.source || '홍수위험지도 정보시스템';
  const prefix = view.selection.name + ' · 지방하천 50년 빈도 모의결과 · ';
  let message = '구역을 누르면 모의조건을 확인할 수 있습니다. · ' + source;
  if (view.failed.size) message = '일부 상세 구역을 불러오지 못했습니다. 새로고침 버튼으로 다시 조회하세요.';
  else if (view.loaded.size < view.parts.size) message = '화면 범위의 상세 구역을 불러오는 중';
  else if (S.z <= 12 && overviews.some(o => o.highlightUrl)) message = '분홍색 윤곽선을 누르면 해당 위치의 상세 지도로 확대합니다. · ' + source;
  else if (view.groups.some(g => g.coarse || g.deferred)) message = '지도를 확대하면 구역별 상세 조회 · ' + source;
  else if (!view.parts.size) message = '현재 지도 범위에 등록된 모의 구역이 없습니다.';
  $('feed-text').textContent = prefix + message;
  if (view.loaded.size + view.failed.size === view.parts.size) view.resolve();
}

function pumpRiver50Parts() {
  const view = river50ActiveView;
  if (!view) return;
  for (const [key,part] of view.parts) {
    if (river50Pending.size >= river50MaxRequests) break;
    if (view.loaded.has(key) || view.failed.has(key) || river50Pending.has(key)) continue;
    const controller = new AbortController();
    river50Pending.set(key, controller);
    river50Part(part,controller.signal).then(features => {
      if (!controller.signal.aborted && river50ActiveView?.parts.has(key)) river50ActiveView.loaded.set(key,features);
    }).catch(() => {
      if (!controller.signal.aborted && river50ActiveView?.parts.has(key)) river50ActiveView.failed.add(key);
    }).finally(() => {
      river50Pending.delete(key);
      if (river50ActiveView) publishRiver50View(river50ActiveView);
      pumpRiver50Parts();
    });
  }
}

function refreshRiver50View() {
  const district = S.river50District;
  if (S.source !== 'river50' || !district) return;
  const groups = river50ViewGroups(district,mapBounds());
  const key = JSON.stringify([district.id,S.z <= 12,groups.map(g => [g.district.id,g.coarse,g.deferred,g.parts.map(p=>p.key)])]);
  if (key === river50ViewKey) return river50ActiveView?.done;
  river50ViewKey = key;
  river50ActiveView?.resolve();
  const view = {selection:district,groups,parts:new Map(),loaded:new Map(),failed:new Set()};
  view.done = new Promise(resolve => {view.resolve = resolve});
  for (const group of groups) for (const part of group.parts) {
    view.parts.set(part.key,part);
    const loaded = river50ActiveView?.loaded.get(part.key) || river50PartCache.get(part.key);
    if (loaded) {
      view.loaded.set(part.key,loaded);
      if (river50PartCache.has(part.key)) {
        river50PartCache.delete(part.key);
        river50PartCache.set(part.key,loaded);
      }
    }
  }
  for (const [key,request] of river50Pending) if (!view.parts.has(key)) request.abort();
  river50ActiveView = view;
  publishRiver50View(view);
  pumpRiver50Parts();
  return view.done;
}

function loadRiver50District(id) {
  const district = id === river50AllId ? S.river50All :
    S.river50Manifest?.districts.find(item => String(item.id) === String(id));
  if (!district || S.source !== 'river50') return;
  stopRiver50View();
  S.river50District = district;
  S.river50Overviews = [];
  S.sel = null;
  S.features = [];
  S.fetchContext = scopeToken();
  $('river50-district').value = String(district.id);
  $('feed-text').textContent = district.name + ' · 지방하천 50년 빈도 모의자료를 불러오는 중';
  fitView();
  clearTimeout(river50ViewTimer);
  return refreshRiver50View();
}


const S = {
  source:'river50', center:[37.225,127.185], z:10, areas:true, tiles:true,
  features:[], sel:null, river50Overviews:[]
};

function scopeToken() {
  return 'river50|' + (S.river50District?.id || '');
}
function scheduleFeed(delay = 180) {
  if (S.river50District) scheduleRiver50View(delay);
}

async function installForecastManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.districts) || !manifest.districts.length ||
      !Array.isArray(manifest.classes) || !manifest.classes.length) throw Error('지역 자료 목록이 비어 있습니다.');
  const bounds = [Infinity,Infinity,-Infinity,-Infinity];
  for (const district of manifest.districts) {
    if (!district.name || !district.id || district.id === river50AllId ||
        !Array.isArray(district.bbox) || district.bbox.length !== 4 || !district.bbox.every(Number.isFinite)) {
      throw Error('지역 자료의 범위를 확인할 수 없습니다.');
    }
    const [w,s,e,n] = district.bbox;
    if (w >= e || s >= n || w < -180 || e > 180 || s < -85 || n > 85) throw Error('잘못된 지역 범위입니다.');
    bounds[0] = Math.min(bounds[0], w);
    bounds[1] = Math.min(bounds[1], s);
    bounds[2] = Math.max(bounds[2], e);
    bounds[3] = Math.max(bounds[3], n);
  }
  S.river50Manifest = manifest;
  S.river50All = {id:river50AllId,name:'전체 지역',bbox:bounds};
  const districts = [S.river50All,...manifest.districts];
  $('river50-district').replaceChildren(...districts.map(d => option(String(d.id),d.name)));
  $('river50-district').disabled = false;
  river50DepthLegend(manifest.classes);
  $('river50-legend').hidden = !S.areas;
  await loadRiver50District(river50AllId);
}

let manifestRequest = null;




function forecastSourceBlock(title, text, url, caption) {
  const section = el('section','modal-block');
  section.append(el('h3','',title),el('p','',text));
  if (typeof url === 'string' && /^https:\/\//i.test(url)) section.append(link(caption,url));
  return section;
}
function showForecastSources() {
  const manifest = S.river50Manifest;
  const body = $('modal-body');
  body.replaceChildren(forecastSourceBlock('지방하천 50년 빈도 홍수',
    '지방하천에 50년 빈도 홍수가 발생할 때 물이 퍼질 것으로 예상되는 범위를 표시합니다. 분홍색 윤곽선을 누르면 그 주변을 확대할 수 있습니다.'));
  if (manifest?.districts?.length) {
    body.append(forecastSourceBlock('조회 지역',manifest.districts.map(d => d.name).join(', ')));
  }
  if (manifest?.depthVerified) {
    body.append(forecastSourceBlock('예상 침수심',
      '지면에서 물이 차오를 것으로 예상되는 깊이입니다. 지도에서 색칠된 구역을 누르면 해당 위치의 수심 구간을 볼 수 있습니다.',
      manifest.depthSourceUrl,'침수심 구간 기준'));
  }
  body.append(forecastSourceBlock('자료 출처',manifest?.source || '한강홍수통제소 · 지방하천 하천범람지도',
    manifest?.sourceUrl || 'https://www.floodmap.go.kr/region/','홍수위험지도 정보시스템'));
  if (!$('dialog').open) $('dialog').showModal();
}

function initializeForecastPage() {
  paintIcons();
  if (!['#river50','#map'].includes(location.hash)) history.replaceState(null,'','#river50');
  $('river50-district').onchange = event => void loadRiver50District(event.target.value);
  $('map-home').onclick = event => {
    event.preventDefault();
    if (S.river50Manifest) void loadRiver50District(river50AllId);
    else { $('forecast-file').focus(); return; }
    $('map').focus({preventScroll:true});
  };
  $('retry').onclick = () => {
    if (!S.river50Manifest) { $('forecast-file').focus(); return; }
    river50ViewKey = '';
    void refreshRiver50View();
  };
  const panel = $('layer-box'), layers = $('layer-btn');
  function toggleLayers(open, focusButton = false) {
    panel.hidden = !open;
    layers.setAttribute('aria-expanded',String(open));
    if (open) $('forecast-areas').focus();
    else if (focusButton) layers.focus();
  }
  layers.onclick = () => toggleLayers(panel.hidden);
  $('close-layers').onclick = () => toggleLayers(false,true);
  document.addEventListener('click',event => {
    if (!panel.hidden && !panel.contains(event.target) && !layers.contains(event.target)) toggleLayers(false);
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && !panel.hidden && !$('dialog').open) toggleLayers(false,true);
  });
  $('forecast-areas').onchange = event => {
    S.areas = event.target.checked;
    if (!S.areas) S.sel = null;
    $('river50-legend').hidden = !S.areas || !S.river50Manifest;
    drawMap();
  };
  $('check-tiles').onchange = event => { S.tiles = event.target.checked; drawMap(); };
  $('sources').onclick = showForecastSources;
  $('close').onclick = () => $('dialog').close();
  $('dialog').addEventListener('click',event => {
    if (event.target !== $('dialog')) return;
    const bounds = $('dialog').getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('dialog').close();
  });
  initMap();
  initArchivePicker();
}

let localArchive = null;
let archiveSequence = 0, activeArchiveId = 0;

function river50FileUrl(file) {
  if (!localArchive) throw Error('지도 ZIP을 먼저 선택하세요.');
  return localArchive.images.get(file) || 'local-forecast:' + activeArchiveId + '/' + file;
}

function readRiver50Json(id, signal) {
  const prefix = 'local-forecast:' + activeArchiveId + '/';
  if (!localArchive || !id.startsWith(prefix)) throw Error('현재 ZIP의 지도 자료를 사용할 수 없습니다.');
  return localArchive.readPart(id.slice(prefix.length),signal);
}

async function chooseForecastArchive(file) {
  if (!file) return;
  const sequence = ++archiveSequence;
  const status = $('zip-status');
  status.textContent = '지도 ZIP을 확인하는 중입니다.';
  let candidate;
  try {
    candidate = await openForecastZip(file);
    if (sequence !== archiveSequence) { candidate.dispose(); return; }
    stopRiver50View();
    river50PartCache.clear();
    river50Images.clear();
    S.river50District = null;
    S.river50Overviews = [];
    S.features = [];
    S.sel = null;
    const previous = localArchive;
    localArchive = candidate;
    activeArchiveId = sequence;
    setImportedBackground(candidate.background);
    document.body.classList.remove('file-required');
    await installForecastManifest(candidate.manifest);
    previous?.dispose();
    if (sequence === archiveSequence) status.textContent = '';
  } catch (error) {
    if (sequence !== archiveSequence) return;
    if (candidate && candidate !== localArchive) candidate.dispose();
    status.textContent = '지도를 열 수 없습니다. 메타커버 지방하천 지도 전체 ZIP 파일을 선택해 주세요.';
  }
}

function initArchivePicker() {
  const input = $('forecast-file');
  input.addEventListener('click', () => { input.value = ''; });
  input.addEventListener('change', () => { void chooseForecastArchive(input.files[0]); });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) localArchive?.dispose();
  });
}

initializeForecastPage();
