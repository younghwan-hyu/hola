# 랩 14: File System 2 (xv6의 파일 시스템 — inode부터 파일 디스크립터까지)

- 원본: lab_14_file_system2.pdf
- 과목: 운영체제 실습, 한양대학교
- 파일 시스템 계층 복습: File descriptor → Pathname → Directory → Inode → Logging → Buffer cache → Disk

## 블록 할당자 (Block Allocator)

- 블록은 free pool에서 할당됨. 디스크의 비트맵(bitmap)이 사용 중/빈 데이터 블록을 관리 — 블록당 1비트. 비트맵 블록 하나(1024바이트)가 1024×8개의 데이터 블록을 관리.

### balloc (kernel/fs.c)

- 비트맵을 사용해 pool에서 블록 하나를 할당:
```c
static uint balloc(uint dev) {
    for (b = 0; b < sb.size; b += BPB) {          // BPB = Bitmap bits per Block (= BSIZE×8)
        bp = bread(dev, BBLOCK(b, sb));           // BBLOCK = 대상 비트가 있는 블록 번호
        for (bi = 0; bi < BPB && b + bi < sb.size; bi++) {
            m = 1 << (bi % 8);
            if ((bp->data[bi/8] & m) == 0) {      // 블록이 빈가? (비트가 0인 블록 탐색)
                bp->data[bi/8] |= m;              // 사용 중으로 표시
                log_write(bp);
                brelse(bp);
                bzero(dev, b + bi);
                return b + bi;
            }
        }
        brelse(bp);
    }
}
```
- 한 번에 한 프로세스만 하나의 비트맵 블록을 사용할 수 있음 (버퍼의 sleeplock 덕분).

### bfree (kernel/fs.c)

- 사용한 블록을 비트맵으로 pool에 반환. 해당 비트를 클리어 (`bp->data[bi/8] &= ~m;` 후 log_write). 이미 빈 블록을 해제하려 하면 panic("freeing free block").

## Inode 계층

- inode = 파일의 메타데이터(크기, 데이터 블록 위치 등)를 저장하는 자료구조. 두 종류:
  - **On-disk inode (struct dinode)**: 디스크의 연속된 inode 블록 영역에 고정 크기로 저장.
  - **In-memory inode (struct inode)**: on-disk inode의 복사본 + 커널 전용 추가 정보. 활발히 접근되는 inode들은 itable이라는 배열로 관리.
- 인터페이스: iget, iput / ialloc, itrunc / ilock, iunlock / iupdate / readi, writei.

### On-disk inode (kernel/fs.h)

```c
struct dinode {
    short type;              // free(0) / 파일 / 디렉터리 / 특수 파일(장치)
    short major;
    short minor;
    short nlink;             // 이 inode를 참조하는 디렉터리 엔트리 수
    uint size;               // 파일 내용의 바이트 수
    uint addrs[NDIRECT+1];   // 파일의 블록 번호 배열
};   // 총 64바이트 (4 × 16) — 1024B 블록 하나에 16개의 dinode
```

### In-memory inode (kernel/file.h)

```c
struct inode {
    uint dev;
    uint inum;               // 디스크의 n번째 inode
    int ref;                 // 이 in-memory inode를 참조하는 포인터 수
    struct sleeplock lock;
    int valid;               // inode가 유효한가(1)/아닌가(0)
    // 이하 dinode의 복사본:
    short type; short major; short minor; short nlink;
    uint size;
    uint addrs[NDIRECT+1];
};
```
- 커널은 참조하는 포인터가 있을 때만 inode를 유지. 포인터가 될 수 있는 것: 파일 디스크립터, 현재 작업 디렉터리, 일시적인 커널 코드 등.

### inode 내용과 최대 파일 크기

- NDIRECT = 12. addrs[0..11]은 DIRECT 블록 (데이터 블록을 직접 가리킴), addrs[12]는 INDIRECT 블록 (블록 번호 256개를 담는 블록을 가리킴).
- 모두 DIRECT라면 최대 파일 크기 = NDIRECT(13으로 가정 시) × BSIZE(1024) 바이트에 불과.
- 하나를 INDIRECT로 쓰면: 최대 파일 크기 = NDIRECT(12) × 1024 + (BSIZE/4 = 256) × 1024 바이트.

### bmap (kernel/fs.c)

