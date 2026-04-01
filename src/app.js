import { uuid, clamp, todayStr, escHtml, diamond, filterNotes, sortNotes, ROAST_LABELS } from './utils.js';
import { initAuth, signIn, signOut, isLoggedIn, setAuthChangeCallback, getAccessToken } from './google-auth.js';
import { fetchAllNotes, appendNote, updateNote as sheetUpdateNote, deleteNote as sheetDeleteNote, bulkImportNotes } from './google-sheets.js';
import { uploadPhotos, getPhotoBase64, deletePhotos } from './google-drive.js';
import { analyzePhoto, hasApiKey, getApiKey, setApiKey } from './gemini.js';
import { renderStats } from './stats.js';
import { renderMap } from './map.js';

// ── Constants ────────────────────────────────────────────────
const STORAGE_KEY = 'tastingnote:notes';
const TAGS_KEY    = 'tastingnote:tags';
const MAX_PHOTO_PX = 800;
const PRESET_TAGS  = [
  'フルーティー', 'ベリー系', 'シトラス', 'フローラル',
  'チョコレート', 'キャラメル', 'ナッティ', 'バニラ',
  'スパイシー', 'ハーブ', 'アーシー', 'ウッディ',
];

// ── State ────────────────────────────────────────────────────
let notes = [];
let masterTags   = [...PRESET_TAGS];
let selectedTags = [];
let currentRating = 0;
let currentPhotos = []; // array of base64 strings
let pendingDeleteId = null;
let editingId = null;
let isSyncing = false;

// ── Storage (localStorage fallback) ──────────────────────────
function loadNotesLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveNotesLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (e) {
    showToast('保存に失敗しました（容量不足の可能性があります）');
  }
}

// ── Load / Save (routes to Google or localStorage) ───────────
async function loadNotes() {
  if (isLoggedIn()) {
    try {
      setSyncStatus(true);
      const cloudNotes = await fetchAllNotes();
      // Convert photoIds to photos (load from Drive)
      for (const note of cloudNotes) {
        if (note.photoIds?.length > 0 && !note.photos) {
          note.photos = [];
          for (const fid of note.photoIds) {
            const base64 = await getPhotoBase64(fid);
            if (base64) note.photos.push(base64);
          }
        }
      }
      notes = cloudNotes;
      setSyncStatus(false);
    } catch (e) {
      console.error('Failed to load from Sheets:', e);
      showToast('クラウドからの読み込みに失敗しました');
      notes = loadNotesLocal();
      setSyncStatus(false);
    }
  } else {
    notes = loadNotesLocal();
  }
}

async function saveNote(noteData, isEdit) {
  if (isLoggedIn()) {
    try {
      setSyncStatus(true);
      // Upload photos to Drive
      let photoIds = noteData.photoIds || [];
      if (noteData.photos?.length > 0) {
        // Find new photos (base64 that need uploading)
        const newPhotos = noteData.photos.filter(p => p.startsWith('data:'));
        if (newPhotos.length > 0) {
          const newIds = await uploadPhotos(newPhotos, noteData.id);
          photoIds = [...photoIds, ...newIds];
        }
      }
      const sheetNote = { ...noteData, photoIds };
      delete sheetNote.photos; // Don't store base64 in sheet

      if (isEdit) {
        await sheetUpdateNote(sheetNote);
      } else {
        await appendNote(sheetNote);
      }
      setSyncStatus(false);
    } catch (e) {
      console.error('Failed to save to Sheets:', e);
      showToast('クラウドへの保存に失敗しました');
      setSyncStatus(false);
    }
  } else {
    saveNotesLocal();
  }
}

async function removeNote(id) {
  // Find note to get photoIds for cleanup
  const note = notes.find(n => n.id === id);
  notes = notes.filter(n => n.id !== id);

  if (isLoggedIn()) {
    try {
      setSyncStatus(true);
      if (note?.photoIds?.length > 0) {
        await deletePhotos(note.photoIds);
      }
      await sheetDeleteNote(id);
      setSyncStatus(false);
    } catch (e) {
      console.error('Failed to delete from Sheets:', e);
      showToast('クラウドからの削除に失敗しました');
      setSyncStatus(false);
    }
  } else {
    saveNotesLocal();
  }
}

