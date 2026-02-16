"""
Research Agent for IDR Version 4
Responsible for conducting research based on research requirements
"""

import os
import sys
from functools import partial

sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from typing import Any
from collections.abc import Callable
from IDR_backend.agents.baseAgent import BaseAgent
from IDR_backend.data_models.agent_models import AgentState

# Import individual tool functions
from IDR_backend.agents.researchAgent.tools.search_web_tool import search_web_tool
from IDR_backend.agents.researchAgent.tools.scrape_webpage_tool import scrape_webpage_tool
from IDR_backend.agents.researchAgent.tools.create_note_tool import create_note_tool
from IDR_backend.agents.researchAgent.tools.finish_turn_tool import finish_turn_tool

class ResearchAgent(BaseAgent):
    """
    Research Agent for conducting complex research tasks.
    """

    def __init__(self, agent_state: AgentState):
        """Initialize Research Agent."""
        super().__init__(agent_state)

    def _build_tool_functions(self) -> dict[str, Callable[..., Any]]:
        """
        Build the tool functions dictionary for Research Agent.
        Each tool function is bound with the agent's context using partial.

        Returns:
            Dict mapping tool names to callable functions
        """
        # Get global configuration
        global_config = self.agent_state.project_manager.get_global_config()

        # Use functools.partial to bind context parameters to each tool
        return {
            "search_web": partial(
                search_web_tool,
                project_id=self.agent_state.project_id,
                agent_id=self.agent_state.agent_id,
                project_manager=self.agent_state.project_manager,
                global_config=global_config,
            ),
            "scrape_webpage": partial(
                scrape_webpage_tool,
                project_id=self.agent_state.project_id,
                agent_id=self.agent_state.agent_id,
                project_manager=self.agent_state.project_manager,
                global_config=global_config,
            ),
            "create_note": partial(
                create_note_tool,
                project_id=self.agent_state.project_id,
                agent_id=self.agent_state.agent_id,
                project_manager=self.agent_state.project_manager,
                global_config=global_config,
            ),
            "finish_turn": partial(
                finish_turn_tool,
                project_id=self.agent_state.project_id,
                agent_id=self.agent_state.agent_id,
                project_manager=self.agent_state.project_manager,
                global_config=global_config,
            ),
        }
