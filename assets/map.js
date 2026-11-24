(() => {
  "use strict";
  const cities = ["수원시", "용인시", "오산시"];
  const records = (window.METACOVER_RECORDS || []).filter(record => cities.includes(record.city)).slice();
  function dateKey(value) {
    const parts = value.match(/\d+/g) || [];
    return Number(parts[0] || 0) * 10000 + Number(parts[1] || 0) * 100 + Number(parts[2] || 0);
  }
  records.sort((a, b) => dateKey(b.date) - dateKey(a.date));
  const boundaries = window.METACOVER_DISTRICTS || [];
  const el = id => document.getElementById(id);
  const city = el("city"), district = el("district"), list = el("record-list");
  const mapPane = el("osm-map"), fallback = el("fallback"), detail = el("detail");
  const svgns = "http://www.w3.org/2000/svg";
  let selected = null, active = records, map = null, pins = null, tiles = null, tileAvailable = false;
  let retryTimer = null;
  const index = record => records.indexOf(record) + 1;
  function make(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function graphic(tag, attributes, text) {
    const item = document.createElementNS(svgns, tag);
    for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value);
    if (text !== undefined) item.textContent = text;
    return item;
  }
  function districtName(boundary) {
    return boundary.name.replace(/^(수원시|용인시|오산시)/, "");
  }
  function activeBoundaries() {
    return boundaries.filter(b => (!city.value || b.name.startsWith(city.value)) && (!district.value || b.name === district.value));
  }
  function updateDistricts() {
    district.replaceChildren(new Option(city.value === "오산시" ? "구 구분 없음" : "전체", ""));
    for (const item of boundaries.filter(b => districtName(b) && (!city.value || b.name.startsWith(city.value))).sort((a,b) => a.name.localeCompare(b.name,"ko"))) {
      district.add(new Option(city.value ? districtName(item) : item.name.replace("시", "시 "), item.name));
    }
    district.disabled = city.value === "오산시";
  }
  function updateSelection(moveMap = true) {
    const area = district.value && district.value.slice(district.value.indexOf("시") + 1);
    active = records.filter(record => (!city.value || record.city === city.value) && (!area || record.area.includes(area)));
    if (!active.includes(selected)) selected = null;
    el("count").textContent = active.length + "건";
    el("map-title").textContent = district.value ? district.value.replace("시", "시 ") : city.value || "전체 지역";
    drawList(); drawDetail(); drawContext(); drawPins();
    if (map && moveMap) fitMap();
  }
  function drawList() {
    list.replaceChildren();
    for (const record of active) {
      const row = make("button", undefined, "record-row");
      row.type = "button"; row.dataset.id = record.id;
      row.setAttribute("aria-pressed", String(selected === record));
      const name = make("span"); name.append(make("strong",record.title),make("small",record.date+" · "+record.city+" "+record.area));
      const arrow = make("span","›","chev"); arrow.setAttribute("aria-hidden","true");
      row.append(make("span",String(index(record)),"num"),name,arrow);
      row.addEventListener("click",() => choose(record, true));
      list.append(row);
    }
    if (!active.length) list.append(make("p","선택한 지역에 수록된 기록이 없습니다.","empty"));
  }
  function drawDetail() {
    detail.replaceChildren();
    if (!selected) {
      detail.append(make("h2","기록 상세"),make("p","지도에서 번호를 누르거나 목록에서 기록을 선택하면 피해 내용과 출처를 볼 수 있습니다.","intro"));
      return;
    }
    detail.append(make("p",selected.city+" "+selected.area+" · "+selected.date,"meta"),make("h2",selected.title),
      make("p",selected.summary,"account"),make("p","표시 위치 · "+selected.locationNote,"locnote"));
    const sources = make("div",undefined,"source");
    sources.append(make("b","출처"));
    for (const source of selected.sources) {
      const link = make("a",source.label+" ↗");
      link.href = source.url; link.target = "_blank"; link.rel = "noopener"; sources.append(link);
    }
    detail.append(sources);
  }
  function choose(record, fromList) {
    selected = record;
    for (const row of list.querySelectorAll(".record-row")) row.setAttribute("aria-pressed", String(row.dataset.id === record.id));
    drawDetail(); drawContext(); drawPins();
    if (map) map.setView([record.lat,record.lng],Math.max(map.getZoom(),15),{animate:false});
    if (fromList && window.matchMedia("(max-width:650px)").matches) el("map-pane").scrollIntoView({block:"start"});
  }
  function limits(pairs) {
    return pairs.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],
      [Infinity,Infinity,-Infinity,-Infinity]);
  }
  function drawContext() {
    const width = Math.max(fallback.clientWidth, 320), height = Math.max(fallback.clientHeight, 216);
    const shapes = activeBoundaries(), locations = shapes.flatMap(s => s.ring).concat(active.map(r=>[r.lng,r.lat]));
    if (!locations.length) return;
    const extent = limits(locations), centerX = (extent[0]+extent[2])/2, centerY = (extent[1]+extent[3])/2;
    const sx = 0.796, scale = Math.min((width-44)/Math.max(.012,(extent[2]-extent[0])*sx),(height-46)/Math.max(.012,extent[3]-extent[1]));
    const position = ([lng,lat]) => [(lng-centerX)*sx*scale+width/2, (centerY-lat)*scale+height/2];
    const svg = graphic("svg",{viewBox:"0 0 "+width+" "+height,role:"group","aria-label":"수원·용인·오산 참고도. 번호를 선택하면 기록을 확인할 수 있습니다."});
    const areaColors = {"수원시":"#c9dacb","용인시":"#dce4ce","오산시":"#e5d9c7"};
    for (const shape of boundaries) {
      const place = cities.find(name => shape.name.startsWith(name));
      const visible = shapes.includes(shape);
      const points = shape.ring.map(position).map(p => p.map(n=>n.toFixed(1)).join(",")).join(" ");
      svg.append(graphic("polygon",{points,fill:visible?areaColors[place]:"#e7eae2",stroke:visible?"#9ead9d":"#c9d1c7","stroke-width":"1.2","stroke-linejoin":"round"}));
    }
    const labels = [
      ["수원시",126.984,37.286],["용인시",127.235,37.223],["오산시",127.055,37.171]
    ];
    for (const [name,lng,lat] of labels) {
      if (city.value && city.value !== name) continue;
      const [x,y] = position([lng,lat]);
      svg.append(graphic("text",{x,y,"text-anchor":"middle",fill:"#44604e","paint-order":"stroke",stroke:"#f6f8ef","stroke-width":3,"font-size":14,"font-weight":700},name));
    }
    for (const record of active) {
      const [x,y] = position([record.lng,record.lat]), n = index(record);
      const marker = graphic("g",{transform:"translate("+x+" "+y+")",role:"button",tabindex:"0","aria-label":n+"번 "+record.title,style:"cursor:pointer"});
      if(record === selected) marker.append(graphic("circle",{r:16,fill:"none",stroke:"#793623","stroke-width":2}));
      marker.append(graphic("circle",{r:12.5,fill:record === selected?"#742e20":"#aa432c",stroke:"white","stroke-width":2}),
        graphic("text",{"text-anchor":"middle",y:4.5,fill:"white","font-size":12,"font-family":"Arial,sans-serif","font-weight":700},String(n)));
      marker.addEventListener("click",() => choose(record,false));
      marker.addEventListener("keydown",event => {
        if(event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose(record,false);
        const heading = detail.querySelector("h2");
        heading.tabIndex = -1;
        heading.focus({preventScroll:true});
      });
      svg.append(marker);
    }
    fallback.replaceChildren(svg);
  }
  function drawPins() {
    if (!map) return;
    pins.clearLayers();
    for (const record of active) {
      const n = index(record), icon = L.divIcon({className:"",html:'<span class="map-dot'+(selected===record?" active":"")+'">'+n+'</span>',iconSize:[28,28],iconAnchor:[14,14]});
      const marker = L.marker([record.lat,record.lng],{icon,title:n+"번 "+record.title,alt:n+"번 "+record.title,riseOnHover:true,zIndexOffset:record===selected?500:0});
      marker.addTo(pins).on("click",()=>choose(record,false));
    }
  }
  function fitMap() {
    const areas = activeBoundaries();
    const locations = areas.flatMap(s=>s.ring.map(([lng,lat])=>[lat,lng]));
    if (!locations.length) return;
    map.invalidateSize(false);
    map.fitBounds(locations,{padding:[12,12],maxZoom:15,animate:false});
  }
  function showTiles(enabled) {
    tileAvailable = enabled;
    mapPane.style.visibility = enabled ? "visible":"hidden";
    fallback.style.visibility = enabled ? "hidden":"visible";
    fallback.setAttribute("aria-hidden",String(enabled));
    mapPane.setAttribute("aria-hidden",String(!enabled));
    el("fallback-credit").hidden = enabled;
    el("map-mode").textContent = enabled ? "상세 도로지도" : "행정구역 참고도";
  }
  function startMap() {
    if (map || !window.L || !window.metacoverCssReady) return;
    try {
      mapPane.hidden = false;
      map = L.map(mapPane,{zoomControl:false,minZoom:8,maxZoom:19,scrollWheelZoom:true,attributionControl:true});
      L.control.zoom({position:"topright",zoomInTitle:"확대",zoomOutTitle:"축소"}).addTo(map);
      map.attributionControl.setPrefix(false);
      pins = L.layerGroup().addTo(map);
      tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'});
      let loaded = 0, failed = 0;
      tiles.on("loading",()=>{loaded=0;failed=0;});
      tiles.on("tileload",()=>{loaded++;clearTimeout(retryTimer);showTiles(true);});
      tiles.on("tileerror",()=>{failed++;});
      tiles.on("load",()=>{if (!loaded && failed){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(!loaded)showTiles(false);},350);}});
      showTiles(false); fitMap(); drawPins(); tiles.addTo(map);
      if(selected) map.setView([selected.lat,selected.lng],15,{animate:false});
    } catch {
      map = null; pins = null; mapPane.hidden = true;showTiles(false);
    }
  }
  city.addEventListener("change",()=>{selected=null;updateDistricts();updateSelection();});
  district.addEventListener("change",()=>{
    selected=null;
    if(district.value && !city.value){const value=district.value;city.value=cities.find(n=>value.startsWith(n));updateDistricts();district.value=value;}
    updateSelection();
  });
  el("overview").addEventListener("click",()=>{selected=null;city.value="";updateDistricts();updateSelection();if(map && !tileAvailable)tiles.redraw();});
  const help = el("help");
  el("help-open").addEventListener("click",()=>help.showModal());
  el("help-close").addEventListener("click",()=>help.close());
  help.addEventListener("click",event=>{if(event.target===help){const box=help.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)help.close();}});
  window.addEventListener("map-library-ready",startMap);
  if(window.ResizeObserver){
    const observer = new ResizeObserver(()=>{drawContext();if(map)map.invalidateSize(false);});
    observer.observe(el("map-body"));
  }
  updateDistricts();updateSelection(false);startMap();
})();
