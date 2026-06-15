from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.routing import Mount, Route
from starlette.requests import Request
from starlette.responses import PlainTextResponse, HTMLResponse, Response
from urllib.parse import quote
import subprocess
import tempfile
import os
import base64
import uvicorn

mcp = FastMCP("kordoc-remote")


def run_kordoc(data: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(data)
        input_path = f.name
    try:
        result = subprocess.run(
            ["kordoc", "parse", input_path],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 and not result.stdout:
            return f"ERROR:\n{result.stderr}"
        return result.stdout
    finally:
        os.remove(input_path)


@mcp.tool()
def parse_document(filename: str, file_base64: str) -> str:
    suffix = os.path.splitext(filename)[1]
    return run_kordoc(base64.b64decode(file_base64), suffix)


async def index(request: Request):
    return HTMLResponse("""<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>문서 파서</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 80px auto; }
    input[type=file] { display: block; margin: 16px 0; }
    button { padding: 8px 20px; cursor: pointer; }
    #status { margin-top: 16px; color: gray; }
  </style>
</head>
<body>
  <h2>문서 → Markdown 변환</h2>
  <input type="file" id="file">
  <button onclick="upload()">변환 및 다운로드</button>
  <div id="status"></div>
  <script>
    async function upload() {
      const file = document.getElementById('file').files[0];
      if (!file) return alert('파일을 선택하세요.');
      document.getElementById('status').textContent = '변환 중...';
      const form = new FormData();
      form.append('file', file);
      const resp = await fetch('/parse', { method: 'POST', body: form });
      if (!resp.ok) { document.getElementById('status').textContent = '오류 발생'; return; }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name.replace(/\\.[^.]+$/, '.md');
      a.click();
      document.getElementById('status').textContent = '완료!';
    }
  </script>
</body>
</html>""")


async def parse_endpoint(request: Request):
    form = await request.form()
    file = form.get("file")
    if file is None:
        return PlainTextResponse("ERROR: 'file' field is required", status_code=400)
    stem = os.path.splitext(file.filename)[0]
    suffix = os.path.splitext(file.filename)[1]
    data = await file.read()
    content = run_kordoc(data, suffix)
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(stem + '.md')}"},
    )


app = Starlette(routes=[
    Route("/", index),
    Route("/parse", parse_endpoint, methods=["POST"]),
    Mount("/mcp", mcp.streamable_http_app()),
])

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8888)