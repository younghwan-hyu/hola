# 랩 01: Lab Environment Setting Practice (실습 환경 구축)

- 원본: lab_01_lab_environment_setting_practice.pdf
- 과목: 운영체제 실습, 한양대학교
- 내용: GitHub Classroom 참여 & riscv-xv6 설치

## GitHub Classroom 참여

- 랩용 저장소 생성 링크: https://classroom.github.com/a/mexPtowY
- 이 저장소는 수업 중 hands-on lab에 계속 사용됨. 프로젝트마다 새 링크가 별도 제공됨.
- GitHub 계정이 없으면 가입할 것.
- 목록에서 자기 식별자(identifier)를 선택하고 assignment를 수락. 식별자 형식: `[class_code]-[student_id]`.
- 식별자가 없거나 잘못 선택했으면 조교에게 연락.
- 접근 오류가 나면 이메일을 확인해 초대(invitation)를 수락할 것.
- 저장소 링크를 복사해 Linux/Mac 터미널에서 clone.

## RISC-V 컴파일러 설치

- RISC-V (Reduced Instruction Set Computer V): 누구나 무료로 사용할 수 있는 단순하고 현대적인 CPU 명령어 집합(ISA). x86 같은 레거시 아키텍처의 복잡성을 피함.
- Linux 설치:
```bash
sudo apt update
sudo apt install -y build-essential gdb-multiarch gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu
riscv64-linux-gnu-gcc --version   # 설치 확인
```
- macOS 설치:
```bash
brew update
brew tap riscv/riscv
brew install riscv-tools
riscv64-unknown-elf-gcc --version   # 설치 확인
```

## QEMU 설치

- QEMU (Quick EMUlator): 로컬 머신(x86 또는 ARM)에서 RISC-V CPU를 시뮬레이션하는 소프트웨어 에뮬레이터. 실제 RISC-V 하드웨어 없이 RISC-V xv6 운영체제를 실행·디버깅할 수 있게 해줌.
- Linux 설치:
```bash
sudo apt update
sudo apt install -y qemu-system-misc
qemu-system-riscv64 --version   # 설치 확인
```
- macOS 설치:
```bash
brew update
brew install qemu
qemu-system-riscv64 --version   # 설치 확인
```

## xv6 빌드 및 실행

- clone한 저장소의 루트 디렉터리로 이동: `cd <your-repository-path>`
- QEMU에서 xv6 빌드 및 실행: `make qemu`
- QEMU 종료 방법: `Ctrl-A` 누른 뒤 `X`

## 오늘의 In-Class Hands-on Lab

- QEMU에서 xv6를 실행하고, ls 명령으로 xv6 운영체제의 루트 디렉터리에 무엇이 있는지 확인하기.

## 부록 (Appendix)

### Windows 사용자: WSL2에 Ubuntu 설치

- WSL(Windows Subsystem for Linux): Windows에서 Linux 바이너리를 네이티브로 실행하는 호환 계층.
- PowerShell에서 설치. xv6-riscv를 실행하려면 반드시 24.04 버전을 설치해야 함:
```powershell
wsl --install -d Ubuntu-24.04
```

### Git 설치

- Linux: `sudo apt update && sudo apt install git`, `git --version`으로 확인.
- macOS: 터미널에서 `git --version` 실행 — 설치 안 되어 있으면 설치 팝업이 뜸.

### Git 인증 초기 설정

- GitHub의 Developer Settings로 이동 → 토큰(token) 생성 → 토큰을 복사해 push 시 password 자리에 붙여넣기.

### macOS 사용자: Homebrew 설치

- Homebrew: macOS의 필수 패키지 관리자. riscv-tools, qemu 같은 개발 도구를 쉽게 설치.
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew --version   # 설치 확인
```
