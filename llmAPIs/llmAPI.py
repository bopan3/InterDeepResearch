"""
LLM API module using LiteLLM for Visual Deep Research (IDR) system
"""

import litellm

# litellm._turn_on_debug()
import os
from typing import Any
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import asyncio
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from utils.util import decode_unicode_escape

# Import LiteLLM exception types
from litellm.exceptions import ServiceUnavailableError, RateLimitError, APIConnectionError, Timeout

# Disable SSL verification to handle expired certificates
litellm.ssl_verify = False

def print_green(text: str):
    """Print text in green color"""
    print(f"\033[92m{text}\033[0m")


def print_yellow(text: str):
    """Print text in yellow color"""
    print(f"\033[93m{text}\033[0m")


@retry(
    stop=stop_after_attempt(100),
    wait=wait_exponential(multiplier=1, min=4, max=30),
    retry=retry_if_exception_type(
        (asyncio.TimeoutError, ServiceUnavailableError, RateLimitError, APIConnectionError, Timeout, Exception)
    ),
    reraise=True,
)
async def llm_message_completion(
    model: str,
    customized_base_url: str,
    customized_api_key: str,
    messages: list[dict[str, str]],
    stream: bool = True,
    **kwargs,
) -> str:
    """Generate completion using LiteLLM"""

    # Prepare additional parameters for litellm
    litellm_kwargs = kwargs.copy()
    if customized_base_url:
        litellm_kwargs["base_url"] = customized_base_url
    if customized_api_key:
        litellm_kwargs["api_key"] = customized_api_key

    try:
        if stream:
            # Streaming mode with timeout protection
            response_text = ""
            stream_response = await litellm.acompletion(
                model=model, messages=messages, stream=True, timeout=600, **litellm_kwargs
            )

            async def process_stream():
                nonlocal response_text
                async for chunk in stream_response:
                    if hasattr(chunk.choices[0].delta, "content") and chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        print(content, end="", flush=True)
                        response_text += content
                        await asyncio.sleep(0)
                return response_text

            response_text = await asyncio.wait_for(process_stream(), timeout=600)
            print()  # New line after streaming
            response_text_decoded = decode_unicode_escape(response_text)
            print_green(f"[{model}] Response: {response_text_decoded}")
            return response_text

        else:
            # Non-streaming mode
            response = await litellm.acompletion(
                model=model, messages=messages, stream=False, timeout=600, **litellm_kwargs
            )
            response_text = response.choices[0].message.content
            response_text_decoded = decode_unicode_escape(response_text)
            print_green(f"[{model}] Response: {response_text_decoded}")
            return response_text

    except asyncio.TimeoutError:
        print("\n⚠️ Timeout, will retry...")
        raise
    except ServiceUnavailableError as e:
        print(f"\n⚠️ Service unavailable (503): {e}, will retry with exponential backoff...")
        raise
    except RateLimitError as e:
        print(f"\n⚠️ Rate limit exceeded: {e}, will retry with exponential backoff...")
        raise
    except (APIConnectionError, Timeout) as e:
        print(f"\n⚠️ Connection error: {e}, will retry...")
        raise
    except Exception as e:
        print(f"\n⚠️ Error: {e}, will retry...")
        raise


@retry(
    stop=stop_after_attempt(100),
    wait=wait_exponential(multiplier=1, min=4, max=30),
    retry=retry_if_exception_type(
        (asyncio.TimeoutError, ServiceUnavailableError, RateLimitError, APIConnectionError, Timeout, Exception)
    ),
    reraise=True,
)
async def llm_message_completion_with_tool_call(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    customized_base_url: str,
    customized_api_key: str,
    tool_choice: str = "auto",
    parallel_tool_calls: bool = False,
    stream: bool = False,
    **kwargs,
) -> Any:
    """
    Generate completion with tool calling support using LiteLLM.
    Returns the full response object containing tool calls if any.

    Args:
        model: The model to use
        messages: List of message dictionaries
        tools: List of tool definitions in OpenAI format
        tool_choice: "auto", "none", or specific tool name
        parallel_tool_calls: Whether to allow parallel tool calls (default: False)
        stream: Whether to stream (typically False for tool calling)
        **kwargs: Additional arguments for litellm.acompletion

    Returns:
        Response object from LiteLLM containing message and potential tool_calls
    """

    # Prepare additional parameters for litellm
    litellm_kwargs = kwargs.copy()
    if customized_base_url:
        litellm_kwargs["base_url"] = customized_base_url
    if customized_api_key:
        litellm_kwargs["api_key"] = customized_api_key

    try:
        print_yellow(f"[{model}] Calling with {len(tools)} tools available...")

        response = await litellm.acompletion(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            parallel_tool_calls=parallel_tool_calls,
            stream=stream,
            timeout=600,
            **litellm_kwargs,
        )

        response_message = response.choices[0].message

        # Print response content
        if hasattr(response_message, "content") and response_message.content:
            content_decoded = decode_unicode_escape(response_message.content)
            print_green(f"[{model}] Response content: {content_decoded}")
        else:
            print_green(f"[{model}] Response content: None")

        # Print tool calls if any
        if hasattr(response_message, "tool_calls") and response_message.tool_calls:
            print_green(f"[{model}] Response with {len(response_message.tool_calls)} tool call(s)")
            for tool_call in response_message.tool_calls:
                tool_name = decode_unicode_escape(tool_call.function.name)
                tool_args = decode_unicode_escape(tool_call.function.arguments)
                print_green(f"  - Tool: {tool_name}")
                print_green(f"    Arguments: {tool_args}")
        else:
            print_green(f"[{model}] Response completed (no tool calls)")

        return response

    except asyncio.TimeoutError:
        print(f"\n⚠️ Timeout, will retry...")
        raise
    except ServiceUnavailableError as e:
        print(f"\n⚠️ Service unavailable (503): {e}, will retry with exponential backoff...")
        raise
    except RateLimitError as e:
        print(f"\n⚠️ Rate limit exceeded: {e}, will retry with exponential backoff...")
        raise
    except (APIConnectionError, Timeout) as e:
        print(f"\n⚠️ Connection error: {e}, will retry...")
        raise
    except Exception as e:
        print(f"\n⚠️ Error: {e}, will retry...")
        raise
