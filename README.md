# 📋 Nexon Open API 연동 게시판

> 넥슨 Open API(마비노기 경매장)로 아이템 정보를 실시간 조회·반영하고, **게시글/댓글 CRUD**와 **회원·사용자 관리** 기능을 제공하는 Bootstrap 기반 웹 게시판
---

## 📌 목차

1. [프로젝트 소개](#-프로젝트-소개)
2. [주요 기능](#-주요-기능)
3. [기술 스택](#-기술-스택)
4. [시스템 아키텍처](#-시스템-아키텍처)
5. [처리 흐름](#-처리-흐름)
6. [데이터 구조](#-데이터-구조)
7. [라우트 목록](#-라우트-목록)

---

## 📖 프로젝트 소개

넥슨 **마비노기 Open API의 경매장 데이터**를 활용해 **최신 아이템 정보를 불러와 거래글에 연결**할 수 있는 게시판입니다. 회원가입·로그인, 게시글·댓글 CRUD, 게시판 분류(자유 / 공지 / 거래), 이미지 업로드, 사용자 활동 정보 조회까지 게시판 운영에 필요한 기능을 직접 구현했습니다.

- **Open API 연동**: 거래글 작성 시 경매장 아이템을 키워드로 검색·선택하면 해당 정보가 게시글에 함께 저장됨 (검색 요청마다 Open API를 호출해 최신 데이터 반영)
- **유저 관리**: bcrypt 해시 기반 인증, 세션 로그인, 로그인 횟수·최근 로그인 기록
- **게시판 기능**: 검색, 페이지네이션, 공지 상단 노출, 3단계 대댓글

---

## ✨ 주요 기능

| 분류 | 기능 |
| --- | --- |
| **회원** | 회원가입(비밀번호 형식 검증, 아이디 중복 검사), 로그인/로그아웃, 사용자 정보 페이지 |
| **게시판** | 자유게시판 · 공지사항 · 거래게시판, 제목 검색, 페이지네이션(10개 단위), 최신 공지 노출 |
| **게시글** | 작성 · 조회 · 수정 · 삭제, 이미지 첨부, 작성자 본인만 수정·삭제 가능 |
| **거래글** | Open API로 경매장 아이템 검색(검색어 일치도순 정렬) 후 선택 → 아이템 정보를 게시글에 저장 (선택 필수) |
| **댓글** | 작성 · 수정 · 삭제, 대댓글(최대 3단계), 대댓글이 있는 댓글은 삭제 불가 |
| **사용자 정보** | 작성 글·댓글 수, 로그인 횟수, 최근 작성 글·댓글 5건 |

---

## 🛠 기술 스택

| 영역 | 기술 |
| --- | --- |
| **Frontend** | EJS, express-ejs-layouts, Bootstrap |
| **Backend** | Node.js, Express, express-session, body-parser, method-override |
| **Database** | SQLite (sqlite3) |
| **인증 / 보안** | bcrypt (비밀번호 해시), 세션 기반 로그인 |
| **파일 업로드** | multer (disk storage) |
| **외부 API** | Nexon Open API (마비노기 경매장), axios, dotenv |

---

## 🏗 시스템 아키텍처

```mermaid
flowchart LR
    subgraph Client["🌐 Client"]
        U["Browser<br/>EJS 렌더링 · Bootstrap UI"]
    end

    subgraph Server["🖥 Express Server (port 3000)"]
        M["미들웨어<br/>session · body-parser · method-override"]
        R["Routes<br/>게시판 · 댓글 · 회원 · 사용자 정보"]
        API["/api/mabi-auction<br/>키워드 검색 · 유사도 필터링"]
    end

    DB[("SQLite<br/>data/board.db")]
    FS[("uploads/<br/>첨부 이미지")]
    NX["Nexon Open API<br/>마비노기 경매장 /auction/list"]

    U -- "HTTP 요청" --> M
    M --> R
    U -- "아이템 검색" --> API
    R <--> DB
    R --> FS
    API <--> NX
```

---

## 🔄 처리 흐름

### 1. 회원가입

```mermaid
flowchart TD
    A(["회원가입 요청"]) --> B{"비밀번호 형식<br/>영문 + 숫자 8자 이상?"}
    B -- "아니오" --> C["형식 오류 안내"]
    B -- "예" --> D["bcrypt 해시<br/>salt rounds 10"]
    D --> E{"users INSERT<br/>아이디 중복?"}
    E -- "중복" --> F["중복 오류 안내"]
    E -- "성공" --> G(["로그인 페이지로 이동"])
```

### 2. 로그인 · 접근 제어

```mermaid
flowchart TD
    A(["로그인 요청"]) --> B["users에서 아이디 조회"]
    B --> C{"사용자 존재?"}
    C -- "없음" --> X["아이디 또는 비밀번호<br/>불일치 안내"]
    C -- "있음" --> D{"bcrypt.compare 일치?"}
    D -- "불일치" --> X
    D -- "일치" --> E["lastLoginAt 갱신<br/>loginCount 증가"]
    E --> F["세션에 userId · username 저장"]
    F --> G(["메인 페이지로 이동"])

    R(["로그인이 필요한 페이지 접근"]) --> Q{"세션 userId 존재?"}
    Q -- "예" --> OK(["요청 처리"])
    Q -- "아니오" --> L(["로그인 페이지로 이동"])
```

> 아이디 없음과 비밀번호 불일치에 **같은 안내 문구**를 사용해 계정 존재 여부가 노출되지 않도록 했습니다.

### 3. 게시글 목록 조회

```mermaid
flowchart TD
    A(["GET / ?board=&q=&page="]) --> B["최신 공지사항 1건 조회"]
    B --> C["게시판별 전체 글 수 집계<br/>검색어가 있으면 제목 LIKE 조건 적용"]
    C --> D["페이지당 10개 조회<br/>LIMIT · OFFSET"]
    D --> E["페이지네이션 정보 계산"]
    E --> F(["index 페이지 렌더링"])
```

### 4. 거래글 작성 (Open API 연동)

```mermaid
sequenceDiagram
    actor U as 사용자
    participant P as 거래글 작성 페이지
    participant S as Express 서버
    participant N as Nexon Open API
    participant DB as SQLite

    U->>P: 아이템 검색어 입력
    P->>S: GET /api/mabi-auction?keyword=...
    S->>N: GET /auction/list (keyword, cursor)
    N-->>S: 경매장 아이템 목록
    S->>S: 유사도 필터링 · 정렬
    S-->>P: 검색 결과 (auction_item, next_cursor)
    U->>P: 아이템 선택 + 제목 · 본문 · 이미지 입력
    P->>S: POST /write/trade (multipart)
    S->>S: 제목 · 본문 · 아이템 정보 검증
    S->>DB: INSERT posts (boardType = deal, auctionInfo)
    S-->>U: 거래 게시판으로 이동
```

### 5. 아이템 검색 처리 (Open API 연동 라우터)

`routes/mabiAuction.js`가 검색 요청마다 넥슨 Open API(마비노기 경매장)를 호출해 **최신 데이터**를 가져오고, 검색어와의 일치도를 계산해 결과를 걸러 냅니다.

```mermaid
flowchart TD
    A(["GET /api/mabi-auction?keyword="]) --> B{"keyword 있음?"}
    B -- "없음" --> E1["400 · keyword is required"]
    B -- "있음" --> C["특수문자 제거 · 공백 정리<br/>한글 · 영문 · 숫자만 허용"]
    C --> D{"정제 후 비어 있음?"}
    D -- "예" --> E2["400 · 올바르지 않은 keyword"]
    D -- "아니오" --> F["Open API 호출<br/>GET /auction/list"]
    F --> G["유사도 점수 계산<br/>아이템명 · 표시명 중 높은 점수 채택"]
    G --> H["모든 검색어를 포함한 아이템만 남김<br/>점수 내림차순 정렬"]
    H --> I{"누적 10건 이상<br/>또는 호출 5회 도달?"}
    I -- "예" --> OK(["결과 + next_cursor 반환"])
    I -- "아니오" --> J{"next_cursor 있음?"}
    J -- "없음" --> OK2(["누적 결과 반환"])
    J -- "있음" --> K["1초 대기 후<br/>next_cursor로 재호출"]
    K --> F
    F -. "호출 제한 OPENAPI00007" .-> E3["429 · 잠시 후 재시도 안내<br/>retryAfter 60"]
    F -. "그 외 오류" .-> E4["500 · API 요청 실패"]
```

**유사도 계산 방식**

| 항목 | 내용 |
| --- | --- |
| 검색어 분리 | 공백 기준으로 분리하며, 대소문자와 공백을 무시하고 비교 |
| 매칭 조건 | 모든 검색어가 아이템명(`item_name`) 또는 표시명(`item_display_name`)에 포함되어야 함 |
| 점수 | 일치한 검색어 길이의 합 + 기본 50점, 검색어를 이어 붙인 전체 문자열이 포함되면 +100점 |
| 정렬 | 점수 내림차순 |

**오류 처리**

| 상황 | 응답 |
| --- | --- |
| keyword 없음 / 정제 후 빈 값 | 400 |
| 호출 제한 (`OPENAPI00007`) | 429 + `retryAfter: 60` |
| 그 외 API 오류 | 500 |

> 페이지 단위(cursor)로 이어서 조회하며, 호출 간 **1초 간격**을 두어 호출 제한에 걸리지 않도록 했습니다.

### 6. 게시글 작성 · 검증

```mermaid
flowchart TD
    A(["글 작성 요청"]) --> UP["이미지 업로드 처리<br/>multer · 타임스탬프 + 난수 파일명"]
    UP --> B{"제목 입력?"}
    B -- "아니오" --> E1["400 · 제목 입력 안내"]
    B -- "예" --> C{"본문이 비어 있음?<br/>빈 HTML 태그까지 검사"}
    C -- "비어 있음" --> E2["400 · 내용 입력 안내"]
    C -- "내용 있음" --> D{"거래 게시판?"}
    D -- "아니오 (자유 · 공지)" --> G["posts INSERT"]
    D -- "예" --> F{"아이템 정보 선택됨?"}
    F -- "아니오" --> E3["400 · 아이템 선택 안내"]
    F -- "예" --> G
    G --> H(["해당 게시판으로 이동"])
```

### 7. 게시글 수정 · 삭제 (작성자 검증)

```mermaid
flowchart TD
    A(["수정 · 삭제 요청"]) --> B{"로그인 상태?"}
    B -- "아니오" --> L(["로그인 페이지로 이동"])
    B -- "예" --> C["게시글 조회"]
    C --> D{"작성자 본인?<br/>post.userId = session.userId"}
    D -- "아니오" --> E["403 · 권한 없음"]
    D -- "예" --> F{"요청 종류"}
    F -- "수정 (PUT)" --> G["제목 · 본문 UPDATE<br/>새 이미지가 없으면 기존 이미지 유지"]
    F -- "삭제 (DELETE)" --> H["해당 글의 댓글 먼저 삭제"]
    H --> I["게시글 삭제"]
    G --> J(["상세 · 목록 페이지로 이동"])
    I --> J
```

### 8. 댓글 작성 · 삭제

```mermaid
flowchart TD
    A(["댓글 작성 요청"]) --> B{"부모 댓글 있음?"}
    B -- "없음" --> C["최상위 댓글<br/>depth = 0"]
    B -- "있음" --> D["depth = 부모 depth + 1"]
    D --> E{"depth > 2?"}
    E -- "예" --> F["등록 거부<br/>max_depth 오류"]
    E -- "아니오" --> G["comments INSERT"]
    C --> G
```

```mermaid
flowchart TD
    A(["댓글 삭제 요청"]) --> B{"본인 댓글?<br/>id + username 일치"}
    B -- "아니오" --> E1["403 · 권한 없음"]
    B -- "예" --> C{"대댓글 존재?"}
    C -- "있음" --> E2["400 · 삭제 불가"]
    C -- "없음" --> D["comments DELETE"]
    D --> F(["삭제 완료"])
```

> 댓글은 `parent_id`로 부모와 연결되며, 조회 시 부모–대댓글 **트리 구조**로 묶어서 화면에 전달합니다.

---

## 🗂 데이터 구조

```mermaid
erDiagram
    USERS ||--o{ POSTS : "작성"
    USERS ||--o{ COMMENTS : "작성"
    POSTS ||--o{ COMMENTS : "포함"
    COMMENTS ||--o{ COMMENTS : "대댓글"

    USERS {
        int id PK
        text username UK
        text password "bcrypt 해시"
        text createdAt
        text lastLoginAt
        int loginCount
    }
    POSTS {
        int id PK
        int userId FK
        text boardType "free, notice, deal"
        text title
        text content
        text image
        text createdAt
        text auctionInfo "거래글 아이템 정보"
    }
    COMMENTS {
        int id PK
        int postId FK
        int userId FK
        text username
        text content
        int parent_id FK
        int depth "0 ~ 2"
        text createdAt
    }
```

> 서버 시작 시 테이블이 없으면 자동 생성, 기존 DB에는 `ALTER TABLE`로 누락된 컬럼을 보완.

---

## 🧭 라우트 목록

| Method | Path | 설명 | 로그인 |
| --- | --- | --- | :---: |
| GET / POST | `/register` | 회원가입 | |
| GET / POST | `/login` | 로그인 | |
| GET | `/logout` | 로그아웃 | |
| GET | `/userinfo` | 사용자 정보 | ✅ |
| GET | `/` | 게시판 목록 (`board`, `q`, `page`) | ✅ |
| GET / POST | `/write/trade` | 거래글 작성 | ✅ |
| GET / POST | `/write/free` | 자유·공지 글 작성 | ✅ |
| GET | `/post/:id` | 게시글 상세 + 댓글 | ✅ |
| GET / PUT | `/edit/:id` | 게시글 수정 | ✅ |
| DELETE | `/delete/:id` | 게시글 삭제 | ✅ |
| POST | `/post/:id/comment` | 댓글 · 대댓글 작성 | ✅ |
| GET | `/comment/:id/edit` | 댓글 수정 페이지 | ✅ |
| PUT | `/comment/:id` | 댓글 수정 | ✅ |
| DELETE | `/comment/:id` | 댓글 삭제 | ✅ |
| GET | `/api/mabi-auction?keyword=` | 마비노기 경매장 아이템 검색 (Open API) | |
---

---

## 📝 향후 개선 방향

- 세션 시크릿을 환경 변수로 분리하고, 운영 환경에서는 세션 저장소를 SQLite·Redis 등으로 교체
- 게시글 본문(HTML) 저장 시 sanitize 적용으로 XSS 방지, 폼 요청에 CSRF 토큰 도입
- 이미지 업로드 시 확장자·용량 제한 추가
- 호환용으로 남겨 둔 중복 글쓰기 라우트(`/write`, `/write/general`) 정리
- 댓글 작성 시 빈 내용 검증 추가
- 아이템 검색 결과 캐싱과 검색 입력 debounce로 Open API 호출 횟수 절감 (호출 제한 대응)
- cursor 반복 호출 시 1초 지연이 누적되어 응답이 길어질 수 있어, 단계적 로딩 등 개선 검토
- 라우트 단위 파일 분리 (현재 `app.js`에 집중)
