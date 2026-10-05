"""Turn a spoken command plus the visible page elements into one validated action.

Order: deterministic resolver first (instant, exact), then the LLM, then validation of whatever the LLM said.

The LLM picks an element by copying its label, and the JSON schema's `enum` is built from the labels actually on
the page. Small models are poor at copying numeric ids but good at copying text, and the enum makes an invented
target impossible.
"""
import re
import time
from typing import Protocol

from .llm import LLMUnavailable
from .resolver import ACTION_BUTTON, resolve
from .schemas import Action, Element, InterpretRequest

ACTIONS = ["click", "type", "search", "scroll", "back", "forward", "pause", "play", "none"]

# Kept constant so Ollama can reuse the cached prompt prefix between requests.
SYSTEM_PROMPT = """You turn one spoken command into one browser action. You see the visible page elements as `[role] label | price`. Reply with JSON only.

Actions:
- click: press or focus an element. Set target to the element's label, copied exactly.
- search: the user wants to look something up ("search", "find", "look for"). Set text.
- type: the user dictates words to write into a box. Set text.
- scroll (set direction), back, forward, pause, play.
- none: nothing on the page fits.

Rules:
- Copy target exactly from the list. Never invent one.
- text may only contain words the user actually said. If they say "enter my email" without giving it, click the email field.
- "previous page" and "go back" mean back.

Example page:
[textbox] Search
[link] Red running shoes | 2499
[button] Add to Cart
[dropdown] Order by
[button] Follow
[textbox] Phone number
Command: throw this in my bag
{"action":"click","target":"Add to Cart"}
Command: rearrange these by price
{"action":"click","target":"Order by"}
Command: find blue socks
{"action":"search","text":"blue socks"}
Command: let me give my phone number
{"action":"click","target":"Phone number"}
Command: return to where I was
{"action":"back"}
Command: call my mother
{"action":"none"}"""


class LLM(Protocol):
    async def chat_json(self, system: str, user: str, schema: dict) -> dict: ...


def unique_names(elements: list[Element]) -> list[str]:
    """Labels the model can pick from. Repeats get a (2), (3) suffix so each maps to exactly one element."""
    seen: dict[str, int] = {}
    names = []
    for e in elements:
        base = (e.label.strip() or e.role or "element")[:60]
        seen[base] = seen.get(base, 0) + 1
        names.append(base if seen[base] == 1 else f"{base} ({seen[base]})")
    return names


def build_schema(names: list[str]) -> dict:
    props: dict = {
        "action": {"type": "string", "enum": ACTIONS},
        "text": {"type": "string"},
        "direction": {"type": "string", "enum": ["down", "up"]},
    }
    if names:
        props["target"] = {"type": "string", "enum": names}
    return {"type": "object", "properties": props, "required": ["action"]}


MAX_SHOWN_RESULTS = 40


def shown_elements(elements: list[Element]) -> list[Element]:
    """What the model gets to see. The resolver compares prices across every result on the page, but a prompt (and the
    schema's list of allowed labels) with 150 products would be slow and confusing, so the model sees the page's
    controls plus the results nearest the screen."""
    ranked = sorted((e for e in elements if e.result and (e.rank is None or e.rank >= -2)),
                    key=lambda e: e.rank if e.rank is not None else e.id)
    keep = {e.id for e in ranked[:MAX_SHOWN_RESULTS]}
    return [e for e in elements if not e.result or e.id in keep]


def build_user_prompt(req: InterpretRequest, names: list[str], elements: list[Element] | None = None) -> str:
    lines = [
        f"[{e.role or 'element'}] {n}" + (f" | {e.price:g}" if e.price is not None else "")
        for e, n in zip(elements if elements is not None else req.elements, names)
    ]
    return f"Page: {req.title}\nElements:\n" + "\n".join(lines) + f"\nCommand: {req.command}"


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']+", s.lower()))


# Words that mean the user really wants an action button pressed. Without one of these, "Add to cart" is never the answer:
# "I just want to view the item" must open it, whatever the model guessed.
# Verbs, not nouns: "laptop bag" or "fruit basket" is a product, "add it to my bag" is a request.
ACTION_WORDS = re.compile(
    r"\b(add|buy|purchase|checkout|subscribe|follow|save|wishlist|remove|delete|place)\b"
    r"|\border (?:it|this|that|the|me)\b"
    r"|\b(?:to|in|into) (?:my |the |your )?(?:cart|basket|bag)\b"
)
# "I don't want to add it", "never subscribe", "cancel that": mentioning an action is not asking for it
NEGATION = re.compile(r"\b(?:don'?t|do not|dont|never|not|no|without|cancel|stop)\b")


