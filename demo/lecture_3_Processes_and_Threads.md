# 강의 3: Processes and Threads (프로세스와 스레드)

- 원본: lecture_3_Processes_and_Threads.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 프로세스 개념 (Process Concept)

- 프로세스 = 실행 중인 프로그램 (program in execution). 프로그램 실행은 순차적으로(sequential fashion) 진행되어야 함.
- 프로세스가 포함하는 것 (주소 공간 구성):
  - text section: 프로그램 코드.
  - stack: 함수 호출과 컨텍스트 스위치에 사용.
    - 함수 호출 시: 매개변수(parameter), 리턴 주소(return address), 지역 변수(local variables) 등을 저장.
    - 컨텍스트 스위치 시: PC(program counter)와 stack pointer를 포함한 레지스터 값들을 저장.
  - data section: 정적(static) 변수와 전역(global) 변수 저장.
  - heap section: 동적 할당을 위한 자유 메모리 풀(free memory pool).

## 프로세스 상태 (Process State)

- 프로세스는 실행되면서 상태가 바뀜:
  - new: 프로세스가 생성되는 중.
  - running: 명령어가 실행되는 중.
  - waiting: 어떤 이벤트 발생을 기다리는 중.
  - ready: 프로세서에 할당되기를 기다리는 중.
  - terminated: 실행을 마침.

## PCB (Process Control Block)

- 프로세스를 표현하는 커널 자료구조 (예: Linux의 task_struct). 포함 내용:
  - 프로세스 상태 (process state)
  - 프로그램 카운터 (program counter)
  - CPU 레지스터
  - CPU 스케줄링 정보
  - 메모리 관리 정보
  - 회계(accounting) 정보
  - I/O 상태 정보

## 프로세스 스케줄링 큐 (Process Scheduling Queues)

- Job queue: 시스템의 모든 프로세스 집합.
- Ready queue: 메인 메모리에 있으면서 실행 준비가 되어 기다리는 프로세스 집합.
- Device queues: I/O 장치를 기다리는 프로세스 집합.
- 프로세스는 여러 큐 사이를 이동(migration)함.

## 스케줄러 (Schedulers)

- Long-term scheduler (job scheduler): 어떤 프로세스를 ready queue로 가져올지 선택. 매우 드물게 호출(초·분 단위)되어 느려도 됨. 멀티프로그래밍의 정도(degree of multiprogramming)를 제어.
- Short-term scheduler (CPU scheduler): 다음에 실행할 프로세스를 선택하고 CPU 할당. 매우 자주 호출(밀리초 단위)되므로 빨라야 함.
- Medium-term scheduling도 추가될 수 있음 (스왑 관련).
- 프로세스 분류:
  - I/O-bound process: 계산보다 I/O에 더 많은 시간 소비. 짧은 CPU burst가 많음.
  - CPU-bound process: 계산에 더 많은 시간 소비. 매우 긴 CPU burst가 적게 있음.

## 컨텍스트 스위치 (Context Switch)

- CPU가 다른 프로세스로 전환할 때, 시스템은 이전 프로세스의 상태를 저장하고 새 프로세스의 저장된 상태를 로드해야 함.
- 프로세스의 컨텍스트는 PCB에 표현됨: 저장은 Registers → PCB, 복원은 PCB → Registers.
- 컨텍스트 스위치 시간은 순수 오버헤드: 주로 메모리 연산으로 구성되어 느리고, 전환 중에는 유용한 일을 하지 않음.
- 하드웨어 지원에 크게 좌우됨: Intel CPU는 컨텍스트 스위칭 HW 지원 (상태 저장/복원을 SW가 아닌 HW가 수행).
- 컨텍스트 스위칭은 캐시 플러시(cache flushing)를 동반 → 스위치 후 연속적인 캐시 미스 발생.

## 프로세스 생성 (Process Creation)

