# SelvReader

> PDF와 AI 대화 답변을 읽으면서, 선택한 문맥을 바탕으로 질문·번역·하이라이트·메모를 남길 수 있는 개인용 Chrome 확장 프로그램입니다.

SelvReader는 논문이나 긴 AI 답변을 읽을 때 창을 오가며 문맥을 다시 복사하는 흐름을 줄이는 것을 목표로 합니다. API 키는 사용자가 직접 입력하며, 문서와 메모는 브라우저 로컬 저장소에 보관합니다.

## 주요 기능

- PDF URL 또는 로컬 PDF를 확장 프로그램 리더에서 열기
- PDF 텍스트 선택 후 설명, 번역, 하이라이트, 메모, AI 질문 실행
- 텍스트가 아닌 영역을 드래그해 화면 영역을 이미지 문맥으로 질문
- 선택 영역에 연결된 메모와 하이라이트, `Ctrl/Cmd + Z` 되돌리기
- 선택한 문장, 주변 문단, 문서 제목·개요를 조합한 문맥 기반 AI 질의
- Gemini 또는 OpenAI API 키와 모델을 사용자가 직접 선택하는 BYOK 방식
- ChatGPT/Gemini 페이지에서 현재 답변을 리더로 가져오는 실험적 가져오기 기능
- Markdown, 표, 코드 블록, 수식, 인용, 각주를 포함한 답변 렌더링
- 읽은 문서와 메모를 IndexedDB에 보관하고 Markdown으로 내보내기

## 구성

| 영역 | 구현 |
| --- | --- |
| 리더 UI | React + TypeScript + Vite |
| PDF | PDF.js 텍스트 레이어 및 캔버스 렌더링 |
| 답변 렌더링 | react-markdown, GFM, KaTeX, Highlight.js, DOMPurify |
| 확장 프로그램 | Chrome Manifest V3, service worker, content script |
| 저장소 | IndexedDB + Chrome Storage |
| AI 연결 | 브라우저에서 사용자가 입력한 Gemini/OpenAI API 키로 직접 호출 |

## 사전 요구 사항

- Google Chrome 116 이상
- Node.js 20 LTS 이상 권장
- npm
- 선택 사항: Gemini 또는 OpenAI API 키

이 프로젝트는 Node.js/TypeScript 앱입니다. Python 런타임을 사용하지 않으므로 `requirements.txt`가 필요하지 않습니다. 의존성은 `package.json`과 `package-lock.json`으로 관리합니다.

## 로컬 개발

```bash
npm install
npm run dev
```

개발 서버는 리더 UI 확인에 유용합니다. 다만 content script, service worker, 현재 탭과의 통신은 Chrome 확장 프로그램으로 로드했을 때만 동작합니다.

## 확장 프로그램 빌드 및 로드

### 1. 배포 파일 생성

```bash
npm install
npm run build
```

명령이 완료되면 프로젝트 루트의 `dist/` 폴더가 생성됩니다. 이 폴더가 Chrome에 로드할 확장 프로그램의 루트입니다.

### 2. Unpacked 확장 프로그램으로 로드

1. Chrome 주소창에 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 저장소의 `dist` 폴더를 선택합니다. 예: `.../Moonlight/dist`
5. SelvReader 아이콘을 고정하고, 팝업에서 확장 프로그램 사용 여부와 PDF 자동 열기 설정을 조정합니다.

### 3. 소스 수정 후 반영

```bash
npm run build
```

그 다음 `chrome://extensions`에서 SelvReader의 새로고침 버튼을 누르고, 열려 있던 PDF·ChatGPT·Gemini 탭도 새로고침합니다. 이미 열린 탭에는 이전 content script가 남아 있을 수 있습니다.

## 사용 방법

### PDF 읽기

1. 확장 팝업에서 **PDF 자동 열기**를 켜거나, PDF 페이지에서 확장 프로그램을 실행합니다.
2. 리더에서 텍스트를 선택합니다.
3. 선택 끝 근처에 나타나는 메뉴에서 설명, 번역, 하이라이트, 메모 또는 AI 질문을 선택합니다.
4. 질문에는 선택문과 문서 메타데이터·주변 문단이 필요한 범위만 함께 전달됩니다.

### AI 답변 가져오기

1. 지원되는 ChatGPT 또는 Gemini 대화 페이지에서 답변 일부를 선택합니다.
2. 선택 메뉴의 **리더로 가져오기**를 누릅니다.
3. 현재 선택이 속한 답변과 인접 대화를 분석해 SelvReader 리더로 엽니다.

웹 서비스의 DOM 구조는 수시로 변경될 수 있으므로 답변 가져오기는 실험적 기능입니다. 사용 전 각 서비스의 이용 약관과 계정·콘텐츠 권한을 확인하세요.

### API 키 설정

리더의 설정 화면에서 제공자를 선택하고 API 키를 입력합니다. 키는 개인 브라우저 저장소에만 저장되며 이 저장소나 별도 백엔드로 전송하지 않습니다. 실제 키가 들어 있는 `.env` 파일은 절대 커밋하지 마세요.

## 품질 확인 명령

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | Vite 개발 서버 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run build` | 타입 검사 후 확장 프로그램 산출물 생성 |
| `npm run preview` | 빌드 결과 미리보기 |

풀 리퀘스트 또는 배포 전에는 최소한 아래 명령을 실행합니다.

```bash
npm run lint
npm run build
```

## 저장소 관리 원칙

- `dist/`, `node_modules/`, 로그, 로컬 API 키와 브라우저별 설정은 커밋하지 않습니다.
- 실제 논문, PDF, 대화 HTML 캡처, 개인 메모는 민감할 수 있으므로 커밋하지 않습니다.
- `tests/`의 기존 파일은 기능 구현용 자동 테스트가 아니라 대용량 로컬 분석 캡처이므로 공개 저장소에서 제외합니다.
- 이 저장소는 개인 학습·포트폴리오 목적의 프로토타입입니다. SelvReader는 다른 제품 또는 서비스와 제휴하거나 그 제품을 복제한다고 주장하지 않습니다.

## 알려진 제한 사항

- PDF 스캔본처럼 텍스트 레이어가 없는 문서는 일반 텍스트 선택이 제한될 수 있습니다.
- ChatGPT/Gemini 가져오기는 해당 서비스의 화면 구조 변경에 영향을 받습니다.
- API 비용과 사용량 제한은 사용자가 선택한 제공자·모델 정책을 따릅니다.
- Chrome Web Store에 게시하려면 별도의 스토어 정책, 개인정보처리방침, 권한 사유, 아이콘 및 스토어 등록 정보를 검토해야 합니다.

## License

아직 라이선스를 선택하지 않았습니다. 공개 배포 범위를 정한 뒤 MIT, Apache-2.0 등 프로젝트 의도에 맞는 라이선스를 추가하세요.
