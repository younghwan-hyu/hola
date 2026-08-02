# 랩 11: Virtual Memory 2 (사용자 가상 메모리 uvm 상세)

- 원본: lab_11_virtual_memory2.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: 사용자 수준 메모리 할당 API, sbrk 시스템 콜, 핵심 VM 헬퍼 함수 (uvmalloc, uvmdealloc, uvmunmap, uvmcopy 등), hands-on lab (Alarm 시스템 콜)

## 사용자 수준 메모리 할당 (User-Level Memory Allocation)

- 고전적 사용자 메모리 할당 API ("The C Programming Language", Kernighan & Ritchie 방식):
  - heap 메모리 공간을 작은 크기(16바이트) 단위로 분할.
  - 가용 메모리 유닛들을 원형 단일 연결 리스트로 관리.
- malloc(nbytes): first-fit 검색으로 메모리 할당.
- free(ptr): 메모리를 free list로 반환하며 자동 병합(coalescing).
- morecore(units): 필요할 때 sbrk()로 heap 확장 (최소 4096 유닛 = 64KB).

## sbrk 시스템 콜

- sbrk는 프로세스의 heap 메모리를 동적으로 조정하는 시스템 콜.
- **Lazy allocation** 제공: 메타데이터 포인터(p->sz, break)만 갱신하고 물리 할당은 미룸.
```c
// kernel/sysproc.c
uint64 sys_sbrk(void) {
    uint64 addr; int t; int n;
    argint(0, &n);
    argint(1, &t);
    addr = myproc()->sz;
    if (t == SBRK_EAGER || n < 0) {
        if (growproc(n) < 0) return -1;   // 즉시(eager) 할당 또는 축소
    } else {
        myproc()->sz += n;                // lazy: 크기만 늘림, 물리 페이지는 나중에
    }
    return addr;
}
```

## 페이지 폴트 예외 (Pagefault exception)

- RISC-V exception code: 8 = U-mode의 environment call (시스템 콜), 12 = instruction page fault, 13 = load page fault, 15 = store/AMO page fault.
- usertrap()에서의 처리 (kernel/trap.c):
```c
if (r_scause() == 8) {
    syscall();
} else if ((which_dev = devintr()) != 0) {
    // ok
} else if ((r_scause() == 15 || r_scause() == 13) &&
           vmfault(p->pagetable, r_stval(), (r_scause() == 13) ? 1 : 0) != 0) {
    // lazily-allocated 페이지에서의 page fault — vmfault가 처리
} else {
    printf("usertrap(): unexpected scause ...");
    setkilled(p);
}
```

### vmfault (kernel/vm.c)

- lazy allocation된 주소에 처음 접근해 페이지 폴트가 났을 때 실제 물리 페이지를 할당·매핑:
```c
uint64 vmfault(pagetable_t pagetable, uint64 va, int read) {
    uint64 mem;
    struct proc *p = myproc();
    if (va >= p->sz) return 0;            // 프로세스 크기 밖 — 실패
    va = PGROUNDDOWN(va);
    if (ismapped(pagetable, va)) return 0; // 이미 매핑됨 — 다른 원인의 폴트
    mem = (uint64) kalloc();               // 1. 빈 물리 페이지 할당
    if (mem == 0) return 0;
    memset((void *) mem, 0, PGSIZE);
    if (mappages(p->pagetable, va, PGSIZE, mem, PTE_W|PTE_U|PTE_R) != 0) {
        kfree((void *)mem);                // 2. 새 물리 페이지를 가상 주소에 매핑
        return 0;
    }
    return mem;
}
```

## growproc (kernel/proc.c)

- eager 할당 경로:
```c
int growproc(int n) {
    uint64 sz;
    struct proc *p = myproc();
    sz = p->sz;                       // 1. 현재 heap 크기에서 새 base 주소 얻기
    if (n > 0) {
        if (sz + n > TRAPFRAME) return -1;
        if ((sz = uvmalloc(p->pagetable, sz, sz + n, PTE_W)) == 0)
            return -1;                // 2. uvmalloc으로 새 물리 페이지 매핑
    } else if (n < 0) {
        sz = uvmdealloc(p->pagetable, sz, sz + n);   // 또는 uvmdealloc으로 해제
    }
    p->sz = sz;                       // 3. p->sz를 새 총 heap 크기로 갱신
    return 0;
}
```

## 핵심 VM 헬퍼 함수 (kernel/vm.c)

### uvmalloc

- 사용자 프로세스의 가상 메모리 공간을 확장 (주소는 페이지 정렬):
```c
uint64 uvmalloc(pagetable_t pagetable, uint64 oldsz, uint64 newsz, int xperm) {
    char *mem; uint64 a;
    if (newsz < oldsz) return oldsz;
    oldsz = PGROUNDUP(oldsz);
    for (a = oldsz; a < newsz; a += PGSIZE) {
        mem = kalloc();                       // 물리 메모리 할당
        if (mem == 0) { uvmdealloc(pagetable, a, oldsz); return 0; }
        memset(mem, 0, PGSIZE);
        if (mappages(pagetable, a, PGSIZE, (uint64)mem, PTE_R|PTE_U|xperm) != 0) {
            kfree(mem);                        // 실패 시 되감기
            uvmdealloc(pagetable, a, oldsz);
            return 0;
        }
    }
    return newsz;
}
```

