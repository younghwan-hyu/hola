# 과제 2 (Project 2): xv6의 커널 스레드 — Linux clone() 모델 적용

- 원본: assignment_2.pdf
- 과목: 운영체제 실습, 한양대학교
- **마감: 2026년 5월 27일 (수) 23:59** (마감 주의 정규 수업 — 5/28(목), 5/29(금) — 에서 짧은 퀴즈)

## 개요

- 목표: xv6 운영체제에 **커널 수준 스레드(kernel-level threads)의 단순화 버전** 구현.
- 제출: 수정한 소스 코드와 보고서를 GitHub Classroom 저장소 main 브랜치에 push.
  - 저장소 링크: https://classroom.github.com/a/35mf_CDQ
- 마감 정책: 늦은 제출 허용, 마감 후 3시간 단위마다 5% 감점. 최종 커밋 기준 채점.

## Part 1: The Idea — 프로세스 vs 스레드

- 핵심 질문: 프로세스와 스레드의 차이는? "스레드가 가볍다", "메모리를 공유한다"는 모두 맞지만 모호함.
- 이 프로젝트가 끝나면 이렇게 답할 수 있어야 함: **"프로세스와 스레드는 같은 커널 객체다. 무엇을 공유하는지만 다르다."**
- 스레드가 필요한 이유: 병렬성 (여러 코어 사용), 블로킹 숨기기 (한 경로가 I/O를 기다리는 동안 계속 작업), 저렴한 공유 (IPC 없이 공통 데이터 공유), 저렴한 컨텍스트 스위치 (같은 페이지 테이블 사용). → 주소 공간을 공유하는 실행 단위가 필요.
- xv6의 문제: struct proc이 실행(context, kstack)과 주소 공간(pagetable, sz)을 한 구조체에 묶어둠 — 함께 할당·해제·전환됨. 그래서 두 번째 실행 단위(스레드)를 만들면 두 번째 주소 공간이 생겨버림. 스레드를 가능하게 하려면 이 묶음을 쪼개야 함.
- **Linux의 통찰: 분리하라** — task 표현을 두 개의 개체로 분할:
  - task_struct: 실행 단위 (task마다 하나). `struct mm_struct *mm;` 포인터를 가짐.
  - mm_struct: 메모리 관리 단위 (포인터로 참조. pgd, mm_users 등 ~100개 필드).
  - 두 task가 같은 mm_struct를 가리킬 수 있음 = 같은 프로세스 위의 두 스레드.
- **하나의 시스템 콜, 두 가지 의미**: 커널은 clone() 시스템 콜만 제공. fork()는 라이브러리 함수. CLONE_VM 비트가 주소 공간을 공유할지 복사할지를 결정:
  - `fork() == clone(SIGCHLD)`
  - `pthread_create() == clone(CLONE_VM | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD ...)`
- 프로젝트 목표: `fork() == clone(0)` [user/ulib.c — 제공됨], `thread_create() == clone(CLONE_VM)` [user/uthread.c — 직접 구현]. 커널의 sys_clone() 하나가 CLONE_VM이면 새 스레드 생성, 아니면 새 프로세스 fork.

## Part 2: The Design — 구조체, refcount, API

### 우리의 mm_struct (kernel/proc.h)

- Linux는 ~100개 필드지만 여기서는 4개만 유지. 핵심 아이디어는 같음: 공유 자원과 task별 상태의 분리.
```c
struct mm_struct {
    pagetable_t pagetable;
    uint64 sz;
    int refcount;          // 몇 개의 task가 이 mm을 공유하는가
    struct spinlock lock;
};
```

### 참조 카운팅 (Reference Counting)

- "마지막에 나가는 자가 청소한다". 모든 mm_get()은 정확히 하나의 mm_put()과 짝지어야 함:
  - mm_alloc() → ref_count = 1
  - mm_get() → ref_count++ (새 task가 공유 시작)
  - mm_put() → ref_count-- (task가 놓음) → refcount == 0이면 pagetable 해제 + mm 해제.

### 재설계된 struct proc

- task별 자원: kstack, trapframe, context, mm 포인터. 프로세스 내 공유 자원: pagetable, sz (mm에 캡슐화).
- 스레드 실행을 위한 task별 상태 확장:
```c
struct proc {
    struct mm_struct *mm;        // pagetable + sz를 대체
    struct proc *group_leader;   // 이 스레드 그룹의 리더
    int tgid;                    // = group_leader->pid
    uint64 tf_va;                // 내 trapframe이 매핑된 VA
    void *ustack;                // 사용자 스택 base (join용)
};
```

### 하나의 페이지 테이블, 여러 개의 trapframe

- 스레드들은 페이지 테이블을 공유하지만 각자 자기 trapframe이 필요 → 별개의 물리 페이지를 할당해 고유한 VA에 매핑.
```c
#define NTHREAD 8
#define TRAPFRAME (TRAMPOLINE - PGSIZE)
#define USERTOP   (TRAPFRAME - NTHREAD * PGSIZE)
```
- 새 함수 find_free_tf_va(): 사용 안 된 슬롯의 VA를 반환, 다 찼으면 0.

### 참고: 스레드가 자기 trapframe을 찾는 방법

