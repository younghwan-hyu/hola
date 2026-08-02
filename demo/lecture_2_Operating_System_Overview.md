# 강의 2: Operating System Overview (운영체제 개요)

- 원본: lecture_2_Operating_System_Overview.pdf
- 과목: 운영체제 (Operating Systems), 한양대학교

## 운영체제 구조 (Operating System Structure)

- 멀티프로그래밍 (Multiprogramming): 효율성을 위해 필요. 한 사용자가 CPU와 I/O 장치를 항상 바쁘게 유지할 수 없으므로, 여러 작업(job)을 조직해 CPU가 항상 실행할 것을 갖게 함. 전체 작업의 부분집합을 메모리에 유지, job scheduling으로 하나 선택해 실행, I/O 대기 시 다른 작업으로 전환.
- 시분할/멀티태스킹 (Timesharing, Multitasking): 멀티프로그래밍의 논리적 확장. CPU가 작업을 매우 자주 전환해 사용자가 실행 중인 각 작업과 상호작용 가능 (대화형 컴퓨팅). 응답 시간이 충분히 작아야 함. 프로세스가 메모리에 다 안 들어가면 스와핑(swapping)으로 넣고 빼며, 가상 메모리(virtual memory)는 메모리에 완전히 올라오지 않은 프로세스도 실행 가능하게 함.

## 운영체제 동작 (OS Operations)

- 하드웨어 인터럽트 구동 (interrupt driven). 소프트웨어 오류나 요청은 exception 또는 trap을 발생 (0으로 나누기, 시스템 콜 요청 등).
- 이벤트 분류:
  - 비동기 이벤트 = 인터럽트 (interrupt): 언제 어떤 이벤트가 올지 모름. 특정 이벤트가 지금 발생했음을 알려줌.
  - 동기 이벤트 = 예외 (exception): trap / fault / abort로 나뉨.
    - Trap: 의도적 예외 (예: 시스템 콜).
    - Fault: 복구 가능한 오류 (예: page fault, divide by zero) — 처리 후 프로그램 실행 계속 가능.
    - Abort: 복구 불가능한 오류 (예: 메모리 비트 손상) — 프로그램 중단.
- 이중 모드 동작 (Dual-mode operation): user mode와 kernel mode. 하드웨어가 mode bit 제공. 일부 명령어는 privileged (특권 명령어)로 kernel mode에서만 실행 가능. 시스템 콜 진입 시 kernel 모드로 전환, 리턴 시 user 모드로 복귀. OS가 자신과 시스템 구성요소를 보호하는 수단.

## 프로세스 관리 (Process Management)

- 프로세스 = 실행 중인 프로그램 (a program in execution). 시스템 내 작업 단위. 프로그램은 수동적(passive) 개체, 프로세스는 능동적(active) 개체.
- 프로세스는 작업 수행에 자원 필요: CPU, 메모리, I/O, 파일, 초기화 데이터. 종료 시 재사용 가능한 자원 회수 필요.
- 단일 스레드 프로세스는 program counter 1개, 멀티스레드 프로세스는 스레드마다 PC 1개.
- OS의 프로세스 관리 활동: 사용자/시스템 프로세스 생성·삭제, 일시정지·재개(suspend/resume), 프로세스 동기화 메커니즘 제공, 프로세스 간 통신 메커니즘 제공, 교착상태(deadlock) 처리 메커니즘 제공.

## 메모리 관리 (Memory Management)

- 모든 데이터는 처리 전후 메모리에 있어야 하고, 실행할 명령어도 메모리에 있어야 함.
- 활동: 메모리의 어느 부분을 누가 쓰는지 추적, 어떤 프로세스(또는 그 일부)와 데이터를 메모리에 넣고 뺄지 결정, 메모리 공간 할당·해제. 목적은 CPU 활용률과 사용자 응답 시간 최적화.

## 저장장치 관리 (Storage / Mass-Storage Management)

