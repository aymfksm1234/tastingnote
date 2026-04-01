# Tasting Notes

コーヒーのテイスティングノートを記録・管理するWebアプリ。GitHub Pagesで動作し、サーバー不要。

## 機能

- **テイスティング記録** - 豆の名前、産地、農園、精製方法、ロースター、焙煎度、淹れ方、味の評価（苦味/酸味/甘味/コク）、フレーバータグ、お気に入り度、メモ、写真
- **レーダーチャート** - 味の評価をリアルタイムにチャート表示
- **AI自動入力** - コーヒー豆のパッケージ写真をGemini Visionが分析し、フォームを自動入力
- **似たコーヒー提案** - 記録したコーヒーの特徴からAIがおすすめを提案
- **統計ダッシュボード** - 産地・ロースター分布、平均フレーバー、月別推移
- **マップビュー** - 産地を世界地図上にプロット
- **シェア** - カードをSNS用画像としてダウンロード/共有
- **Google Sheets連携** - Googleログインでスプレッドシートにデータ保存、写真はGoogle Driveへ
- **PWA対応** - ホーム画面に追加してアプリとして使用可能

## セットアップ

### ローカルで動かす

```bash
npx serve .
```

ブラウザで `http://localhost:3000` を開く。

### AI自動入力を使う

1. [Google AI Studio](https://aistudio.google.com/apikey) でGemini APIキーを取得
2. アプリの「AIで自動入力」ボタンを押してキーを入力
3. 写真を追加してからもう一度「AIで自動入力」を押す

APIキーの変更は「AIで自動入力」ボタンを長押し。

### Google Sheets連携を使う

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Sheets API と Google Drive API を有効化
3. OAuthクライアントID（Webアプリケーション）を作成
4. `src/google-auth.js` のCLIENT_IDを自分のものに変更
5. アプリの「ログイン」ボタンからGoogleアカウントで認証

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Vanilla JavaScript (ES Modules) |
| スタイル | CSS (カスタムプロパティ) |
| ストレージ | localStorage / Google Sheets + Drive |
| AI | Gemini 2.0 Flash (Vision) |
| ホスティング | GitHub Pages |
| テスト | Vitest |

## ライセンス

MIT