// ── Sync status indicator ────────────────────────────────────
function setSyncStatus(syncing) {
  isSyncing = syncing;
  const btn = document.getElementById('auth-btn');
  if (syncing) {
    btn.classList.add('syncing');
  } else {
    btn.classList.remove('syncing');
  }
}

// ── Tag storage ───────────────────────────────────────────────
function loadMasterTags() {
  try {
    const saved = JSON.parse(localStorage.getItem(TAGS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length > 0) masterTags = saved;
  } catch { /* use preset */ }
}

function saveMasterTags() {
  localStorage.setItem(TAGS_KEY, JSON.stringify(masterTags));
}

function addToMaster(tag) {
  if (!masterTags.includes(tag)) {
    masterTags.push(tag);
    saveMasterTags();
  }
}

// ── Auth UI ──────────────────────────────────────────────────
function updateAuthUI() {
  const btn = document.getElementById('auth-btn');
  const label = document.getElementById('auth-label');
  if (isLoggedIn()) {
    label.textContent = 'ログアウト';
    btn.classList.add('logged-in');
  } else {
    label.textContent = 'ログイン';
    btn.classList.remove('logged-in');
  }
}

async function onAuthChanged(loggedIn) {
  updateAuthUI();
  if (loggedIn) {
    // Check if there's local data to migrate
    const localNotes = loadNotesLocal();
    if (localNotes.length > 0) {
      document.getElementById('migrate-dialog').showModal();
    } else {
      await loadNotes();
      renderList();
      updateCount();
    }
  } else {
    // Switch back to localStorage
    notes = loadNotesLocal();
    renderList();
    updateCount();
  }
}

// ── Migration ────────────────────────────────────────────────
async function migrateToCloud() {
  const localNotes = loadNotesLocal();
  if (localNotes.length === 0) return;

  try {
    setSyncStatus(true);
    showToast('移行中...');

    // Upload photos and convert to photoIds
    const migratedNotes = [];
    for (const note of localNotes) {
      const photos = note.photos || (note.photo ? [note.photo] : []);
      let photoIds = [];
      if (photos.length > 0) {
        photoIds = await uploadPhotos(photos, note.id);
      }
      const { photo, photos: _, ...rest } = note;
      migratedNotes.push({ ...rest, photoIds });
    }

    await bulkImportNotes(migratedNotes);

    // Clear localStorage notes after successful migration
    localStorage.removeItem(STORAGE_KEY);

    showToast(`${localNotes.length}件の記録を移行しました`);
    await loadNotes();
    renderList();
    updateCount();
    setSyncStatus(false);
  } catch (e) {
    console.error('Migration failed:', e);
    showToast('移行に失敗しました');
    setSyncStatus(false);
  }
}

// ── Tag UI ────────────────────────────────────────────────────
function renderSelectedTags() {
  const container = document.getElementById('selected-tags');
  container.innerHTML = '';
  selectedTags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'flavor-chip';
    chip.innerHTML = `${escHtml(tag)}<button type="button" aria-label="${escHtml(tag)}を削除">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      selectedTags = selectedTags.filter(t => t !== tag);
      renderSelectedTags();
    });
    container.appendChild(chip);
  });
}

function selectTag(tag) {
  selectedTags.push(tag);
  addToMaster(tag);
  renderSelectedTags();
  closePicker();
}

function openPicker() {
  const picker = document.getElementById('tag-picker');
  picker.hidden = false;
  const input = document.getElementById('tag-input');
  input.value = '';
  renderSuggestions('');
  input.focus();
}

function closePicker() {
  document.getElementById('tag-picker').hidden = true;
  document.getElementById('tag-input').value = '';
}

function renderSuggestions(query) {
  const box = document.getElementById('tag-suggestions');
  box.innerHTML = '';
  const q = query.trim().toLowerCase();

  const candidates = masterTags.filter(t =>
    q === '' || t.toLowerCase().includes(q)
  );

  candidates.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'tag-suggestion-item';
    item.textContent = tag;
    item.addEventListener('mousedown', e => { e.preventDefault(); selectTag(tag); });
    box.appendChild(item);
  });

  const exactExists = masterTags.some(t => t.toLowerCase() === q);
  if (q && !exactExists) {
    const item = document.createElement('div');
    item.className = 'tag-suggestion-item create';
    item.textContent = `「${query.trim()}」を追加`;
    item.addEventListener('mousedown', e => { e.preventDefault(); selectTag(query.trim()); });
    box.appendChild(item);
  }

  if (box.children.length === 0) {
    const item = document.createElement('div');
    item.className = 'tag-suggestion-item no-result';
    item.textContent = '候補がありません';
    box.appendChild(item);
  }
}

// ── Radar Chart (SVG) ─────────────────────────────────────────
function buildRadar(svgEl, { bitterness, acidity, sweetness, body }, size = 220) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const ns = 'http://www.w3.org/2000/svg';

  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svgEl.setAttribute('width', size);
  svgEl.setAttribute('height', size);
  svgEl.innerHTML = '';

  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', diamond(cx, cy, r * t));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#d4c5a9');
    poly.setAttribute('stroke-width', '1');
    svgEl.appendChild(poly);
  }

  [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]].forEach(([x, y]) => {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', x);  line.setAttribute('y2', y);
    line.setAttribute('stroke', '#d4c5a9');
    line.setAttribute('stroke-width', '1');
    svgEl.appendChild(line);
  });

  const b  = clamp(bitterness, 1, 5) / 5;
  const a  = clamp(acidity,    1, 5) / 5;
  const s  = clamp(sweetness,  1, 5) / 5;
  const bo = clamp(body,       1, 5) / 5;

  const dataPoly = document.createElementNS(ns, 'polygon');
  dataPoly.setAttribute('points', [
    `${cx},${cy - r * b}`,
    `${cx + r * a},${cy}`,
    `${cx},${cy + r * s}`,
    `${cx - r * bo},${cy}`,
  ].join(' '));
  dataPoly.setAttribute('fill', 'rgba(200,151,58,0.28)');
  dataPoly.setAttribute('stroke', '#c8973a');
  dataPoly.setAttribute('stroke-width', '2');
  dataPoly.setAttribute('stroke-linejoin', 'round');
  svgEl.appendChild(dataPoly);

  const pad = size * 0.088;
  [
    { text: '苦味', x: cx,       y: cy - r - pad * 0.6, anchor: 'middle' },
    { text: '酸味', x: cx + r + pad * 0.55, y: cy + 5,  anchor: 'start'  },
    { text: '甘味', x: cx,       y: cy + r + pad,        anchor: 'middle' },
    { text: 'コク', x: cx - r - pad * 0.55, y: cy + 5,  anchor: 'end'    },
  ].forEach(({ text, x, y, anchor }) => {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('text-anchor', anchor);
    t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-size', size * 0.062);
    t.setAttribute('fill', '#5c3d1e');
    t.setAttribute('font-family', '-apple-system, sans-serif');
    t.textContent = text;
    svgEl.appendChild(t);
  });
}

// ── Photo helpers ─────────────────────────────────────────────
function compressImage(file, maxPx, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoThumbnails() {
  const container = document.getElementById('photo-thumbnails');
  container.innerHTML = '';
  currentPhotos.forEach((src, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `photo ${idx + 1}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-photo';
    btn.innerHTML = '×';
    btn.setAttribute('aria-label', '写真を削除');
    btn.addEventListener('click', () => {
      currentPhotos.splice(idx, 1);
      renderPhotoThumbnails();
    });
    wrap.append(img, btn);
    container.appendChild(wrap);
  });
}

