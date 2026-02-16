"""
Base Agent for IDR Version 4

This module provides the BaseAgent class, which serves as the foundation for all
specialized agents in the IDR system. It handles common functionality including:
- Tool calling and execution with interrupt support
- Message history management
- LLM interaction
- State management and lifecycle control
"""

import asyncio
import json
import os
import sys
from abc import ABC
from typing import Any
from collections.abc import Callable

import yaml

from IDR_backend.data_models import AssistantMessage, UserMessage, ToolResult
from IDR_backend.data_models.chat_models import ProgressSummaryMessage
from IDR_backend.data_models.card_models import UserRequirementCard

# Add parent directory to path for llmAPIs import
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from IDR_backend.data_models.agent_models import AgentState
from llmAPIs.llmAPI import llm_message_completion_with_tool_call
from utils.util import print_token_usage


class BaseAgent(ABC):  # noqa: B024
    """
    Base class for all agents in IDR system.
    Provides common functionality for tool calling, message management, etc.
    """

    # Tools for raw information collection (search_web, scrape_webpage)
    RAW_INFO_COLLECTION_TOOLS = {"search_web", "scrape_webpage"}
    # Maximum number of raw info tool calls before requiring a create_note
    MAX_RAW_INFO_TOOL_CALLS_BEFORE_NOTE = 3
    # Maximum number of create_note (non-summary) calls before requiring a progress summary note
    MAX_NOTE_CALLS_BEFORE_SUMMARY = 3

    def __init__(self, agent_state: AgentState):
        """
        Initialize base agent.

        Args:
            agent_state: Agent state

        Note:
            Subclasses should set self.agent_type in their __init__ method
        """
        # 1. Set agent state.
        self.agent_state = agent_state

        # 2. Load prompts - to be defined by subclass.
        prompts_dir = os.path.join(os.path.dirname(self._get_agent_file_path()), "prompts")

        self.system_prompt = self.load_prompt_from_yaml(os.path.join(prompts_dir, "system_prompt.yaml"))

        self.tools = self.load_tools_from_yaml(os.path.join(prompts_dir, "tools_prompt.yaml"))

        # 3. Build tool functions - to be implemented by subclass.
        self.available_tool_functions = self._build_tool_functions()

    def _get_agent_file_path(self):
        """Get the file path of the agent subclass. Override if needed."""
        return self.__class__.__module__.replace(".", "/")

    def add_system_message(self):
        """Add system prompt to messages"""
        if not self.agent_state.context_list or self.agent_state.context_list[0].get("role") != "system":
            self.agent_state.context_list.insert(0, {"role": "system", "content": self.system_prompt})

    def add_user_message(self, content: str):
        """
        Add user message to LLM's internal message history.

        Args:
            content: Message content
        """
        self.agent_state.context_list.append({"role": "user", "content": content})

    def add_assistant_message(self, content: str):
        """
        Add assistant message to LLM's internal message history.

        Args:
            content: Message content
        """
        self.agent_state.context_list.append({"role": "assistant", "content": content})

    async def execute_turn(self) -> dict[str, Any]:
        """
        Execute one turn of agent interaction with tool calling.
        Returns information about the turn execution.
        """
        if self.agent_state.is_interrupted:
            self._cleanup_interrupted_states()
            return {"last_turn": True}


        # 1. Call LLM for this turn
        self.add_system_message()  # Ensure system message is present

        # Prepare messages for LLM (compact previous tool results, keep only last one full)
        messages_for_llm = self._prepare_messages_for_llm()

        # Print token usage before LLM call
        print_token_usage(messages_for_llm)

        response = await llm_message_completion_with_tool_call(
            messages=messages_for_llm,
            tools=self.tools,
            customized_base_url=self.agent_state.project_manager.get_global_config()["llm_config"]["customized_base_url"],
            customized_api_key=self.agent_state.project_manager.get_global_config()["llm_config"]["customized_api_key"],
            **self.agent_state.project_manager.get_global_config()["llm_config"]["agent_config"]["root_agent_config"],
        )
        response_message = response.choices[0].message

        # 2. Update for LLM's internal message history (full response with tool calls)
        # If tool call is finish_turn, replace content with final_summary parameter
        response_msg_dict = response_message.model_dump()
        if getattr(response_message, "tool_calls", None):
            for tc in response_message.tool_calls:
                if tc.function.name == "finish_turn":
                    try:
                        args = json.loads(tc.function.arguments)
                        if "final_summary" in args:
                            response_msg_dict["content"] = args["final_summary"]
                    except json.JSONDecodeError:
                        pass
                    break
        self.agent_state.context_list.append(response_msg_dict)

        # 3. Update for frontend message display (just the response message content)
        # Use the potentially modified content from response_msg_dict
        if response_msg_dict.get("content"):
            assistant_msg = AssistantMessage.create(response_msg_dict["content"])
            self.agent_state.project_manager.add_chat_message_4display(
                self.agent_state.project_id, self.agent_state.agent_id, assistant_msg
            )

        # 4. Check for tool calls and execute them if there are any
        tool_calls = getattr(response_message, "tool_calls", None)
        if tool_calls is None:
            return {"last_turn": True}
        else:
            for tool_call in tool_calls:
                await self._execute_single_tool_call(tool_call)
            
            if self.agent_state.final_result_generated:
                return {"last_turn": True}
            elif self.agent_state.is_interrupted:
                self._cleanup_interrupted_states()
                return {"last_turn": True}
            else:
                return {"last_turn": False}

    def _prepare_messages_for_llm(self) -> list[dict[str, Any]]:
        """
        Prepare messages for LLM by compacting tool results based on note creation strategy.

        Compression strategy:
        1. Raw info collection tools (search_web, scrape_webpage):
           - BEFORE the last create_note: use compact version
           - AFTER the last create_note (or no create_note yet): use full version
        2. create_note tool results:
           - BEFORE the last progress_summary_note (is_progress_summary_note=true): use compact version
           - AFTER the last progress_summary_note (or no progress_summary_note yet): use full version
        3. Other tools: use full version

        Returns:
            A list of messages with appropriate content versions.
        """
        messages = []

        # Find the index of the last create_note tool result
        last_create_note_idx = -1
        # Find the index of the last progress_summary_note (is_progress_summary_note=true)
        last_progress_summary_idx = -1

        for i, msg in enumerate(self.agent_state.context_list):
            if isinstance(msg, dict) and msg.get("role") == "tool" and msg.get("name") == "create_note":
                last_create_note_idx = i
                # Check if this is a progress summary note
                if msg.get("_is_progress_summary_note", False):
                    last_progress_summary_idx = i

        # Build the messages list
        for i, msg in enumerate(self.agent_state.context_list):
            if isinstance(msg, dict) and msg.get("role") == "tool":
                tool_name = msg.get("name")

                # Determine whether to use compact or full content
                use_compact = False

                if tool_name in self.RAW_INFO_COLLECTION_TOOLS:
                    # Raw info tools: compact if before last create_note
                    if last_create_note_idx != -1 and i < last_create_note_idx:
                        use_compact = True
                elif tool_name == "create_note":
                    # create_note: compact if before last progress_summary_note
                    if last_progress_summary_idx != -1 and i < last_progress_summary_idx:
                        use_compact = True
                # Other tools: always use full version (use_compact remains False)

                clean_msg = {
                    "tool_call_id": msg["tool_call_id"],
                    "role": msg["role"],
                    "name": msg["name"],
                    "content": msg["_compact_content"] if use_compact else msg["content"],
                }
                messages.append(clean_msg)
            else:
                # Non-tool messages: pass as-is
                messages.append(msg)

        return messages

    def _add_tool_result(
        self,
        tool_call_id: str,
        function_name: str,
        content: ToolResult,
        is_progress_summary_note: bool = False,
    ):
        """
        Add tool execution result to message history.

        Args:
            tool_call_id: The ID of the tool call
            function_name: Name of the tool function
            content: ToolResult with compact/full versions
            is_progress_summary_note: For create_note tool, whether this is a progress summary note
        """
        tool_result: dict[str, Any] = {
            "tool_call_id": tool_call_id,
            "role": "tool",
            "name": function_name,
            "content": content.full,
            "_compact_content": content.compact,
        }
        # Store metadata for create_note tool
        if function_name == "create_note":
            tool_result["_is_progress_summary_note"] = is_progress_summary_note
        self.agent_state.context_list.append(tool_result)

        # Print tool result info in blue color
        print("\033[34m" + "=" * 80)
        print("📊 TOOL RESULT")
        print(f"Tool Name: {function_name}")
        print(f"Tool Call ID: {tool_call_id}")
        print(f"Full Content Length: {len(content.full)} characters")
        print(f"Compact Content Length: {len(content.compact)} characters")
        # Show preview of content (first 200 chars)
        content_preview = content.full[:200] + "..." if len(content.full) > 200 else content.full
        print(f"Content Preview: {content_preview}")
        print("=" * 80 + "\033[0m")

    async def _execute_single_tool_call(self, tool_call: Any):
        """Execute a single tool call."""

        # 1. Get function name and arguments
        function_name = tool_call.function.name
        function_args = self._parse_tool_arguments(tool_call)

        # 2. Check if tool arguments parsing succeeded
        if "error" in function_args:
            error_msg = function_args["error"]
            self._add_tool_result(tool_call.id, function_name, ToolResult(compact=error_msg, full=error_msg))
            return

        # 3. Check if tool function exists
        if function_name not in self.available_tool_functions:
            error_msg = f"Unknown tool: {function_name}"
            self._add_tool_result(tool_call.id, function_name, ToolResult(compact=error_msg, full=error_msg))
            return

        # 4. Validate tool arguments against schema
        validation_error = self._validate_tool_arguments(function_name, function_args)
        if validation_error:
            result = ToolResult(compact=validation_error, full=validation_error)
            self._add_tool_result(tool_call.id, function_name, result)
            return

        # 5. Check note creation strategy enforcement
        note_enforcement_error = self._check_note_creation_enforcement(function_name, function_args)
        if note_enforcement_error:
            result = ToolResult(compact=note_enforcement_error, full=note_enforcement_error)
            self._add_tool_result(tool_call.id, function_name, result)
            return

        # 6. Execute the tool function and monitor the task
        function_to_call = self.available_tool_functions[function_name]
        try:
            tool_execution_task = asyncio.create_task(function_to_call(**function_args))
            tool_execution_task_result = await self._monitor_task_with_interrupt(
                tool_execution_task, tool_call.id, function_name
            )

            # Pass is_progress_summary_note metadata for create_note tool
            is_progress_summary = function_args.get("is_progress_summary_note", False)
            self._add_tool_result(
                tool_call.id, function_name, tool_execution_task_result, is_progress_summary
            )

            # 7. Update the note creation counters
            self._update_note_creation_counters(function_name, function_args)

        except Exception as e:
            # Handle any other unexpected errors during tool execution setup
            error_msg = f"Unexpected error calling {function_name}: {type(e).__name__}: {str(e)}"
            raise Exception(error_msg)
        return

    def _check_note_creation_enforcement(self, function_name: str, function_args: dict[str, Any]) -> str | None:
        """
        Check if note creation strategy enforcement is violated.

        Rules:
        1. Raw info collection tools (search_web, scrape_webpage) can only be called
           MAX_RAW_INFO_TOOL_CALLS_BEFORE_NOTE times before requiring a create_note.
        2. create_note with is_progress_summary_note=false can only be called
           MAX_NOTE_CALLS_BEFORE_SUMMARY times before requiring a create_note with
           is_progress_summary_note=true.

        Args:
            function_name: Name of the tool being called
            function_args: Arguments for the tool call

        Returns:
            Error message if enforcement violated, None otherwise
        """
        # Check for raw info collection tools
        if function_name in self.RAW_INFO_COLLECTION_TOOLS:
            if self.agent_state.raw_info_tool_calls_since_last_note >= self.MAX_RAW_INFO_TOOL_CALLS_BEFORE_NOTE:
                error_msg = (
                    f"Error: You have made {self.agent_state.raw_info_tool_calls_since_last_note} raw information "
                    f"collection tool calls (search_web/scrape_webpage) without creating a note. "
                    f"Please call 'create_note' to record the findings before making more "
                    f"raw info collection tool calls."
                )
                return error_msg

        # Check for create_note with is_progress_summary_note=false
        if function_name == "create_note":
            is_progress_summary = function_args.get("is_progress_summary_note", False)
            if not is_progress_summary:
                if self.agent_state.note_calls_since_last_summary >= self.MAX_NOTE_CALLS_BEFORE_SUMMARY:
                    error_msg = (
                        f"Error: You have made {self.agent_state.note_calls_since_last_summary} create_note calls "
                        f"with is_progress_summary_note=false without creating a progress summary note. "
                        f"Please call 'create_note' with is_progress_summary_note=true to summarize "
                        f"the current progress."
                    )
                    return error_msg

        return None

    def _update_note_creation_counters(self, function_name: str, function_args: dict[str, Any]):
        """
        Update the note creation counters after successful tool execution.

        Args:
            function_name: Name of the executed tool
            function_args: Arguments of the executed tool
        """
        if function_name == "create_note":
            is_progress_summary = function_args.get("is_progress_summary_note", False)
            # Always reset raw info counter after any create_note
            self.agent_state.raw_info_tool_calls_since_last_note = 0

            if is_progress_summary:
                # Reset note counter after progress summary note
                self.agent_state.note_calls_since_last_summary = 0
            else:
                # Increment note counter for non-summary notes
                self.agent_state.note_calls_since_last_summary += 1
        elif function_name in self.RAW_INFO_COLLECTION_TOOLS:
            # Increment raw info counter
            self.agent_state.raw_info_tool_calls_since_last_note += 1

    def _parse_tool_arguments(self, tool_call: Any) -> dict[str, Any]:
        """Parse tool call arguments from JSON string."""
        try:
            return json.loads(tool_call.function.arguments)
        except json.JSONDecodeError as e:
            return {"error": f"Failed to parse tool arguments: {e}"}

    def _validate_tool_arguments(self, function_name: str, function_args: dict[str, Any]) -> str | None:
        """
        Validate tool arguments against the tool schema before execution.

        Args:
            function_name: Name of the tool function
            function_args: Arguments provided by the agent

        Returns:
            Error message string if validation fails, None if validation passes
        """
        tool_schema = self._get_tool_schema(function_name)
        if not tool_schema:
            # No schema available, skip validation
            return None

        parameters = tool_schema.get("parameters", {})
        required_params = parameters.get("required", [])
        properties = parameters.get("properties", {})
        provided_params = set(function_args.keys())

        # Check for missing required arguments
        missing_params = [param for param in required_params if param not in provided_params]
        if missing_params:
            error_msg = f"Argument Error: The tool call '{function_name}' is missing required argument(s).\n\n"
            error_msg += f"Missing: {', '.join(missing_params)}\n"
            error_msg += f"Required: {', '.join(required_params)}\n"
            error_msg += f"Provided: {', '.join(provided_params) if provided_params else '(none)'}\n\n"

            # Add descriptions for missing parameters
            for param in missing_params:
                if param in properties:
                    param_info = properties[param]
                    param_type = param_info.get("type", "unknown")
                    param_desc = param_info.get("description", "No description available")
                    error_msg += f"- '{param}' ({param_type}): {param_desc}\n"

            error_msg += "\nPlease provide all required arguments and try again."
            return error_msg

        # Check for unknown arguments (optional, can be disabled if too strict)
        if properties:
            valid_params = set(properties.keys())
            unknown_params = provided_params - valid_params
            if unknown_params:
                error_msg = f"Argument Error: The tool call '{function_name}' received unknown argument(s).\n\n"
                error_msg += f"Unknown: {', '.join(unknown_params)}\n"
                error_msg += f"Valid parameters: {', '.join(valid_params)}\n"
                error_msg += "\nPlease check the tool definition and only provide valid arguments."
                return error_msg

        return None

    def _get_tool_schema(self, function_name: str) -> dict[str, Any] | None:
        """
        Get the schema for a specific tool.

        Args:
            function_name: Name of the tool function

        Returns:
            Tool schema dictionary or None if not found
        """
        if not hasattr(self, 'tools') or not self.tools:
            return None

        for tool in self.tools:
            if tool.get("type") == "function":
                func = tool.get("function", {})
                if func.get("name") == function_name:
                    return func

        return None

    async def _monitor_task_with_interrupt(
        self, task: asyncio.Task[Any], tool_call_id: str, function_name: str
    ) -> ToolResult:
        """
        Monitor async task execution and check for interrupts periodically.

        Returns:
            ToolResult: The tool execution result with compact/full versions
        """
        while not task.done():
            if self.agent_state.is_interrupted:
                # Cancel task and handle interruption
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

                # Note: cleanup is handled in execute_turn() to avoid duplicate cleanup
                interrupt_msg = "Interrupted by user during execution"
                return ToolResult(compact=interrupt_msg, full=interrupt_msg)

            # Wait 100ms before checking again
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
            except asyncio.TimeoutError:  # noqa: UP041
                continue  # Task not done yet, keep monitoring
            except Exception:
                raise  # Unexpected exception from asyncio, re-raise immediately
        # if task is done, return the ToolResult
        return task.result()

    def _cleanup_interrupted_states(self):
        """
        Clean up in_progress states after interruption:
        1. Set all in_progress tool_messages in chat_list to cancelled
        2. Remove all in_progress cards from card_dict
        3. Update the last ProgressSummaryMessage to cancelled status
        """
        # 1. Update tool_messages in chat_list
        for message in self.agent_state.chat_list:
            if hasattr(message, "chat_type") and message.chat_type == "tool_message":
                if message.chat_content.get("status") == "in_progress":
                    message.chat_content["status"] = "cancelled"

        # 2. Remove in_progress cards from card_dict
        cards_to_remove = []
        for card_id, card in self.agent_state.card_dict.items():
            if hasattr(card, "status") and card.status == "in_progress":
                cards_to_remove.append(card_id)

        for card_id in cards_to_remove:
            del self.agent_state.card_dict[card_id]

        # 3. Update latest_card_id if needed
        # Note: card_id is string, must convert to int for proper numeric comparison
        if self.agent_state.latest_card_id in cards_to_remove:
            if self.agent_state.card_dict:
                self.agent_state.latest_card_id = str(max(int(k) for k in self.agent_state.card_dict.keys()))
            else:
                self.agent_state.latest_card_id = None

        # 4. Update the last ProgressSummaryMessage to completed status and add an "Interrupted" message
        for message in reversed(self.agent_state.chat_list):
            if hasattr(message, "chat_type") and message.chat_type == "progress_summary_message":
                message.chat_content["status"] = "completed"
                break
        # Add a new ProgressSummaryMessage with "Interrupted" status
        interrupted_msg = ProgressSummaryMessage.create(
            progress_summary="Interrupted", status="cancelled"
        )
        self.agent_state.project_manager.add_chat_message_4display(
            self.agent_state.project_id, self.agent_state.agent_id, interrupted_msg
        )

    def _build_tool_functions(self) -> dict[str, Callable[..., Any]]:
        """
        Build the tool functions dictionary. Must be implemented by subclasses.

        Returns:
            dict mapping tool names to callable functions
        """
        raise NotImplementedError("Subclasses must implement _build_tool_functions")

    def _format_context_cards_info(self, context_cards: list[dict[str, Any]]) -> str:
        """
        Format context cards information into a readable string.

        Args:
            context_cards: List of context card dictionaries, each containing:
                - card_id: ID of the card
                - card: Card object
                - selected_content: If None, user selected entire card; if not None, shows selected text

        Returns:
            Formatted string with context cards information
        """
        if not context_cards:
            return ""

        card_references = []
        for card_data in context_cards:
            card_id = card_data['card_id']
            card = card_data['card']
            selected_content = card_data.get('selected_content')

            # Get card title
            if card.card_title is None:
                raise ValueError("The card title is not yet generated.")
            else:
                card_title = card.card_title

            if selected_content is not None:
                # User selected specific text from this card
                ref = (
                    f"- Card ID: {card_id}, Title: {card_title}\n"
                    f"  Selected text: \n{selected_content}\n"
                )
            else:
                # User selected entire card
                ref = f"- Card ID: {card_id}, Title: {card_title} (entire card selected)\n"

            card_references.append(ref)

        header = "\n\n## User has selected the following Info Cards as reference:\n"
        return header + "\n".join(card_references)

    async def _prepare_user_message(self, user_message: str, reference_list: list[dict[str, Any]]):
        """
        Prepare and send a user message with reference cards.

        Args:
            user_message: The message from user
            reference_list: List of card references from frontend, each containing:
                - card_id: ID of the referenced card
                - selected_content: Selected text (None means entire card)
        """

        # 1. Convert reference_list to context_cards by fetching card objects
        context_cards = []
        for ref in reference_list:
            card_id = ref.get("card_id")
            selected_content = ref.get("selected_content")

            if card_id:
                try:
                    card = self.agent_state.project_manager.get_info_card(
                        self.agent_state.project_id, self.agent_state.agent_id, card_id
                    )
                    if card:
                        context_cards.append(
                            {
                                "card_id": card_id,
                                "card": card,
                                "selected_content": selected_content,
                            }
                        )
                except Exception as e:
                    print(f"[Agent] Warning: Could not retrieve card {card_id}: {e}")

        # 2. Append context cards info to user message content for LLM.
        user_message_content = user_message + self._format_context_cards_info(context_cards)

        # 3. Update for LLM's internal message history.
        self.add_user_message(user_message_content)

        # 4. Create user requirement card first to get card_id
        previous_card_id = self.agent_state.project_manager.get_agent_latest_card_id(
            self.agent_state.project_id, self.agent_state.agent_id
        )
        user_requirement_card = await UserRequirementCard.create(
            card_id=self.agent_state.project_manager.generate_card_id(
                self.agent_state.project_id, self.agent_state.agent_id
            ),
            user_requirement=user_message,
            card_ref_implicit=[previous_card_id] if previous_card_id else [],
            card_ref_explicit=[],
            reference_list=reference_list,
            global_config=self.agent_state.project_manager.get_global_config(),
        )
        self.agent_state.project_manager.add_info_card(
            self.agent_state.project_id, self.agent_state.agent_id, user_requirement_card
        )

        # 5. Update for frontend message display (with bind_card_id)
        user_msg = UserMessage.create(
            user_message, reference_list, bind_card_id=user_requirement_card.card_id
        )
        self.agent_state.project_manager.add_chat_message_4display(
            self.agent_state.project_id, self.agent_state.agent_id, user_msg
        )

        # 6. Send project update.
        await self.agent_state.project_manager.send_project_update(self.agent_state.project_id)

    async def run(self, user_message: str, reference_list: list[dict[str, Any]]) -> None:
        """
        Main execution loop for agent. Common implementation for all agents.

        Args:
            user_message: The message from user
            reference_list: List of card references from frontend, each containing:
                - card_id: ID of the referenced card
                - selected_content: Selected text (None means entire card)

        Returns:
            dict containing execution results including final report card ID
        """
        # 1. Set agent state is_running to True
        self.agent_state.is_running = True
        await self.agent_state.project_manager.send_project_update(self.agent_state.project_id)

        # 2. Add initial ProgressSummaryMessage (in_progress status)
        initial_progress_msg = ProgressSummaryMessage.create(
            progress_summary="Start", status="in_progress"
        )
        self.agent_state.project_manager.add_chat_message_4display(
            self.agent_state.project_id, self.agent_state.agent_id, initial_progress_msg
        )

        # 3. Prepare User Message.
        await self._prepare_user_message(user_message, reference_list)

        # 4. Main execution loop - runs until the last turn condition is met
        while True:
            # Execute one turn.
            turn_result = await self.execute_turn()
            await self.agent_state.project_manager.send_project_update(self.agent_state.project_id)
            # Check for the last turn condition
            if turn_result.get("last_turn"):
                break

        # 5. Ensure agent state is_running is False (may already be set by finish_turn or interrupt)
        if self.agent_state.is_running:
            self.agent_state.is_running = False
            await self.agent_state.project_manager.send_project_update(self.agent_state.project_id)

    @staticmethod
    def load_prompt_from_yaml(yaml_path: str, key: str = "system_prompt_latest") -> str:
        """Load prompt from YAML file"""
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            return data.get(key)

    @staticmethod
    def load_tools_from_yaml(yaml_path: str) -> list[dict[str, Any]]:
        """Load tool definitions from YAML file"""
        with open(yaml_path, "r", encoding="utf-8") as f:
            tools = yaml.safe_load(f)
            return tools
