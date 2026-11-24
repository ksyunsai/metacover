(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const screen = el('viewport'), plane = el('forecast-plane'), image = el('reference');
  const select = el('area'), flood = el('flood-layer'), popup = el('point-card');
  const regions = window.metacoverLocations;
  const locations = new Map(regions.areas.map(area => [area.id, area]));
  const full = regions.areas.reduce((r, a) => [
    Math.min(r[0], a.bounds[0]), Math.min(r[1], a.bounds[1]),
    Math.max(r[2], a.bounds[2]), Math.max(r[3], a.bounds[3])
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const sheet = {left: 2, top: 82, right: 1408, bottom: 686};
  const worldPixels = 360 * (regions.toPixel(128,37)[0] - regions.toPixel(127,37)[0]);
  const initialUrl = image.src;
  let mode = 'forecast', wantFlood = true, failed = false;
  let camera = {x: 0, y: 0, scale: 1}, w = 0, h = 0, minScale = 1, fitted = true;
  let selectedPoint = null, paintFrame = 0;
  const base = window.MetaBasemap.create(el('base-canvas'), el('base-credit'), message => {
    if (mode !== 'forecast') setNotice(message || (failed ? '범람 화면을 불러오지 못했습니다. 레이어를 켜면 다시 시도합니다.' : ''));
  });
  for (const area of regions.areas) select.add(new Option(area.name, area.id));
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const maxScale = () => Math.max(minScale * 2, mode === 'forecast' ? 6 : 32);
  function setNotice(message) {
    el('loading').hidden = !message;
    el('loading').textContent = message;
  }
  function constrain() {
    camera.scale = clamp(camera.scale, minScale, maxScale());
    if (mode !== 'forecast') {
      const [west,north] = regions.toPixel(124,40);
      const [east,south] = regions.toPixel(133,32);
      camera.x = clamp(camera.x, west, east);
      camera.y = clamp(camera.y, north, south);
      return;
    }
    const halfW = w / (2 * camera.scale), halfH = h / (2 * camera.scale);
    const axis = (v, start, end, half) => end - start <= 2 * half ? (start + end) / 2 : clamp(v, start + half, end - half);
    camera.x = axis(camera.x, sheet.left, sheet.right, halfW);
    camera.y = axis(camera.y, sheet.top, sheet.bottom, halfH);
  }
  function fitArea() {
    const a = locations.get(select.value);
    if (a) {
      const [l,t,r,b] = a.bounds;
      camera = {x:a.center[0], y:a.center[1], scale:Math.min(w / (r-l), h / (b-t)) * .79};
    } else {
      camera = {x:(full[0]+full[2])/2, y:(full[1]+full[3])/2, scale:minScale};
    }
    selectedPoint=null; fitted=true;
    constrain(); schedule();
  }
  function resize() {
    w=screen.clientWidth; h=screen.clientHeight;
    if (!w || !h) return;
    const fill = Math.max(w/(sheet.right-sheet.left),h/(sheet.bottom-sheet.top));
    minScale = Math.min(fill,w/(full[2]-full[0]+62),h/(full[3]-full[1]+44));
    if (fitted) fitArea(); else { constrain(); schedule(); }
  }
  function toScreen(p) { return [(p[0]-camera.x)*camera.scale+w/2,(p[1]-camera.y)*camera.scale+h/2]; }
  function toSheet(p) { return [camera.x+(p[0]-w/2)/camera.scale,camera.y+(p[1]-h/2)/camera.scale]; }
  function changeZoom(factor, eventPoint=[w/2,h/2]) {
    const fixed = toSheet(eventPoint);
    const newScale = clamp(camera.scale*factor,minScale,maxScale());
    if (newScale === camera.scale) return;
    camera.scale=newScale;
    camera.x=fixed[0]-(eventPoint[0]-w/2)/newScale;
    camera.y=fixed[1]-(eventPoint[1]-h/2)/newScale;
    fitted=false; constrain(); schedule();
  }
  function updateScale(lat) {
    const meters = 40075017 * Math.cos(lat*Math.PI/180) / (worldPixels*camera.scale);
    const target = meters * Math.min(76,w*.15);
    const step = 10**Math.floor(Math.log10(target));
    const distance = (target/step >= 5 ? 5 : target/step >= 2 ? 2 : 1)*step;
    el('scale-label').textContent = distance>=1000 ? (distance/1000)+' km' : distance+' m';
    el('scale-line').style.width = (distance/meters)+'px';
  }
  function positionCard() {
    const marker = el('focus-marker');
    if (!selectedPoint) { marker.hidden=true; popup.hidden=true; return; }
    const [x,y]=toScreen(selectedPoint);
    if(x<0||x>w||y<0||y>h){ marker.hidden=true; popup.hidden=true;return; }
    marker.hidden=false;popup.hidden=false;
    marker.style.left=x+'px';marker.style.top=y+'px';
    const ch=popup.offsetHeight;
    popup.style.left=clamp(x-popup.offsetWidth/2,5,w-popup.offsetWidth-5)+'px';
    popup.style.top=clamp(y-ch-15 >= 6 ? y-ch-15 : y+15,6,h-ch-6)+'px';
    el('point-zoom').disabled=camera.scale>=maxScale()-.001;
  }
  function render() {
    paintFrame=0;
    if(!w||!h)return;
    const [lng,lat]=regions.toLatLng(camera.x,camera.y);
    if(mode==='forecast'){
      const [x,y]=toScreen([sheet.left,sheet.top]);
      plane.style.transform='translate('+x+'px,'+y+'px) scale('+camera.scale+')';
    } else base.render({mode,lon:lng,lat,zoom:Math.log2(worldPixels*camera.scale/256),width:w,height:h});
    screen.dataset.zoom=String(camera.scale);
    screen.dataset.mode=mode;
    el('zoom-in').disabled=camera.scale>=maxScale()-.001;
    el('zoom-out').disabled=camera.scale<=minScale+.001;
    el('view-label').textContent=select.selectedOptions[0].textContent;
    updateScale(lat);positionCard();
  }
  function schedule(){ if (!paintFrame) paintFrame=requestAnimationFrame(render); }
  function setMode(next) {
    mode=next;
    const forecast=next==='forecast', satellite=next==='satellite';
    if(forecast)base.hide();
    plane.hidden=!forecast;el('forecast-credit').hidden=!forecast;
    document.querySelector('.legend').hidden=!forecast;
    el('road').setAttribute('aria-pressed',String(!satellite));
    el('satellite').setAttribute('aria-pressed',String(satellite));
    flood.checked=forecast;
    setNotice(failed?'범람 화면을 불러오지 못했습니다. 레이어를 켜면 다시 시도합니다.':'');
    el('view-info').textContent=forecast?'지도를 누르면 선택 위치를 확대하거나 공식 지도를 열 수 있습니다.':
      satellite?'위성영상 · 범람예상도는 레이어에서 켤 수 있습니다.':'일반지도 · 범람예상도는 레이어에서 켤 수 있습니다.';
    constrain();schedule();
  }
  function setForecast() {
    wantFlood=true;
    if(failed){
      failed=false;image.src=initialUrl.split('?')[0]+'?retry='+Date.now();
      setMode('forecast');setNotice('범람 화면을 불러오는 중입니다.');return;
    }
    setMode('forecast');
  }
  function showLoadError(){
    failed=true;wantFlood=false;
    if(mode==='forecast')setMode('street');
  }
  image.addEventListener('error',showLoadError);
  image.addEventListener('load',()=>{failed=false;if(mode==='forecast')setNotice('');});
  function closeLayers(){el('layer-menu').hidden=true;el('layers').setAttribute('aria-expanded','false');}
  el('layers').addEventListener('click',()=>{const open=el('layer-menu').hidden;el('layer-menu').hidden=!open;el('layers').setAttribute('aria-expanded',String(open));});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#layer-menu,#layers'))closeLayers();});
  el('road').addEventListener('click',()=>{closeLayers();if(wantFlood)setForecast();else setMode('street');});
  el('satellite').addEventListener('click',()=>{closeLayers();setMode('satellite');});
  flood.addEventListener('change',()=>{if(flood.checked)setForecast();else{wantFlood=false;setMode('street');}closeLayers();el('layers').focus();});
  el('zoom-in').addEventListener('click',()=>changeZoom(1.5));
  el('zoom-out').addEventListener('click',()=>changeZoom(1/1.5));
  function reset(){select.value='all';fitArea();}
  el('reset').addEventListener('click',reset);
  select.addEventListener('change',fitArea);
  el('help-open').addEventListener('click',()=>el('help').showModal());
  el('help-close').addEventListener('click',()=>el('help').close());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){
    if(!el('layer-menu').hidden){closeLayers();el('layers').focus();}
    else if(!popup.hidden){selectedPoint=null;schedule();screen.focus({preventScroll:true});}
  }});
  function pointAt(p,keyboard=false) {
    const where=toSheet(p);
    if(mode==='forecast'&&(where[0]<sheet.left||where[0]>sheet.right||where[1]<sheet.top||where[1]>sheet.bottom))return;
    const [lon,lat]=regions.toLatLng(...where);
    selectedPoint=where;
    el('point-coordinates').textContent='약 '+lat.toFixed(3)+'°N, '+lon.toFixed(3)+'°E';
    el('point-link').href='./live/?lon='+lon.toFixed(5)+'&lat='+lat.toFixed(5)+'&range=6000';
    positionCard();
    if(keyboard)el('point-zoom').focus();
  }
  el('point-close').addEventListener('click',()=>{selectedPoint=null;positionCard();screen.focus({preventScroll:true});});
  el('point-zoom').addEventListener('click',()=>{if(!selectedPoint)return;
    camera.x=selectedPoint[0];camera.y=selectedPoint[1];
    selectedPoint=null;changeZoom(1.8);screen.focus({preventScroll:true});
  });
  const eventPosition=e=>{const r=screen.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const pointers=new Map();
  let origin=null, moved=false, pinch=null,lastTap=null;
  function startGesture(){
    const p=Array.from(pointers.values());
    origin=p[0]&&{point:p[0],x:camera.x,y:camera.y};
    pinch=p.length>=2?{distance:Math.max(1,distance(p[0],p[1])),fixed:toSheet(mid(p[0],p[1])),scale:camera.scale}:null;
  }
  screen.addEventListener('pointerdown',e=>{
    if(e.button!==0||pointers.size>=2)return;
    screen.setPointerCapture(e.pointerId);
    if(!pointers.size)moved=false;
    pointers.set(e.pointerId,eventPosition(e));
    if(pointers.size>1){moved=true;selectedPoint=null;lastTap=null;}
    startGesture();
  });
  screen.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const p=eventPosition(e);
    pointers.set(e.pointerId,p);
    if(pinch){
      const [a,b]=Array.from(pointers.values()),center=mid(a,b);
      camera.scale=clamp(pinch.scale*distance(a,b)/pinch.distance,minScale,maxScale());
      camera.x=pinch.fixed[0]-(center[0]-w/2)/camera.scale;
      camera.y=pinch.fixed[1]-(center[1]-h/2)/camera.scale;
    } else {
      if(!moved&&distance(p,origin.point)<4)return;
      moved=true;camera.x=origin.x-(p[0]-origin.point[0])/camera.scale;
      camera.y=origin.y-(p[1]-origin.point[1])/camera.scale;
    }
    screen.classList.add('dragging');fitted=false;selectedPoint=null;constrain();schedule();
  });
  function endGesture(e){
    if(!pointers.has(e.pointerId))return;
    const p=eventPosition(e);
    if(e.type==='pointerup'&&!moved&&pointers.size===1){
      const now=performance.now();
      if(lastTap&&now-lastTap.time<350&&distance(lastTap.point,p)<20){
        selectedPoint=null;changeZoom(1.7,p);lastTap=null;
      } else{pointAt(p);lastTap={time:now,point:p};}
    } else lastTap=null;
    pointers.delete(e.pointerId);startGesture();
    if(!pointers.size)screen.classList.remove('dragging');
  }
  screen.addEventListener('pointerup',endGesture);
  screen.addEventListener('pointercancel',endGesture);
  screen.addEventListener('lostpointercapture',endGesture);
  screen.addEventListener('wheel',e=>{e.preventDefault();selectedPoint=null;
    const delta=e.deltaY*(e.deltaMode===1?18:e.deltaMode===2?h:1);
    changeZoom(Math.exp(-clamp(delta,-240,240)*.003),eventPosition(e));schedule();
  },{passive:false});
  screen.addEventListener('keydown',e=>{
    if(e.altKey||e.metaKey||e.ctrlKey)return;
    const step=(e.shiftKey?130:50)/camera.scale;
    if(e.key==='Home')reset();
    else if(e.key==='+'||e.key==='=')changeZoom(1.5);
    else if(e.key==='-')changeZoom(1/1.5);
    else if(e.key==='Enter'||e.key===' ')pointAt([w/2,h/2],true);
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      camera.x+=(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0);
      camera.y+=(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0);
      selectedPoint=null;fitted=false;constrain();schedule();
    } else return;
    e.preventDefault();
  });
  el('view-info').setAttribute('aria-live','polite');
  new ResizeObserver(resize).observe(screen);
  resize();
  if(image.complete&&!image.naturalWidth)showLoadError();
})();
