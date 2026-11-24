"use strict";
const BACKGROUND = {type:"FeatureCollection",features:[]};
const $ = id => document.getElementById(id);
const icons = {
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16"/>',
  down: '<path d="m5 9 7 6 7-6"/>',
  map: '<path d="m2 5 6-2 8 3 6-2v15l-6 2-8-3-6 2zM8 3v15m8-12v15"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2.5"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  layers: '<path d="m2 8 10-5 10 5-10 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  water: '<path d="M12 2c-3 5-7 9-7 13a7 7 0 1 0 14 0c0-4-4-8-7-13zM9 16c0 1.6 1 2.5 2.5 3"/>',
  adjust: '<path d="M3 6h8m5 0h5M3 12h2m5 0h11M3 18h10m5 0h3"/><circle cx="13.5" cy="6" r="2"/><circle cx="7.5" cy="12" r="2"/><circle cx="15.5" cy="18" r="2"/>',
  reset: '<path d="M3 10a8.5 8.5 0 1 1 1 7M3 4v6h6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  focus: '<path d="M8 3H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14m-7-7v14"/>',
  minus: '<path d="M5 12h14"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v13c0 4 16 4 16 0V5M4 11c0 4 16 4 16 0"/>',
  refresh: '<path d="M3 10a9 9 0 0 1 15-5l3 3M21 3v5h-5M21 14a9 9 0 0 1-15 5l-3-3m0 5v-5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  x: '<path d="m6 6 12 12m0-12L6 18"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m4 12 5 5L20 6"/>'
};
function paintIcons(root = document) {
  root.querySelectorAll('i[data-i]').forEach(e => {
    e.setAttribute('aria-hidden', 'true');
    e.innerHTML = '<svg viewBox="0 0 24 24">' + (icons[e.dataset.i] || '') + '</svg>';
  });
}
function el(tag, cls, txt) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (txt != null) node.textContent = txt;
  return node;
}
function action(text, fn, cls = 'outlined') {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
function link(title, url) {
  const a = el('a', 'sourcelink', title + ' ↗');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function option(value, title = value) {
  const o = el('option', '', title);
  o.value = value;
  return o;
}
function notify(t) {
  $('toast').textContent = t;
  $('toast').hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => $('toast').hidden = true, 2800);
}

// OpenMapTiles geometry is integer tile-local data, including a drawing buffer
// outside each tile. Keep it in those coordinates while the camera pans or zooms.
const streetRenderer = (() => {
  const textDecoder = new TextDecoder();
  const wantedLayers = new Set([
    'landcover', 'landuse', 'park', 'water', 'waterway', 'building', 'aeroway',
    'transportation', 'transportation_name', 'boundary', 'place', 'poi', 'water_name'
  ]);

  class Reader {
    constructor(bytes, start = 0, end = bytes.byteLength) {
      this.bytes = bytes;
      this.pos = start;
      this.end = end;
    }
    uint() {
      let value = 0;
      let factor = 1;
      for (let count = 0; count < 10 && this.pos < this.end; count++) {
        const byte = this.bytes[this.pos++];
        value += (byte & 127) * factor;
        if (byte < 128) return value;
        factor *= 128;
      }
      throw Error('Invalid vector tile integer');
    }
    sub() {
      const size = this.uint();
      const start = this.pos;
      if (size > this.end - start) throw Error('Invalid vector tile field size');
      this.pos += size;
      return new Reader(this.bytes, start, this.pos);
    }
    string() {
      const f = this.sub();
      return textDecoder.decode(f.bytes.subarray(f.pos, f.end));
    }
    skip(wire) {
      if (wire === 0) this.uint();
      else if (wire === 2) this.sub();
      else if (wire === 1 || wire === 5) this.pos += wire === 1 ? 8 : 4;
      else throw Error('Unknown vector tile field');
      if (this.pos > this.end) throw Error('Truncated vector tile field');
    }
  }

  const signed = n => n % 2 ? -(n + 1) / 2 : n / 2;

  function readValue(r) {
    let result;
    while (r.pos < r.end) {
      const key = r.uint();
      const tag = key >>> 3;
      const wire = key & 7;
      if (tag === 1 && wire === 2) result = r.string();
      else if ((tag === 2 && wire === 5) || (tag === 3 && wire === 1)) {
        const pos = r.pos;
        r.skip(wire);
        const value = new DataView(r.bytes.buffer, r.bytes.byteOffset + pos, r.pos - pos);
        result = tag === 2 ? value.getFloat32(0, true) : value.getFloat64(0, true);
      } else if (tag >= 4 && tag <= 7 && wire === 0) {
        const start = r.pos;
        const n = r.uint();
        if (tag === 4 && r.pos - start === 10) {
          // Negative int64 attributes (e.g. layer=-1) are sign-extended to ten
          // bytes. Decode the signed value before converting to Number.
          let bits = 0n;
          for (let i = r.pos - 1; i >= start; i--) bits = (bits << 7n) | BigInt(r.bytes[i] & 127);
          result = Number(BigInt.asIntN(64,bits));
        } else result = tag === 6 ? signed(n) : tag === 7 ? !!n : n;
      } else r.skip(wire);
    }
    return result;
  }

  function readFeature(r, keys, values) {
    let tags, geom, type;
    while (r.pos < r.end) {
      const field = r.uint();
      if (field === 18) tags = r.sub();
      else if (field === 24) type = r.uint();
      else if (field === 34) geom = r.sub();
      else r.skip(field & 7);
    }
    if (!geom || !type || type > 3) return null;
    const props = Object.create(null);
    if (tags) {
      while (tags.pos < tags.end) {
        const k = keys[tags.uint()];
        const v = values[tags.uint()];
        if (k !== undefined && v !== undefined) props[k] = v;
      }
    }
    const paths = [];
    let current;
    let x = 0, y = 0;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    while (geom.pos < geom.end) {
      const command = geom.uint();
      const op = command & 7, count = Math.floor(command / 8);
      if (!count) throw Error('Invalid vector tile command');
      if (op === 7) continue; // Polygon rings are closed by the renderer.
      if ((op !== 1 && op !== 2) || count > (geom.end - geom.pos) / 2) {
        throw Error('Invalid vector tile geometry');
      }
      for (let i = 0; i < count; i++) {
        x += signed(geom.uint());
        y += signed(geom.uint());
        if (op === 1) {
          current = [];
          paths.push(current);
        }
        if (!current) throw Error('Vector tile geometry lacks a start');
        current.push(x, y);
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    return paths.length ? {type, props, paths, bounds: [left, top, right, bottom]} : null;
  }

  function readLayer(r) {
    let name, extent = 4096;
    const keys = [], values = [], entries = [];
    while (r.pos < r.end) {
      const field = r.uint();
      if (field === 10) name = r.string();
      else if (field === 18) entries.push(r.sub());
      else if (field === 26) keys.push(r.string());
      else if (field === 34) values.push(readValue(r.sub()));
      else if (field === 40) extent = r.uint();
      else r.skip(field & 7);
    }
    if (!wantedLayers.has(name) || extent < 1) return null;
    const features = entries.map(entry => readFeature(entry, keys, values)).filter(Boolean);
    if (name === 'transportation') features.sort((a, b) => roadRank(a) - roadRank(b));
    return {name, extent, features};
  }

  function decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length > 6 * 1024 * 1024) throw Error('Oversized vector tile');
    const r = new Reader(bytes);
    const layers = Object.create(null);
    let layerCount = 0;
    while (r.pos < r.end) {
      const field = r.uint();
      if (field !== 26) {
        r.skip(field & 7);
        continue;
      }
      layerCount++;
      const layer = readLayer(r.sub());
      if (layer) layers[layer.name] = layer;
    }
    if (!layerCount && bytes.length) throw Error('No vector tile layers');
    return layers;
  }

  const areaPaint = {
    wood: '#c3dba9', forest: '#c3dba9', grass: '#dbe7c8', meadow: '#dbe7c8',
    grassland: '#dbe7c8', farmland: '#e9e8cb', orchard: '#dce5ba', scrub: '#d2dfba',
    wetland: '#cce1cc', sand: '#efead9', rock: '#e6e3d9', residential: '#f1f0ed',
    commercial: '#eee9e1', retail: '#f1e8de', industrial: '#e9e6e5', railway: '#e5e3e2',
    park: '#cfe5b8', national_park: '#d0e3bb', garden: '#cfe5bd', cemetery: '#d4e1c9',
    recreation_ground: '#d4e6bf', pitch: '#bad7ad', stadium: '#d1e1bc', golf_course: '#cde2b2',
    hospital: '#f1e0dd', school: '#eee7d4', college: '#eae6d5', university: '#ebe4d4',
    parking: '#e8e8e5', station: '#e7e3dc', pedestrian: '#eee8dc', aerodrome: '#e7e4e3'
  };
  const roadPriority = {path:0, track:0, service:1, minor:2, raceway:2, tertiary:3,
    secondary:4, primary:5, trunk:6, motorway:7, transit:8, rail:8};
  function level(f) {
    return (Number(f.props.layer) || 0) * 10 +
      (f.props.brunnel === 'bridge' ? 1 : f.props.brunnel === 'tunnel' ? -1 : 0);
  }
  function roadRank(f) {
    return level(f) * 12 + (roadPriority[f.props.class] ?? 1);
  }
  const roadPaint = {
      motorway: [7.8,'#d6a663','#ffdc93',6], trunk: [7,'#d8b683','#ffe6ab',7],
      primary: [6.2,'#c7b99a','#fff0bc',9], secondary: [5.3,'#c9bdab','#fff5d7',11],
      tertiary: [4.3,'#cfc8b9','#fffaf0',12], minor: [3.6,'#cfcfc8','#ffffff',12],
      service: [2.25,'#d6d3ca','#fffefa',15], track: [1.2,null,'#b6ab93',14],
      path: [1.2,null,'#b6a590',15], raceway: [2,'#c4b3a3','#f4e8d9',14]
  };
  function roadStyle(kind, zoom) {
    const scale = Math.min(2.6, Math.max(.33, 2 ** ((zoom - 15) * .27)));
    const s = roadPaint[kind] || roadPaint.minor;
    if (zoom < s[3]) return null;
    return {width: s[0] * scale, outline: s[1], fill: s[2]};
  }

  function inView(f, bounds) {
    const [left, top, right, bottom] = f.bounds;
    return right >= bounds[0] && left <= bounds[2] && bottom >= bounds[1] && top <= bounds[3];
  }
  function path(ctx, f) {
    ctx.beginPath();
    for (const line of f.paths) {
      ctx.moveTo(line[0], line[1]);
      for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i], line[i+1]);
      if (f.type === 3) ctx.closePath();
    }
  }
  function line(ctx, color, width, f, tileScale, dash) {
    path(ctx, f);
    ctx.lineWidth = width / tileScale;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash ? dash.map(x => x / tileScale) : []);
    ctx.stroke();
  }
  function area(ctx, f, color) {
    if (f.type !== 3 || !color) return;
    path(ctx, f);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }
  function paintRoads(ctx, fs, scale, zoom, bounds) {
    const groups = new Map();
    const rails = [];
    for (const f of fs) {
      if (!inView(f, bounds)) continue;
      if (f.type === 3) {
        area(ctx, f, '#eae6de');
        continue;
      }
      if (f.type !== 2) continue;
      const kind = f.props.class;
      if (kind === 'rail' || kind === 'transit') {
        if (zoom >= 12) rails.push(f);
        continue;
      }
      if (kind === 'ferry' || kind === 'aerialway') continue;
      const style = roadStyle(kind, zoom);
      if (!style) continue;
      const groupLevel = level(f);
      if (!groups.has(groupLevel)) groups.set(groupLevel, []);
      groups.get(groupLevel).push({f, style});
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const roads of groups.values()) {
      for (const {f, style} of roads) {
        if (style.outline) line(ctx, style.outline, style.width + (zoom >= 14 ? 1.7 : 1), f, scale);
      }
      for (const {f, style} of roads) {
        const tunnel = f.props.brunnel === 'tunnel';
        const dash = tunnel || f.props.class === 'path' || f.props.class === 'track' ? [3, 3] : null;
        line(ctx, tunnel ? '#ece8df' : style.fill, style.width, f, scale, dash);
      }
    }
    for (const f of rails) {
      line(ctx, '#9c9d9e', zoom >= 15 ? 2.35 : 1.4, f, scale);
      line(ctx, '#fffdf7', zoom >= 15 ? 1.4 : .7, f, scale, [4, 5]);
    }
    ctx.setLineDash([]);
  }

  function geometry(ctx, tile, zoom, viewport) {
    const {data, x, y, size} = tile;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.fillStyle = '#f5f3ee';
    ctx.fillRect(x, y, size, size);
    for (const name of ['landcover','landuse','park','aeroway','water','waterway','building','boundary','transportation']) {
      const layer = data[name];
      if (!layer || (name === 'building' && zoom < 14)) continue;
      const scale = size / layer.extent;
      const bounds = [-x/scale, -y/scale, (viewport.w-x)/scale, (viewport.h-y)/scale];
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      if (name === 'transportation') paintRoads(ctx, layer.features, scale, zoom, bounds);
      else for (const f of layer.features) {
        if (!inView(f, bounds)) continue;
        const kind = f.props.class;
        if (name === 'landuse' || name === 'landcover') area(ctx, f, areaPaint[f.props.subclass] || areaPaint[kind]);
        else if (name === 'park') area(ctx, f, areaPaint[kind] || '#d3e5bd');
        else if (name === 'water') area(ctx, f, '#afd2e3');
        else if (name === 'waterway' && f.type === 2) line(ctx, '#9cc7db', kind === 'river' ? 2 : 1.1, f, scale);
        else if (name === 'aeroway') {
          if (f.type === 3) area(ctx, f, '#d7d6d4');
          else if (f.type === 2) line(ctx, '#c9c8c4', kind === 'runway' ? 4 : 1, f, scale);
        } else if (name === 'building' && f.type === 3) {
          area(ctx, f, '#dedbd4');
          if (zoom >= 16) line(ctx, '#c8c5bd', .7, f, scale);
        } else if (name === 'boundary' && f.type === 2 && Number(f.props.admin_level) <= 8) {
          line(ctx, '#aaa8ad', .8, f, scale, [4,4]);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Anchor road names on the longest visible straight segment. Clipping this
  // segment first also handles z14 source tiles overzoomed to building level.
  function segmentAnchor(f, tile, scale, vp) {
    let best = null, max = 0;
    for (const points of f.paths) for (let i = 2; i < points.length; i += 2) {
      const x = tile.x+points[i-2]*scale, y=tile.y+points[i-1]*scale;
      const dx = (points[i]-points[i-2])*scale, dy=(points[i+1]-points[i-1])*scale;
      let lo=0, hi=1;
      for (const [pos,d,limit] of [[x,dx,vp.w],[y,dy,vp.h]]) {
        if (!d) { if (pos < 0 || pos > limit) hi = -1; continue; }
        const a=-pos/d, b=(limit-pos)/d;
        lo=Math.max(lo, Math.min(a,b)); hi=Math.min(hi,Math.max(a,b));
      }
      const len = (hi-lo)*Math.hypot(dx,dy);
      if (len < 23 || len <= max) continue;
      max = len;
      const middle = (lo+hi)/2;
      let angle = Math.atan2(dy,dx);
      if (angle > Math.PI/2) angle-=Math.PI;
      if (angle < -Math.PI/2) angle+=Math.PI;
      best = {x:x+dx*middle, y:y+dy*middle, angle, length:len};
    }
    return best;
  }

  function makeLabel(name, f, tile, scale, zoom, vp) {
    const p = f.props;
    const title = String(p['name:ko'] || p.name_ko || p.name || p['name:en'] || '').trim();
    if (!title || title.length > 55) return null;
    const kind = p.class || '';
    let size, priority, color='#484d4c', visibleFrom, weight=500;
    if (name === 'place') {
      const classes = {country:[20,5,2], state:[16,8,3],city:[16,10,6],town:[14,18,9],
        suburb:[14,22,11],borough:[14,20,10],village:[12,30,12],quarter:[13,24,12],
        neighbourhood:[12,32,13],hamlet:[11,48,15]};
      [size,priority,visibleFrom] = classes[kind] || [11,42,14];
      if ((kind === 'country' && zoom > 8) || (kind === 'state' && zoom > 11) ||
          (kind === 'city' && zoom > 14) || (kind === 'town' && zoom > 16)) return null;
      weight=650; color='#455254';
    } else if (name === 'transportation_name') {
      const major = ['motorway','trunk','primary','secondary'].includes(kind);
      size=major?12:11; priority=major?25:47; visibleFrom=major?12:15;
      color=major?'#685943':'#626262';
    } else if (name === 'water_name') {
      size=12; priority=36; visibleFrom=11; color='#467e99';
    } else {
      const transit = /rail|station|bus_station/.test(kind+' '+(p.subclass||''));
      const civic = /hospital|school|university|town_hall|police|park|library/.test(kind+' '+(p.subclass||''));
      visibleFrom=transit?13:civic?15:17;
      size=transit?12:11;
      priority=transit?21:civic?40:65+Math.min(12,Number(p.rank)||6);
      color=transit?'#396b89':civic?'#47705b':'#70675a';
    }
    if (zoom < visibleFrom) return null;
    let anchor;
    if (f.type === 2) anchor = segmentAnchor(f,tile,scale,vp);
    else if (f.type === 1) anchor = {x:tile.x+f.paths[0][0]*scale, y:tile.y+f.paths[0][1]*scale, angle:0};
    if (!anchor || anchor.x<3 || anchor.y<5 || anchor.x>vp.w-3 || anchor.y>vp.h-5) return null;
    // Features buffered into neighboring MVTs must be labelled by only one tile.
    if (anchor.x < tile.x || anchor.x >= tile.x+tile.size || anchor.y < tile.y || anchor.y >= tile.y+tile.size) return null;
    return {...anchor,text:title,size,priority,color,weight,point:name==='poi'};
  }

  function paintLabels(ctx, tiles, zoom, vp) {
    const labels=[];
    for (const t of tiles) for (const n of ['place','transportation_name','water_name','poi']) {
      const layer=t.data[n];
      if (!layer) continue;
      const scale=t.size/layer.extent;
      const bounds=[-t.x/scale,-t.y/scale,(vp.w-t.x)/scale,(vp.h-t.y)/scale];
      for (const f of layer.features) {
        if (!inView(f,bounds)) continue;
        const candidate=makeLabel(n,f,t,scale,zoom,vp);
        if (candidate) labels.push(candidate);
      }
    }
    labels.sort((a,b) => a.priority-b.priority);
    const grid=new Map(), seen=new Map();
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
    for (const l of labels) {
      const key=l.text;
      if (seen.get(key)?.some(p=>Math.abs(p.x-l.x)<165 && Math.abs(p.y-l.y)<100)) continue;
      ctx.font=l.weight+' '+l.size+'px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
      const width=ctx.measureText(l.text).width+8, height=l.size+6;
      if (l.length && l.length<width*.72) continue;
      const cos=Math.abs(Math.cos(l.angle)), sin=Math.abs(Math.sin(l.angle));
      const w=(cos*width+sin*height)/2, h=(sin*width+cos*height)/2;
      const box=[l.x-w,l.y-h,l.x+w,l.y+h];
      if (box[0]<0||box[1]<0||box[2]>vp.w||box[3]>vp.h) continue;
      const cells=[];
      for(let y=Math.floor(box[1]/40);y<=Math.floor(box[3]/40);y++)
        for(let x=Math.floor(box[0]/80);x<=Math.floor(box[2]/80);x++) cells.push(x+','+y);
      if(cells.some(k=>grid.get(k)?.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]))) continue;
      for(const k of cells) {if(!grid.has(k))grid.set(k,[]);grid.get(k).push(box);}
      if(!seen.has(key))seen.set(key,[]);seen.get(key).push(l);
      ctx.save();ctx.translate(l.x,l.y);ctx.rotate(l.angle);
      ctx.strokeStyle='#fffcf6';ctx.lineWidth=3;ctx.strokeText(l.text,0,0);
      ctx.fillStyle=l.color;ctx.fillText(l.text,0,0);
      ctx.restore();
    }
  }

  function render(ctx, tiles, zoom, view) {
    const vp={w:view.w??view.width, h:view.h??view.height};
    ctx.save();
    for (const t of tiles) geometry(ctx,t,zoom,vp);
    paintLabels(ctx,tiles,zoom,vp);
    ctx.restore();
  }
  return {decode, render};
})();

