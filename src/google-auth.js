// ── Google Identity Services (GIS) Auth Module ──────────────
const CLIENT_ID = '544893537038-58dmj4a3namcnribicf0okjqtlpga8ut.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
const SESSION_TOKEN_KEY = 'tastingnote:session_token';

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

// Called when a token turns out to be expired (e.g. API returns 401)
export function clearSavedToken() {
  accessToken = null;
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  onAuthChange?.(false);
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
        sessionStorage.setItem(SESSION_TOKEN_KEY, accessToken);
        onAuthChange?.(true);
      }
    },
    error_callback: (err) => {
      console.error('Auth error:', err);
    },
  });

  // Restore token saved in the same browser session (survives page refresh)
  const saved = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (saved) {
    accessToken = saved;
    // Notify after resolve so callers can set up their callbacks first
    Promise.resolve().then(() => onAuthChange?.(true));
  }

  resolve();
}

export function signIn() {
  if (!tokenClient) return;
  // Use empty prompt so consent screen is skipped when already granted
  tokenClient.requestAccessToken({ prompt: '' });
}

export function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  onAuthChange?.(false);
}
