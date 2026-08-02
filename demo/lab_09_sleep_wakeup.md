# 랩 09: Sleep & Wakeup (sleep과 wakeup을 통한 동기화)

- 원본: lab_09_sleep_wakeup.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: Busy waiting vs Block & Wakeup, 생산자/소비자 문제, xv6의 sleep()/wakeup() 구현, 응용 (sleeplock, pause, pipe)

## xv6가 커널 코드에 제공하는 Block & Wakeup

- `void sleep(void *chan, struct spinlock *lk)`: 현재 프로세스를 채널(channel)에서 잠들게 함. **잠들기 전에 락을 원자적으로 해제하고, 깨어날 때 재획득.**
- `void wakeup(void *chan)`: 그 채널에서 자고 있는 모든 프로세스를 깨움.

## 생산자/소비자 문제: Busy Waiting에서 Block & Wakeup까지

### 1단계: Busy Waiting 버전

```c
struct q { void *ptr; };

void* send(struct q *q, void *p) {
    while (q->ptr != 0);   // q가 빌 때까지 스핀
    q->ptr = p;
}
void* recv(struct q *q) {
    void *p;
    while ((p = q->ptr) == 0);   // q가 찰 때까지 스핀
    q->ptr = 0;
    return p;
}
```
- 동작은 하지만 너무 비쌈: 스핀하는 프로세스는 아무것도 안 하면서 CPU 시간만 낭비.

### 2단계: 단순 Sleep & Wakeup — Lost wake-up 문제

```c
void* send(struct q *q, void *p) {
    while (q->ptr != 0);
    q->ptr = p;
    wakeup(q);   /* recv 깨우기 */
}
void* recv(struct q *q) {
    void *p;
    while ((p = q->ptr) == 0)
        sleep(q);
    q->ptr = 0;
    return p;
}
```
- 소비자가 CPU를 낭비하지 않지만... **Lost wake-up 문제** 발생 가능:
  1. 소비자가 q가 빈 것을 확인하고 잠들려고 함.
  2. 소비자가 잠들기 전에, 생산자도 q가 빈 것을 확인.
  3. 생산자가 데이터를 q에 쓰고 wakeup 호출 — 그런데 소비자는 **아직 잠들지 않았음** (wakeup이 허공에 사라짐).
  4. 그 후 소비자가 잠듦 — q가 비어 있지 않은데도. (영원히 깨어나지 못할 수 있음.)
- 원인: **q의 상태 확인(212행)과 잠들기(213행)가 원자적이지 않기 때문.**

### 3단계: 스핀락 추가 — 그러나 교착상태

```c
struct q { struct spinlock lock; void *ptr; };

void* send(struct q *q, void *p) {
    acquire(&q->lock);
    while (q->ptr != 0);
    q->ptr = p;
    wakeup(q);
    release(&q->lock);
}
void* recv(struct q *q) {
    void *p;
    acquire(&q->lock);
    while ((p = q->ptr) == 0)
        sleep(q);           // 락을 쥔 채 잠듦!
    q->ptr = 0;
    release(&q->lock);
    return p;
}
```
- 상태 확인과 잠들기가 원자적이 되어 lost wake-up은 없어졌지만...
- 소비자가 q의 락을 쥔 채 잠들면: 생산자는 소비자가 락을 놓기를 기다리고, 소비자는 생산자가 깨워주길 기다림 → **교착상태(deadlock)**.

### 4단계: xv6 방식 — sleep(chan, lock)

```c
void* recv(struct q *q) {
    void *p;
    acquire(&q->lock);
    while ((p = q->ptr) == 0)
        sleep(q, &q->lock);   // 채널 q에서 잠들며 q의 락을 원자적으로 해제
    q->ptr = 0;
    release(&q->lock);
    return p;
}
```
- 소비자는 q 상태를 확인한 뒤, 채널 q에서 잠드는 것과 q 락 해제를 **원자적으로** 수행.
- 생산자는 락을 획득해 데이터를 쓰고 wakeup — 소비자는 깨어나자마자 락 재획득을 시도하는데 생산자가 아직 쥐고 있으므로, 생산자가 release한 후에야 락을 다시 얻고 데이터를 읽음. → 생산자/소비자 모델이 올바로 동작!

## xv6의 sleep() / wakeup() 구현 (kernel/proc.c)

### sleep()

```c
void sleep(void *chan, struct spinlock *lk) {
    struct proc *p = myproc();
    acquire(&p->lock);   // DOC: sleeplock1
    release(lk);         // 조건 락 해제 (p->lock을 쥔 상태라 wakeup과 race 없음)
    // 잠들기
    p->chan = chan;
    p->state = SLEEPING;
    sched();             // 스케줄러로 전환
    // (다른 프로세스가 RUNNABLE로 바꿔주고 scheduler()가 다시 선택하면 여기서 재개)
    // 정리
    p->chan = 0;
    // 원래 락 재획득
    release(&p->lock);
    acquire(lk);
}
```

