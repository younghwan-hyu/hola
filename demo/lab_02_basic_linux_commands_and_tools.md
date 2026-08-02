# 랩 02: Basic Linux Commands and Tools (기본 리눅스 명령어와 도구)

- 원본: lab_02_basic_linux_commands_and_tools.pdf
- 과목: 운영체제 실습, 한양대학교
- 구성: Linux 명령어, Git, Visual Studio Code, Hands-on Lab (Hello, xv6), 부록 (Vim, GCC, Makefile)

## 셸과 터미널 (사용자와 OS 사이의 다리)

- Shell: OS 서비스에 접근하는 사용자 인터페이스. 사용자의 명령을 받아 커널에 전달하고 응답을 받음.
  - 예: sh (Bourne Shell), bash (Bourne Again Shell), cmd/powershell (Windows), zsh (z shell, macOS 기본).
- Terminal: 시스템에 접근해 입출력을 제어하는 장치. 예: Windows Terminal, iterm2.

## 기본 리눅스 명령어

- ls: 현재 작업 디렉터리의 파일·디렉터리 목록 출력. 옵션 -a (숨김 항목 포함 전체 표시), -l (상세 정보). `.`은 현재 디렉터리, `..`은 부모 디렉터리.
- cd [디렉터리/경로]: 현재 작업 디렉터리 변경. `cd ..`는 부모 디렉터리로.
- mkdir [이름]: 디렉터리 생성.
- rmdir [이름]: 디렉터리 삭제 (비어 있어야 함).
- cp [A] [B]: 파일 A를 B로 복사.
- rm [파일]: 파일 삭제.
- mv [A] [B]: 파일 이름 A를 B로 변경. mv [파일] [디렉터리]: 파일 이동.
- 기타 유용한 명령어: pwd (현재 경로 출력), whereis (파일 찾기), who (접속 사용자 출력), touch (빈 파일 생성), cat (파일 내용 출력), tar (파일 압축), passwd (암호 변경), chmod (파일 권한 변경).
- 참고 자료: https://ss64.com/bash

## Git

- Git: 분산 버전 관리 시스템 (Distributed Version Control System). 소프트웨어 개발 중 소스 코드의 변경을 추적·관리. 2005년 Linus Torvalds (리눅스 커널 개발자)가 개발.
- 핵심 특징: 분산 구조로 전체 로컬 저장소 사본으로 오프라인 작업 가능, 속도 최적화와 효율적인 저장 구조, 브랜치를 통한 안전하고 독립적인 작업 공간.
- Git 워크플로 (working directory → staging area → local repository → remote repository):
  - Stage: 커밋할 변경 선택 (git add).
  - Commit: 변경을 로컬 저장소에 적용 (git commit).
  - Push: 로컬 변경을 원격 저장소에 업로드 (git push).
  - Pull: 원격 변경을 내려받아 적용 (git pull).
  - Reset: 로컬 저장소의 이전 커밋 상태로 되돌림 (git reset).
  - Restore: 작업 디렉터리의 커밋 안 된 변경을 버림 (git restore).
- Branch: 메인 작업 공간과 평행한 독립적 개발 라인. 안정된 코드에 영향 없이 실험·새 기능·버그 수정 가능. Merge: 한 브랜치의 변경을 다른 브랜치로 통합.
- 설치와 초기 설정:
```bash
sudo apt install git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --list   # 설정 확인
```
- 기본 명령어 (1):
```bash
git init                # 현재 디렉터리에 새 저장소 생성
git clone [URL]         # 원격 저장소 복제
git status              # 작업 디렉터리 상태 확인
git add [filename]      # 특정 파일 스테이징
git add .               # 모든 변경 스테이징
git commit -m "message" # 커밋
git restore [filename]  # 변경 버리기
git reset [commit_id]   # 특정 커밋으로 되돌리기
```
- 기본 명령어 (2):
```bash
git remote add origin [URL]  # 원격 저장소 추가
git push -u origin [branch]  # 원격에 푸시
git pull origin [branch]     # 원격에서 풀
git branch                   # 브랜치 목록
git branch [branch-name]     # 새 브랜치 생성
git switch [branch-name]     # 브랜치 전환
git switch -c [branch-name]  # 생성 + 전환
git merge [branch-name]      # 현재 브랜치로 병합
```

