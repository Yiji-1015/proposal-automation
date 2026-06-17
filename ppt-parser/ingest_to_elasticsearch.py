#!/usr/bin/env python3
import argparse
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
DEFAULT_INDEX = "proposal_ppt_refs_v1"
DEFAULT_DIMS = 1024


def load_dotenv(path):
    env = {}
    if not path.exists():
        return env

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")

    return env


def parse_slide_library(path):
    source = path.read_text(encoding="utf-8")
    match = re.search(r"export\s+const\s+slides\s*=\s*(\[.*?\]);", source, re.S)
    if not match:
        raise ValueError(f"Could not find `export const slides = [...]` in {path}")

    js_array = match.group(1)
    json_like = re.sub(r"([{\[,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', js_array)
    json_like = re.sub(r",(\s*[}\]])", r"\1", json_like)
    return json.loads(json_like)


def request_json(url, method="GET", body=None, headers=None, insecure=False):
    data = None
    request_headers = dict(headers or {})

    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    context = ssl._create_unverified_context() if insecure else None
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=60, context=context) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = text
        return exc.code, payload


def basic_auth_header(user, password):
    import base64

    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def join_url(base, path):
    return base.rstrip("/") + "/" + path.lstrip("/")


def get_embedding_model(env):
    if env.get("EMBEDDING_MODEL_NAME"):
        return env["EMBEDDING_MODEL_NAME"]
    if env.get("EMBEDDING_MODEL"):
        return env["EMBEDDING_MODEL"]

    models_url = env["EMBEDDING_API_URL"].replace("/v1/embeddings", "/v1/models")
    status, payload = request_json(models_url)
    if status >= 400:
        raise RuntimeError(f"Model discovery failed: HTTP {status} {payload}")

    return payload["data"][0]["id"]


def embed_text(env, model, text):
    headers = {}
    if env.get("EMBEDDING_API_KEY"):
        headers["Authorization"] = f"Bearer {env['EMBEDDING_API_KEY']}"

    status, payload = request_json(
        env["EMBEDDING_API_URL"],
        method="POST",
        body={"model": model, "input": text},
        headers=headers,
    )
    if status >= 400:
        raise RuntimeError(f"Embedding failed: HTTP {status} {payload}")

    return payload["data"][0]["embedding"]


def build_index_body(dims=DEFAULT_DIMS):
    return {
        "mappings": {
            "properties": {
                "slide_id": {"type": "keyword"},
                "source_pptx": {"type": "keyword"},
                "slide_no": {"type": "integer"},
                "title": {"type": "text"},
                "image_description": {"type": "text"},
                "tags": {"type": "keyword"},
                "tags_text": {"type": "text"},
                "html": {"type": "text", "index": False},
                "html_ref": {"type": "keyword", "index": False},
                "image_ref": {"type": "keyword", "index": False},
                "description_vector": {
                    "type": "dense_vector",
                    "dims": dims,
                    "index": True,
                    "similarity": "cosine",
                },
                "created_at": {"type": "date"},
            }
        }
    }


def build_slide_document(slide, embedding, html, created_at):
    return {
        "slide_id": slide["slide_id"],
        "source_pptx": slide["source_pptx"],
        "slide_no": slide["slide_no"],
        "title": slide["title"],
        "image_description": slide["image_description"],
        "tags": slide["tags"],
        "tags_text": slide["tags_text"],
        "html": html,
        "html_ref": slide["html_ref"],
        "image_ref": slide["image_ref"],
        "description_vector": embedding,
        "created_at": created_at,
    }


def read_slide_html(slide):
    html_name = Path(slide["html_ref"]).name
    return (ROOT / "elastic_log_html" / html_name).read_text(encoding="utf-8")


def elastic_headers(env):
    headers = {}
    if env.get("ELASTICSEARCH_USER") and env.get("ELASTICSEARCH_PASSWORD"):
        headers["Authorization"] = basic_auth_header(
            env["ELASTICSEARCH_USER"], env["ELASTICSEARCH_PASSWORD"]
        )
    return headers


def ensure_index(env, index, dims):
    headers = elastic_headers(env)
    status, _ = request_json(
        join_url(env["ELASTICSEARCH_URL"], index),
        method="HEAD",
        headers=headers,
        insecure=True,
    )
    if status == 200:
        return "exists"
    if status != 404:
        raise RuntimeError(f"Index check failed: HTTP {status}")

    status, payload = request_json(
        join_url(env["ELASTICSEARCH_URL"], index),
        method="PUT",
        body=build_index_body(dims),
        headers=headers,
        insecure=True,
    )
    if status >= 400:
        raise RuntimeError(f"Index create failed: HTTP {status} {payload}")
    return "created"


def index_document(env, index, doc, id_mode):
    path = f"{index}/_doc"
    method = "POST"
    if id_mode == "slide_id":
        path = f"{path}/{doc['slide_id']}"
        method = "PUT"

    status, payload = request_json(
        join_url(env["ELASTICSEARCH_URL"], path),
        method=method,
        body=doc,
        headers=elastic_headers(env),
        insecure=True,
    )
    if status >= 400:
        raise RuntimeError(f"Index document failed: HTTP {status} {payload}")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Ingest PPT reference slides into Elasticsearch.")
    parser.add_argument("--index", default=DEFAULT_INDEX)
    parser.add_argument("--dims", type=int, default=DEFAULT_DIMS)
    parser.add_argument("--id-mode", choices=["auto", "slide_id"], default="auto")
    parser.add_argument("--no-create-index", action="store_true")
    args = parser.parse_args()

    env = {**load_dotenv(REPO_ROOT / ".env")}
    for key in ["ELASTICSEARCH_URL", "EMBEDDING_API_URL"]:
        if not env.get(key):
            raise SystemExit(f"{key} is missing in .env")

    slides = parse_slide_library(ROOT / "slideLibrary.mjs")
    model = get_embedding_model(env)

    print(f"index: {args.index}")
    print(f"embedding model: {model}")
    print(f"id mode: {args.id_mode}")

    if not args.no_create_index:
        print(f"index state: {ensure_index(env, args.index, args.dims)}")

    created_at = datetime.now(timezone.utc).isoformat()
    for slide in slides:
        embedding = embed_text(env, model, slide["image_description"])
        if len(embedding) != args.dims:
            raise RuntimeError(
                f"{slide['slide_id']} embedding dims mismatch: {len(embedding)} != {args.dims}"
            )

        doc = build_slide_document(slide, embedding, read_slide_html(slide), created_at)
        result = index_document(env, args.index, doc, args.id_mode)
        print(f"{slide['slide_id']} -> {result.get('_id')} ({result.get('result')})")

    print(f"done: {len(slides)} slides")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise
