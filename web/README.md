# web

three.js + [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) 기반 프론트엔드.
화면 중앙의 **VRM 아바타**가 TTS 응답에 맞춰 **입을 움직이고**, 텍스트/음성으로
대화합니다. 서버 프로토콜은 `POST /api/chat` → `GET /api/chat/:id` (SSE)입니다.

```
TTS PCM 청크 ──appendPcm──▶ StreamingPcmPlayer
                              │  source ─▶ AnalyserNode ─▶ destination
                              │                  │
                              ▼                  ▼ getLevel() (RMS)
                          스피커 재생        Avatar 렌더 루프
                                                 │  오디오 감지 → 입 계속 여닫기(flap)
                                                 ▼
                              vrm.expressionManager.setValue("aa", 0..1)  → 입 벌림
```

## 동작 방식

- **아바타**: `src/components/Avatar.tsx` — 단일 `<div>`에 three.js `WebGLRenderer`,
  `PerspectiveCamera`, `OrbitControls`(드래그 회전/줌), 3점 조명, `requestAnimationFrame`
  렌더 루프. `vrm.update(delta)`로 스프링본/표정/시선을 매 프레임 갱신.
- **립싱크**: `StreamingPcmPlayer`가 모든 오디오 소스를 공유 `AnalyserNode`로
  통과시킵니다(`src/lib/audio.ts`). 렌더 루프가 `getLevel()`(RMS)로 말하는 중인지
  감지해, 말하는 동안 입(`aa`)을 서로 다른 두 주파수로 **계속 여닫습니다**(정확한 음량/
  모음 모양은 구분하지 않음). 상수는 `Avatar.tsx` 상단(`MOUTH_*`)에서 조정.
- **기본 자세**: VRM은 T-포즈로 로드되므로, `setRelaxedPose`(`src/lib/vrm.ts`)가
  휴머노이드 팔 본을 회전시켜 팔을 내린 자연스러운 **서 있는 포즈**로 바꿉니다.
- **부가 모션**: 랜덤 눈 깜빡임(`blink`), 카메라를 향한 시선(`lookAt`), 미세한 좌우 흔들림.
- **제스처**: 하단 바의 웃는 얼굴 버튼 → 모달에서 `기쁜 표정`/`슬픈 표정`/`손 흔들기`/`맑은 날씨` 선택.
  Avatar가 `forwardRef`로 노출하는 `playGesture()`를 호출하면 렌더 루프가 표정
  프리셋(`happy`/`sad`), 오른팔 본 애니메이션(손 흔들기), 또는 빛나는 해 GLB 등장
  (`맑은 날씨` = `show_sunny`)을 재생합니다. 제스처 목록·라벨·아이콘·길이는
  **`src/lib/gestures.ts`(단일 소스)** 에 정의되고, 모션 상수는 `Avatar.tsx` 상단
  (`WAVE_*`, `SUN_*`)에서 조정합니다.
- **AI 트리거 제스처**: 서버가 AI 응답 속 `{gesture=NAME}` 커맨드를 파싱해 SSE `gesture`
  이벤트로 보내면, `App.tsx`가 받아서(이름은 `isAvatarGesture`로 검증) 같은
  `playGesture()`로 재생합니다. 규약은 루트 `README.md`의 "제스처 커맨드" 참고.
- **입력**: 하단 바의 텍스트 입력(Enter 전송, Shift+Enter 줄바꿈, 한글 IME 대응)과
  마이크 녹음(`src/components/Recorder.tsx`).

## 아바타 모델

기본 모델은 pixiv 공식 샘플 VRM(1.0)이 `public/avatar.vrm`에 포함되어 있습니다
(`aa/ih/ou/ee/oh` 입모양 + 깜빡임 표정 보유, ~10MB).

다른 모델로 바꾸려면:

- `public/avatar.vrm`을 교체하거나,
- 환경변수 `VITE_AVATAR_URL`로 다른 `.vrm` 경로/URL 지정.

```bash
VITE_AVATAR_URL=/my-avatar.vrm npm run dev
```

> VRM 0.x / 1.0 모두 동작합니다. three-vrm가 VRM0의 `A/I/U/E/O` 블렌드셰이프를
> 1.0의 `aa/ih/ou/ee/oh` 프리셋으로 정규화하므로 립싱크 코드는 양쪽 모두에 통합니다.
> 입모양(viseme) 표정이 없는 모델은 입이 움직이지 않습니다.

## 에셋 출처 (크레딧)

- 기본 아바타 `public/avatar.vrm` — pixiv 공식 샘플 VRM (1.0).
- 해 모델 `public/sun.glb` (`show_sunny` 제스처) — **"Sun" by Poly by Google**,
  **CC-BY 3.0** ([Poly Pizza](https://poly.pizza/m/77wHkzwlpOq)). CC-BY는 출처 표기가
  필요하므로 새 에셋으로 교체하지 않는 한 이 크레딧을 유지하세요.

## 로컬 개발

```bash
# 서버 먼저 (다른 터미널)
cd ../server && npm run dev          # :3000

cd web && npm install && npm run dev # :5173, /api는 :3000으로 프록시
```

## 빌드 / 배포

```bash
npm run build      # tsc -b && vite build → dist/
```

`Dockerfile`/`nginx.conf`로 컨테이너화됩니다(SPA 서빙 + `/api` 프록시 + SSE).
루트 `compose.yml`의 `web` 서비스가 이 디렉토리를 빌드합니다.