- inode ip의 bn번째 데이터 블록의 블록 번호를 반환:
  - bn < NDIRECT: `ip->addrs[bn]`이 0이면 balloc으로 할당해 채우고 반환.
  - bn ≥ NDIRECT: bn -= NDIRECT 후, indirect 블록(`ip->addrs[NDIRECT]`)이 없으면 할당. indirect 블록을 bread로 읽어 `a[bn]`이 0이면 balloc으로 할당하고 log_write.
  - bn > 최대 파일 크기면 panic (2단계 간접(second-level indirection)으로 확장 가능).
- **bmap은 addr 엔트리가 0일 때(아직 블록 미할당) on-demand로 블록을 할당함.**

### inode 인터페이스 요약

| 함수 | 역할 |
|---|---|
| ialloc | 디스크에 새 inode 할당 |
| itrunc | 디스크에서 inode의 모든 블록 해제 |
| iget | 메모리의 inode에 대한 참조 획득 (비배타적 접근) |
| iput | 메모리의 inode에 대한 참조 반납 |
| ilock | inode 잠금 (배타적 접근 제공) |
| iunlock | inode 잠금 해제 |
| iupdate | 메모리의 수정된 inode를 디스크의 inode에 기록 |
| readi | inode에서 데이터 읽기 |
| writei | inode에 데이터 쓰기 |

### ialloc

- 디스크에 새 inode 할당. inum 1부터 sb.ninodes까지 순회하며 IBLOCK(inum, sb)로 inode가 있는 블록을 읽고 (IPB = 블록당 inode 수 = BSIZE/sizeof(dinode)), type == 0인 빈 dinode를 찾으면 type을 설정하고 log_write로 할당 표시 후 iget(dev, inum) 반환. 한 번에 한 프로세스만 inode가 담긴 블록 하나를 사용 가능.

### itrunc

- inode의 모든 블록을 해제하고 크기를 0으로 리셋: (1) direct 데이터 블록들 bfree, (2) indirect 블록이 가리키는 데이터 블록들 bfree, (3) indirect 블록 자체 bfree. 마지막에 ip->size = 0 후 iupdate(ip).

### iget

- inode 캐시(itable)에서 활성 inode 엔트리 반환 (in-memory). itable은 ref > 0인 활성 inode들을 담음:
  - 캐시 히트: ref++ 후 반환.
  - 캐시 미스: 기억해둔 빈 슬롯(ref == 0)을 재활용 — dev/inum 설정, ref = 1, **valid = 0** (무효화). 빈 슬롯이 없으면 panic("iget: no inodes").
- **iget은 비배타적 접근 제공**: 같은 inode에 여러 포인터가 있을 수 있음. 반환된 엔트리는 아직 유효하지 않을 수 있으므로, 사용하려면 ilock이 필요 (배타적 접근 제공).

### iput

- 활성 inode 엔트리의 참조 카운트 감소. 마지막 참조(ref == 1)이고 valid이며 nlink == 0이면 (링크도 없으면):
  1. itrunc(ip)로 디스크의 inode를 truncate.
  2. type = 0으로 디스크의 inode 해제 후 iupdate.
  3. valid = 0으로 메모리의 inode를 무효화해 빈 슬롯을 재사용 가능하게 함.

### ilock / iunlock

- ilock: inode를 잠금 (acquiresleep). 필요하면 디스크에서 inode를 읽음 — valid == 0이면 bread로 dinode를 읽어 필드들을 복사하고 valid = 1 (type == 0이면 panic). 한 프로세스만 진행하고 나머지는 그 inode에서 sleep.
- iunlock: inode 잠금 해제 (releasesleep) — 그 inode에서 자는 프로세스들을 깨움.

### iupdate

- 메모리의 수정된 inode로 디스크의 inode를 갱신: bread로 해당 블록을 읽어 dinode 필드들을 복사하고 log_write.

### readi

- inode ip에서 off부터 n바이트 읽기:
  - off > 파일 크기이거나 오버플로면 실패(0). off + n이 파일 크기를 넘으면 n을 줄임 — 파일 크기 이상은 읽을 수 없음.
  - 루프: bmap(ip, off/BSIZE)으로 off가 속한 데이터 블록 번호를 얻고 → bread로 버퍼에 로드 → either_copyout으로 버퍼에서 dst로 복사 (m = min(n - tot, BSIZE - off%BSIZE)씩).

### writei

