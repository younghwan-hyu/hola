# 랩 07: User Process Execution (프로세스의 일생)

- 원본: lab_07_user_process_execution.pdf
- 과목: 운영체제 실습, 한양대학교
- 내용: 프로세스 실행 관련 시스템 콜 — fork(void), exec(const char *, char **), wait(int *), exit(int), kill(int)

## fork

- 호출한 프로세스를 복제해 새 프로세스 생성. 자식과 부모는 별도의 메모리 공간에서 실행.
- 두 프로세스 모두 fork() 시스템 콜이 리턴하는 지점부터 계속 실행. 부모는 자식의 PID를, 자식은 0을 반환값으로 받음.

### kfork의 동작 순서 (kernel/proc.c)

1. allocproc()으로 새 PCB(process control block) 할당.
2. uvmcopy()로 부모의 사용자 메모리를 새 프로세스의 페이지 테이블로 복사 (`uvmcopy(p->pagetable, np->pagetable, p->sz)`). 실패 시 freeproc(np) 후 -1 반환. `np->sz = p->sz;`
3. 부모의 TRAPFRAME 복사: `*(np->trapframe) = *(p->trapframe);`
4. 자식의 TRAPFRAME의 a0 레지스터를 0으로 설정: `np->trapframe->a0 = 0;` — fork가 자식에게 0을 반환하는 이유.
5. 부모의 파일 디스크립터(filedup으로 참조 카운트 증가)와 현재 작업 디렉터리(idup) 복사.
6. 부모의 프로세스 이름 복사 (safestrcpy).
7. 새 프로세스의 부모를 fork()를 부른 프로세스로 설정 (`np->parent = p;` — wait_lock 보호 하에).
8. 새 프로세스의 상태를 RUNNABLE로 설정 — 이제 자식이 스케줄될 준비 완료.
9. 부모는 자식의 pid를 반환하며 fork 시스템 콜 루틴 종료.

### allocproc (kernel/proc.c)

- 새 PCB를 할당·초기화해 프로세스 실행을 준비. 프로세스 테이블에서 UNUSED 상태의 프로세스를 찾음:
1. 프로세스 테이블 순회하며 UNUSED 프로세스 검색 (각각 lock을 잡고 확인).
2. 찾으면 found 레이블로 점프. 테이블이 가득 차면 0 반환.
- found 레이블에서:
1. allocpid()로 새 PID 할당.
2. 상태를 USED로 변경.
3. trapframe 페이지 할당 (kalloc).
4. 빈 사용자 페이지 테이블 할당 (proc_pagetable).
5. 프로세스 컨텍스트 초기화, 리턴 주소(ra)를 forkret()으로 설정:
```c
memset(&p->context, 0, sizeof(p->context));
p->context.ra = (uint64)forkret;
p->context.sp = p->kstack + PGSIZE;
```

### 새 프로세스는 어디서 실행을 시작하나?

- allocproc이 context.ra = forkret으로 설정했으므로, scheduler()가 swtch(&c->context, &p->context)로 이 프로세스로 전환하면 ret이 forkret을 호출함.

### forkret (kernel/proc.c)

1. 스케줄러가 쥐고 있던 프로세스 락을 해제 (`release(&p->lock)`).
   - 일반 프로세스는 yield()에서 잡은 락이 컨텍스트 스위치 후 해제되듯, fork로 새로 만들어진 프로세스도 컨텍스트 스위치를 위해 락을 해제해야 함 → 그 역할을 forkret이 수행.
2. 첫 번째 프로세스라면 init 프로그램 실행: `p->trapframe->a0 = kexec("/init", (char *[]){ "/init", 0 });`
3. prepare_return()을 실행하고 trampoline의 userret으로 점프해 user space로 복귀 (usertrap의 리턴을 흉내):
```c
prepare_return();
uint64 satp = MAKE_SATP(p->pagetable);
uint64 trampoline_userret = TRAMPOLINE + (userret - trampoline);
((void (*)(uint64))trampoline_userret)(satp);
```

## exec

- exec()은 현재 프로세스의 메모리를 새 실행 파일로 교체 — 프로세스를 새 프로그램으로 변신시킴.
- exec()은 오류가 발생했을 때만 -1을 반환 (이때 모든 자원 해제). 성공하면 리턴하지 않고 새 프로그램이 시작됨.

### ELF (Executable and Linkable Format)

- Unix 계열 시스템에서 실행 파일, 오브젝트 코드, 공유 라이브러리, 코어 덤프를 저장하는 표준 파일 포맷.
- xv6 응용 프로그램도 널리 쓰이는 ELF 포맷으로 기술되며 kernel/elf.h에 정의됨.

### xv6 프로세스의 사용자 주소 공간 구조 (아래→위)

- text (R-XU) → unused → data (R-WU) → guard page → stack (R-WU, USERSTACK*PGSIZE) → heap (R-WU) → unused → trapframe (R-W-) → trampoline (RX--) at MAXVA.

### kexec의 동작 순서 (kernel/exec.c)

