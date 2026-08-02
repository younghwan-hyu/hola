# 랩 06: Process Synchronization (xv6의 락)

- 원본: lab_06_process_synchronization.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: 락이 왜 필요한가, xv6의 락 구현 (원자적 연산, 락 중 인터럽트, 메모리 배리어), 락 사용 시 주의점, hands-on lab (FCFS 스케줄러 구현)

## 왜 락이 필요한가? (Why Lock?)

### 경쟁 조건 (Race Condition)

- 공유 데이터에 동시에 접근하는 코드는 잘못된 결과를 낼 가능성이 높음.
- 공유 자원에 접근하는 코드 구간을 임계 구역(critical section)이라 부름.
- xv6의 예 — kernel/proc.c의 allocpid():
```c
int allocpid() {
    int pid;
    pid = nextpid;
    nextpid = nextpid + 1;   // 두 CPU가 동시에 실행하면 같은 pid를 받을 수 있음
    return pid;
}
```

### 락이란? (What is Lock?)

- 락 = 상호 배제(mutual exclusion)를 강제하는 동기화 메커니즘.
- 한 번에 하나의 CPU만 임계 구역을 실행할 수 있음. 공유 데이터의 race condition을 방지.
- 락을 적용한 allocpid():
```c
acquire(&pid_lock);
pid = nextpid;
nextpid = nextpid + 1;
release(&pid_lock);
```

## xv6의 락 구현

### 스핀락 구조체 (kernel/spinlock.h)

```c
struct spinlock {
    uint locked;       // 락이 잡혀 있는가?
    // 디버깅용:
    char *name;        // 락 이름
    struct cpu *cpu;   // 락을 쥔 CPU
};
```

### 순진한(naïve) 구현의 문제: 원자적이지 않음

```c
void acquire(struct spinlock *lk) {
    for (;;) {
        if (lk->locked == 0) {   // (1) 검사
            lk->locked = 1;      // (2) 설정
            break;
        }
    }
}
```
- 두 CPU가 동시에 locked==0을 보고 둘 다 locked=1로 설정할 수 있음 → 둘 다 락 획득. (1)과 (2)는 원자적으로(atomically) 실행되어야 함.

### 원자적 명령어 (Atomic Instructions)

- 원자적 명령어: 옛 값을 읽고 새 값을 설정하는 것을 단일 연산으로 수행. 하드웨어가 다른 CPU의 끼어들기가 없음을 보장.
- `__sync_lock_test_and_set(&lk->locked, 1)` 의사 코드:
```c
int __sync_lock_test_and_set(int *addr, int newval) {
    int old = *addr;
    *addr = newval;
    return old;
}
```
- `__sync_lock_release(&lk->locked)` 의사 코드: `*addr = 0;`
- 실제 xv6의 acquire/release (kernel/spinlock.c):
```c
void acquire(struct spinlock *lk) {
    push_off();   // 인터럽트 비활성화 (교착 방지)
    if (holding(lk)) panic("acquire");
    while (__sync_lock_test_and_set(&lk->locked, 1) != 0)
        ;                     // 스핀 (원자적 test-and-set)
    __sync_synchronize();     // 메모리 배리어
    lk->cpu = mycpu();
}

void release(struct spinlock *lk) {
    if (!holding(lk)) panic("release");
    lk->cpu = 0;
    __sync_synchronize();     // 메모리 배리어
    __sync_lock_release(&lk->locked);
    pop_off();
}
```

### 락 보유 중 인터럽트 (Interrupt while Locking)

- 락을 쥔 채 인터럽트가 발생하면? 예: sys_pause()가 tickslock을 acquire한 상태에서 타이머 인터럽트가 발생하면 clockintr()도 tickslock을 acquire하려 함 → 같은 CPU가 자기가 쥔 락을 기다리며 영원히 스핀 (deadlock).
- 해결: acquire()에서 push_off()로 인터럽트를 끄고, release()에서 pop_off()로 복원.

### 중첩 임계 구역 (Nested Critical Section): push_off / pop_off

- xv6는 CPU가 스핀락을 하나도 쥐지 않을 때만 인터럽트를 다시 활성화.
- push_off()/pop_off()가 중첩 수준(nesting level)을 추적:
```c
void push_off(void) {
    int old = intr_get();
    intr_off();
    if (mycpu()->noff == 0)
        mycpu()->intena = old;   // 최초 push 시점의 인터럽트 상태 기억
    mycpu()->noff += 1;
}

void pop_off(void) {
    struct cpu *c = mycpu();
    if (intr_get()) panic("pop_off - interruptible");
    if (c->noff < 1) panic("pop_off");
    c->noff -= 1;
    if (c->noff == 0 && c->intena)
        intr_on();   // 모든 락을 놓았을 때만 인터럽트 복원
}
```

### 메모리 순서 (Memory Ordering)와 메모리 배리어