## Visual Studio Code

- 가볍지만 강력한 소스 코드 에디터. 크로스 플랫폼 (Windows/macOS/Linux). 풍부한 확장 마켓플레이스.
- 설치: https://code.visualstudio.com/ 에서 다운로드. Windows는 "Add to PATH" 옵션 체크, macOS는 .dmg를 Applications로 드래그.
- `code` 명령: `code` (VS Code 열기), `code .` (현재 디렉터리 열기), `code [파일/디렉터리]`, `code -n` (새 창), `code -r [파일]` (창 재사용).
  - code 명령이 안 되면: Command Palette (Ctrl+Shift+P / Cmd+Shift+P) → "shell command" 입력 → "Install 'code' command in PATH" 선택.
- WSL 확장 (Windows 사용자 전용): Windows의 VS Code가 Linux 백엔드로 실행 — 터미널·디버거·확장이 모두 Linux 안에서 실행됨.
- clangd 확장: LLVM 기반의 강력한 C/C++ language server. 기본 Microsoft C/C++ IntelliSense보다 똑똑하고 가벼움. clangd 설치 후 기존 C/C++ 확장은 비활성화.
- compile_commands.json 생성: 각 소스 파일의 정확한 컴파일러 플래그와 의존성을 담은 파일 — clangd가 프로젝트 구조를 정확히 이해하는 데 필요. bear로 생성:
```bash
sudo apt install bear   # macOS: brew install bear
make clean
bear -- make qemu
```
- 키보드 단축키: Command Palette (Ctrl/Cmd+Shift+P), Quick Open (Ctrl/Cmd+P), 줄 이동 (Alt/Option+↑↓), 줄 주석 토글 (Ctrl/Cmd+/), 줄 이동 (Ctrl/Cmd+G), 전체 파일 검색 (Ctrl/Cmd+Shift+F), 파일 내 심볼 (Ctrl/Cmd+Shift+O), 전체 심볼 (Ctrl/Cmd+T).
- VS Code 연습: 과제 디렉터리를 code 명령으로 열기 / kernel/main.c에서 main 함수 정의 찾기 (Ctrl+P, Ctrl+Shift+O) / proc 구조체 정의 찾기 (Ctrl+T) / swtch 함수를 호출하는 모든 함수 찾기 (Ctrl+Shift+F).

## Hands-on Lab: Hello, xv6

- 목표: xv6를 수정해 `hello`를 입력하면 "hello <name>"이 출력되게 하기.
- 브랜치: xv6-sandbox 저장소에 `sandbox/lab02` 브랜치를 만들어 그 안에서 작업.
- 제출: 완료 후 원격 저장소로 push.
- 변경할 파일: Makefile (수정), user/hello.c (새 파일).
```bash
git add user/Makefile user/hello.c
git commit -m "lab02"
git push origin sandbox/lab02
```
- TA의 코드가 주말에 sandbox/lab02에 업로드됨 — 먼저 시도해 보고 나중에 확인할 것!

## 부록 1: Vim

- vi: UNIX용 비주얼 텍스트 에디터. 3가지 모드 제공. 가볍지만 강력.
- vim: vi improved — undo, 창 분할, 문법 강조, Vim 스크립트 등 제공. 대부분의 리눅스 배포판에 기본 설치.
- 설치(없을 때): `sudo apt update && sudo apt install vim`
- Vim의 3가지 모드:
  - Normal mode: 시작 시 기본 모드. 코드 탐색과 일부 조작.
  - Insert mode: 텍스트 입력·편집. Normal mode에서 [i], [o], [a]로 진입, [esc]로 복귀.
  - EX-mode: 저장/종료, 검색/치환. Normal mode에서 [:], [/]로 진입.
