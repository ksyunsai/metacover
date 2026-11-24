// ZIP input stays in this browser. Only the manifest's map files are decoded.
const openForecastZip = (() => {
  const MiB = 1024 * 1024;
  const decoder = new TextDecoder('utf-8', {fatal:true});
  const crcTable = Uint32Array.from({length:256}, (_, index) => {
    let n = index;
    for (let bit=0; bit<8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
    return n;
  });
  const invalid = () => { throw Error('지도 ZIP의 형식이나 내용이 올바르지 않습니다.'); };
  const requireValue = ok => { if (!ok) invalid(); };
  const integer = (n,min,max) => Number.isInteger(n) && n >= min && n <= max;
  const text = (value,max=180) => {
    requireValue(typeof value === 'string' && value.length > 0 && value.length <= max);
    return value;
  };
  const dataView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = async (blob,start,length) => new Uint8Array(await blob.slice(start,start+length).arrayBuffer());

  async function directory(file) {
    requireValue(file && typeof file.slice === 'function' && integer(file.size,22,192*MiB));
    const tailAt = Math.max(0,file.size-65557);
    const tail = await read(file,tailAt,file.size-tailAt), end = dataView(tail);
    let at = tail.length-22;
    while (at >= 0 && (end.getUint32(at,true) !== 0x06054b50 ||
      at+22+end.getUint16(at+20,true) !== tail.length)) at--;
    requireValue(at >= 0 && end.getUint32(at+4,true) === 0);
    const count = end.getUint16(at+10,true), size = end.getUint32(at+12,true), offset = end.getUint32(at+16,true);
    requireValue(integer(count,1,2048) && end.getUint16(at+8,true) === count && size <= 2*MiB && offset+size === tailAt+at);
    const bytes = await read(file,offset,size), view = dataView(bytes), entries = new Map();
    let pos = 0;
    for (let i=0; i<count; i++) {
      requireValue(pos+46 <= bytes.length && view.getUint32(pos,true) === 0x02014b50);
      const nameLen = view.getUint16(pos+28,true), extra = view.getUint16(pos+30,true), comment = view.getUint16(pos+32,true);
      const next = pos+46+nameLen+extra+comment;
      requireValue(integer(nameLen,1,512) && next <= size && view.getUint16(pos+34,true) === 0);
      const name = decoder.decode(bytes.subarray(pos+46,pos+46+nameLen));
      const path = name.replace(/\/$/,'').split('/');
      requireValue(!/[\\:\x00-\x1f]/.test(name) && path.every(p => p && p !== '.' && p !== '..') && !entries.has(name));
      entries.set(name, {
        name, nameLen, flags:view.getUint16(pos+8,true), method:view.getUint16(pos+10,true),
        crc:view.getUint32(pos+16,true), compressed:view.getUint32(pos+20,true),
        length:view.getUint32(pos+24,true), offset:view.getUint32(pos+42,true)
      });
      pos = next;
    }
    requireValue(pos === size);
    return {entries,limit:offset};
  }

  async function extract(file,zip,entry,max,signal) {
    signal?.throwIfAborted();
    requireValue(entry && entry.length > 0 && entry.length <= max && entry.compressed <= max+65536 &&
      !(entry.flags & ~0x080e) && [0,8].includes(entry.method) && entry.offset+30 <= zip.limit);
    const header = dataView(await read(file,entry.offset,30));
    requireValue(header.byteLength === 30 && header.getUint32(0,true) === 0x04034b50 &&
      header.getUint16(6,true) === entry.flags && header.getUint16(8,true) === entry.method &&
      header.getUint16(26,true) === entry.nameLen);
    const pos = entry.offset+30+entry.nameLen+header.getUint16(28,true);
    requireValue(pos+entry.compressed <= zip.limit &&
      decoder.decode(await read(file,entry.offset+30,entry.nameLen)) === entry.name);
    let stream = file.slice(pos,pos+entry.compressed).stream();
    if (entry.method === 8) {
      let inflate;
      try { inflate = new DecompressionStream('deflate-raw'); }
      catch { throw Error('이 ZIP을 열려면 최신 Chrome, Edge, Safari 또는 Firefox를 이용하세요.'); }
      stream = stream.pipeThrough(inflate);
    } else requireValue(entry.compressed === entry.length);
    const reader = stream.getReader(), bytes = new Uint8Array(entry.length);
    let written = 0, crc = 0xffffffff;
    const cancel = () => { void reader.cancel().catch(()=>{}); };
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      for (;;) {
        signal?.throwIfAborted();
        const {done,value} = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        requireValue(written+value.length <= bytes.length);
        bytes.set(value,written);
        written += value.length;
        for (let i=0;i<value.length;i++) crc = crcTable[(crc ^ value[i]) & 255] ^ (crc >>> 8);
      }
      requireValue(written === entry.length && ((crc ^ 0xffffffff) >>> 0) === entry.crc);
      return bytes;
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal?.removeEventListener('abort',cancel);
      reader.releaseLock();
    }
  }

  function box(value) {
    requireValue(Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
      value[0] >= -180 && value[2] <= 180 && value[1] >= -85 && value[3] <= 85 &&
      value[0] < value[2] && value[1] < value[3]);
    return value;
  }
  function officialLink(value) {
    const u = new URL(value);
    requireValue(u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      /^(?:www\.|data\.)?floodmap\.go\.kr$/.test(u.hostname));
    return u.href;
  }
  function validateManifest(m) {
    requireValue(m?.version === 1 && m.frequency === 50 && m.crs === 'OGC:CRS84' && m.sourceCrs === 'EPSG:5186' &&
      Array.isArray(m.districts) && m.districts.length === 8 && Array.isArray(m.classes) && m.classes.length === 5);
    const grades = new Set(), ids = new Set(), filenames = new Set();
    const classes = m.classes.map(c => {
      requireValue(integer(c.grade,1,5) && !grades.has(c.grade) && /^N\d{3}$/.test(c.code) && /^#[0-9a-f]{6}$/i.test(c.color));
      grades.add(c.grade);
      return {grade:c.grade, code:c.code, color:c.color, label:text(c.label,45)};
    });
    const districts = m.districts.map(d => {
      const id = text(d.id,5), o = d.overview;
      requireValue(/^\d{5}$/.test(id) && !ids.has(id) && o?.file === id+'-overview.png' && o.highlight === id+'-highlight.png' &&
        integer(o.width,1,4096) && integer(o.height,1,4096) && o.width*o.height <= 6*MiB &&
        integer(o.highlightRadiusPixels,1,512) && Array.isArray(d.files) && integer(d.files.length,1,256));
      ids.add(id);
      const files = d.files.map(part => {
        requireValue(typeof part.file === 'string' && part.file.startsWith(id+'-') && /^\d{5}-\d{2,3}\.geojson$/.test(part.file) &&
          !filenames.has(part.file) && integer(part.vertexCount,1,180000) && integer(part.bytes,1,6*MiB));
        filenames.add(part.file);
        return {file:part.file, bbox:box(part.bbox), vertexCount:part.vertexCount, bytes:part.bytes, count:part.count};
      });
      return {id,name:text(d.name,75), bbox:box(d.bbox), files, overview:{file:o.file, highlight:o.highlight,
        width:o.width,height:o.height,bbox:box(o.bbox),highlightRadiusPixels:o.highlightRadiusPixels}};
    });
    return {version:1, title:text(m.title), source:text(m.source), sourceUrl:officialLink(m.sourceUrl),
      depthSourceUrl:officialLink(m.depthSourceUrl),sourceCrs:m.sourceCrs,crs:m.crs,frequency:50,
      depthVerified:m.depthVerified === true,classes,districts,bbox:box(m.bbox)};
  }
  function featureCollection(data,background=false) {
    requireValue(data?.type === 'FeatureCollection' && Array.isArray(data.features) && data.features.length <= 10000);
    let vertices = 0;
    const features = data.features.map(f => {
      const g=f?.geometry;
      requireValue(f.type === 'Feature' && ['Polygon','MultiPolygon'].includes(g?.type) && Array.isArray(g.coordinates));
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const polygon of polygons) {
        requireValue(Array.isArray(polygon) && polygon.length);
        for (const ring of polygon) {
          requireValue(Array.isArray(ring) && ring.length >= 4);
          vertices += ring.length;
          requireValue(vertices <= 220000 && ring.every(p => Array.isArray(p) && p.length >= 2 &&
            Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85));
        }
      }
      const feature={type:'Feature', geometry:{type:g.type,coordinates:g.coordinates},properties:{}};
      if (background) feature.properties.name=text(f.properties?.name,100);
      else {
        requireValue(integer(f.properties?.grade,1,5));
        feature.properties.grade=f.properties.grade;
        feature.bbox=box(f.bbox);
        if (typeof f.id === 'string' && f.id.length <= 150) feature.id=f.id;
      }
      return feature;
    });
    return {type:'FeatureCollection',features};
  }

  return async function openForecastZip(file) {
    const zip = await directory(file);
    const matches = [...zip.entries.keys()].filter(n => /^(?:[^/]+\/)?river50\/manifest\.json$/.test(n));
    requireValue(matches.length === 1);
    const prefix = matches[0].slice(0,-'manifest.json'.length);
    const json = async (entry,max,signal) => JSON.parse(decoder.decode(await extract(file,zip,entry,max,signal)));
    const manifest = validateManifest(await json(zip.entries.get(matches[0]),256*1024));
    const parts = new Map(), images = new Map(), closing = new AbortController();
    let total = 0;
    const dispose = () => {
      closing.abort();
      for (const url of images.values()) URL.revokeObjectURL(url);
      images.clear();
    };
    try {
      for (const d of manifest.districts) {
        for (const part of d.files) {
          const entry = zip.entries.get(prefix+part.file);
          requireValue(entry && entry.length === part.bytes);
          total += entry.length;
          requireValue(total <= 160*MiB);
          parts.set(part.file,entry);
        }
        for (const name of [d.overview.file,d.overview.highlight]) {
          const bytes = await extract(file,zip,zip.entries.get(prefix+name),4*MiB), png = dataView(bytes);
          requireValue(bytes.length >= 33 && png.getUint32(0) === 0x89504e47 && png.getUint32(4) === 0x0d0a1a0a &&
            png.getUint32(8) === 13 && png.getUint32(12) === 0x49484452 && png.getUint32(16) === d.overview.width &&
            png.getUint32(20) === d.overview.height);
          images.set(name,URL.createObjectURL(new Blob([bytes],{type:'image/png'})));
        }
      }
      let background;
      const outline = zip.entries.get(prefix.slice(0,-'river50/'.length)+'src/boundaries.json');
      if (outline) background = featureCollection(await json(outline,2*MiB),true);
      async function readPart(name,signal) {
        closing.signal.throwIfAborted();
        const active = signal ? AbortSignal.any([signal,closing.signal]) : closing.signal;
        return featureCollection(await json(parts.get(name),6*MiB,active));
      }
      return {manifest,images,background,readPart,dispose};
    } catch (error) {
      dispose();
      throw error;
    }
  };
})();
