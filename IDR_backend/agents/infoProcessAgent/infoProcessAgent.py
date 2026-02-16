from typing import Any
from llmAPIs.llmAPI import llm_message_completion
from utils.util import parse_markdown_from_llm_response

PROMPT_FOR_NOTE_CREATION = """

## Instruction
You are a helpful assistant that create a note based on the "Input Info Cards", the "Title for the Note", and the "Instruction for Creating the Note".
The note can only based on the information in the "Input Info Cards". It can only be excerpt, reorganization, synthesis, or reasonable interpretation of the information in the "Input Info Cards". You should not create any new information or make up any information that is not in the "Input Info Cards".
- Any reorganization, synthesis, or reasonable interpretation of the information in the "Input Info Cards" should be done by citing the corresponding info cards in format like <cardId>(id of the corresponding input info card)</cardId>. 
- You can only cite the info cards with format <cardId>(id of the corresponding input info card)</cardId>. You cannot directly say "based on the infomation in Card 3..." because the user will not know what is "Card 3".
- Unless necessary, make your note concise. Use tables and lists to organize your note if needed.
- If you think you cannot find any information from the "Input Info Cards" that can satisfy the "Instruction for Creating the Note", you should return honestly report this and provide concise reason.
- If you think the information in the "Input Info Cards" is not sufficiently reliable (e.g. is from unreliable information source, the scraped web pages contain a lot of garbled text), you should return honestly report this and provide concise reason. 
## Inputs
### Input Info Cards
{input_info_cards}

### Title for the Note
{title_for_note}

### Instruction for Creating the Note
{instruction_for_agent}

## Output Format (You must warp your output in ```markdown and ``` and not output anything else)
```markdown
(content of the note)
```
"""


async def create_note(
    id2cardcontent_dict: dict[str, str], title_for_note: str, instruction_for_agent: str, llm_config: dict[str, Any]
) -> str:
    """
    Create a note based on the input info cards.
    """
    # 1. format id2cardcontent_dict into a string that can be used as the input for the info_synthesize_agent
    input_info_cards = "\n".join(
        [
            f"****** Content of Info Card with ID {card_id}: ******\n{content}\n\n"
            for card_id, content in id2cardcontent_dict.items()
        ]
    )
    # 2. format the input for the info_synthesize_agent
    prompt_for_agent = PROMPT_FOR_NOTE_CREATION.format(
        input_info_cards=input_info_cards,
        title_for_note=title_for_note,
        instruction_for_agent=instruction_for_agent,
    )
    # 3. invoke llm and get the report content
    response = await llm_message_completion(
        model=llm_config["model"],
        customized_base_url=llm_config["customized_base_url"],
        customized_api_key=llm_config["customized_api_key"],
        messages=[{"role": "user", "content": prompt_for_agent}],
    )
    note_content = parse_markdown_from_llm_response(response)

    return note_content
