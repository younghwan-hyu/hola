# 과제 1 (Project 1): CFS 스케줄링 구현

- 원본: assignment_1.pdf
- 과목: 운영체제 실습, 한양대학교
- **마감: 2026년 4월 24일 23:59** (참고: 4월 25일(토) 중간고사 직전에 짧은 퀴즈 있음)

## 개요

- 목표: xv6의 기본 Round Robin 스케줄러를 Linux의 **CFS (Completely Fair Scheduler)의 단순화 버전**으로 교체.
- 제출: 수정한 xv6 소스 코드와 보고서를 GitHub Classroom 저장소의 main 브랜치에 push.
  - 저장소 링크: https://classroom.github.com/a/Z6qG6k3F
- 마감 정책: 늦은 제출 허용, 마감 후 3시간 단위마다 5% 감점. 채점은 최종 커밋 기준.

## CFS의 핵심 개념

- **Completely Fair Scheduler (CFS)**: CPU 시간을 프로세스들의 우선순위에 비례해 할당하는 것을 보장하는 스케줄링 알고리즘. 이를 위해 **가장 낮은 virtual runtime을 가진 RUNNABLE 프로세스를 일관되게 선택·실행**.
- **Virtual Runtime (가상 실행시간)**: 프로세스가 스케줄되어 실행한 총 CPU 시간을 우선순위로 스케일한 지표. 각 프로세스는 자기만의 virtual runtime을 가지며, 스케줄러는 실행 중인 프로세스의 virtual runtime을 실제 실행시간과 우선순위에 기반해 갱신.
- **Nice Value**: virtual runtime이 얼마나 빨리 누적되는지를 결정하는 우선순위 힌트. nice 값이 높을수록 스케줄러가 virtual runtime을 더 빠른 속도로 증가시킴 → 그 프로세스는 덜 자주 선택됨.

## 명세 (Specifications)

### 프로세스 선택

- 가장 낮은 virtual runtime을 가진 RUNNABLE 프로세스를 선택.
- runnable 프로세스들을 효율적으로 관리하기 위해 **제공되는 Red-Black tree 자료구조를 활용**할 것.

### Red-Black Tree (kernel/rbtree.h — 제공됨)

- 삽입·삭제·조회에 O(log n)을 보장하는 자가 균형 이진 탐색 트리:
```c
struct rb_node {
    uint64 key;
    void *data;
    struct rb_node *_parent;
    struct rb_node *_left;
    struct rb_node *_right;
    rb_color _color;
};
struct rb_tree {
    struct rb_node *root;
};
void rb_insert(struct rb_tree *tree, struct rb_node *node);
void rb_delete(struct rb_tree *tree, struct rb_node *node);
struct rb_node* rb_first(struct rb_node *node);  // 최솟값
struct rb_node* rb_last(struct rb_node *node);   // 최댓값
```

### Virtual Runtime의 초기화와 갱신 규칙

- 프로세스가 선택될 때마다 그 virtual runtime은 우선순위에 기반해 증가.
- **nice 값이 1 증가할 때마다 추가되는 virtual runtime 양이 2배가 됨.**
- fork될 때: 자식의 virtual runtime은 **부모의 virtual runtime으로 초기화**. 부모가 없으면 0.
- SLEEPING에서 깨어날 때: 다음 규칙을 순서대로 평가해 갱신:
  1. RUNNABLE 프로세스가 하나라도 있으면 → 깨어나는 프로세스의 virtual runtime을 모든 RUNNABLE 프로세스 중 최소 virtual runtime으로 설정.
  2. RUNNABLE은 없지만 RUNNING 중인 프로세스가 하나라도 있으면 → RUNNING 프로세스들 중 가장 낮은 virtual runtime으로 설정.
  3. RUNNABLE도 RUNNING도 없으면 → 0으로 설정.

### Nice 값의 초기화

- nice 값은 항상 **-3 ~ 2** 범위여야 함.
- 최초 프로세스의 nice 값은 0 (기본 우선순위)으로 초기화.
- fork될 때 자식은 부모의 nice 값을 상속.

### set_nice() 시스템 콜

- 역할: 현재 실행 중인 프로세스의 nice 값(우선순위)을 설정.
- 시그니처: `int set_nice(int nice);`
  - nice (int): 적용할 목표 nice 값. 유효 범위(-3 ~ 2) 안이어야 함.
  - 반환값: 성공적으로 갱신되면 0, 제공된 nice 값이 유효하지 않으면 1.

## 보고서 (Report)

- 구성: Design (구현 계획), Implementation (수정·추가 사항과 목적), Results (컴파일·실행 과정, 검증 스크린샷, 실행 흐름 설명), Troubleshooting (문제와 해결 과정).
- 보고서 파일명 (엄격함): `OS_project1_[class number]_[student ID].pdf`
- 보고서 PDF는 저장소 **루트 디렉터리**에 두고 소스 코드와 함께 커밋·푸시.

## Q&A / 테스트 케이스 기여

- 과제 질문은 xv6-sandbox 저장소 Discussions 탭: https://github.com/2026-HYU-ELE3021/xv6-riscv-sandbox/discussions (이메일 질문은 답변 안 됨. 과제 외 질문·개인 사정은 이메일.)
- 자작 테스트 케이스를 Discussions에 공유 가능 — 잘 만든 것은 공식 채점에 채택될 수 있음.
