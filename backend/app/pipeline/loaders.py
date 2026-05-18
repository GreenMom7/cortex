"""Document loaders for PDF, JSON, CSV, URL, Wikipedia."""
from __future__ import annotations

import csv
import json
from pathlib import Path
from urllib.parse import urlparse

import fitz  # PyMuPDF
import requests
from bs4 import BeautifulSoup
from langchain_core.documents import Document


def load_pdf(path: str) -> list[Document]:
    docs = []
    source = Path(path).stem
    with fitz.open(path) as pdf:
        for i, page in enumerate(pdf):
            text = page.get_text().strip()
            if len(text) > 80:
                docs.append(Document(
                    page_content=text,
                    metadata={"source": source, "page": i + 1, "type": "pdf"},
                ))
    return docs


def load_json(path: str) -> list[Document]:
    """Load a JSON file. Handles either a list of records or a single object."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = [data]

    docs = []
    for i, record in enumerate(data):
        title = record.get("title") or record.get("name") or f"record_{i}"
        body = record.get("body") or record.get("text") or record.get("content") or ""
        parts = [f"Title: {title}"]
        for key in ("author", "source", "category", "date"):
            if record.get(key):
                parts.append(f"{key.capitalize()}: {record[key]}")
        parts.append(f"Body: {body}")
        docs.append(Document(
            page_content="\n".join(parts),
            metadata={"source": title, "index": i, "type": "json"},
        ))
    return docs


def load_csv(path: str) -> list[Document]:
    docs = []
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            content = "\n".join(f"{k}: {v}" for k, v in row.items() if v)
            docs.append(Document(
                page_content=content,
                metadata={"source": Path(path).stem, "row": i, "type": "csv"},
            ))
    return docs


def load_url(url: str) -> list[Document]:
    """Generic web page or Wikipedia article."""
    host = urlparse(url).netloc.lower()

    if "wikipedia.org" in host:
        try:
            import wikipedia
            title = url.split("/wiki/")[-1].replace("_", " ")
            page = wikipedia.page(title, auto_suggest=False)
            return [Document(
                page_content=page.content,
                metadata={"source": page.title, "url": page.url, "type": "wikipedia"},
            )]
        except Exception:
            pass  # fall through to generic fetch

    resp = requests.get(url, timeout=30, headers={"User-Agent": "Cortex/1.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = " ".join(soup.get_text(separator=" ").split())
    title = (soup.title.string if soup.title else url).strip()
    return [Document(
        page_content=text,
        metadata={"source": title, "url": url, "type": "web"},
    )]


def load_any(path_or_url: str) -> list[Document]:
    """Dispatch by extension or scheme."""
    if path_or_url.startswith(("http://", "https://")):
        return load_url(path_or_url)
    p = Path(path_or_url)
    suffix = p.suffix.lower()
    if suffix == ".pdf":
        return load_pdf(path_or_url)
    if suffix == ".json":
        return load_json(path_or_url)
    if suffix == ".csv":
        return load_csv(path_or_url)
    raise ValueError(f"Unsupported file type: {suffix}")
