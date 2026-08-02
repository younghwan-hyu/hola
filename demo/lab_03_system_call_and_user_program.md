# 랩 03: System call and User Program (시스템 콜과 사용자 프로그램)

- 원본: lab_03_system_call_and_user_program.pdf
- 과목: 운영체제 실습, 한양대학교
- 내용: 시스템 콜 개념, xv6의 시스템 콜 흐름, hands-on lab (getppid 시스템 콜 추가 + getppidtest 테스트 프로그램 추가)

## 시스템 콜이란? (What is a System Call?)

- 시스템 콜은 프로그램이 자신이 실행되는 운영체제 커널에게 서비스를 요청하는 프로그램적 방법.
- 하드웨어 관련 서비스, 새 프로세스의 생성·실행, 프로세스 스케줄링 같은 핵심 커널 서비스와의 통신 등이 포함됨.
- 계층 구조: 실행 프로그램 (ls, cat, grep 등) → 라이브러리 함수 (printf, strcpy, fopen 등) → 시스템 콜 (open, fork, sleep 등) → Kernel → Hardware.

## xv6의 시스템 콜 흐름 (System Call Flow)

- User Space에서 `ecall` 명령 실행 → Kernel Space로:
  - trampoline.S의 `uservec` → trap.c의 `usertrap` (scause 판별) → syscall.c의 `syscall` → 처리 후 trampoline.S의 `userret` → User Space의 다음 명령어로 복귀.

### 사용자 쪽: 시스템 콜을 부르는 방법

- user/cat.c 같은 사용자 코드가 `read(fd, buf, sizeof(buf))`, `write(1, buf, n)`을 호출.
- 선언은 user/user.h에: `int write(int, const void*, int); int read(int, void*, int);`
- 실제 진입은 user/usys.S (usys.pl이 생성 — 직접 수정 금지):
```asm
.global read
read:
    li a7, SYS_read   # a7 레지스터에 시스템 콜 번호 로드
    ecall             # 커널로 트랩
    ret
```

### 커널 쪽: 시스템 콜 처리

- kernel/syscall.c의 syscall() 함수 (인터럽트 핸들러에서 호출됨):
```c
void syscall(void) {
    int num;
    struct proc *p = myproc();
    num = p->trapframe->a7;   // a7에 담긴 시스템 콜 번호
    if (num > 0 && num < NELEM(syscalls) && syscalls[num]) {
        // num으로 시스템 콜 함수를 찾아 호출하고 반환값을 p->trapframe->a0에 저장
        p->trapframe->a0 = syscalls[num]();
    } else {
        printf("%d %s: unknown sys call %d\n", p->pid, p->name, num);
        p->trapframe->a0 = -1;
    }
}
```
- 시스템 콜 번호는 kernel/syscall.h에 정의. kernel/syscall.c의 함수 포인터 배열이 번호→함수 매핑:
```c
static int (*syscalls[])(void) = {
  [SYS_read] sys_read, [SYS_kill] sys_kill, [SYS_exec] sys_exec,
  [SYS_fstat] sys_fstat, [SYS_chdir] sys_chdir, [SYS_dup] sys_dup,
  [SYS_getpid] sys_getpid, [SYS_sbrk] sys_sbrk, [SYS_sleep] sys_sleep,
  [SYS_uptime] sys_uptime, [SYS_open] sys_open, [SYS_write] sys_write, ...
};
```
- Wrapper 함수 (예: kernel/sysfile.c의 sys_read): 인자 가져오기 같은 전처리를 수행한 뒤 실제 서비스 루틴 호출.
```c
uint64 sys_read(void) {
    struct file *f; int n; uint64 p;
    argaddr(1, &p);
    argint(2, &n);
    if (argfd(0, 0, &f) < 0) return -1;
    return fileread(f, p, n);   // kernel/file.c의 실제 서비스 루틴
}
```
- 실제 서비스 루틴 (예: kernel/file.c의 fileread): 파일 타입(FD_PIPE/FD_DEVICE/FD_INODE)에 따라 piperead, devsw read, readi 등으로 분기.

## Hands-on Lab 1: 새 시스템 콜 getppid 추가

