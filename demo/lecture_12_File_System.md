# 강의 12: File System (파일 시스템)

- 원본: lecture_12_File_System.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 파일 개념 (File Concept)

- 파일 = 데이터와 프로그램을 담는 '컨테이너'. 데이터나 프로그램을 담는 연속적인 논리 주소 공간.
- 유형: 데이터 (numeric / character / binary), 프로그램.

## 파일 구조 (File Structure)

- 없음(None): 단순한 워드·바이트의 나열.
- 단순 레코드 구조: 라인(lines), 고정 길이, 가변 길이.
- 복잡한 구조: 서식 있는 문서, relocatable load file.
- 구조를 누가 결정하는가: 운영체제 또는 프로그램.

## 파일 속성 (File Attributes, 파일 메타데이터)

- Name: 사람이 읽을 수 있는 형태로 유지되는 유일한 정보.
- Type: 여러 파일 유형을 지원하는 시스템에 필요.
- Location: 장치 상 파일 위치에 대한 포인터.
- Size: 현재 파일 크기.
- Protection: 누가 읽기/쓰기/실행할 수 있는지 제어.
- Time, date, user identification: 보호·보안·사용량 모니터링용 데이터.
- 파일에 대한 정보는 디스크에 유지되는 디렉터리(폴더) 구조에 보관됨.

## 파일 연산 (File Operations)

- create, write, read, repositioning within file (file seek), delete, truncate.
- open(Fi): 파일 메타데이터를 디스크에서 메모리로 복사 (이를 위해 디렉터리 구조 검색 필요).
- close(Fi).

## 디렉터리 (Directories)

- 디렉터리의 두 가지 목적:
  - 사용자에게: 관련 파일들을 조직하는 구조화된 방법 제공.
  - 파일 시스템에게: 파일 데이터가 실제로 어디에 있는지 숨길 수 있는 편리한 명명(naming) 인터페이스 제공.
- 대부분의 시스템은 다단계(multi-level) 디렉터리 지원 — 파일 이름이 루트에서 리프까지의 경로를 기술.
- 대부분의 시스템에 current directory (현재 디렉터리)가 있어 절대 경로가 아닌 상대 경로 지정 가능.

### 디렉터리 엔트리 (A Directory Entry)

- 디렉터리는 파일에 대한 논리 정보를 기술: 파일 이름, 크기, 유형, 위치, 보호, 마지막 접근 시간 등.
- 이 정보는 디스크의 자료구조에 저장됨 (그래서 제약이 생길 수 있음).
- OS는 최근 접근한 파일들의 디렉터리 엔트리를 메모리에 캐시함. 캐시가 디스크 원본과 일관성이 유지되어야 하며, 아니면 파일을 잃을 수 있음!

### UNIX의 디렉터리 구조

- 디렉터리 엔트리 = 파일 이름 + 그 파일의 inode 포인터 (서브디렉터리용 엔트리도 있을 수 있음).
- inode = 파일의 메타데이터. 메타데이터에는 파일의 데이터 블록들에 대한 포인터가 포함됨.
- 구조: 디렉터리(filename → inode) → inode들 → 파일의 실제 데이터.

### 디렉터리 구현 (Directory Implementation)

- 선형 리스트 (Linear list): 파일 이름 + 메타데이터(UNIX에서는 inode 포인터)의 선형 리스트. 프로그래밍은 단순하지만 특정 엔트리를 찾으려면 선형 검색이라 시간 소모.
- 해시 테이블 (Hash Table): 선형 리스트 + 추가 해시 테이블. 해시 테이블이 파일 이름을 그 파일의 포인터로 변환 → 디렉터리 검색 시간 감소. 충돌(collision, 두 파일 이름이 같은 위치로 해싱) 처리 필요.

### 디렉터리에 수행되는 연산

- 파일 검색, 파일 생성, 파일 삭제, 디렉터리 나열(list), 파일 이름 변경, 파일 시스템 순회(traverse).

## 디렉터리 구조의 발전

### 단일 레벨 디렉터리 (Single-Level Directory)

- 모든 사용자가 하나의 디렉터리 사용.
- 명명 문제 (이름 충돌; UNIX 파일명은 255자), 그룹화 문제.

### 2레벨 디렉터리 (Two-Level Directory)

- 사용자마다 별도의 디렉터리.
- "Pathname" 개념 등장. 사용자 간 이름 충돌 없음. 그룹화 능력은 없음.

### 트리 구조 디렉터리 (Tree-Structured Directories)