function decodeStreetTile(buffer) { return streetRenderer.decode(buffer); }
function renderStreetTiles(ctx, placedTiles, zoom, viewport) {
  streetRenderer.render(ctx, placedTiles, zoom, viewport);
}

// Store only vector tiles already fetched for the current viewport. A separate
// metadata store lets quota enforcement avoid reading every tile's binary data.
const streetTileCache = (() => {
  const maxAge = 14 * 24 * 60 * 60 * 1000;
  const maxBytes = 12 * 1024 * 1024;
  const maxRecords = 72;
  let opening = null;

  function database() {
    if (opening) return opening;
    let request;
    try {
      request = indexedDB.open('metacover.ofm.street.v1', 1);
    } catch {
      return Promise.resolve(null);
    }
    opening = new Promise(resolve => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        opening = null;
        resolve(null);
      }, 1200);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('tiles');
        db.createObjectStore('metadata', {keyPath:'cell'});
      };
      request.onsuccess = () => {
        const db = request.result;
        clearTimeout(timer);
        if (expired) {db.close(); return;}
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => {
        clearTimeout(timer);
        if (!expired) {opening = null; resolve(null);}
      };
    });
    return opening;
  }

  // The caller can use the primary network or bundled map immediately if a
  // browser storage transaction is blocked or file-origin storage is disabled.
  function within(job, budget, fallback) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(fallback), budget);
      job.then(result => {
        clearTimeout(timer); resolve(result);
      }, () => {
        clearTimeout(timer); resolve(fallback);
      });
    });
  }

  function validCell(cell) {
    if (typeof cell !== 'string' || !/^\d{1,2}\/\d{1,5}\/\d{1,5}$/.test(cell)) return false;
    const [z,x,y] = cell.split('/').map(Number);
    return z <= 14 && x < 2 ** z && y < 2 ** z;
  }

  async function read(cell) {
    if (!validCell(cell)) return null;
    const db = await database();
    if (!db) return null;
    return new Promise(resolve => {
      const tx = db.transaction(['tiles','metadata'], 'readonly');
      const meta = tx.objectStore('metadata').get(cell);
      let value = null;
      meta.onsuccess = () => {
        const saved = meta.result;
        const now = Date.now();
        if (!saved || !Number.isFinite(saved.savedAt) || saved.savedAt <= now-maxAge || saved.savedAt > now) return;
        const data = tx.objectStore('tiles').get(cell);
        data.onsuccess = () => {
          if (data.result instanceof ArrayBuffer && data.result.byteLength === saved.size) {
            value = {bytes:data.result, savedAt:saved.savedAt};
          }
        };
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => resolve(null);
    });
  }

  async function write(cell, bytes) {
    if (!validCell(cell) || !(bytes instanceof ArrayBuffer) || bytes.byteLength > maxBytes) return false;
    const db = await database();
    if (!db) return false;
    return new Promise(resolve => {
      // Both stores update and evict in the same serialized transaction, so
      // overlapping tabs, replacements, and quota aborts keep metadata in sync.
      const tx = db.transaction(['tiles','metadata'], 'readwrite');
      const tiles = tx.objectStore('tiles'), metadata = tx.objectStore('metadata');
      const now = Date.now();
      tiles.put(bytes,cell);
      metadata.put({cell, savedAt:now, size:bytes.byteLength});
      const listed = metadata.getAll();
      listed.onsuccess = () => {
        const records = listed.result.sort((a,b) => a.savedAt-b.savedAt);
        let remaining = records.length;
        let total = records.reduce((sum,r) => sum+r.size,0);
        for (const r of records) {
          if (r.savedAt > now-maxAge && remaining <= maxRecords && total <= maxBytes) break;
          tiles.delete(r.cell);
          metadata.delete(r.cell);
          remaining--;
          total -= r.size;
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  }

  return {
    read: cell => within(read(cell), 250, null),
    save: (cell,bytes) => within(write(cell,bytes), 1600, false)
  };
})();

function readSavedStreetTile(cell) { return streetTileCache.read(cell); }
function saveStreetTile(cell, bytes) { return streetTileCache.save(cell, bytes); }

// All map layers use Web Mercator. Network tiles are requested only for the visible screen.
const streetBase = {
  mode: 'street',
  canvas: null,
  pending: new Map(),
  decoding: new Set(),
  badBundledCells: new Set(),
  cache: new Map(),
  failures: new Map(),
  needed: new Set(),
  cachedBytes: 0,
  frame: 0,
  retryTimer: 0,
  creditKey: '',
  detailedLocal: false
};
const mapTileEndpoints = {
  vector: cell => 'https://tiles.openfreemap.org/planet/latest/' + cell + '.pbf',
  raster: cell => 'https://tile.openstreetmap.org/' + cell + '.png',
  satellite: cell => {
    const [z, x, y] = cell.split('/');
    return 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/' + z + '/' + y + '/' + x + '.jpg';
  }
};
const tileCredits = {
  vector: [
    ['OpenFreeMap', 'https://openfreemap.org/'],
    ['© OpenMapTiles', 'https://openmaptiles.org/'],
    ['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright']
  ],
  raster: [['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright']],
  satellite: [
    ['EOxCloudless', 'https://cloudless.eox.at/'],
    ['by EOX IT Services GmbH', 'https://eox.at/'],
    ['(Contains modified Copernicus Sentinel data 2016 & 2017) · CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/']
  ],
  locator: [['통계청 2013 · 간략 경계', 'https://github.com/southkorea/southkorea-maps']]
};

function screenTiles(view, zoom) {
  const size = 256 * 2 ** (S.z - zoom);
  const result = [];
  const right = Math.floor((view.l + view.w - 1) / size);
  const bottom = Math.floor((view.t + view.h - 1) / size);
  for (let y = Math.floor(view.t / size); y <= bottom; y++) {
    for (let x = Math.floor(view.l / size); x <= right; x++) {
      result.push({cell: zoom + '/' + x + '/' + y, x: x * size - view.l, y: y * size - view.t, size});
    }
  }
  return result.sort((a,b) =>
    Math.hypot(a.x+a.size/2-view.w/2,a.y+a.size/2-view.h/2) -
    Math.hypot(b.x+b.size/2-view.w/2,b.y+b.size/2-view.h/2));
}

function setMapCredits(sources) {
  const key = sources.join('|');
  if (streetBase.creditKey === key) return;
  streetBase.creditKey = key;
  let target = $('attribution');
  if (target.tagName === 'A') {
    const wrapper = document.createElement('span');
    wrapper.id = target.id;
    wrapper.className = target.className;
    target.replaceWith(wrapper);
    target = wrapper;
  }
  const links = new Map();
  for (const source of sources) {
    for (const [label, url] of tileCredits[source] || []) links.set(url, label);
  }
  target.replaceChildren();
  target.style.pointerEvents = 'auto';
  target.style.background = 'rgba(255,255,255,.91)';
  target.style.textAlign = 'right';
  for (const [url, label] of links) {
    if (target.childNodes.length) target.append(' ');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    target.append(a);
  }
}

function updateBaseLabel(text, sources) {
  const label = $('basemap-name');
  if (label.textContent !== text) label.textContent = text;
  setMapCredits(sources);
}

function mapTileRepaint() {
  if (streetBase.frame) return;
  streetBase.frame = requestAnimationFrame(() => {
    streetBase.frame = 0;
    drawTiles(mapView());
  });
}

function rememberMapTile(id, data, weight, saved = false) {
  streetBase.cache.set(id, {data, weight, saved});
  streetBase.cachedBytes += weight;
  // Keep recently viewed strips for panning. Never evict currently visible tiles.
  for (const [key, item] of streetBase.cache) {
    if (streetBase.cache.size <= 70 && streetBase.cachedBytes < 64 * 1024 * 1024) break;
    if (streetBase.needed.has(key)) continue;
    streetBase.cache.delete(key);
    streetBase.cachedBytes -= item.weight;
  }
}

async function decodeMapTile(bytes) {
  let data = new Uint8Array(bytes);
  if (data[0] === 31 && data[1] === 139) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    data = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return decodeStreetTile(data);
}

function loadRasterTile(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // The standard OSM server expects a referrer identifying the website.
    img.referrerPolicy = 'strict-origin-when-cross-origin';
    img.decoding = 'async';
    const stop = () => { img.onload = img.onerror = null; img.removeAttribute('src'); reject(new Error('Image request cancelled')); };
    signal.addEventListener('abort', stop, {once:true});
    img.onload = () => { signal.removeEventListener('abort', stop); resolve(img); };
    img.onerror = () => { signal.removeEventListener('abort', stop); reject(new Error('Image request failed')); };
    img.src = url;
  });
}

async function loadMapTile(task) {
  const {id, source, cell} = task;
  const controller = new AbortController();
  streetBase.pending.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 7200);
  let saved = null;
  try {
    const url = mapTileEndpoints[source](cell);
    let item, weight;
    if (source === 'vector') {
      if (typeof readSavedStreetTile==='function') saved=await readSavedStreetTile(cell);
      const recent=saved && Date.now()-saved.savedAt < 12*60*60*1000;
      if (saved && (!navigator.onLine || recent)) {
        try {
          rememberMapTile(id,await decodeMapTile(saved.bytes),saved.bytes.byteLength*8,true);
          return;
        } catch { saved=null; }
      }
      if (!navigator.onLine || controller.signal.aborted) throw new Error('Network unavailable');
      const response = await fetch(url, {signal:controller.signal, credentials:'omit'});
      if (!response.ok) throw new Error('Tile HTTP ' + response.status);
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > 8 * 1024 * 1024) throw new Error('Invalid tile size');
      item = await decodeMapTile(buffer);
      weight = buffer.byteLength * 8;
      if (typeof saveStreetTile==='function' && !controller.signal.aborted) void saveStreetTile(cell,buffer);
    } else {
      item = await loadRasterTile(url, controller.signal);
      weight = item.naturalWidth * item.naturalHeight * 4;
    }
    if (!controller.signal.aborted) rememberMapTile(id, item, weight);
  } catch {
    if (streetBase.needed.has(id)) {
      if (saved) {
        try {
          rememberMapTile(id,await decodeMapTile(saved.bytes),saved.bytes.byteLength*8,true);
          return;
        } catch { /* The saved entry was unreadable. Allow the next network retry. */ }
      }
      streetBase.failures.set(id, Date.now() + 90000);
    }
  } finally {
    clearTimeout(timeout);
    streetBase.pending.delete(id);
    mapTileRepaint();
  }
}