- 기존 getpid()는 현재 프로세스 ID 반환. 목표: 부모 프로세스 ID를 반환하는 getppid() 추가.
- 새 시스템 콜 추가 절차 요약:
  - 커널: (1) 함수 구현 → (2) kernel/defs.h에 선언 → (3) wrapper 함수 구현 → (4) kernel/syscall.h와 kernel/syscall.c에 등록.
  - 사용자: (1) user/user.h에 선언 → (2) user/usys.pl에 매크로 추가.

### Step 0 – git 브랜치

```bash
git switch sandbox/base    # base 브랜치로 전환
git branch sandbox/lab03   # 새 브랜치 생성
git switch sandbox/lab03   # lab03 브랜치로 전환
```
- TA의 코드는 주말에 TA 저장소의 sandbox/lab03 브랜치에 업로드됨.

### Step 1 – 함수 구현 (kernel/proc.c)

- kernel/proc.c는 프로세스 관련 코드를 담고 있음. kgetppid 함수 구현:
```c
int kgetppid(void) {
    struct proc *p = myproc();
    if (p->parent) {
        return p->parent->pid;
    } else {
        return -1;
    }
}
```

### Step 2 – kernel/defs.h에 선언

- `int kgetppid(void);` 추가 (procdump(void); 아래). 이 단계로 다른 c 파일에서 함수가 보이게 됨.

### Step 3 – Wrapper 함수 구현 (kernel/sysproc.c)

- kernel/sysproc.c는 프로세스 관련 시스템 콜의 wrapper 함수들을 담음. wrapper는 trapframe에서 매개변수를 꺼내지만, 이 시스템 콜은 매개변수가 없음:
```c
uint64 sys_getppid(void) {
    return kgetppid();
}
```

### Step 4 – 시스템 콜 등록

- kernel/syscall.h: `#define SYS_getppid 22` (SYS_close 21 다음).
- kernel/syscall.c: `extern uint64 sys_getppid(void);` 선언 추가, syscalls 배열에 `[SYS_getppid] sys_getppid,` 추가.

### Step 5 – user/user.h에 선언

- system calls 섹션에 `int getppid(void);` 추가.

### Step 6 – user/usys.pl에 매크로 추가

- `entry("getppid");` 추가. usys.pl은 커널의 시스템 콜 처리 함수를 호출하는 user/usys.S 스텁을 생성하는 스크립트.

## Hands-on Lab 2: 테스트 프로그램 추가 (usertests 확장)

- 이전 랩에서는 사용자 프로그램을 새로 추가했음 (그 방법도 가능). 이번에는 xv6 내장 usertests를 확장.
- usertests: xv6가 올바로 동작하는지 검사하는 사용자 프로그램.
- 사용법:
```bash
usertests              # 모든 테스트 실행
usertests -q           # 빠른 테스트만 실행
usertests [testname]   # 특정 테스트 실행
```
- 테스트 코드는 sandbox/lab03에 제공됨 (user/usertests.c에 getppidtest 추가).
- 실행 확인:
```
$ usertests getppidtest
usertests starting
test getppidtest: PASS
PASS ALL TESTS
```

## 제출 (Submission)

- 변경 파일: kernel/defs.h, kernel/syscall.c, kernel/syscall.h, kernel/sysproc.c, user/user.h, user/usertests.c, user/usys.pl
```bash
git add .
git commit -m "lab03"
git push origin sandbox/lab03
```

## 부록: 시스템 콜 인자 가져오기 (Fetching Arguments)

- kernel/syscall.c에 시스템 콜 인자를 가져오는 유용한 함수들이 제공됨. 이 함수들은 인자를 검증하고 포인터가 유효한 주소 공간을 참조하는지 확인 (문자열은 null 종료 여부도 확인). 성공 시 0, 실패 시 -1 반환:
```c
int fetchaddr(uint64 addr, uint64 *ip);
int fetchstr(uint64 addr, char *buf, int max);
static uint64 argraw(int n);
void argint(int n, int *ip);
void argaddr(int n, uint64 *ip);
int argstr(int n, char *buf, int max);
```
- 반드시 이 함수들을 사용할 것 — 포인터에 직접 접근하지 말 것! 코드를 안전하고 디버깅하기 쉽게 만드는 데 매우 중요.
- 특정 형태의 인자를 자주 가져와야 하면 그런 타입 전용 함수를 추가해도 됨. 예: sysfile.c의 argfd() 함수.