- 부모 프로세스가 자식 프로세스들을 만들고, 자식이 또 다른 프로세스를 만들어 프로세스 트리(tree) 형성.
- 프로세스는 pid (process identifier)로 식별·관리.
- 자원 공유의 세 가지 형태: (1) 부모와 자식이 모든 자원 공유, (2) 자식이 부모 자원의 부분집합 공유, (3) 부모와 자식이 자원을 공유하지 않음.
- 실행 형태: (1) 부모와 자식이 동시에(concurrently) 실행, (2) 부모가 자식 종료까지 대기(wait).
- 주소 공간: 자식은 부모의 복제본(duplicate). 이후 자식에 새 프로그램을 로드할 수 있음.
- UNIX 예: fork() 시스템 콜이 새 프로세스 생성. exec() 시스템 콜은 fork() 후에 프로세스의 메모리 공간을 새 프로그램으로 교체.
- 자식 프로세스의 시작 지점: fork() 후 자식은 부모와 정확히 같은 컨텍스트 값(PC, 레지스터, 메모리 정보, 열린 파일 정보 등)을 가짐. 따라서 부모와 자식 모두 같은 지점 — fork() 시스템 콜 직후, 반환값이 도착하기 전 — 부터 실행.
- fork()의 반환값: 자식 프로세스에게는 0, 부모 프로세스에게는 자식의 PID.
- 코드 예:
```c
int pid = fork();
if (pid < 0) { fprintf(stderr, "Fork Failed\n"); exit(-1); }
else if (pid == 0) { /* 자식 */ execlp("/bin/ls", "ls", NULL); }
else { /* 부모 */ wait(NULL); printf("Child Complete\n"); exit(0); }
```

## 프로세스 종료 (Process Termination)

- 프로세스가 마지막 문장을 실행하고 OS에 삭제를 요청 (exit). 자식의 출력 데이터가 부모에게 전달됨 (wait를 통해). 프로세스 자원은 OS가 회수.
- 부모가 자식 프로세스를 강제 종료(abort)할 수 있는 경우:
  - 자식이 할당된 자원을 초과 사용.
  - 자식에게 맡긴 작업이 더 이상 필요 없음.
  - 부모가 종료되는데 OS가 부모 종료 후 자식의 계속 실행을 허용하지 않는 경우 → 연쇄 종료 (cascading termination).

## 프로세스 간 통신 (IPC, Interprocess Communication)

- 프로세스는 독립적(independent)이거나 협력적(cooperating). 협력 프로세스는 데이터 공유를 포함해 서로 영향을 주고받음.
- 협력 이유: 정보 공유 (information sharing), 계산 가속 (computation speedup), 모듈성 (modularity), 편의성 (convenience).
- IPC의 두 모델: 공유 메모리 (shared memory), 메시지 전달 (message passing).

### 생산자-소비자 모델 (Producer-Consumer Model)

- 공유 메모리 기반 협력 프로세스의 패러다임: 생산자가 데이터를 생산해 공유 버퍼에 저장, 소비자가 소비.
- unbounded-buffer: 버퍼 크기에 실질적 제한 없음. bounded-buffer: 고정 버퍼 크기 가정.

### 메시지 전달 (Message Passing)

- 공유 변수 없이 프로세스들이 통신하고 동작을 동기화하는 메커니즘.
- 두 연산: send(message), receive(message). 메시지 크기는 고정 또는 가변.
- P와 Q가 통신하려면 통신 링크(communication link)를 설정하고 send/receive로 메시지 교환. 링크 구현은 물리적(공유 메모리, 하드웨어 버스) 또는 논리적.
- 동기화: 메시지 전달은 blocking(동기) 또는 non-blocking(비동기).
  - Blocking send: 메시지가 수신될 때까지 송신자 블록. Blocking receive: 메시지가 있을 때까지 수신자 블록.
  - Non-blocking send: 보내고 바로 계속. Non-blocking receive: 유효한 메시지 또는 null을 받음.

## 스레드 (Threads)

