"""
Utility functions for Visual Deep Research (IDR) system
"""

from typing import Any
import codecs
import json_repair
import yaml
import tiktoken



def decode_unicode_escape(text: str) -> str:
    """
    Convert Unicode escape sequences (\\uXXXX) to readable characters.
    Useful for displaying Chinese and other Unicode characters properly.

    Args:
        text: String that may contain Unicode escape sequences

    Returns:
        Decoded string with readable characters
    """

    try:
        # Try to decode Unicode escape sequences
        # Using 'unicode_escape' codec, but need to handle it carefully
        return text.encode("utf-8").decode("unicode_escape").encode("latin1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        # If the above fails, try a simpler approach
        try:
            return codecs.decode(text, "unicode_escape")
        except Exception:
            # If all else fails, return original text
            return text


def parse_json_from_llm_response(response: str):
    """
    Parse JSON from LLM response that contains JSON wrapped in ```json blocks
    According to the specification in the development document.
    """
    # parse response
    start_tag = "```json"
    end_tag = "```"
    start_idx = response.find(start_tag)
    start_idx += len(start_tag)
    end_idx = response.rfind(end_tag, start_idx)
    response_json = response[start_idx:end_idx]
    response_json = json_repair.loads(response_json)
    return response_json

def parse_markdown_from_llm_response(response: str):
    """
    Parse Markdown from LLM response that contains Markdown wrapped in ```markdown blocks
    According to the specification in the development document.
    """
    start_tag = "```markdown"
    end_tag = "```"
    start_idx = response.find(start_tag)
    start_idx += len(start_tag)
    end_idx = response.rfind(end_tag, start_idx)
    response_markdown = response[start_idx:end_idx]
    return response_markdown


def load_config(config_path: str):
    """Load configuration from a YAML file"""
    with open(config_path, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config


def count_tokens(messages: list[dict[str, Any]], model: str = "gpt-4") -> int:
    """
    Count the number of tokens in the messages list.

    Args:
        messages: List of messages
        model: Model name for token encoding (default: gpt-4)

    Returns:
        Number of tokens
    """
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        encoding = tiktoken.get_encoding("cl100k_base")

    num_tokens = 0
    for message in messages:
        # Every message follows <|start|>{role/name}\n{content}<|end|>\n
        num_tokens += 4
        for value in message.values():
            if isinstance(value, str):
                num_tokens += len(encoding.encode(value))
            elif isinstance(value, list):
                # Handle tool_calls array
                num_tokens += len(encoding.encode(str(value)))
    num_tokens += 2  # Every reply is primed with <|start|>assistant
    return num_tokens


def print_token_usage(messages: list[dict[str, Any]], context_limit: int = 128000):
    """
    Print current token usage and percentage of context limit.

    Args:
        messages: List of messages to count tokens for
        context_limit: Maximum context window size (default: 128K)
    """
    token_count = count_tokens(messages)
    percentage = (token_count / context_limit) * 100

    print("\033[32m" + "=" * 80)
    print("📊 TOKEN USAGE BEFORE LLM CALL")
    print(f"Current Tokens: {token_count:,}")
    print(f"Context Limit: {context_limit:,}")
    print(f"Usage Percentage: {percentage:.2f}%")
    print(f"Remaining Tokens: {context_limit - token_count:,}")
    print("=" * 80 + "\033[0m")