- inode ip에 off부터 n바이트 쓰기:
  - off > 파일 크기이거나 오버플로면 -1. off + n > MAXFILE×BSIZE면 -1 — **파일 크기 너머로 쓸 수는 있지만 최대 파일 크기는 초과 불가.**
  - 루프: bmap으로 블록 번호 획득 (없으면 on-demand 할당) → bread → either_copyin으로 src에서 버퍼로 복사 → log_write.
  - 쓰기가 파일을 확장했다면 inode의 size를 갱신해야 함 (`if (off > ip->size) ip->size = off;`) 후 iupdate(ip).

## 디렉터리 계층 (Directory Layer)

- 디렉터리 = 디렉터리 엔트리들의 시퀀스를 담는 특수 파일 (type이 T_DIR).
- 디렉터리 엔트리(struct dirent)는 이름과 파일의 inode 번호를 담음. 이름은 DIRSIZ(14)를 초과할 수 없음:
```c
struct dirent {
    ushort inum;
    char name[DIRSIZ];
};
```
- 예: 어떤 디렉터리의 엔트리들 — (5, "."), (6, ".."), (9, "hello.c"), (11, "hello"), (15, "lib").

### dirlookup

- 디렉터리 안에서 주어진 이름의 엔트리 검색. dp->type != T_DIR이면 panic:
  - 디렉터리 크기만큼 sizeof(de)씩 readi로 읽으며 namecmp로 비교.
  - 찾으면: iget()으로 해당 inode 반환, *poff에 찾은 엔트리의 바이트 오프셋 저장.
- **반환되는 inode는 잠기지 않음(not locked)**: 호출자가 이미 디렉터리의 락을 쥐고 있고, ("."처럼 같은 inode일 때) 다시 잠그면 교착상태가 날 수 있기 때문.

### dirlink

- 디렉터리에 새 엔트리 (name, inum) 추가:
  - 이름이 이미 존재하면 (dirlookup으로 확인) iput 후 -1 반환.
  - 없으면: 빈 엔트리(inum == 0)를 찾아 재사용하거나, 없으면 디렉터리 끝에 추가.
  - strncpy로 이름 복사, de.inum = inum 설정 후 writei()로 결정된 오프셋에 struct dirent 기록.

## 경로명 계층 (Pathname Layer)

- Pathname은 파일 위치를 지정. 구분자 "/"로 디렉터리 트리 계층을 문자열로 표현.
  - 절대 경로: "/"로 시작, 전체 위치 제공 (예: /usr/src/hello.c).
  - 상대 경로: 주어진 작업 디렉터리에서 시작.

### 경로 해석 함수 (kernel/fs.c)

- namei(path): 경로의 마지막 구성요소의 inode 반환. 예: "a/b/c" → "c"의 inode.
- nameiparent(path, name): 마지막 구성요소의 부모 디렉터리 inode를 반환하고 마지막 구성요소를 name에 복사. 예: "a/b/c" → "b"의 inode, name = "c".
- namex(path, nameiparent, name): 디렉터리를 한 단계씩 순회하며 경로 해석:
  - 경로가 '/'로 시작하면 루트에서 시작: `ip = iget(ROOTDEV, ROOTINO)` (절대 경로). 아니면 현재 작업 디렉터리에서: `ip = idup(myproc()->cwd)` (상대 경로).
  - skipelem으로 경로 요소를 하나씩 꺼냄. 예: skipelem("a/bb/c", name) = "bb/c" (name="a"), skipelem("//a//bb", name) = "bb" (name="a"), skipelem("a", name) = "" (name="a"), skipelem("", name) = 0.
  - 루프: ilock(ip) → T_DIR이 아니면 실패 → nameiparent이고 마지막 요소면 한 단계 일찍 멈춰 부모 inode 반환 → dirlookup(ip, name, 0)으로 다음 요소 검색 → iunlockput(ip) 후 ip = next로 다음 반복 준비.

## 파일 디스크립터 계층 (File Descriptor Layer)

- Unix의 대부분의 자원(콘솔, 파이프, 소켓, 실제 파일 등)이 파일로 표현됨.
- 각 프로세스는 자기만의 열린 파일 테이블(파일 디스크립터 테이블, p->ofile[NOFILE])을 가짐.

### struct file (kernel/file.h)