- OS는 정보 저장의 균일하고 논리적인 뷰 제공 — 물리적 특성을 추상화한 논리적 저장 단위가 파일(file).
- 파일 시스템 관리: 파일은 디렉터리로 조직, 접근 제어, 파일/디렉터리 생성·삭제·조작 프리미티브, 파일의 보조기억장치 매핑, 백업.
- 대용량 저장장치 관리: 메모리에 안 들어가거나 오래 보관해야 하는 데이터는 디스크에 저장. 컴퓨터 전체 속도가 디스크 서브시스템에 좌우됨. OS 활동: free-space 관리, 저장 공간 할당, 디스크 스케줄링. 3차 저장장치(tertiary storage): 광학 저장장치, 자기 테이프 등 — WORM(write-once read-many)과 RW(read-write)로 구분.
- 데이터 이동(예: 정수 A가 디스크→레지스터): 멀티태스킹 환경은 계층 어디에 있든 최신 값을 쓰도록 주의해야 하고, 멀티프로세서는 하드웨어 캐시 일관성(cache coherency) 필요, 분산 환경은 여러 복사본이 존재해 더 복잡.

## I/O 서브시스템

- OS의 한 가지 목적은 하드웨어 장치의 특성을 사용자에게 숨기는 것.
- 담당: 버퍼링(buffering, 전송 중 데이터 임시 저장), 캐싱(caching, 성능 위해 빠른 저장소에 데이터 일부 보관), 스풀링(spooling, 한 작업의 출력과 다른 작업의 입력을 겹침), 일반 장치 드라이버 인터페이스, 특정 하드웨어 장치용 드라이버.

## 보호와 보안 (Protection and Security)

- Protection: OS가 정의한 자원에 대한 프로세스/사용자의 접근을 제어하는 메커니즘.
- Security: 내부·외부 공격(DoS, 웜, 바이러스, 신원 도용 등)으로부터 시스템 방어.
- 사용자 식별: user ID (이름+번호), 파일·프로세스에 연결되어 접근 제어. group ID로 사용자 집합 단위 제어. 권한 상승(privilege escalation, 예: setuid)으로 더 많은 권한의 effective ID로 전환 가능.

## 운영체제 서비스 (OS Services)

- 사용자에게 유용한 기능: 사용자 인터페이스 (CLI / GUI / Batch), 프로그램 실행 (로드·실행·정상/비정상 종료), I/O 연산, 파일 시스템 조작 (읽기/쓰기/생성/삭제/검색/권한 관리), 통신 (같은 컴퓨터 또는 네트워크 상의 프로세스 간 — shared memory 또는 message passing 방식), 오류 감지 (CPU·메모리·I/O 장치·사용자 프로그램의 오류에 적절히 대응).
- 시스템 자체의 효율적 운영을 위한 기능: 자원 할당 (resource allocation), 회계 (accounting, 어떤 사용자가 어떤 자원을 얼마나 쓰는지 추적), 보호와 보안.

## 시스템 콜 (System Calls)

- OS가 제공하는 서비스에 대한 프로그래밍 인터페이스. 보통 C/C++로 작성.
- 대부분의 프로그램은 직접 시스템 콜보다 고수준 API를 통해 접근: Win32 API (Windows), POSIX API (UNIX/Linux/Mac OS X), Java API (JVM). API 사용 이유: 이식성(portability)과 사용 편의성.
- 구현: 각 시스템 콜에 번호가 부여되고, system-call interface가 번호로 인덱싱된 테이블을 유지. 인터페이스가 커널의 해당 시스템 콜을 호출하고 상태와 반환값을 돌려줌. 호출자는 구현을 몰라도 됨 (API만 준수하면 됨). 예: printf() 라이브러리 호출이 내부적으로 write() 시스템 콜 호출.
- 시스템 콜 유형: process control, file management, device management, information maintenance, communications, protection.

## 가상 머신 (Virtual Machines)

- 계층적 접근의 논리적 극한. 하드웨어와 OS 커널을 모두 하드웨어처럼 취급해, 밑바닥 하드웨어와 동일한 인터페이스를 제공.
- 호스트 OS가 각 프로세스가 자기만의 프로세서와 (가상) 메모리를 가진 듯한 환상을 만들고, 각 게스트는 실제 컴퓨터의 (가상) 복사본을 제공받음.
- JVM (Java Virtual Machine): "Write (Compile) once, run anywhere".
