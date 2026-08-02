# 랩 05: CPU Scheduling in xv6 (xv6의 스케줄러)

- 원본: lab_05_cpu_scheduling_in_xv6.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: 컨텍스트 스위치 개요, xv6의 스케줄링 (yield, sched, scheduler, swtch), 실습 과제

## CPU 가상화 (CPU virtualization)

- 현대 OS는 사용 가능한 프로세서 수보다 많은 프로세스를 동시에 실행하는 것을 지원.
- CPU 가상화 = 각 프로세스에게 자기만의 CPU가 있다는 환상을 제공하는 것.
- 일반적인 구현: 프로세스들을 하드웨어 프로세서에 멀티플렉싱(multiplexing, time-sharing).

## 프로세스 전환 (Switching Process)

- 멀티플렉싱은 각 프로세서를 한 프로세스에서 다른 프로세스로 자주 전환함으로써 달성.
- 전환이 일어나는 두 상황:
  - 주기적인 타이머 인터럽트가 전환을 강제 (프로세스가 CPU를 yield).
  - Sleep과 wakeup 메커니즘 (이후 랩에서 다룸).
- xv6에서는 타이머 인터럽트 핸들러가 투명하게 컨텍스트 스위치를 실행 — 여러 프로세스 간 시분할의 표준 메커니�즘.
- 컨텍스트 스위치에 관련된 프로세스들 간의 race를 피하려면 락(locking)이 필요.

## 컨텍스트 스위치 (Context Switch)

- 모든 프로세스는 실행을 위한 자기만의 커널 스택과 레지스터 집합을 가짐 — 이를 컨텍스트(context)라 함.
- 컨텍스트 스위치 = 이전 스레드의 컨텍스트를 저장하고 새 스레드의 이전에 저장된 컨텍스트를 복원하는 것.
- xv6에서 한 사용자 프로세스에서 다른 사용자 프로세스로의 전환은 컨텍스트 스위치 2번을 수반 (중간에 CPU의 스케줄러 코드로 전환).

### struct context (kernel/proc.h)

- 커널 컨텍스트 스위치를 위한 저장 레지스터 (trap 처리에 struct trapframe이 쓰이는 것과 유사).
- 컨텍스트 스위치도 제어 이전(control transference)이므로 레지스터를 저장·복원해야 함.
```c
struct context {
    uint64 ra;
    uint64 sp;
    // callee-saved
    uint64 s0;
    uint64 s1;
    ...
    uint64 s11;
};
```
- 비교: trap은 trapframe에 user 레지스터 저장/복원, context switch는 context에 kernel 레지스터 저장/복원.

### 컨텍스트 스위치 상세 (shell → cat 예)

1. Trap 발생 (타이머 인터럽트).
2. shell의 레지스터를 user mode에서 저장 (trapframe).
3. shell의 레지스터를 kernel mode에서 저장 (context).
4. 다음에 실행할 프로세스 선택 (스케줄러).
5. cat의 레지스터를 kernel mode에서 복원 (context).
6. cat의 레지스터를 user mode에서 복원 (trapframe) → cat 실행.

## xv6의 스케줄링 흐름

- 타이머 인터럽트에 의한 컨텍스트 스위치 전체 그림:
  - uservec → usertrap → devintr (타이머) → **yield → sched → swtch → scheduler → swtch** → (다른 프로세스의) usertrap 이후 → prepare_return → userret.

### 타이머 인터럽트 (Timer Interrupt)

- 클록 칩이 xv6에서 약 100ms마다 타이머 인터럽트를 생성 (이를 tick이라 함).
- 각 타이머 인터럽트는 clockintr()에서 전역 변수 ticks를 증가시킴:
```c
// kernel/trap.c
void clockintr() {
    if (cpuid() == 0) {
        acquire(&tickslock);
        ticks++;
        wakeup(&ticks);
        release(&tickslock);
    }
    w_stimecmp(r_time() + 1000000);   // 다음 타이머 인터럽트 예약
}
```
- devintr()에서 scause 값으로 분기: 0x8000000000000009L은 외부 장치 인터럽트, 0x8000000000000005L은 타이머 인터럽트 → clockintr() 호출 후 2 반환.

### yield (kernel/proc.c)

- CPU를 포기하려는 프로세스가 yield를 호출. usertrap()에서는 `if (which_dev == 2) yield();`, kerneltrap()에서도 `if (which_dev == 2 && myproc() != 0) yield();` — 타이머 인터럽트면 양보.
```c
void yield(void) {
    struct proc *p = myproc();
    acquire(&p->lock);
    p->state = RUNNABLE;
    sched();
    release(&p->lock);
}
```

### sched (kernel/proc.c)

- sched()는 4가지를 확인 (안 맞으면 panic): 프로세스 락을 잡고 있는지 (`holding(&p->lock)`), 다른 락을 안 잡고 있는지 (`mycpu()->noff != 1`), 프로세스가 RUNNING이 아닌지, 인터럽트가 비활성인지 (`intr_get()`).
```c
void sched(void) {
    int intena;
    struct proc *p = myproc();
    if (!holding(&p->lock)) panic("sched p->lock");
    if (mycpu()->noff != 1) panic("sched locks");
    if (p->state == RUNNING) panic("sched running");
    if (intr_get()) panic("sched interruptible");
    intena = mycpu()->intena;
    swtch(&p->context, &mycpu()->context);   // 스케줄러로 컨텍스트 스위치
    mycpu()->intena = intena;
}
```
- sched()가 swtch()를 부르면 스택 포인터와 명령어 주소가 CPU 스케줄러로 전환됨. sched와 scheduler는 각자 자기 커널 스택을 가짐.
- 주의: sched의 487~489행(intena 저장, swtch, intena 복원)은 순차적으로 실행되지 않음 — swtch에서 다른 곳으로 넘어갔다가 나중에 돌아옴. scheduler의 448, 449, 453행도 마찬가지.

