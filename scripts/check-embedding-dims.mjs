import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(process.cwd(), ".env");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const fileEnv = loadDotEnv(ENV_PATH);
const env = { ...fileEnv, ...process.env };

const apiUrl = readArg("url") || env.EMBEDDING_API_URL;
let model =
  readArg("model") ||
  env.EMBEDDING_MODEL_NAME ||
  env.EMBEDDING_MODEL;
const input =
  readArg("input") ||
  "임베딩 차원 확인용 테스트 문장입니다. Proposal slide retrieval test.";
const apiKey = env.EMBEDDING_API_KEY;

if (!apiUrl) {
  console.error("EMBEDDING_API_URL is missing. Add it to .env or pass --url=...");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
};

if (apiKey) {
  headers.Authorization = `Bearer ${apiKey}`;
}

const body = {
  model,
  input,
};

console.log(`Embedding endpoint: ${apiUrl}`);
console.log(`Input chars: ${input.length}`);

if (!model) {
  const modelsUrl = new URL(apiUrl);
  modelsUrl.pathname = "/v1/models";

  const modelsResponse = await fetch(modelsUrl);
  if (!modelsResponse.ok) {
    console.error(
      `EMBEDDING_MODEL_NAME is missing, and model discovery failed: HTTP ${modelsResponse.status}`
    );
    console.error((await modelsResponse.text()).slice(0, 1200));
    process.exit(1);
  }

  const modelsJson = await modelsResponse.json();
  model = modelsJson?.data?.[0]?.id;

  if (!model) {
    console.error("EMBEDDING_MODEL_NAME is missing, and /v1/models returned no model ids.");
    process.exit(1);
  }
}

console.log(`Model: ${model}`);

const response = await fetch(apiUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

const text = await response.text();

if (!response.ok) {
  console.error(`Request failed: HTTP ${response.status}`);
  console.error(text.slice(0, 1200));
  process.exit(1);
}

let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("Response was not valid JSON:");
  console.error(text.slice(0, 1200));
  process.exit(1);
}

const embedding = json?.data?.[0]?.embedding;

if (!Array.isArray(embedding)) {
  console.error("Could not find data[0].embedding in the response.");
  console.error(JSON.stringify(json, null, 2).slice(0, 1200));
  process.exit(1);
}

console.log(`Embedding dimensions: ${embedding.length}`);
console.log(`First 5 values: ${embedding.slice(0, 5).map((n) => Number(n).toFixed(6)).join(", ")}`);
