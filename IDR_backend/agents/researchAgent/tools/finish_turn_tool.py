"""
Finish turn tool for Research Agent
"""

import sys
import os
from typing import Any, TYPE_CHECKING
from IDR_backend.data_models.chat_models import ToolResult, ProgressSummaryMessage

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

if TYPE_CHECKING:
    from IDR_backend.data_models.project_models import ProjectManager


async def finish_turn_tool(
    final_summary: str,
    project_id: str,
    agent_id: str,
    project_manager: "ProjectManager",
    global_config: dict[str, Any],
) -> ToolResult:
    """
    Finish the current turn.

    Args:
        final_summary: The final summary of what you have made since the latest user request.
        project_id: ID of the current project
        agent_id: ID of this agent
        project_manager: Reference to the global project manager
        global_config: Global configuration
    """
    # 1. Set agent's final_result_generated flag
    project_manager.set_agent_final_result_generated(project_id, agent_id, True)

    # 2. Set is_running to False immediately so frontend receives correct state
    project_manager.set_agent_running(project_id, agent_id, False)

    # 3. Update the last ProgressSummaryMessage to completed status and add a "Finished" message
    agent_state = project_manager.get_agent_state(project_id, agent_id)
    # Find and update the last ProgressSummaryMessage to completed status
    for message in reversed(agent_state.chat_list):
        if hasattr(message, "chat_type") and message.chat_type == "progress_summary_message":
            message.chat_content["status"] = "completed"
            break
    # Add a new ProgressSummaryMessage with "Finished" status
    finished_msg = ProgressSummaryMessage.create(
        progress_summary="Finished", status="completed"
    )
    project_manager.add_chat_message_4display(project_id, agent_id, finished_msg)

    await project_manager.send_project_update(project_id)

    result_msg = "Successfully finished this turn. Wait for the next user request."
    return ToolResult(compact=result_msg, full=result_msg)
