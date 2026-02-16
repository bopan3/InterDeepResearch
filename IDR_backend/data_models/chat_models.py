"""
Chat Message Models for Display
Defines message types for agent chat history display in frontend
These are separate from the internal LLM chat history
"""

from typing import Any, Literal
from pydantic import BaseModel, Field
from dataclasses import dataclass


@dataclass
class ToolResult:
    """
    Tool execution result with compact and full versions.

    - full: Complete result content (shown only for the latest tool result)
    - compact: Abbreviated result content (shown for all previous tool results)

    When a new tool result is added to the context, all previous tool results
    should be replaced with their compact versions.
    """

    compact: str
    full: str

    def __str__(self) -> str:
        """Default string representation returns the full version."""
        return self.full


class UserMessage(BaseModel):
    """User message in chat"""

    chat_type: Literal["user_message"] = "user_message"
    chat_content: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        message: str,
        reference_list: list[dict[str, Any]],
        bind_card_id: str | None = None,
    ):
        content = {
            "user_message": message,
            "reference_list": reference_list,
            "bind_card_id": bind_card_id,
        }
        return cls(chat_content=content)


class AssistantMessage(BaseModel):
    """Assistant message in chat"""

    chat_type: Literal["assistant_message"] = "assistant_message"
    chat_content: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def create(cls, message: str):
        return cls(chat_content={"assistant_message": message})


class TodoItem(BaseModel):
    """Todo item for todo list"""

    id: str
    status: Literal["pending", "in_progress", "completed"]
    content: str


class TodoList(BaseModel):
    """Todo list in chat"""

    chat_type: Literal["todo_list"] = "todo_list"
    chat_content: dict[str, list[dict[str, str]]] = Field(default_factory=dict)

    @classmethod
    def create(cls, todo_list: list[dict[str, str]]):
        return cls(chat_content={"todo_list": todo_list})


class ToolMessage(BaseModel):
    """Tool execution message in chat"""

    chat_type: Literal["tool_message"] = "tool_message"
    chat_content: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        first_tool_description: str,
        second_tool_description: str,
        status: Literal["in_progress", "completed", "cancelled"],
        detail: str | None = None,
        bind_card_id: str | None = None,
    ):
        return cls(
            chat_content={
                "first_tool_description": first_tool_description,
                "second_tool_description": second_tool_description,
                "status": status,
                "detail": detail,
                "bind_card_id": bind_card_id,
            }
        )
class ProgressSummaryMessage(BaseModel):
    """Progress summary message in chat"""

    chat_type: Literal["progress_summary_message"] = "progress_summary_message"
    chat_content: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        progress_summary: str = "Researching",
        status: Literal["in_progress", "completed", "cancelled"] = "in_progress",
    ):
        return cls(chat_content={"progress_summary": progress_summary, "status": status})

# Union type for all chat messages for display (frontend)
ChatMessage4Display = UserMessage | AssistantMessage | TodoList | ToolMessage | ProgressSummaryMessage
