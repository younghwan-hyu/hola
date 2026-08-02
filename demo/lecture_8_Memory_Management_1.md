# 강의 8: Memory Management 1 (메모리 관리 1)

- 원본: lecture_8_Memory_Management_1.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 배경 (Background)

- 프로그램은 실행되려면 디스크에서 메모리로 옮겨져 프로세스 안에 배치되어야 함.
- 메인 메모리와 레지스터만이 CPU가 직접 접근할 수 있는 저장소.
- 레지스터 접근은 CPU 클럭 사이클 1개(또는 그 이하), 메인 메모리는 여러 사이클 소요. 캐시가 메인 메모리와 CPU 레지스터 사이에 위치.
- 올바른 동작을 보장하려면 메모리 보호(protection)가 필요.
- 사용자 프로그램은 메모리에서 실행되기까지 여러 단계(compile → load → execution)를 거침.

## 명령어와 데이터의 메모리 바인딩 (Binding of Instructions and Data to Memory)

- 컴파일 타임 바인딩 (Compile time binding): 각 심볼의 절대 주소를 이 시점에 알아야 함. 절대 주소를 포함한 absolute code 생성. 시작 위치가 바뀌면 재컴파일 필요.
- 로드 타임 바인딩 (Load time binding): 로더(loader)가 각 심볼에 절대 주소를 부여. 컴파일러는 상대 주소를 포함한 relocatable code 생성.
- 실행 시간 바인딩 (Execution time binding): 프로세스가 실행 중에 메모리 내 위치를 옮길 수 있을 때 사용. CPU가 주소를 낼 때마다 바인딩 필요 (주소 매핑 테이블). 하드웨어 지원 필요 (base/limit 레지스터, MMU 등).
- 주소 매핑 테이블: CPU가 제시한 주소(logical) : 실제 메모리 내 주소(physical). 예: logical 0번지 → physical 500번지, logical 500번지 → physical 20000번지.

## 논리 주소 vs 물리 주소 (Logical vs. Physical Address Space)

- 논리 주소 공간이 별도의 물리 주소 공간에 바인딩된다는 개념이 올바른 메모리 관리의 핵심.
  - 논리 주소 (Logical address): CPU가 생성. 가상 주소(virtual address)라고도 함.
  - 물리 주소 (Physical address): 메모리 유닛이 보는 주소.
- 컴파일 타임/로드 타임 바인딩에서는 논리 주소와 물리 주소가 같음. 실행 시간 바인딩에서는 다름.

## MMU (Memory-Management Unit)

- 가상 주소를 물리 주소로 매핑하는 하드웨어 장치.
- MMU 방식에서는 relocation register의 값이 사용자 프로세스가 생성한 모든 주소에 (CPU에서 메모리로 보내질 때) 더해짐.
- 사용자 프로그램은 논리 주소만 다루며 실제 물리 주소를 절대 보지 못함.

## 스와핑 (Swapping)

- 프로세스는 일시적으로 메모리에서 backing store로 스왑 아웃되었다가 나중에 다시 메모리로 돌아올 수 있음. 스와핑은 동적 재배치(dynamic relocation)를 필요로 함.
- Backing store: 모든 사용자의 메모리 이미지를 수용할 만큼 큰 빠른 디스크. 이 이미지들에 직접 접근을 제공해야 함.
- 스왑 시간의 대부분은 전송 시간(transfer time)이며, 총 전송 시간은 스왑되는 메모리 양에 비례.

## 연속 할당 (Contiguous Allocation)

- 메인 메모리는 보통 두 파티션으로 나뉨: 상주 OS(보통 인터럽트 벡터와 함께 낮은 주소에), 사용자 프로세스(높은 주소에).
- 사용자 프로세스들을 서로와 OS로부터 보호:
  - Relocation register: 가장 작은 물리 주소 값 보유.
  - Limit register: 논리 주소의 범위 보유 — 각 논리 주소는 limit register보다 작아야 함. MMU가 검사 후 relocation 값을 더해 물리 주소 생성.
- Hole: 사용 가능한 메모리 블록. 다양한 크기의 hole이 메모리 곳곳에 흩어져 있음. 프로세스가 도착하면 충분히 큰 hole에서 메모리를 할당. OS는 (a) 할당된 공간과 (b) 빈 공간(hole)의 정보를 유지.

### 동적 저장 공간 할당 문제 (Dynamic Storage-Allocation Problem)

- 빈 hole 목록에서 크기 n의 요청을 만족시키는 방법:
  - First-fit: 충분히 큰 첫 번째 hole에 할당.
  - Best-fit: 충분히 큰 hole 중 가장 작은 것에 할당. 크기순 정렬이 아니면 전체 목록 탐색 필요. 작은 잔여 hole이 많이 생김.
  - Worst-fit: 가장 큰 hole에 할당. 역시 전체 목록 탐색 필요. 가장 큰 잔여 hole이 생김.
- 저장 공간 활용률 면에서 first-fit과 best-fit이 worst-fit보다 좋음.

### 단편화 (Fragmentation)

- 외부 단편화 (External fragmentation): 요청을 만족할 총 메모리 공간은 존재하지만 연속적이지 않음.
- 내부 단편화 (Internal fragmentation): 할당된 메모리가 요청한 것보다 약간 클 수 있음 — 파티션 내부에 있지만 사용되지 않는 메모리.
- 압축(compaction)으로 외부 단편화 감소: 메모리 내용을 재배치해 모든 빈 메모리를 하나의 큰 블록으로 모음. 압축은 재배치가 동적(dynamic)이고 실행 시간에 이루어질 때만 가능.

