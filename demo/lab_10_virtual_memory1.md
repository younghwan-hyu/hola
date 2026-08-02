# 랩 10: Virtual Memory 1 (xv6의 페이지 테이블과 메모리 관리)

- 원본: lab_10_virtual_memory1.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: 가상 메모리·페이징 개요, 페이지 테이블 (사용자 페이지 테이블 생성, 커널 페이지 테이블 생성·초기화, 페이지 테이블 전환)

## 가상 메모리란? (What is Virtual Memory?)

- 프로세스 하나가 8GB를 주소지정할 수 있고 1,000개가 돌면 물리 RAM이 8TB 필요한가? → 아니오, OS가 가상 메모리를 제공.
- 가상 메모리: 프로그램이 실제 물리 RAM보다 큰 메모리 공간을 쓸 수 있게 하는 OS 기법.
  - 각 프로그램에게 크고 연속적인 메모리 블록의 환상을 제공.
  - 각 프로세스는 자기만의 격리된 논리(가상) 주소 공간에서 동작.
  - CPU는 가상 주소를 생성하고, OS가 뒤에서 이를 물리 RAM(또는 디스크)에 동적으로 매핑.
- 변환 경로: CPU → (Virtual Address) → MMU → (Physical Address) → Physical Memory.

## 페이징 (Paging)

- 프로세스의 논리 주소 공간을 페이지(page)라는 고정 크기 블록으로, 물리 메모리를 같은 크기의 프레임(frame)으로 나누는 메모리 관리 기법.
- OS는 페이지 테이블로 가상 페이지 번호 → 물리 프레임 번호를 매핑. 페이지 번호로 페이지 테이블을 조회해 프레임 번호를 얻고, MMU가 물리 주소를 계산.

## xv6의 물리 메모리 관리 (kernel/kalloc.c)

- 메모리 페이지는 KERNBASE와 PHYSTOP 사이의 free memory 영역에서 나옴. 이 영역은 커널 페이지 테이블에서 가상 주소와 1:1 매핑됨.
- xv6는 할당 가능한 물리 페이지들의 free list를 관리 — 빈 페이지들이 단일 연결 리스트로 연결됨:
```c
struct run { struct run *next; };
struct {
    struct spinlock lock;
    struct run *freelist;
} kmem;
```
- kalloc(): free list의 첫 원소를 제거하고 반환:
```c
void *kalloc(void) {
    struct run *r;
    acquire(&kmem.lock);
    r = kmem.freelist;
    if (r) kmem.freelist = r->next;
    release(&kmem.lock);
    if (r) memset((char*)r, 5, PGSIZE);   // 쓰레기 값으로 채움
    return (void*)r;
}
```
- kfree(): 페이지를 free list 앞에 붙여 다시 할당 가능하게 만듦:
```c
void kfree(void *pa) {
    struct run *r;
    r = (struct run*)pa;
    acquire(&kmem.lock);
    r->next = kmem.freelist;
    kmem.freelist = r;
    release(&kmem.lock);
}
```

## 주소 변환 (Address Translation)

- satp 레지스터: 현재 CPU에서 실행 중인 프로세스의 루트 페이지 테이블의 물리 주소를 담음.
- MMU (CPU 안의 하드웨어 회로)가 CPU가 메모리에 접근할 때마다 (TLB 미스가 났을 때) 가상 주소→물리 주소 변환을 수행.
- RISC-V Sv39: 가상 주소 = EXT(10) | L2(9) | L1(9) | L0(9) | Offset(12) 비트.
- Level 2, 1 페이지 테이블 엔트리는 다음 레벨 페이지 테이블의 물리 주소를 가리킴. L0 엔트리가 최종 PPN(44비트)을 담고, Offset(12비트)과 합쳐 물리 주소가 됨.

## xv6의 페이지 테이블

- 프로세스마다 사용자 페이지 테이블: `struct proc`의 `pagetable_t pagetable;` (kernel/proc.h).
- 커널용 페이지 테이블: `pagetable_t kernel_pagetable;` (kernel/vm.c).

### 가상 주소 조회: walkaddr()와 walk() (kernel/vm.c)

- walkaddr(): 가상 주소를 조회해 물리 주소 반환. walk()로 PTE를 얻고, PTE를 검증(PTE_V 유효, PTE_U 사용자 접근 가능)한 뒤 PTE2PA로 물리 주소 변환. va ≥ MAXVA면 0.
```c
uint64 walkaddr(pagetable_t pagetable, uint64 va) {
    pte_t *pte; uint64 pa;
    if (va >= MAXVA) return 0;
    pte = walk(pagetable, va, 0);
    if (pte == 0) return 0;
    if ((*pte & PTE_V) == 0) return 0;
    if ((*pte & PTE_U) == 0) return 0;
    pa = PTE2PA(*pte);
    return pa;
}
```
- walk(): 특정 가상 페이지의 페이지 테이블 엔트리를 검색 — RISC-V 페이징 하드웨어의 동작을 소프트웨어로 구현:
```c
pte_t *walk(pagetable_t pagetable, uint64 va, int alloc) {
    if (va >= MAXVA) panic("walk");
    for (int level = 2; level > 0; level--) {
        pte_t *pte = &pagetable[PX(level, va)];
        if (*pte & PTE_V) {
            pagetable = (pagetable_t)PTE2PA(*pte);   // 다음 레벨로
        } else {
            if (!alloc || (pagetable = (pde_t*)kalloc()) == 0)
                return 0;
            memset(pagetable, 0, PGSIZE);
            *pte = PA2PTE(pagetable) | PTE_V;   // 중간 테이블을 만들어 연결
        }
    }
    return &pagetable[PX(0, va)];   // L0 엔트리 주소 반환
}
```
- alloc 플래그가 1이면 중간 레벨 페이지 테이블이 없을 때 kalloc으로 만들어 채움.

