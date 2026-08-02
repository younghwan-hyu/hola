# 강의 4: CPU Scheduling (CPU 스케줄링)

- 원본: lecture_4_CPU_Scheduling.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## CPU-I/O Burst 사이클

- 프로세스 실행은 CPU burst와 I/O burst가 번갈아 나타나는(alternating) 순서로 구성됨.
- CPU burst 시간의 히스토그램은 hyperexponential 분포: I/O bound job은 짧은 CPU burst가 많고, CPU bound job은 긴 CPU burst가 적게 있음.

## CPU 스케줄러 (CPU Scheduler)

- 멀티프로그래밍 환경에서 CPU 스케줄러는 메모리에 있는 실행 준비된 프로세스 중 하나를 선택해 CPU를 할당.
- CPU 스케줄링 결정이 일어날 수 있는 4가지 시점:
  1. running → waiting 전환 (예: I/O 요청)
  2. running → ready 전환 (예: timerunout, 타임 퀀텀 만료)
  3. waiting → ready 전환 (예: I/O 완료 인터럽트)
  4. 프로세스 종료 (terminates)
- 1번과 4번에서만 스케줄링하면 비선점(nonpreemptive) 스케줄링, 그 외에는 선점(preemptive) 스케줄링.

## 디스패처 (Dispatcher)

- 디스패처 모듈은 short-term scheduler가 선택한 프로세스에게 CPU 제어권을 넘김. 하는 일:
  - 컨텍스트 스위칭
  - user mode로 전환
  - 사용자 프로그램의 적절한 위치로 점프해 재시작
- Dispatch latency: 디스패처가 한 프로세스를 멈추고 다른 프로세스를 시작시키는 데 걸리는 시간 (대부분 컨텍스트 스위치 오버헤드).

## 스케줄링 기준 (Scheduling Criteria, 성능 지표)

- CPU utilization (CPU 활용률): 최대화 — CPU를 최대한 바쁘게 유지.
- Throughput (처리량): 최대화 — 단위 시간당 실행을 완료하는 프로세스 수.
- Turnaround time (총처리 시간): 최소화 — 특정 프로세스를 완료하는 데 걸리는 시간.
- Waiting time (대기 시간): 최소화 — ready queue에서 기다린 시간의 합.
- Response time (응답 시간): 최소화 — 요청 제출부터 첫 응답이 나올 때까지의 시간 (출력 완료가 아니라 첫 응답 기준, 시분할 환경용).

## 스케줄링 알고리즘

### FCFS (First-Come First-Served)

- 비선점. 도착 순서대로 실행.
- 예: P1 burst 24, P2 burst 3, P3 burst 3.
  - 도착 순서 P1, P2, P3: Gantt 차트 P1(0–24), P2(24–27), P3(27–30). 대기 시간 P1=0, P2=24, P3=27 → 평균 대기 시간 (0+24+27)/3 = 17.
  - 도착 순서 P2, P3, P1: P2(0–3), P3(3–6), P1(6–30). 대기 시간 P1=6, P2=0, P3=3 → 평균 3. 훨씬 좋음.
- Convoy effect (호송 효과): 짧은 프로세스들이 긴 프로세스 뒤에 갇히는 현상.

### SJF (Shortest-Job-First)

- 각 프로세스에 다음 CPU burst 길이를 연관시키고, 가장 짧은 것을 스케줄.
- 두 방식:
  - 비선점(Nonpreemptive): 한번 CPU를 받으면 CPU burst가 끝날 때까지 선점되지 않음.
  - 선점(Preemptive): 새로 도착한 프로세스의 CPU burst 길이가 현재 실행 중인 프로세스의 남은 시간보다 짧으면 선점. 이 방식이 SRTF (Shortest-Remaining-Time-First).
- SJF는 최적(optimal): 주어진 프로세스 집합에 대해 최소 평균 대기 시간 제공.
- 비선점 SJF 예: P1(도착 0.0, burst 7), P2(2.0, 4), P3(4.0, 1), P4(5.0, 4) → 실행 순서 P1(0–7), P3(7–8), P2(8–12), P4(12–16). 평균 대기 시간 = (0+6+3+7)/4 = 4.
- 선점 SJF(SRTF) 같은 예: P1(0–2), P2(2–4), P3(4–5), P2(5–7), P4(7–11), P1(11–16). 평균 대기 시간 = (9+1+0+2)/4 = 3.

