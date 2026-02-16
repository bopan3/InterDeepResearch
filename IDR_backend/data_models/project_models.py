"""
Project Models
Defines project structure and project manager
"""

from datetime import datetime
from typing import Any
import json
from pydantic import Field, BaseModel
import IDR_backend.agents.agent_factory as agent_factory

from .agent_models import AgentState, InfoTraceState
from .card_models import InfoCard, UserRequirementCard, WebSearchResultCard, WebpageCard, NoteCard
from .chat_models import ChatMessage4Display
from IDR_backend.config.database import DatabaseManager


class Project(BaseModel):
    """Research project containing all agents and data"""

    project_id: str
    research_goal: str
    root_agent_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    agent_dict: dict[str, AgentState] = Field(default_factory=dict)
    agent_counter: int = 0

    def generate_next_agent_id(self) -> str:
        """Generate a new agent ID"""
        self.agent_counter += 1
        return str(self.agent_counter)


class ProjectManager:
    """Manages all research projects"""

    def __init__(self, global_config: dict[str, Any]):
        self.projects: dict[str, Project] = {}
        self.global_config = global_config
        self.server_instance: Any = None
        self.user_name = "User"
        self.disable_database = True
        self.db_manager = DatabaseManager(self.disable_database)
        self.user_id = self.db_manager.create_user(self.user_name)

    def set_server_instance(self, server_instance: Any):
        """Set the server instance"""
        self.server_instance = server_instance

    def get_server_instance(self) -> Any:
        """
        Get the server instance. This is used to send project updates to the frontend.
        This is a reference to the IDRServer instance.
        """
        return self.server_instance

    def get_global_config(self) -> dict[str, Any]:
        """Get the global config"""
        return self.global_config

    def create_project(self, research_goal: str) -> str:
        """Create a new research project and return its ID"""
        # 1. Create the project in database to get auto-incremented ID.
        db_project_id = self.db_manager.create_project(self.user_id, title=research_goal)
        if db_project_id < 0:
            raise RuntimeError("Failed to create project in database")
        project_id = str(db_project_id)
        project = Project(project_id=project_id, research_goal=research_goal)
        self.projects[project_id] = project

        # 2. Create the root agent.
        root_agent_id = project.generate_next_agent_id()
        project.root_agent_id = root_agent_id
        root_agent_state = AgentState(
            agent_id=root_agent_id,
            project_id=project_id,
            agent_type=self.global_config["llm_config"]["agent_config"]["root_agent_config"]["agent_type"],
            parent_agent_id=None,
            chat_list=[],
            context_list=[],
            card_dict={},
            is_running=False,
            is_interrupted=False,
            final_result_generated=False,
            final_result_card_id=None,
            project_manager=self,
        )
        root_agent_state.agent_instance = agent_factory.create_agent_instance(
            agent_state=root_agent_state,
        )
        project.agent_dict[root_agent_id] = root_agent_state

        self._persist_project_snapshot(project_id)
        print(f"[Server] Project created: {project_id}")
        print(f"[Server] Project Data: {self.get_project(project_id)}")
        data = self.db_manager.list_titles(self.user_id)
        print(f"[Server] DB list_titles successful, data: {data}")
        self.server_instance.sio.emit("b2f_provide_project_list", data)

        return project_id

    def get_project(self, project_id: str) -> Project:
        """Get project by ID"""
        project = self.projects.get(project_id)
        if project is None:
            # Fallback: load from database
            project = self._get_project_from_db(project_id)
            if project is None:
                raise ValueError(f"Project with ID '{project_id}' not found")
            # Rehydrate agent states loaded from DB
            self._rehydrate_project_agents(project)
            self.projects.clear()
            # Cache the loaded project for future accesses
            self.projects.clear()
            self.projects[project_id] = project
        return project

    def get_agent_state(self, project_id: str, agent_id: str) -> AgentState:
        """Get agent state by project ID and agent ID"""
        project = self.get_project(project_id)
        agent_state = project.agent_dict.get(agent_id)
        if agent_state is None:
            raise ValueError(f"Agent with ID '{agent_id}' not found in project '{project_id}'")
        return agent_state

    def get_root_agent_id(self, project_id: str) -> str:
        """Get root agent ID for a project"""
        project = self.get_project(project_id)
        if project.root_agent_id is None:
            raise ValueError(f"Root agent ID not found for project '{project_id}'")
        return project.root_agent_id

    def get_agent_instance(self, project_id: str, agent_id: str) -> Any:
        """Get agent instance by project ID and agent ID"""
        agent_state = self.get_agent_state(project_id, agent_id)
        if agent_state.agent_instance is None:
            # Lazy-create runtime instance when missing (e.g., after import or server restart)
            try:
                agent_state.agent_instance = agent_factory.create_agent_instance(agent_state)
            except Exception as e:
                raise ValueError(
                    f"Agent instance not found for agent '{agent_id}' in project '{project_id}' (and failed to create): {e}"
                )
        return agent_state.agent_instance

    def get_agent_latest_card_id(self, project_id: str, agent_id: str) -> str | None:
        """Get agent's latest card ID"""
        agent = self.get_agent_state(project_id, agent_id)
        return agent.latest_card_id

    def add_chat_message_4display(self, project_id: str, agent_id: str, message: ChatMessage4Display) -> int:
        """
        Add a chat message for display to an agent's chat list (frontend display only).

        Returns:
            Index of the added message in chat_list, or None if agent not found
        """
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.chat_list.append(message)
            return len(agent.chat_list) - 1
        raise ValueError(f"Agent with ID '{agent_id}' not found in project '{project_id}'")

    def update_chat_message_4display(
        self,
        project_id: str,
        agent_id: str,
        message_index: int,
        new_message: ChatMessage4Display,
    ) -> bool:
        """
        Update a chat message for display at the specified index.

        Args:
            project_id: Project ID
            agent_id: Agent ID
            message_index: Index of the message to update
            new_message: New message to replace the old one

        Returns:
            True if update was successful, False otherwise
        """
        agent = self.get_agent_state(project_id, agent_id)
        if agent and 0 <= message_index < len(agent.chat_list):
            agent.chat_list[message_index] = new_message
            return True
        return False

    def add_info_card(self, project_id: str, agent_id: str, card: InfoCard) -> bool:
        """Add an info card to an agent"""
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.card_dict[card.card_id] = card
            agent.latest_card_id = card.card_id
            return True
        return False

    def get_info_card(self, project_id: str, agent_id: str, card_id: str) -> InfoCard:
        """Get an info card"""
        agent = self.get_agent_state(project_id, agent_id)
        card = agent.card_dict.get(card_id)
        if card is None:
            raise ValueError(
                f"Info card with ID '{card_id}' not found for agent '{agent_id}' in project '{project_id}'"
            )
        return card

    def generate_card_id(self, project_id: str, agent_id: str) -> str:
        """Generate a new card ID for an agent"""
        agent = self.get_agent_state(project_id, agent_id)
        return str(len(agent.card_dict) + 1)

    def set_agent_interrupted(self, project_id: str, agent_id: str, interrupted: bool = True) -> bool:
        """Set agent's interrupted status"""
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.is_interrupted = interrupted
            return True
        return False

    def is_agent_interrupted(self, project_id: str, agent_id: str) -> bool:
        """Check if agent is interrupted"""
        agent = self.get_agent_state(project_id, agent_id)
        return agent.is_interrupted if agent else False

    def set_agent_running(self, project_id: str, agent_id: str, running: bool) -> bool:
        """Set agent's running status"""
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.is_running = running
            return True
        return False

    def set_agent_final_result_generated(self, project_id: str, agent_id: str, final_result_generated: bool) -> bool:
        """Set agent's final result generated status"""
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.final_result_generated = final_result_generated
            return True
        return False

    def set_agent_final_result_card_id(self, project_id: str, agent_id: str, final_result_card_id: str) -> bool:
        agent = self.get_agent_state(project_id, agent_id)
        if agent:
            agent.final_result_card_id = final_result_card_id
            return True
        return False

    async def send_project_update(self, project_id: str):
        """Send complete project update to all clients in global room"""
        # Skip if no server instance (e.g., in autoRunner mode)
        if self.server_instance is None:
            return

        # 1) Persist latest project state to database before broadcasting
        self._persist_project_snapshot(project_id)

        # 2) Broadcast update to frontend
        update_data = self.serialize_project_for_frontend(project_id)
        if update_data:
            print(f"[ProjectManager] Sending project update for {project_id} to global room")
            # Use _emit_with_record if available (for recording mode support)
            if hasattr(self.server_instance, '_emit_with_record'):
                await self.server_instance._emit_with_record(
                    "b2f_update", update_data, room=self.server_instance.GLOBAL_ROOM_NAME
                )
            else:
                await self.server_instance.sio.emit(
                    "b2f_update", update_data, room=self.server_instance.GLOBAL_ROOM_NAME
                )  # Send to all clients in global room

    def serialize_project_for_frontend(self, project_id: str) -> dict[str, Any] | None:
        """Serialize project data for frontend update"""
        project = self.get_project(project_id)
        if not project:
            return None

        if not project.root_agent_id:
            return None

        root_agent_state = self.get_agent_state(project_id, project.root_agent_id)

        if not root_agent_state:
            return None

        # current format is customized for IDR version 4 that only supports single root research agent
        try:
            return {
                "project_id": project.project_id,
                "chat_list": [
                    chat_message.model_dump() if hasattr(chat_message, "model_dump") else chat_message
                    for chat_message in root_agent_state.chat_list
                ],
                "card_dict": {
                    card_id: card.model_dump() if hasattr(card, "model_dump") else card
                    for card_id, card in root_agent_state.card_dict.items()
                },
                "is_running": root_agent_state.is_running,
                "is_interrupted": root_agent_state.is_interrupted,
                "info_trace_state_dict": {
                    request_id: trace_state.model_dump() if hasattr(trace_state, "model_dump") else trace_state
                    for request_id, trace_state in root_agent_state.info_trace_state_dict.items()
                },
            }

        except Exception as e:
            print(f"[ProjectManager] Error serializing project {project_id}: {e}")
            import traceback

            traceback.print_exc()
            return None

    # =============================
    # DB Persistence Helper
    # =============================
    def _persist_project_snapshot(self, project_id: str) -> None:
        """Serialize and persist the project snapshot to the database."""
        try:
            db_update = self._serialize_project_for_db(project_id)
            self.db_manager.update_data(
                project_id=db_update["project_id"],
                root_agent_id=db_update["root_agent_id"],
                agent_counter=db_update["agent_counter"],
                agent_dict_json=db_update["agent_dict_json"],
                user_id=self.user_id,
            )
        except Exception as e:
            print(f"[ProjectManager] Error persisting project {project_id}: {e}")

    def _get_project_from_db(self, project_id: str) -> Project | None:
        """Retrieve project data from database"""
        try:
            db_data = self.db_manager.get_project(project_id, self.user_id)
            if db_data:
                return Project(**db_data)
            return None
        except Exception as e:
            print(f"[ProjectManager] Error retrieving project {project_id}: {e}")
            return None

    # =============================
    # DB Rehydration Helper
    # =============================
    def _deserialize_card_dict(self, card_dict: dict[str, Any]) -> dict[str, InfoCard]:
        """
        Deserialize card_dict values from dicts to InfoCard objects.

        Args:
            card_dict: Dictionary mapping card_id to either InfoCard objects or dicts

        Returns:
            Dictionary with all values as InfoCard objects
        """
        deserialized: dict[str, InfoCard] = {}
        for card_id, card_value in card_dict.items():
            # If already an InfoCard object, use it directly
            if isinstance(card_value, (UserRequirementCard, WebSearchResultCard, WebpageCard, NoteCard)):
                deserialized[card_id] = card_value
            # If it's a dict, deserialize based on card_type
            elif isinstance(card_value, dict):
                card_type = card_value.get("card_type")
                if card_type == "user_requirement":
                    deserialized[card_id] = UserRequirementCard(**card_value)
                elif card_type == "web_search_result":
                    deserialized[card_id] = WebSearchResultCard(**card_value)
                elif card_type == "webpage":
                    deserialized[card_id] = WebpageCard(**card_value)
                elif card_type == "note":
                    deserialized[card_id] = NoteCard(**card_value)
                else:
                    # Unknown card type, keep as dict (will cause error later, but better than crashing here)
                    print(
                        f"[ProjectManager] Warning: Unknown card_type '{card_type}' for card {card_id}, keeping as dict"
                    )
                    deserialized[card_id] = card_value  # type: ignore
            else:
                # Unknown type, keep as is
                print(f"[ProjectManager] Warning: Unexpected card value type {type(card_value)} for card {card_id}")
                deserialized[card_id] = card_value  # type: ignore
        return deserialized

    def _rehydrate_project_agents(self, project: Project) -> None:
        """Rehydrate project.agent_dict entries into AgentState and set runtime references."""
        try:
            hydrated_agents: dict[str, AgentState] = {}
            for aid, astate in (project.agent_dict or {}).items():
                try:
                    # Assume AgentState per type hints; set runtime reference
                    astate.project_manager = self
                    # Ensure agent state's project_id matches the current project
                    try:
                        if getattr(astate, "project_id", None) != project.project_id:
                            astate.project_id = project.project_id
                    except Exception:
                        pass
                    # Deserialize card_dict if needed (values might be dicts from DB)
                    if hasattr(astate, "card_dict") and astate.card_dict:
                        astate.card_dict = self._deserialize_card_dict(astate.card_dict)
                    # Ensure runtime agent instance exists after import/DB load
                    if getattr(astate, "agent_instance", None) is None:
                        try:
                            astate.agent_instance = agent_factory.create_agent_instance(astate)
                        except Exception as e_create:
                            print(
                                f"[ProjectManager] Failed to create agent instance for '{aid}' in project '{project.project_id}': {e_create}"
                            )
                    hydrated_agents[aid] = astate
                except Exception:
                    # If value is a plain dict, construct AgentState defensively
                    try:
                        new_state = AgentState(**astate)  # type: ignore[arg-type]
                        new_state.project_manager = self
                        # Force project_id to current project for newly constructed state
                        new_state.project_id = project.project_id
                        # Deserialize card_dict if needed (values might be dicts from DB)
                        if hasattr(new_state, "card_dict") and new_state.card_dict:
                            new_state.card_dict = self._deserialize_card_dict(new_state.card_dict)
                        # Create runtime agent instance for newly constructed state
                        try:
                            new_state.agent_instance = agent_factory.create_agent_instance(new_state)
                        except Exception as e_create2:
                            print(
                                f"[ProjectManager] Failed to create agent instance for '{aid}' in project '{project.project_id}': {e_create2}"
                            )
                        hydrated_agents[aid] = new_state
                    except Exception as e2:
                        print(
                            f"[ProjectManager] Failed to hydrate agent '{aid}' for project {project.project_id}: {e2}"
                        )
            project.agent_dict = hydrated_agents
        except Exception as e:
            # Be defensive: keep whatever was loaded if hydration fails
            print(f"[ProjectManager] AgentState hydration error for project {project.project_id}: {e}")

    # =============================
    # DB Serialization Helpers
    # =============================
    def _serialize_agent_state_for_db(self, agent_state: AgentState) -> dict[str, Any]:
        """
        Create a JSON-serializable dict of AgentState for persistence.
        Excludes runtime references (agent_instance, project_manager).
        """
        # Serialize chat_list (ChatMessage4Display union) to plain dicts
        chat_list_serialized = [
            msg.model_dump() if hasattr(msg, "model_dump") else msg for msg in agent_state.chat_list
        ]

        # Serialize card_dict values (InfoCard) to plain dicts
        card_dict_serialized: dict[str, Any] = {}
        for cid, card in agent_state.card_dict.items():
            card_dict_serialized[cid] = card.model_dump() if hasattr(card, "model_dump") else card

        # Context list is expected to be a list of dicts compatible with LLM APIs
        context_list_serialized = agent_state.context_list

        # Serialize info_trace_state_dict
        info_trace_state_dict_serialized: dict[str, Any] = {}
        for request_id, trace_state in agent_state.info_trace_state_dict.items():
            info_trace_state_dict_serialized[request_id] = (
                trace_state.model_dump() if hasattr(trace_state, "model_dump") else trace_state
            )

        return {
            "agent_id": agent_state.agent_id,
            "project_id": agent_state.project_id,
            "agent_type": agent_state.agent_type,
            "parent_agent_id": agent_state.parent_agent_id,
            "chat_list": chat_list_serialized,
            "context_list": context_list_serialized,
            "card_dict": card_dict_serialized,
            "latest_card_id": agent_state.latest_card_id,
            "is_running": agent_state.is_running,
            "is_interrupted": agent_state.is_interrupted,
            "final_result_generated": agent_state.final_result_generated,
            "final_result_card_id": agent_state.final_result_card_id,
            "info_trace_state_dict": info_trace_state_dict_serialized,
        }

    def _serialize_project_for_db(self, project_id: str) -> dict[str, Any]:
        """
        Produce a persistence payload for typed DB update (no DB-side serialization).
        Returns dict with keys matching DatabaseManager.update_data parameters.
        """
        project = self.get_project(project_id)
        # Build agent_dict snapshot
        agent_dict_snapshot: dict[str, Any] = {}
        for aid, astate in project.agent_dict.items():
            agent_dict_snapshot[aid] = self._serialize_agent_state_for_db(astate)

        return {
            "project_id": project.project_id,
            "root_agent_id": project.root_agent_id,
            "agent_counter": project.agent_counter,
            "agent_dict_json": json.dumps(agent_dict_snapshot, ensure_ascii=False),
        }
