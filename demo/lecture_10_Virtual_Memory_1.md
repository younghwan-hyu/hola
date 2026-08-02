# 강의 10: Virtual Memory 1 (가상 메모리 1)

- 원본: lecture_10_Virtual_Memory_1.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 배경 (Background)

- 논리 주소 공간의 크기: 32비트 주소로는 최대 2^32 − 1 → 프로세스마다 4GB의 논리 주소 공간. 주소 공간의 큰 부분이 사용되지 않음(unused).
- 가상 메모리 (Virtual memory): 논리 메모리를 물리 메모리로부터 분리.
  - 프로그램의 일부만 메모리에 있어도 실행 가능.
  - 따라서 논리 주소 공간이 물리 주소 공간보다 훨씬 커질 수 있음.
  - 여러 프로세스가 주소 공간을 공유할 수 있게 함.
  - 더 효율적인 프로세스 생성 가능.
  - 페이지의 스왑 인/아웃이 필요.
- 가상 메모리 구현 방식: 요구 페이징 (Demand paging), 요구 세그먼테이션 (Demand segmentation).

## 요구 페이징 (Demand Paging)

- 페이지가 필요할 때만(needed) 메모리로 가져옴. 장점: I/O 감소, 메모리 사용 감소, 응답 빨라짐, 더 많은 사용자 수용.
- 페이지가 필요함 = 그 페이지에 대한 참조 발생.
  - invalid reference (불법 참조) → abort.
  - not-in-memory → 메모리로 가져옴.
- Lazy swapper: 페이지가 필요해지기 전에는 절대 메모리로 스왑하지 않음. 페이지 단위를 다루는 스와퍼는 pager라고 부름.

## Valid-Invalid Bit

- 각 페이지 테이블 엔트리에 valid-invalid 비트 연관:
  - Valid (v): 메모리에 있음(in-memory).
  - "Invalid"의 의미들: (1) illegal — 프로세스 주소 공간 밖의 페이지, (2) not-in-memory — 아직 디스크에서 로드된 적 없음, (3) obsolete — 메모리에 있지만 디스크 원본이 갱신됨 (예: KAL 예약 시스템 — 본사의 글로벌 디스크 하나와 지점의 N대 컴퓨터).
- 초기에는 모든 엔트리가 invalid로 설정.
- 주소 변환 중 페이지가 'invalid'면 → page fault (페이지 폴트).

## 페이지 폴트 (Page Fault)

- invalid 페이지 접근은 HW(MMU) 트랩을 발생 — page fault trap. 트랩 핸들러는 OS 안에 있음: page fault handler 호출.
- OS의 페이지 폴트 처리 순서:
  1. OS가 다른 테이블을 보고 판단: 불법 참조(bad address, 보호 위반)면 → 프로세스 abort. 단순히 메모리에 없는 것이면 → 계속.
  2. 빈 페이지 프레임 획득 (없으면 교체(replace)!).
  3. 디스크에서 그 프레임으로 페이지를 읽어들임.
     - 이 디스크 I/O가 끝날 때까지 프로세스는 'wait' 상태.
     - 디스크 I/O가 끝나면 페이지 테이블 엔트리 갱신 (프레임 번호, valid/invalid 비트 = "valid").
     - 프로세스를 Ready queue로 이동 — 나중에 디스패치.
  4. CPU가 다시 그 프로세스에 할당되면 page fault trap 완료.
  5. 페이지 폴트를 일으켰던 명령어를 재시작(restart).

## 실제 HW 설계의 어려움

- 페이지 폴트가 언제 발생하는가?
  1. 명령어 fetch 시: 괜찮음 (그냥 다시 fetch).
  2. 피연산자(operand) fetch 시: 재시작 필요 → (instruction fetch, decode, operand-fetch 다시).
  3. 최악: 한 명령어가 여러 위치를 갱신할 때. 예: block copy 명령어 (copy count from_address to_address) — source/destination이 두 블록에 걸침(spans two blocks). 두 번째 블록에 쓰는 중 페이지 폴트가 나면? → Undo 필요. 임시 주소와 값을 저장하는 추가 H/W 필요.

## 요구 페이징의 성능 (Performance of Demand Paging)

- 페이지 폴트율 p (0 ≤ p ≤ 1): p=0이면 폴트 없음, p=1이면 모든 참조가 폴트.
- EAT = (1 − p) × memory access + p × (page fault overhead + [필요시 swap page out] + swap page in + restart overhead)
- 예: 메모리 접근 200ns, 평균 페이지 폴트 서비스 시간 8ms.
  - EAT = (1 − p) × 200 + p × 8,000,000 = 200 + p × 7,999,800 (ns)
  - 1,000번 접근 중 1번 폴트라면 EAT = 8.2μs — 40배 느려짐!!
- Pure demand paging: 참조되기 전에는 절대 스왑 인하지 않음 — 프로그램을 메모리에 페이지 0개로 시작.
- 참조 지역성 (Locality of reference): 거의 모든 워크로드에서 발생. 일정 시간 구간에 아주 작은 페이지 집합만 집중 참조 → 페이징 시스템을 실용적으로 만들어 줌.

## 빈 프레임이 없으면? — 페이지 교체 (Page Replacement)