function startMapRequests(requests, bundled = []) {
  streetBase.needed = new Set([...requests.map(r=>r.id), ...bundled]);
  for (const [id,controller] of streetBase.pending) {
    if (!streetBase.needed.has(id)) controller.abort();
  }
  const now = Date.now();
  let nextRetry = Infinity;
  for (const [id,until] of streetBase.failures) {
    if (until <= now) streetBase.failures.delete(id);
    else if (streetBase.needed.has(id)) nextRetry = Math.min(nextRetry, until);
  }
  clearTimeout(streetBase.retryTimer);
  if (Number.isFinite(nextRetry)) streetBase.retryTimer = setTimeout(mapTileRepaint, Math.max(25, nextRetry - now + 5));
  if (document.hidden) return;
  for (const task of requests) {
    if (streetBase.pending.size >= 5) break;
    if (!navigator.onLine && task.source!=='vector') continue;
    if (!streetBase.cache.has(task.id) && !streetBase.pending.has(task.id) && !streetBase.failures.has(task.id)) {
      void loadMapTile(task);
    }
  }
}

function ensureBaseCanvas(view) {
  let canvas = streetBase.canvas;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none';
    $('tiles').replaceChildren(canvas);
    streetBase.canvas = canvas;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(view.w * dpr), height = Math.round(view.h * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,view.w,view.h);
  return ctx;
}

