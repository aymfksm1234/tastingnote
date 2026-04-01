// ── Map View (Simple SVG world map with origin markers) ──────
import { escHtml } from './utils.js';

// Approximate lat/lng for coffee origins → SVG coordinates
const ORIGIN_COORDS = {
  'エチオピア': [38, 9], 'ケニア': [38, -1], 'ルワンダ': [30, -2],
  'タンザニア': [35, -6], 'ウガンダ': [32, 1], 'コンゴ': [25, -3],
  'ザンビア': [28, -15], 'マラウイ': [34, -14], 'カメルーン': [12, 6],
  'コロンビア': [-74, 4], 'ブラジル': [-48, -15], 'ペルー': [-76, -10],
  'ボリビア': [-65, -17], 'グアテマラ': [-90, 15], 'コスタリカ': [-84, 10],
  'パナマ': [-80, 9], 'ホンジュラス': [-87, 15], 'エルサルバドル': [-89, 14],
  'ニカラグア': [-85, 13], 'メキシコ': [-99, 19], 'ジャマイカ': [-77, 18],
  'キューバ': [-80, 22], 'ハワイ': [-155, 20],
  'インドネシア': [118, -2], 'ベトナム': [108, 14], 'インド': [78, 20],
  'フィリピン': [122, 13], 'パプアニューギニア': [147, -6],
  'イエメン': [48, 15], 'タイ': [101, 15], 'ミャンマー': [96, 20],
  '中国（雲南）': [101, 25],
};

function lngLatToSvg(lng, lat) {
  // Simple equirectangular projection
  const x = ((lng + 180) / 360) * 800;
  const y = ((90 - lat) / 180) * 450;
  return [x, y];
}

export function renderMap(notes, svgEl, legendEl) {
  // Count origins
  const originCounts = {};
  notes.forEach(n => {
    if (n.origin) originCounts[n.origin] = (originCounts[n.origin] || 0) + 1;
  });

  const ns = 'http://www.w3.org/2000/svg';
  svgEl.innerHTML = '';

  // Background
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', '800');
  bg.setAttribute('height', '450');
  bg.setAttribute('fill', '#e8e0d4');
  bg.setAttribute('rx', '12');
  svgEl.appendChild(bg);

  // Simple continent outlines (very simplified paths)
  const continents = document.createElementNS(ns, 'g');
  continents.innerHTML = `
    <ellipse cx="200" cy="170" rx="80" ry="60" fill="#d4c5a9" opacity="0.5"/>
    <ellipse cx="180" cy="290" rx="50" ry="70" fill="#d4c5a9" opacity="0.5"/>
    <ellipse cx="410" cy="160" rx="60" ry="80" fill="#d4c5a9" opacity="0.5"/>
    <ellipse cx="430" cy="280" rx="40" ry="50" fill="#d4c5a9" opacity="0.5"/>
    <ellipse cx="560" cy="180" rx="80" ry="60" fill="#d4c5a9" opacity="0.5"/>
    <ellipse cx="620" cy="310" rx="50" ry="40" fill="#d4c5a9" opacity="0.5"/>
  `;
  svgEl.appendChild(continents);

  // Tropic lines
  [23.5, -23.5].forEach(lat => {
    const [, y] = lngLatToSvg(0, lat);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '0'); line.setAttribute('x2', '800');
    line.setAttribute('y1', y); line.setAttribute('y2', y);
    line.setAttribute('stroke', '#c8973a'); line.setAttribute('stroke-width', '0.5');
    line.setAttribute('stroke-dasharray', '4,4'); line.setAttribute('opacity', '0.4');
    svgEl.appendChild(line);
  });

  // Coffee belt label
  const beltLabel = document.createElementNS(ns, 'text');
  beltLabel.setAttribute('x', '790'); beltLabel.setAttribute('y', lngLatToSvg(0, 23.5)[1] + 12);
  beltLabel.setAttribute('text-anchor', 'end');
  beltLabel.setAttribute('font-size', '9'); beltLabel.setAttribute('fill', '#c8973a');
  beltLabel.setAttribute('opacity', '0.6');
  beltLabel.textContent = 'Coffee Belt';
  svgEl.appendChild(beltLabel);

  const maxCount = Math.max(1, ...Object.values(originCounts));

  // Plot markers
  Object.entries(originCounts).forEach(([origin, count]) => {
    const coords = ORIGIN_COORDS[origin];
    if (!coords) return;

    const [x, y] = lngLatToSvg(coords[0], coords[1]);
    const r = 5 + (count / maxCount) * 12;

    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'rgba(200,151,58,0.6)');
    circle.setAttribute('stroke', '#c8973a'); circle.setAttribute('stroke-width', '1.5');
    svgEl.appendChild(circle);

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', x); text.setAttribute('y', y + r + 12);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10'); text.setAttribute('fill', '#5c3d1e');
    text.setAttribute('font-family', '-apple-system, sans-serif');
    text.textContent = `${origin}(${count})`;
    svgEl.appendChild(text);
  });

  // Legend
  const origins = Object.entries(originCounts).sort((a, b) => b[1] - a[1]);
  legendEl.innerHTML = origins.length === 0
    ? '<p class="empty-msg">産地が記録されると地図にプロットされます</p>'
    : `<div class="map-legend-items">${origins.map(([o, c]) =>
        `<span class="map-legend-item">${escHtml(o)} <strong>${c}</strong></span>`
      ).join('')}</div>`;
}