- 각 스레드는 트랩마다 자기 trapframe을 찾아야 함 → **sscratch CSR**에 VA를 넣어둠:
  - Kernel → User (prepare_return): sscratch를 p->tf_va로 설정.
  - User → Kernel (uservec): `csrrw a0, sscratch, a0` 한 명령으로 a0와 sscratch를 교환 → a0 = TRAPFRAME VA, sscratch = 저장된 사용자 a0.
  - Linux의 tp (thread pointer)와 같은 트릭.

### 새 시스템 콜과 사용자 API

```c
// 커널 시스템 콜 인터페이스 (user/user.h)
int clone(void (*fn)(void *), void *arg, void *stack, int n_pages, int flags);
int join(void **stack);

// 사용자 공간 라이브러리 API (user/uthread.h)
int thread_create(void (*fn)(void *), void *arg, int n_pages);
int thread_join(void);
```
- arg: pthread_create처럼 불투명 포인터 하나. 여러 값은 struct로 묶어 전달.
- n_pages: 사용자 스택 크기 (페이지 단위). 커널이 새 스레드의 sp 설정에 사용.
- **스택은 라이브러리(thread_create)가 malloc(n_pages * PGSIZE)으로 할당. 커널은 스택을 할당하지 않음.**

### 수정 범위

- 수정할 파일: kernel/proc.c, kernel/exec.c, user/uthread.c의 일부 함수만.
- 수정 금지: kernel/proc.h (구조체 정의), kernel/param.h, kernel/memlayout.h (NTHREAD, USERTOP), kernel/trampoline.S, kernel/trap.c (sscratch 기반 트랩 경로), kernel/syscall.h, kernel/sysproc.c, kernel/usys.pl, user/ulib.c (fork 래퍼).
- kernel/proc.c나 user/uthread.c 안에 헬퍼 함수 추가는 가능. 원본 xv6와의 git diff로 무엇이 바뀌었는지 확인할 것.

## Part 3: Your Work — 3단계 구현 (~125 LoC)

- 코드에 바로 뛰어들지 말고 흐름과 큰 그림을 먼저 스케치할 것.
- 부팅 확인: starter를 clone한 직후 `make qemu CPUS=1` — xv6 부팅, sh 동작, fork 동작. 그러나 usertests forktest에서 "FAILED -- lost some free pages" — fork-exit 사이클이 메모리를 누수함!! → Step 1의 단서.

### Step 1: 메모리 관리 확장 (공유 주소 공간 지원)

- 구현: mm_get(), mm_put(), find_free_tf_va(), freeproc() 안에서 스레드별 trapframe 슬롯 unmap.
- 완료 기준: usertests가 누수 메시지 없이 통과.

### Step 2: 핵심 스레딩 프리미티브 구현

- 구현: kclone()의 CLONE_VM 분기 (kernel/proc.c), kjoin() (kernel/proc.c), thread_create() / thread_join() (user/uthread.c).
- 먼저 읽을 것: kclone()의 fork 분기는 이미 동작함. 무엇이 공유되고 무엇이 새로 할당되는지 비교할 것.
- 스택 수명은 라이브러리 책임: thread_create는 malloc()으로 n_pages 스택 할당, thread_join은 join() 시스템 콜이 반환한 스택을 free()로 해제.

### Step 3: 프로세스 전역 시스템 콜 동작 조정

- kwait: group leader인 자식만 카운트.
- kexit: 리더가 부르면 → 형제(sibling)들을 죽이고 동기적으로 수거. 스레드가 부르면 → 그 task만 종료, 형제들은 계속.
- kkill: task 하나가 아니라 그룹 전체를 죽임.
- kexec: 페이지 테이블 교체 전에 형제들을 정리(drain). 리더가 아닌 스레드의 exec는 이 구현에서 금지.
- 참고: Linux의 그룹 teardown의 단순화 버전.

## 유의 사항 (Things to keep in mind)

- getpid()는 task별 PID 반환: 이 모델에서 각 스레드는 자기 PID를 가짐. 스레드 안에서 부른 getpid()는 리더의 PID와 다른 값 반환. 테스트 코드에서 getpid()를 쓸 때 의도를 분명히.
- 파일 디스크립터와 cwd는 항상 복제(duplicate), 절대 공유 안 함: thread_create()가 부모의 열린 파일과 cwd를 dup. (POSIX 스레드와 달리) 스레드들은 fd 테이블을 공유하지 않음. 두 스레드가 같은 파일을 읽고 쓰면 독립적인 file 구조체로 동작.

## 보고서 (Report)

- 구성: **Code Analysis (이 과제 전용 — 제공된 코드에 무엇이 추가되었는지 식별하고 각 추가의 목적 분석)**, Design, Implementation, Results, Troubleshooting.
- 보고서 파일명 (엄격함): `OS_project2_[class number]_[student ID].pdf` — 저장소 루트 디렉터리에.

## Q&A / 테스트 케이스 기여

- 질문은 xv6-sandbox Discussions: https://github.com/2026-HYU-ELE3021/xv6-riscv-sandbox/discussions (이메일 질문 답변 안 됨).
- 자작 테스트 케이스 공유 가능, 공식 채점에 채택될 수 있음.
