# 강의 5: Process Synchronization 1 (프로세스 동기화 1)

- 원본: lecture_5_Process_Synchronization_1.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 배경 (Background)

- 공유 데이터에 대한 동시 접근(concurrent access)은 데이터 불일치(data inconsistency)를 초래할 수 있음.
- 데이터 일관성을 유지하려면 협력 프로세스들의 질서 있는 실행을 보장하는 메커니즘이 필요.
- 경쟁 조건 (Race condition): 여러 프로세스가 공유 데이터에 동시에 접근하고 조작하는 상황. 공유 데이터의 최종 값은 어느 프로세스가 마지막에 끝나는지에 따라 달라짐.
- 경쟁 조건을 막으려면 동시 실행 프로세스들은 반드시 동기화(synchronized)되어야 함.
- 경쟁 조건 예: 메모리에 X=2가 있을 때, P1이 X=X+1 (Load X,R1 → Inc R1 → Store X,R1), P2가 X=X−1 (Load X,R2 → Dec R2 → Store X,R2)을 동시에 수행하면, 명령어들이 인터리브(interleave)되는 방식에 따라 결과가 1, 2, 3 중 아무거나 될 수 있음.

## 임계 구역 문제 (The Critical-Section Problem)

- n개의 프로세스가 공유 데이터 사용을 놓고 경쟁. 각 프로세스에는 공유 데이터에 접근하는 코드 구간인 임계 구역(critical section)이 있음.
- 문제: 한 프로세스가 자기 임계 구역을 실행 중일 때, 다른 어떤 프로세스도 자기 임계 구역을 실행하지 못하도록 보장하는 것.

### 해법의 3가지 요구조건

1. 상호 배제 (Mutual Exclusion) — 동시 실행 방지: 프로세스 Pi가 임계 구역을 실행 중이면 다른 프로세스는 임계 구역을 실행할 수 없다.
2. 진행 (Progress) — 무한 연기 방지: 임계 구역을 실행 중인 프로세스가 없고 진입을 원하는 프로세스들이 있다면, 다음에 진입할 프로세스의 선택이 무한정 연기될 수 없다.
3. 한정 대기 (Bounded Waiting) — 과도한 블로킹 방지: 어떤 프로세스가 임계 구역 진입을 요청한 후 허가될 때까지, 다른 프로세스들이 임계 구역에 진입할 수 있는 횟수에 상한이 있어야 한다.
- 가정: 각 프로세스는 0이 아닌 속도로 실행. 프로세스 간 상대 속도에 대한 가정은 없음.

## 두 프로세스 해법의 시도 (P0, P1)

- 일반 구조: do { entry section → critical section → exit section → remainder section } while(1);

### 알고리즘 1 (turn 변수)

- 공유 변수: int turn (초기 0). turn == i일 때 Pi가 임계 구역 진입 가능.
- P0: `do { while (turn != 0); critical section; turn = 1; remainder } while(1);`
- 상호 배제는 만족하지만 진행(progress) 불만족: 교대(swap-turn)로만 실행 가능 — 한 프로세스가 임계 구역을 더 자주 실행해야 한다면 문제.

### 알고리즘 2 (flag 배열)

- 공유 변수: boolean flag[2], 초기 flag[i]=flag[j]=false. flag[i]==true는 "Pi가 임계 구역에 들어갈 준비됨".
- Pi: `do { flag[i] = true; while (flag[j]); critical section; flag[i] = false; remainder } while(1);`
- 상호 배제는 만족하지만 진행 불만족: flag[i]=flag[j]=true가 되면 둘 다 무한 대기.

### 알고리즘 3 (Peterson's Algorithm, 피터슨 알고리즘)

- 알고리즘 1과 2의 공유 변수를 결합.
- Pi: `do { flag[i] = true; /* 들어가려는 의도 */ turn = j; /* 상대 차례로 양보 */ while (flag[j] && turn == j); critical section; flag[i] = false; remainder } while(1);`
- 세 요구조건 모두 만족 — 두 프로세스의 임계 구역 문제 해결. 셋 이상 프로세스로 쉽게 확장 가능.
- 단점: Busy Waiting (기다리는 동안에도 CPU 사용).

## 락을 이용한 해법 (Locks)

- `do { acquire lock; critical section; release lock; remainder } while(TRUE);`
- 문제: 어떻게 한 순간에 하나의 프로세스만 락을 획득하도록 보장하는가?

## 동기화 하드웨어 (Synchronization Hardware)

- 많은 시스템이 임계 구역 코드를 위한 하드웨어 지원 제공.
- 단일 프로세서(uniprocessor): 인터럽트를 비활성화하면 현재 실행 코드가 선점 없이 실행됨. 그러나 멀티프로세서 시스템에서는 일반적으로 너무 비효율적 (확장성 없음).
- 현대 머신은 원자적(atomic = 인터럽트 불가능) 하드웨어 명령어 제공:
  - Test-and-Set: 메모리 워드를 검사하면서 값을 설정.
  - Swap: 두 메모리 워드의 내용을 교환.

### Test-and-Set

