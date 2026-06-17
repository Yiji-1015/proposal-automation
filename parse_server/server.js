import express from "express";
import multer from "multer";
import { parse } from "kordoc";
import path from "path";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <title>문서 → Markdown 변환기</title>
  <style>
    body { font-family: sans-serif; max-width: 520px; margin: 80px auto; }
    h2 { margin-bottom: 8px; }
    input, button { margin-top: 16px; }
    button { padding: 8px 18px; cursor: pointer; }
    #status { margin-top: 16px; color: #666; }
  </style>
</head>
<body>
  <h2>문서 → Markdown 변환</h2>
  <p>HWP/PDF 파일을 업로드하면 .md 파일로 다운로드됩니다.</p>

  <input type="file" id="file" accept=".hwp,.hwpx,.pdf,.docx,.pptx" />
  <br />
  <button onclick="uploadFile()">변환 및 다운로드</button>

  <div id="status"></div>

  <script>
    async function uploadFile() {
      const file = document.getElementById("file").files[0];
      const status = document.getElementById("status");

      if (!file) {
        alert("파일을 선택하세요.");
        return;
      }

      status.textContent = "변환 중...";

      const form = new FormData();
      form.append("file", file);

      const resp = await fetch("/parse", {
        method: "POST",
        body: form
      });

      if (!resp.ok) {
        const text = await resp.text();
        status.textContent = "오류 발생: " + text;
        return;
      }

      const blob = await resp.blob();
      const downloadName = file.name.replace(/\\.[^.]+$/, ".md");

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = downloadName;
      a.click();

      URL.revokeObjectURL(a.href);
      status.textContent = "완료!";
    }
  </script>
</body>
</html>
  `);
});

app.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("file 필드가 필요합니다.");
    }

    const result = await parse(req.file.buffer);

    if (!result.success) {
      return res.status(500).send(String(result.error ?? "문서 변환 실패"));
    }

    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const stem = path.basename(originalName, path.extname(originalName));
    const outputName = encodeURIComponent(stem + ".md");

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${outputName}`
    );

    res.send(result.markdown);
    } catch (err) {
    console.error(err.stack || err);
    res.status(500).send(err.message ?? "서버 오류");
    }
});

app.listen(8888, "0.0.0.0", () => {
  console.log("문서 변환 서버 실행 중: http://0.0.0.0:8888");
});