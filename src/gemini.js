// ── Gemini Vision API Module ─────────────────────────────────
const API_KEY_STORAGE = 'tastingnote:geminiApiKey';
const MODEL = 'gemini-2.0-flash';

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

export function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

export function hasApiKey() {
  return !!getApiKey();
}

const PROMPT = `この写真はコーヒー豆のパッケージまたはコーヒーに関する画像です。
写真から読み取れる情報をJSON形式で返してください。

読み取れない項目はnullにしてください。推測はしないでください。
日本語で回答してください。

JSONのフォーマット:
{
  "beanName": "豆の名前（品種名やブレンド名）",
  "origin": "産地（国名や地域名）",
  "producer": "農園名・精製所名",
  "process": "精製方法（ウォッシュド、ナチュラル等）",
  "roaster": "ロースター名・焙煎所名",
  "roastLevel": "焙煎度（1=浅煎り, 2=中浅煎り, 3=中煎り, 4=中深煎り, 5=深煎り）の数値、またはnull",
  "tags": ["読み取れるフレーバーノート（テイスティングノートの記載があれば）"]
}

JSONのみを返してください。説明文は不要です。`;

export async function analyzePhoto(base64DataUrl) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('APIキーが設定されていません');

  // Extract base64 data and mime type
  const [header, base64] = base64DataUrl.split(',');
  const mimeType = header.match(/:(.*?);/)[1];

  const body = {
    contents: [{
      parts: [
        { text: PROMPT },
        {
          inlineData: {
            mimeType,
            data: base64,
          },
        },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Extract JSON from response (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AIからの応答を解析できませんでした');

  return JSON.parse(jsonMatch[0]);
}
