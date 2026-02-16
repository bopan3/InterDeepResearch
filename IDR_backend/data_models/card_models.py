"""
Info Card Models
Defines various types of information cards used by agents
"""

from typing import Any, Literal
from pydantic import BaseModel, Field
import json


# ============================================================================
# Card Models
# ============================================================================


class UserRequirementCard(BaseModel):
    """Info card for User Requirement"""

    card_id: str
    card_type: Literal["user_requirement"] = "user_requirement"
    displayed_card_type: Literal["User Information"] = "User Information"
    status: Literal["completed"] = "completed"
    unfold_at_start: bool = True
    card_title: str
    card_content: dict[str, Any] = Field(default_factory=dict)
    card_ref_implicit: list[str] = Field(default_factory=list)
    card_ref_explicit: list[str] = Field(default_factory=list)

    @classmethod
    async def create(
        cls,
        card_id: str,
        user_requirement: str,
        card_ref_implicit: list[str],
        card_ref_explicit: list[str],
        reference_list: list[dict[str, Any]],
        global_config: dict[str, Any],
    ):
        if global_config["system_language"] == "Chinese":
            card_title = "用户: " + user_requirement
        elif global_config["system_language"] == "English":
            card_title = "User: " + user_requirement
        else:
            raise ValueError("Invalid system language")

        card_content = {
            "card_title": card_title,
            "user_requirement": user_requirement,
            "reference_list": reference_list,
        }
        return cls(
            card_id=card_id,
            card_title=card_title,
            card_content=card_content,
            card_ref_implicit=card_ref_implicit,
            card_ref_explicit=card_ref_explicit,
        )

    async def read_info_card_content(self) -> str:
        return json.dumps(self.card_content["user_requirement"], ensure_ascii=False)


class WebSearchResultCard(BaseModel):
    """Info card for Web Search Result"""

    card_id: str
    card_type: Literal["web_search_result"] = "web_search_result"
    displayed_card_type: Literal["Search Result"] = "Search Result"
    status: Literal["in_progress", "completed"]
    unfold_at_start: bool = False
    card_title: str
    card_content: dict[str, Any]
    card_ref_implicit: list[str]
    card_ref_explicit: list[str]

    @classmethod
    async def initial_create(
        cls,
        card_id: str,
        search_query: str,
        card_ref_implicit: list[str],
        card_ref_explicit: list[str],
        global_config: dict[str, Any],
    ):
        card_content = {
            "card_title": search_query,
            "search_query": search_query,
            "search_result_list": None,
        }

        return cls(
            card_id=card_id,
            card_title=search_query,
            status="in_progress",
            card_content=card_content,
            card_ref_implicit=card_ref_implicit,
            card_ref_explicit=card_ref_explicit,
        )

    async def read_info_card_content(self) -> str:
        return "The search results are shown below: \n" + json.dumps(
            self.card_content["search_result_list"], ensure_ascii=False
        )


class WebpageContent(BaseModel):
    card_title: str | None
    url: str
    markdown_convert_from_webpage: str | None
    summary: str | None


class WebpageCard(BaseModel):
    """Info card for Webpage"""

    card_id: str
    card_type: Literal["webpage"] = "webpage"
    displayed_card_type: Literal["Webpage"] = "Webpage"
    status: Literal["in_progress", "completed"]
    unfold_at_start: bool = False
    card_title: str | None
    card_content: WebpageContent
    card_ref_implicit: list[str]
    card_ref_explicit: list[str]

    @classmethod
    async def initial_create(
        cls,
        card_id: str,
        webpage_url: str,
        card_ref_implicit: list[str],
        card_ref_explicit: list[str],
        global_config: dict[str, Any],
    ):
        card_content: WebpageContent = WebpageContent(
            card_title=None, url=webpage_url, markdown_convert_from_webpage=None, summary=None
        )
        return cls(
            card_id=card_id,
            card_title=None,
            status="in_progress",
            card_content=card_content,
            card_ref_implicit=card_ref_implicit,
            card_ref_explicit=card_ref_explicit,
        )

    async def read_info_card_content(self) -> str:
        if self.card_content.card_title is None or self.card_content.markdown_convert_from_webpage is None:
            raise ValueError("The webpage is not yet scraped.")
        return (
            "The title of the webpage is shown below: \n"
            + self.card_content.card_title
            + "\n The content of the webpage is shown below: \n"
            + self.card_content.markdown_convert_from_webpage
        )


class NoteCard(BaseModel):
    """Info card for Note"""

    card_id: str
    card_type: Literal["note"] = "note"
    displayed_card_type: Literal["Research Note"] = "Research Note"
    status: Literal["in_progress", "completed"]
    unfold_at_start: bool = False
    card_title: str
    card_content: dict[str, Any] = Field(default_factory=dict)
    card_ref_implicit: list[str] = Field(default_factory=list)
    card_ref_explicit: list[str] = Field(default_factory=list)

    @classmethod
    async def initial_create(
        cls,
        card_id: str,
        note_title: str,
        card_ref_implicit: list[str],
        card_ref_explicit: list[str],
        global_config: dict[str, Any],
    ):
        card_content = {
            "card_title": note_title,
            "markdown_with_cite": None,
        }
        return cls(
            card_id=card_id,
            card_title=note_title,
            status="in_progress",
            card_content=card_content,
            card_ref_implicit=card_ref_implicit,
            card_ref_explicit=card_ref_explicit,
        )

    async def read_info_card_content(self) -> str:
        return (
            "The title of the note is shown below: \n"
            + self.card_content["card_title"]
            + "\n The content of the note is shown below: \n"
            + self.card_content["markdown_with_cite"]
        )


# Union type for all info cards
InfoCard = UserRequirementCard | WebSearchResultCard | WebpageCard | NoteCard