- 서브디렉터리 허용, 그룹화 가능.
- Home directory, current (working) directory, 절대/상대 경로명 (예: cd /sykang/ch1).
- Search path (명령어 해석기가 명령을 찾는 경로).
- 삭제 시 문제: 디렉터리가 비어 있는지(empty) 검사 — 편의와 위험 사이의 선택.

### 비순환 그래프 디렉터리 (Acyclic-Graph Directories)

- 같은 {서브디렉터리, 파일}이 두 개의 다른 디렉터리에 있을 수 있음 (공유). 사이클은 불허 (acyclic).
- 문제: 1. 순회 문제 (같은 노드를 두 번 방문), 2. 삭제 문제.
- 시나리오: Kang이 서브디렉터리 X를 가짐 (Kang에 X 엔트리 존재). Jung도 자기 디렉터리 아래에 X가 필요. UNIX는 Jung의 디렉터리에 "링크"(새 디렉터리 엔트리)를 만듦.
- 링크 유형 1 — Symbolic link (심볼릭 링크): 링크는 X에 대한 경로명 (간접 포인터).
  - 문제: Kang에서 X가 삭제되면 Jung의 링크는 dangling reference가 됨. Jung이 X에 접근하면 "illegal file" 오류.
- 링크 유형 2 — Hard link (하드 링크): Kang 디렉터리의 디렉터리 엔트리를 Jung에게 복사.
  - X가 갱신될 때 일관성 문제.
  - X를 어떻게 삭제하나?: reference count (참조 카운트)를 유지, 0이 되면 X 삭제.

### 일반 그래프 디렉터리 (General Graph Directory)

- 사이클 허용. 순회와 삭제 알고리즘이 복잡해짐.
- 순회: 사이클 안에서 무한 루프를 피해야 함.
- 삭제: Kang이 X를 지워도 (자기 참조나 사이클 때문에) X의 reference count > 0 → X가 해제되지 않음 → 가비지 컬렉션 필요: 접근 불가능한 노드를 표시(mark)하고 해제(free) — 시간이 많이 걸림!
- 사이클이 없음을 보장하는 방법: 파일에 대한 링크만 허용 (서브디렉터리는 불허), 또는 새 링크를 추가할 때마다 사이클 탐지 알고리즘으로 확인.

## 보호 (Protection)

- 파일 소유자/생성자가 제어할 수 있어야 하는 것: 어떤 연산을, 누가 수행할 수 있는지.
- 접근 유형: Read, Write, Execute, Append, Delete, List (이름·속성 나열).
- 접근 제어: 접근 제어 행렬(access control matrix)은 너무 큼! → Unix는 전체 사용자를 세 부류로 나눔: user(owner) / group / others, 각각 rwx 비트.
- 예: (a) owner access 7 = RWX 111, (b) group access 6 = RW- 110, (c) public access 1 = --X 001.
- 관리자에게 그룹 G 생성을 요청하고 사용자들을 추가. 특정 파일(예: game)에 적절한 접근 설정: `chmod 761 game` (owner 7, group 6, public 1). 파일에 그룹 부여: `chgrp G game`.

## 파일 시스템 구조 (File-System Structure)

- 파일 시스템은 일반적으로 보조 저장장치(디스크)에 상주하며 계층(layer)으로 조직됨.
- open() 시스템 콜: 지정된 파일의 메타데이터를 디스크에서 메모리로 로드 (디렉터리 구조 검색 필요).
- Open-file table: 메모리에 있는(열린) 파일들의 메타데이터 저장.
- File descriptor (file handle, file control block): open-file table에 대한 인덱스.
- 왜 필요한가?: 디렉터리 검색은 비쌈 (예: /a/b/c/d/e.hwp → 여러 번의 디스크 I/O). 디스크에 파일이 매우 많음. 한 번 열어두면 이후 접근은 테이블 인덱스로 빠르게.

## 파일 시스템 마운트 (Mounting File System)

- "root file system" (/, bin, etc, usr 등)이 HD에 있으면 루트 파일 시스템 아래 모든 파일에 접근 가능.
- 다른 FS(CD, USB 등)의 파일에는 어떻게 접근하나? → 마운트(mount): 다른 파일 시스템의 루트를 기존 트리의 한 지점에 붙임. 마운트하면 그 아래로 접근 가능.

## 디스크에서의 파일 데이터 할당 (Allocation of File Data in Disk)

### 연속 할당 (Contiguous Allocation)