// ── AI auto-fill ─────────────────────────────────────────────
async function handleAiAnalyze() {
  if (!hasApiKey()) {
    // Show API key dialog
    const dialog = document.getElementById('apikey-dialog');
    document.getElementById('apikey-input').value = getApiKey();
    dialog.showModal();
    return;
  }

  if (currentPhotos.length === 0) {
    showToast('先に写真を追加してください');
    return;
  }

  const btn = document.getElementById('ai-analyze-btn');
  const label = document.getElementById('ai-btn-label');
  btn.disabled = true;
  label.textContent = '分析中...';
  btn.classList.add('analyzing');

  try {
    // Use the first photo for analysis
    const result = await analyzePhoto(currentPhotos[0]);

    // Fill form fields with AI results
    if (result.beanName) document.getElementById('bean-name').value = result.beanName;
    if (result.origin) document.getElementById('origin').value = result.origin;
    if (result.producer) document.getElementById('producer').value = result.producer;
    if (result.process) document.getElementById('process').value = result.process;
    if (result.roaster) document.getElementById('roaster').value = result.roaster;
    if (result.roastLevel) {
      const rl = Number(result.roastLevel);
      if (rl >= 1 && rl <= 5) {
        document.getElementById('roast-level').value = rl;
        document.getElementById('roast-label').textContent = ROAST_LABELS[rl];
      }
    }
    if (result.tags?.length > 0) {
      result.tags.forEach(tag => {
        if (!selectedTags.includes(tag)) {
          selectedTags.push(tag);
          addToMaster(tag);
        }
      });
      renderSelectedTags();
    }

    showToast('AIで自動入力しました');
  } catch (e) {
    console.error('AI analysis failed:', e);
    showToast(e.message || 'AI分析に失敗しました');
  } finally {
    btn.disabled = false;
    label.textContent = 'AIで自動入力';
    btn.classList.remove('analyzing');
  }
}

