"""
Web Search Tool using Serper API
Common tool available to multiple agent types
"""

import json
import httpx
import yaml
import os
import asyncio
from typing import Any


def get_config(config_path: str | None = None) -> dict[str, Any]:
    """Load configuration from YAML file"""
    if config_path is None:
        config_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "configs",
            "default_config.yaml",
        )
    with open(config_path, "r", encoding="utf-8") as file:
        return yaml.safe_load(file)


def get_expired_keys(expire_keys_file: str | None = None) -> list[str]:
    """Get expired keys from file"""
    if expire_keys_file is None:
        expire_keys_file = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "configs",
            "expired_serper_key.json",
        )

    try:
        with open(expire_keys_file, "r", encoding="utf-8") as file:
            data = json.load(file)
            # Handle both list and dict format
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                return data.get("expired_keys", [])
            else:
                return []
    except FileNotFoundError:
        return []


def save_expired_keys(expired_keys: list[str], expire_keys_file: str | None = None):
    """Save expired keys to file"""
    if expire_keys_file is None:
        expire_keys_file = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "configs",
            "expired_serper_key.json",
        )

    with open(expire_keys_file, "w", encoding="utf-8") as file:
        json.dump(expired_keys, file, indent=2)


def get_valid_serper_key() -> str:
    """Get a valid SERPER API key from the pool, excluding expired keys."""
    yaml_data = get_config()
    SERPER_API_KEY_POOL = yaml_data.get("SERPER_API_KEY_POOL", [])
    expired_keys = get_expired_keys()

    for key in SERPER_API_KEY_POOL:
        if key not in expired_keys and not key.startswith("YOUR_"):
            return key

    raise Exception("All SERPER API keys have expired or are unavailable")


def mark_key_as_expired(key: str):
    """Mark a SERPER API key as expired and save to file."""
    expired_keys = get_expired_keys()

    if key not in expired_keys:
        expired_keys.append(key)
        save_expired_keys(expired_keys)


async def web_search(search_term: str, max_retry: int = 100) -> list[dict[str, str]]:
    """
    Perform web search using Serper API (async version).

    Args:
        search_term: The search query
        explanation: Optional explanation for why this search is being performed
        max_retry: Maximum number of retries

    Returns:
        List of search results, each with title, link, and snippet
    """
    print(f"\n[Web Search] Searching for: {search_term}")

    SERPER_URL = "https://google.serper.dev/search"
    payload = {"q": search_term, "num": 10}

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(max_retry):
            try:
                current_key = get_valid_serper_key()
                headers = {"X-API-KEY": current_key, "Content-Type": "application/json"}

                response = await client.post(SERPER_URL, headers=headers, json=payload)
                serper_response_json = response.json()

                # Check if the response indicates insufficient credits
                if (
                    serper_response_json.get("message") == "Not enough credits"
                    and serper_response_json.get("statusCode") == 400
                ):
                    print("[Web Search] API key has insufficient credits, marking as expired")
                    mark_key_as_expired(current_key)
                    continue

                list_of_results = serper_response_json.get("organic", [])

                # Format results to match expected format
                formatted_results = []
                for result in list_of_results:
                    formatted_results.append(
                        {
                            "title": result.get("title", ""),
                            "url": result.get("link", ""),
                            "snippet": result.get("snippet", ""),
                        }
                    )

                print(f"[Web Search] Found {len(formatted_results)} results")
                return formatted_results

            except Exception as e:
                print(f"[Web Search] Attempt {attempt + 1} failed: {e}")
                if attempt < max_retry - 1:
                    await asyncio.sleep(1)
                else:
                    print("[Web Search] All retries failed")
                    raise e

    return []