- Normal mode 명령: h j k l (커서 ← ↓ ↑ →), 0 (줄 처음), ^ (공백 제외 줄 시작), $ (줄 끝), gg (파일 처음), Shift+g (파일 끝), i/a/o (insert 모드), yy (1줄 복사), 5yy (5줄 복사), dd (1줄 잘라내기), 5dd (5줄 잘라내기), p (붙여넣기), u (undo), Ctrl+r (redo).
- EX-mode 명령: :w (저장), :q (종료), :q! (저장 없이 종료), :wq (저장 후 종료), :5 (5행으로 이동), :%s/[old]/[new]/g (파일 전체 치환), :%s/[old]/[new]/gc (하나씩 확인하며 치환), :sp [file] (수평 분할), :vs [file] (수직 분할), Ctrl+w+방향키 (분할 화면 이동), (Visual mode)+:norm i// (선택 줄 주석 처리), (Visual mode)+:norm 2x (선택 줄 앞 2글자 삭제 — 주석 제거).
- .vimrc 파일로 Vim 설정 가능 (`vim ~/.vimrc`). 플러그인: NERDTree (파일 트리), Vim-airline (상태 표시), Tlist (심볼 표시).

## 부록 2: GCC

- GCC (GNU Compiler Collection): C, C++, Objective-C/C++, Java, Fortran, Ada 등 여러 언어의 통합 컴파일러 모음. 고수준 언어 소스 코드에서 바이너리 실행 파일 생성.
- gcc (GNU C Compiler): *.c는 C로, *.cpp는 C++로 컴파일. g++ (GNU C++ Compiler): 둘 다 C++로 취급.
- 참고: g++는 링크 시 C++ 표준 라이브러리를 자동으로 쓰지만 gcc는 아님 — gcc로 *.cpp를 컴파일하면 링크 단계에서 ld 오류가 나는 이유.
- 설치: `sudo apt install gcc`, `sudo apt install g++`
- 주요 옵션: -c (컴파일만, 오브젝트 파일 생성), -g (GDB용 디버깅 정보 포함), -o <출력파일>, -I<dir> (헤더 검색 디렉터리 추가), -L<dir> (라이브러리 링크 디렉터리 추가), -D<symbol>[=def] (매크로 정의).
- 연습 1: `gcc -o hello hello.c` (컴파일+링크) 또는 `gcc -c hello.o hello.c` 후 `gcc -o hello hello.o`, 실행은 `./hello`.
- 연습 2 (파일 2개): `g++ -o hello_world main.cpp print.cpp`, 실행 `./hello_world`.

## 부록 3: Makefile

- Make: Unix 계열 OS에서 널리 쓰이는 빌드 자동화 도구. Makefile을 읽어 소스 코드로부터 실행 프로그램·라이브러리를 자동 빌드.
- Makefile: make가 사용하는 지시문 집합 파일. `make` 명령 하나로 실행 파일 생성.
- 장점: 반복적인 컴파일 작업을 명령 하나로 대체, 프로젝트 소스 파일들의 의존성 파악이 쉬움.
- 구성 요소:
```makefile
target: prerequisites
	command1
	command2
```
  - target: 만들려는 파일 (오브젝트 또는 실행 파일). prerequisites: target을 만드는 데 필요한 파일 목록. command: target을 만드는 순차적 단계.
  - 주의: command 앞에는 반드시 탭(tab)이어야 함 (스페이스 불가). vimrc에 "set expandtab"이 있으면 탭이 스페이스로 바뀌므로, 이때는 [Ctrl]+[v] 누른 뒤 [tab].
- 매크로 (Macro): 반복되는 텍스트를 사용자 정의 매크로로. `TARGET = hello_world`로 정의하고 `$(TARGET)`으로 참조. 정의가 참조보다 앞서야 함. 정의에 탭 사용 금지, '', "", =, : 불가. 내부 사전 정의 매크로 존재 (CC, CPPFLAG, LD 등).
- 매크로 치환: `SRCS = abc.cpp def.cpp ghi.cpp`, `OBJS = $(SRCS: .cpp=.o)` → OBJS = abc.o def.o ghi.o.
- 일반적인 C/C++ 프로젝트 구조: bin (컴파일러 출력물), include (헤더), lib (링커용 사용자 라이브러리), src (소스). `tree` 명령으로 구조 확인 (`sudo apt install tree`).
- 연습: [project] 디렉터리 아래 [bin], [include], [lib], [src]를 만들고 이전 연습의 main.cpp, print.cpp를 src에 넣은 뒤 Makefile 작성.
