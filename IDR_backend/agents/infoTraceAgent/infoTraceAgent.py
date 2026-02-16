"""
Info Trace Agent for IDR Version 5

This module provides the InfoTraceAgent class, which is responsible for tracing
the information source of a given content. It recursively checks the card_ref_explicit
of each card to find supporting content from predecessor cards.

The agent uses a simple support finding tool to determine if a predecessor card
contains content that supports the current node's content.
"""

import json
import os
import sys
from typing import Any

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from llmAPIs.llmAPI import llm_message_completion_with_tool_call
from IDR_backend.data_models.project_models import ProjectManager


# ============================================================================
# Simple Fuzzy Matching
# ============================================================================


def _fuzzy_match_in_source(text_to_match: str, source_text: str) -> str:
    """
    Find the exact substring in source_text that corresponds to text_to_match.

    Used by _apply_highlight_to_content to find matching parts in the card's main content
    so that <highlight> tags can be applied accurately.

    Strategy:
    1. First try exact match (fast path)
    2. If not found, use rapidfuzz partial_ratio_alignment for O(n) fuzzy substring search

    Args:
        text_to_match: Text to find in source (may differ due to markdown rendering)
        source_text: Original source text

    Returns:
        The exact substring from source_text that matches, or text_to_match as fallback
    """
    # 1. Fast path: exact match
    if text_to_match in source_text:
        return text_to_match

    if len(text_to_match) < 5:
        return text_to_match  # Too short for fuzzy matching

    # 2. Use rapidfuzz partial_ratio_alignment - finds best matching substring in O(n)
    try:
        from rapidfuzz.fuzz import partial_ratio_alignment
    except ImportError:
        return text_to_match  # Fallback if rapidfuzz not installed

    # partial_ratio_alignment finds the best matching substring and returns alignment info
    # It's much faster than manual sliding window because it uses optimized C++ implementation
    result = partial_ratio_alignment(text_to_match, source_text, score_cutoff=50)

    if result is None:
        return text_to_match  # No good match found

    # Extract the matched substring from source_text using alignment positions
    # result.dest_start and result.dest_end give us the position in source_text
    matched_text = source_text[result.dest_start : result.dest_end]

    return matched_text if matched_text else text_to_match


def _apply_highlight_with_separator_handling(text: str) -> str:
    """
    Apply <highlight> tags to text, handling table/list separators properly.

    If the text contains markdown separators (|, -), the highlight tags
    are applied to each segment separately because <highlight> tags don't work
    across separators.

    Args:
        text: The text to wrap with highlight tags

    Returns:
        Text with <highlight> tags applied appropriately
    """
    import re

    # Check if the text contains table/list separators that would break highlight rendering
    # Separators include: | (table separator) and - at line start (list item)
    separator_pattern = r"(\||(?:^|\n)- )"

    # Check if there are any separators in the text
    if not re.search(separator_pattern, text):
        # No separators, apply highlight to the entire text
        return f"<highlight>{text}</highlight>"

    # Split by separators while keeping the separators
    parts = re.split(separator_pattern, text)

    result_parts = []
    for part in parts:
        # Check if this part is a separator
        if re.match(separator_pattern, part):
            # Don't wrap separators with highlight
            result_parts.append(part)
        else:
            # Wrap non-separator content with highlight (if non-empty after stripping)
            stripped = part.strip()
            if stripped:
                # Preserve original whitespace by only wrapping the content
                # Find leading and trailing whitespace
                leading_ws = part[: len(part) - len(part.lstrip())]
                trailing_ws = part[len(part.rstrip()) :]
                content = part.strip()
                result_parts.append(f"{leading_ws}<highlight>{content}</highlight>{trailing_ws}")
            else:
                # Empty or whitespace-only part, keep as is
                result_parts.append(part)

    return "".join(result_parts)


# ============================================================================
# System Prompt for Root Content Extraction Agent
# ============================================================================

