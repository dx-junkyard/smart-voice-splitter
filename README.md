# Smart Voice Splitter

録音ファイルをアップロードして内容ごとに自動分割・メモ管理を行うWebアプリケーションのプロトタイプです。
AIを活用して音声の文字起こしを行い、文脈に基づいて自動的にチャンク分割とタイトル生成を行います。

## システム構成

### アーキテクチャ概要
このプロジェクトは、FastAPIバックエンドとReactフロントエンドで構成されています。

### 技術スタック
- **Frontend**: React (Vite), TypeScript, Tailwind CSS
- **Backend**: FastAPI (Python)
- **AI/ML**:
    - **STT (Speech-to-Text)**: OpenAI Whisper API
    - **Logic**: OpenAI GPT-4o mini (セマンティック分割とタイトル生成)
- **Database**: SQLite (SQLAlchemy ORM)
- **Infrastructure**: Docker & Docker Compose

### データモデル
- **Recordings**: アップロードされた音声ファイルのメタデータ。
- **Chunks**: 音声から生成された分割単位。タイトル、書き起こしテキスト、開始/終了時間、ユーザーメモを含みます。

## ディレクトリ構成

```
.
├── backend/            # FastAPI バックエンド
│   ├── services/       # 音声処理ロジック (Whisper, GPT-4o)
│   ├── main.py         # API エンドポイント
│   ├── models.py       # データベースモデル
│   ├── schemas.py      # Pydantic スキーマ
│   └── database.py     # データベース接続設定
├── frontend/           # React フロントエンド
│   ├── src/            # ソースコード
│   │   ├── components/ # UIコンポーネント
│   │   └── api.ts      # APIクライアント
│   └── index.html      # エントリーポイント
├── uploads/            # アップロードされた音声ファイル (自動生成)
├── docker-compose.yml  # コンテナ起動設定
└── README.md           # プロジェクトドキュメント
```

## 使い方

### 必要条件
- Docker & Docker Compose
- OpenAI API Key

### 起動手順

1. 環境変数の設定
   `docker-compose.yml` 内の `OPENAI_API_KEY` を自身のAPIキーに置き換えるか、環境変数としてエクスポートしてください。

   ```bash
   export OPENAI_API_KEY=sk-...
   ```

2. Docker コンテナのビルドと起動
   ```bash
   docker-compose up --build
   ```

3. アプリケーションへのアクセス
   - **Web UI (Frontend)**: `http://localhost:5173`
   - **API Docs (Backend)**: `http://localhost:8000/docs`

### 機能

- **ダッシュボード**: アップロード済みの録音（Profile）一覧を表示します。
- **新規アップロード**: 音声ファイルをアップロードし、タイトルと録音日時を指定して解析を開始します。
- **詳細ビュー (プレイヤー)**:
    - AIが生成したチャプターごとのナビゲーション
    - 音声プレイヤーと同期した文字起こし表示
    - チャプターごとのメモ機能（自動保存）

## 開発ノート

- 現在はプロトタイプ段階であり、データベースは SQLite を使用しています。
- 音声処理は同期的処理として実装されているため、長い音声ファイルのアップロード時はレスポンスに時間がかかる場合があります（将来的に非同期タスクキューへの移行を検討）。