### wakeup()

```c
void wakeup(void *chan) {
    struct proc *p;
    for (p = proc; p < &proc[NPROC]; p++) {
        if (p != myproc()) {
            acquire(&p->lock);
            if (p->state == SLEEPING && p->chan == chan) {
                p->state = RUNNABLE;
            }
            release(&p->lock);
        }
    }
}
```
- SLEEPING 프로세스의 상태를 RUNNABLE로 바꿔주기만 하면 깨우는 것 — 이후 scheduler()가 이 프로세스로 전환해 줄 수 있게 됨.

## xv6에서의 sleep & wakeup 응용

### sleeplock (kernel/sleeplock.c)

- 락 획득을 기다리는 동안 CPU를 양보(yield)할 수 있게 하는 락 — 디스크 I/O처럼 오래 걸리는 연산 동안 자원을 효율적으로 사용.
```c
void acquiresleep(struct sleeplock *lk) {
    acquire(&lk->lk);
    while (lk->locked) {
        sleep(lk, &lk->lk);
    }
    lk->locked = 1;
    lk->pid = myproc()->pid;
    release(&lk->lk);
}

void releasesleep(struct sleeplock *lk) {
    acquire(&lk->lk);
    lk->locked = 0;
    lk->pid = 0;
    wakeup(lk);
    release(&lk->lk);
}
```

### sleeplock vs spinlock 비교

| 특성 | Spinlock | Sleeplock |
|---|---|---|
| 대기 중 CPU 사용 | CPU를 양보하지 않음 (스핀) | CPU를 양보함 |
| 인터럽트 처리 | 보유 중 비활성화됨 | 활성 상태 유지 |
| 최적 용도 | 짧은 임계 구역 | 긴 연산 (예: 디스크 I/O) |
| 자원 효율 | 경합 중 CPU 사이클 낭비 | 경합 중 더 효율적인 CPU 사용 |

### pause 시스템 콜 (kernel/sysproc.c)

- pause()는 프로세스를 일정 시간 동안 잠들게 하는 시스템 콜:
```c
uint64 sys_pause(void) {
    int n; uint ticks0;
    argint(0, &n);
    if (n < 0) n = 0;
    acquire(&tickslock);
    ticks0 = ticks;
    while (ticks - ticks0 < n) {
        if (killed(myproc())) { release(&tickslock); return -1; }
        sleep(&ticks, &tickslock);   // ticks 채널에서 잠듦
    }
    release(&tickslock);
    return 0;
}
```
- 매 타이머 인터럽트마다 clockintr()이 ticks++ 후 `wakeup(&ticks)`를 호출 → pause 중인 프로세스가 깨어나 경과 시간을 확인하고, 아직이면 다시 잠듦.

### pipe (kernel/sysfile.c의 sys_pipe, kernel/pipe.c)

- pipe = 프로세스 간 데이터 전송용 통신 채널. 한 프로세스가 쓰고 다른 프로세스가 읽음. half-duplex (writer → reader 한 방향만).
- sys_pipe(): pipealloc으로 읽기/쓰기 file 구조체를 만들고, fdalloc으로 fd 두 개를 할당해 사용자 배열(fdarray)에 copyout.
- pipewrite() — 사용자 공간의 데이터를 파이프 버퍼에 씀 (생산자-소비자 모델 사용):
  - 파이프 버퍼가 가득 차면 (`pi->nwrite == pi->nread + PIPESIZE`): reader를 깨우고 (`wakeup(&pi->nread)`) writer는 nwrite 채널에서 잠듦 (`sleep(&pi->nwrite, &pi->lock)`).
  - 안 가득 찼으면 copyin으로 한 바이트씩 가져와 `pi->data[pi->nwrite++ % PIPESIZE] = ch;`로 기록.
  - 쓰기가 끝나면 reader를 깨움: `wakeup(&pi->nread)`.
- piperead() — 파이프 버퍼에서 최대 n바이트를 사용자 공간으로 읽음:
  - 버퍼가 비었고 writer가 아직 열려 있으면 reader는 nread 채널에서 잠듦 (`sleep(&pi->nread, &pi->lock)`).
  - 아니면 `ch = pi->data[pi->nread++ % PIPESIZE];`로 읽어 copyout.
  - 읽기가 끝나면 writer를 깨움: `wakeup(&pi->nwrite)`.
