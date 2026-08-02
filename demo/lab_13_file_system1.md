# 랩 13: File System 1 (xv6의 파일 시스템 — 버퍼 캐시와 로깅)

- 원본: lab_13_file_system1.pdf
- 과목: 운영체제 실습, 한양대학교

## 파일 시스템이란

- 데이터를 조직·저장하는 시스템. 사용자·응용 간 데이터 공유를 지원하고, 재부팅 후에도 데이터가 남는 영속성(persistence)을 제공.
- 파일 시스템은 블록 장치(HDD, SSD 등) 위에 구축됨.

### 파일 시스템의 과제 (Challenges)

1. 온디스크 자료구조 필요: 이름 있는 디렉터리·파일 트리 표현, 각 파일 내용을 담은 블록들의 식별, 디스크의 빈 영역 기록.
2. 크래시 복구 (crash recovery) 지원: 크래시(예: 정전)가 나도 재시작 후 파일 시스템이 올바로 동작해야 함.
3. 여러 프로세스 간 일관성 (consistency).
4. 성능을 위한 인메모리 캐시 유지.

## 파일 시스템 계층 (File System Layers)

| 계층 | 역할 |
|---|---|
| File descriptor | 파일·파이프·장치에 대한 추상화 |
| Pathname | 계층적 경로 이름 제공 (경로 해석) |
| Directory | 디렉터리를 특별한 종류의 노드(이름-번호 쌍 리스트)로 표현 |
| Inode | 개별 파일의 메타데이터 제공 (파일마다 고유 i-number) |
| Logging | 여러 블록에 대한 갱신을 트랜잭션으로 감싸 원자성 보존 |
| Buffer cache | 디스크 블록 접근을 캐싱·동기화 |
| Disk | virtio 디스크에 읽기/쓰기 |

## 온디스크 파일 시스템 구조 (On-disk File System Structure)

- xv6는 디스크(블록 크기 1024B)를 여러 섹션으로 분할:
  - **Boot (블록 0)**: 부팅 중에만 사용.
  - **Superblock (블록 1)**: 파일 시스템의 메타데이터.
  - **Log (블록 2부터)**: 로그 저장.
  - **Inodes (로그 다음)**: inode들 저장.
  - **Bitmap (inode 다음)**: 어떤 데이터 블록이 사용 중인지 추적.
  - **Data (나머지 블록)**: 실제 내용 저장.

## 버퍼 캐시 계층 (Buffer Cache Layer)

- 버퍼 캐시 = 디스크 블록을 임시로 담는 메모리 영역. 파일 시스템과 물리 디스크 사이의 중개자.
- 두 가지 목표:
  - **캐싱 (Caching)**: 자주 접근하는 블록을 메모리에 유지해 느린 디스크 접근을 줄이고 성능 향상.
  - **동기화 (Synchronization)**: 디스크 블록의 사본이 메모리에 하나만 존재하고, 한 번에 하나의 커널 스레드만 접근하도록 보장.
- 인터페이스: bread, bwrite, bget, brelse.

### 자료구조 (kernel/buf.h, kernel/bio.c)

```c
struct buf {
    int valid;             // 데이터가 디스크에서 읽혀 있는가
    int disk;              // 디스크가 이 버퍼를 소유 중인가
    uint dev;
    uint blockno;
    struct sleeplock lock;
    uint refcnt;
    struct buf *prev;
    struct buf *next;
    uchar data[BSIZE];
};

struct {
    struct spinlock lock;
    struct buf buf[NBUF];
    struct buf head;       // 이중 연결 리스트의 머리
} bcache;
```

### binit

- 버퍼 캐시는 버퍼들의 이중 연결 리스트(doubly-linked list). binit이 NBUF개의 버퍼를 head 뒤에 차례로 끼워 넣어 리스트 구성. head.next 쪽이 Most Recently Used, head.prev 쪽이 Least Recently Used.

### bget

