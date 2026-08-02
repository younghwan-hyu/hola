# 강의 14: I/O Systems (입출력 시스템)

- 원본: lecture_14_IO_Systems.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교 (마지막 강의)

## I/O 하드웨어 (I/O Hardware)

- 매우 다양한 I/O 장치가 있지만 공통 개념:
  - Port (예: serial port)
  - Bus (daisy chain 또는 공유 직접 접근)
  - Controller (단순 칩 또는 host adapter라 불리는 별도 회로 보드)
- I/O 명령어가 장치를 제어. 컨트롤러는 데이터와 제어 신호를 위한 레지스터를 하나 이상 가짐.
- 프로세서가 컨트롤러에 명령·데이터를 주는 두 방식:
  - I/O 포트 주소에 대한 특수 I/O 명령어.
  - Memory-mapped I/O: 장치 제어 레지스터들이 프로세스의 주소 공간에 매핑됨. CPU는 표준 데이터 전송 명령어로 I/O 요청 실행.

### I/O 포트의 4가지 레지스터

- Status register: 호스트가 읽을 수 있는 비트들 (busy bit, error bit 등).
- Control register: 호스트가 명령 시작이나 장치 모드 변경을 위해 씀.
- Data-in register: 호스트가 입력을 얻기 위해 읽음.
- Data-out register: 호스트가 출력을 보내기 위해 씀.

## 폴링 (Polling)

- 장치 상태 판단: status register의 busy bit 확인.
- 장치 I/O를 busy-wait 사이클로 기다림. 컨트롤러와 장치가 빠르면 폴링도 합리적.
- 그러나 반복해서 시도해도 장치가 준비된 경우가 드물고 다른 유용한 CPU 작업이 밀려 있다면 폴링은 비효율적 → 이럴 땐 장치가 준비되었을 때 하드웨어 컨트롤러가 CPU에 알리게 하는 것이 나음: 인터럽트.

## 인터럽트 (Interrupts)

- CPU 하드웨어에는 interrupt-request line이라는 선이 있음. I/O 장치가 트리거하며, CPU는 매 명령어 실행 후 감지.
- 신호를 감지하면 CPU는 상태를 저장하고 메모리의 고정 주소에 있는 인터럽트 핸들러 루틴으로 점프.
- 인터럽트 핸들러: 인터럽트 원인을 판단하고 필요한 처리를 수행한 뒤 return-from-interrupt 명령어로 CPU를 이전 상태로 복귀.
- 두 개의 interrupt-request line:
  - Nonmaskable: 복구 불가능한 메모리 오류 같은 이벤트용으로 예약.
  - Maskable: 장치 컨트롤러가 사용. 중요한 명령어 시퀀스 전에 CPU가 끌 수 있음.
- Interrupt vector: 인터럽트를 올바른 핸들러로 디스패치.
- 인터럽트 메커니즘은 예외(exception)에도 사용됨: 0으로 나누기, 보호된 메모리 주소 접근 등.

## 응용 I/O 인터페이스 (Application I/O Interface)

- I/O 시스템 콜은 장치 동작을 제네릭 클래스들로 캡슐화해 I/O 장치를 표준적이고 균일한 방식으로 다루게 함.
- Device-driver 계층은 I/O 컨트롤러 간 차이를 커널로부터 숨김.
- 장치가 다른 차원들: character-stream vs block, sequential vs random-access, sharable vs dedicated, 동작 속도, read-write/read only/write only.

### 블록 장치와 문자 장치

- Block devices (예: 디스크 드라이브):
  - 명령: read, write, seek.
  - Raw I/O (예: 데이터베이스 시스템) 또는 파일 시스템 접근.
  - Memory-mapped 파일 접근 가능 — 데이터 전송이 demand-paged 가상 메모리 접근과 같은 메커니즘으로 처리됨.
- Character devices (예: 키보드, 마우스, 시리얼 포트):
  - 명령: get, put.
  - 데이터를 자발적으로 생성하는 입력 장치에 편리. 프린터·오디오 보드처럼 선형 바이트 스트림 개념에 맞는 출력 장치에도 좋음.

## Blocking / Non-blocking / Asynchronous I/O

- Blocking I/O: I/O가 완료될 때까지 프로세스 일시 중단 (run queue → wait queue로 이동). 사용과 이해가 쉬움.
- Non-blocking I/O: 가능한 만큼만 반환. 전송된(읽거나 쓴) 바이트 수를 나타내는 반환값과 함께 빠르게 리턴 (요청한 전부, 일부, 또는 0바이트).
- Asynchronous I/O: I/O가 실행되는 동안 프로세스는 계속 실행. 전송 전체가 수행되되 미래의 어느 시점에 완료되는 요청. 사용이 어려움. I/O 완료 시 I/O 서브시스템이 프로세스에 신호(signal).

## 커널 I/O 서브시스템 (Kernel I/O Subsystem)

- Scheduling: 장치별 큐로 I/O 요청 순서화. 공정하게 하려고 노력.
- Buffering: 장치 간 전송 중 데이터를 메모리에 저장.
  - 장치 속도 불일치 대응.
  - 장치 전송 크기 불일치 대응.
  - "copy semantics" 유지: "디스크에 기록되는 데이터 버전은 응용이 시스템 콜을 부른 시점의 버전임을 보장 — 이후 응용 버퍼가 바뀌어도 무관". 제어를 응용에 돌려주기 전에 응용 데이터를 커널 버퍼로 복사하고, 디스크 쓰기는 응용 버퍼가 아닌 커널 버퍼에서 수행.
- Caching: 성능의 핵심. 데이터 사본을 담는 빠른 메모리 영역. 항상 어딘가 다른 곳에 원본이 있는 사본 (buffer는 데이터의 유일한 사본을 담을 수 있다는 점과 대비).
- Spooling: 장치를 위한 출력 보관. 장치가 한 번에 하나의 요청만 서비스할 수 있을 때 (예: 프린팅).
- Error Handling: OS는 디스크 읽기 실패, 장치 사용 불가, 일시적 쓰기 실패로부터 복구 가능 — 사소한 문제마다 시스템 전체 장애가 되지 않도록. I/O 요청 실패 시 오류 번호/코드 반환. 시스템 오류 로그에 문제 보고 저장.
- Kernel Data Structures: 커널은 I/O 구성요소들의 상태 정보 유지 — open file table, 네트워크 연결, 문자 장치 상태 등. 버퍼, 메모리 할당, "dirty" 블록을 추적하는 많고 복잡한 자료구조.

## 성능 (Performance)

- I/O는 시스템 성능의 주요 요인:
  - 장치 드라이버·커널 I/O 코드 실행으로 CPU에 큰 부담.
  - 인터럽트로 인한 컨텍스트 스위치.
  - 데이터 복사.
  - 네트워크 트래픽이 특히 부담.
- I/O 성능 개선 방법:
  - 컨텍스트 스위치 수 감소.
  - 데이터 복사 감소.
  - 큰 전송이나 폴링으로 인터럽트 감소.
  - DMA 사용.
  - 최고 처리량을 위해 CPU·메모리·버스·I/O 성능의 균형.

## 과목 마무리

- "Operating System is… a collection of Cheating Schemes." (운영체제는 속임수 기법들의 모음이다) — 강의 0의 핵심 관점으로 마무리.