ROOT_CONTENT_EXTRACTION_SYSTEM_PROMPT = """You are a Root Content Extraction Agent. Your task is to \
extract the specific content from a source card that corresponds to a traced content snippet.

Given:
1. A content snippet that needs to be traced
2. The original source card content (the raw markdown content of the card)

Your job is to:
1. Carefully read both the traced content and the source card content
2. Identify which part(s) of the source card content correspond to the traced content
3. Extract the exact matching content from the source card (must be findable using string.find())
4. The extracted content should be as close as possible to the traced content,
   but must match the exact text in the source

Important notes:
- The traced content is guaranteed to come from this source card
- Your task is to find and extract the exact corresponding text from the source
- For tables/lists, extract only the relevant parts if the traced content is partial
- If multiple non-contiguous parts match, extract them as separate items
- The extracted content must be continuous text snippets from the source that can be found using string.find()

CRITICAL FORMAT REQUIREMENT:
When calling the tool, you MUST return extracted_content_list as a native JSON array, NOT as a stringified JSON string.

CORRECT format:
{"extracted_content_list": ["text1", "text2"], "reasoning": "..."}

WRONG format (DO NOT DO THIS):
{"extracted_content_list": "[\"text1\", \"text2\"]", "reasoning": "..."}

The extracted_content_list value should be an array [...], not a string "...".
"""

# ============================================================================
# Tool Definition for Root Content Extraction
# ============================================================================

ROOT_CONTENT_EXTRACTION_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "report_extraction_result",
            "description": (
                "Report the extracted content from the source card that corresponds to "
                "the traced content snippet. Call this function after identifying the "
                "matching content in the source card."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reasoning": {
                        "type": "string",
                        "description": (
                            "Brief explanation of how you matched the traced content to the source content."
                        ),
                    },
                    "extracted_content_list": {
                        "type": "array",
                        "description": (
                            "The specific content from the source card that corresponds to "
                            "the traced content. Each item must be a continuous text snippet "
                            "that exactly matches text in the source (can be found using string.find()). "
                            "IMPORTANT: If the traced content maps to multiple non-contiguous parts "
                            "in the source, extract them as separate array items."
                        ),
                        "items": {
                            "type": "string",
                        },
                    },
                },
                "required": ["reasoning", "extracted_content_list"],
            },
        },
    }
]


# ============================================================================
# System Prompt for Support Finding Agent
# ============================================================================

SUPPORT_FINDING_SYSTEM_PROMPT = """You are a Support Finding Agent. Your task is to \
analyze whether a predecessor card contains content that supports or provides \
evidence for a given claim/statement.

Given:
1. A claim/statement that needs to be traced (the content we want to find support for)
2. The content of a predecessor card (potential source of support)

Your job is to:
1. Carefully read the predecessor card content
2. Determine if any part of the predecessor card content supports, provides evidence \
for, or is the source of the given claim
3. If yes, extract the specific supporting content from the predecessor card.
4. If no, indicate that no supporting content was found

Important notes:
- The traced content is guaranteed to come from this source card
- For tables/lists, extract only the relevant parts if the traced content is partial
- If multiple non-contiguous parts match, extract them as separate items
- The extracted content must be continuous text snippets from the source that can be found using string.find()
- Be thorough but precise and concise - only extract content that genuinely supports the claim.

CRITICAL FORMAT REQUIREMENT:
When calling the tool, you MUST return support_content_list as a native JSON array, NOT as a stringified JSON string.

CORRECT format:
{"has_support": true, "support_content_list": ["content 1", "content 2"], "reasoning": "..."}

WRONG format (DO NOT DO THIS):
{"has_support": true, "support_content_list": "[\"content 1\", \"content 2\"]", "reasoning": "..."}

The support_content_list value should be an array [...], not a string "...".
"""

# ============================================================================
# Tool Definition for Support Finding
# ============================================================================

