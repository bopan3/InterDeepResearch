"""
Generate info card tool for Research Agent
"""

import sys
import os
from IDR_backend.data_models.chat_models import ToolMessage, ToolResult, ProgressSummaryMessage
from IDR_backend.data_models.card_models import NoteCard
import IDR_backend.agents.infoProcessAgent.infoProcessAgent as info_process_agent
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from IDR_backend.data_models.project_models import ProjectManager

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


async def create_note_tool(
    input_info_card_ids: list[str],
    title_for_note: str,
    instruction_for_agent: str,
    is_final_note: bool,
    is_progress_summary_note: bool,
    project_id: str,
    agent_id: str,
    project_manager: "ProjectManager",
    global_config: dict[str, Any],
    concise_progress_summary: str | None = None,
) -> ToolResult:
    """
    Create a new note card.

    Args:
        input_info_card_ids: List of info card ids that the note will be based on
        title_for_note: Title of the note
        instruction_for_agent: Instruction for the agent to create the note
        is_final_note: Whether this is the final note
        is_progress_summary_note: Whether this is a progress summary note
        project_id: ID of the current project
        agent_id: ID of this agent
        project_manager: Reference to the global project manager
        global_config: Global configuration
        concise_progress_summary: A very concise one sentence progress summary of what you have made since the last time you made a progress summary note (or since the start of the research if you have not made any progress summary note yet). This is only used if is_progress_summary_note is True.
    """

    # 1. Create tool message (in progress) and get its index.
    tool_msg = ToolMessage.create(
        first_tool_description="Create Note: ",
        second_tool_description=title_for_note,
        status="in_progress",
        detail=None,
    )
    tool_msg_index = project_manager.add_chat_message_4display(project_id, agent_id, tool_msg)

    # 2. Create NoteCard (in in progress status) and get its id.
    previous_card_id = project_manager.get_agent_latest_card_id(project_id, agent_id)
    current_card_id = project_manager.generate_card_id(project_id, agent_id)
    note_card = await NoteCard.initial_create(
        card_id=current_card_id,
        note_title=title_for_note,
        card_ref_implicit=[previous_card_id] if previous_card_id else [],
        card_ref_explicit=input_info_card_ids,
        global_config=global_config,
    )
    if is_progress_summary_note:
        note_card.unfold_at_start = True
    project_manager.add_info_card(project_id, agent_id, note_card)

    # 3. Send project update.
    await project_manager.send_project_update(project_id)

    # 4. launch info_synthesize_agent to create the note
    # first check if all input card ids are valid
    invalid_card_ids = []
    for card_id in input_info_card_ids:
        try:
            project_manager.get_info_card(project_id, agent_id, card_id)
        except ValueError:
            invalid_card_ids.append(card_id)

    if invalid_card_ids:
        error_msg = f"Argument Error: The following card IDs are invalid: {', '.join(invalid_card_ids)}"
        print("******************ERROR MESSAGE******************************")
        print(error_msg)
        print("******************ERROR MESSAGE******************************")
        agent_state = project_manager.get_agent_state(project_id, agent_id)
        agent_instance = agent_state.agent_instance
        agent_instance._cleanup_interrupted_states()
        await project_manager.send_project_update(project_id)
        return ToolResult(compact=error_msg, full=error_msg)

    # Prepare the input for the info_synthesize_agent
    id2cardcontent_dict = {
        card_id: await project_manager.get_info_card(project_id, agent_id, card_id).read_info_card_content()
        for card_id in input_info_card_ids
    }
    llm_config_for_info_process_agent = {
        "model": global_config["llm_config"]["agent_config"]["root_agent_config"]["model"],
        "customized_base_url": global_config["llm_config"]["customized_base_url"],
        "customized_api_key": global_config["llm_config"]["customized_api_key"],
    }
    note_content = await info_process_agent.create_note(
        id2cardcontent_dict, title_for_note, instruction_for_agent, llm_config_for_info_process_agent
    )

    # 5. Update NoteCard for the note and add it to the agent's card dict.
    note_card.status = "completed"
    note_card.card_content["markdown_with_cite"] = note_content

    # 6. Update tool message to completed.
    tool_msg_completed = ToolMessage.create(
        first_tool_description="Create Note: ",
        second_tool_description=title_for_note,
        status="completed",
        detail=None,
        bind_card_id=current_card_id,
    )

    project_manager.update_chat_message_4display(project_id, agent_id, tool_msg_index, tool_msg_completed)

    # 7. Set the final result card id if this is marked as final
    if is_final_note:
        project_manager.set_agent_final_result_card_id(project_id, agent_id, current_card_id)

    # 8. If this is a progress summary note, update the last ProgressSummaryMessage and add a new one
    if is_progress_summary_note and concise_progress_summary:
        agent_state = project_manager.get_agent_state(project_id, agent_id)
        # Find and update the last ProgressSummaryMessage to completed status
        for message in reversed(agent_state.chat_list):
            if hasattr(message, "chat_type") and message.chat_type == "progress_summary_message":
                message.chat_content["status"] = "completed"
                break
        # Add a new ProgressSummaryMessage with the concise_progress_summary as in_progress
        new_progress_msg = ProgressSummaryMessage.create(
            progress_summary=concise_progress_summary, status="in_progress"
        )
        project_manager.add_chat_message_4display(project_id, agent_id, new_progress_msg)

    # 9. Send project update.
    await project_manager.send_project_update(project_id)

    # 10. Prepare compact and full versions of the result
    full_content = await note_card.read_info_card_content()

    compact_result = f"Note saved in InfoCard with Card ID: {current_card_id}. The full result has been hidden (you can set it to be the input info card of another create_note tool call to revisit its content)."

    full_result = (
        f"Note saved in InfoCard with Card ID: {current_card_id}. The full result is shown below (which will be hidden once you call the create_note tool with is_progress_summary_note parameter set to true).\n"
        + full_content
    )

    return ToolResult(compact=compact_result, full=full_result)