1. 실행할 파일의 inode 획득: `if ((ip = namei(path)) == 0)`.
2. 디스크의 파일에서 ELF 헤더를 읽음: `readi(ip, 0, (uint64)&elf, 0, sizeof(elf))` — ELF 헤더 검증.
3. 새 페이지 테이블 할당, trapframe & trampoline 페이지 매핑: `proc_pagetable(p)`.
4. ELF 파일에서 program 헤더들을 읽음 (`for (i=0, off=elf.phoff; i<elf.phnum; i++, off+=sizeof(ph))`).
5. 각 세그먼트를 위한 메모리 할당(uvmalloc) 후 주소 공간에 로드 (loadseg).
6. 사용자 스택과 가드 페이지(guard page)용 메모리 할당·클리어: `uvmalloc(pagetable, sz, sz + (USERSTACK+1)*PGSIZE, ...)`, `uvmclear(pagetable, sz-(USERSTACK+1)*PGSIZE)` — 가드 페이지는 접근 불가로 만들어 스택 오버플로 감지.
7. 스택 포인터(sp)와 stackbase 초기화: `sp = sz; stackbase = sp - USERSTACK*PGSIZE;`
8. 실제 인자 문자열들을 스택 꼭대기에 push: 각 argv[argc]에 대해 `sp -= strlen(argv[argc]) + 1; sp -= sp % 16;` (RISC-V sp는 16바이트 정렬 필수) 후 copyout.
9. 그 주소들을 임시 배열 ustack에 저장. `ustack[argc] = 0;` (null 종료).
10. 인자 포인터 배열(ustack)을 사용자 스택으로 복사: `sp -= (argc+1) * sizeof(uint64); sp -= sp % 16;` 후 copyout. sp < stackbase면 실패.
11. a1 레지스터를 sp로 설정해 새 프로그램에 argv 전달: `p->trapframe->a1 = sp;` (argc는 시스템 콜 반환값으로 a0에 들어감 → main(argc, argv)의 두 인자가 됨).
12. 새 사용자 이미지로 커밋: 이전 페이지 테이블을 보관 후 교체하고 이전 메모리 해제:
```c
oldpagetable = p->pagetable;
p->pagetable = pagetable;
p->sz = sz;
p->trapframe->epc = elf.entry;   // 초기 program counter = ELF 진입점
p->trapframe->sp = sp;           // 초기 스택 포인터
proc_freepagetable(oldpagetable, oldsz);
return argc;   // a0로 들어감 — main(argc, argv)의 첫 인자
```
- 최종 초기 스택 모양 (위→아래): argument 0 문자열 ... argument N 문자열, 0, address of argument N ... address of argument 0 (= argv 배열), 그리고 argv 인자로 쓰일 주소.

## wait

- wait() 시스템 콜은 부모 프로세스가 자식의 종료를 기다리게 함. 자식의 exit status를 가져오고 좀비 프로세스의 자원을 해제해 정리함. 종료한 자식이 없으면 부모는 하나가 종료할 때까지 잠듦(sleep).

### kwait의 동작 (kernel/proc.c)

1. 무한 루프를 돌며 자식 프로세스가 종료했는지 확인 — 전체 프로세스 테이블을 스캔해 현재 프로세스의 자식(pp->parent == p)을 찾음.
2. ZOMBIE 상태의 자식을 찾으면: 그 pid를 얻고, exit status를 copyout으로 사용자 주소(addr)에 복사하고, freeproc(pp)으로 자식의 자원을 해제한 뒤 자식의 PID 반환.
3. 자식이 없거나 부모 자신이 killed 상태면 즉시 -1 반환.
4. 아직 종료한 자식이 없으면 부모는 자식이 exit()을 부를 때까지 sleep: `sleep(p, &wait_lock);`

## exit

- exit() 시스템 콜은 현재 프로세스를 종료. 종료된 프로세스는 "좀비 상태(zombie state)"가 되어 부모가 wait()으로 수거할 때까지 시스템에 남음. exit status를 인자로 부모에게 전달 가능.

### kexit의 동작 (kernel/proc.c)

1. 현재 프로세스가 init 프로세스인지 확인 — 루트 프로세스 initproc은 종료가 허용되지 않음 (`if (p == initproc) panic("init exiting");`).
2. 열린 파일을 모두 닫고 파일 테이블에서 제거 (fileclose).
3. 현재 작업 디렉터리의 inode 참조를 내려놓음 (begin_op; iput(p->cwd); end_op; p->cwd = 0;).
4. 자식 프로세스들을 initproc에게 재부모화(reparent) — 고아가 되는 것을 방지:
```c
void reparent(struct proc *p) {
    struct proc *pp;
    for (pp = proc; pp < &proc[NPROC]; pp++) {
        if (pp->parent == p) {
            pp->parent = initproc;
            wakeup(initproc);
        }
    }
}
```
5. 부모가 wait()에서 자고 있을 수 있으므로 깨움: `wakeup(p->parent);`
6. exit status 값(p->xstate = status)과 상태를 ZOMBIE로 설정.
7. sched()를 호출해 스케줄러로 점프 — 다시는 돌아오지 않음 (`panic("zombie exit")`는 도달하면 안 되는 코드).

## kill

- kill() 시스템 콜은 지정한 PID의 프로세스에 종료 요청을 보냄.
- killed 플래그를 설정하고, 프로세스가 SLEEPING이면 상태를 RUNNABLE로 바꿔 깨움. 프로세스는 user space로 돌아갈 때 실제로 종료됨.

### kkill의 동작 (kernel/proc.c)

1. 전체 프로세스 테이블을 스캔해 PID가 일치하는 프로세스를 찾음.
2. 찾으면 killed 필드를 1로 설정하고, SLEEPING이면 RUNNABLE로 바꿔 깨움. 성공 시 0, 못 찾으면 -1 반환.

### 죽임당한 프로세스는 언제 종료되나?

- user space에서 트랩이 발생하면 트랩 핸들러(usertrap)가 현재 프로세스의 killed 필드를 확인: `if (killed(p)) exit(-1);` — killed면 -1 status로 종료.
- 왜 즉시 죽이지 않고 killed 플래그를 쓰는가? **커널 상태가 손상되는 것을 막기 위해!!** (커널 작업 도중 프로세스를 강제로 없애면 락·자원이 어중간한 상태로 남을 수 있음. 안전한 시점 — user space 복귀 직전 — 에 스스로 종료하게 함.)
