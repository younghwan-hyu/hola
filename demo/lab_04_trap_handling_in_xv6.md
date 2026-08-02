# 랩 04: Trap Handling in xv6 (xv6의 트랩 처리)

- 원본: lab_04_trap_handling_in_xv6.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: 트랩 개요, 트랩 처리의 핵심 구성요소, User Space 트랩 처리 순서, Kernel Space 트랩 처리 순서

## 트랩 개요 (Trap in xv6)

- xv6에서 trap = 특별한 이벤트를 처리하기 위한 정상 프로그램 실행의 일시 정지.
- 이론 수업에서 배운 것과 약간 다름: xv6에서 'trap'은 trap, interrupt, exception을 모두 포괄하는 상위 개념.
- 트랩의 3가지 주요 원인:
  1. System call: 사용자 프로그램이 커널 서비스를 쓰려 할 때 호출하는 함수. 예: read(), write(), fork(), ps() 등.
  2. Exception: 사용자 프로그램 안에서 발생한 불법적/예기치 않은 동작. 예: 0으로 나누기, 잘못된 가상 주소 사용.
  3. Interrupt: 하드웨어 장치로부터의 비동기 알림. 예: 디스크가 읽기/쓰기 요청을 완료, 타이머 인터럽트.
- 트랩 처리 중 OS가 해야 하는 일:
  1. 현재 프로세서의 레지스터 저장.
  2. 커널 실행 준비.
  3. 이벤트에 대한 정보 조회.
  4. 사용자와 커널 간 격리(isolation) 유지.
- xv6는 트랩이 user mode에서 발생했는지 kernel mode에서 발생했는지에 따라 다른 트랩 핸들러 사용:
  - user mode: kernel/trampoline.S의 uservec.
  - kernel mode: kernel/kernelvec.S의 kernelvec.

## 핵심 구성요소: RISC-V 특권 모드와 CSR

### RISC-V의 3가지 특권 모드

- Machine Mode: CPU가 시작하는 모드.
- Supervisor Mode: 특권 명령어 실행 허용. OS 커널이 이 모드에서 실행.
- User Mode: 사용자 프로세스가 실행되는 모드.

### CSR (Control and Status Register)

프로세서 동작 설정과 시스템 상태 모니터링을 위한 특수 목적 레지스터:

- stvec: 트랩 핸들러 주소 보관. 트랩 발생 시 CPU가 이 주소로 점프.
- sepc: 트랩 시점의 program counter 저장. 트랩 처리 후 이 주소로 실행 재개 가능.
- scause: 트랩 원인 코드 저장. 무엇이 트랩을 일으켰는지 식별.
- sstatus: CPU의 이전 상태 기억과 인터럽트 처리 설정을 3개 비트로 관리:
  - SPP: CPU의 이전 상태가 user인지 supervisor인지 기록.
  - SIE: 커널이 지금 외부 인터럽트를 받을지 막을지 결정.
  - SPIE: 트랩 직전의 SIE 상태를 그대로 백업.
- sscratch: 트랩 핸들러용 임시 저장소. 사용자 레지스터를 TRAPFRAME에 안전하게 저장하도록 도움.

### TRAPFRAME

- 트랩 처리에 필요한 데이터를 저장하도록 미리 지정된 메모리 영역.
  - 트랩 전환(trap transition) 중 필요한 커널 데이터 보관.
  - 트랩 처리 중 사용자 레지스터(CPU 상태)의 백업 영역 역할.
- 모든 프로세스마다 정확히 한 페이지(4096바이트)가 할당됨.
- kernel/proc.h에 struct trapframe으로 정의되어 접근이 쉬움.
- TRAPFRAME의 트랩 전환용 필수 데이터 (오프셋):
  - kernel_satp (0): 커널 페이지 테이블 주소.
  - kernel_sp (8): 프로세스의 커널 스택 top 주소.
  - kernel_trap (16): usertrap() 함수의 주소.
  - epc (24): 나중에 돌아갈 프로세스의 program counter.
  - kernel_hartid (32): 프로세스를 실행 중인 CPU 코어 ID (hart ID).
- TRAPFRAME의 사용자 레지스터 백업 영역:
  - general registers (40~): 현재 사용 중인 레지스터 값 — ra, sp, gp, tp, t0~t2.
  - callee-saved registers (96~): 호출된 함수가 쓰는 레지스터 — s0~s11, a0~a7.
  - temporary registers (256~280): 트랩 발생 시 쓰던 임시 레지스터 — t3~t6.

## User Space에서의 트랩 처리 흐름

전체 흐름: trap 발생 → trampoline.S `uservec` → trap.c `usertrap` (scause로 분기: syscall.c `syscall` 또는 trap.c `devintr`) → trap.c `prepare_return` → usertrap 복귀 → trampoline.S `userret` → 다음 명령어부터 사용자 프로그램 재개.

### CPU의 트랩 처리 순서 (하드웨어가 자동 수행)

(장치 인터럽트인데 sstatus의 SIE 비트가 꺼져 있으면 아래를 모두 수행하지 않음)
1. sstatus의 SIE 비트를 지워 인터럽트 비활성화.
2. program counter를 sepc에 복사.
3. 현재 모드(user/supervisor)를 sstatus의 SPP 비트에 저장.
4. scause에 트랩 원인 설정.
5. 모드를 supervisor로 변경.
6. stvec을 program counter에 복사.
7. 새 program counter에서 실행 시작.

