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
- **AI**: streaming, 문장 부호 단위로 분할하여 TTS 큐로 전달
- **TTS**: streaming, 문장 단위로 순차 재생 (기본 PCM 24kHz int16 LE)
- **제스처**: AI 응답에 섞인 `{gesture=NAME}` 커맨드를 서버가 파싱해 음성 텍스트와 분리, `gesture` 이벤트로 전송 → 브라우저가 아바타 제스처 재생 (아래 [제스처 커맨드](#제스처-커맨드))

> ⚠️ TTS 포맷은 기본값 **PCM** 입니다. Google streaming TTS는 OGG_OPUS도 지원하지만 Chrome의 MSE byte stream에는 OGG 컨테이너가 없어 청크 append가 안 됩니다. PCM이면 `AudioBufferSourceNode`로 청크별 스케줄링이 깔끔하게 됩니다. 대역폭이 중요한 경우 `TTS_AUDIO_ENCODING=OGG_OPUS`로 바꾸고 클라이언트에 wasm Opus 디코더를 붙이면 됩니다.

## 디렉토리

```
.
├── server/         # TypeScript + Express, STT/AI/TTS provider 추상화
├── web/            # Vite + React + three.js VRM 아바타 (립싱크/제스처), Web Audio 청크 재생
└── compose.yml     # 한 번에 띄우기
```

## 사전 준비

- Node 22+, Docker (compose용)
- `server/google_service_account.json` (Cloud Speech-to-Text + Text-to-Speech 권한)
- OpenAI / Anthropic API 키

## docker compose로 실행

```bash
docker compose up --build
# web:    http://localhost:8080
# server: http://localhost:3000/api/health
```

`server/.env`에 채워둔 키들을 compose가 그대로 주입합니다. `GOOGLE_APPLICATION_CREDENTIALS`만 컨테이너 내부 경로로 덮어쓰여 마운트된 JSON을 가리킵니다.

## 로컬 개발 (docker 없이)

```bash
# 서버
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

## 프로토콜

### `POST /api/chat` — 입력 업로드, 세션 시작

multipart/form-data 필드 중 최소 하나:
- `text`: string
- `audio`: file (`audio/webm;codecs=opus` 또는 `audio/ogg;codecs=opus`)

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
