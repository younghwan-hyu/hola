# 랩 12: Booting (부트로더에서 스케줄러까지)

- 원본: lab_12_booting.pdf
- 과목: 운영체제 실습, 한양대학교

## 도입

- 사용자 프로그램은 main()에서 시작하고, 프로세스는 부모의 fork()로 만들어진다는 것은 이미 안다.
- 그렇다면 xv6 커널의 진입점(entry point)은 어디이고, 첫 프로세스는 언제 만들어지는가?

## 복습: RISC-V의 3가지 특권 모드

- Machine Mode: CPU가 시작하는 모드. 물리 주소 공간 사용.
- Supervisor Mode: 특권 명령어 실행 가능. OS 커널이 실행되는 모드.
- User Mode: 사용자 프로세스가 실행되는 모드.

## 부트로더 (Boot Loader)

- RISC-V 컴퓨터의 전원이 켜지면 boot ROM에서 실행 시작 — 1단계 부트로더가 들어 있음.
- 부트로더는 xv6 커널을 물리 메모리 주소 **0x80000000**에 로드.
  - 낮은 메모리 영역(0x0 ~ 0x80000000)은 보통 I/O 장치용으로 예약되어 있어 피함.
- 이 초기 단계에는 페이징이 꺼져 있어 가상 주소 = 물리 주소.
- 우리 환경에서는 QEMU가 부트로더 역할을 함.

## 커널 초기화 (Kernel Initialization)

- 빌드가 끝나면 xv6 커널 바이너리가 생성됨. 커널 바이너리 구조는 kernel/kernel.ld의 섹션 정의를 따름 (.text, .data, .bss, .rodata 포함):
```
OUTPUT_ARCH( "riscv" )
ENTRY( _entry )
SECTIONS {
    . = 0x80000000;
    .text : { kernel/entry.o(_entry) ... }
    ...
    PROVIDE(end = .);
}
```
- 부트로더(QEMU)가 이 커널 바이너리를 물리 주소 0x80000000에 로드한 뒤, PC(program counter)를 0x80000000으로 설정 — kernel/entry.S에 정의된 _entry 심볼을 가리킴. 여기서 실행 시작.

## Boot Entry (kernel/entry.S)

```asm
.section .text
.global _entry
_entry:
    # ① C를 위한 스택 설정
    # stack0은 start.c에 선언, CPU(hart)당 4096바이트 스택
    # sp = stack0 + (hartid * 4096)
    la sp, stack0
    li a0, 1024*4
    csrr a1, mhartid
    addi a1, a1, 1
    mul a0, a0, a1
    add sp, sp, a0
    # ② start.c의 start()로 점프 (아직 Machine mode)
    call start
spin:
    j spin        # start()가 리턴하면 무한 루프 (fallback)
```
- 이 코드를 .text에 두고 _entry를 전역으로 노출해 kernel.ld가 진입점으로 쓸 수 있게 함.

## 시스템 초기화 (kernel/start.c)

- `stack0[4096 * NCPU]`: hart당 4KB의 커널 스택 (16바이트 정렬).
- start() 함수 (Machine mode에서 실행):
  1. **MPP = Supervisor**: mstatus의 M Previous Privilege 모드를 Supervisor로 설정 → 이후 mret이 S-mode로 전환하게 됨.
  2. **MEPC = main**: M Exception Program Counter를 main으로 설정 → mret이 main()으로 점프 (gcc -mcmodel=medany 필요).
  3. **페이징 비활성화**: `w_satp(0)` — supervisor 모드용 페이징은 나중에 설정.
  4. **트랩을 S-mode로 위임**: `w_medeleg(0xffff); w_mideleg(0xffff);` — 모든 인터럽트와 예외를 supervisor mode로 위임. `w_sie(...)`로 S-mode 인터럽트(SEIE, STIE, SSIE) 활성화.
  5. **PMP (Physical Memory Protection) 설정**: supervisor 모드가 전체 물리 메모리에 접근할 수 있게 허용 (`w_pmpaddr0(0x3fffffffffffffull); w_pmpcfg0(0xf);`).
  - timerinit(): 첫 타이머 인터럽트 예약.
  - 마지막으로 `asm volatile("mret")` 실행.
- **mret이 핵심 전환점**: 모드는 Machine → Supervisor (MPP에서), PC는 → main() (MEPC에서).

## 커널의 main 함수 (kernel/main.c)

- 커널은 main 함수에서 실행 시작. CPU 0이 모든 커널 서브시스템의 시스템 전역 초기화를 수행하고, 다른 CPU들은 초기화가 끝날 때까지 대기. 이후 모든 CPU가 scheduler()에 진입해 사용자 프로세스를 실행.
```c
void main() {
    if (cpuid() == 0) {
        printf("xv6 kernel is booting\n");
        kinit();             // 물리 페이지 할당자
        kvminit();           // 커널 페이지 테이블 생성
        kvminithart();       // 이 hart에서 페이징 켜기
        procinit();          // 프로세스 테이블
        trapinit();          // 트랩 벡터
        trapinithart();      // 이 hart의 트랩 벡터 설치
        plicinit();          // 인터럽트 컨트롤러
        plicinithart();      // 이 hart의 PLIC 설정
        binit();             // 버퍼 캐시
        iinit();             // inode 테이블
        fileinit();          // 파일 테이블
        virtio_disk_init();  // 에뮬레이트 디스크
        userinit();          // 첫 사용자 프로세스
        __sync_synchronize();
        started = 1;
    } else {
        while (started == 0)
            ;
        __sync_synchronize();
        printf("hart %d starting\n", cpuid());
        kvminithart();
        trapinithart();
        plicinithart();
    }
    scheduler();
}
```