### swtch (kernel/swtch.S)

- xv6의 컨텍스트 스위칭은 swtch() 함수로 구현. 인자 2개: struct context *old (a0), struct context *new (a1).
```asm
.globl swtch
swtch:
    sd ra, 0(a0)     # 1. 현재 프로세스의 상태(레지스터)를 old 컨텍스트에 저장
    sd sp, 8(a0)
    sd s0, 16(a0)
    ...
    sd s11, 104(a0)
    ld ra, 0(a1)     # 2. new 컨텍스트에서 레지스터 값 로드
    ld sp, 8(a1)
    ...
    ld s11, 104(a1)
    ret              # 3. ret 명령 실행 — ra(return address)를 따라 새 프로세스로 제어 이동
```

### scheduler (kernel/proc.c)

- xv6에서 커널 스레드는 항상 sched()에서 프로세서를 포기하고, 항상 scheduler의 같은 위치로 전환됨.
- scheduler는 무한 for 루프에서 RUNNABLE 프로세스를 찾아 반복적으로 전환:
```c
void scheduler(void) {
    for (;;) {
        for (p = proc; p < &proc[NPROC]; p++) {
            acquire(&p->lock);
            if (p->state == RUNNABLE) {
                p->state = RUNNING;
                c->proc = p;
                swtch(&c->context, &p->context);   // 프로세스로 컨텍스트 스위치
                c->proc = 0;
                found = 1;
            }
            release(&p->lock);
        }
    }
}
```

### xv6의 라운드 로빈 스케줄링

- xv6 스케줄러는 단순한 Round-Robin 정책: 매 tick마다 프로세스 배열에서 다음 RUNNABLE 프로세스로 전환. 배열 끝에 도달하면 처음으로 되돌아감(wrap around).

### 스케줄러의 락 (Locks in scheduler)

- yield에서 획득한 p->lock은 sched()의 swtch()를 통한 컨텍스트 스위치 후 scheduler 쪽에서 해제됨. 반대로 scheduler에서 acquire한 락은 전환된 프로세스의 yield 끝에서 해제됨 — 락의 획득과 해제가 서로 다른 스레드에서 일어나는 특이한 구조.

## Practice on Your Own (실습 과제)

### 브랜치 설정

```bash
cd <path_to_your_own_sandbox_repo>
git switch sandbox/base
git branch sandbox/lab05
git switch sandbox/lab05
```
- TA 코드는 xv6-sandbox 저장소의 sandbox/lab05 브랜치에 업로드됨.

### 실습 #1: 스케줄러 관찰 (Observing the Scheduler)

- 기본적인 디버깅 방법 하나는 변수를 그냥 출력해 의도한 값인지 확인하는 것.
- 스케줄러가 실행할 프로세스를 고를 때마다 현재 ticks 값, 그 프로세스의 pid와 이름을 콘솔에 출력하라.
- 무한 루프를 도는 사용자 프로그램(loop)을 만들어 실행하라.
- CPUS=1로 xv6 실행: `make qemu CPUS=1`
- 기대 출력:
```
$ loop
ticks: 1000, pid: 3, name: loop
ticks: 1001, pid: 3, name: loop
ticks: 1002, pid: 3, name: loop
...
```
- 변경 파일: Makefile, kernel/proc.c, user/loop.c (새 파일).
```bash
git add Makefile kernel/proc.c user/loop.c
git commit -m "feat: scheduler debug print + loop program"
```

### 실습 #2: 자발적 CPU 양보 (Voluntary CPU Yield)

- xv6에 yield는 구현되어 있지만 시스템 콜은 아님.
- 먼저 사용자도 부를 수 있게 yield 시스템 콜을 구현하라 (yield는 CPU를 포기).
- fork()로 자식 프로세스를 만드는 사용자 프로그램을 작성: 부모는 "Parent", 자식은 "Child"를 루프에서 출력.
- yield 시스템 콜 없이는 타이머 인터럽트에 의해서만 주기적으로 전환되어 Parent/Child가 여러 줄씩 묶여 나옴. 구현한 yield 시스템 콜을 쓰면 Parent, Child가 한 줄씩 번갈아 나오는 결과를 만들 것.
```
(yield 사용 전)          (yield 사용 후)
$ yieldtest              $ yieldtest
Parent                   Parent
Parent                   Child
Parent                   Parent
Child                    Child
Child                    Parent
...                      ...
```

### 제출

- 변경 파일: Makefile, kernel/syscall.c, kernel/syscall.h, kernel/sysproc.c, user/user.h, user/usys.pl, user/yieldtest.c (새 파일).
```bash
git add .
git commit -m "feat: add yield system call and test program"
git push origin sandbox/lab05
```