function showRasterCells(ctx, cells, source, requests) {
  let rendered = 0;
  for (const p of cells) {
    const id = source + ':' + p.cell;
    requests.push({id, source, cell:p.cell});
    const item = streetBase.cache.get(id);
    if (item) {
      ctx.drawImage(item.data, p.x,p.y,p.size + .35,p.size + .35);
      rendered++;
    }
  }
  return rendered;
}

function bundledMapCells(view, visibleIds) {
  if (typeof STREET_TILE_PACK === 'undefined') return [];
  const draw = [];
  for (const [key,encoded] of Object.entries(STREET_TILE_PACK.tiles||{})) {
    const [z,tx,ty] = key.split('/').map(Number);
    if (z > S.z + 2 || z < S.z - 6) continue;
    const size = 256 * 2 ** (S.z-z), x=tx*size-view.l, y=ty*size-view.t;
    if (x >= view.w || x+size <= 0 || y >= view.h || y+size <= 0) continue;
    const id='pack:'+key, item=streetBase.cache.get(id);
    visibleIds.push(id);
    if (item) {
      draw.push({data:item.data,x,y,size,z});
    } else if (!streetBase.decoding.has(id) && !streetBase.badBundledCells.has(id)) {
      streetBase.decoding.add(id);
      Promise.resolve().then(async()=>{
        const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        rememberMapTile(id,await decodeMapTile(bytes),bytes.length*8);
      }).catch(()=>streetBase.badBundledCells.add(id))
        .finally(()=>{streetBase.decoding.delete(id);mapTileRepaint()});
    }
  }
  return draw.sort((a,b)=>a.z-b.z);
}

