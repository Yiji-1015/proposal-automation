import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const DEFAULT_INDEX = "proposal_ppt_refs_v1";
const DEFAULT_MODEL = "BAAI/bge-m3";

export function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return env;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) return env;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
    return env;
  }, {});
}

function requestJson(url, options = {}) {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const headers = {
    ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
    ...(options.headers ?? {}),
  };

  return new Promise((resolve, reject) => {
    const req = client.request(
      parsed,
      {
        method: options.method ?? "GET",
        headers,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          try {
            const payload = text ? JSON.parse(text) : {};
            resolve({ status: res.statusCode ?? 0, payload });
          } catch (err) {
            reject(new Error(`Invalid JSON response from ${url}: ${err.message}`));
          }
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
}

export function buildKnnSearchBody(queryVector, size = 7) {
  return {
    size,
    _source: [
      "slide_id",
      "source_pptx",
      "slide_no",
      "title",
      "image_description",
      "tags",
      "tags_text",
      "html_ref",
      "image_ref",
    ],
    knn: {
      field: "description_vector",
      query_vector: queryVector,
      k: size,
      num_candidates: Math.max(50, size * 5),
    },
  };
}

export function buildHtmlLookupBody(slideId) {
  return {
    size: 1,
    _source: ["slide_id", "slide_no", "title", "html"],
    query: {
      term: {
        slide_id: slideId,
      },
    },
  };
}

export function normalizeSearchHit(hit) {
  return {
    ...hit._source,
    tags: hit._source?.tags ?? [],
    score: hit._score ?? 0,
  };
}

async function embedQuery(env, query) {
  const model = env.EMBEDDING_MODEL_NAME || env.EMBEDDING_MODEL || DEFAULT_MODEL;
  const headers = {};
  if (env.EMBEDDING_API_KEY) headers.Authorization = `Bearer ${env.EMBEDDING_API_KEY}`;

  const response = await requestJson(env.EMBEDDING_API_URL, {
    method: "POST",
    headers,
    body: { model, input: query },
  });

  if (response.status >= 400) {
    throw new Error(`Embedding request failed: HTTP ${response.status} ${JSON.stringify(response.payload)}`);
  }

  const embedding = response.payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response did not include data[0].embedding.");
  }

  return embedding;
}

async function searchElasticsearch(env, queryVector, size) {
  const headers = {};
  if (env.ELASTICSEARCH_USER && env.ELASTICSEARCH_PASSWORD) {
    headers.Authorization = basicAuth(env.ELASTICSEARCH_USER, env.ELASTICSEARCH_PASSWORD);
  }

  const index = env.ELASTICSEARCH_PPT_INDEX || DEFAULT_INDEX;
  const response = await requestJson(joinUrl(env.ELASTICSEARCH_URL, `${index}/_search`), {
    method: "POST",
    headers,
    body: buildKnnSearchBody(queryVector, size),
    rejectUnauthorized: false,
  });

  if (response.status >= 400) {
    throw new Error(`Elasticsearch KNN search failed: HTTP ${response.status} ${JSON.stringify(response.payload)}`);
  }

  return response.payload?.hits?.hits?.map(normalizeSearchHit) ?? [];
}

export async function getSlideHtmlById(env, slideId) {
  if (!env.ELASTICSEARCH_URL) throw new Error("ELASTICSEARCH_URL is missing.");

  const headers = {};
  if (env.ELASTICSEARCH_USER && env.ELASTICSEARCH_PASSWORD) {
    headers.Authorization = basicAuth(env.ELASTICSEARCH_USER, env.ELASTICSEARCH_PASSWORD);
  }

  const index = env.ELASTICSEARCH_PPT_INDEX || DEFAULT_INDEX;
  const response = await requestJson(joinUrl(env.ELASTICSEARCH_URL, `${index}/_search`), {
    method: "POST",
    headers,
    body: buildHtmlLookupBody(slideId),
    rejectUnauthorized: false,
  });

  if (response.status >= 400) {
    throw new Error(`Elasticsearch HTML lookup failed: HTTP ${response.status} ${JSON.stringify(response.payload)}`);
  }

  const source = response.payload?.hits?.hits?.[0]?._source;
  if (!source?.html) {
    return null;
  }

  return {
    slide_id: source.slide_id,
    slide_no: source.slide_no,
    title: source.title,
    html: source.html,
  };
}

export function loadSearchEnv(repoRoot) {
  return {
    ...loadDotEnv(path.join(repoRoot, ".env")),
    ...process.env,
  };
}

export async function searchSlidesByKnn(env, query, size = 7) {
  if (!env.EMBEDDING_API_URL) throw new Error("EMBEDDING_API_URL is missing.");
  if (!env.ELASTICSEARCH_URL) throw new Error("ELASTICSEARCH_URL is missing.");

  const queryVector = await embedQuery(env, query);
  return searchElasticsearch(env, queryVector, size);
}
