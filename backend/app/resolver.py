"""Deterministic resolution of position and price commands ("open the second result", "the cheapest one").

Small local LLMs are unreliable at this kind of counting and comparing, and code is instant, so we do it here.

Position means position on the screen the user is looking at: after scrolling, "the first one" is the first result
they can see, not the first on the page. Price comparisons look at every result on the page.

A position word only counts when it is the whole request ("the second one", "the third question"). Inside a name it
doesn't: "open the first aid kit" and "open the 4th of July sale" are names, not positions.
"""
import re

from .schemas import Action, Element

# People talk: "can you please open...", "I just want to view...", "I'd like to see..."
FILLER = [
    re.compile(r"^(?:can|could|would|will) you (?:please )?"),
    re.compile(r"^i(?:'d| would| just| really| still| only| do)* (?:want|wanna|like|need|wish)(?: you)?(?: to)? "),
    re.compile(r"^(?:let me|let's|lets|go ahead and|just|please) "),
]


def strip_filler(text: str) -> str:
    prev = None
    while prev != text:
        prev = text
        for pattern in FILLER:
            text = pattern.sub("", text)
    return text


# Verbs that mean "go to / act on this thing". "see more about the second one" starts with "see".
CLICK_VERB = re.compile(r"^(?:click|open|select|choose|pick|tap|press|expand|go to|visit|view|see|look at|read|show me|take me to|check out)\b")

# Buttons that do something to an item rather than open it ("Add to cart", or just "ADD" on grocery sites).
# They are never "the second result".
ACTION_BUTTON = re.compile(r"^(?:add|buy|subscribe|save|follow|remove|delete|place)\b", re.I)

ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
}
_ORD = r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th)"
# What a position can be followed by. Anything else after it ("first aid kit") means it's part of a name.
_HEAD = r"item|result|product|video|story|article|link|question|button|tab|checkbox|filter|option|post|listing|choice|entry|page|one"
# The position may be followed by words like these ("second product page", "first search result", "third one"), but not by
# anything else: "first aid kit", "second water filter" are names.
POSITION_RE = re.compile(rf"^(?:(?:the|a) )?(?P<ord>{_ORD})(?P<tail>(?: (?:{_HEAD}|search|web|news)s?)*)(?: on (?:the )?screen)?$")
_CHEAP = r"cheapest|least expensive|lowest[- ]priced?|lowest price"
_PRICEY = r"most expensive|priciest|highest[- ]priced?|highest price"
# Unlike position words, price words don't show up inside product names, so anything may follow: "the cheapest headphones"
SUPERLATIVE_RE = re.compile(rf"^(?:the )?(?:(?P<ord>{_ORD}) )?(?:(?P<cheap>{_CHEAP})|(?P<pricey>{_PRICEY}))(?: .+)?$")
# "open the item" / "view this product": no position or name, so we can't know which
VAGUE_RE = re.compile(r"^(?:the |this |that |an? )?(?:item|product|result|one|video|story|article)s?(?: on (?:the )?screen)?$")
NOUNS = {"question", "button", "link", "tab", "checkbox", "filter", "option"}


def noun_pool(noun: str, elements: list[Element]) -> list[Element]:
    """'The second question' counts questions, not links. Elements are in screen order."""
    if noun == "question":
        return [e for e in elements if e.role == "question" or e.label.rstrip().endswith("?")]
    if noun == "button":
        return [e for e in elements if e.role in ("button", "submit")]
    if noun == "link":
        return [e for e in elements if e.role == "link"]
    if noun == "tab":
        return [e for e in elements if e.role == "tab"]
    return [e for e in elements if e.role in ("checkbox", "radio", "option")]  # checkbox, filter, option