def wants_action(command: str) -> bool:
    c = command.lower()
    return bool(ACTION_WORDS.search(c)) and not NEGATION.search(c)
FILLER = {"the", "a", "an", "page", "link", "open", "view", "visit", "go", "to", "take", "me", "see", "of", "for", "look", "at",
          "this", "that", "please", "product", "item", "button", "i", "just", "want", "like", "more", "about", "show", "can", "you"}


def prefer_link(command: str, target: Element, elements: list[Element]) -> Element | None:
    """'Open the fresh orange page' must follow the product link, never press 'Add to cart, Fresh orange'.

    If the model picked an action button although the user asked for no action, swap in the link that shares the most
    words with the command, or return None when there isn't one.
    """
    if not ACTION_BUTTON.match(target.label) or wants_action(command):
        return target
    want = _words(command) - FILLER
    links = [e for e in elements if e.role == "link"]
    best = max(links, key=lambda e: len(want & _words(e.label)), default=None)
    return best if best and want & _words(best.label) else None


def prefer_named(command: str, target: Element, elements: list[Element]) -> Element:
    """If the user named something and the model picked an element sharing none of those words, use the one that does.

    "view the pTron Studio Pro one" must not end up on a price label because the model guessed.
    """
    want = _words(command) - FILLER
    if len(want) < 2 or want & _words(target.label):
        return target
    best = max(elements, key=lambda e: len(want & _words(e.label)))
    if len(want & _words(best.label)) < 2:
        return target
    if ACTION_BUTTON.match(best.label) and not wants_action(command):
        return target
    return best


# On chat sites the model answered "send" by pressing "New chat", "Sign up for free" or the microphone. Asking to send
# something is never a request for one of these.
SEND_REQUEST = re.compile(r"\b(?:send|submit)\b")
NEVER_FOR_SEND = re.compile(r"\b(?:voice|microphone|mic|dictat\w*|new chat|sign ?up|log ?in|sign ?in|upload|attach\w*)\b", re.I)


def validate(raw: dict, req: InterpretRequest, names: list[str], elements: list[Element] | None = None) -> Action:
    """Never trust the model: drop unknown targets, missing arguments and text the user didn't say."""
    name = raw.get("action", "none")
    els = elements if elements is not None else req.elements  # the list `names` was built from

    if name == "click":
        if raw.get("target") not in names:
            return Action(action="none", message="I couldn't find that on the page", source="llm")
        target = prefer_link(req.command, els[names.index(raw["target"])], els)
        if target is None:
            return Action(action="none", message="I only found a button for that, not a page to open", source="llm")
        target = prefer_named(req.command, target, els)
        if SEND_REQUEST.search(req.command.lower()) and NEVER_FOR_SEND.search(target.label):
            return Action(action="none", message="I couldn't find a send button", source="llm")
        return Action(action="click", id=target.id, message=target.label, source="llm")

    if name in ("type", "search"):
        text = (raw.get("text") or "").strip()
        if not text:
            return Action(action="none", message="What should I type?", source="llm")
        if not _words(text) <= _words(req.command):
            return Action(action="none", message="Say the exact words you want typed", source="llm")
        return Action(action=name, text=text, source="llm")

    if name == "scroll":
        return Action(action="scroll", direction=raw.get("direction") or "down", source="llm")
    if name in ("back", "forward", "pause", "play"):
        return Action(action=name, source="llm")
    return Action(action="none", message="I'm not sure what you meant", source="llm")


async def interpret(req: InterpretRequest, llm: LLM, use_resolver: bool = True) -> Action:
    start = time.perf_counter()

    action = resolve(req.command, req.elements) if use_resolver else None
    if action is None:
        shown = shown_elements(req.elements)
        names = unique_names(shown)
        try:
            raw = await llm.chat_json(SYSTEM_PROMPT, build_user_prompt(req, names, shown), build_schema(names))
            action = validate(raw, req, names, shown)
        except LLMUnavailable:
            action = Action(action="none", message="The AI model isn't running", source="none")

    action.latency_ms = round((time.perf_counter() - start) * 1000)
    return action
