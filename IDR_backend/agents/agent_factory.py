"""
Agent Factory for IDR Backend
Centralized agent creation logic to avoid code duplication
"""

from IDR_backend.data_models.agent_models import AgentState


def create_agent_instance(agent_state: AgentState):
    """
    Factory function to create agent runtime instances.

    Args:
        agent_state: Agent state

    Returns:
        Agent instance

    Raises:
        ValueError: If agent_type is unknown
    """
    print(f"[AgentFactory] Creating agent {agent_state.agent_type}")

    if agent_state.agent_type == "ResearchAgent":
        from IDR_backend.agents.researchAgent.researchAgent import ResearchAgent

        return ResearchAgent(agent_state=agent_state)

    else:
        raise ValueError(f"Unknown agent type: {agent_state.agent_type}")
