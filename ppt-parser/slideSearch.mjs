const TOKEN_PATTERN = /[a-zA-Z0-9가-힣]+/g;

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

export function tokenize(value) {
  return normalize(value).match(TOKEN_PATTERN) ?? [];
}

function countMatches(tokens, text) {
  const normalizedText = normalize(text);
  return tokens.reduce((count, token) => {
    if (!token) return count;
    return count + (normalizedText.includes(token) ? 1 : 0);
  }, 0);
}

export function searchSlides(slides, query) {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return slides.map((slide) => ({ ...slide, score: 0 }));
  }

  return slides
    .map((slide) => {
      const tagsText = [...(slide.tags ?? []), slide.tags_text].filter(Boolean).join(" ");
      const score =
        countMatches(tokens, slide.title) * 4 +
        countMatches(tokens, tagsText) * 3 +
        countMatches(tokens, slide.image_description) * 2;

      return { ...slide, score };
    })
    .sort((a, b) => b.score - a.score || a.slide_no - b.slide_no);
}