SUPPORT_FINDING_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "report_support_finding_result",
            "description": (
                "Report the result of searching for supporting content in the "
                "predecessor card. Call this function after analyzing whether the "
                "predecessor card contains content that supports the given claim."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reasoning": {
                        "type": "string",
                        "description": ("Brief explanation of why the content does or does not support the claim."),
                    },
                    "has_support": {
                        "type": "boolean",
                        "description": (
                            "True if the predecessor card contains content that supports the claim, False otherwise."
                        ),
                    },
                    "support_content_list": {
                        "type": "array",
                        "description": (
                            "The specific content from the predecessor card that "
                            "supports the claim. Each item must be a continuous text snippet "
                            "that exactly matches the original text (can be found using string.find()). "
                            "IMPORTANT: If multiple non-contiguous parts support the claim, "
                            "extract them as separate array items. Set to empty array if has_support is False."
                        ),
                        "items": {
                            "type": "string",
                        },
                    },
                },
                "required": ["reasoning", "has_support", "support_content_list"],
            },
        },
    }
]


# ============================================================================
# Trace Result Tree Node
# ============================================================================


class TraceResultNode:
    """Represents a node in the trace result tree."""

    def __init__(
        self,
        card_id: str,
        support_content_list: list[str] | None = None,
        card_main_content_with_highlight: str | list[dict[str, Any]] | None = None,
    ):
        """
        Initialize a trace result node.

        Args:
            card_id: The ID of the card this node represents
            support_content_list: List of supporting content snippets found in this card (None means lacking support)
            card_main_content_with_highlight: The main content of the card with <highlight> tags around matched parts
                - For WebSearchResultCard: list of search result dicts
                - For WebpageCard: string (markdown_convert_from_webpage with highlights)
                - For NoteCard: string (markdown_with_cite with highlights)
        """
        self.card_id = card_id
        self.support_content_list = support_content_list
        self.card_main_content_with_highlight = card_main_content_with_highlight
        # Children can be:
        # - empty list []: leaf node with no predecessors
        # - list of nodes: has supporting children
        # - None: explicitly set to indicate lacking support
        self.children: list[TraceResultNode] | None = []

    def to_dict(self) -> dict[str, Any]:
        """Convert the node and its children to a dictionary."""
        children_dict: list[dict[str, Any]] | None = None
        if self.children is not None:
            children_dict = [child.to_dict() for child in self.children]
        return {
            "card_id": self.card_id,
            "support_content_list": self.support_content_list,
            "card_main_content_with_highlight": self.card_main_content_with_highlight,
            "children": children_dict,
        }


# ============================================================================
# Info Trace Agent
# ============================================================================