// ── Star rating ───────────────────────────────────────────────
function renderStars(container, value) {
  container.querySelectorAll('.star').forEach(btn => {
    btn.textContent = Number(btn.dataset.value) <= value ? '★' : '☆';
    btn.classList.toggle('active', Number(btn.dataset.value) <= value);
  });
}

// ── Form flavors & radar ──────────────────────────────────────
function getFlavorValues() {
  return {
    bitterness: Number(document.getElementById('sl-bitterness').value),
    acidity:    Number(document.getElementById('sl-acidity').value),
    sweetness:  Number(document.getElementById('sl-sweetness').value),
    body:       Number(document.getElementById('sl-body').value),
  };
}

function refreshFormRadar() {
  buildRadar(document.getElementById('form-radar'), getFlavorValues(), 220);
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Render note list ──────────────────────────────────────────
function renderList() {
  const query    = document.getElementById('search-input').value.toLowerCase();
  const sort     = document.getElementById('sort-select').value;
  const dateFrom = document.getElementById('date-from').value;
  const dateTo   = document.getElementById('date-to').value;
  const listEl   = document.getElementById('notes-list');
  const emptyMsg = document.getElementById('empty-msg');

  let filtered = sortNotes(filterNotes(notes, { query, dateFrom, dateTo }), sort);

  listEl.innerHTML = '';
  emptyMsg.hidden = filtered.length > 0;

  filtered.forEach(note => {
    listEl.appendChild(buildCard(note));
  });

  updateCount();
}

function buildCard(note) {
  const card = document.createElement('article');
  card.className = 'note-card';
  card.dataset.id = note.id;

  const dateStr = note.drinkDate
    ? note.drinkDate.replace(/-/g, '/')
    : new Date(note.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '/');

  const stars = note.rating
    ? '★'.repeat(note.rating) + '☆'.repeat(5 - note.rating)
    : '';

  function tag(iconSvg, text) {
    return `<span class="tag">${iconSvg}${escHtml(text)}</span>`;
  }
  const pinIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const fireIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
  const cupIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg>`;
  const dropletIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
  const homeIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

  const shopIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 7v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-3-5z"/><line x1="3" y1="7" x2="21" y2="7"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;

  const tags = [
    note.roaster    ? tag(shopIcon,    note.roaster)                   : '',
    note.origin     ? tag(pinIcon,     note.origin)                    : '',
    note.producer   ? tag(homeIcon,    note.producer)                  : '',
    note.process    ? tag(dropletIcon, note.process)                   : '',
    note.roastLevel ? tag(fireIcon,    ROAST_LABELS[note.roastLevel])  : '',
    note.brewMethod ? tag(cupIcon,     note.brewMethod)                : '',
  ].filter(Boolean).join('');

  // Support: base64 photos (local), or loaded from Drive
  const photos = note.photos || (note.photo ? [note.photo] : []);
  const photoHtml = photos.length === 0 ? '' :
    `<div class="card-photos${photos.length === 1 ? ' single' : ''}">${
      photos.map((src, i) => `<img src="${src}" alt="photo ${i+1}">`).join('')
    }</div>`;

  card.innerHTML = `
    ${photoHtml}
    <div class="card-header">
      <span class="card-bean-name">${escHtml(note.beanName)}</span>
      <div style="display:flex;gap:4px">
        <button class="edit-btn" aria-label="編集">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="delete-btn" aria-label="削除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6m4-6v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="card-date">${dateStr} ${note.photoIds ? '<span class="storage-icon cloud" title="クラウド保存"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></span>' : '<span class="storage-icon local" title="ローカル保存"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>'}</div>
    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
    <div class="card-radar">
      <svg viewBox="0 0 160 160" width="160" height="160"></svg>
    </div>
    ${stars ? `<div class="card-stars">${stars}</div>` : ''}
    ${(note.tags || []).length ? `<div class="card-flavor-tags">${(note.tags).map(t => `<span class="card-flavor-chip">${escHtml(t)}</span>`).join('')}</div>` : ''}
    ${note.memo ? `<p class="card-memo">${escHtml(note.memo)}</p>` : ''}
    <div class="card-actions">
      <button class="share-btn" aria-label="シェア">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        シェア
      </button>
      <button class="recommend-btn" aria-label="おすすめ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M12 2a4 4 0 0 1 4 4c0 1.95-2 3-2 8h-4c0-5-2-6.05-2-8a4 4 0 0 1 4-4z"/>
          <line x1="10" y1="17" x2="14" y2="17"/>
          <line x1="10" y1="20" x2="14" y2="20"/>
        </svg>
        似たコーヒー
      </button>
    </div>
  `;

  buildRadar(card.querySelector('.card-radar svg'), note, 160);

  // Share button - generate image
  card.querySelector('.share-btn').addEventListener('click', () => shareCard(card, note));

  // Recommend button
  card.querySelector('.recommend-btn').addEventListener('click', () => recommendSimilar(note));

  card.querySelector('.edit-btn').addEventListener('click', () => {
    loadNoteIntoForm(note);
    switchTab('record');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  card.querySelector('.delete-btn').addEventListener('click', () => {
    pendingDeleteId = note.id;
    document.getElementById('confirm-dialog').showModal();
  });

  return card;
}

function updateCount() {
  const el = document.getElementById('list-count');
  el.textContent = notes.length > 0 ? notes.length : '';
}

// ── Share card as image ──────────────────────────────────────
async function shareCard(cardEl, note) {
  try {
    // Clone card, hide action buttons
    const clone = cardEl.cloneNode(true);
    clone.querySelectorAll('.card-actions, .edit-btn, .delete-btn').forEach(el => el.remove());
    clone.style.width = '360px';
    clone.style.padding = '20px';
    clone.style.position = 'fixed';
    clone.style.left = '-9999px';
    clone.style.background = '#ece7dd';
    clone.style.borderRadius = '14px';

    // Add branding
    const brand = document.createElement('div');
    brand.style.cssText = 'text-align:center;font-size:11px;color:#7a6048;margin-top:12px;padding-top:8px;border-top:1px solid #d4c5a9';
    brand.textContent = 'Tasting Notes';
    clone.appendChild(brand);

    document.body.appendChild(clone);

    // Use canvas to capture
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = clone.offsetWidth * scale;
    canvas.height = clone.offsetHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Draw background
    ctx.fillStyle = '#ece7dd';
    ctx.beginPath();
    ctx.roundRect(0, 0, clone.offsetWidth, clone.offsetHeight, 14);
    ctx.fill();

    // Convert to image via SVG foreignObject
    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${clone.offsetWidth}" height="${clone.offsetHeight}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml">${clone.outerHTML}</div>
        </foreignObject>
      </svg>`;

    document.body.removeChild(clone);

    const img = new Image();
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    ctx.drawImage(img, 0, 0, clone.offsetWidth, clone.offsetHeight);
    URL.revokeObjectURL(url);

    canvas.toBlob(async blob => {
      if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'note.png')] })) {
        await navigator.share({
          title: note.beanName,
          files: [new File([blob], `${note.beanName}.png`, { type: 'image/png' })],
        });
      } else {
        // Fallback: download
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${note.beanName}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('画像をダウンロードしました');
      }
    }, 'image/png');
  } catch (e) {
    console.error('Share failed:', e);
    showToast('シェアに失敗しました');
  }
}

