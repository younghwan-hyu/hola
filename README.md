# 학습 보조 아바타

1. **Docker를 준비합니다.**

   Docker Desktop을 설치하고 실행합니다. Docker Engine을 사용하는 환경에서는 Docker Compose도 사용할 수 있어야 합니다.

2. **전달받은 파일을 배치합니다.**

   저장소를 내려받거나 압축을 푼 뒤, 따로 전달받은 `.env`와 `google_service_account.json`을 `server/` 폴더에 넣습니다. 파일 이름은 그대로 유지합니다.

   ```text
   hola/
   ├── compose.yml
   ├── server/
   │   ├── .env
   │   └── google_service_account.json
   └── web/
   ```

3. **프로그램을 실행합니다.**

   터미널에서 `compose.yml`이 있는 저장소 루트 폴더로 이동한 뒤 실행합니다.

   ```bash
   docker compose up --build -d
   ```

   최초 실행에는 인터넷 연결이 필요하며, 이미지 빌드와 임베딩 모델 다운로드로 몇 분 걸릴 수 있습니다. 웹·서버·DB·임베딩 서비스가 함께 실행됩니다.

4. **브라우저에서 접속합니다.**

   실행한 컴퓨터에서 <http://localhost:8080>을 엽니다. 마이크나 카메라를 사용할 때는 브라우저의 권한 요청을 허용합니다.

   화면이 열리지 않으면 아래 명령으로 서비스 상태와 로그를 확인합니다.

   ```bash
   docker compose ps
   docker compose logs --tail=100
   ```

5. **강의 자료를 RAG에 등록합니다.**

   `demo/` 폴더의 문서는 자동으로 등록되지 않습니다. 웹의 RAG 문서 업로드 기능에서 `demo/`의 `.md` 파일을 직접 업로드해야 AI가 해당 자료를 검색해 답변에 활용할 수 있습니다.

   PDF 뷰어로 문서를 여는 것만으로는 RAG에 등록되지 않습니다. 업로드한 문서는 DB에 저장되므로, DB 볼륨을 삭제하지 않는 한 프로그램을 다시 실행해도 유지됩니다.

6. **종료하거나 다시 실행합니다.**

   저장소 루트 폴더에서 실행합니다.

   ```bash
   # 종료 (저장된 문서와 다운로드한 모델은 유지)
   docker compose down

   # 다시 실행
   docker compose up -d
   ```