### uservec (kernel/trampoline.S)

1. 사용자의 a0 레지스터를 sscratch에 저장 (`csrw sscratch, a0`).
2. TRAPFRAME 주소를 a0에 로드 (`li a0, TRAPFRAME`).
3. 나머지 사용자 레지스터들을 TRAPFRAME에 저장 (`sd ra, 40(a0)` ~ `sd t6, 280(a0)`, 마지막에 sscratch에서 원래 a0를 꺼내 저장).
4. TRAPFRAME에서 커널 실행 데이터 로드:
   - 커널 스택 포인터 초기화 (kernel_sp): `ld sp, 8(a0)`
   - tp에 현재 hartid 로드 (kernel_hartid): `ld tp, 32(a0)`
   - usertrap() 주소 로드 (kernel_trap): `ld t0, 16(a0)`
   - 커널 페이지 테이블 주소 가져오기 (kernel_satp): `ld t1, 0(a0)`
5. 커널 페이지 테이블로 전환 (`csrw satp, t1`).
6. usertrap()으로 점프 (`jr t0`).

### usertrap (kernel/trap.c)

1. stvec을 kernelvec을 가리키게 변경 (`w_stvec((uint64)kernelvec)`) — 이제 커널 안이므로 이후의 인터럽트·예외는 kernelvec으로.
2. sepc의 사용자 program counter를 TRAPFRAME에 저장 (`p->trapframe->epc = r_sepc()`).
3. scause에 따라 트랩 유형별 처리:
   - `r_scause() == 8` → 시스템 콜 → syscall() 호출.
   - `devintr() != 0` → 장치 인터럽트 처리.
   - 그 외 → 예기치 않은 scause 출력 후 프로세스 종료 (`setkilled(p)`).
4. prepare_return() 호출.

### prepare_return (kernel/trap.c)

1. 인터럽트 비활성화 (`intr_off()`).
2. stvec을 (trampoline의) uservec을 가리키게 변경 — 이후 syscall/인터럽트/예외를 다시 uservec으로.
3. 커널 실행 데이터를 TRAPFRAME에 저장:
   - `p->trapframe->kernel_satp = r_satp();`
   - `p->trapframe->kernel_sp = p->kstack + ...;`
   - `p->trapframe->kernel_trap = (uint64)usertrap;`
   - `p->trapframe->kernel_hartid = r_tp();`
4. sstatus를 이전 상태로 복원: SPP를 0으로 지워 User 모드로 설정, SPIE로 인터럽트 활성화 (`x &= ~SSTATUS_SPP; x |= SSTATUS_SPIE; w_sstatus(x);`).
5. sepc를 저장해둔 사용자 program counter로 설정 (`w_sepc(p->trapframe->epc)`).
6. usertrap()으로 리턴.

### usertrap: prepare_return 이후

1. prepare_return()에서 복귀.
2. 사용자 페이지 테이블 주소 계산 (`uint64 satp = MAKE_SATP(p->pagetable)`).
3. userret으로 점프 — satp 값은 a0 레지스터로 전달 (`return satp;`).

### userret (kernel/trampoline.S)

1. 사용자 페이지 테이블로 전환 (usertrap()에서 a0로 받은 주소): `sfence.vma zero, zero; csrw satp, a0; sfence.vma zero, zero`.
2. TRAPFRAME에서 레지스터 복원 (`ld ra, 40(a0)` 등, a0 레지스터는 마지막에 복원).
3. user mode로 복귀해 사용자 프로그램 재개 (`sret` — sstatus와 sepc는 prepare_return에서 설정됨).

## Kernel Space에서의 트랩 처리 흐름

전체 흐름: trap 발생 → kernelvec.S `kernelvec` → trap.c `kerneltrap` (→ trap.c `devintr`) → kernelvec 복귀 → 중단됐던 커널 실행 재개.

- CPU의 트랩 처리 순서는 user space와 동일 (SIE 클리어, sepc 저장, SPP 저장, scause 설정, supervisor 모드, stvec → PC).

### kernelvec (kernel/kernelvec.S)

1. 커널 레지스터들을 커널 스택에 저장 (`addi sp, sp, -256` 후 `sd ra, 0(sp)` ~ `sd t6, 240(sp)`).
2. C 트랩 핸들러 kerneltrap() 호출.

### kerneltrap (kernel/trap.c)

1. sepc, sstatus, scause 레지스터 값을 지역 변수에 저장.
2. devintr()로 장치 인터럽트 처리. devintr()가 0이면 커널에서 온 인터럽트/트랩이 아닌 것 — scause 등 출력 후 panic.
3. 타이머 인터럽트(which_dev == 2)이고 실행 중 프로세스가 있으면 CPU 양보: `yield()`.
4. 저장해둔 값을 sepc와 sstatus 레지스터에 복원 (`w_sepc(sepc); w_sstatus(sstatus);`) — yield 중 다른 트랩으로 값이 바뀌었을 수 있으므로.

### kernelvec: kerneltrap 이후

1. kerneltrap()에서 복귀.
2. 커널 스택에서 레지스터 복원 (`ld ra, 0(sp)` ~ `ld t6, 240(sp)`, `addi sp, sp, 256`).
3. 중단됐던 커널 실행 재개 (`sret`).