- 각 파일이 디스크의 연속된 블록 집합을 차지.
- 장점: 단순 (시작 위치(블록 번호)와 길이(블록 수)만 필요). 빠른 I/O (한 번의 seek/rotation으로 많은 데이터 전송) — 실시간 파일용, 또는 이미 실행 중이던 프로세스의 스와핑용 (entire R/W 보장).
- 단점: 공간 낭비 (동적 저장 공간 할당 → 외부 단편화 → 수많은 작은 hole). 파일 확장(growth)의 어려움 — 파일 생성 시 얼마나 큰 hole을 배당할 것인가? (확장 가능성 vs 내부 단편화 낭비).

### 연결 할당 (Linked Allocation)

- 각 파일이 디스크 블록들의 연결 리스트. 블록들은 디스크 어디에나 흩어져 있을 수 있음. 각 블록 = 포인터 + 파일 내용. 필요할 때 할당해 연결 (예: 파일이 블록 9에서 시작).
- 장점: 단순 — 시작 주소만 필요. free-space 관리 시스템 — 공간 낭비 없음.
- 단점:
  - 임의 접근(random access) 불가.
  - 디스크 I/O 효율 나쁨 (매 섹터 I/O마다 seek/rotation).
  - 신뢰성 문제: bad sector로 인한 포인터 유실 → 많은 부분을 잃음.
  - 포인터 공간 (512B 섹터당 4B 포인터 = 0.78%).
- 변형: FAT (File-Allocation Table) — MS Windows와 OS/2가 사용하는 디스크 공간 할당. 포인터들을 테이블로 모아 두어 임의 접근이 빨라짐.

### 인덱스 할당 (Indexed Allocation)

- 각 파일이 자기만의 index block을 가짐 — 디스크 블록 포인터들의 배열.
- 직접 접근(direct access) 가속.
- 파일이 너무 크면? (인덱스 테이블에 디스크 블록 하나로 부족):
  1. Linked scheme: 인덱스 테이블 블록들을 연결 (크기 제한 없음).
  2. Two-level index (2단계 인덱스).
  3. Combined (결합, 예: UNIX).
- UNIX의 결합 방식 (블록당 4KB): inode에 direct blocks + single indirect + double indirect + triple indirect 포인터를 함께 둠.

## 빈 공간 관리 (Free-Space Management)

- Bit map (bit vector): bit[i] = 1이면 block[i] free, 0이면 occupied.
  - 첫 빈 블록의 블록 번호 계산: (워드당 비트 수) × (값이 0인 워드 수) + 첫 1 비트의 오프셋.
  - 추가 공간이 필요하지만, 연속된 파일 공간을 얻기 쉬움.
- Linked list (free list): 모든 빈 블록을 연결. 리스트 순회는 느리지만(디스크 I/O) 자주 하지 않음. 연속 공간을 얻기 어려움. 공간 낭비 없음.
- Grouping: 연결 리스트의 변형 — 첫 빈 블록이 n개의 포인터를 가짐. n−1개는 빈 블록들을, 마지막 하나는 같은 종류의 (포인터를 담은) 블록을 가리킴.
- Counting: (첫 빈 블록, 연속된 빈 블록 수) 쌍을 추적. 일반적으로 여러 연속 블록이 한꺼번에 할당·해제되기 때문.

## 성능 (Performance)

- Disk cache: 자주 쓰는 데이터 블록을 위한 메인 메모리의 별도 구역.
- Free-behind와 Read-ahead: 순차 접근 최적화 기법.
  - Free-behind: 다음 블록을 요청할 때 현재 블록을 해제.
  - Read-ahead: 요청된 페이지와 그 이후 페이지들을 미리 읽어 캐시.
- Virtual disk (RAM disk): 메모리 일부를 디스크처럼 사용해 PC 성능 향상.
- Directory entry cache (dentry cache): 자주 쓰는 디렉터리 엔트리를 메모리에 유지.

## 복구 (Recovery)

- Consistency checker (일관성 검사기): 파일 시스템의 일부는 메모리에 있음. 시스템이 크래시하면? 모든 정보가 디스크에 저장되지 못할 수 있음. 디렉터리나 파일 제어 블록(메타데이터)이 유실되면? → 부팅 시 디렉터리 구조의 데이터와 디스크의 데이터 블록을 비교해 불일치를 고치려 시도.
- 시스템 프로그램으로 디스크 데이터를 다른 저장 장치(플로피 디스크, 자기 테이프)에 백업. 백업에서 복원해 잃어버린 파일/디스크 복구.

## 맺음말 (Final Remarks)

- "File System"은 디스크 상의 자료구조를 의미.
- "logical formatting" = 이 자료구조를 초기화하는 것.
- 디스크 파일 접근은 OS 의존적인 연산.
