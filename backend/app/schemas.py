from typing import Literal

from pydantic import BaseModel, Field

ActionName = Literal["click", "type", "search", "scroll", "back", "forward", "pause", "play", "none"]


class Element(BaseModel):
    id: int
    label: str
    role: str = ""
    price: float | None = None
    result: bool = False  # the extension recognised this as the main link of a result card (product, video)
    rank: int | None = None  # position among the results, counted from the first one on screen (0); negative = scrolled past
    onscreen: bool = True  # is it visible right now (used for "the last one")


class InterpretRequest(BaseModel):
    command: str = Field(min_length=1, max_length=300)
    elements: list[Element] = Field(default_factory=list, max_length=300)
    url: str = ""
    title: str = ""


class Action(BaseModel):
    action: ActionName
    id: int | None = None
    text: str | None = None
    direction: Literal["down", "up"] | None = None
    message: str | None = None
    show_numbers: bool = False  # ask the extension to number the page so the user can answer "click 3"
    source: Literal["resolver", "llm", "none"] = "none"
    latency_ms: int = 0