## 사용자 프로세스의 페이지 테이블 생성

- 프로세스 생성 시(allocproc) proc_pagetable()로 새 사용자 페이지 테이블을 초기화해 프로세스의 가상 메모리 레이아웃을 정의: `p->pagetable = proc_pagetable(p);`

### proc_pagetable() (kernel/proc.c)

- 프로세스의 페이지 테이블을 생성·초기화:
  1. 빈 페이지 테이블 생성 (L2 루트 페이지 테이블만) — uvmcreate().
  2. trampoline 페이지 매핑: `mappages(pagetable, TRAMPOLINE, PGSIZE, (uint64)trampoline, PTE_R | PTE_X)`.
  3. trapframe 페이지 매핑 (프로세스마다): `mappages(pagetable, TRAPFRAME, PGSIZE, (uint64)(p->trapframe), PTE_R | PTE_W)`.

### Trampoline 페이지

- 트랩 처리의 핵심 코드(uservec, userret)를 담음.
- 하나의 물리 페이지가 모든 사용자 페이지 테이블과 커널 페이지 테이블에서 같은 최상위 VA(TRAMPOLINE)에 매핑됨.
- → 페이지 테이블이 전환되는 도중에도 트랩 처리 코드가 계속 접근·실행 가능함을 보장.

### uvmcreate() (kernel/vm.c)

- 빈 페이지 하나를 할당해 사용자 레벨 루트 페이지 테이블로 초기화하고 그 주소를 반환:
```c
pagetable_t uvmcreate() {
    pagetable_t pagetable;
    pagetable = (pagetable_t) kalloc();
    if (pagetable == 0) return 0;
    memset(pagetable, 0, PGSIZE);
    return pagetable;
}
```

### mappages() (kernel/vm.c)

- 주어진 가상 주소 범위를 페이지 단위로 나눠 각 페이지를 지정된 물리 주소 범위의 대응 위치에 매핑. 페이지 테이블에 엔트리를 만들어 가상↔물리 관계를 확립:
```c
int mappages(pagetable_t pagetable, uint64 va, uint64 size, uint64 pa, int perm) {
    a = va;
    last = va + size - PGSIZE;
    for (;;) {
        if ((pte = walk(pagetable, a, 1)) == 0) return -1;
        if (*pte & PTE_V) panic("mappages: remap");
        *pte = PA2PTE(pa) | perm | PTE_V;
        if (a == last) break;
        a += PGSIZE;
        pa += PGSIZE;
    }
    return 0;
}
```

## 커널 페이지 테이블 생성·초기화 (kernel/vm.c)

- kvmmake(): 커널 페이지 테이블 초기화. 커널의 가상 주소 공간과 대응 물리 주소 간 직접 매핑(direct mapping)을 설정:
  - UART 레지스터 등 장치 매핑: `kvmmap(kpgtbl, UART0, UART0, PGSIZE, PTE_R | ...)`.
  - 커널 데이터와 물리 RAM 매핑: `kvmmap(kpgtbl, (uint64)etext, (uint64)etext, ...)`.
  - trampoline을 커널의 최상위 가상 주소에 매핑: `kvmmap(kpgtbl, TRAMPOLINE, (uint64)trampoline, ...)`.
  - 각 프로세스의 커널 스택 할당·매핑: proc_mapstacks(kpgtbl).
- kvmmap()은 mappages()를 사용해 커널 페이지 테이블에 매핑을 확립 (실패 시 panic).
- kvminit(): kvmmake()를 호출해 커널 코드·데이터·장치·trampoline의 직접 매핑으로 kernel_pagetable을 초기화.
- kvminithart(): 각 hart에서 satp 레지스터에 커널 페이지 테이블을 써서 활성화하고 TLB를 플러시:
```c
void kvminithart() {
    sfence_vma();                          // 이전 쓰기 완료 대기
    w_satp(MAKE_SATP(kernel_pagetable));
    sfence_vma();                          // TLB의 오래된 엔트리 플러시
}
```
- 둘 다 xv6의 main 함수에서 호출됨.

## 페이지 테이블 전환 (Page Table Switching) — 모드 전환에서 사용

### 진입 경로 (Entry Path: uservec → usertrap)

- uservec에서 CPU가 trapframe에서 커널 페이지 테이블 주소를 로드 (`ld t1, 0(a0)` — trapframe 오프셋 0 = kernel_satp) 후 설치 (`csrw satp, t1`).
- 따라서 커널에서의 처리 과정 동안 커널 페이지 테이블이 사용됨.
- struct trapframe 복습: 0=kernel_satp, 8=kernel_sp, 16=kernel_trap, 24=epc, 32=kernel_hartid, 40~=general, 96~=callee-saved, 256~=temporary.

### 복귀 경로 (Return Path: usertrap → userret)

- prepare_return()에서 CPU가 현재 SATP 값(커널 페이지 테이블)을 trapframe에 저장: `p->trapframe->kernel_satp = r_satp();` — 미래의 트랩 때 uservec이 다시 커널 페이지 테이블로 전환할 수 있도록.
- 그 후 usertrap()이 사용자 프로세스의 SATP 값을 반환: `uint64 satp = MAKE_SATP(p->pagetable); return satp;` — user 모드로 돌아갈 때 쓰임.
- usertrap()에서 리턴하면 (jalr 명령 덕분에) 실행이 바로 userret에서 재개됨.
- userret()에서 CPU가 a0 레지스터로 반환된 satp 값을 사용해 사용자 페이지 테이블을 로드:
```asm
userret:
    sfence.vma zero, zero
    csrw satp, a0
    sfence.vma zero, zero
```