- 요청된 (dev, blockno) 블록이 버퍼 캐시에 이미 있는지 확인:
  - 캐시에 있으면: refcnt++ 후 그 버퍼의 sleeplock을 잡아 반환.
  - 없으면: LRU(Least Recently Used) 정책에 따라 refcnt == 0인 빈 버퍼를 뒤에서부터 찾아 재사용 (dev/blockno 설정, valid = 0, refcnt = 1).
  - 빈 버퍼가 없으면 panic("bget: no buffers").
- 반환된 버퍼는 sleeplock으로 보호되어 상호 배제 보장.

### bread / bwrite

- bread(): 디스크 블록을 메모리로 로드. bget()으로 버퍼를 얻고, valid가 아니면 virtio_disk_rw(b, 0)으로 디스크에서 읽은 후 valid = 1.
- bwrite(): 수정된 버퍼를 디스크에 기록. 버퍼의 sleeplock을 쥔 상태여야 함 (아니면 panic). virtio_disk_rw(b, 1)로 기록.

### brelse

- 사용이 끝난 버퍼를 재사용 가능하게 표시:
  - 버퍼의 sleeplock 해제 (다른 스레드가 잡을 수 있게).
  - refcnt-- 후 0이 되면 (아무도 기다리지 않으면) 리스트에서 빼서 **맨 앞(head.next)으로 이동** — 가장 최근 사용됨을 표시.
  - 이 재배열이 LRU 정책을 유지: 최근 쓰인 버퍼는 앞에, 오래된 것은 뒤로 밀림 (bget의 재사용 스캔은 뒤에서부터).

## 로깅 계층 (Logging Layer)

### 왜 로깅이 필요한가

- 많은 파일 시스템 연산이 여러 번의 디스크 쓰기를 수반 → 도중에 크래시가 나면 디스크가 불일치 상태로 남을 수 있음 (예: 해제된 블록을 참조하는 inode). 데이터 손상이나, 특히 다중 사용자 환경에서 보안 문제로 이어질 수 있음.
- 로깅: 모든 디스크 쓰기의 기술(description)을 디스크의 로그 섹션에 먼저 기록. 모든 쓰기를 로그한 후 커밋(commit). 커밋 시점을 기준으로 쓰기의 원자성(atomicity)이 보존됨 — "All or nothing".
- 복구(Recovery): 재부팅 시 로그를 사용해 기록된 데이터를 디스크에 반영(mirror)하는 과정. 멱등(idempotent)이라 여러 번 해도 안전.

### xv6의 로깅 설계

1. 로그는 superblock에 명시된 고정 위치에 상주.
2. 각 파일 시스템(FS) 시스템 콜이 쓰기 시퀀스의 시작과 끝을 표시: begin_op(), end_op().
3. 로깅 시스템은 효율과 동시성을 위해 여러 시스템 콜의 쓰기를 하나의 트랜잭션으로 누적.
4. 여러 트랜잭션을 함께 커밋하는 group commit으로 여러 디스크 연산을 배치 처리.
5. xv6의 write 시스템 콜은 큰 쓰기를 로그에 들어갈 만한 여러 작은 쓰기로 쪼갬.

### 트랜잭션의 전형적 사용

```c
begin_op();          // 트랜잭션 시작
...
b = bread(...);      // 버퍼 읽기
b->data[...] = ...;  // 데이터 수정
log_write(b);        // 로그 쓰기 (bwrite 대신)
...
end_op();            // 트랜잭션 끝
```

### 로그 구조 (kernel/log.c)

```c
struct logheader {
    int n;                  // 수정된 블록 수
    int block[LOGSIZE];     // 그 블록들의 섹터 번호
};
struct log {
    struct spinlock lock;
    int start;
    int size;
    int outstanding;        // 진행 중인 FS 시스템 콜 수
    int committing;         // 커밋 진행 중 여부
    int dev;
    struct logheader lh;
};
```
- Header Block: 수정된 블록 수(n)와 블록 섹터 번호들(block[])을 저장 — 디스크의 log.start에 기록.
- Logged Blocks: 실제 수정된 블록의 복사본 — 파일 시스템에 적용되기 전에 디스크의 로그 영역에 기록됨.

