# 강의 1: Computer System Overview (컴퓨터 시스템 개요)

- 원본: lecture_1_Computer_System_Overview.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 컴퓨터 시스템의 기본 요소 (Basic Elements)

- Processor (CPU), Main Memory (휘발성, real memory 또는 primary memory라고 부름), System bus (프로세서·메모리·I/O 모듈 간 통신), I/O modules (보조기억장치, 통신장비, 터미널 등).

## 프로세서 레지스터 (Processor Registers)

- 데이터 I/O용 레지스터:
  - MAR (Memory Address Register): 다음 읽기(LOAD)/쓰기(STORE)의 메모리 주소를 지정.
  - MBR (Memory Buffer Register): 메모리에 쓸 데이터(STORE) 또는 메모리에서 읽은 데이터(LOAD)를 담음.
  - I/O address register, I/O buffer register.
- 제어·상태 레지스터 (Control and Status Registers):
  - PC (Program Counter): 다음에 fetch할 명령어의 주소.
  - IR (Instruction Register): 가장 최근 fetch된 명령어.
  - PSW (Program Status Word): condition code (양수/음수/0/overflow 등 조건 분기용 비트), 인터럽트 enable/disable 비트, supervisor/user 모드 비트 포함.
- 사용자 가시 레지스터 (User-visible registers): 프로그래머가 레지스터 활용을 최적화해 메모리 참조를 최소화할 수 있게 함.

## 명령어 실행 (Instruction Execution)

- 두 단계: 메모리에서 명령어를 읽는 Fetch → 명령어 실행(Execute). PC는 fetch마다 증가.
- 명령어 종류 (IR 기준): processor-memory (데이터 전송), processor-I/O, data processing (산술/논리 연산), control (실행 순서 변경).

## 인터럽트 (Interrupt)

- 프로세서의 정상 실행 순서를 중단시키는 메커니즘. 대부분의 I/O 장치는 프로세서보다 느리므로, 인터럽트가 없으면 프로세서가 장치를 기다리며 낭비됨.
- 인터럽트 핸들러 (Interrupt handler): 특정 I/O 장치를 처리하는 프로그램, 보통 OS의 일부.
- 멀티프로그래밍 (Multiprogramming): 인터럽트만으로는 프로세서 활용이 비효율적일 수 있어, 프로세서가 여러 프로그램을 가지고 우선순위와 I/O 대기 여부에 따라 번갈아 실행. 인터럽트 핸들러 종료 후 제어가 인터럽트 시점의 프로그램으로 돌아가지 않을 수 있음.

## 메모리 계층 (Memory Hierarchy)

- 계층 위로 갈수록: 접근 속도 빠름, 용량 작음, 비트당 비용 높음. 아래로 갈수록 반대. 프로세서의 접근 빈도는 아래로 갈수록 감소 — 참조 지역성 (locality of reference) 때문.

## 캐시 메모리 (Cache Memory)

- 프로세서 실행 속도가 메모리 사이클 시간에 제한되는 문제를, 지역성 원리를 이용해 프로세서와 메인 메모리 사이에 작고 빠른 메모리(캐시)를 둠으로써 해결.
- 동작: 프로세서가 먼저 캐시 확인 → 없으면 해당 메모리 블록을 캐시로 가져오고 프로세서에 전달.
- 캐시 설계 요소:
  - Cache size: 작은 캐시도 성능에 큰 영향.
  - Block size: 캐시-메모리 간 교환 단위. 블록이 커지면 hit ratio가 오르다가, 새로 가져온 데이터의 사용 확률이 밀려나는 데이터 재사용 확률보다 낮아지면 감소.
  - Mapping function: 블록이 들어갈 캐시 위치 결정 — direct mapping, associative mapping, set-associative mapping.
  - Replacement algorithm: 교체할 블록 결정 — LRU (Least-Recently-Used).
  - Write policy: write-through (블록 갱신 시마다 메모리에 씀) vs writeback (블록 교체 시에만 씀 — 메모리 쓰기 최소화하지만 메인 메모리가 구식 상태가 됨). 멀티코어/멀티프로세서에서는 cache coherence(캐시 일관성) 문제 발생.
- (선택) Non-Temporal LOAD/STORE 명령어: 순차 접근되는 대용량 데이터(배열 순회, DB 테이블 스캔, 멀티미디어 파일)가 캐시 전체를 밀어내는 sequential flooding을 막기 위해 캐시를 우회(cache bypass)하는 명령어.

## 디스크 캐시 (Disk Cache)

- 메인 메모리 일부를 디스크 데이터의 버퍼로 사용. 느린 디스크 대신 빠르게 데이터 제공, 디스크 쓰기를 모아서 처리(clustered).

## 컴퓨터 시스템 구성과 I/O 기법

- 하나 이상의 CPU와 장치 컨트롤러(device controller)들이 공용 버스로 공유 메모리에 접근. CPU와 장치는 동시 실행되며 메모리 사이클을 두고 경쟁.
- 각 장치 컨트롤러는 특정 장치 유형 담당, 로컬 버퍼 보유. I/O 장치는 메인 메모리에 직접 접근할 수 없고, CPU가 로컬 버퍼와 메인 메모리 사이에서 데이터를 옮김. 컨트롤러는 작업 완료를 인터럽트로 CPU에 알림.
- I/O 세 가지 방식:
  1. Programmed I/O: I/O 모듈이 작업 수행, 인터럽트 없음. 프로세서가 완료될 때까지 상태 레지스터를 반복 확인 (polling/busy-waiting).
  2. Interrupt-Driven I/O: I/O 모듈이 준비되면 프로세서에 인터럽트. 불필요한 대기는 없지만 읽고 쓰는 모든 워드가 프로세서를 거치므로 여전히 프로세서 시간 소모 큼.
  3. DMA (Direct Memory Access): I/O 교환이 메모리와 직접 일어남. 프로세서가 I/O 모듈에 메모리 읽기/쓰기 권한을 부여하고, 블록 단위 전송이 끝나면 인터럽트 한 번만 발생. 프로세서는 그동안 다른 일 수행.

## 부팅 (Computer Startup)

- Bootstrap program: 전원 인가/재부팅 시 로드됨. 보통 ROM 또는 EPROM에 저장 (펌웨어, firmware). 시스템 전반 초기화 후 OS 커널을 로드하고 실행 시작.