// ── Similar coffee recommendation ────────────────────────────
async function recommendSimilar(note) {
  if (!hasApiKey()) {
    const dialog = document.getElementById('apikey-dialog');
    document.getElementById('apikey-input').value = getApiKey();
    dialog.showModal();
    return;
  }

  showToast('おすすめを考え中...');

  try {
    const prompt = `以下のコーヒーの情報をもとに、似たテイストや特徴を持つおすすめのコーヒー豆を3つ提案してください。

豆: ${note.beanName}
産地: ${note.origin || '不明'}
精製: ${note.process || '不明'}
焙煎: ${ROAST_LABELS[note.roastLevel] || '不明'}
フレーバー: ${(note.tags || []).join(', ') || '不明'}
苦味: ${note.bitterness}/5, 酸味: ${note.acidity}/5, 甘味: ${note.sweetness}/5, コク: ${note.body}/5

以下のJSON形式で回答してください:
[
  {"name": "豆の名前", "origin": "産地", "reason": "おすすめの理由（1文）"}
]
JSONのみを返してください。`;

    const apiKey = getApiKey();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
        }),
      }
    );

    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Parse error');

    const recommendations = JSON.parse(jsonMatch[0]);
    showRecommendDialog(note.beanName, recommendations);
  } catch (e) {
    console.error('Recommend failed:', e);
    showToast('おすすめの取得に失敗しました');
  }
}