- 페이지 폴트 서비스 루틴에 페이지 교체를 포함해 메모리 과할당(over-allocation) 방지.
- Modify (dirty) bit로 페이지 전송 오버헤드 감소 — 수정된 페이지만 디스크에 기록(swap-out).
- 페이지 교체는 논리 메모리와 물리 메모리의 분리를 완성: 더 작은 물리 메모리 위에 큰 가상 메모리 제공 가능. 같은 페이지가 실행 중 여러 번 메모리에 들어올 수 있음.
- 페이지 교체 알고리즘: 교체 희생(victim) 페이지를 고르는 알고리즘. 목표 — 페이지 폴트 수 최소화.

### 기본 페이지 교체 절차

1. 원하는 페이지의 디스크 위치 찾기.
2. 빈 프레임 찾기: 있으면 사용, 없으면 페이지 교체 알고리즘으로 victim 프레임 선택.
3. 원하는 페이지를 (새로) 빈 프레임으로 읽어들이고 페이지/프레임 테이블 갱신.
4. 프로세스 재시작.

## 페이지 교체 알고리즘 (Page-Replacement Algorithms)

- 목표: 최저 페이지 폴트율. 특정 메모리 참조열(reference string)에 대해 알고리즘을 돌려 페이지 폴트 수를 세어 평가.
- 예제 참조열: 1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5

### FIFO (First-In-First-Out) 알고리즘

- 3 프레임: 9 페이지 폴트. 4 프레임: 10 페이지 폴트.
- FIFO 교체의 Belady's Anomaly (벨라디의 모순): 프레임이 더 많은데 페이지 폴트가 더 많아질 수 있음.

### Optimal (OPT) 알고리즘

- 가장 오랫동안 사용되지 않을(will not be used for longest period) 페이지를 교체.
- 4 프레임 예: 6 페이지 폴트.
- 미래를 알 수 없으므로 실제 구현 불가 — 다른 알고리즘의 성능 측정 기준으로 사용.

### LRU (Least Recently Used) 알고리즘

- 가장 오랫동안 사용되지 않은 페이지를 교체. 4 프레임 예: 8 페이지 폴트.
- 구현 문제: LRU를 그대로 구현하면 모든 페이지에 타임스탬프 필요 (추가 메모리/페이지 테이블 트래픽), 최소 타임스탬프 페이지 검색 필요 → 커널에 넣기엔 공간/시간 오버헤드가 너무 큼 → 근사(approximation) 모델 필요.
- Counter 구현: 페이지 엔트리마다 카운터. CPU 카운터가 매 메모리 참조마다 증가 (논리적 시계). 페이지 A 접근 시 CPU 카운터를 A의 카운터에 복사. 교체 시 페이지 테이블에서 최소 카운터 검색. 단점: 매 메모리 접근마다 추가 메모리 접근(카운터 기록), 교체마다 검색 오버헤드, 카운터 공간 오버헤드.
- Stack 구현: 페이지 번호들을 이중 연결 리스트 스택으로 유지. 페이지 A가 참조되면 A를 top으로 이동 (스택 top 포인터 포함 6개 포인터 변경 필요). 교체 시 검색 불필요 (bottom이 LRU).

### LRU 근사 알고리즘 (LRU Approximation)

- Reference bit: 각 페이지에 비트 하나. 초기 0, 참조되면 1. reference bit이 0인 것을 교체 (순서는 알 수 없음).
- Additional-Reference-Bits 알고리즘: 추가 참조 비트 8비트 유지. 주기적으로 reference bit을 최상위 비트로 시프트해 넣고 나머지는 오른쪽으로 1비트 시프트 (최하위 비트 버림). 예: 00000000 = 참조된 적 없는 페이지, 10101010 = 두 주기마다 접근된 페이지. (값이 클수록 최근 사용.)
- Second chance (clock) 알고리즘:
  - reference bit 필요. 페이지들의 원형 큐(circular queue).
  - 포인터를 전진시키며 reference bit이 0인 페이지를 찾음.
  - 교체 대상(시계 순서)의 reference bit이 1이면: 비트를 0으로 만들고 페이지는 메모리에 남겨둠. 다음 페이지로 이동해 같은 규칙 적용.
  - 특징: 포인터가 이동하는 중에 reference bit 1은 모두 0으로 바꿈. 한 바퀴 되돌아와서도(second chance) 0이면 그때 replace 당함. 자주 사용되는 페이지라면 second chance가 올 때 1이 되어 있음. 최악의 경우 모든 비트가 1이면 FIFO가 됨.
- Enhanced Second chance 알고리즘: (reference bit, modify bit) 쌍으로 판단.
  - Not-Referenced + not-modified → 첫 번째로 교체.
  - Referenced + modified → 가장 나중에 교체.

### 계수 알고리즘 (Counting Algorithms)

- 각 페이지에 대한 참조 횟수 카운터 유지.
- LFU (Least Frequently Used): 카운트가 가장 작은 페이지 교체.
- MFU (Most Frequently Used): 카운트가 가장 작은 페이지는 방금 들어와서 아직 사용되지 않았을 것이라는 논리에 기반해, 카운트가 가장 큰 페이지를 교체.
