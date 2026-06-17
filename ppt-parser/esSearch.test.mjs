import test from "node:test";
import assert from "node:assert/strict";
import { buildHtmlLookupBody, buildKnnSearchBody, normalizeSearchHit } from "./esSearch.mjs";

test("buildKnnSearchBody creates a KNN-only Elasticsearch query", () => {
  const body = buildKnnSearchBody([0.1, 0.2, 0.3], 5);

  assert.deepEqual(body.knn.query_vector, [0.1, 0.2, 0.3]);
  assert.equal(body.knn.field, "description_vector");
  assert.equal(body.knn.k, 5);
  assert.equal(body.knn.num_candidates, 50);
  assert.ok(body._source.includes("image_description"));
});

test("normalizeSearchHit maps Elasticsearch score and source to slide card data", () => {
  const slide = normalizeSearchHit({
    _score: 0.87,
    _source: {
      slide_id: "elastic_log_001",
      slide_no: 1,
      title: "통합로그 시스템 구성 방안",
      image_description: "구성도 장표",
      tags: ["통합로그"],
      html_ref: "/html/slide_01.html",
      image_ref: "/slides/slide-1.png",
    },
  });

  assert.equal(slide.score, 0.87);
  assert.equal(slide.slide_id, "elastic_log_001");
  assert.deepEqual(slide.tags, ["통합로그"]);
});

test("buildHtmlLookupBody finds the saved HTML by slide_id", () => {
  const body = buildHtmlLookupBody("elastic_log_001");

  assert.deepEqual(body._source, ["slide_id", "slide_no", "title", "html"]);
  assert.equal(body.query.term.slide_id, "elastic_log_001");
});
