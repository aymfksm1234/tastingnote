// ── Statistics Dashboard ──────────────────────────────────────
import { escHtml, ROAST_LABELS } from './utils.js';

export function renderStats(notes, container) {
  if (notes.length === 0) {
    container.innerHTML = '<p class="empty-msg">記録が増えると統計が表示されます</p>';
    return;
  }

  const total = notes.length;
  const avgRating = notes.filter(n => n.rating > 0).reduce((s, n) => s + n.rating, 0) / (notes.filter(n => n.rating > 0).length || 1);

  // Count by field
  const originCounts = countBy(notes, 'origin');
  const roasterCounts = countBy(notes, 'roaster');
  const processCounts = countBy(notes, 'process');
  const brewCounts = countBy(notes, 'brewMethod');

  // Average flavor profile
  const avgFlavor = {
    bitterness: avg(notes, 'bitterness'),
    acidity: avg(notes, 'acidity'),
    sweetness: avg(notes, 'sweetness'),
    body: avg(notes, 'body'),
  };

  // Top tags
  const tagCounts = {};
  notes.forEach(n => (n.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Monthly trend
  const monthly = {};
  notes.forEach(n => {
    const d = n.drinkDate || new Date(n.createdAt).toISOString().slice(0, 10);
    const month = d.slice(0, 7);
    if (!monthly[month]) monthly[month] = { count: 0, ratingSum: 0, ratingCount: 0 };
    monthly[month].count++;
    if (n.rating > 0) { monthly[month].ratingSum += n.rating; monthly[month].ratingCount++; }
  });

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${total}</div>
        <div class="stat-label">総記録数</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${avgRating.toFixed(1)}</div>
        <div class="stat-label">平均評価</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${Object.keys(originCounts).length}</div>
        <div class="stat-label">産地の種類</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${Object.keys(roasterCounts).length}</div>
        <div class="stat-label">ロースター数</div>
      </div>
    </div>

    ${barChart('産地', originCounts, total)}
    ${barChart('ロースター', roasterCounts, total)}
    ${barChart('精製方法', processCounts, total)}
    ${barChart('淹れ方', brewCounts, total)}

    ${topTags.length > 0 ? `
      <div class="stats-section">
        <h3>よく使うフレーバー</h3>
        <div class="stats-tags">${topTags.map(([t, c]) =>
          `<span class="card-flavor-chip">${escHtml(t)} <small>${c}</small></span>`
        ).join('')}</div>
      </div>
    ` : ''}

    <div class="stats-section">
      <h3>平均フレーバープロファイル</h3>
      <div class="stats-flavor-bars">
        ${flavorBar('苦味', avgFlavor.bitterness)}
        ${flavorBar('酸味', avgFlavor.acidity)}
        ${flavorBar('甘味', avgFlavor.sweetness)}
        ${flavorBar('コク', avgFlavor.body)}
      </div>
    </div>

    ${monthlyChart(monthly)}
  `;
}

function countBy(notes, field) {
  const counts = {};
  notes.forEach(n => {
    const val = n[field];
    if (val) counts[val] = (counts[val] || 0) + 1;
  });
  return counts;
}

function avg(notes, field) {
  const vals = notes.map(n => n[field]).filter(v => v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

function barChart(title, counts, total) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (entries.length === 0) return '';
  const max = entries[0][1];
  return `
    <div class="stats-section">
      <h3>${escHtml(title)}</h3>
      <div class="stats-bars">
        ${entries.map(([name, count]) => `
          <div class="stats-bar-row">
            <span class="stats-bar-label">${escHtml(name)}</span>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width:${(count / max) * 100}%"></div>
            </div>
            <span class="stats-bar-count">${count}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function flavorBar(label, value) {
  return `
    <div class="stats-bar-row">
      <span class="stats-bar-label">${label}</span>
      <div class="stats-bar-track">
        <div class="stats-bar-fill" style="width:${(value / 5) * 100}%"></div>
      </div>
      <span class="stats-bar-count">${value.toFixed(1)}</span>
    </div>
  `;
}

function monthlyChart(monthly) {
  const months = Object.keys(monthly).sort();
  if (months.length < 2) return '';
  const maxCount = Math.max(...months.map(m => monthly[m].count));

  return `
    <div class="stats-section">
      <h3>月別記録数</h3>
      <div class="monthly-chart">
        ${months.slice(-12).map(m => {
          const pct = (monthly[m].count / maxCount) * 100;
          const label = m.slice(5); // MM
          return `
            <div class="monthly-bar-col">
              <div class="monthly-bar-wrap">
                <div class="monthly-bar" style="height:${pct}%"></div>
              </div>
              <span class="monthly-label">${label}月</span>
              <span class="monthly-count">${monthly[m].count}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
