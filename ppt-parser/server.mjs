import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSlideHtmlById, loadSearchEnv, searchSlidesByKnn } from "./esSearch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 5174);
const searchEnv = loadSearchEnv(repoRoot);

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendJson(res, body) {
  send(res, 200, JSON.stringify(body), "application/json; charset=utf-8");
}

function sendJsonError(res, status, message) {
  send(res, status, JSON.stringify({ error: message }), "application/json; charset=utf-8");
}

function sendDownload(res, fileName, body) {
  const encodedName = encodeURIComponent(fileName);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
  });
  res.end(body);
}

function serveStatic(res, baseDir, fileName, contentType) {
  const safeName = path.basename(fileName);
  const filePath = path.join(baseDir, safeName);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }

    send(res, 200, data, contentType);
  });
}

export function pageHtml() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PPT Reference Mockup</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Malgun Gothic", sans-serif;
      background: #f5f6f8;
      color: #1d2430;
    }
    header {
      padding: 20px 28px 14px;
      background: #ffffff;
      border-bottom: 1px solid #dde1e7;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(320px, 420px) 1fr;
      gap: 18px;
      padding: 18px;
      min-height: calc(100vh - 77px);
    }
    .panel {
      background: #ffffff;
      border: 1px solid #dde1e7;
      border-radius: 8px;
      min-width: 0;
    }
    .search-panel {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: calc(100vh - 113px);
      overflow: auto;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 7px;
    }
    textarea {
      width: 100%;
      min-height: 116px;
      resize: vertical;
      border: 1px solid #c9ced8;
      border-radius: 6px;
      padding: 10px;
      font: inherit;
      line-height: 1.45;
    }
    button {
      border: 0;
      border-radius: 6px;
      background: #174ea6;
      color: #ffffff;
      font-weight: 700;
      padding: 10px 14px;
      cursor: pointer;
    }
    .download-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      margin-top: 10px;
      border-radius: 6px;
      background: #174ea6;
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      padding: 9px 12px;
      text-decoration: none;
    }
    .result-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .result {
      width: 100%;
      display: grid;
      grid-template-columns: 94px 1fr;
      gap: 10px;
      text-align: left;
      background: #ffffff;
      color: inherit;
      border: 1px solid #d7dce4;
      border-radius: 8px;
      padding: 8px;
    }
    .result.active {
      border-color: #174ea6;
      box-shadow: 0 0 0 2px rgba(23, 78, 166, 0.14);
    }
    .result img {
      width: 94px;
      aspect-ratio: 13 / 9;
      object-fit: cover;
      border: 1px solid #e1e4ea;
      border-radius: 4px;
      background: #f3f4f6;
    }
    .result-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
      margin-bottom: 5px;
    }
    .result-meta {
      font-size: 12px;
      color: #697386;
      margin-bottom: 6px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag {
      padding: 2px 6px;
      border-radius: 999px;
      background: #edf2ff;
      color: #174ea6;
      font-size: 11px;
      line-height: 1.5;
    }
    .preview-panel {
      display: grid;
      grid-template-rows: auto minmax(260px, 44vh) minmax(220px, 1fr);
      overflow: hidden;
    }
    .preview-header {
      padding: 14px 16px;
      border-bottom: 1px solid #dde1e7;
    }
    .preview-title {
      font-weight: 800;
      margin-bottom: 6px;
    }
    .description {
      color: #4b5565;
      font-size: 14px;
      line-height: 1.5;
    }
    .image-stage {
      padding: 14px;
      background: #e9edf3;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      justify-content: center;
      min-width: 0;
    }
    .stage-label {
      align-self: flex-start;
      color: #344054;
      font-size: 13px;
      font-weight: 800;
    }
    .image-stage img {
      max-width: 100%;
      max-height: calc(100% - 28px);
      border: 1px solid #cfd5df;
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(27, 39, 55, 0.14);
    }
    .html-stage {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
      border-top: 1px solid #dde1e7;
      background: #ffffff;
    }
    .html-stage .stage-label {
      padding: 10px 14px;
      border-bottom: 1px solid #dde1e7;
      background: #f8fafc;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #ffffff;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      .search-panel { max-height: none; }
      .preview-panel { min-height: 820px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>PPT Reference Search Mockup</h1>
  </header>

  <main>
    <section class="panel search-panel">
      <form id="search-form">
        <label for="query">RFP 요구사항 또는 만들고 싶은 장표</label>
        <textarea id="query">Kafka 기반으로 여러 시스템의 로그를 수집하고 Elasticsearch에 저장하는 통합로그 시스템 구성 장표</textarea>
        <button type="submit">검색</button>
      </form>
      <div id="result-list" class="result-list"></div>
    </section>

    <section class="panel preview-panel">
      <div class="preview-header">
        <div id="preview-title" class="preview-title">검색 결과를 선택하세요</div>
        <div id="preview-description" class="description"></div>
        <a id="download-html" class="download-link" href="#" download>HTML 다운로드</a>
      </div>
      <div class="image-stage">
        <div class="stage-label">해당 장표 이미지</div>
        <img id="preview-image" alt="선택한 슬라이드 미리보기" />
      </div>
      <div class="html-stage">
        <div class="stage-label">해당 장표에 대한 HTML 변환 결과</div>
        <iframe id="preview-html" title="해당 장표에 대한 HTML 변환 결과"></iframe>
      </div>
    </section>
  </main>

  <script>
    const form = document.getElementById("search-form");
    const query = document.getElementById("query");
    const resultList = document.getElementById("result-list");
    const previewTitle = document.getElementById("preview-title");
    const previewDescription = document.getElementById("preview-description");
    const previewImage = document.getElementById("preview-image");
    const previewHtml = document.getElementById("preview-html");
    const downloadHtml = document.getElementById("download-html");
    let selectedId = null;

    function selectSlide(slide) {
      selectedId = slide.slide_id;
      previewTitle.textContent = slide.slide_no + ". " + slide.title;
      previewDescription.textContent = slide.image_description;
      previewImage.src = slide.image_ref;
      previewHtml.src = slide.html_ref;
      downloadHtml.href = "/api/html/" + encodeURIComponent(slide.slide_id) + "/download";
      downloadHtml.download = slide.slide_id + ".html";
      document.querySelectorAll(".result").forEach((button) => {
        button.classList.toggle("active", button.dataset.id === selectedId);
      });
    }

    function renderResults(slides) {
      resultList.innerHTML = "";
      slides.forEach((slide, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "result";
        button.dataset.id = slide.slide_id;
        button.innerHTML = \`
          <img src="\${slide.image_ref}" alt="">
          <div>
            <div class="result-title">\${slide.slide_no}. \${slide.title}</div>
            <div class="result-meta">score \${slide.score} · \${slide.slide_id}</div>
            <div class="tags">\${slide.tags.map((tag) => \`<span class="tag">\${tag}</span>\`).join("")}</div>
          </div>
        \`;
        button.addEventListener("click", () => selectSlide(slide));
        resultList.appendChild(button);
        if (index === 0) selectSlide(slide);
      });
    }

    async function runSearch() {
      const params = new URLSearchParams({ q: query.value });
      const response = await fetch("/api/search?" + params.toString());
      const data = await response.json();
      if (!response.ok) {
        resultList.innerHTML = '<div class="description">' + (data.error || "검색 실패") + '</div>';
        return;
      }
      renderResults(data.results);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });

    runSearch();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/ppt-mockup") {
    send(res, 200, pageHtml(), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/search") {
    const query = url.searchParams.get("q") ?? "";
    try {
      const results = await searchSlidesByKnn(searchEnv, query, 7);
      sendJson(res, { results });
    } catch (err) {
      console.error(err.stack || err);
      sendJsonError(res, 500, err.message ?? "KNN search failed");
    }
    return;
  }

  const downloadMatch = url.pathname.match(/^\/api\/html\/([^/]+)\/download$/);
  if (downloadMatch) {
    try {
      const slideId = decodeURIComponent(downloadMatch[1]);
      const slide = await getSlideHtmlById(searchEnv, slideId);
      if (!slide) {
        sendJsonError(res, 404, `HTML not found for ${slideId}`);
        return;
      }

      const fileName = `${slide.slide_id}.html`;
      sendDownload(res, fileName, slide.html);
    } catch (err) {
      console.error(err.stack || err);
      sendJsonError(res, 500, err.message ?? "HTML download failed");
    }
    return;
  }

  if (url.pathname.startsWith("/slides/")) {
    serveStatic(res, path.join(__dirname, "slides"), url.pathname.split("/").pop(), "image/png");
    return;
  }

  if (url.pathname.startsWith("/html/")) {
    serveStatic(res, path.join(__dirname, "elastic_log_html"), url.pathname.split("/").pop(), "text/html; charset=utf-8");
    return;
  }

  send(res, 404, "Not found");
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`PPT mockup server: http://localhost:${PORT}`);
  });
}