- 스레드(경량 프로세스, lightweight process)는 CPU 활용의 기본 단위. 구성: program counter, register set, stack space.
- 동료 스레드(peer threads)와 공유하는 것: code section, data section, 열린 파일·시그널 같은 OS 자원.
- 전통적(중량, heavyweight) 프로세스 = 스레드 1개짜리 태스크.
- 스레드의 장점:
  - 응답성 (Responsiveness): 일부가 블록되거나 긴 작업 중이어도 프로그램이 계속 실행 가능.
  - 자원 공유 (Resource Sharing): 같은 주소 공간 안에서 여러 활동 스레드.
  - 경제성 (Economy): 스레드 생성·컨텍스트 스위치가 프로세스보다 저렴.
  - 확장성 (Scalability): 각 스레드가 서로 다른 프로세서에서 병렬 실행 가능.

### 사용자 스레드 (User Threads)

- 사용자 수준 스레드 라이브러리가 스레드 생성·스케줄링·관리 수행. 커널 지원 없음. 생성·관리가 빠름.
- 단점: 단일 스레드 커널에서는 한 사용자 스레드가 blocking 시스템 콜을 하면 프로세스 전체가 블록됨 — OS가 그 프로세스 안의 다른 스레드 존재를 모르므로 CPU를 다른 프로세스에 할당.
- 예: POSIX Pthreads, Mach C-threads, Solaris threads.

### 커널 스레드 (Kernel Threads)

- 커널이 지원: 커널이 스레드 생성·스케줄링·관리 수행 → 사용자 스레드보다 느림.
- 장점: 블록되는 스레드가 프로세스 전체를 블록하지 않음. 멀티프로세서(MP) 머신에서 커널이 스레드들을 서로 다른 프로세서에 스케줄 가능.
- 예: Windows, Solaris, Tru64 UNIX, BeOS, Linux.

## 스레딩 이슈 (Threading Issues)

- fork()와 exec()의 의미론: 멀티스레드 프로그램의 한 스레드가 fork()하면 스레드를 몇 개 만들어야 하나?
  - Unix는 두 가지 버전의 fork() 제공 (전체 복제 / 호출 스레드만 복제).
  - exec()는 주소 공간 내용을 교체하므로 프로세스의 모든 스레드에 영향.
  - fork 직후 바로 exec()를 부른다면 모든 스레드를 복제할 필요 없음 (스레드 수는 새 프로그램이 결정). exec()를 부르지 않는다면 모든 스레드 복제.
- 스레드 취소 (Thread cancellation):
  - 비동기 취소 (Asynchronous cancellation): 대상 스레드를 즉시 종료. 자원 해제 문제, 공유 데이터 무결성 문제 발생 가능.
  - 지연 취소 (Deferred cancellation): 대상 스레드가 주기적으로 종료 여부를 확인해 질서 있게 스스로 종료할 기회를 가짐.
- 시그널 처리 (Signal Handling): UNIX에서 시그널은 특정 이벤트 발생을 프로세스에 알림. 처리 과정: (1) 특정 이벤트가 시그널 생성 → (2) 시그널이 프로세스에 전달 → (3) 시그널 처리.
  - 멀티스레드에서 전달 옵션: 해당되는 스레드에게만 / 프로세스의 모든 스레드에게 / 특정 스레드들에게 / 모든 시그널을 받는 전담 스레드 지정.
- 스레드 풀 (Thread pools): 요청 서비스가 더 빠르고, 동시에 존재하는 스레드 수를 제한.
- 스레드 고유 데이터 (Thread specific data): 각 스레드가 특정 데이터의 자기 복사본이 필요할 수 있음. 예: 트랜잭션 처리 — 트랜잭션마다 별도 스레드로 처리할 때, 모두 같은 코드(DB 트랜잭션 처리 코드)를 실행해도 스레드마다 고유 식별자 tid가 서로 달라야 함.

## 멀티코어 프로그래밍 (Multicore Programming)

- 멀티코어 시스템이 프로그래머에게 주는 도전 과제: 활동 나누기 (dividing activities), 균형 (balance), 데이터 분할 (data splitting), 데이터 의존성 (data dependency), 테스트와 디버깅 (testing and debugging).