function drawTiles(view) {
  if (googleAtlas.isActive()) {
    if (streetBase.needed.size || streetBase.pending.size) startMapRequests([]);
    updateBaseLabel(streetBase.mode === 'satellite' ? 'Google 위성지도' : 'Google 지도', []);
    return;
  }
  const ctx=ensureBaseCanvas(view), requests=[], sources=[];
  const fallbackLabel=streetBase.detailedLocal ? '저장된 상세도' : '간략 위치도';
  if (!S.tiles) {
    startMapRequests([]);
    updateBaseLabel(fallbackLabel,['locator']);
    return;
  }
  if (streetBase.mode==='satellite') {
    // The original 10 m Sentinel-2 mosaic gains no new detail above native z14.
    const cells=screenTiles(view,Math.min(14,S.z));
    const rendered=showRasterCells(ctx,cells,'satellite',requests);
    startMapRequests(requests);
    const busy=requests.some(t=>!streetBase.cache.has(t.id)&&!streetBase.failures.has(t.id));
    let label='위성영상 2016 · 10 m';
    if (!rendered) label=navigator.onLine && busy?'위성영상 불러오는 중':'위성영상 연결 실패 · '+fallbackLabel;
    else if (rendered<cells.length) label+=' · 일부 표시';
    updateBaseLabel(label,rendered?['satellite']:['locator']);
    return;
  }
  const visibleBundled=[];
  const bundled=bundledMapCells(view,visibleBundled);
  if (bundled.length) {
    // Group by source zoom so coarse bundled tiles never cover detailed tiles.
    for (const z of new Set(bundled.map(p=>p.z))) renderStreetTiles(ctx,bundled.filter(p=>p.z===z),S.z,view);
    sources.push('vector');
  }
  const cells=screenTiles(view,Math.min(14,S.z)),vectors=[];
  const missing=new Set();
  for(const p of cells){
    const id='vector:'+p.cell;
    requests.push({id,source:'vector',cell:p.cell});
    const item=streetBase.cache.get(id);
    if(item)vectors.push({...p,data:item.data,saved:item.saved});
    else if(streetBase.failures.has(id))missing.add(p.cell);
  }
  // Public standard raster tiles are used only with an identifying HTTP referrer.
  let rasterCount=0, rasterTarget=0;
  if(missing.size && /^https?:$/.test(location.protocol)) {
    const vectorZ=Math.min(14,S.z),factor=2**(S.z-vectorZ);
    const raster=screenTiles(view,S.z).filter(p=>{
      const [,x,y]=p.cell.split('/').map(Number);
      return missing.has(vectorZ+'/'+Math.floor(x/factor)+'/'+Math.floor(y/factor));
    });
    rasterTarget=raster.length;
    rasterCount=showRasterCells(ctx,raster,'raster',requests);
    if(rasterCount)sources.push('raster');
  }
  if(vectors.length){
    renderStreetTiles(ctx,vectors,S.z,view);
    if(!sources.includes('vector'))sources.push('vector');
  }
  startMapRequests(requests,visibleBundled);
  let label=vectors.length && vectors.every(p=>p.saved)?'저장된 상세지도':'상세지도';
  if (vectors.length<cells.length) {
    const pending=requests.some(t=>!streetBase.cache.has(t.id)&&!streetBase.failures.has(t.id));
    if (rasterCount && rasterCount===rasterTarget && vectors.length+missing.size===cells.length) label='상세지도';
    else if (vectors.length||rasterCount) label=pending && navigator.onLine?'상세지도 · 불러오는 중':'상세지도 · 일부 표시';
    else if(bundled.length)label='저장된 상세지도'+(pending && navigator.onLine?' · 원본 조회 중':'');
    else label=pending && navigator.onLine?'상세지도 불러오는 중':'상세지도 연결 실패 · '+fallbackLabel;
  }
  updateBaseLabel(label,sources.length?sources:['locator']);
}

function setBaseMode(mode) {
  if (!['street','satellite'].includes(mode)) return;
  streetBase.mode=mode;
  S.tiles=true;
  if ($('check-tiles')) $('check-tiles').checked=true;
  const select=$('basemap-type');
  if (select) select.value=mode;
  document.querySelectorAll('button[data-basemap]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.basemap===mode));
    button.classList.toggle('active',button.dataset.basemap===mode);
  });
  drawMap();
}
function initBaseModes() {
  document.querySelectorAll('button[data-basemap]').forEach(button=>{
    button.addEventListener('click',()=>setBaseMode(button.dataset.basemap));
    button.setAttribute('aria-pressed',String(button.dataset.basemap===streetBase.mode));
  });
  const select=$('basemap-type');
  if(select)select.onchange=()=>setBaseMode(select.value);
  window.addEventListener('online',()=>{
    streetBase.failures.clear();
    for (const [id,item] of streetBase.cache) {
      if (!item.saved) continue;
      streetBase.cache.delete(id);
      streetBase.cachedBytes-=item.weight;
    }
    mapTileRepaint();
  });
  window.addEventListener('offline',mapTileRepaint);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)mapTileRepaint()});
}

