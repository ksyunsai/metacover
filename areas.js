(() => {
  'use strict';

  // Camera calibration for the full 1612 × 790 reference image.
  const radians = Math.PI / 180;
  const mercator = lat => Math.asinh(Math.tan(lat * radians)) / radians;
  const originY = mercator(37.2);
  function toPixel(lng, lat) {
    return [575.34 + 1237.80 * (lng - 127), 443.24 + 1238.64 * (originY - mercator(lat))];
  }
  function toLatLng(x, y) {
    return [
      127 + (x - 575.34) / 1237.80,
      Math.atan(Math.sinh((originY - (y - 443.24) / 1238.64) * radians)) / radians
    ];
  }

  // Approximate administrative camera extents for navigation. Source: Statistics
  // Korea (2013), https://github.com/southkorea/southkorea-maps/tree/master/kostat/2013
  const extents = [
    ['41111', '수원시 장안구', 126.96634, 37.28269, 127.04202, 37.34874],
    ['41113', '수원시 권선구', 126.92947, 37.22208, 127.04179, 37.30022],
    ['41115', '수원시 팔달구', 126.98086, 37.25369, 127.04616, 37.29037],
    ['41117', '수원시 영통구', 127.03603, 37.23731, 127.09199, 37.31851],
    ['41461', '용인시 처인구', 127.11116, 37.08374, 127.43196, 37.35608],
    ['41463', '용인시 기흥구', 127.06719, 37.21352, 127.17922, 37.32156],
    ['41465', '용인시 수지구', 127.02091, 37.29376, 127.14397, 37.36932],
    ['41370', '오산시',       127.00187, 37.12622, 127.10575, 37.19787]
  ];
  const areas = extents.map(([id, name, west, south, east, north]) => {
    const [left, top] = toPixel(west, north);
    const [right, bottom] = toPixel(east, south);
    return { id, name, center: [(left + right) / 2, (top + bottom) / 2], bounds: [left, top, right, bottom] };
  });
  window.metacoverLocations = { areas, toLatLng, toPixel };
})();