```c
struct file {
    enum { FD_NONE, FD_PIPE, FD_INODE, FD_DEVICE } type;
    int ref;          // 참조 카운트
    char readable;
    char writable;
    struct pipe *pipe;
    struct inode *ip;
    uint off;         // 독립적인 I/O 오프셋
    short major;
};
```
- file 구조체 = inode(또는 파이프)의 래퍼 + 독립적인 I/O 오프셋.
- 여러 프로세스가 같은 파일을 각자 open하면 각자 자기 file 인스턴스와 서로 다른 오프셋을 가짐.
- 하나의 열린 파일이 한 프로세스의 테이블에 여러 번(dup), 다른 프로세스의 테이블에도(fork) 나타날 수 있음.

### ftable과 인터페이스

- 시스템의 모든 열린 파일은 전역 파일 테이블 ftable에서 관리 (`struct { struct spinlock lock; struct file file[NFILE]; } ftable;`). 각 프로세스는 이 열린 파일들에 대한 포인터 배열 유지.
- 인터페이스: filealloc, filedup, fileclose, fileread, filewrite.
- filealloc(): 전역 파일 테이블에서 ref == 0인 struct file을 스캔해 새 열린 파일 구조체를 할당 (ref = 1로 설정 후 반환).
- filedup(): struct file의 참조 카운트 증가 — 여러 파일 디스크립터가 같은 열린 파일을 참조할 수 있게 함.
- fileclose(): 참조 카운트 감소. 0이 되면 연관 자원 해제 — 파이프면 pipeclose, inode/장치면 begin_op; iput(ff.ip); end_op.
- fileread() / filewrite(): 열린 파일에서 읽기/쓰기. inode를 쓰는 파일이면 현재 오프셋에서 디스크를 읽고/쓰고, 파이프면 오프셋 없이 읽고/씀.

## 파일 시스템의 시스템 콜 (kernel/sysfile.c)

### sys_open

- 기존 파일을 열거나 필요하면 새로 만들어, 프로세스의 파일 디스크립터 테이블에 연결:
  - begin_op()로 트랜잭션 시작 후:
    - O_CREATE가 설정됐으면 create()로 새 inode 할당·초기화.
    - 아니면 namei()로 경로의 파일 조회 후 ilock. 디렉터리를 O_RDONLY가 아닌 모드로 열려 하면 실패.
  - file 구조체 초기화: 파일 유형(FD_DEVICE 또는 FD_INODE), 오프셋(0), inode 포인터 설정. omode에 따라 readable/writable 설정.
  - O_TRUNC이고 T_FILE이면 itrunc()로 파일 truncate.
  - iunlock 후 end_op()로 트랜잭션 종료, 할당된 파일 디스크립터 반환.

### create

- 지정된 경로에 파일/디렉터리/장치용 새 inode와 디렉터리 엔트리를 생성:
  1. nameiparent()로 부모 디렉터리 위치 확인 후 ilock(dp).
  2. dirlookup()으로 이름이 이미 존재하는지 확인 — 존재하고 T_FILE 요청이며 기존이 파일/장치면 그 inode 반환, 아니면 실패.
  3. ialloc()으로 새 inode 할당·초기화 (major, minor, nlink = 1, iupdate).
  4. 디렉터리라면 dirlink()로 "."과 ".." 엔트리 생성 ("."에 대해 ip->nlink++는 하지 않음 — 순환 참조 카운트 방지).
  5. dirlink(dp, name, ip->inum)으로 부모 디렉터리에 새 엔트리 추가. 디렉터리면 ".." 참조를 위해 dp->nlink++ 후 iupdate(dp).

### sys_read / sys_write

- 단순히 인자(argaddr, argint, argfd)를 꺼내 fileread / filewrite를 호출.

## 계층 통합 (Putting the layers together)

- `open("/d/f", O_CREATE)`의 흐름:
  - sys_open → create / namei (File descriptor → Pathname)
  - namex + skipelem이 경로를 순회 (Pathname)
  - dirlookup / dirlink가 이름 해석 (Directory)
  - ialloc · iget · ilock으로 inode 획득 (Inode)
  - filealloc + fdalloc이 fd 반환 (File descriptor)
- `read(fd, …)` / `write(fd, …)`의 흐름:
  - fileread / filewrite (File descriptor)
  - readi / writei → bmap (Inode)
  - bread / log_write (Buffer cache / Logging)
  - virtio_disk_rw (Disk)
