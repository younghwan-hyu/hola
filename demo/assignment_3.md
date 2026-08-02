# 과제 3 (Project 3): Memory-Mapped Files — xv6에 mmap/munmap 구현

- 원본: assignment_3.pdf
- 과목: 운영체제 실습, 한양대학교
- **마감: 2026년 6월 19일 (금) 23:59** (6월 20일(토) 기말고사 직전에 짧은 퀴즈)
- **주의: 이 과제의 지각 감점은 다름 — 마감 후 2시간 단위마다 10% 감점.**

## 개요

- 목표: xv6에 mmap과 munmap 추가 — 파일을 프로세스의 주소 공간에 매핑.
- 제출: 수정한 소스 코드와 보고서를 GitHub Classroom 저장소 main 브랜치에 push.
  - 저장소 링크: https://classroom.github.com/a/g6u8SPR_
- 만들 것: 프로세스별 bookkeeping (VMA), lazy page-fault 핸들러, unmap 시 write-back, fork/exit 처리.

## 큰 그림 (The big picture)

- mmap은 파일을 프로세스 주소 공간에 매핑해 파일이 메모리의 배열처럼 보이게 함.
  - **데이터를 미리 읽지 않음. 첫 접근 때 page fault를 통해 페이지가 lazy하게 채워짐.**
- munmap은 매핑을 제거. MAP_SHARED면 수정된 페이지를 먼저 파일에 다시 씀(write-back).
- mmap이 하는 일의 예:
```c
int fd = open("bigfile", O_RDONLY);
char *p = mmap(1024*1024*1024, PROT_READ, MAP_PRIVATE, fd, 0);  // 1GB
printf("%c\n", p[500000000]);  // 500MB 지점
```
  - 사용된 read() 호출: 0번. 사용된 메모리: 만진 페이지들만 (파일 전체가 아님). p[500000000]은 정말 파일의 5억 번째 바이트.

## 이 랩의 API

```c
char *mmap(int len, int prot, int flags, int fd, int offset);
int   munmap(void *addr, int len);
```
- len: 매핑/해제할 크기. 양수이며 PGSIZE의 배수.
- prot: 접근 권한 — PROT_READ, PROT_WRITE 또는 둘 다. 매핑된 페이지의 PTE 권한 비트를 결정.
- flags: 공유 모드 — MAP_SHARED (파일로 write-back) 또는 MAP_PRIVATE (변경이 프로세스 로컬에 머묾) 중 정확히 하나.
- fd: 매핑할 열린 파일. filedup으로 refcount를 올려 이후 fd를 close해도 매핑이 살아남게 함.
- offset: 매핑을 시작할 파일 내 위치 (이 과제에서는 항상 0).
- addr (munmap): 해제 시작 주소. **mmap 시스템 콜에는 addr 인자가 없음 — 커널이 주소를 직접 고름.**
- 유효하지 않은 인자가 있으면 -1 반환.

## VMA: 커널의 장부 (kernel/proc.h — 제공됨)

- 각 매핑에 대해 커널이 기억할 것: 어떤 VA 범위, 어떤 파일, 어떤 prot. 프로세스당 고정 16슬롯 배열이면 충분:
```c
#define NVMA 16
struct vma {
    int used;         // 슬롯 사용 중?
    uint64 addr;      // 시작 VA (페이지 정렬)
    uint64 length;    // 바이트 수 (PGSIZE 배수)
    int prot;         // PROT_READ / PROT_WRITE
    int flags;        // MAP_SHARED / MAP_PRIVATE
    int offset;       // 파일 오프셋 (항상 0)
    struct file *f;   // filedup으로 refcount 관리
};
struct proc {
    // ... 기존 필드들 ...
    struct vma vmas[NVMA];
};
```

## 동작 방식

- **mmap**: VMA 슬롯과 주소 공간 등록. mmap 영역은 TRAPFRAME 아래에 위치하며 아래로 자람. Heap(p->sz)과 mmap은 겹치면 안 됨 — mmap은 p->sz를 건드리지 않고 sbrk는 mmap을 건드리지 않음. VMA를 채움. **mmap은 메모리를 할당하지도 파일을 읽지도 않음 — 의도(intent)만 기록.**
- **Lazy page fault 트릭**: 첫 접근이 page fault를 일으킴 → 핸들러가 그 주소를 담은 페이지(PGSIZE 바이트)를 파일에서 읽어 매핑 → 명령어 재시도. 1GB 파일을 매핑해도 만지기 전에는 물리 페이지가 하나도 할당되지 않음.
- **munmap과 write-back**: munmap(addr, len)은 [addr, addr+len)을 제거. 범위는 항상 VMA의 시작이나 끝에 있거나 VMA 전체를 덮음 — 중간 구멍(middle hole)은 절대 없음. MAP_SHARED면 수정된 페이지를 제거 전에 파일에 다시 써야 함. VMA 전체가 사라지면 파일을 닫고 VMA를 정리.

