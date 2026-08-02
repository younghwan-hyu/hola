# 강의 6: Process Synchronization 2 (프로세스 동기화 2)

- 원본: lecture_6_Process_Synchronization_2.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 고전적 동기화 문제 (Classical Problems of Synchronization)

- Bounded-Buffer Problem (유한 버퍼 문제)
- Readers and Writers Problem (독자-저자 문제): 스케줄링 이슈
- Dining-Philosophers Problem (식사하는 철학자 문제): 교착상태(deadlock) 이슈

## 유한 버퍼 문제 (Bounded-Buffer Problem)

- 생산자(Producer)는 빈 버퍼가 있는지 확인하고 가득 찬 버퍼를 만들어냄. 소비자(Consumer)는 가득 찬 버퍼가 있는지 확인하고 빈 버퍼를 만들어냄. 둘 다 공유 데이터(버퍼)에 접근 가능한지 확인해야 함.
- 필요한 세마포어:
  - 공유 변수 buf 보호 → 이진 세마포어 (binary semaphore) S_mutex
  - 자원 개수 세기 (# of full buf, # of empty buf) → 정수 세마포어 (integer semaphore) N_empty-buf, N_full-buf
- 구조:
  - Producer: P(N_empty-buf) → P(S_mutex) → write to buf → V(S_mutex) → V(N_full-buf)
  - Consumer: P(N_full-buf) → P(S_mutex) → read from buf → V(S_mutex) → V(N_empty-buf)
- 교과서 표기의 공유 데이터: `semaphore full = 0, empty = n, mutex = 1;`
```
Producer:                        Consumer:
do {                             do {
  produce an item in nextp         P(full);
  P(empty);                        P(mutex);
  P(mutex);                        remove an item from buffer to nextc
  add nextp to buffer              V(mutex);
  V(mutex);                        V(empty);
  V(full);                         consume the item in nextc
} while (1);                     } while (1);
```

## 독자-저자 문제 (Readers-Writers Problem)

- DB를 많은 사용자가 접근. 한 명이 DB에 쓸 때는 배타적 접근(exclusive access, 세마포어 db). 읽는 사람들(readers)은 동시에 접근 가능!
- 우선순위 정책 선택지 — 대기 중: N명의 reader (int readcount, semaphore mutex 사용), 1명의 writer.
  - A안: 모든 reader가 (동시에) 끝나게 한 후 writer 시작.
  - B안: writer 먼저 (긴급) 끝낸 후 reader들 시작.
- A안 해법: 한 reader가 읽기 시작하면 다른 모든 reader도 읽게 함. 마지막 reader가 끝나면 writer가 시작하게 함.
  - 첫 번째 reader → P(db) 시도, 마지막 reader → V(db) 수행.
  - readcount 접근 자체가 임계 구역이므로 P(mutex)/V(mutex)로 감쌈.
- 공유 데이터: `semaphore mutex = 1, db = 1; int readcount = 0;`
```
Writer:                Reader:
P(db);                 P(mutex);
writing is performed   readcount++;
V(db);                 if (readcount == 1) P(db);  /* 첫 reader면 writer 확인/차단 */
                       V(mutex);
                       reading is performed
                       P(mutex);
                       readcount--;
                       if (readcount == 0) V(db);  /* 마지막 reader면 writer 허용 */
                       V(mutex);
```

## 식사하는 철학자 문제 (Dining-Philosophers Problem)

- 철학자 5명이 생각(think)과 식사(eat)를 반복. 공유 데이터: `semaphore chopstick[5];` (모두 1로 초기화).
- 단순 해법 (철학자 i):
```
do {
  P(chopstick[i]);            /* 왼쪽 젓가락 */
  P(chopstick[(i+1) % 5]);    /* 오른쪽 젓가락 */
  eat
  V(chopstick[i]);
  V(chopstick[(i+1) % 5]);
  think
} while (1);
```
- 이 해법은 교착상태(deadlock)가 발생할 수 있음! (모두가 동시에 왼쪽 젓가락을 들면 오른쪽을 영원히 기다림)

### 교착상태 해결책 (Remedies)

- 두 젓가락을 한꺼번에만 집기: 집는 동작을 임계 구역 안에서 수행.
- 비대칭 코딩 (Asymmetric coding): 홀수 번째 철학자는 왼쪽 먼저, 짝수 번째는 오른쪽 먼저 시도.
- 최대 4명만 동시에 앉게 허용.

## 교착상태와 기아 (Deadlock and Starvation)

- Deadlock: 둘 이상의 프로세스가, 대기 중인 프로세스들 중 하나만이 일으킬 수 있는 이벤트를 무한정 기다리는 상태.
- 예: 세마포어 S, Q가 모두 1로 초기화되었을 때:
  - P0: P(S); P(Q); … V(S); V(Q);
  - P1: P(Q); P(S); … V(Q); V(S);
  - 각자 하나씩 잡고(hold one) 서로의 것을 기다림(wait for another one) → 교착상태.
- Starvation (기아, indefinite blocking): 프로세스가 자기가 매달린 세마포어 큐에서 영원히 제거되지 않을 수 있음. 예: LIFO 큐를 쓰는 세마포어.

## 세마포어의 문제점 (Problems of Semaphore)

- 코딩하기 어려움.
- 정확성 증명이 어려움: 오류가 재현되지 않고(not reproducible), 드물게만 관찰됨.
- 자발적 협력(voluntary cooperation)이 필요.
- 한 번의 오용(misuse)이 시스템 전체에 영향.

## 모니터 (Monitors)

- 추상 자료형(abstract data type)과 유사: private 데이터 + public 메서드. 추상 자료형의 안전한 공유를 허용하는 고수준 언어 동기화 구조물.
```
monitor monitor-name
{
    shared variable declarations   /* private 데이터 */
    procedure body P1 (…) { ... }  /* public 메서드 */
    procedure body P2 (…) { ... }
    { initialization code }
}
```
- 모니터는 한 시점에 하나의 프로세스만 모니터 안에서 활성(active)일 수 있음을 보장.

### 조건 변수 (Condition Variables)

- 프로세스가 모니터 안에서 기다릴 수 있게 하려면 조건 변수 선언 필요: `condition x, y;`
- 조건 변수는 wait와 signal 연산으로만 사용 가능:
  - x.wait(): 이 연산을 호출한 프로세스는 다른 프로세스가 x.signal()을 호출할 때까지 일시 중단됨.
  - x.signal(): 정확히 하나의 중단된 프로세스를 재개. 중단된 프로세스가 없으면 아무 효과 없음.

### 모니터로 푸는 식사하는 철학자 문제

```
monitor dining_philosopher
{
  enum {thinking, eating, hungry} state[5];
  condition self[5];              /* 여기서 대기 */

  void pickup(int i) {
    state[i] = hungry;
    test(i);
    if (state[i] != eating) self[i].wait();  /* 못 먹으면 대기 */
  }

  void putdown(int i) {
    state[i] = thinking;
    test((i+4) % 5);  /* 왼쪽 이웃이 기다리고 있으면 */
    test((i+1) % 5);  /* 오른쪽 이웃 검사 */
  }

  void test(int i) {
    if ((state[(i+4) % 5] != eating) && (state[i] == hungry)
        && (state[(i+1) % 5] != eating)) {
      state[i] = eating;
      self[i].signal();  /* Pi를 깨움 — putdown에서 좌우 이웃 깨울 때 사용 */
    }
  }

  void init() { for (int i = 0; i < 5; i++) state[i] = thinking; }
}

각 철학자: { pickup(i); eat(); putdown(i); think(); } while(1)
```
- 구조: entry queue(모니터 진입 대기) + 조건 변수 큐(self[i]) + 공유 데이터(state[]) + 연산들(pickup, putdown, test).

### 모니터 구현 (Monitor Implementation)

- 조건부 대기 구조물: x.wait(c);
  - c는 wait 연산 실행 시 평가되는 정수 표현식 (우선순위 번호). c 값은 중단된 프로세스 이름과 함께 저장됨.
  - x.signal 실행 시, 연관된 우선순위 번호가 가장 작은 프로세스가 다음에 재개됨.
- 시스템 정확성 확립을 위해 확인할 두 조건:
  - 사용자 프로세스가 항상 올바른 순서로 모니터를 호출해야 함.
  - 비협조적 프로세스가 모니터가 제공하는 상호 배제 관문을 무시하고 접근 프로토콜 없이 공유 자원에 직접 접근하지 못하도록 보장해야 함.