```c
boolean TestAndSet(boolean &target) {
    boolean rv = target;  /* 반환값 = 원래 값 */
    target = true;        /* target을 true로 설정 */
    return rv;
}
```
- Test-and-Set을 이용한 상호 배제: 공유 데이터 `boolean lock = false;`
- Pi: `do { while (TestAndSet(lock)); critical section; lock = false; remainder }`
- lock이 false였다면 반환값 false → 진입 (그리고 lock은 true가 됨). lock이 true였다면 반환값 true → 계속 대기.

### Swap

```c
void Swap(boolean &a, boolean &b) {
    boolean temp = a; a = b; b = temp;
}
```
- Swap을 이용한 상호 배제: 공유 데이터 `boolean lock;` (초기 false), 지역 변수 key.
- Pi: `do { key = true; while (key == true) Swap(lock, key); critical section; lock = false; remainder }`

## 세마포어 (Semaphores)

- 세마포어 S: 정수 변수. 두 개의 분리 불가능한(atomic) 연산으로만 접근 가능.
- P() : wait 함수 — `P(S): while (S <= 0) do no-op; S--;` (양수면 감소시키고 진입, 아니면 ++될 때까지 busy-wait).
- V() : signal 함수 — `V(S): S++;`

### 일반 동기화 도구로서의 세마포어

- 예: 두 프로세스, 두 임계 구역 A와 B. Pi에서 A가 실행된 후에만 Pj에서 B를 실행하고 싶을 때: 세마포어 S를 0으로 초기화.
  - Pi: A(C.S.); V(S) — 실행 완료를 알림(S++).
  - Pj: P(S) — S>0이 될 때까지 대기 후 B(C.S.) 진입 (S는 다시 0).
- 이런 식으로 쓰는 S는 이진 세마포어(binary semaphore) — 상호 배제에 사용.

### n개 프로세스의 임계 구역

- 공유 데이터: `semaphore mutex;` (초기 1 — 아무도 임계 구역에 없음을 의미)
- Pi: `do { P(mutex); critical section; V(mutex); remainder } while(1);`

### 세마포어 구현

- 같은 세마포어에 대해 두 프로세스가 동시에 wait()와 signal()을 실행할 수 없음을 보장해야 함 → 구현 자체가 임계 구역 문제가 됨 (wait/signal 코드를 임계 구역에 배치). 예를 들어 P()·V()에 대한 동시 접근을 피터슨 알고리즘으로 동기화할 수 있음.
- busy waiting 방식 P()의 특징: 구현 코드가 짧고, 임계 구역이 드물게 점유되면 busy waiting이 적음. 그러나 응용이 임계 구역에서 오랜 시간을 보내면 P()에서 오래 기다릴 수 있어 좋은 해법이 아님.

### Block / Wakeup 구현

- 여러 프로세스가 wait 함수에 들어가는 것을 허용. 세마포어를 레코드로 정의:
```c
typedef struct {
    int value;            /* 세마포어 값 */
    struct process *L;    /* 프로세스 대기 큐 */
} semaphore;
```
- 두 가지 기본 연산 가정:
  - block: 커널이 호출한 프로세스를 일시 중단(suspend). 그 프로세스의 PCB를 세마포어 대기 큐에 넣음.
  - wakeup(P): 블록된 프로세스 P의 실행 재개 (PCB를 ready queue로 이동).
- block/wakeup 버전의 P()와 V():
```c
P(S): S.value--;                 /* 진입 준비 — 일단 감소 */
      if (S.value < 0) {         /* 음수면 진입 불가 */
          add this process to S.L;
          block;
      }
V(S): S.value++;
      if (S.value <= 0) {        /* 절댓값 = 대기 큐 길이 */
          remove a process P from S.L;
          wakeup(P);
      }
```
- 이때 정수 세마포어의 음수 값의 절댓값 = 기다리는 프로세스 수. 프로세스 동기화에 사용.

## OS에서 임계 구역 문제가 발생하는 세 가지 경우

1. 인터럽트 핸들러 vs 커널: 커널 변수 count를 커널이 count++ 하는 중(read → inc → store)에 인터럽트 핸들러가 count-- 하면 race condition. 해결: 해당 구간에서 인터럽트 disable/enable.
2. 커널이 시스템 콜 수행 중 컨텍스트 스위치 발생: 두 프로세스의 주소 공간 사이에 공유 데이터가 없어도, 시스템 콜 수행 중에는 커널 데이터에 접근함. 커널 데이터 접근 중 CPU를 선점당하면 인터리브 실행 발생 가능. 해결: 커널 모드에서 실행 중일 때는 CPU를 선점하지 않음 — UNIX는 커널에서 나갈 때까지(시스템 콜이 끝날 때까지) 기다림.
3. 멀티프로세서 — 공유 메모리의 커널 데이터: 두 CPU가 각각 count++/count--를 수행하면 누가 마지막에 저장하느냐의 race condition. 인터럽트 en/disable로는 해결 불가. 해결: (a) 커널 전체를 하나의 큰 임계 구역으로 — 한 번에 한 CPU만 커널 진입, 또는 (b) 각 커널 공유 변수를 각각의 세마포어로 보호 — 커널이 여러 작은 임계 구역으로 구성됨.