### 다음 CPU Burst 길이 예측 (Exponential Averaging)

- 다음 burst 길이는 알 수 없으므로(입력 데이터, 분기, 사용자에 따라 다름) 추정만 가능. 이전 CPU burst들의 길이를 지수 평균(exponential averaging)으로 사용:
  - t_n = n번째 CPU burst의 실제 길이
  - τ_(n+1) = 다음 CPU burst의 예측값
  - α (0 ≤ α ≤ 1)
  - 정의: τ_(n+1) = α·t_n + (1−α)·τ_n
- α = 0이면 τ_(n+1) = τ_n (최근 이력 무시). α = 1이면 τ_(n+1) = t_n (직전 실제 burst만 반영).
- 식을 전개하면 τ_(n+1) = α·t_n + (1−α)·α·t_(n−1) + … + (1−α)^j·α·t_(n−j) + … + (1−α)^(n+1)·τ_0. α와 (1−α) 모두 1 이하이므로 뒤로 갈수록 각 항의 가중치가 줄어듦.

### 우선순위 스케줄링 (Priority Scheduling)

- 각 프로세스에 우선순위 번호(정수)를 부여, 가장 높은 우선순위(가장 작은 정수 = 최고 우선순위)에 CPU 할당. 선점형/비선점형 모두 가능.
- SJF는 예측된 다음 CPU burst 시간을 우선순위로 하는 우선순위 스케줄링.
- 문제: 기아 (Starvation) — 낮은 우선순위 프로세스가 영원히 실행되지 못할 수 있음.
- 해결: 노화 (Aging) — 시간이 지날수록 프로세스의 우선순위를 높임.

### 라운드 로빈 (RR, Round Robin)

- 각 프로세스가 작은 단위의 CPU 시간(타임 퀀텀, time quantum — 보통 10–100ms)을 받음. 시간이 다 되면 선점되어 ready queue의 끝에 추가됨.
- ready queue에 n개 프로세스, 퀀텀 q초라면 각 프로세스는 최대 q초 단위로 CPU 시간의 1/n을 받음. 어떤 프로세스도 (n−1)q 이상 기다리지 않음.
- 성능: q가 크면 FIFO와 같아짐. q가 작으면 컨텍스트 스위치 대비 q가 커야 함 — 아니면 오버헤드가 너무 큼.
- 예 (q=20): P1=53, P2=17, P3=68, P4=24 → Gantt: P1(0–20), P2(20–37), P3(37–57), P4(57–77), P1(77–97), P3(97–117), P4(117–121), P1(121–134), P3(134–154), P3(154–162).
- 일반적으로 SJF보다 평균 turnaround는 높지만 응답(response)은 더 좋음.

### 다단계 큐 (Multilevel Queue)

- Ready queue를 여러 개의 분리된 큐로 분할: 예) foreground (대화형) / background (배치, 사람 상호작용 없음).
- 각 큐는 자기만의 스케줄링 알고리즘 보유: foreground는 RR, background는 FCFS.
- 큐들 사이의 스케줄링도 필요:
  - 고정 우선순위 (fixed priority): foreground 전부 처리 후 background 처리 — 기아 가능성.
  - 타임 슬라이스: 각 큐가 일정 CPU 시간을 받아 내부 프로세스에 분배. 예) foreground 80% (RR), background 20% (FCFS).

### 다단계 피드백 큐 (Multilevel Feedback Queue)

- 프로세스가 여러 큐 사이를 이동할 수 있음.
- 정의 파라미터: 큐의 개수, 각 큐의 스케줄링 알고리즘, 프로세스 승급(upgrade) 시점 결정 방법, 강등(demote) 시점 결정 방법, 서비스가 필요한 프로세스가 들어갈 큐 결정 방법.
- 예: 세 개의 큐 — Q0 (타임 퀀텀 8ms), Q1 (타임 퀀텀 16ms), Q2 (FCFS).
  - 새 작업은 Q0에 들어가 FCFS로 서비스. CPU를 잡으면 8ms 실행. 8ms 안에 못 끝내면 Q1으로 이동.
  - Q1에서 다시 FCFS로 16ms 추가 실행. 그래도 못 끝내면 선점되어 Q2로 이동.

### 실시간 스케줄링 (Real-Time Scheduling)

- Hard real-time: 중요한 작업을 보장된 시간 안에 완료해야 함.
- Soft real-time: 중요한 프로세스가 덜 중요한 것보다 우선순위를 받으면 됨.
