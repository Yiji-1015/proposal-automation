import test from "node:test";
import assert from "node:assert/strict";
import { searchSlides } from "./slideSearch.mjs";

test("searchSlides ranks a matching log collection slide first", () => {
  const slides = [
    {
      slide_id: "slide-1",
      slide_no: 1,
      title: "통합로그 시스템 구성 방안",
      image_description: "Kafka 기반 로그 수집 전송 저장 검색 시스템 구성도",
      tags: ["통합로그", "Kafka", "시스템구성도"],
    },
    {
      slide_id: "slide-7",
      slide_no: 7,
      title: "로그 분석 및 시각화",
      image_description: "대시보드 기반 모니터링 지표와 이상 이벤트 분석",
      tags: ["대시보드", "모니터링", "시각화"],
    },
  ];

  const results = searchSlides(slides, "Kafka 로그 수집 구성도");

  assert.equal(results[0].slide_id, "slide-1");
  assert.ok(results[0].score > results[1].score);
});

test("searchSlides keeps slide order for an empty query", () => {
  const slides = [
    { slide_id: "slide-1", slide_no: 1, title: "A", image_description: "", tags: [] },
    { slide_id: "slide-2", slide_no: 2, title: "B", image_description: "", tags: [] },
  ];

  const results = searchSlides(slides, "");

  assert.deepEqual(
    results.map((slide) => slide.slide_id),
    ["slide-1", "slide-2"]
  );
});