class InfoTraceAgent:
    """
    Agent responsible for tracing information sources.

    This agent takes a card and content to trace, then recursively searches
    through the card's explicit references to find supporting evidence.
    """

    def __init__(
        self,
        project_id: str,
        agent_id: str,
        project_manager: ProjectManager,
        global_config: dict[str, Any],
    ):
        """
        Initialize the Info Trace Agent.

        Args:
            project_id: The project ID
            agent_id: The agent ID (root agent ID to access card_dict)
            project_manager: The project manager instance
            global_config: Global configuration dictionary
        """
        self.project_id = project_id
        self.agent_id = agent_id
        self.project_manager = project_manager
        self.global_config = global_config
        self.trace_failed = False  # Global flag to track if any branch lacks support

    async def _get_card_content(self, card_id: str) -> str | None:
        """
        Get the readable content of a card.

        Args:
            card_id: The ID of the card to read

        Returns:
            The card content as a string, or None if card not found
        """
        card = self.project_manager.get_info_card(self.project_id, self.agent_id, card_id)
        return await card.read_info_card_content()

    def _get_card_main_content(self, card_id: str) -> str | list[dict[str, Any]]:
        """
        Get the main content of a card based on its type.

        Args:
            card_id: The ID of the card

        Returns:
            - For WebSearchResultCard: list of search result dicts (search_result_list)
            - For WebpageCard: string (markdown_convert_from_webpage)
            - For NoteCard: string (markdown_with_cite)

        Raises:
            ValueError: If card type is not supported or content is not available
        """
        card = self.project_manager.get_info_card(self.project_id, self.agent_id, card_id)

        if card.card_type == "web_search_result":
            # WebSearchResultCard: card_content["search_result_list"] is a list
            search_result_list = card.card_content.get("search_result_list")
            if search_result_list is None:
                raise ValueError(f"WebSearchResultCard {card_id} has no search_result_list")
            return search_result_list

        elif card.card_type == "webpage":
            # WebpageCard: card_content.markdown_convert_from_webpage is a string
            markdown_content = card.card_content.markdown_convert_from_webpage
            if markdown_content is None:
                raise ValueError(f"WebpageCard {card_id} has no markdown_convert_from_webpage")
            return markdown_content

        elif card.card_type == "note":
            # NoteCard: card_content["markdown_with_cite"] is a string
            markdown_with_cite = card.card_content.get("markdown_with_cite")
            if markdown_with_cite is None:
                raise ValueError(f"NoteCard {card_id} has no markdown_with_cite")
            return markdown_with_cite

        else:
            raise ValueError(f"Unsupported card type for tracing: {card.card_type}")

    def _apply_highlight_to_content(
        self,
        main_content: str | list[dict[str, Any]],
        support_content_list: list[str],
    ) -> str | list[dict[str, Any]]:
        """
        Apply <highlight></highlight> tags to the main content based on support_content_list.

        Uses _fuzzy_match_in_source to find matching parts and wraps them with highlight tags.
        Collects all match positions first, merges overlapping ranges, then applies highlights
        in one pass to avoid tag interference.

        Args:
            main_content: The main content of the card
                - For WebSearchResultCard: list of search result dicts
                - For WebpageCard/NoteCard: string
            support_content_list: List of support content snippets to highlight

        Returns:
            The main content with <highlight> tags around matched parts
        """
        import copy

        if isinstance(main_content, str):
            return self._apply_highlight_to_string(main_content, support_content_list)
        else:
            # For list content (WebSearchResultCard)
            result_list = copy.deepcopy(main_content)
            for item in result_list:
                for key in ["snippet"]:
                    if key in item and isinstance(item[key], str):
                        item[key] = self._apply_highlight_to_string(item[key], support_content_list)
            return result_list

    def _apply_highlight_to_string(self, text: str, support_content_list: list[str]) -> str:
        """
        Apply highlights to a string, handling overlapping matches correctly.

        Strategy:
        1. Find all match positions (start, end) in original text
        2. Merge overlapping/adjacent ranges
        3. Apply highlights from end to start (to preserve positions)
        """
        # Step 1: Collect all match ranges
        ranges: list[tuple[int, int]] = []
        for support_content in support_content_list:
            matched_text = _fuzzy_match_in_source(support_content, text)
            if matched_text:
                start = text.find(matched_text)
                if start != -1:
                    ranges.append((start, start + len(matched_text)))

        if not ranges:
            return text

        # Step 2: Merge overlapping ranges
        ranges.sort()
        merged: list[tuple[int, int]] = [ranges[0]]
        for start, end in ranges[1:]:
            last_start, last_end = merged[-1]
            if start <= last_end:  # Overlapping or adjacent
                merged[-1] = (last_start, max(last_end, end))
            else:
                merged.append((start, end))

        # Step 3: Apply highlights from end to start (reverse order to preserve positions)
        result = text
        for start, end in reversed(merged):
            matched_text = result[start:end]
            highlighted = _apply_highlight_with_separator_handling(matched_text)
            result = result[:start] + highlighted + result[end:]

        return result

    async def _get_card_explicit_refs(self, card_id: str) -> list[str]:
        """
        Get the explicit reference card IDs for a card.

        Args:
            card_id: The ID of the card

        Returns:
            List of card IDs that this card explicitly references
        """
        card = self.project_manager.get_info_card(self.project_id, self.agent_id, card_id)
        return card.card_ref_explicit

    async def _extract_support_from_source_card(
        self,
        traced_content: str,
        source_card_id: str,
        max_retries: int = 3,
    ) -> dict[str, Any]:
        """
        Use LLM to extract the exact content from source card that corresponds to the traced content.
        Retries up to max_retries times if LLM returns invalid format.
        """
        source_content = await self._get_card_content(source_card_id)
        if source_content is None:
            raise ValueError(f"Could not read content from card {source_card_id}")

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": ROOT_CONTENT_EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"## Traced Content Snippet\n{traced_content}"},
            {"role": "user", "content": f"## Source Card Content\n{source_content}"},
        ]

        for attempt in range(max_retries):
            response = await llm_message_completion_with_tool_call(
                messages=messages,
                tools=ROOT_CONTENT_EXTRACTION_TOOL,
                customized_base_url=self.global_config["llm_config"]["customized_base_url"],
                customized_api_key=self.global_config["llm_config"]["customized_api_key"],
                tool_choice="required",
                **self.global_config["llm_config"]["agent_config"]["root_agent_config"],
            )
            response_message = response.choices[0].message

            # Check 1: tool_calls exists
            if not (hasattr(response_message, "tool_calls") and response_message.tool_calls):
                error = "No tool call in response"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": response_message.content or ""})
                messages.append({"role": "user", "content": f"ERROR: {error}. Please call the tool."})
                continue

            tool_call = response_message.tool_calls[0]

            # Check 2: correct tool name
            if tool_call.function.name != "report_extraction_result":
                error = f"Wrong tool: {tool_call.function.name}"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": f"ERROR: {error}"})
                continue

            # Check 3: valid JSON
            try:
                result = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError as e:
                error = f"Invalid JSON in arguments: {e}"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": f"ERROR: {error}"})
                continue

            # Check 4: extracted_content_list is valid list
            raw_list = result.get("extracted_content_list", [])
            parsed_list, error = self._ensure_list(raw_list, "extracted_content_list")
            if error:
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": (
                        f"ERROR: {error}. "
                    ),
                })
                continue

            # Success
            return {
                "extracted_content_list": parsed_list if parsed_list else [traced_content],
                "reasoning": result.get("reasoning", ""),
            }

        raise RuntimeError(f"_extract_support_from_source_card failed after {max_retries} attempts")

    def _ensure_list(self, value: Any, field_name: str = "list") -> tuple[list[str] | None, str | None]:
        """
        Ensure value is a list. If it's a stringified JSON array, parse it.

        Returns:
            (list, None) on success, (None, error_message) on failure
        """
        if isinstance(value, list):
            return value, None

        if isinstance(value, str):
            print(f"\033[91m[WARNING] {field_name} is stringified, parsing...\033[0m")
            
            # Try multiple parsing strategies
            parsed_list = self._try_parse_stringified_list(value)
            if parsed_list is not None:
                print(f"\033[93m[INFO] Successfully parsed {field_name}\033[0m")
                return parsed_list, None
            
            # All strategies failed
            error_msg = f"{field_name} is not valid JSON and could not be recovered"
            if '"' in value and '\\"' not in value:
                error_msg += ". Hint: The string contains unescaped quotes. Make sure to return a proper JSON array, not a stringified one."
            return None, error_msg

        return None, f"{field_name} must be list, got {type(value).__name__}"

    def _try_parse_stringified_list(self, value: str) -> list[str] | None:
        """
        Try multiple strategies to parse a stringified list.
        
        Strategies:
        1. Direct json.loads
        2. Fix common escape issues and retry
        3. Use regex to extract array elements
        
        Returns:
            Parsed list on success, None on failure
        """
        import re
        
        # Strategy 1: Direct parse
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
        
        # Strategy 2: Try to fix common escape issues
        # Sometimes LLM returns strings with unescaped internal quotes
        try:
            # Replace smart quotes with regular quotes first
            fixed = value.replace('"', '"').replace('"', '"').replace(''', "'").replace(''', "'")
            parsed = json.loads(fixed)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
        
        # Strategy 3: Use regex to extract elements from malformed JSON array
        # Pattern: ["...", "...", ...]
        # This handles cases where internal quotes break the JSON
        try:
            # Check if it looks like a JSON array
            stripped = value.strip()
            if stripped.startswith('[') and stripped.endswith(']'):
                # Extract content between outer brackets
                inner = stripped[1:-1].strip()
                if not inner:
                    return []
                
                # Use a state machine approach to split by commas outside of quotes
                elements = self._split_json_array_elements(inner)
                if elements is not None:
                    return elements
        except Exception:
            pass
        
        # Strategy 4: Fallback - try to extract quoted strings using regex
        try:
            # Match strings that start with " and end with " (greedy but careful)
            # This is a last resort for badly malformed JSON
            pattern = r'"([^"]*(?:\\.[^"]*)*)"'
            matches = re.findall(pattern, value)
            if matches:
                # Unescape the matched strings
                result = []
                for m in matches:
                    try:
                        # Try to unescape JSON string escapes
                        unescaped = json.loads(f'"{m}"')
                        result.append(unescaped)
                    except json.JSONDecodeError:
                        result.append(m)
                return result
        except Exception:
            pass
        
        return None

    def _split_json_array_elements(self, inner: str) -> list[str] | None:
        """
        Split JSON array elements handling nested quotes properly.
        
        Uses a simple state machine to track quote state and split by commas
        that are outside of quoted strings.
        """
        elements = []
        current = []
        in_string = False
        escape_next = False
        
        for char in inner:
            if escape_next:
                current.append(char)
                escape_next = False
                continue
            
            if char == '\\':
                current.append(char)
                escape_next = True
                continue
            
            if char == '"':
                in_string = not in_string
                current.append(char)
                continue
            
            if char == ',' and not in_string:
                # End of element
                element_str = ''.join(current).strip()
                if element_str:
                    try:
                        # Try to parse as JSON string
                        parsed_element = json.loads(element_str)
                        elements.append(parsed_element)
                    except json.JSONDecodeError:
                        # If it looks like a quoted string, extract the content
                        if element_str.startswith('"') and element_str.endswith('"'):
                            elements.append(element_str[1:-1])
                        else:
                            return None  # Can't parse this element
                current = []
                continue
            
            current.append(char)
        
        # Don't forget the last element
        element_str = ''.join(current).strip()
        if element_str:
            try:
                parsed_element = json.loads(element_str)
                elements.append(parsed_element)
            except json.JSONDecodeError:
                if element_str.startswith('"') and element_str.endswith('"'):
                    elements.append(element_str[1:-1])
                else:
                    return None
        
        return elements

    async def _find_support_in_card(
        self,
        claim_content: str,
        predecessor_card_id: str,
        max_retries: int = 3,
    ) -> dict[str, Any]:
        """
        Use LLM to find if predecessor card contains supporting content for the claim.
        Retries up to max_retries times if LLM returns invalid format.
        """
        predecessor_content = await self._get_card_content(predecessor_card_id)
        if predecessor_content is None:
            raise ValueError(f"Could not read content from card {predecessor_card_id}")

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SUPPORT_FINDING_SYSTEM_PROMPT},
            {"role": "user", "content": f"## Claim/Statement to Trace\n{claim_content}"},
            {"role": "user", "content": f"## Predecessor Card Content\n{predecessor_content}"},
        ]

        for attempt in range(max_retries):
            response = await llm_message_completion_with_tool_call(
                messages=messages,
                tools=SUPPORT_FINDING_TOOL,
                customized_base_url=self.global_config["llm_config"]["customized_base_url"],
                customized_api_key=self.global_config["llm_config"]["customized_api_key"],
                tool_choice="required",
                **self.global_config["llm_config"]["agent_config"]["root_agent_config"],
            )
            response_message = response.choices[0].message

            # Check 1: tool_calls exists
            if not (hasattr(response_message, "tool_calls") and response_message.tool_calls):
                error = "No tool call in response"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": response_message.content or ""})
                messages.append({"role": "user", "content": f"ERROR: {error}. Please call the tool."})
                continue

            tool_call = response_message.tool_calls[0]

            # Check 2: correct tool name
            if tool_call.function.name != "report_support_finding_result":
                error = f"Wrong tool: {tool_call.function.name}"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": f"ERROR: {error}"})
                continue

            # Check 3: valid JSON
            try:
                result = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError as e:
                error = f"Invalid JSON in arguments: {e}"
                print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": f"ERROR: {error}"})
                continue

            # Check 4: support_content_list is valid list
            support_content_list = result.get("support_content_list")
            if support_content_list is not None:
                parsed_list, error = self._ensure_list(support_content_list, "support_content_list")
                if error:
                    print(f"\033[91m[Attempt {attempt + 1}/{max_retries}] {error}\033[0m")
                    messages.append({"role": "assistant", "content": None, "tool_calls": [tool_call.model_dump()]})
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": f"ERROR: {error}. Return support_content_list as JSON array, not string.",
                    })
                    continue
                support_content_list = parsed_list

            # Success
            return {
                "has_support": result.get("has_support", False),
                "support_content_list": support_content_list,
                "reasoning": result.get("reasoning", ""),
            }

        raise RuntimeError(f"_find_support_in_card failed after {max_retries} attempts")

    async def _trace_node_recursive(
        self,
        node: TraceResultNode,
        content_to_trace: str,
    ) -> None:
        """
        Recursively trace the support sources for a node.

        Algorithm for each predecessor card:
        1. Use _find_support_in_card to call LLM and extract support_content_list
        2. Get the predecessor card's main content and apply highlights using _fuzzy_match_in_source
        3. Create child node with support_content_list and card_main_content_with_highlight
        4. Recursively trace the child node

        Args:
            node: The current node to process
            content_to_trace: The content we're tracing support for
        """
        # Get explicit references for this card
        explicit_refs = await self._get_card_explicit_refs(node.card_id)

        if not explicit_refs:
            # No predecessor cards, this is a leaf node - children should be empty list
            node.children = []
            return

        # Track if we found any supporting content
        found_any_support = False
        supporting_nodes: list[TraceResultNode] = []

        # Check each predecessor card for supporting content
        for ref_card_id in explicit_refs:
            # Step 1: Use LLM to find supporting content in predecessor card
            result = await self._find_support_in_card(
                claim_content=content_to_trace,
                predecessor_card_id=ref_card_id,
            )

            print(f"[InfoTraceAgent] Card {ref_card_id} support check: {result}")

            if result["has_support"] and result["support_content_list"]:
                found_any_support = True
                support_content_list = result["support_content_list"]

                # Step 2: Get the predecessor card's main content and apply highlights
                main_content = self._get_card_main_content(ref_card_id)
                card_main_content_with_highlight = self._apply_highlight_to_content(
                    main_content=main_content,
                    support_content_list=support_content_list,
                )

                # Step 3: Create child node with support_content_list and card_main_content_with_highlight
                child_node = TraceResultNode(
                    card_id=ref_card_id,
                    support_content_list=support_content_list,
                    card_main_content_with_highlight=card_main_content_with_highlight,
                )
                supporting_nodes.append(child_node)

                # Step 4: Recursively trace this child with its support content
                # Join the list items to create the content for next level tracing
                combined_content = "\n\n".join(support_content_list)
                await self._trace_node_recursive(
                    node=child_node,
                    content_to_trace=combined_content,
                )

        if found_any_support:
            # Add only the supporting nodes as children
            node.children = supporting_nodes
        else:
            # No support found but there were predecessor cards
            # Mark as lacking support by creating null nodes
            self.trace_failed = True
            null_nodes = []
            for ref_card_id in explicit_refs:
                null_node = TraceResultNode(
                    card_id=ref_card_id,
                    support_content_list=None,  # None indicates lacking support
                    card_main_content_with_highlight=None,  # None for lacking support
                )
                null_node.children = None  # type: ignore  # None children also indicates lacking support
                null_nodes.append(null_node)
            node.children = null_nodes

    async def trace_source(
        self,
        card_id: str,
        content_to_trace: str,
    ) -> dict[str, Any]:
        """
        Trace the information source for a given content in a card.

        Algorithm:
        1. User selects content from a card and initiates trace request
        2. Use _extract_support_from_source_card to extract support_content_list from source card
        3. Get a copy of source_card's main content and apply highlights using _fuzzy_match_in_source
        4. Create root_node with card_main_content_with_highlight
        5. Use _trace_node_recursive to recursively trace content sources

        Args:
            card_id: The ID of the card containing the content to trace
            content_to_trace: The specific content to trace (may be rendered markdown text)

        Returns:
            Dict containing the trace result tree and status
        """
        print(f"\n[InfoTraceAgent] Starting trace for card {card_id}")
        print(f"[InfoTraceAgent] Content to trace: {content_to_trace}")

        # Reset trace status
        self.trace_failed = False

        # Step 2: Use LLM-based extraction to find the supporting content in the source card
        extraction_result = await self._extract_support_from_source_card(
            traced_content=content_to_trace,
            source_card_id=card_id,
        )

        extracted_content_list = extraction_result["extracted_content_list"]
        print(f"[InfoTraceAgent] Extraction reasoning: {extraction_result['reasoning']}")
        print(f"[InfoTraceAgent] Extracted {len(extracted_content_list)} content snippets from source card")

        # Step 3: Get a copy of source_card's main content and apply highlights
        main_content = self._get_card_main_content(card_id)
        card_main_content_with_highlight = self._apply_highlight_to_content(
            main_content=main_content,
            support_content_list=extracted_content_list,
        )

        print("[InfoTraceAgent] Applied highlights to main content")

        # Step 3 (continued): Create root node with support_content_list and card_main_content_with_highlight
        root_node = TraceResultNode(
            card_id=card_id,
            support_content_list=extracted_content_list,
            card_main_content_with_highlight=card_main_content_with_highlight,
        )

        # Step 4: Start recursive tracing with the extracted content (combined)
        combined_content = "\n\n".join(extracted_content_list)
        await self._trace_node_recursive(
            node=root_node,
            content_to_trace=combined_content,
        )

        # Determine status
        status = "Failed" if self.trace_failed else "Success"

        result = {"project_id": self.project_id, "status": status, "trace_result_tree": root_node.to_dict()}

        print(f"\n[InfoTraceAgent] Trace completed with status: {status}")
        return result


# ============================================================================
# Standalone Function for Direct Invocation
# ============================================================================


async def trace_info_source(
    project_id: str,
    card_id: str,
    content_to_trace: str,
    project_manager: ProjectManager,
    global_config: dict[str, Any],
) -> dict[str, Any]:
    """
    Trace the information source for a given content.

    This is a convenience function that creates an InfoTraceAgent and
    runs the trace operation.

    Args:
        project_id: The project ID
        card_id: The ID of the card containing the content to trace
        content_to_trace: The specific content to trace
        project_manager: The project manager instance
        global_config: Global configuration dictionary

    Returns:
        Dict containing:
        - project_id: The project ID
        - status: "Success" or "Failed"
        - trace_result_tree: The trace result tree structure
    """
    # Get root agent ID to access card_dict
    root_agent_id = project_manager.get_root_agent_id(project_id)

    # Create and run the trace agent
    agent = InfoTraceAgent(
        project_id=project_id,
        agent_id=root_agent_id,
        project_manager=project_manager,
        global_config=global_config,
    )

    return await agent.trace_source(
        card_id=card_id,
        content_to_trace=content_to_trace,
    )
