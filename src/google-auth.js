// ── Google Identity Services (GIS) Auth Module ──────────────
const CLIENT_ID = '544893537038-58dmj4a3namcnribicf0okjqtlpga8ut.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

let tokenClient = null;
let accessToken = null;
let onAuthChange = null; // callback: (isLoggedIn) => void

export function getAccessToken() {
  return accessToken;
}

export function isLoggedIn() {
  return !!accessToken;
}

export function setAuthChangeCallback(cb) {
  onAuthChange = cb;
}

export function initAuth() {
  return new Promise((resolve) => {
    // Wait for GIS library to load
    if (!window.google?.accounts?.oauth2) {
      window.addEventListener('load', () => initGIS(resolve));
    } else {
      initGIS(resolve);
    }
  });
}

function initGIS(resolve) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.access_token) {
        accessToken = response.access_token;
        onAuthChange?.(true);
      }
    },
    error_callback: (err) => {
      console.error('Auth error:', err);
    },
  });
  resolve();
}

export function signIn() {
  if (!tokenClient) return;
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

export function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken);
    accessToken = null;
    onAuthChange?.(false);
  }
}
