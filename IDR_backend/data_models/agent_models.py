"""
Agent Models
Defines agent state and runtime information
"""

from typing import Any, Literal

from pydantic import BaseModel, Field


class InfoTraceState(BaseModel):
    """State for a single info trace request"""

    status: Literal["Running", "Success", "Failed"] = "Running"
    trace_result_tree: dict[str, Any] | None = None


class AgentState(BaseModel):
    """Agent state and persistent data storage"""

    # 1. Agent identification.
    agent_id: str
    project_id: str
    agent_type: Literal["ResearchAgent"]
    parent_agent_id: str | None = None

    # 2. Chat history and context.
    chat_list: list[Any] = Field(default_factory=list)  # List of ChatMessage4Display (for frontend display)
    context_list: list[Any] = Field(default_factory=list)  # List of context in OpenAI's messages format
    card_dict: dict[str, Any] = Field(
        default_factory=dict
    )  # Dict[str, InfoCard], used for persistant and important information
    latest_card_id: str | None = Field(default=None)

    # 3. Runtime state.
    is_running: bool = Field(default=False)
    is_interrupted: bool = Field(default=False)
    final_result_generated: bool = Field(default=False)  # Set by tools when final result is ready
    final_result_card_id: str | None = None  # Set by tools when final result is ready
    # Counters for enforcing note creation strategy
    raw_info_tool_calls_since_last_note: int = Field(default=0)  # Counter for raw info tools (search_web, scrape_webpage)
    note_calls_since_last_summary: int = Field(default=0)  # Counter for create_note with is_progress_summary_note=false

    # 4. Info trace state dict: key is request_id, value is InfoTraceState
    info_trace_state_dict: dict[str, InfoTraceState] = Field(default_factory=dict)

    # 5. References for other objects (transient, not serialized).
    agent_instance: Any = Field(default=None, exclude=True)
    project_manager: Any = Field(default=None, exclude=True)
