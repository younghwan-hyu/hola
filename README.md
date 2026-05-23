# hola

음성/텍스트 입력 → AI 응답 → 음성 출력 파이프라인 데모.

```
[User] --text or audio-->  Server  --STT (bulk)-->  Text
                              |
                              +--AI (stream, sentence-split)-->  TTS queue
                                                                    |
                              <--SSE stream (ai_delta + tts_chunk)--+
[Browser] --Web Audio API (PCM 24kHz, int16 LE)--> playback
```

- **STT**: bulk (오디오 전체 업로드 후 1회 호출)
- **AI**: streaming, 문장 부호 단위로 분할하여 TTS 큐로 전달
- **TTS**: streaming, 문장 단위로 순차 재생 (기본 PCM 24kHz int16 LE)

> ⚠️ TTS 포맷은 기본값 **PCM** 입니다. Google streaming TTS는 OGG_OPUS도 지원하지만 Chrome의 MSE byte stream에는 OGG 컨테이너가 없어 청크 append가 안 됩니다. PCM이면 `AudioBufferSourceNode`로 청크별 스케줄링이 깔끔하게 됩니다. 대역폭이 중요한 경우 `TTS_AUDIO_ENCODING=OGG_OPUS`로 바꾸고 클라이언트에 wasm Opus 디코더를 붙이면 됩니다.

## 디렉토리

```
.
├── server/         # TypeScript + Express, STT/AI/TTS provider 추상화
├── web/            # Vite + React + shadcn/ui, MediaSource 기반 청크 재생
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

`server/.env.example` 참고. 핵심:

| 항목 | 키 | 기본 |
|---|---|---|
| STT provider | `STT_PROVIDER` | `google` |
| STT 모델 | `STT_MODEL` | `latest_long` |
| STT 언어 | `STT_LANGUAGE` | `ko-KR` |
| AI provider | `AI_PROVIDER` | `openai` \| `anthropic` |
| AI 모델 | `AI_MODEL` | `gpt-4o-mini` 등 |
| AI 시스템 프롬프트 | `AI_SYSTEM_PROMPT` | (string) |
| OpenAI reasoning | `AI_OPENAI_REASONING` | `minimal/low/medium/high` (opt) |
| Anthropic 확장 사고 예산 | `AI_ANTHROPIC_THINKING_BUDGET` | tokens (opt) |
| TTS provider | `TTS_PROVIDER` | `google` |
| TTS 보이스 | `TTS_VOICE` | `ko-KR-Chirp3-HD-Achernar` |
| TTS 샘플레이트 | `TTS_SAMPLE_RATE_HERTZ` | `24000` |
| TTS 오디오 포맷 | `TTS_AUDIO_ENCODING` | `PCM` \| `OGG_OPUS` |
| 문장 분할 기호 | `SENTENCE_BOUNDARY_CHARS` | `.,!?;:\n。，！？；：` |

## 프로토콜

### `POST /api/chat` — 입력 업로드, 세션 시작

multipart/form-data 필드 중 최소 하나:
- `text`: string
- `audio`: file (`audio/webm;codecs=opus` 또는 `audio/ogg;codecs=opus`)

응답:
```json
{ "session_id": "uuid", "config": { "stt": {...}, "ai": {...}, "tts": {...} } }
```

### `GET /api/chat/:session_id` — SSE 스트림

이벤트:
- `stt` `{ text, source: "audio"|"text" }`
- `ai_delta` `{ text }`
- `ai_complete` `{ text }`
- `tts_start` `{ sentenceIdx, text }`
- `tts_chunk` `{ sentenceIdx, audio }` — base64로 인코딩된 오디오 바이트. 포맷은 `POST /api/chat` 응답의 `config.audio` 참고 (기본 PCM int16 LE 24kHz)
- `tts_end` `{ sentenceIdx }`
- `done` `{}`
- `error` `{ message }`

각 세션은 정확히 한 번만 구독될 수 있고, 구독된 직후부터 sse가 닫힐 때까지 위 이벤트가 흘러옵니다.

## 브라우저 호환성

기본(PCM) 포맷에서는 Web Audio API만 있으면 됩니다. Chrome / Edge / Firefox / Safari 모두 동작.