## 스켈레톤: 제공된 것 vs 할 일

- 이미 배선되어 있어 건드릴 필요 없는 것:
  - 시스템 콜 배관 (syscall.{h,c}, usys.pl, user.h, Makefile): mmap/munmap이 커널에 도달함.
  - 자료구조 (proc.h): NVMA, struct vma, proc의 vmas[NVMA]. allocproc이 슬롯을 0으로 초기화.
  - 트랩 경로 (trap.c): usertrap이 vmfault(lazy heap)를 먼저 부르고 다음 mmapfault(mmap 영역)를 부름. 둘 다 거절하면 kill.
  - kernel/sysfile.c의 스텁: sys_mmap, sys_munmap, mmapfault 모두 -1 반환.
- 할 일: 그 세 스텁(sys_mmap, sys_munmap, mmapfault)의 본문을 교체하고 kernel/proc.c에 fork/exit 훅 추가. 거의 전부 kernel/sysfile.c 안에서. **user/mmaptest.c는 수정 금지.**

## 구현 4단계

### Step 1: sys_mmap

1. 인자 검증.
2. 빈 VMA 슬롯 찾기.
3. TRAPFRAME 아래, p->sz 위에서 사용 안 된 VA 선택.
4. VMA를 채우고 addr 반환. VMA의 file 필드를 채울 때 **filedup(f)으로 파일 refcount 증가**.
- 아직 물리 페이지는 없음. 완료 기준: 첫 mmap은 성공하지만 첫 접근이 page fault로 테스트를 죽임.

### Step 2: mmapfault 본문

1. va를 덮는 VMA 찾기 (없으면 -1).
2. 물리 페이지를 할당하고 0으로 초기화.
3. 파일 데이터를 그 페이지로 읽어들임 (힌트: fileread() 안의 inode 읽기 로직 참고).
4. prot를 PTE 권한 비트로 변환해 물리 페이지를 va에 매핑.
5. va에 매핑된 물리 주소 반환.
- EOF 근처의 short read는 괜찮음 — 페이지의 나머지는 0으로 유지. 완료 기준: "test mmap two files"까지 모든 테스트 통과.

### Step 3: write-back을 포함한 sys_munmap

1. VMA가 MAP_SHARED면 데이터를 파일에 write-back하고, 물리 페이지 해제 + PTE 클리어. 영역에 PTE가 없으면(한 번도 fault 안 난 페이지) 그냥 건너뜀.
2. VMA의 addr, offset, length 조정.
3. VMA 전체가 사라지면 파일을 닫고 VMA 슬롯 해제.
- 중간 구멍 unmap은 -1로 거부. (선택) PTE_D(dirty) 비트로 깨끗한 페이지를 건너뛸 수 있음 — 존재하는 모든 페이지를 쓰는 것도 허용. 완료 기준: 단일 프로세스 테스트 전부 통과 ("test fork"는 아직 실패).

### Step 4: kfork와 kexit 훅

- kfork: 자식은 부모와 같은 매핑을 봐야 함 — VMA 배열을 복사하되 **물리 페이지는 공유하지 않음** (자식이 lazy하게 fault-in).
- kexit: MAP_SHARED 수정이 파일에 도달해야 함 — 사용 중인 각 VMA에 대해 unmap-with-writeback 경로 실행. **페이지 테이블이 해제되기 전에 실행할 것.**
- 완료 기준: mmaptest 전부 성공 + usertests -q가 ALL TESTS PASSED.

## 피해야 할 함정 (Pitfalls)

- PROT_*는 PTE_* 비트가 아님. 명시적으로 변환:
```c
int perm = PTE_U;
if (v->prot & PROT_READ)  perm |= PTE_R;
if (v->prot & PROT_WRITE) perm |= PTE_W;
```
- filedup은 필수. 없으면 fd를 close할 때 파일이 dangle됨.
- 단순화된 시그니처에는 addr 인자가 없음 — 5개 인자를 argint/argfd로 알맞게 가져올 것.
- 같은 페이지의 두 번째 fault는 권한 위반 — mappages를 다시 부르지 말고 -1 반환 (다시 부르면 "mappages: remap" panic).
- kexit에서의 munmap도 writei를 부르려면 begin_op / end_op가 필요.
- 매 단계 후 usertests -q 실행 — kfork와 kexit가 가장 회귀(regress)하기 쉬움.

## 보고서 (Report)

- 구성: Design, Implementation, Results, Troubleshooting.
- 보고서 파일명 (엄격함): `OS_project3_[class number]_[student ID].pdf` — 저장소 루트 디렉터리에.

## Q&A / 테스트 케이스

- 질문은 xv6-sandbox Discussions: https://github.com/2026-HYU-ELE3021/xv6-riscv-sandbox/discussions (이메일 질문 답변 안 됨).
- 이번에는 **제공된 테스트 케이스를 통과하는 것만으로 채점 완료** (테스트 기여는 선택).
