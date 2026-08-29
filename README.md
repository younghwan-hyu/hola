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
- **문서 조회 모드**: 로컬 PDF를 좌측 뷰어로 열어 보면서 대화. 대화 전송 시 현재 페이지를 캡처해 함께 전송하고, 카메라도 켜져 있으면 문서 캡처+카메라 프레임을 모두 전송 (아래 [문서 조회 모드](#문서-조회-모드))
- **말풍선 UI**: 3D 위에 겹쳐 띄우는 **인라인** 모드와, 3D 아래 별도 창에 대화를 쌓아 스크롤로 되짚어 보는 **분리** 모드 중 설정에서 선택 (아래 [말풍선 표시 모드](#말풍선-표시-모드))
- **판정(perception)**: 카메라가 켜져 있는 동안 브라우저가 주기적으로 저해상도 프레임을 보내 "얼굴이 보이는지", "딴 걸 보고 있는지", "표정이 어두운지" 같은 단발 판정만 받고, 조건이 걸리면 아바타가 **먼저 말을 겁니다**. 체크가 여러 개여도 말은 한 번만 겁니다. 어떤 판정을 돌릴지는 웹의 **상황 인지 버튼**에서 항목별로 켜고 끕니다. 대화 파이프라인과 분리된 경량 경로 (아래 [판정 경로](#판정-경로-perception))

> ⚠️ TTS 포맷은 기본값 **PCM** 입니다. Google streaming TTS는 OGG_OPUS도 지원하지만 Chrome의 MSE byte stream에는 OGG 컨테이너가 없어 청크 append가 안 됩니다. PCM이면 `AudioBufferSourceNode`로 청크별 스케줄링이 깔끔하게 됩니다. 대역폭이 중요한 경우 `TTS_AUDIO_ENCODING=OGG_OPUS`로 바꾸고 클라이언트에 wasm Opus 디코더를 붙이면 됩니다.

## 디렉토리

```
.
├── server/         # TypeScript + Express, STT/AI/TTS/임베딩 provider 추상화 + RAG + 판정 체크
├── web/            # Vite + React + three.js VRM 아바타 (립싱크/제스처), Web Audio 청크 재생, pdf.js 문서 뷰어
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

> ⚠️ **첫 기동**: `embeddings` 컨테이너가 임베딩 모델(기본 `hf.co/Bingsu/KURE-v1-Q8_0-GGUF`, ~634MB)을 다운로드하므로 최초 1회는 몇 분 걸립니다. 모델은 `ollama` 볼륨에 캐시되어 이후로는 즉시 뜹니다. compose에서는 `embeddings`가 healthy(모델 pull 완료)가 된 뒤에야 `server`가 뜹니다. 로컬 개발(`npm run dev`)로 pull 도중에 서버를 띄우면 임베딩 warmup이 약 30초간 재시도한 뒤 경고만 남기고 포기하지만, 모델이 준비되면 이후 요청은 정상 동작합니다.
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
| 문장 분할 기호 | `SENTENCE_BOUNDARY_CHARS` | `.,!?;:\n。，！？；：` (`\n`은 개행. `.env`에서는 값을 **큰따옴표로 감싸야** 개행으로 읽힘 — 따옴표 없이 쓰면 `\`와 `n` 두 글자가 경계가 됨) |
| AI 제스처 목록 | `GESTURES` | 미지정 시 전체. 쉼표 구분 부분집합, 빈 값(`GESTURES=`)이면 끔 ([제스처 커맨드](#제스처-커맨드)) |
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

multipart/form-data. `text` 또는 `audio` 중 최소 하나 필수, `image`/`document`는 선택:
- `text`: string
- `audio`: file (`audio/webm;codecs=opus` 또는 `audio/ogg;codecs=opus`)
- `image`: file (선택, 카메라 프레임. `image/jpeg·png·gif·webp`, ≤8MB. 이미지 단독 전송은 400)
- `document`: file (선택, 문서 조회 모드의 현재 PDF 페이지 캡처. `image`와 동일한 타입·크기 제한, 단독 전송은 400)

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

**중단**: SSE 연결이 끊기면 서버가 그 턴을 **중단**합니다 (`Session.abort()`). AI 호출에 `AbortSignal`이 전달되어 생성이 그 자리에서 멈추고, 큐에 남은 문장은 TTS 되지 않습니다. 웹의 **정지 버튼**은 재생을 멈추면서 EventSource를 닫는 방식으로 이걸 트리거하고, 탭을 닫거나 네트워크가 끊겨도 동일하게 동작합니다. 별도의 중단 엔드포인트는 없습니다.

중단된 턴도 **모델이 이미 말한 부분까지는 대화 세션에 남습니다** — 사용자가 들은 내용이므로 다음 턴이 그걸 알고 있어야 합니다("아까 하던 얘기"). 한 글자도 나오기 전에 끊겼으면 아무것도 기록하지 않고(답 없는 질문만 히스토리에 남는 걸 피함), 진행 중이던 도구 호출은 버려집니다. 프로바이더별로 abort가 예외로 오기도 하고(Anthropic) 스트림이 조용히 끝나기도 해서(OpenAI) 양쪽 경로 모두에서 같은 규칙이 적용됩니다.

### 문서 API (RAG)

- `POST /api/documents` — multipart `file` (텍스트 파일, ≤1MB, `.txt`/`.md`). 서버가 청킹→임베딩→pgvector 저장. 응답 `{ document_id, filename, chunks, skipped }` (같은 파일명·같은 내용을 다시 올리면 `skipped:true`).
- `GET /api/documents` — 저장된 문서 목록 `[{ id, filename, chunkCount, uploadedAt }]` (camelCase — POST 응답의 snake_case와 다름).
- `DELETE /api/documents/:id` — 문서와 청크 삭제 (204).

### 판정 API (perception)

- `GET /api/perception` — 브라우저가 돌릴 체크 목록. `[{ name, label, description, requires, trigger, frame? }]`
  - `label` / `description` — 웹의 상황 인지 모달에 표시되는 이름·설명.
  - `requires` — 브라우저가 갖춰야 할 것의 목록(현재는 `"camera"`뿐). 모달에 **"카메라 필요"** 뱃지로 표시되고, 하나라도 없으면 그 체크는 켜져 있어도 돌지 않고 대기합니다.
  - `trigger` — 구동 방식. 현재는 폴링뿐: `{ kind: "poll", intervalMs, consecutive }` → 모달에 **"N초 폴링"** 뱃지.
  - `frame` — 카메라 체크가 보낼 프레임 스펙 `{ maxPx, quality }` (`requires`에 `"camera"`가 있을 때).
  - 프롬프트·트리거 문구는 서버에만 있습니다.
- `POST /api/perception/:name` — multipart `image` (≤2MB). 응답 `{ label, signal? }`. `signal`은 아바타가 말을 걸어야 하는 판정일 때만 실리는 상태 알림 문장. 없는 체크는 404, 프로바이더 오류는 502.

## RAG (문서 검색)

웹 하단 입력 행의 **"문서 업로드"(파일) 버튼**(접힌 기본 행 [문서][음성][카메라][파일][상황 인지][⋯]의 [파일]. `⋯`로 입력 바를 펼치면 보이지 않음)으로 텍스트 파일을 올리면, 서버가 문장/문단 경계 기준으로 청킹하고 **로컬 임베딩 모델**로 벡터화해 **pgvector**에 저장합니다. 임베딩은 외부 API가 아니라 compose의 `embeddings`(Ollama) 컨테이너에서 직접 구동됩니다.

AI에게는 `search_documents` **tool**이 주어집니다. 사용자가 업로드한 문서에 있을 법한 내용을 물으면 모델이 이 도구로 코사인 유사도 검색을 수행하고, 그 결과를 근거로 답합니다(근거 없으면 "모른다"고 답하도록 프롬프트됨). 검색은 자동 컨텍스트 주입이 아니라 **모델이 필요할 때만 호출**하는 방식입니다.

- **임베딩 모델**: 기본 `hf.co/Bingsu/KURE-v1-Q8_0-GGUF`(고려대 KURE-v1, 한국어 검색 특화, 1024-d, MTEB-ko-retrieval 1위 계열). 다국어가 필요하면 `EMBEDDINGS_MODEL=bge-m3`로 교체(동일 1024-d). 모델을 바꾸면 인제스트/쿼리 임베딩 공간이 달라지므로 **문서를 재업로드**해야 합니다. 서버는 부팅 시 `rag_meta`에 기록된 모델과 현재 설정이 다르고 기존 청크가 있으면 경고를 남깁니다.
- **벡터 저장소**: `pgvector`, `vector(1024)` + HNSW(`vector_cosine_ops`) 인덱스.
- **청킹**: 문자 기준 `RAG_CHUNK_SIZE`(기본 800), `RAG_CHUNK_OVERLAP`(150), 문단/문장 경계에 스냅.
- **문서 단위**: 파일명 하나당 문서 하나(`documents.filename` UNIQUE). 같은 파일명을 다시 올리면 — 내용이 같으면(sha256 동일) 재임베딩 없이 skip, 내용이 바뀌었으면 기존 문서를 교체(청크 cascade 삭제). 다른 파일명이면 내용이 같아도 별도 문서로 저장. 동시 업로드는 파일명 단위 advisory lock으로 직렬화.

## 카메라 비전

웹 하단 입력 행의 **카메라 버튼**([문서][음성][카메라][파일][상황 인지][⋯] 순)으로 카메라를 켜면, 우측 상단에 라이브 프리뷰가 뜨고 이후 **모든 대화 전송(텍스트·음성)에 그 순간의 프레임이 함께 전송**됩니다. 끄기는 다시 카메라 버튼으로. AI에게 이미지는 `[카메라]` 라벨과 함께 "사용자 카메라에 지금 비친 실시간 장면"으로 전달되어, 대화와 관련 있으면 확인해 답하고 무관하면 무시하도록 프롬프트됩니다(`server/src/ai/system-prompt.ts`).

- **캡처**: 클라이언트 canvas에서 긴 변 1024px JPEG(q0.8)로 다운스케일. 프리뷰는 전면 카메라만 거울 반전(셀피), 후면은 그대로. **캡처는 항상 원본 방향**(모델에겐 실제 장면). 캡처 실패 시 이미지 없이 전송은 계속됨.
- **전/후면 전환**: 카메라가 2개 이상인 기기(폰 등)에서만 프리뷰 아래에 전환 버튼 표시(`facingMode` user↔environment). 카메라 1개인 PC에선 숨김.
- **버블 썸네일**: 이미지를 함께 보낸 턴은 내 대화 버블에 캡처 썸네일이 작게 표시됩니다(클라이언트 전용 object URL — 서버로 되돌아오지 않음).
- **전송**: `POST /api/chat`의 선택적 `image` 파트(위 [프로토콜](#post-apichat--입력-업로드-세션-시작)). 라우트에서 mimetype 화이트리스트·8MB 검증. 이미지는 저장하지 않고 메모리에서 provider로 바로 전달.
- **히스토리 정책**: 이 앱은 대화 히스토리를 매 호출 전체 재전송(stateless API)하므로, 이미지가 쌓이면 매 턴 재전송·재과금됩니다. 그래서 provider가 **가장 최근 이미지가 포함된 턴의 이미지들만 유지**하고(문서 캡처+카메라 프레임은 한 스냅샷으로 함께 유지) 이전 이미지 파트는 `"[이전 캡처 — 생략됨]"` 텍스트로 치환합니다 (`server/src/ai/{openai,anthropic}.ts`).
- **모델 요구**: `AI_MODEL`이 **vision(이미지 입력) 지원 모델**이어야 합니다. 미지원이면 카메라 턴은 SSE `error` 이벤트로 실패합니다(폴백 없음).
- **브라우저**: `getUserMedia`는 secure context 필요 — localhost는 OK, 원격 http 배포에선 동작 안 함.

## 문서 조회 모드

하단 입력 행 맨 왼쪽의 **문서 버튼**(마이크 왼쪽)을 누르면 화면이 분할되어 **왼쪽에 PDF 뷰어, 오른쪽에 아바타**가 배치됩니다(가로 PC 레이아웃 전용, 60/40). 다시 누르면 아바타 전체 화면으로 복귀 — 열어 둔 문서와 페이지는 유지됩니다.

- **문서 열기**: 뷰어의 "PDF 파일 선택" 버튼 → 파일 선택창에서 **임의의 로컬 PDF**를 엽니다(사전 목록·서버 업로드 없음). 페이지 이전/다음 버튼으로 넘기고, "다른 PDF 파일 선택"으로 언제든 파일을 교체합니다. 렌더링은 웹 번들에 포함된 **pdf.js**(worker 포함)로 브라우저에서만 수행됩니다.
- **대화에 첨부**: 모드가 켜져 있으면 대화 전송(텍스트·음성) 시 **지금 보고 있는 페이지**를 긴 변 1536px JPEG(q0.8)로 새로 렌더해 `POST /api/chat`의 `document` 파트로 첨부합니다(화면 크기와 무관하게 항상 선명한 원본 렌더). 카메라도 켜져 있으면 **문서 캡처 + 카메라 프레임 + 대화**가 함께 전송됩니다. 내 대화 버블에는 첨부된 캡처들이 썸네일로 표시됩니다.
- **모델 구분**: 서버 provider가 각 이미지 바로 앞에 `[문서 화면]` / `[카메라]` 라벨 텍스트 파트를 붙이고, 시스템 프롬프트가 그 의미("사용자가 지금 문서 뷰어에서 보고 있는 페이지" vs "실시간 카메라 장면")를 설명합니다. "이 페이지", "이 부분" 같은 지시는 문서 화면을 우선 보게 프롬프트되어 있습니다 (`server/src/ai/system-prompt.ts`, 라벨 상수는 `server/src/ai/types.ts`).
- **RAG와는 별개**: PDF를 뷰어로 여는 것은 [RAG 문서 업로드](#rag-문서-검색)와 무관합니다 — 뷰어는 파일을 서버에 저장하지 않고, 전송되는 것은 대화 턴에 첨부되는 페이지 캡처뿐입니다. 강의 자료처럼 검색까지 원하면 텍스트 파일을 따로 업로드하세요. (모델은 문서 화면에서 답을 읽되, 더 넓은 맥락이 필요하면 `search_documents`로 보충하도록 프롬프트됩니다.)
- **판정 턴은 제외**: perception이 주입하는 히든 턴에는 카메라 프레임과 마찬가지로 문서 캡처도 첨부하지 않습니다.
- **모델 요구**: 카메라와 동일하게 `AI_MODEL`이 vision 지원 모델이어야 합니다.

## 판정 경로 (perception)

카메라가 켜져 있는 동안, 브라우저는 대화와 **별개로** 주기적으로 프레임을 보내 단발 판정을 받습니다. 지금 등록된 체크는 세 개입니다.

| 체크 | 묻는 것 | 주기 / 연속 | 걸리면 |
|---|---|---|---|
| `presence` | 사용자의 **얼굴**이 화면에 보이는가 | 3초 / 1회 (즉시) | "어디 가셨어요?" |
| `attention` | 얼굴은 보이는데 **손에 든 물건**을 들여다보고 있는가 | 4초 / 1회 (즉시) | "뭘 보고 계세요?" |
| `expression` | 얼굴 **표정**이 어둡거나 아리송한가 | 5초 / 2회 연속 (약 10초) | "잘 이해되지 않았어요?" |

- `presence`: 아무도 없는 경우뿐 아니라 **몸통만 걸치고 얼굴은 프레임 밖으로 벗어난 경우, 뒤통수만 보이는 경우도 자리를 비운 것으로 봅니다**. 반대로 얼굴이 나오기만 하면 다른 곳을 보고 있든 일부가 가려졌든 어둡든 자리에 있는 것으로 봅니다.
- `attention`: 휴대폰·태블릿·책 같은 **손에 든 물건에 시선이 가 있을 때**만 걸립니다. 물건을 들고만 있고 보고 있지 않거나, 화면에 사람이 없으면(그건 `presence`의 몫) 무해한 라벨로 떨어집니다.
- `expression`: 얼굴이 보이는 상태에서 **찡그림·시무룩·걱정 같은 어두운 표정이나 갸우뚱·미간 찌푸림 같은 아리송한 표정**일 때만 걸립니다. 무표정·밝음·집중은 물론, 얼굴이 없거나 너무 작아 표정을 읽을 수 없는 프레임도 무해한 라벨입니다(그건 `presence`의 몫). 표정은 순간순간 바뀌므로 **두 번 연속** 걸려야 말을 겁니다. 묻는 것은 "방금 내용이 잘 이해되지 않았는지, 어려운지"이고, 표정이 멀쩡하면 아무 말도 덧붙이지 않습니다. 사용자가 어렵다고 답하면 아래 "짧게 받고 물러남" 규칙 대신 평소대로 다시 설명합니다.

```
카메라 ON
  │
  ├─[3초] 256px ─▶ POST /api/perception/presence   ─┐
  ├─[4초] 448px ─▶ POST /api/perception/attention  ─┼─▶ AI 단발 호출 (체크별 독립, 겹쳐도 됨)
  ├─[5초] 512px ─▶ POST /api/perception/expression ─┘   (히스토리 X, 툴 X, 스트리밍 X, 출력 8토큰)
  │                                                             │
  │                                        signal 이 실려온 첫 체크 하나만 ↓
  │                                          (나머지는 즉시 무장 해제)
  │                                                             │
  └─[사용자 발화] ────────────▶ POST /api/chat ◀────────────────┘
                                    │        (상태 알림 1턴 주입 — 화면엔 안 보임)
                                    ▼
                     STT → AI(세션/히스토리) → TTS → SSE → 아바타 발화
```

- **대화를 오염시키지 않음**: 판정 호출은 `AiProvider.classify()`로, 시스템 프롬프트·히스토리·툴·스트리밍 없이 이미지 1장과 짧은 질문만 보내고 라벨 몇 토큰만 받습니다. 서버의 대화 세션은 건드리지 않으므로 3초마다 히스토리가 불어나거나 재과금되지 않습니다. OpenAI는 `detail: "low"`로 이미지 토큰이 정액이고, Anthropic은 확장 사고를 끕니다.
- **행동 규칙은 시스템 프롬프트에**: 주입되는 턴은 `(perception: 사용자가 카메라 화면에서 사라졌습니다)` 같은 **상태 알림**일 뿐, "이렇게 말해라"는 지시가 아닙니다. 어떻게 반응할지는 각 체크의 `guidance`가 갖고 있고 `withPerceptionGuidance()`가 시스템 프롬프트 뒤에 합성합니다. user 턴에 지시를 실어 보내면 최신 모델이 이를 무시하거나 되묻습니다.
- **대답은 짧게 받고 물러남**: 말을 건 뒤 사용자가 대답하면, 아바타는 그 내용을 짚어주는 **한 문장만** 하고 끝냅니다 ("물 마시고 오셨군요."). 도와줄지 되묻거나 하던 얘기를 다시 꺼내지 않습니다 — 자리 비움 확인은 대화 주제가 아니니까요. 대답에 질문이나 다른 용건이 섞여 있으면 그 부분은 평소대로 답합니다. 체크와 무관한 공통 규칙이라 각 체크의 `guidance`가 아니라 `PERCEPTION_PREAMBLE`(`server/src/perception/index.ts`)에 있습니다. **예외**: `expression`(표정 인식)이 "어려우세요?"라고 물은 뒤 사용자가 어렵다고 답하면 그건 도와달라는 뜻이므로, 그 체크의 `guidance`가 이 규칙을 덮어써 평소대로 다시 설명합니다.
- **말 거는 순간에만 합류**: 트리거가 걸리면 클라이언트가 `POST /api/chat`에 알림 한 턴을 넣습니다. 그 뒤로는 평소 대화와 동일해서 TTS·립싱크·제스처가 그대로 붙고, 사용자가 자연스럽게 대답할 수 있습니다. 알림은 **화면에 사용자 말풍선으로 표시되지 않고**(AI 답변만 보임), 서버 히스토리에는 남아 후속 대화의 문맥이 됩니다. 이 턴은 카메라 프레임을 함께 보내지 않습니다 — 빈 방 사진을 주면 모델이 사용자에게 말을 거는 대신 장면을 묘사합니다.
- **보채지 않음**: 한 번 말을 걸면 **사용자가 실제로 응답할 때까지** 다시 걸지 않습니다(`armed` 플래그). 화면에 다시 나타나는 것만으로는 재무장되지 않습니다 — 그러면 말없이 들락날락할 때마다 "어디 가셨어요?"를 반복하게 됩니다. 재무장은 사용자가 직접 보낸 턴(텍스트·음성)에서만 일어납니다. 대화 턴이 진행 중이거나 탭이 백그라운드면 폴링 자체를 멈춥니다.
- **여러 체크가 있어도 말은 한 번만**: `armed`는 체크별이 아니라 **전체가 공유하는 플래그 하나**입니다(`perceptionArmed`, `web/src/App.tsx`). 먼저 트리거된 체크가 발화 직전에 동기적으로 무장을 해제하므로, "어디 가셨어요?"와 "뭘 보고 계세요?"가 겹쳐 나올 수 없습니다. 판정 호출은 **체크별로 독립적으로** 나갑니다 — 서로 겹쳐 동시에 나갈 수 있고(서버와 모델이 병렬로 처리), 결과는 도착하는 순서대로 각자 처리됩니다. 직렬화나 미루기는 필요 없습니다: 두 번 일어나면 안 되는 건 발화뿐인데, 그건 먼저 도착한 판정이 동기적으로 무장을 해제해 막습니다(JS는 단일 스레드라 뒤이어 도착한 다른 체크의 결과는 위 가드에서 버려짐). 건너뛰는 경우는 **같은 체크**의 직전 요청이 아직 응답 전일 때 그 틱뿐이라(`perceptionInFlight`, `web/src/App.tsx`), 느린 체크가 빠른 체크를 막지 못하고 각 체크는 자기 주기를 그대로 지킵니다. 판정 요청에는 8초 타임아웃이 걸려 있어(서버 쪽 classify도 15초·재시도 없음) 요청 하나가 멈춰도 그 체크가 몇 분씩 멎지 않습니다. 대화 턴 점유도 React state(`busy`)가 아니라 동기 ref(`turnInFlight`)로 잠급니다: state는 같은 tick에서 두 호출자 모두에게 `false`로 읽혀서, 사용자가 전송하는 순간 판정이 겹치면 턴이 두 개 열립니다.
- **무장 해제 중엔 호출 안 함**: 이미 말을 걸어 둔 상태(또는 카메라 OFF)면 프레임을 캡처하지도, 판정 API를 부르지도 않습니다. 자리를 비운 채 방치했을 때 3초마다 나가던 vision 호출이 사라집니다.
- **항목별 on/off**: 하단 입력 행의 **상황 인지 버튼**([문서][음성][카메라][파일][상황 인지][⋯]의 다섯 번째)을 누르면 서버에 등록된 체크가 스위치와 함께 나열됩니다(이름·설명은 서버가 보내는 `label`/`description`). 각 항목에는 서버가 선언한 요구 조건과 구동 방식이 뱃지로 붙습니다 — **"카메라 필요"**(`requires`에 `"camera"`), **"N초 폴링"**(`trigger.kind === "poll"`). 항목의 실제 상태도 함께 표시됩니다: **꺼짐**(스위치 off) / **카메라를 켜면 동작**(켜져 있지만 요구 조건 미충족 — "카메라 필요" 뱃지가 주황색으로 표시됨. 카메라는 메인 행의 카메라 버튼으로 켬) / **말을 걸고 응답 대기 중**(무장 해제 상태) / **동작 중**. 체크는 **켜져 있고 요구 조건이 모두 충족될 때만** 폴링합니다 — 끈 체크는 폴링 타이머 자체가 돌지 않아 vision 호출이 나가지 않고, 판정 응답을 기다리는 도중에 끄면 그 결과도 버립니다. 선택은 브라우저에 저장되어(localStorage `hola.perceptionDisabled`, `web/src/lib/settings.ts`) 다음 방문에도 유지되며, 서버에 새로 추가된 체크는 기본 **켜짐**입니다. 버튼은 카메라가 켜져 있고 켜 둔 체크가 하나라도 있을 때(= 실제로 동작 중일 때)만 흰색으로 표시됩니다. 켜고 끄는 것은 이미 걸어 둔 말(무장 상태)에는 영향을 주지 않습니다.

### 체크 추가하기

`server/src/perception/<name>.ts`에 팩토리 하나를 쓰고 `createPerceptionChecks()`에 등록하면 끝입니다. 라우트도, 브라우저 폴링 루프도 이 인터페이스에 대해 제네릭이라 **클라이언트 수정이 필요 없습니다**(상황 인지 모달의 on/off 목록에도 `label`/`description`으로 자동 등장). 발화가 겹칠 걱정도 없지만(위 "말은 한 번만"), 어느 체크가 이기든 그 프레임에 맞는 말이 나오도록 **라벨은 서로 배타적으로** 설계하세요 — 예를 들어 `attention`은 "화면에 사람이 없음"을 자기 트리거로 삼지 않고 무해한 라벨로 넘깁니다(그건 `presence`가 볼 상황).

```ts
export function createPresenceCheck(): PerceptionCheck {
  return {
    name: "presence",
    label: "존재 인식",     // 웹의 상황 인지 모달에 표시되는 이름
    description: "얼굴이 카메라에서 사라지면 어디 갔는지 묻습니다.", // 모달의 한 줄 설명
    requires: ["camera"],  // 브라우저가 갖춰야 할 것 → "카메라 필요" 뱃지, 없으면 켜져 있어도 대기
    trigger: {             // 구동 방식 → "3초 폴링" 뱃지
      kind: "poll",
      intervalMs: 3000,
      consecutive: 1,      // 몇 회 연속 걸려야 실행할지 (1 = 즉시)
    },
    frame: { maxPx: 256, quality: 0.5 },  // 판정용 프레임은 작게
    prompt: '...얼굴이 보이면 "present", 보이지 않으면 "absent"라고만 답하라.',
    labels: ["present", "absent"],  // labels[0]은 파싱 실패 시 폴백 → 반드시 무해한 쪽
    // 라벨 → 대화에 주입할 "상태 알림" (지시문이 아님)
    triggers: { absent: "(perception: 사용자가 카메라 화면에서 사라졌습니다)" },
    // 그 알림에 어떻게 반응할지 — 시스템 프롬프트에 합성됨
    guidance: "- 사용자가 카메라 화면에서 사라졌다는 알림이 오면: 어디 갔는지 묻는 짧은 한 문장만 말하라.",
    maxTokens: 8,
  };
}
```

> ⚠️ **비용**: 카메라를 켜 두면 등록된 체크들이 각자의 주기로 vision 호출을 냅니다 (지금 설정으로 분당 최대 47회 — `presence` 20 + `attention` 15 + `expression` 12). 아바타가 이미 말을 걸어 둔 상태에서는 호출이 나가지 않으므로, 자리를 비운 채 방치할 때는 0회입니다. 주기를 늘리려면 `trigger.intervalMs`를, 체크를 빼려면 `createPerceptionChecks()`에서 제거하세요. `AI_MODEL`은 카메라 기능과 마찬가지로 vision 지원 모델이어야 합니다.

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

> 시스템 프롬프트는 **소스(`server/src/ai/system-prompt.ts`)** 에 정의되어 있고, 모델에게 이 형식과 사용 가능한 이름을 지시합니다. 알 수 없는 이름은 서버가 무시합니다.

**AI가 낼 수 있는 제스처는 `server/.env`의 `GESTURES`로 제한할 수 있습니다** (쉼표 구분, 예: `GESTURES=expression_happy,action_wave`). 미지정 시 전체 활성, 빈 값(`GESTURES=`)이면 AI 제스처 기능 자체가 꺼집니다 (프롬프트에서 제스처 지시가 통째로 빠짐). 이 목록은 시스템 프롬프트의 제스처 목록과 서버의 `gesture` 이벤트 필터에만 적용됩니다 — 위 표의 전체 레지스트리(서버 `KNOWN_GESTURES` / 클라 `gestures.ts`)는 그대로 유지되므로 **웹은 수정할 필요가 없고**, 웹 UI의 수동 제스처 메뉴도 계속 전체가 동작합니다. 모델이 비활성 제스처를 내면 서버가 걸러냅니다.

## 말풍선 표시 모드

입력 바를 펼친 뒤(`⋯`) **설정(톱니) 버튼**에서 대화 말풍선을 어떻게 보여줄지 고릅니다. 선택은 브라우저에 저장되어(localStorage `hola.bubbleMode`, `web/src/lib/settings.ts`) 다음 방문에도 유지됩니다.

- **인라인** (기본): 3D 화면 **위에** 최근 말풍선 2개만 겹쳐 뜨고, 새 말풍선이 생기면 가장 오래된 것이 위로 밀려 사라집니다. 입력 바도 3D 위에 떠 있습니다.
- **분리**: 3D 화면 **아래**에 대화 로그 창이 생기고, 그 아래로 입력 바가 내려갑니다. 지나간 말풍선이 사라지지 않고 쌓이므로 **스크롤해서 다시 볼 수 있습니다**. 새 메시지가 오면 자동으로 맨 아래를 따라가되, 위로 올려 읽는 중이면 끌려가지 않습니다. 3D 영역이 그만큼 낮아지므로 **카메라가 얼굴 쪽으로 더 다가간 기본 구도**로 잡힙니다(`SEPARATE_CAMERA_DISTANCE`, 기본 1.5m 대 인라인 2.2m — 마우스 휠로 언제든 당기고 밀 수 있습니다).

> 로그는 **지금 이 브라우저 세션에서 주고받은 것만** 담습니다 — 서버에서 과거 기록을 가져오지 않고, 새로고침하면 비워집니다(서버의 [AI 대화 세션](#ai-대화-세션)은 별개로 유지되므로, 화면이 비어도 아바타는 이전 대화를 기억합니다). 첨부한 캡처 썸네일도 로그에 남아 있어야 해서, 이미지를 많이 보낸 긴 세션에서는 그만큼 브라우저 메모리를 씁니다.

## 브라우저 호환성

기본(PCM) 포맷에서는 Web Audio API만 있으면 됩니다. Chrome / Edge / Firefox / Safari 모두 동작.
