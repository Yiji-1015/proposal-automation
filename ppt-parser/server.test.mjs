import test from "node:test";
import assert from "node:assert/strict";
import { pageHtml } from "./server.mjs";

test("pageHtml labels the preview as slide image and HTML conversion result", () => {
  const html = pageHtml();

  assert.match(html, /해당 장표 이미지/);
  assert.match(html, /해당 장표에 대한 HTML 변환 결과/);
  assert.match(html, /HTML 다운로드/);
  assert.match(html, /\/api\/html\/.*download/);
});