### uvmdealloc

- 해제할 페이지 수를 계산(페이지 정렬)하고, 페이지 테이블 엔트리 제거 + 물리 메모리 해제:
```c
uint64 uvmdealloc(pagetable_t pagetable, uint64 oldsz, uint64 newsz) {
    if (newsz >= oldsz) return oldsz;
    if (PGROUNDUP(newsz) < PGROUNDUP(oldsz)) {
        int npages = (PGROUNDUP(oldsz) - PGROUNDUP(newsz)) / PGSIZE;
        uvmunmap(pagetable, PGROUNDUP(newsz), npages, 1);
    }
    return newsz;
}
```

### uvmunmap

- 각 가상 페이지의 PTE를 walk()로 찾고, do_free가 설정되면 kfree()로 물리 페이지 해제, PTE를 0으로 지워 VA→PA 매핑 제거. PTE가 없으면 그냥 continue (lazy-allocation 대응):
```c
void uvmunmap(pagetable_t pagetable, uint64 va, uint64 npages, int do_free) {
    uint64 a; pte_t *pte;
    if ((va % PGSIZE) != 0) panic("uvmunmap: not aligned");
    for (a = va; a < va + npages*PGSIZE; a += PGSIZE) {
        if ((pte = walk(pagetable, a, 0)) == 0) continue;   // lazy: PTE 없음
        if ((*pte & PTE_V) == 0) continue;                  // lazy: 물리 페이지 없음
        if (do_free) {
            uint64 pa = PTE2PA(*pte);
            kfree((void*)pa);
        }
        *pte = 0;
    }
}
```

### uvmcopy

- fork에서 부모 주소 공간을 자식으로 복사할 때 사용:
```c
uint64 uvmcopy(pagetable_t old, pagetable_t new, uint64 sz) {
    for (i = 0; i < sz; i += PGSIZE) {
        if ((pte = walk(old, i, 0)) == 0) panic("uvmcopy: pte should exist");
        if ((*pte & PTE_V) == 0) panic("uvmcopy: page not present");
        pa = PTE2PA(*pte);              // 1. 옛 페이지 테이블에서 PA와 플래그 얻기
        flags = PTE_FLAGS(*pte);
        if ((mem = kalloc()) == 0) goto err;   // 2. 새 물리 페이지 할당
        memmove(mem, (char*)pa, PGSIZE);        // 3. memmove로 데이터 복사
        if (mappages(new, i, PGSIZE, (uint64)mem, flags) != 0) {
            kfree(mem);                          // 4. 새 페이지 테이블에 연결
            goto err;
        }
    }
    return 0;
err:
    uvmunmap(new, 0, i / PGSIZE, 1);
    return -1;
}
```

### 데이터 전송 헬퍼 함수

- copyin(pagetable, dst, srcva, len): 사용자 공간(srcva) → 커널 공간으로 데이터 복사.
- copyinstr(pagetable, dst, srcva, max): 사용자 공간에서 null 종료 문자열 복사.
- copyout(pagetable, dstva, src, len): 커널 공간 → 사용자 공간(dstva)으로 데이터 복사.

## Hands-on Lab: Alarm 시스템 콜 만들기

### 개요

- 목표: 프로세스가 CPU 시간을 소비함에 따라 주기적으로 알림을 주는 기능 구현. 새 시스템 콜 2개 추가: sigalarm(interval, handler)와 sigreturn().
- `sigalarm(int interval, void (*handler)())`:
  - 사용자 응용이 sigalarm(n, fn)을 부르면, 프로세스가 CPU tick을 n개 소비할 때마다 커널이 사용자 함수 fn이 호출되게 해야 함.
  - interval 0으로 부르면 커널은 주기적 알람 호출 생성을 중단해야 함.
- `sigreturn()`:
  - 모든 핸들러 함수는 마지막에 sigreturn()을 호출한다고 가정.
  - 원래 컨텍스트를 복원하고, 알람 상태를 리셋하고, 중단됐던 사용자 응용을 재개.

### 브랜치 설정

```bash
cd <path_to_your_own_sandbox_repo>
git switch sandbox/base
git branch sandbox/lab11
git switch sandbox/lab11
```
- 스켈레톤 코드는 제공된 커밋에서 확인 가능. TA 코드는 xv6-sandbox 저장소의 sandbox/lab11 브랜치에 업로드됨.

### 구현 검증

- `$ alarmtest`로 검증:
  - test0: 기본 알람 기능 (tick 카운트 & 핸들러 점프).
  - test1: 여러 번의 핸들러 실행.
  - test2: 무거운 워크로드에서의 핸들러 실행.
  - test3: 사용자 프로세스 컨텍스트의 올바른 저장/복원.
