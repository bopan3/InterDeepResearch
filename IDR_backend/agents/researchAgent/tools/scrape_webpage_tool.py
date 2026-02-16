"""
Scrape webpage tool for Search Agent
"""

import sys
import os
from typing import Any, TYPE_CHECKING
from IDR_backend.data_models.card_models import WebpageCard
from IDR_backend.data_models.chat_models import ToolMessage, ToolResult
import IDR_backend.agents.infoCollectAgent.infoCollectAgent as info_collect_agent

if TYPE_CHECKING:
    from IDR_backend.data_models.project_models import ProjectManager

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


async def scrape_webpage_tool(
    webpage_url: str,
    project_id: str,
    agent_id: str,
    project_manager: "ProjectManager",
    global_config: dict[str, Any],
) -> ToolResult:
    """
    Scrape a webpage and create info card.

    Args:
        webpage_url: URL to scrape
        project_id: ID of the current project
        agent_id: ID of this agent
        project_manager: Reference to the global project manager
        global_config: Global configuration
    """

    # 1. Create tool message (in progress) and get its index
    tool_msg = ToolMessage.create(
        first_tool_description="Scrape Webpage: ",
        second_tool_description=webpage_url,
        status="in_progress",
        detail=None,
    )
    tool_msg_index = project_manager.add_chat_message_4display(project_id, agent_id, tool_msg)

    # 2. Create WebpageCard (in in progress status) and get its id.
    previous_card_id = project_manager.get_agent_latest_card_id(project_id, agent_id)
    current_card_id = project_manager.generate_card_id(project_id, agent_id)
    webpage_card = await WebpageCard.initial_create(
        card_id=current_card_id,
        webpage_url=webpage_url,
        card_ref_implicit=[previous_card_id] if previous_card_id else [],
        card_ref_explicit=[],
        global_config=global_config,
    )
    project_manager.add_info_card(project_id, agent_id, webpage_card)

    # 3. Send project update.
    await project_manager.send_project_update(project_id)

    # 4. Scrape webpage
    content_of_the_webpage, title_of_the_webpage = await info_collect_agent.scrape_webpage(webpage_url)

    # 5. Update WebpageCard for the webpage
    webpage_card.status = "completed"
    webpage_card.card_content.markdown_convert_from_webpage = content_of_the_webpage
    webpage_card.card_content.card_title = title_of_the_webpage
    webpage_card.card_title = title_of_the_webpage
    webpage_card.card_content.summary = "Dummy Summary"

    # 6. Update tool message to completed
    tool_msg_completed = ToolMessage.create(
        first_tool_description="Scrape Webpage: ",
        second_tool_description=webpage_url,
        status="completed",
        detail=None,
        bind_card_id=current_card_id,
    )
    project_manager.update_chat_message_4display(project_id, agent_id, tool_msg_index, tool_msg_completed)

    # 7. Send project update.
    await project_manager.send_project_update(project_id)

    # 8. Prepare compact and full versions of the result
    full_content = await webpage_card.read_info_card_content()

    compact_result = f"Webpage saved in InfoCard with Card ID: {current_card_id}. The full result has been hidden (you can set it to be the input info card of another create_note tool call to revisit its content)."

    full_result = (
        f"Webpage saved in InfoCard with Card ID: {current_card_id}. The full result is shown below (which will be hidden once you call the create_note tool).\n"
        + full_content
    )

    return ToolResult(compact=compact_result, full=full_result)