const googleAtlas = {isActive:()=>false,display:()=>false};
const svgNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text = '') => {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function project(lat, lng, z = S.z) {
  const n = 256 * 2 ** z,
    s = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
  return [(lng + 180) / 360 * n, (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
function unproject(x, y, z = S.z) {
  const n = 256 * 2 ** z;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, x / n * 360 - 180];
}
function mapView() {
  const m = $('map'),
    w = m.clientWidth,
    h = m.clientHeight,
    [x, y] = project(...S.center);
  return {
    w,
    h,
    l: x - w / 2,
    t: y - h / 2
  };
}
function xy(coord, v) {
  const [x, y] = project(coord[1], coord[0]);
  return [x - v.l, y - v.t];
}
function rings(g) {
  return g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'Polygon' ? g.coordinates : [];
}
function pathString(g, v) {
  return rings(g).map(r => r.map((c, i) => {
    const p = xy(c, v);
    return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  }).join('') + 'Z').join('');
}
function clampCenter(ll) {
  return [clamp(ll[0], 32.5, 39.2), clamp(ll[1], 124, 132)];
}
function mapBounds(v = mapView()) {
  const sw = unproject(v.l, v.t + v.h),
    ne = unproject(v.l + v.w, v.t);
  return [sw[1], sw[0], ne[1], ne[0]].map(x => +x.toFixed(5));
}
function labelAt(root, x, y, text, attrs = {}) {
  root.append(svg('text', {
    x,
    y,
    'text-anchor': 'middle',
    'font-family': 'Malgun Gothic, sans-serif',
    'paint-order': 'stroke',
    stroke: '#f3f6ee',
    'stroke-width': 3,
    'stroke-linejoin': 'round',
    fill: '#637b6c',
    'font-size': 12,
    ...attrs
  }, text));
}
let geoBounds = new Map();
function setImportedBackground(background) {
  BACKGROUND.features = background?.features || [];
  geoBounds = new Map(BACKGROUND.features.map(f => {
  let west = 180,
    east = -180,
    south = 90,
    north = -90;
  for (const ring of rings(f.geometry)) for (const [lng, lat] of ring) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [f, [west, south, east, north]];
}));
}
function drawLocator(v) {
  const root = $('locator');
  root.replaceChildren();
  root.setAttribute('viewBox', '0 0 ' + v.w + ' ' + v.h);
  root.append(svg('rect', {
    width: v.w,
    height: v.h,
    fill: '#e9f0e6'
  }));
  const fills = ['#e0eadd', '#eaf0e4', '#e6eee1', '#e2ece2', '#e8eee0'];
  const viewBounds = mapBounds(v);
  const local = BACKGROUND.features.filter(f => {
    const b = geoBounds.get(f);
    return b[0] <= viewBounds[2] && b[2] >= viewBounds[0] && b[1] <= viewBounds[3] && b[3] >= viewBounds[1];
  });
  local.forEach((f, i) => {
    root.append(svg('path', {
      d: pathString(f.geometry, v),
      fill: fills[i % fills.length],
      stroke: '#b5c8b9',
      'stroke-width': 1.4,
      'stroke-linejoin': 'round'
    }));
  });
  const b = mapBounds(v),
    step = S.z >= 14 ? .005 : S.z >= 12 ? .01 : S.z >= 10 ? .05 : .25;
  for (let k = Math.ceil(b[0] / step) * step; k < b[2]; k += step) {
    const [x] = xy([k, b[1]], v);
    root.append(svg('line', {
      x1: x,
      x2: x,
      y1: 0,
      y2: v.h,
      stroke: '#bdcfc1',
      'stroke-width': .65,
      'stroke-dasharray': '2 6'
    }));
  }
  for (let k = Math.ceil(b[1] / step) * step; k < b[3]; k += step) {
    const [, y] = xy([b[0], k], v);
    root.append(svg('line', {
      x1: 0,
      x2: v.w,
      y1: y,
      y2: y,
      stroke: '#bdcfc1',
      'stroke-width': .65,
      'stroke-dasharray': '2 6'
    }));
  }
  const drawn = [];
  for (const f of local) {
    const r = rings(f.geometry)[0] || [];
    if (!r.length) continue;
    const pts = r.map(c => xy(c, v)),
      xs = pts.map(p => p[0]),
      ys = pts.map(p => p[1]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2,
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (x > 25 && x < v.w - 25 && y > 18 && y < v.h - 14 && !drawn.some(p => Math.abs(p[0] - x) < 65 && Math.abs(p[1] - y) < 22)) {
      const name = f.properties.name.replace(/^(수원시|용인시|성남시|안양시)\s*/, '');
      labelAt(root, x, y, name, {
        'font-size': 14,
        'font-weight': 700,
        fill: '#6c8470'
      });
      drawn.push([x, y]);
    }
  }
  if (typeof drawLocalContext === 'function') drawLocalContext(root, v);
  streetBase.detailedLocal = S.tiles && streetBase.mode === 'street' && typeof drawOfflineStreet === 'function' && Boolean(drawOfflineStreet(root,v));
}
function visibleFeatures() { return S.areas ? S.features : []; }
function river50Class(grade) {
  return S.river50Manifest?.classes?.find(item => String(item.grade) === String(grade));
}
function river50Color(grade) {
  const item = river50Class(grade);
  if (item && /^#[0-9a-f]{6}$/i.test(item.color)) return item.color;
  const palette = ['#82d4e2','#3cadd0','#2b82bf','#4556ac','#67358a','#8b245d'];
  const index = S.river50Manifest?.classes?.indexOf(item) ?? -1;
  return index < 0 ? '#627886' : palette[Math.min(index, palette.length - 1)];
}
function river50ViewFeatures(bounds) {
  return visibleFeatures().filter(f => {
    const b = f.bbox;
    return !b || (b[0] <= bounds[2] && b[2] >= bounds[0] && b[1] <= bounds[3] && b[3] >= bounds[1]);
  });
}
function river50Overviews() {
  return S.source === 'river50' && S.areas ? S.river50Overviews || [] : [];
}
function river50RasterLayers() {
  const entries = river50Overviews();
  const highlights = S.z <= 12 ? entries.filter(entry => entry.highlightUrl).map(entry => ({
    district:entry.district, url:entry.highlightUrl, opacity:1
  })) : [];
  // Draw all real depth masks last, including those belonging to neighbors
  // whose model intersects the locator outline in another district's image.
  const depth = entries.map(entry => ({district:entry.district,url:entry.url,opacity:highlights.length ? .98 : .82}));
  return [...highlights,...depth];
}
const river50Images = new Map();
let river50PickSerial = 0, river50PixelContext;
async function river50Image(url) {
  let ready = river50Images.get(url);
  if (ready) river50Images.delete(url);
  else {
    const image = new Image();
    image.src = url;
    ready = image.decode().then(() => image);
  }
  river50Images.set(url, ready);
  if (river50Images.size > 3) river50Images.delete(river50Images.keys().next().value);
  try {
    return await ready;
  } catch (error) {
    if (river50Images.get(url) === ready) river50Images.delete(url);
    throw error;
  }
}
function river50Pixels(image,x,y,width,height) {
  if (!river50PixelContext) {
    const canvas = document.createElement('canvas');
    river50PixelContext = canvas.getContext('2d',{willReadFrequently:true});
  }
  const ctx = river50PixelContext;
  if (ctx.canvas.width !== width) ctx.canvas.width = width;
  if (ctx.canvas.height !== height) ctx.canvas.height = height;
  ctx.clearRect(0,0,width,height);
  ctx.drawImage(image,x,y,width,height,0,0,width,height);
  return ctx.getImageData(0,0,width,height).data;
}
function river50ImagePoint(image, ll, bounds) {
  const [w,s,e,n] = bounds, [lat,lng] = ll;
  const top = project(n,w,0)[1], bottom = project(s,w,0)[1];
  const x = clamp(Math.floor((lng-w)/(e-w)*image.naturalWidth),0,image.naturalWidth-1);
  const y = clamp(Math.floor((project(lat,lng,0)[1]-top)/(bottom-top)*image.naturalHeight),0,image.naturalHeight-1);
  return [x,y];
}
function river50Pixel(image, ll, bounds) {
  const [x,y] = river50ImagePoint(image,ll,bounds);
  const [r,g,b,a] = river50Pixels(image,x,y,1,1);
  return a ? '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('') : null;
}
function nearestRiver50Footprint(image,ll,overview) {
  const [x,y] = river50ImagePoint(image,ll,overview.bbox);
  const radius = Math.max(1,Math.ceil(overview.highlightRadiusPixels || 48));
  const left = Math.max(0,x-radius), top = Math.max(0,y-radius);
  const width = Math.min(x+radius+1,image.naturalWidth)-left, height = Math.min(y+radius+1,image.naturalHeight)-top;
  const pixels = river50Pixels(image,left,top,width,height);
  const [w,s,e,n] = overview.bbox, nw = project(n,w,0), se = project(s,e,0);
  const dx = (se[0]-nw[0])/image.naturalWidth, dy = (se[1]-nw[1])/image.naturalHeight;
  const click = project(...ll,0);
  let nearest = null;
  for (let row=0;row<height;row++) for (let col=0;col<width;col++) {
    if (!pixels[4*(row*width+col)+3]) continue;
    const px = nw[0]+(left+col+.5)*dx, py = nw[1]+(top+row+.5)*dy;
    const distance = (px-click[0])**2+(py-click[1])**2;
    if (!nearest || distance < nearest.distance) nearest = {distance,px,py};
  }
  return nearest && {ll:unproject(nearest.px,nearest.py,0),distance:nearest.distance};
}
function focusRiver50Location(ll) {
  S.center = [...ll];
  S.z = 15;
  drawMap();
  scheduleFeed(0);
}
async function selectRiver50Overview(ll) {
  const serial = ++river50PickSerial, selection = S.river50District;
  const clickZoom = S.z;
  const current = () => serial === river50PickSerial && S.source === 'river50' && S.areas && S.river50District === selection && S.z === clickZoom;
  // Adjacent districts' rectangular images overlap. A transparent pixel in an
  // upper rectangle must let the next visible district answer the same click.
  let unreadable = false;
  const locators = [];
  for (const {district,url,highlightUrl} of [...river50Overviews()].reverse()) {
    const [w,s,e,n] = district.overview.bbox, [lat,lng] = ll;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    try {
      const image = await river50Image(url);
      if (!current()) return;
      if (!river50Overviews().some(entry => entry.url === url)) continue;
      const color = river50Pixel(image,ll,district.overview.bbox);
      if (!color) {
        if (clickZoom <= 12 && highlightUrl) locators.push({district,url,highlightUrl,image});
        continue;
      }
      const item = S.river50Manifest?.classes?.find(c => river50Color(c.grade).toLowerCase() === color);
      selectMapArea({river50DistrictId:district.id,properties:{grade:item?.grade}},ll);
      if (clickZoom <= 12 && highlightUrl) focusRiver50Location(ll);
      return;
    } catch {
      unreadable = true;
    }
  }
  let nearest = null;
  for (const {district,url,highlightUrl,image} of locators) {
    try {
      const locator = await river50Image(highlightUrl);
      if (!current()) return;
      if (!river50Overviews().some(entry => entry.url === url) || !river50Pixel(locator,ll,district.overview.bbox)) continue;
      const candidate = nearestRiver50Footprint(image,ll,district.overview);
      if (candidate && (!nearest || candidate.distance < nearest.distance)) nearest = candidate;
    } catch {
      unreadable = true;
    }
  }
  if (current() && S.sel?.model === 'river50') {
    S.sel = null;
    renderPopup();
  }
  if (nearest && current()) {
    focusRiver50Location(nearest.ll);
    return;
  }
  if (unreadable && current()) notify('지도를 확대하면 해당 구역의 상세 정보를 볼 수 있습니다.');
}
function selectMapArea(f, ll) {
  if (S.source === 'river50') {
    river50PickSerial++;
    const grade = f.properties?.grade, item = river50Class(grade);
    const district = S.river50Manifest?.districts?.find(d => String(d.id) === String(f.river50DistrictId)) ||
      (S.river50District?.id !== '__all__' ? S.river50District : null);
    S.sel = {
      id: 'area:river50:' + district?.id + ':' + (f.id ?? ll.join(',')),
      model: 'river50',
      district: district?.name,
      districtId: district?.id,
      title: [district?.name, '예상 범람 구역'].filter(Boolean).join(' · '),
      where: '지방하천 50년빈도',
      areaFacts: S.river50Manifest?.depthVerified === true && item?.label ? '예상 침수심 · ' + item.label : '',
      source: typeof S.river50Manifest?.source === 'string' ? S.river50Manifest.source : '지방하천 홍수위험지도',
      lat: ll[0], lng: ll[1]
    };
    renderPopup();
  }
}

// Detailed river polygons are projected once in district-local coordinates.
// Panning or zooming only moves the SVG group and adds newly visible features.
let riverSvg = null;
const riverVectorZoom = 16;
function clearRiverSvg() {
  if (!riverSvg) return;
  cancelAnimationFrame(riverSvg.frame);
  riverSvg = null;
}
function drawRiverSvgOverviews(layer, v) {
  const entries = river50RasterLayers(), keep = new Set(entries.map(entry => entry.url));
  for (const [url,image] of layer.images) if (!keep.has(url)) {
    image.remove();
    layer.images.delete(url);
  }
  entries.forEach(({district,url,opacity},index) => {
    let image = layer.images.get(url);
    if (!image) {
      image = svg('image',{href:url,'preserveAspectRatio':'none','pointer-events':'visiblePainted'});
      layer.images.set(url,image);
    }
    const next = layer.rasters.children[index];
    if (next !== image) layer.rasters.insertBefore(image,next || null);
    image.setAttribute('opacity',opacity);
    const [w,s,e,n] = district.overview.bbox, a = xy([w,n],v), b = xy([e,s],v);
    for (const [key,value] of Object.entries({x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1]})) image.setAttribute(key,value);
  });
}
function drawRiverSvg(root, v) {
  const district = S.river50District;
  if (!district || !S.areas) {
    clearRiverSvg();
    root.replaceChildren();
    return;
  }
  if (riverSvg?.district !== district || !root.contains(riverSvg.group)) {
    clearRiverSvg();
    const group = svg('g'), rasters = svg('g');
    const origin = project(district.bbox[3], district.bbox[0], riverVectorZoom);
    riverSvg = {district, group, rasters, origin, images:new Map(),drawn:new Map(), frame:0};
    rasters.addEventListener('click', event => {
      if (suppressClick) return;
      const m = $('map').getBoundingClientRect(), view = mapView();
      selectRiver50Overview(unproject(view.l+event.clientX-m.left,view.t+event.clientY-m.top));
    });
    root.replaceChildren(rasters,group);
  }
  const layer = riverSvg, ratio = 2 ** (S.z - riverVectorZoom);
  layer.group.setAttribute('transform', 'translate(' + (layer.origin[0]*ratio-v.l) + ' ' +
    (layer.origin[1]*ratio-v.t) + ') scale(' + ratio + ')');
  drawRiverSvgOverviews(layer,v);
  const stamp = [S.z,v.l,v.t,v.w,v.h].join('|');
  if (layer.stamp === stamp && layer.features === S.features) return;
  layer.stamp = stamp;
  layer.features = S.features;
  cancelAnimationFrame(layer.frame);
  const visible = new Set(river50ViewFeatures(mapBounds(v)));
  for (const [f,node] of layer.drawn) if (!visible.has(f)) {
    node.remove();
    layer.drawn.delete(f);
  }
  const pending = Array.from(visible).filter(f => !layer.drawn.has(f));
  let index = 0;
  function addPaths() {
    if (riverSvg !== layer || !S.areas || S.source !== 'river50') return;
    const start = performance.now();
    while (index < pending.length) {
      const f = pending[index++], grade = f.properties?.grade;
      const d = rings(f.geometry).map(ring => ring.map(([lng,lat], i) => {
        const [x,y] = project(lat,lng,riverVectorZoom);
        return (i ? 'L' : 'M') + (x-layer.origin[0]).toFixed(2) + ' ' + (y-layer.origin[1]).toFixed(2);
      }).join('') + 'Z').join('');
      const path = svg('path', {d, 'fill-rule':'evenodd', 'vector-effect':'non-scaling-stroke'});
      path.style.fill = river50Color(grade);
      path.style.fillOpacity = '.8';
      path.style.stroke = '#58364f';
      path.style.strokeOpacity = '.68';
      path.style.strokeWidth = '.65';
      path.addEventListener('click', event => {
        if (suppressClick) return;
        const m = $('map').getBoundingClientRect(), view = mapView();
        selectMapArea(f,unproject(view.l+event.clientX-m.left,view.t+event.clientY-m.top));
      });
      layer.group.append(path);
      layer.drawn.set(f,path);
      if (performance.now()-start >= 8) break;
    }
    if (index < pending.length) layer.frame = requestAnimationFrame(addPaths);
  }
  if (pending.length) addPaths();
}
function drawMap() {
  const v = mapView();
  if (!v.w || !v.h) return;
  const key = $('river50-highlight-key');
  if (key) key.hidden = !(S.z <= 12 && river50Overviews().some(entry => entry.highlightUrl));
  const googleVisible = googleAtlas.display();
  if (!googleVisible) {
    drawLocator(v);
    const root = $('shapes');
    root.setAttribute('viewBox', '0 0 ' + v.w + ' ' + v.h);
    drawRiverSvg(root, v);
  } else if (riverSvg) {
    clearRiverSvg();
    $('shapes').replaceChildren();
  }
  drawTiles(v);
  renderPopup();
  const meters = 156543.03392 * Math.cos(S.center[0] * Math.PI / 180) / 2 ** S.z,
    target = meters * Math.min(85, v.w * .18),
    base = 10 ** Math.floor(Math.log10(target));
  const n = (target / base >= 5 ? 5 : target / base >= 2 ? 2 : 1) * base;
  $('scale').style.width = n / meters + 'px';
  $('scale').textContent = n >= 1000 ? n / 1000 + ' km' : n + ' m';
}
function renderPopup() {
  const p = S.sel,
    box = $('map-popup');
  box.replaceChildren();
  box.hidden = !p;
  if (!p) return;
  box.append(el('strong', '', p.title), el('small', '', [p.date, p.where].filter(Boolean).join('  ·  ')));
  if (p.areaFacts) box.append(el('small', '', p.areaFacts));
  const close = action('×', () => {
    S.sel = null;
    drawMap();
  }, 'iconbtn pop-close');
  close.setAttribute('aria-label', '지점 선택 닫기');
  box.append(el('small', '', '출처 · ' + p.source), close);
}
function fitView() {
  const bounds = S.river50District?.bbox;
  if (bounds) {
    const v = mapView();
    let z = 16;
    const [w,s,e,n] = bounds, a = [n,w], b = [s,e];
    const allDistricts = S.river50District?.id === river50AllId;
    const fitWidth = allDistricts ? v.w - 2 * Math.min(16, v.w * .035) : v.w * .76;
    const fitHeight = allDistricts ? v.h - 2 * Math.min(20, v.h * .04) : v.h * .64;
    for (; z > 6; z--) {
      const p = project(...a, z),
        q = project(...b, z);
      if (q[0] - p[0] < fitWidth && q[1] - p[1] < fitHeight) break;
    }
    const p = project(...a, z),
      q = project(...b, z);
    S.center = unproject((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z);
    S.z = z;
  }
  drawMap();
  scheduleFeed();
}
function zoom(delta, x, y) {
  const v = mapView(),
    oldZ = S.z,
    newZ = clamp(oldZ + delta, 6, 19);
  if (newZ === oldZ) return;
  const px = x ?? v.w / 2,
    py = y ?? v.h / 2;
  const ll = unproject(v.l + px, v.t + py, oldZ),
    point = project(...ll, newZ);
  S.z = newZ;
  S.center = clampCenter(unproject(point[0] - px + v.w / 2, point[1] - py + v.h / 2, newZ));
  drawMap();
  scheduleFeed();
}
let suppressClick = false,
  drag = null,
  frame = 0;
function drawSoon() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    drawMap();
  });
}
function initMap() {
  const m = $('map');
  initBaseModes();
  const touches = new Map();
  let pinch = null;
  const touchMidpoint = () => {
    const [a,b] = Array.from(touches.values()).slice(0,2);
    const bounds = m.getBoundingClientRect();
    return {x:(a.x+b.x)/2-bounds.left, y:(a.y+b.y)/2-bounds.top,
            distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
  };
  const startDrag = (id,x,y) => {
    drag = {id, start:[x,y], center:project(...S.center), moved:false};
    m.classList.add('dragging');
  };
  m.addEventListener('pointerdown', event => {
    if (event.target.closest('button,a,.layer-box,#map-popup,#google-base,select,input') || event.button !== 0) return;
    if (event.pointerType === 'touch') {
      if(touches.size>=2)return;
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (touches.size===2) {
        const mid=touchMidpoint(), v=mapView();
        pinch={distance:mid.distance,z:S.z,anchor:unproject(v.l+mid.x,v.t+mid.y)};
        drag=null;
        for(const id of touches.keys())m.setPointerCapture(id);
        return;
      }
    } else if (drag) return;
    startDrag(event.pointerId,event.clientX,event.clientY);
  });
  m.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (pinch && touches.size===2) {
      const mid=touchMidpoint(), v=mapView();
      S.z=clamp(pinch.z+Math.round(Math.log2(mid.distance/pinch.distance)),6,19);
      const p=project(...pinch.anchor);
      S.center=clampCenter(unproject(p[0]-mid.x+v.w/2,p[1]-mid.y+v.h/2));
      drawSoon();
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    const dx=event.clientX-drag.start[0],dy=event.clientY-drag.start[1];
    if (Math.abs(dx)+Math.abs(dy)<4 && !drag.moved) return;
    drag.moved=true;
    if(!m.hasPointerCapture(event.pointerId))m.setPointerCapture(event.pointerId);
    S.center=clampCenter(unproject(drag.center[0]-dx,drag.center[1]-dy));
    drawSoon();
  });
  const end = event => {
    if (!touches.has(event.pointerId) && drag?.id!==event.pointerId) return;
    touches.delete(event.pointerId);
    const moved=Boolean(pinch||drag?.moved);
    if(m.hasPointerCapture(event.pointerId))m.releasePointerCapture(event.pointerId);
    drag=null;
    pinch=null;
    if(touches.size) {
      const [id,pt]=touches.entries().next().value;
      startDrag(id,pt.x,pt.y);
    } else m.classList.remove('dragging');
    if(moved) {
      suppressClick=true;
      setTimeout(()=>suppressClick=false,100);
      scheduleFeed();
    }
  };
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
  m.addEventListener('dblclick',event=>{
    if (event.target.closest('button,a,.layer-box,#map-popup,#google-base,select,input')) return;
    event.preventDefault();
    const r=m.getBoundingClientRect();
    zoom(event.shiftKey?-1:1,event.clientX-r.left,event.clientY-r.top);
  });
  let last = 0;
  m.addEventListener('wheel', e => {
    if (e.target.closest('.layer-box,#map-popup,#google-base')) return;
    e.preventDefault();
    if (Date.now() - last < 160) return;
    last = Date.now();
    const r = m.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }, {
    passive: false
  });
  m.addEventListener('keydown', e => {
    if (e.target !== m) return;
    if (e.key === '+' || e.key === '=') zoom(1);else if (e.key === '-') zoom(-1);else {
      const d = {
        ArrowUp: [0, -90],
        ArrowRight: [90, 0],
        ArrowDown: [0, 90],
        ArrowLeft: [-90, 0]
      }[e.key];
      if (!d) return;
      const p = project(...S.center);
      S.center = clampCenter(unproject(p[0] + d[0], p[1] + d[1]));
      drawMap();
      scheduleFeed();
    }
    e.preventDefault();
  });
  $('fit').onclick = fitView;
  $('zin').onclick = () => zoom(1);
  $('zout').onclick = () => zoom(-1);
  new ResizeObserver(() => {
    drawSoon();
    scheduleFeed(450);
  }).observe(m);
}
