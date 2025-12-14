# Smart Voice Splitter

録音ファイルをアップロードして内容ごとに自動分割・メモ管理を行うWebアプリケーションのプロトタイプです。
AIを活用して音声の文字起こしを行い、文脈に基づいて自動的にチャンク分割とタイトル生成を行います。

## システム構成

### アーキテクチャ概要
このプロジェクトは、FastAPIバックエンドとReactフロントエンド（予定）で構成されています。現在はバックエンドのコアロジックが実装されています。

### 技術スタック
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
├── uploads/            # アップロードされた音声ファイル (自動生成)
├── docker-compose.yml  # コンテナ起動設定
└── README.md           # プロジェクトドキュメント
```

## 使い方 (Backend)

### 必要条件
- Docker & Docker Compose
- OpenAI API Key

### 起動手順

1. 環境変数の設定
   `backend/.env.example` を参考に、環境変数を設定してください（`docker-compose.yml` 内で指定するか、`.env` ファイルを作成して読み込ませるなど）。
   最低限 `OPENAI_API_KEY` が必要です。

2. Docker コンテナのビルドと起動
   ```bash
   docker-compose up --build
   ```

3. API ドキュメントへのアクセス
   ブラウザで `http://localhost:8000/docs` にアクセスすると、Swagger UI が表示されます。

### 主な API エンドポイント

- `POST /upload`: 音声ファイルをアップロードし、処理を開始します。
    - **Input**: 音声ファイル (multipart/form-data)
    - **Output**: 作成された Recording オブジェクトと分割された Chunks
- `GET /recordings`: 保存された録音データのリストを取得します。

## 開発ノート

- 現在はプロトタイプ段階であり、データベースは SQLite を使用しています。
- 音声処理は同期的処理として実装されているため、長い音声ファイルのアップロード時はレスポンスに時間がかかる場合があります（将来的に非同期タスクキューへの移行を検討）。