## 페이징 (Paging)

- 주소 공간이 비연속적(noncontiguous)일 수 있게 허용하는 기법.
- 기본 방법:
  - 물리 메모리를 프레임(frame)이라는 고정 크기 블록으로 분할 (크기는 2의 거듭제곱, 512B ~ 8MB).
  - 논리 메모리를 같은 크기의 블록인 페이지(page)로 분할.
  - 모든 빈 프레임을 추적. 크기가 n페이지인 프로그램을 실행하려면 n개의 빈 프레임을 찾아 로드.
  - 논리→물리 주소 변환을 위한 페이지 테이블(page table) 설정.
  - 내부 단편화는 있지만 외부 단편화는 없음.

### 페이징의 주소 변환 (Address Translation Scheme)

- CPU가 생성한 주소를 둘로 나눔:
  - 페이지 번호 (p): 페이지 테이블의 인덱스. 페이지 테이블은 각 페이지의 물리 메모리 base 주소를 담음. (m−n) 비트.
  - 페이지 오프셋 (d): base 주소와 결합되어 메모리 유닛에 보낼 물리 주소를 정의. n 비트.
- 논리 주소 공간이 2^m이고 페이지 크기가 2^n일 때 위와 같음.
- 예: 논리 주소 4비트(m=4), 페이지 크기 4바이트(n=2) → 페이지 번호 2비트, 오프셋 2비트. 논리 주소 2는 페이지 번호 = 2/4 = 0, 오프셋 = 2%4 = 2.

### 페이지 테이블 구현 (Implementation of Page Table)

- 페이지 테이블은 메인 메모리에 보관.
  - PTBR (Page-table base register): 페이지 테이블을 가리킴.
  - PTLR (Page-table length register): 페이지 테이블 크기를 나타냄.
- 문제: 모든 메모리(데이터/명령어) 접근이 두 번의 메모리 접근을 요구 — 페이지 테이블 1회 + 실제 데이터/명령어 1회.
- 해결: TLB (Translation Look-aside Buffer, associative memory)라는 특수 고속 조회 하드웨어 캐시 사용.
  - 일반적으로 TLB는 컨텍스트 스위치 시 플러시(flush)됨 (이전 엔트리 제거).
  - 일부 TLB는 엔트리마다 ASID (address-space identifier)를 저장해 잦은 TLB 플러시를 회피 — 각 프로세스를 고유하게 식별해 주소 공간 보호 제공.

### 연관 메모리 (Associative Memory, TLB)

- 두 종류의 메모리:
  1. 일반 메모리 (예: DRAM): 주소를 주면 레코드 반환.
  2. 연관 메모리 (예: 전화번호부): 레코드의 필드를 주면 레코드 반환. 병렬 검색(또는 인덱싱) 없이는 매우 느리고 구현 비용 높음.
- TLB는 병렬 검색을 하는 연관 메모리이며, 페이지 테이블의 일부만 담고 있음 (Page# → Frame#).
- 주소 변환 (p, d): 먼저 연관 메모리의 페이지 테이블 일부를 확인. p가 associative register에 있으면 프레임 번호를 바로 얻고, 아니면 메인 메모리의 페이지 테이블에서 얻음.

### 유효 접근 시간 (Effective Access Time, EAT)

- Associative lookup 시간 = ε, 메모리 접근 시간 = β, 히트율(hit ratio) = α (연관 메모리에서 찾을 확률).
- EAT = (ε + β)·α + (ε + 2β)(1 − α) = ε + (2 − α)·β
- (hit이면 TLB 조회 + 메모리 1회, miss면 TLB 조회 + 페이지 테이블 접근 + 메모리 접근으로 2β.)

### 메모리 보호 (Memory Protection)

- 각 프레임에 보호 비트(protection bit)를 연관시켜 구현.
- Valid-invalid bit — 페이지 테이블의 각 엔트리에:
  - "valid": 그 페이지가 합법 — 프로세스의 논리 주소 공간 안에 있음.
  - "invalid": 그렇지 않음 (접근 불허).
- 예: 페이지 크기 2KB, 주소 0~10468만 사용하는 프로세스 → 6개(=10469/2048) 페이지가 할당되고 페이지 테이블에서 6개 엔트리만 사용됨. valid-invalid 비트 대신 PTLR로 주소 유효성을 검사할 수도 있음.

### 공유 페이지 (Shared Pages)

- 공유 코드 (Shared code): 읽기 전용(re-entrant, 재진입 가능) 코드 한 벌을 여러 프로세스가 공유 (예: 텍스트 에디터, 컴파일러, 윈도우 시스템).
  - 공유 코드는 모든 프로세스의 논리 주소 공간에서 같은 위치에 나타나야 함 — 공유 코드 안의 자기 참조(self-reference)를 가능하게 하기 위해.
- 사설 코드와 데이터 (Private code and data): 각 프로세스가 데이터의 별도 복사본 유지. 사설 코드·데이터 페이지는 논리 주소 공간 어디에나 나타날 수 있음.
- 예: 3페이지짜리 에디터(ed1, ed2, ed3)를 여러 프로세스가 공유하고 데이터 페이지만 각자 소유.