### 부트 동기화: CPU 0 vs 나머지

- hart = Hardware Thread, CPU 코어의 실행 컨텍스트에 대한 RISC-V 용어. QEMU는 -smp N 옵션으로 N개의 hart를 생성하며, 모든 hart가 같은 main()을 독립적으로 실행.
- CPU 0이 전역 초기화를 수행하고 나머지는 대기: started는 CPU 0이 "초기화 완료"를 알리는 플래그. __sync_synchronize()는 메모리 배리어.
- 명명 규칙: xxxinit() → 한 번만 호출 (전역 상태), xxxinithart() → hart마다 호출 (hart-로컬 CSR을 건드림).

### 물리 페이지 초기화: kinit (kernel/kalloc.c)

```c
void kinit() {
    initlock(&kmem.lock, "kmem");
    freerange(end, (void*)PHYSTOP);
}
void freerange(void *pa_start, void *pa_end) {
    char *p = (char*)PGROUNDUP((uint64)pa_start);
    for (; p + PGSIZE <= (char*)pa_end; p += PGSIZE)
        kfree(p);
}
```
- 커널 이미지 끝(end)부터 PHYSTOP(0x88000000)까지의 범위가 freerange()를 통해 free list에 추가됨.

### 커널 페이지 테이블 초기화

- kvminit(): 커널 코드/데이터, 장치, trampoline의 직접 매핑으로 커널 페이지 테이블 구축 (내부적으로 kvmmake() 호출).
- kvminithart(): 이 hart에서 활성화 — satp 레지스터에 쓰고 sfence_vma()로 TLB 플러시.

### 프로세스 테이블 초기화: procinit (kernel/proc.c)

```c
void procinit() {
    struct proc *p;
    initlock(&pid_lock, "nextpid");
    initlock(&wait_lock, "wait_lock");
    for (p = proc; p < &proc[NPROC]; p++) {
        initlock(&p->lock, "proc");
        p->state = UNUSED;
        p->kstack = KSTACK((int)(p - proc));   // 커널 스택 시작 주소 부여
    }
}
```

### 트랩 초기화

- trapinit(): 시스템 타이머 tick 카운터(ticks)를 보호하는 스핀락 초기화 (`initlock(&tickslock, "time")`).
- trapinithart(): 현재 hart의 트랩 벡터 주소를 커널 트랩 핸들러로 설정 (`w_stvec((uint64)kernelvec)`). stvec 레지스터가 트랩 벡터 주소를 담고, 트랩 발생 시 CPU가 그 주소로 점프.

### 인터럽트 초기화 (kernel/plic.c)

- PLIC (Platform-Level Interrupt Controller): 외부 장치 인터럽트 관리.
- plicinit(): 장치별 IRQ(Interrupt request) 우선순위를 0이 아닌 값으로 설정 (시스템 전역) — UART0_IRQ, VIRTIO0_IRQ.
- plicinithart(): 이 hart가 받을 IRQ 활성화 (hart별).
- 이후 시스템은 UART와 디스크 인터럽트를 받을 수 있음.

### 파일 시스템 초기화

- binit(): 디스크 블록 데이터를 메모리에 임시 저장하는 버퍼(버퍼 캐시) 준비.
- iinit(): 메모리에서 inode(파일 메타데이터)를 관리하는 자료구조 초기화 — 디스크 상의 상태를 표현.
- fileinit(): 시스템의 모든 열린 파일을 추적하는 전역 파일 테이블 설정.
- virtio_disk_init(): QEMU 가상화 환경에서 사용하는 VirtIO 디스크 장치 초기화.

## 첫 프로세스 할당: userinit (kernel/proc.c)

- userinit()은 부팅 중 CPU 0이 한 번 호출. **직접 /init을 실행하지 않고 프로세스를 준비만 함**:
  1. allocproc()이 프로세스 테이블에 슬롯 예약.
  2. p->context.ra = forkret (allocproc 안에서 설정).
  3. p->state = RUNNABLE — 이제 스케줄링 대상이 됨.
```c
void userinit() {
    struct proc *p;
    p = allocproc();
    initproc = p;
    p->cwd = namei("/");
    p->state = RUNNABLE;
    release(&p->lock);
}
```

## /init이 실제로 시작되는 곳: forkret

- scheduler()가 RUNNABLE인 initproc을 골라 swtch()로 전환 → ra == forkret이므로 실행이 forkret()에 도달.
- forkret에서: 파일 시스템 초기화 (fsinit(ROOTDEV)) 후 `kexec("/init", ...)`이 프로세스 이미지를 /init으로 교체.
- `static int first`가 이 일회성 설정이 initproc이 처음 스케줄될 때만 실행되도록 보장 (fsinit은 디스크 I/O가 필요해 일반 커널 초기화 중에는 못 하고, 프로세스 컨텍스트에서 해야 함).

## init 프로세스 (user/init.c)

- init 프로세스의 main은 무한 루프에서 셸(sh)을 반복 실행:
  - fork()로 자식을 만들고, 자식은 exec("sh", argv)로 셸 실행.
  - 부모(initproc)는 wait()로 자식(sh)의 종료를 감시 — 셸이 종료하면 루프를 돌아 셸을 재시작.

## 스케줄러 시작

- 마지막으로 main이 scheduler()를 호출해 무한 프로세스 스케줄링 루프 시작 — RUNNABLE 프로세스를 찾아 CPU에 디스패치.
- 한 번 들어가면 커널은 이 지점에서 다시는 리턴하지 않음.
