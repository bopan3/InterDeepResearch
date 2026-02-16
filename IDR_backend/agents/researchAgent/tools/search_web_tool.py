"""
Web search tool
"""

import sys
import os
from typing import Any, TYPE_CHECKING
from IDR_backend.data_models.card_models import WebSearchResultCard
from IDR_backend.data_models.chat_models import ToolMessage, ToolResult
from utils.web_search import web_search

if TYPE_CHECKING:
    from IDR_backend.data_models.project_models import ProjectManager

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


async def search_web_tool(
    search_term: str,
    project_id: str,
    agent_id: str,
    project_manager: "ProjectManager",
    global_config: dict[str, Any],
) -> ToolResult:
    """
    Perform web search and create WebSearchResultCard.

    Args:
        search_term: Search query
        project_id: ID of the current project
        agent_id: ID of this agent
        project_manager: Reference to the global project manager
        global_config: Global configuration
    """

    # 1. Create tool message (in progress) and get its index.
    tool_msg = ToolMessage.create(
        first_tool_description="Search Web: ",
        second_tool_description=search_term,
        status="in_progress",
        detail=None,
    )
    tool_msg_index = project_manager.add_chat_message_4display(project_id, agent_id, tool_msg)

    # 2. Create WebSearchResultCard (in in progress status) and get its id.
    previous_card_id = project_manager.get_agent_latest_card_id(project_id, agent_id)
    current_card_id = project_manager.generate_card_id(project_id, agent_id)
    web_search_result_card = await WebSearchResultCard.initial_create(
        card_id=current_card_id,
        search_query=search_term,
        card_ref_implicit=[previous_card_id] if previous_card_id else [],
        card_ref_explicit=[],
        global_config=global_config,
    )
    project_manager.add_info_card(project_id, agent_id, web_search_result_card)

    # 3. Send project update.
    await project_manager.send_project_update(project_id)

    # 4. Perform search.
    search_results = await web_search(search_term)

    # 5. Update WebSearchResultCard for the search results
    web_search_result_card.status = "completed"
    web_search_result_card.card_content["search_result_list"] = search_results
    web_search_result_card.card_title = search_term

    # 6. Update tool message to completed.
    tool_msg_completed = ToolMessage.create(
        first_tool_description="Search Web: ",
        second_tool_description=search_term,
        status="completed",
        detail=None,
        bind_card_id=current_card_id,
    )
    project_manager.update_chat_message_4display(project_id, agent_id, tool_msg_index, tool_msg_completed)

    # 7. Send project update.
    await project_manager.send_project_update(project_id)

    # 8. Prepare compact and full versions of the result
    full_content = await web_search_result_card.read_info_card_content()

    compact_result = (
        f"Search results saved in InfoCard with Card ID: {current_card_id}. The full result has been hidden (you can set it to be the input info card of another create_note tool call to revisit its content)."
    )

    full_result = (
        f"Search results saved in InfoCard with Card ID: {current_card_id}. The full result is shown below (which will be hidden once you call the create_note tool).\n"
        + full_content
    )

    return ToolResult(compact=compact_result, full=full_result)
