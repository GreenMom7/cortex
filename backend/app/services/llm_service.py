"""LLM factory — abstracts away which provider/model is in use.

Catalog is intentionally hardcoded so the UI can offer dropdowns without
roundtripping to each provider. Update when new models ship.
"""
from __future__ import annotations

from app.core.session import state

MODEL_CATALOG: dict[str, list[str]] = {
    "openai": [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
    ],
    "gemini": [
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
    ],
    "anthropic": [
        "claude-opus-4-7",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
    ],
    "nvidia": [
        "meta/llama-3.1-70b-instruct",
        "meta/llama-3.1-405b-instruct",
        "mistralai/mixtral-8x22b-instruct-v0.1",
        "nvidia/nemotron-4-340b-instruct",
        "deepseek-ai/deepseek-r1",
    ],
    "groq": [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "openai/gpt-oss-20b",
        "qwen/qwen3-32b",
        "mixtral-8x7b-32768",
    ],
}


def get_llm(provider: str | None = None, model: str | None = None, api_key: str | None = None):
    """Construct a LangChain chat model for the chosen provider/model.

    Falls back to session state when args are None.

    Notes on defaults:
    - temperature=0.2 — small jitter prevents the degenerate-repetition loops
      that temperature=0 produces on some open-weight models (Llama family).
      Still effectively deterministic for structured outputs (Cypher, JSON).
    - max_tokens=2048 — hard cap so a runaway model can't paste the same
      clause 200 times. Enough headroom for normal prose answers.
    """
    provider = (provider or state.llm_provider).lower()
    model = model or state.llm_model
    api_key = api_key or state.llm_api_key

    if not provider or not model:
        raise ValueError("LLM provider/model not configured.")

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model, api_key=api_key,
            temperature=0.2, max_tokens=2048, frequency_penalty=0.4,
        )

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model, google_api_key=api_key,
            temperature=0.2, max_output_tokens=2048,
        )

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model, api_key=api_key,
            temperature=0.2, max_tokens=2048,
        )

    if provider == "nvidia":
        from langchain_nvidia_ai_endpoints import ChatNVIDIA
        return ChatNVIDIA(
            model=model, api_key=api_key,
            temperature=0.2, max_tokens=2048,
        )

    if provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(
            model_name=model, groq_api_key=api_key,
            temperature=0.2, max_tokens=2048, frequency_penalty=0.4,
        )

    raise ValueError(f"Unknown LLM provider: {provider}")


def get_embeddings(provider: str | None = None, model: str | None = None):
    """Embedding model factory."""
    provider = provider or state.embedding_provider
    model = model or state.embedding_model

    if provider == "sentence-transformers":
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(
            model_name=model,
            encode_kwargs={"normalize_embeddings": True},
        )

    if provider == "nvidia":
        from langchain_nvidia_ai_endpoints import NVIDIAEmbeddings
        return NVIDIAEmbeddings(model=model, truncate="END")

    if provider == "openai":
        from langchain_openai import OpenAIEmbeddings
        return OpenAIEmbeddings(model=model, api_key=state.llm_api_key)

    raise ValueError(f"Unknown embedding provider: {provider}")