### begin_op

- 새 파일 시스템 연산의 시작에서 호출. 로깅을 진행할지 판단:
  - log.committing이면 (누가 커밋 중이면) sleep으로 대기.
  - `log.lh.n + (log.outstanding+1)*MAXOPBLOCKS > LOGSIZE`면 (이 연산이 로그 공간을 소진할 수 있으면) 커밋을 기다림.
  - 아니면 log.outstanding += 1 후 진행. outstanding 증가의 의미: (1) 로그 공간 예약, (2) group commit에 참여.

### log_write

- 블록 번호를 메모리에 기록해 디스크 로그의 슬롯을 예약. bwrite의 대체물:
  - **Log absorption**: 같은 블록이 여러 번 쓰이면 로그에서 같은 슬롯을 재사용.
  - **Eviction 방지**: bpin(b)으로 버퍼를 블록 캐시에 고정해 캐시에서 쫓겨나지 않게 함.
  - 트랜잭션이 너무 크거나(log.lh.n >= LOGSIZE) 트랜잭션 밖에서 호출되면(outstanding < 1) panic.

### end_op

- 파일 시스템 연산의 끝에서 호출. outstanding 카운트 감소. 카운트가 0이 되면 현재 트랜잭션을 커밋 (do_commit = 1, log.committing = 1).
- **Group commit**: 진행 중인 FS 시스템 콜이 없을 때만 커밋 — 여러 시스템 콜의 쓰기를 한 번에.
- 커밋은 락을 쥐지 않은 채 호출 (락을 쥔 채 sleep 불가하므로). 끝나면 log.committing = 0 후 wakeup(&log).

### commit의 4단계

```c
static void commit() {
    if (log.lh.n > 0) {
        write_log();      // 1. 수정된 블록들을 캐시에서 로그로 기록
        write_head();     // 2. 헤더를 디스크에 기록 (진짜 커밋 시점)
        install_trans(0); // 3. 쓰기들을 원래 위치(home locations)에 설치
        log.lh.n = 0;
        write_head();     // 4. 로그에서 트랜잭션 지우기
    }
}
```
1. **write_log**: 트랜잭션에서 수정된 각 블록을 버퍼 캐시에서 디스크 로그의 슬롯으로 복사 (bread로 로그 블록과 캐시 블록을 읽어 memmove 후 bwrite).
2. **write_head**: 헤더 블록을 디스크에 기록 — **실제 커밋 지점 (Actual Commit Point)**: 로그 헤더가 디스크에 쓰인 후에는 복구가 redo log를 읽어 기록된 블록을 복원할 수 있음.
3. **install_trans**: 로그에서 각 블록을 읽어 파일 시스템의 제 위치에 기록 (bread로 로그 블록과 목적지 블록을 읽어 memmove 후 bwrite, 복구 중이 아니면 bunpin).
4. **로그 지우기**: 카운트 0으로 로그 헤더를 다시 기록 — 다음 트랜잭션이 로그 블록을 쓰기 시작하기 전에 반드시 0으로 설정해야 함.

### 복구 (Recovery)

- recover_from_log: 로그 헤더를 읽고(read_head) end_op의 동작을 흉내:
```c
static void recover_from_log(void) {
    read_head();
    install_trans(1);   // 커밋된 트랜잭션이 있으면 재적용 (redo)
    log.lh.n = 0;
    write_head();       // 로그 클리어
}
```

### filewrite 시스템 콜 (kernel/file.c)

- 루프가 큰 쓰기를 개별 트랜잭션들로 쪼개 로그 오버플로를 방지:
```c
while (i < n) {
    begin_op();
    ilock(f->ip);
    if ((r = writei(f->ip, addr + i, f->off, n1)) > 0)
        f->off += r;
    iunlock(f->ip);
    end_op();
    i += r;
}
```
