# hola

음성/텍스트 입력 → AI 응답 → 음성 출력 파이프라인 데모.

```
[User] --text or audio-->  Server  --STT (bulk)-->  Text
                              |
                              +--AI (stream)--+-- 음성 텍스트 --> sentence-split --> TTS queue
                                              |
                                              +-- {gesture=...} 커맨드 --> gesture 이벤트
                                                                    |
        <--SSE stream (ai_delta + tts_chunk + gesture)-------------+
[Browser] --Web Audio (PCM 24kHz int16 LE) 재생 + 아바타 제스처 재생-->
```

- **STT**: bulk (오디오 전체 업로드 후 1회 호출)
- **AI**: streaming, 문장 부호 단위로 분할하여 TTS 큐로 전달. 서버 전역 **대화 세션**으로 이전 턴 문맥을 유지 (아래 [AI 대화 세션](#ai-대화-세션))
- **TTS**: streaming, 문장 단위로 순차 재생 (기본 PCM 24kHz int16 LE)
- **제스처**: AI 응답에 섞인 `{gesture=NAME}` 커맨드를 서버가 파싱해 음성 텍스트와 분리, `gesture` 이벤트로 전송 → 브라우저가 아바타 제스처 재생 (아래 [제스처 커맨드](#제스처-커맨드))
- **RAG(문서 검색)**: 업로드한 텍스트 문서를 로컬 임베딩(pgvector)으로 저장하고, AI가 `search_documents` 도구로 검색해 답변 근거로 활용 (아래 [RAG](#rag-문서-검색))
- **카메라 비전**: 카메라를 켜면 대화 전송(텍스트·음성) 시 현재 프레임을 캡처해 이미지와 함께 전송, AI가 실시간 장면을 인식 (아래 [카메라 비전](#카메라-비전))

> ⚠️ TTS 포맷은 기본값 **PCM** 입니다. Google streaming TTS는 OGG_OPUS도 지원하지만 Chrome의 MSE byte stream에는 OGG 컨테이너가 없어 청크 append가 안 됩니다. PCM이면 `AudioBufferSourceNode`로 청크별 스케줄링이 깔끔하게 됩니다. 대역폭이 중요한 경우 `TTS_AUDIO_ENCODING=OGG_OPUS`로 바꾸고 클라이언트에 wasm Opus 디코더를 붙이면 됩니다.

## 디렉토리

```
.
├── server/         # TypeScript + Express, STT/AI/TTS/임베딩 provider 추상화 + RAG
├── web/            # Vite + React + three.js VRM 아바타 (립싱크/제스처), Web Audio 청크 재생
└── compose.yml     # server + web + db(pgvector) + embeddings(ollama) 한 번에 띄우기
```

compose는 4개 서비스를 올립니다: `server`, `web`, `db`(pgvector), `embeddings`(Ollama, 임베딩 모델을 로컬 구동).

## 사전 준비

- Node 22+, Docker (compose용)
- `server/google_service_account.json` (Cloud Speech-to-Text + Text-to-Speech 권한)
- OpenAI / Anthropic API 키
- (RAG용 별도 준비물 없음 — 임베딩 모델은 `embeddings` 컨테이너가 첫 기동 시 자동 다운로드)

## docker compose로 실행

먼저 `server/.env`를 만들고 키를 채웁니다 (compose가 `env_file`로 주입하므로 필수):

```bash
cp server/.env.example server/.env   # OPENAI_KEY / ANTHROPIC_KEY / AI_MODEL / TTS_VOICE 등 채우기
```

```bash
docker compose up --build
# web:    http://localhost:8080
# server: http://localhost:3000/api/health
# db:     localhost:5432 (pgvector)
# embed:  http://localhost:11434 (ollama)
```

`server/.env`에 채워둔 키들을 compose가 그대로 주입합니다. `GOOGLE_APPLICATION_CREDENTIALS`, `DATABASE_URL`, `EMBEDDINGS_URL`은 컨테이너 내부 경로/호스트명으로, `EMBEDDINGS_MODEL`은 `server`·`embeddings` 두 서비스가 항상 같은 값을 쓰도록 compose 변수(`${EMBEDDINGS_MODEL:-...}`)로 덮어쓰입니다. 따라서 compose에서 모델을 바꿀 땐 `server/.env`가 아니라 셸/프로젝트 루트 `.env`에 `EMBEDDINGS_MODEL`을 지정하세요.

> ⚠️ **첫 기동**: `embeddings` 컨테이너가 임베딩 모델(기본 `hf.co/Bingsu/KURE-v1-Q8_0-GGUF`, ~634MB)을 다운로드하므로 최초 1회는 몇 분 걸립니다. 모델은 `ollama` 볼륨에 캐시되어 이후로는 즉시 뜹니다. 서버는 임베딩이 준비될 때까지 warmup을 재시도합니다.
>
> 다른 임베딩 모델로 바꾸려면 `EMBEDDINGS_MODEL` 환경변수를 지정해서 띄우세요 (예: 다국어 bge-m3):
> ```bash
> EMBEDDINGS_MODEL=bge-m3 docker compose up --build
> ```

## 로컬 개발 (docker 없이)

RAG용 db·embeddings는 컨테이너로만 띄우고, server/web은 로컬에서 돌립니다:

```bash
# db(pgvector) + embeddings(ollama)만 컨테이너로
docker compose up db embeddings

# 서버 (다른 터미널) — env 기본값이 localhost:5432 / :11434를 가리킴
cd server && npm install && npm run dev
# 웹 (다른 터미널)
cd web && npm install && npm run dev
# http://localhost:5173 (Vite dev) → /api는 :3000 proxy
```

## 환경 변수 (server/.env)

전체 목록은 `server/.env.example` 참고. (AI 시스템 프롬프트는 env가 아니라 소스 `server/src/ai/system-prompt.ts`에 있습니다.)

| 항목 | 키 | 기본 |
|---|---|---|
| 포트 | `PORT` | `3000` |
| OpenAI 키 | `OPENAI_KEY` | (필수) |
| Anthropic 키 | `ANTHROPIC_KEY` | (필수) |
| Google 인증 | `GOOGLE_APPLICATION_CREDENTIALS` | 서비스 계정 JSON 경로 |
| STT provider | `STT_PROVIDER` | `google` |
| STT 모델 | `STT_MODEL` | `latest_long` |
| STT 언어 | `STT_LANGUAGE` | `ko-KR` |
| STT 샘플레이트 | `STT_SAMPLE_RATE_HERTZ` | (opt, 미지정 시 컨테이너에서 추론) |
| AI provider | `AI_PROVIDER` | `openai` (또는 `anthropic`) |
| AI 모델 | `AI_MODEL` | (필수, 예: `gpt-4o-mini`) |
| OpenAI reasoning | `AI_OPENAI_REASONING` | `minimal/low/medium/high` (opt) |
| Anthropic 확장 사고 예산 | `AI_ANTHROPIC_THINKING_BUDGET` | tokens (opt) |
| TTS provider | `TTS_PROVIDER` | `google` |
| TTS 보이스 | `TTS_VOICE` | (필수, 예: `ko-KR-Chirp3-HD-Achernar`) |
| TTS 언어 | `TTS_LANGUAGE` | `ko-KR` |
| TTS 샘플레이트 | `TTS_SAMPLE_RATE_HERTZ` | `24000` |
| TTS 오디오 포맷 | `TTS_AUDIO_ENCODING` | `PCM` (또는 `OGG_OPUS`) |
| 문장 분할 기호 | `SENTENCE_BOUNDARY_CHARS` | `.,!?;:\n。，！？；：` |
| Python 실행 파일 (weather tool) | `PYTHON_BIN` | `python3` |
| Postgres(pgvector) 접속 | `DATABASE_URL` | `postgres://hola:hola@localhost:5432/hola` |
| 임베딩 provider | `EMBEDDINGS_PROVIDER` | `ollama` |
| 임베딩 서버 URL | `EMBEDDINGS_URL` | `http://localhost:11434` |
| 임베딩 모델 | `EMBEDDINGS_MODEL` | `hf.co/Bingsu/KURE-v1-Q8_0-GGUF` (bge-m3로 교체 가능) |
| 임베딩 차원 | `EMBEDDING_DIM` | `1024` |
| 청크 크기 / 겹침 | `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP` | `800` / `150` |
| 검색 반환 청크 수 | `RAG_TOP_K` | `5` |

## 프로토콜

### `POST /api/chat` — 입력 업로드, 세션 시작

multipart/form-data. `text` 또는 `audio` 중 최소 하나 필수, `image`는 선택:
- `text`: string
- `audio`: file (`audio/webm;codecs=opus` 또는 `audio/ogg;codecs=opus`)
- `image`: file (선택, 카메라 프레임. `image/jpeg·png·gif·webp`, ≤8MB. 이미지 단독 전송은 400)

응답:
```json
{
  "session_id": "uuid",
  "config": {
    "stt": {...}, "ai": {...}, "tts": {...},
    "audio": { "encoding": "PCM", "sampleRateHertz": 24000, "channels": 1, "bitsPerSample": 16 }
  }
}
```

### `GET /api/chat/:session_id` — SSE 스트림

이벤트:
- `stt` `{ text, source: "audio"|"text" }`
- `ai_delta` `{ text }` — 음성/표시용 텍스트 (제스처 커맨드는 제거된 상태)
- `ai_complete` `{ text }` — 누적 전체 텍스트 (앞뒤 공백 trim)
- `gesture` `{ name }` — AI가 낸 제스처 커맨드. `name`은 아바타 제스처 id ([제스처 커맨드](#제스처-커맨드))
- `tts_start` `{ sentenceIdx, text }`
- `tts_chunk` `{ sentenceIdx, audio }` — base64로 인코딩된 오디오 바이트. 포맷은 `POST /api/chat` 응답의 `config.audio` 참고 (기본 PCM int16 LE 24kHz)
- `tts_end` `{ sentenceIdx }`
- `timing` `{ phase: "stt"|"ai_ttft"|"ai_total"|"tts_first_chunk"|"tts_total", ms }` — 각 단계 소요 시간(계측용)
- `done` `{}`
- `error` `{ message }`

각 세션은 정확히 한 번만 구독될 수 있고, 구독된 직후부터 sse가 닫힐 때까지 위 이벤트가 흘러옵니다.

### 문서 API (RAG)

- `POST /api/documents` — multipart `file` (텍스트 파일, ≤1MB, `.txt`/`.md`). 서버가 청킹→임베딩→pgvector 저장. 응답 `{ document_id, filename, chunks, skipped }` (같은 파일명·같은 내용을 다시 올리면 `skipped:true`).
- `GET /api/documents` — 저장된 문서 목록 `[{ id, filename, chunkCount, uploadedAt }]` (camelCase — POST 응답의 snake_case와 다름).
- `DELETE /api/documents/:id` — 문서와 청크 삭제 (204).

## RAG (문서 검색)

웹의 **"문서 업로드"** 버튼(입력 바 확장 시 표시)으로 텍스트 파일을 올리면, 서버가 문장/문단 경계 기준으로 청킹하고 **로컬 임베딩 모델**로 벡터화해 **pgvector**에 저장합니다. 임베딩은 외부 API가 아니라 compose의 `embeddings`(Ollama) 컨테이너에서 직접 구동됩니다.

AI에게는 `search_documents` **tool**이 주어집니다. 사용자가 업로드한 문서에 있을 법한 내용을 물으면 모델이 이 도구로 코사인 유사도 검색을 수행하고, 그 결과를 근거로 답합니다(근거 없으면 "모른다"고 답하도록 프롬프트됨). 검색은 자동 컨텍스트 주입이 아니라 **모델이 필요할 때만 호출**하는 방식입니다.

- **임베딩 모델**: 기본 `hf.co/Bingsu/KURE-v1-Q8_0-GGUF`(고려대 KURE-v1, 한국어 검색 특화, 1024-d, MTEB-ko-retrieval 1위 계열). 다국어가 필요하면 `EMBEDDINGS_MODEL=bge-m3`로 교체(동일 1024-d). 모델을 바꾸면 인제스트/쿼리 임베딩 공간이 달라지므로 **문서를 재업로드**해야 합니다. 서버는 부팅 시 `rag_meta`에 기록된 모델과 현재 설정이 다르고 기존 청크가 있으면 경고를 남깁니다.
- **벡터 저장소**: `pgvector`, `vector(1024)` + HNSW(`vector_cosine_ops`) 인덱스.
- **청킹**: 문자 기준 `RAG_CHUNK_SIZE`(기본 800), `RAG_CHUNK_OVERLAP`(150), 문단/문장 경계에 스냅.
- **문서 단위**: 파일명 하나당 문서 하나(`documents.filename` UNIQUE). 같은 파일명을 다시 올리면 — 내용이 같으면(sha256 동일) 재임베딩 없이 skip, 내용이 바뀌었으면 기존 문서를 교체(청크 cascade 삭제). 다른 파일명이면 내용이 같아도 별도 문서로 저장. 동시 업로드는 파일명 단위 advisory lock으로 직렬화.

## 카메라 비전

웹 하단 입력 행의 **카메라 버튼**([음성][파일][카메라][⋯] 순)으로 카메라를 켜면, 우측 상단에 라이브 프리뷰가 뜨고 이후 **모든 대화 전송(텍스트·음성)에 그 순간의 프레임이 함께 전송**됩니다. 끄기는 다시 카메라 버튼으로. AI에게 이미지는 "사용자 카메라에 지금 비친 실시간 장면"으로 전달되어, 대화와 관련 있으면 확인해 답하고 무관하면 무시하도록 프롬프트됩니다(`server/src/ai/system-prompt.ts`).

- **캡처**: 클라이언트 canvas에서 긴 변 1024px JPEG(q0.8)로 다운스케일. 프리뷰는 전면 카메라만 거울 반전(셀피), 후면은 그대로. **캡처는 항상 원본 방향**(모델에겐 실제 장면). 캡처 실패 시 이미지 없이 전송은 계속됨.
- **전/후면 전환**: 카메라가 2개 이상인 기기(폰 등)에서만 프리뷰 아래에 전환 버튼 표시(`facingMode` user↔environment). 카메라 1개인 PC에선 숨김.
- **버블 썸네일**: 이미지를 함께 보낸 턴은 내 대화 버블에 캡처 썸네일이 작게 표시됩니다(클라이언트 전용 object URL — 서버로 되돌아오지 않음).
- **전송**: `POST /api/chat`의 선택적 `image` 파트(위 [프로토콜](#post-apichat--입력-업로드-세션-시작)). 라우트에서 mimetype 화이트리스트·8MB 검증. 이미지는 저장하지 않고 메모리에서 provider로 바로 전달.
- **히스토리 정책**: 이 앱은 대화 히스토리를 매 호출 전체 재전송(stateless API)하므로, 이미지가 쌓이면 매 턴 재전송·재과금됩니다. 그래서 provider가 **가장 최근 이미지 1장만 유지**하고 이전 이미지 파트는 `"[이전 카메라 캡처 — 생략됨]"` 텍스트로 치환합니다 (`server/src/ai/{openai,anthropic}.ts`).
- **모델 요구**: `AI_MODEL`이 **vision(이미지 입력) 지원 모델**이어야 합니다. 미지원이면 카메라 턴은 SSE `error` 이벤트로 실패합니다(폴백 없음).
- **브라우저**: `getUserMedia`는 secure context 필요 — localhost는 OK, 원격 http 배포에선 동작 안 함.

## AI 대화 세션

서버는 **시작 시 대화 세션을 한 개 발급**하고, 모든 AI 호출이 이 세션을 재사용합니다. 각 턴의 사용자 발화와 AI 답변(+도구 호출)이 서버 메모리의 대화 히스토리에 누적되므로, 아바타가 이전 대화를 기억합니다.

- **발급 시점**: 서버 부팅 시 1회. 기동 로그에 `[hola] ai session issued: <uuid>` 로 출력됩니다.
- **범위**: 서버 전역 단일 세션 — 모든 요청이 하나의 대화를 공유합니다(단일 사용자 데모 전제).
- **구현**: `AiProvider.createSession()`이 세션 키(UUID)와 빈 히스토리를 발급하고, `stream(input, session)`이 매 호출마다 시스템 프롬프트+히스토리를 재전송한 뒤 응답을 히스토리에 덧붙입니다. OpenAI(Chat Completions)·Anthropic(Messages) **양쪽 동일하게 동작**하며, 각 프로바이더가 자기 SDK 포맷의 히스토리를 세션에 보관합니다 (`server/src/ai/{openai,anthropic}.ts`, 인터페이스는 `server/src/ai/types.ts`).
- **리셋**: 별도 엔드포인트는 없고, **서버를 재시작하면 새 세션 키로 대화가 초기화**됩니다. 실행이 길어지면 히스토리가 상한 없이 누적되므로 주의하세요.

> ⚠️ 위 `POST /api/chat`의 `session_id`와는 **다른 개념**입니다. `session_id`는 요청 1건의 SSE 전송용으로 매 요청 발급되어 1회 구독 후 폐기되는 **일회성 요청 세션**이고, 여기서 말하는 **대화 세션**은 서버 수명 내내 유지되며 문맥을 잇는 AI 대화 세션입니다.

## 제스처 커맨드

AI는 응답 스트림 안에 `{gesture=NAME}` 형식으로 아바타 제스처를 섞어 낼 수 있습니다. 서버(`server/src/pipeline/gesture-parser.ts`)가 스트리밍 도중 이 커맨드를 분리해서:

- **음성/표시 텍스트**에서 커맨드를 제거하고(그래서 `ai_delta`·TTS에는 깨끗한 텍스트만 흐름),
- 유효한 제스처면 별도의 `gesture` 이벤트로 클라이언트에 보냅니다.

브라우저는 `gesture` 이벤트를 받으면 해당 제스처를 아바타에 재생합니다. 마커가 델타 경계에 걸쳐 쪼개져 와도(예: `{ges`+`ture=...`) 안전하게 파싱됩니다.

유효한 제스처 이름 — 서버 `KNOWN_GESTURES`(gesture-parser.ts)와 클라이언트 `web/src/lib/gestures.ts`가 동일하게 유지:

| 이름 | 동작 |
|---|---|
| `expression_happy` | 기쁜 표정 |
| `expression_sad` | 슬픈 표정 |
| `action_wave` | 손 흔들기 |
| `show_sunny` | 해 등장 (맑은 날씨) |

> 시스템 프롬프트는 **소스(`server/src/ai/system-prompt.ts`)** 에 정의되어 있고, 모델에게 이 형식과 사용 가능한 이름을 지시합니다(env 변수 아님). 알 수 없는 이름은 서버가 무시합니다.

## 브라우저 호환성

기본(PCM) 포맷에서는 Web Audio API만 있으면 됩니다. Chrome / Edge / Firefox / Safari 모두 동작.
