"""
Data Models Package for IDR Version 3 Backend
Defines core data structures for projects, agents, cards, and chats

This package re-exports all models to maintain backward compatibility
with the original data_models.py single-file structure.
"""

# Chat Models
from .chat_models import (
    UserMessage,
    AssistantMessage,
    TodoItem,
    TodoList,
    ToolMessage,
    ToolResult,
    ProgressSummaryMessage,
    ChatMessage4Display,
)

# Card Models
from .card_models import (
    InfoCard,
)

# Agent Models
from .agent_models import AgentState

# Project Models
from .project_models import (
    Project,
    ProjectManager,
)

__all__ = [
    # Chat Models
    "UserMessage",
    "AssistantMessage",
    "TodoItem",
    "TodoList",
    "ToolMessage",
    "ToolResult",
    "ProgressSummaryMessage",
    "ChatMessage4Display",
    # Card Models
    "InfoCard",
    # Agent Models
    "AgentState",
    # Project Models
    "Project",
    "ProjectManager"
]