function showRecommendDialog(beanName, recs) {
  let dialog = document.getElementById('recommend-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'recommend-dialog';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  }
  dialog.innerHTML = `
    <p><strong>${escHtml(beanName)}</strong> が好きなあなたに</p>
    <div class="recommend-list">
      ${recs.map(r => `
        <div class="recommend-item">
          <div class="recommend-name">${escHtml(r.name)}</div>
          <div class="recommend-origin">${escHtml(r.origin)}</div>
          <div class="recommend-reason">${escHtml(r.reason)}</div>
        </div>
      `).join('')}
    </div>
    <div class="dialog-actions">
      <button onclick="this.closest('dialog').close()" class="accent">閉じる</button>
    </div>
  `;
  dialog.showModal();
}

// ── Load note into form (edit mode) ──────────────────────────
function loadNoteIntoForm(note) {
  resetForm();
  editingId = note.id;

  document.getElementById('bean-name').value  = note.beanName  || '';
  document.getElementById('roaster').value    = note.roaster   || '';
  document.getElementById('origin').value     = note.origin    || '';
  document.getElementById('producer').value   = note.producer  || '';
  document.getElementById('brew-method').value = note.brewMethod || '';

  const rl = note.roastLevel || 3;
  document.getElementById('roast-level').value = rl;
  document.getElementById('roast-label').textContent = ROAST_LABELS[rl];

  ['bitterness', 'acidity', 'sweetness', 'body'].forEach(k => {
    const val = note[k] || 3;
    document.getElementById(`sl-${k}`).value = val;
    document.getElementById(`val-${k}`).textContent = `${parseFloat(val).toFixed(1)}/5`;
  });
  refreshFormRadar();

  currentRating = note.rating || 0;
  renderStars(document.getElementById('star-rating'), currentRating);

  selectedTags = [...(note.tags || [])];
  renderSelectedTags();

  currentPhotos = note.photos
    ? [...note.photos]
    : note.photo ? [note.photo] : [];
  renderPhotoThumbnails();

  document.getElementById('memo').value = note.memo || '';
  document.getElementById('process').value = note.process || '';
  document.getElementById('drink-date').value = note.drinkDate || todayStr();
  document.getElementById('submit-label').textContent = '更新する';
}

// ── Reset form ────────────────────────────────────────────────
function resetForm() {
  document.getElementById('record-form').reset();
  currentRating = 0;
  selectedTags  = [];
  editingId     = null;
  currentPhotos = [];
  document.getElementById('drink-date').value = todayStr();
  renderPhotoThumbnails();
  document.getElementById('roast-label').textContent = ROAST_LABELS[3];
  document.getElementById('submit-label').textContent = '記録する';
  document.getElementById('process').value = '';
  renderStars(document.getElementById('star-rating'), 0);
  refreshFormRadar();
  renderSelectedTags();
  closePicker();
  ['bitterness', 'acidity', 'sweetness', 'body'].forEach(k => {
    document.getElementById(`val-${k}`).textContent = '3.0/5';
  });
}

// ── Switch tabs ───────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `tab-${name}`);
  });
  if (name === 'list') renderList();
  if (name === 'stats') renderStats(notes, document.getElementById('stats-content'));
  if (name === 'map') renderMap(notes, document.getElementById('world-map'), document.getElementById('map-legend'));
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  loadMasterTags();
  refreshFormRadar();
  document.getElementById('drink-date').value = todayStr();

  // Init Google Auth
  setAuthChangeCallback(onAuthChanged);
  await initAuth();
  updateAuthUI();

  // Auth button
  document.getElementById('auth-btn').addEventListener('click', () => {
    if (isLoggedIn()) {
      signOut();
    } else {
      signIn();
    }
  });

  // Migration dialog
  document.getElementById('migrate-ok').addEventListener('click', async () => {
    document.getElementById('migrate-dialog').close();
    await migrateToCloud();
  });
  document.getElementById('migrate-skip').addEventListener('click', async () => {
    document.getElementById('migrate-dialog').close();
    await loadNotes();
    renderList();
    updateCount();
  });

  // Load notes (localStorage on first load, until user logs in)
  await loadNotes();
  updateCount();

  // Tag picker
  document.getElementById('tag-add-btn').addEventListener('click', () => {
    const picker = document.getElementById('tag-picker');
    picker.hidden ? openPicker() : closePicker();
  });
  document.getElementById('tag-input').addEventListener('input', e => {
    renderSuggestions(e.target.value);
  });
  document.getElementById('tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) selectTag(val);
    }
    if (e.key === 'Escape') closePicker();
  });
  document.addEventListener('click', e => {
    const picker  = document.getElementById('tag-picker');
    const addBtn  = document.getElementById('tag-add-btn');
    const selTags = document.getElementById('selected-tags');
    if (!picker.hidden &&
        !picker.contains(e.target) &&
        e.target !== addBtn &&
        !selTags.contains(e.target)) {
      closePicker();
    }
  });

  // Tab switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Photo upload
  const photoInput = document.getElementById('photo-input');
  document.getElementById('photo-add-btn').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async () => {
    const files = [...photoInput.files];
    if (!files.length) return;
    try {
      const compressed = await Promise.all(files.map(f => compressImage(f, MAX_PHOTO_PX)));
      currentPhotos.push(...compressed);
      renderPhotoThumbnails();
    } catch {
      showToast('写真の読み込みに失敗しました');
    }
    photoInput.value = '';
  });

  // AI analyze button
  // AI analyze: click to analyze, long-press to change API key
  const aiBtn = document.getElementById('ai-analyze-btn');
  let aiLongPress = null;
  aiBtn.addEventListener('mousedown', () => {
    aiLongPress = setTimeout(() => {
      aiLongPress = 'fired';
      const dialog = document.getElementById('apikey-dialog');
      document.getElementById('apikey-input').value = getApiKey();
      dialog.showModal();
    }, 700);
  });
  aiBtn.addEventListener('mouseup', () => {
    if (aiLongPress !== 'fired') {
      clearTimeout(aiLongPress);
      handleAiAnalyze();
    }
    aiLongPress = null;
  });
  aiBtn.addEventListener('mouseleave', () => {
    if (aiLongPress !== 'fired') clearTimeout(aiLongPress);
    aiLongPress = null;
  });
  // Touch support
  aiBtn.addEventListener('touchstart', (e) => {
    aiLongPress = setTimeout(() => {
      aiLongPress = 'fired';
      const dialog = document.getElementById('apikey-dialog');
      document.getElementById('apikey-input').value = getApiKey();
      dialog.showModal();
    }, 700);
  }, { passive: true });
  aiBtn.addEventListener('touchend', (e) => {
    if (aiLongPress !== 'fired') {
      clearTimeout(aiLongPress);
      handleAiAnalyze();
    }
    aiLongPress = null;
    e.preventDefault();
  });

  // API key dialog
  document.getElementById('apikey-save').addEventListener('click', () => {
    const key = document.getElementById('apikey-input').value.trim();
    if (key) {
      setApiKey(key);
      document.getElementById('apikey-dialog').close();
      showToast('APIキーを保存しました');
    }
  });
  document.getElementById('apikey-cancel').addEventListener('click', () => {
    document.getElementById('apikey-dialog').close();
  });

  // Roast level slider
  document.getElementById('roast-level').addEventListener('input', e => {
    document.getElementById('roast-label').textContent = ROAST_LABELS[e.target.value];
  });

  // Flavor sliders
  ['bitterness', 'acidity', 'sweetness', 'body'].forEach(key => {
    document.getElementById(`sl-${key}`).addEventListener('input', e => {
      document.getElementById(`val-${key}`).textContent = `${parseFloat(e.target.value).toFixed(1)}/5`;
      refreshFormRadar();
    });
  });

  // Star rating
  const starContainer = document.getElementById('star-rating');
  starContainer.querySelectorAll('.star').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = Number(btn.dataset.value);
      currentRating = currentRating === val ? 0 : val;
      renderStars(starContainer, currentRating);
    });
  });

  // Search, date range & sort
  document.getElementById('search-input').addEventListener('input', renderList);
  document.getElementById('date-from').addEventListener('change', renderList);
  document.getElementById('date-to').addEventListener('change', renderList);
  document.getElementById('sort-select').addEventListener('change', renderList);

  // Form submit
  document.getElementById('record-form').addEventListener('submit', async e => {
    e.preventDefault();
    const beanName = document.getElementById('bean-name').value.trim();
    if (!beanName) return;

    const fields = {
      beanName,
      roaster:    document.getElementById('roaster').value.trim(),
      origin:     document.getElementById('origin').value.trim(),
      photos:     [...currentPhotos],
      drinkDate:  document.getElementById('drink-date').value,
      producer:   document.getElementById('producer').value.trim(),
      process:    document.getElementById('process').value.trim(),
      roastLevel: Number(document.getElementById('roast-level').value),
      brewMethod: document.getElementById('brew-method').value,
      bitterness: Number(document.getElementById('sl-bitterness').value),
      acidity:    Number(document.getElementById('sl-acidity').value),
      sweetness:  Number(document.getElementById('sl-sweetness').value),
      body:       Number(document.getElementById('sl-body').value),
      rating:     currentRating,
      tags:       [...selectedTags],
      memo:       document.getElementById('memo').value.trim(),
    };

    if (editingId) {
      const idx = notes.findIndex(n => n.id === editingId);
      if (idx !== -1) {
        notes[idx] = { ...notes[idx], ...fields };
        await saveNote(notes[idx], true);
      }
      showToast('更新しました');
    } else {
      const newNote = { id: uuid(), createdAt: Date.now(), ...fields };
      notes.unshift(newNote);
      await saveNote(newNote, false);
      showToast('記録しました');
    }

    if (!isLoggedIn()) saveNotesLocal();
    updateCount();
    resetForm();
    switchTab('list');
  });

  // Delete confirm
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    dialog.close();
    pendingDeleteId = null;
  });
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    if (pendingDeleteId) {
      await removeNote(pendingDeleteId);
      renderList();
      showToast('削除しました');
    }
    pendingDeleteId = null;
    dialog.close();
  });
  dialog.addEventListener('click', e => {
    if (e.target === dialog) { dialog.close(); pendingDeleteId = null; }
  });
}

document.addEventListener('DOMContentLoaded', init);