- 문제: 컴파일러와 프로세서는 성능을 위해 명령어를 순서를 바꿔(out of order) 실행할 수 있음.
- 예: Processor #1이 `while (f == 0); print x;`, Processor #2가 `x = 42; f = 1;`일 때 — 4행과 5행 사이에 의존성이 없으므로 CPU/컴파일러가 `f = 1;`을 `x = 42;`보다 먼저 실행하도록 재배열할 수 있음 → print가 42가 아닌 쓰레기 값을 출력할 수 있음.
- 해결: xv6는 acquire와 release 양쪽에서 `__sync_synchronize()`를 사용.
- `__sync_synchronize()`는 메모리 배리어(memory barrier): 컴파일러와 CPU에게 배리어를 넘어 load/store를 재배열하지 말라고 지시.

### 요약: xv6 락 구현의 3요소

| # | 구성요소 | 이유 |
|---|---|---|
| 1 | 원자적 연산 (__sync_lock_test_and_set / __sync_lock_release) | 두 CPU가 동시에 락을 획득하는 것을 방지 |
| 2 | 인터럽트 비활성화 (push_off / pop_off) | 커널 트랩 처리 중 무한 대기(deadlock) 방지 |
| 3 | 메모리 배리어 (__sync_synchronize) | 락 경계를 넘는 명령어 재배열 방지 |

## 락 사용 시 핵심 주의점 (Key Considerations)

### 스케줄러의 락 (복습)

- xv6 스케줄링에서 p->lock은 yield()에서 acquire되고 scheduler()에서 release됨 — 한 컨텍스트에서 획득한 락이 (swtch를 건너) 다른 컨텍스트에서 해제됨.

### 여러 락 사용 시 주의: 락 순서와 교착상태

- 두 코드 경로가 락 A와 B를 필요로 할 때, CPU1이 function1 (A 획득 → B 대기), CPU2가 function2 (B 획득 → A 대기)를 동시에 실행하면:
  - function1은 A를 쥐고 B를 기다리고, function2는 B를 쥐고 A를 기다림 → 순환 대기 (circular wait) → 둘 다 진행 불가 = 교착상태 (Deadlock)!
- 해결: 모든 코드 경로가 같은 순서로 락을 획득해야 함 (둘 다 A → B 순서로).
- xv6는 교착 방지를 위해 전역 락 획득 순서(global lock acquisition order)를 유지:
  - consoleintr: cons.lock → process lock
  - 파일 생성: directory → inode → disk block → vdisk_lock → process lock

### 단일 프로세서 시스템에서도 락이 필요한가?

- YES. 단일 프로세서(uniprocessor)에서도 인터럽트 구동 컨텍스트 스위치를 통해 race condition이 발생할 수 있음.
- 예: kkill()이 p->lock 없이 프로세스 상태를 바꾸는 도중 타이머 인터럽트로 다른 프로세스로 전환되면, 두 실행 흐름이 같은 프로세스 구조체를 동시에 조작하는 셈 → race condition.
- 따라서 (인터럽트 비활성화를 동반한) 락이 여전히 필요.

## Hands-on Lab: FCFS 스케줄러 구현

### 브랜치 설정

```bash
cd <path_to_your_own_sandbox_repo>
git switch sandbox/base
git branch sandbox/lab06
git switch sandbox/lab06
```
- TA 코드는 다음 주말에 xv6-riscv-sandbox 저장소에 업로드됨.

### 목표

- xv6의 기본 Round Robin 스케줄러를 First-Come, First-Served (FCFS) 스케줄러로 교체하고 테스트 코드를 통과시키기.

### FCFS용 사용자 테스트

- 전체 테스트 코드는 제공된 링크에서 확인. user/usertests.c에 fcfs_test1, fcfs_test2 추가:
  - fcfs_test1: N개의 자식을 fork. 각 자식은 RUN_CNT 동안 돌며 STEP_CNT마다 자기 문자('a'+n)를 출력 후 종료. FCFS라면 먼저 생성된 프로세스가 끝날 때까지 다음 프로세스가 실행되지 않아 aaa...\nbbb...\nccc... 처럼 문자가 섞이지 않고 나옴.
  - fcfs_test2: 각 자식이 YEILD_CNT회 반복하며 출력 후 pause(10)을 호출 — sleep에서 깨어난 프로세스들이 다시 큐 뒤에 붙는 동작까지 검증.

### FCFS를 위한 자료구조: 원형 큐 (Circular Queue)

- FCFS 스케줄러 구현에는 Queue 자료구조가 필요. 전체 구현 코드는 제공된 링크에서 확인.
- kernel/queue.h:
```c
struct queue {
    struct spinlock lock;
    int head;
    int tail;
    void *data[MAX_QUEUE_SIZE + 1];
};
```
- kernel/defs.h에 선언 (queue.c):
```c
void queue_init(struct queue *);
int queue_push(struct queue *, void *);
void *queue_peek(struct queue *);
void *queue_pop(struct queue *);
int queue_size(struct queue *);
```
- 이 큐 구현을 사용해 kernel/proc.c의 스케줄러 코드를 수정할 것.

### 제출

- 변경 파일: Makefile, kernel/defs.h, kernel/proc.c, user/usertests.c, kernel/queue.c (새 파일), kernel/queue.h (새 파일).
```bash
git add .
git commit -m "lab06: implement FCFS scheduling"
git push origin sandbox/lab06
```
