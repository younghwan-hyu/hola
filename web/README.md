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
- **배경**: `src/lib/classroom.ts`가 도형·캔버스 텍스처만으로 대학 강의실(화이트보드·프로젝터
  스크린·전자교탁·긴 책상 등)을 만들고, `src/lib/backgrounds.ts`가 배경 id → 그룹 팩토리를 맡습니다. 설정 모달의 **배경**에서
  강의실/없음을 고르면 `Avatar`의 `background` prop으로 전달되어 씬 재생성 없이 그룹만 교체됩니다
  (선택은 `localStorage` `hola.background`).
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
- **판정 폴링**: 카메라가 켜져 있는 동안 `App.tsx`의 폴링 루프(`perceptionTickRef` +
  체크별 `setInterval`)가 서버에서 받아온 체크들을 각자의 주기로 독립적으로 돌립니다 —
  요청은 겹쳐도 되고 결과는 도착 순서대로 처리되며, 같은 체크의 직전 요청이 진행 중이면
  그 틱만 건너뜁니다(체크 목록 조회와 판정 API 호출은 `src/lib/perception.ts`, 요청
  타임아웃 8초). 음성 턴에는 `src/lib/voice.ts`가 녹음을 8kHz로 디코드해 톤 특징(RMS·
  피치 평균/변동)을 계산하고, 켜 둔 음성 체크 이름과 함께 `POST /api/chat`에 실어
  보냅니다(폴링 아님) — 서버가 그 턴에 판정을 붙이고 `perception` SSE 이벤트로 결과를
  알려 주면 모달의 "직전 응답" 문구가 갱신됩니다. 저해상도 프레임을 보내고 `signal`이 실려오면
  그 문장을 `hidden` 턴으로 대화 파이프라인에 넣어 아바타가 **먼저 말을 겁니다**
  (사용자 말풍선은 표시되지 않음). 하단 행의 **상황 인지 버튼** 모달에서 체크별로
  켜고 끌 수 있습니다. 체크는 켜져 있고 서버가 선언한 `requires`(현재 `"camera"`)가 모두
  충족될 때만 돌며, 모달은 항목마다 파란 "카메라 폴링"·"말할 때마다" 뱃지를 보여줍니다(켜져
  있는데 카메라가 꺼져 있으면 주황색). 서버가 `relative`로 표시한 체크에는
  회색 "상대적 측정" 뱃지가 더 붙습니다. 선택은 `localStorage`(`hola.perceptionDisabled`,
  `src/lib/settings.ts`)에 남습니다. 체크 종류에 대해 제네릭하므로 서버에 체크를 추가해도 이 코드는 그대로입니다
  (이름·설명·요구 조건·주기도 서버가 보내 모달에 자동으로 나타남).
  규약은 루트 `README.md`의 "판정 경로" 참고.

## 아바타 모델

기본 모델은 pixiv 공식 샘플 VRM(1.0)이 `public/girl.vrm`에 포함되어 있습니다
(`aa/ih/ou/ee/oh` 입모양 + 깜빡임 표정 보유, ~10MB). 두 번째 선택지로 VRoid 샘플
`public/Sakurada_Fumiriya.vrm`(VRM 0.x, CC0, ~19MB)이 함께 들어 있습니다.

화면에서 바로 바꿀 수 있습니다: 하단 바 확장 → 사람 아이콘 버튼 → **아바타 모달**에서
고르면 즉시 교체되고(기존 VRM은 `deepDispose`로 정리), 고른 모델은
`localStorage`(`hola.avatarUrl`)에 남아 새로고침해도 유지됩니다.

선택 목록은 **`public/avatars.json`** 한 파일이 전부이며, 앱이 **런타임에 fetch**합니다
(`src/lib/avatars.ts`). 빌드에 값이 박히지 않으므로 **모델 추가에 재빌드가 필요 없습니다** —
`.vrm`을 `public/`에 넣고 목록에 경로만 추가한 뒤 페이지를 새로고침하면 됩니다.

```json
["/girl.vrm", "/Sakurada_Fumiriya.vrm"]
```

- 첫 항목이 기본값이고, 메뉴 표시 이름은 **확장자를 뗀 파일명**입니다
  (`/girl.vrm` → `girl`). 표시 이름을 바꾸려면 파일명을 바꾸세요.
- 외부 URL도 넣을 수 있습니다(해당 origin의 CORS 허용 필요).
- 매니페스트가 없거나 깨져 있으면 경고를 남기고 `/girl.vrm`로 폴백하므로 아바타는
  항상 뜹니다.
- 컨테이너에서는 이미지에 구워지지만, 재빌드 없이 이 파일만 볼륨으로 덮어써도 됩니다:
  `-v ./avatars.json:/usr/share/nginx/html/avatars.json:ro`

> VRM 0.x / 1.0 모두 동작합니다. three-vrm가 VRM0의 `A/I/U/E/O` 블렌드셰이프를
> 1.0의 `aa/ih/ou/ee/oh` 프리셋으로 정규화하므로 립싱크 코드는 양쪽 모두에 통합니다.
> 입모양(viseme) 표정이 없는 모델은 입이 움직이지 않습니다.

## 에셋 출처 (크레딧)

- 기본 아바타 `public/girl.vrm` — pixiv 공식 샘플 VRM (1.0).
- 아바타 `public/Sakurada_Fumiriya.vrm` — VRoid Studio 샘플 모델, **CC0**
  ([madjin/vrm-samples](https://github.com/madjin/vrm-samples) `vroid/beta`).
- 해 모델 `public/sun.glb` (`show_sunny` 제스처) — **"Sun" by Poly by Google**,
  **CC-BY 3.0** ([Poly Pizza](https://poly.pizza/m/77wHkzwlpOq)). CC-BY는 출처 표기가
  필요하므로 새 에셋으로 교체하지 않는 한 이 크레딧을 유지하세요.

## 로컬 개발

```bash
# 저장소 루트에서. RAG용 db·embeddings 컨테이너는 루트 README의 "로컬 개발" 참고.
# 서버 먼저 (다른 터미널)
cd server && npm run dev             # :3000

cd web && npm install && npm run dev # :5173, /api는 :3000으로 프록시
```

## 빌드 / 배포

```bash
npm run build      # tsc -b && vite build → dist/
```

`Dockerfile`/`nginx.conf`로 컨테이너화됩니다(SPA 서빙 + `/api` 프록시 + SSE).
루트 `compose.yml`의 `web` 서비스가 이 디렉토리를 빌드합니다.