def all_results(elements: list[Element]) -> list[Element]:
    """Every result on the page, in page order (used for price comparisons).

    1. Elements the extension marked as results (one per product or video card, on sites it knows).
    2. Otherwise a guess: elements with a price, or long link labels. Page chrome and action buttons are excluded.
       This is the weak path: a product card can contain several links, so counts can be off on unknown sites.
    """
    marked = sorted((e for e in elements if e.result), key=lambda e: e.rank if e.rank is not None else e.id)
    if marked:
        return marked
    pool = [e for e in elements if not ACTION_BUTTON.match(e.label) and e.role in ("link", "button", "")]
    priced = [e for e in pool if e.price is not None]
    if len(priced) >= 2:
        return priced
    return [e for e in pool if e.role == "link" and len(e.label) >= 15]


def candidates(elements: list[Element]) -> list[Element]:
    """Results to count positions in: starting from the first one the user can see.

    The extension ranks results from the first on-screen one (rank 0); results already scrolled past have a negative rank.
    """
    pool = all_results(elements)
    ahead = [e for e in pool if e.rank is None or e.rank >= 0]
    return ahead or pool


def pick_ordinal(pool: list[Element], word: str) -> Element | None:
    if word == "last":
        visible = [e for e in pool if e.onscreen]
        return (visible or pool)[-1]  # "the last one" means the last one you can see
    m = re.fullmatch(r"(\d+)(?:st|nd|rd|th)", word)
    index = int(m.group(1)) if m else ORDINALS[word]
    return pool[index - 1] if 1 <= index <= len(pool) else None


def resolve(command: str, elements: list[Element]) -> Action | None:
    text = strip_filler(re.sub(r"[.,!?]", "", command.lower()).strip())
    text = re.sub(r"\s+(?:please|now|for me|thanks|thank you)$", "", text)  # "open the first one please"
    verb = CLICK_VERB.match(text)
    if not verb:
        return None
    rest = re.sub(r"^(?:on |more about |more of |about )", "", text[verb.end():].strip())

    # "the cheapest one", "the second cheapest item"
    sm = SUPERLATIVE_RE.match(rest)
    if sm:
        priced = [e for e in all_results(elements) if e.price is not None]
        if not priced:
            return Action(action="none", message="I can't see any prices on this page", source="resolver")
        ranked = sorted(priced, key=lambda e: e.price, reverse=bool(sm.group("pricey")))
        n = 1 if not sm.group("ord") else len(ranked) if sm.group("ord") == "last" else pick_index(sm.group("ord"))
        if not 1 <= n <= len(ranked):
            return Action(action="none", message=f"There are only {len(ranked)} priced results", source="resolver")
        pick = ranked[n - 1]
        return Action(action="click", id=pick.id, message=f"{pick.label} ({pick.price:g})", source="resolver")

    # "the second one", "the third question": the position must be the whole request
    pm = POSITION_RE.match(rest)
    if pm:
        word = pm.group("ord")
        noun = next((t.rstrip("s") for t in pm.group("tail").split() if t.rstrip("s") in NOUNS), None)
        if noun:
            pool = noun_pool(noun, elements)
            if not pool:
                return Action(action="none", message=f"I don't see any {noun}s on the screen", source="resolver")
        else:
            pool = candidates(elements)
            if not pool:
                return Action(action="none", message="I can't tell which results you mean", source="resolver")
        pick = pick_ordinal(pool, word)
        if pick is None:
            return Action(action="none", message=f"There are only {len(pool)} here", source="resolver")
        return Action(action="click", id=pick.id, message=pick.label, source="resolver")

    # "open the item": which one? Ask, and show the numbers so the answer can be "click 3"
    if VAGUE_RE.match(rest):
        pool = candidates(elements)
        if len(pool) == 1:
            return Action(action="click", id=pool[0].id, message=pool[0].label, source="resolver")
        if len(pool) > 1:
            return Action(action="none", message='Which one? Say "first", "second", or part of its name',
                          show_numbers=True, source="resolver")

    return None


def pick_index(word: str) -> int:
    m = re.fullmatch(r"(\d+)(?:st|nd|rd|th)", word)
    return int(m.group(1)) if m else ORDINALS[word]
