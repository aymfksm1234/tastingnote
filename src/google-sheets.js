// ── Google Sheets API Module ─────────────────────────────────
import { getAccessToken, clearSavedToken } from './google-auth.js';

const SPREADSHEET_NAME = 'TastingNotes';
const SHEET_NAME = 'Notes';
const SETTINGS_KEY = 'tastingnote:spreadsheetId';

// Column order in the spreadsheet
const COLUMNS = [
  'id', 'createdAt', 'beanName', 'drinkDate', 'roaster', 'origin',
  'producer', 'process', 'roastLevel', 'brewMethod',
  'bitterness', 'acidity', 'sweetness', 'body',
  'rating', 'tags', 'memo', 'photoIds',
];

let spreadsheetId = localStorage.getItem(SETTINGS_KEY) || null;

export function getSpreadsheetId() {
  return spreadsheetId;
}

// ── API helpers ──────────────────────────────────────────────
async function sheetsApi(path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401) clearSavedToken();
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API error: ${res.status}`);
  }
  return res.json();
}

// ── Find or create spreadsheet ───────────────────────────────
export async function ensureSpreadsheet() {
  // Check saved ID first
  if (spreadsheetId) {
    try {
      await sheetsApi(spreadsheetId);
      return spreadsheetId;
    } catch {
      // Spreadsheet may have been deleted; search or create
      spreadsheetId = null;
      localStorage.removeItem(SETTINGS_KEY);
    }
  }

  // Search for existing spreadsheet by name
  const found = await searchSpreadsheet();
  if (found) {
    spreadsheetId = found;
    localStorage.setItem(SETTINGS_KEY, spreadsheetId);
    return spreadsheetId;
  }

  // Create new spreadsheet
  spreadsheetId = await createSpreadsheet();
  localStorage.setItem(SETTINGS_KEY, spreadsheetId);
  return spreadsheetId;
}

async function searchSpreadsheet() {
  const query = `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
    { headers: { 'Authorization': `Bearer ${getAccessToken()}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createSpreadsheet() {
  const body = {
    properties: { title: SPREADSHEET_NAME },
    sheets: [{
      properties: { title: SHEET_NAME },
    }],
  };
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to create spreadsheet');
  const data = await res.json();

  // Write header row
  await sheetsApi(`${data.spreadsheetId}/values/${SHEET_NAME}!A1?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({
      range: `${SHEET_NAME}!A1`,
      values: [COLUMNS],
    }),
  });

  return data.spreadsheetId;
}

// ── Read all notes ───────────────────────────────────────────
export async function fetchAllNotes() {
  await ensureSpreadsheet();
  const data = await sheetsApi(`${spreadsheetId}/values/${SHEET_NAME}!A:R`);
  const rows = data.values || [];
  if (rows.length <= 1) return []; // only header or empty

  const headers = rows[0];
  return rows.slice(1).map(row => {
    const note = {};
    headers.forEach((col, i) => {
      const val = row[i] || '';
      if (['createdAt', 'roastLevel', 'bitterness', 'acidity', 'sweetness', 'body', 'rating'].includes(col)) {
        note[col] = Number(val) || 0;
      } else if (col === 'tags') {
        note[col] = val ? JSON.parse(val) : [];
      } else if (col === 'photoIds') {
        note[col] = val ? JSON.parse(val) : [];
      } else {
        note[col] = val;
      }
    });
    return note;
  });
}

// ── Append a note ────────────────────────────────────────────
export async function appendNote(note) {
  await ensureSpreadsheet();
  const row = COLUMNS.map(col => {
    if (col === 'tags') return JSON.stringify(note.tags || []);
    if (col === 'photoIds') return JSON.stringify(note.photoIds || []);
    return note[col] ?? '';
  });

  await sheetsApi(`${spreadsheetId}/values/${SHEET_NAME}!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: [row] }),
  });
}

// ── Update a note (find row by id, overwrite) ────────────────
export async function updateNote(note) {
  await ensureSpreadsheet();
  const rowIndex = await findRowById(note.id);
  if (rowIndex === -1) {
    // Note not found in sheet, append instead
    await appendNote(note);
    return;
  }

  const row = COLUMNS.map(col => {
    if (col === 'tags') return JSON.stringify(note.tags || []);
    if (col === 'photoIds') return JSON.stringify(note.photoIds || []);
    return note[col] ?? '';
  });

  const range = `${SHEET_NAME}!A${rowIndex}:R${rowIndex}`;
  await sheetsApi(`${spreadsheetId}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ range, values: [row] }),
  });
}

// ── Delete a note ────────────────────────────────────────────
export async function deleteNote(id) {
  await ensureSpreadsheet();
  const rowIndex = await findRowById(id);
  if (rowIndex === -1) return;

  // Get sheet ID (gid)
  const meta = await sheetsApi(spreadsheetId);
  const sheetId = meta.sheets.find(s => s.properties.title === SHEET_NAME)?.properties?.sheetId ?? 0;

  await sheetsApi(`${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // 0-based
            endIndex: rowIndex,
          },
        },
      }],
    }),
  });
}

// ── Find row number (1-based) by note id ─────────────────────
async function findRowById(id) {
  const data = await sheetsApi(`${spreadsheetId}/values/${SHEET_NAME}!A:A`);
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return i + 1; // 1-based for Sheets
  }
  return -1;
}

// ── Bulk import (for migration from localStorage) ────────────
export async function bulkImportNotes(notesArray) {
  await ensureSpreadsheet();
  const rows = notesArray.map(note =>
    COLUMNS.map(col => {
      if (col === 'tags') return JSON.stringify(note.tags || []);
      if (col === 'photoIds') return JSON.stringify(note.photoIds || []);
      return note[col] ?? '';
    })
  );

  await sheetsApi(`${spreadsheetId}/values/${SHEET_NAME}!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values: rows }),
  });
}
