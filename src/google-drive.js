// ── Google Drive API Module (Photo storage) ──────────────────
import { getAccessToken } from './google-auth.js';

const FOLDER_NAME = 'TastingNotes Photos';
const FOLDER_KEY = 'tastingnote:photoFolderId';

let folderId = localStorage.getItem(FOLDER_KEY) || null;

// ── Ensure photo folder exists ───────────────────────────────
async function ensureFolder() {
  if (folderId) {
    // Verify it still exists
    try {
      const res = await driveApi(`files/${folderId}?fields=id,trashed`);
      if (!res.trashed) return folderId;
    } catch { /* folder gone, recreate */ }
    folderId = null;
    localStorage.removeItem(FOLDER_KEY);
  }

  // Search for existing folder
  const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const search = await driveApi(`files?q=${encodeURIComponent(query)}&fields=files(id)`);
  if (search.files?.length > 0) {
    folderId = search.files[0].id;
    localStorage.setItem(FOLDER_KEY, folderId);
    return folderId;
  }

  // Create folder
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!res.ok) throw new Error('Failed to create photo folder');
  const data = await res.json();
  folderId = data.id;
  localStorage.setItem(FOLDER_KEY, folderId);
  return folderId;
}

// ── API helper ───────────────────────────────────────────────
async function driveApi(path) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { 'Authorization': `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Drive API error: ${res.status}`);
  }
  return res.json();
}

// ── Upload a photo (base64 → Drive) ─────────────────────────
export async function uploadPhoto(base64DataUrl, fileName) {
  await ensureFolder();

  // Convert base64 data URL to Blob
  const blob = dataUrlToBlob(base64DataUrl);

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  // Multipart upload
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getAccessToken()}` },
    body: form,
  });

  if (!res.ok) throw new Error('Failed to upload photo');
  const data = await res.json();
  return data.id; // file ID to store in spreadsheet
}

// ── Upload multiple photos, return array of file IDs ─────────
export async function uploadPhotos(base64Array, noteId) {
  const ids = [];
  for (let i = 0; i < base64Array.length; i++) {
    const fileName = `${noteId}_${i}.jpg`;
    const id = await uploadPhoto(base64Array[i], fileName);
    ids.push(id);
  }
  return ids;
}

// ── Get a photo's thumbnail/content URL ──────────────────────
export function getPhotoUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

// ── Get photo as base64 (for display when thumbnail URL fails)
export async function getPhotoBase64(fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ── Delete a photo from Drive ────────────────────────────────
export async function deletePhoto(fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${getAccessToken()}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error('Failed to delete photo');
  }
}

// ── Delete multiple photos ───────────────────────────────────
export async function deletePhotos(fileIds) {
  await Promise.all(fileIds.map(id => deletePhoto(id)));
}

// ── Utility: data URL → Blob ─────────────────────────────────
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}
