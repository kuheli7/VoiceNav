import asyncio

from fastapi.testclient import TestClient

from app.interpreter import build_schema, build_user_prompt, interpret, unique_names
from app.llm import LLMUnavailable
from app.main import app
from app.schemas import Element, InterpretRequest

ELEMENTS = [
    Element(id=1, role="textbox", label="Search"),
    Element(id=2, role="button", label="Add to Cart"),
    Element(id=3, role="button", label="Buy Now"),
]


class FakeLLM:
    def __init__(self, reply=None, fail=False):
        self.reply, self.fail, self.calls = reply, fail, 0

    async def chat_json(self, system, user, schema):
        self.calls += 1
        if self.fail:
            raise LLMUnavailable("down")
        return self.reply

    async def aclose(self):
        pass


def run(command, llm, **kw):
    req = InterpretRequest(command=command, elements=ELEMENTS)
    return asyncio.run(interpret(req, llm, **kw))


def test_resolver_answers_without_calling_the_llm():
    llm = FakeLLM({"action": "none"})
    req = InterpretRequest(
        command="open the cheapest one",
        elements=[Element(id=1, role="link", label="Pen", price=5), Element(id=2, role="link", label="Ink", price=3)],
    )
    a = asyncio.run(interpret(req, llm))
    assert (a.id, a.source) == (2, "resolver") and llm.calls == 0


def test_llm_click_target_maps_back_to_the_element_id():
    a = run("put it in my basket", FakeLLM({"action": "click", "target": "Add to Cart"}))
    assert (a.action, a.id, a.source, a.message) == ("click", 2, "llm", "Add to Cart")


def test_hallucinated_target_is_rejected():
    a = run("click the thing", FakeLLM({"action": "click", "target": "Teleport"}))
    assert a.action == "none"


def test_click_without_target_is_rejected():
    assert run("click it", FakeLLM({"action": "click"})).action == "none"


def test_search_needs_text():
    assert run("look it up", FakeLLM({"action": "search"})).action == "none"
    assert run("look up shoes", FakeLLM({"action": "search", "text": " shoes "})).text == "shoes"


def test_invented_text_is_rejected():
    a = run("enter my email", FakeLLM({"action": "type", "text": "myemail@example.com"}))
    assert a.action == "none" and "exact words" in a.message
    assert run("type hello world", FakeLLM({"action": "type", "text": "Hello world"})).text == "Hello world"


def test_duplicate_labels_get_unique_names():
    els = [Element(id=5, label="Share"), Element(id=9, label="Share"), Element(id=11, label="Like")]
    assert unique_names(els) == ["Share", "Share (2)", "Like"]
    req = InterpretRequest(command="share the second one", elements=els)
    a = asyncio.run(interpret(req, FakeLLM({"action": "click", "target": "Share (2)"})))
    assert a.id == 9


GROCERY = [
    Element(id=1, role="link", label="Fresh Mini Orange 1 kg"),
    Element(id=2, role="button", label="Add to cart, Fresh Mini Orange 1 kg"),
    Element(id=3, role="link", label="Organic Bananas 6 pcs"),
    Element(id=4, role="button", label="Add to cart, Organic Bananas 6 pcs"),
]


def run_on(command, elements, reply):
    return asyncio.run(interpret(InterpretRequest(command=command, elements=elements), FakeLLM(reply), use_resolver=False))


def test_open_never_presses_an_add_to_cart_button():
    # the real bug: the model picked the cart button for "open the ... page"
    a = run_on("open the fresh mini orange page", GROCERY, {"action": "click", "target": "Add to cart, Fresh Mini Orange 1 kg"})
    assert (a.action, a.id) == ("click", 1)


def test_open_with_only_a_button_available_does_nothing():
    only_buttons = [e for e in GROCERY if e.role == "button"]
    a = run_on("open the fresh mini orange page", only_buttons, {"action": "click", "target": "Add to cart, Fresh Mini Orange 1 kg"})
    assert a.action == "none" and "button" in a.message


def test_viewing_never_adds_to_the_cart_however_it_is_phrased():
    # the user's bug: "I just want to view the item" ended up pressing Add to cart
    for said in ["I just want to view the orange", "show me the fresh mini orange", "I'd like to look at the orange",
                 "take me to the fresh mini orange one", "let me see the fresh mini orange"]:
        a = run_on(said, GROCERY, {"action": "click", "target": "Add to cart, Fresh Mini Orange 1 kg"})
        assert (a.action, a.id) == ("click", 1), said


AMAZON_LIKE = [
    Element(id=1, role="link", label="Bose NEW QuietComfort Wireless Noise Cancelling Headphones"),
    Element(id=2, role="link", label="pTron Studio Pro w/ 65Hrs Playtime, Wireless Over Ear Headphones"),
    Element(id=3, role="link", label="₹2,999.00 ₹2,999 . 00"),
    Element(id=4, role="link", label="boAt Rockerz 411, 40Ms Low Latency, 40Hrs Battery"),
]


def test_a_named_product_overrides_a_model_guess_that_shares_none_of_the_words():
    # real Amazon failure: "view the pTron Studio Pro one" ended on a price label
    a = run_on("view the pTron Studio Pro one", AMAZON_LIKE, {"action": "click", "target": "₹2,999.00 ₹2,999 . 00"})
    assert (a.action, a.id) == ("click", 2)


def test_a_sensible_model_pick_is_left_alone():
    a = run_on("view the pTron Studio Pro one", AMAZON_LIKE, {"action": "click", "target": AMAZON_LIKE[1].label[:60]})  # the model sees labels cut to 60 chars
    assert a.id == 2
    # no overlap with anything else either: trust the model (synonyms like basket/cart)
    a = run_on("put it in my basket", GROCERY, {"action": "click", "target": "Add to cart, Organic Bananas 6 pcs"})
    assert a.id == 4


def test_action_words_allow_the_button():
    for said in ["add the bananas to my cart", "put the bananas in my basket", "buy the bananas", "order the bananas"]:
        a = run_on(said, GROCERY, {"action": "click", "target": "Add to cart, Organic Bananas 6 pcs"})
        assert (a.action, a.id) == ("click", 4), said


def test_add_to_cart_commands_may_still_press_the_button():
    a = run_on("add the bananas to my cart", GROCERY, {"action": "click", "target": "Add to cart, Organic Bananas 6 pcs"})
    assert (a.action, a.id) == ("click", 4)


def test_schema_enum_contains_exactly_the_page_labels():
    schema = build_schema(["A", "B"])
    assert schema["properties"]["target"]["enum"] == ["A", "B"]
    assert "target" not in build_schema([])["properties"]


def test_scroll_defaults_to_down():
    assert run("move along", FakeLLM({"action": "scroll"})).direction == "down"


def test_llm_offline_degrades_gracefully():
    a = run("do something", FakeLLM(fail=True))
    assert a.action == "none" and "isn't running" in a.message


def test_prompt_lists_elements_and_command():
    req = InterpretRequest(command="hello", elements=[Element(id=7, role="link", label="Pen", price=5)], title="Shop")
    p = build_user_prompt(req, unique_names(req.elements))
    assert "[link] Pen | 5" in p and p.endswith("Command: hello") and "Shop" in p


def test_http_validation_and_offline_llm():
    with TestClient(app) as client:
        assert client.post("/interpret", json={"command": ""}).status_code == 422
        assert client.post("/interpret", content="command=hi", headers={"Content-Type": "text/plain"}).status_code == 422
        assert client.post("/transcribe", content=b"").status_code == 400
        app.state.llm = FakeLLM(fail=True)
        res = client.post("/interpret", json={"command": "scroll", "elements": []})
        assert res.status_code == 200
        assert res.json()["action"] == "none" and "isn't running" in res.json()["message"]


# ---- found by an independent review: consent, grocery "ADD" buttons, product names that contain action words ----

BAG_SHOP = [
    Element(id=1, role="link", label="Wildcraft Laptop Bag 30 L Backpack"),
    Element(id=2, role="button", label="Add to cart, Wildcraft Laptop Bag 30 L Backpack"),
    Element(id=3, role="link", label="Fruit Basket Gift Hamper"),
    Element(id=4, role="button", label="Add to cart, Fruit Basket Gift Hamper"),
]


def test_negation_is_not_consent():
    for said in ["I don't want to add it to my cart", "do not add this to the basket", "never add that to my bag"]:
        a = run_on(said, GROCERY, {"action": "click", "target": "Add to cart, Organic Bananas 6 pcs"})
        assert a.action != "click" or a.id in (1, 3), said  # at most a link, never the cart button (ids 2 and 4)


def test_a_product_name_containing_bag_or_basket_is_not_consent():
    for said, link in [("show me that laptop bag", 1), ("I want to look at the fruit basket", 3)]:
        target = "Add to cart, Wildcraft Laptop Bag 30 L Backpack" if link == 1 else "Add to cart, Fruit Basket Gift Hamper"
        a = run_on(said, BAG_SHOP, {"action": "click", "target": target})
        assert (a.action, a.id) == ("click", link), said


def test_grocery_sites_label_the_cart_button_just_add():
    shop = [
        Element(id=1, role="link", label="Amul Butter 500 g"),
        Element(id=2, role="button", label="ADD"),
        Element(id=3, role="link", label="Mother Dairy Milk 1 L"),
        Element(id=4, role="button", label="ADD (2)"),
    ]
    a = run_on("view the butter", shop, {"action": "click", "target": "ADD"})
    assert (a.action, a.id) == ("click", 1)
    a = run_on("add the butter", shop, {"action": "click", "target": "ADD"})
    assert (a.action, a.id) == ("click", 2)  # the user asked for it


def test_send_never_presses_new_chat_sign_up_or_the_microphone():
    # Seen on chat pages before "send" was a local command: the model pressed these instead of sending
    elements = [Element(id=1, role="link", label="New chat"), Element(id=2, role="button", label="Microphone"),
                Element(id=3, role="link", label="Sign up for free"), Element(id=4, role="button", label="Send message")]
    for label in ("New chat", "Microphone", "Sign up for free"):
        req = InterpretRequest(command="go on and send it off", elements=elements)
        a = asyncio.run(interpret(req, FakeLLM({"action": "click", "target": label})))
        assert a.action == "none", label
    req = InterpretRequest(command="send the message for me now", elements=elements)
    a = asyncio.run(interpret(req, FakeLLM({"action": "click", "target": "Send message"})))
    assert (a.action, a.id) == ("click", 4)


def test_the_model_sees_a_manageable_slice_of_a_very_long_results_page():
    from app.interpreter import MAX_SHOWN_RESULTS, shown_elements
    page = [Element(id=1, role="textbox", label="Search")] + [
        Element(id=10 + i, role="link", label=f"Product {i} long enough title", price=10.0 + i, result=True, rank=i - 3, onscreen=0 <= i - 3 <= 1)
        for i in range(150)
    ]
    shown = shown_elements(page)
    assert len(shown) <= 1 + MAX_SHOWN_RESULTS
    assert shown[0].id == 1                                   # page controls are always kept
    assert [e.rank for e in shown if e.result][0] == -2       # starts just before the screen, in page order
    # and a pick from the slice still maps back to the right element
    req = InterpretRequest(command="open the product 5 one", elements=page)
    a = asyncio.run(interpret(req, FakeLLM({"action": "click", "target": "Product 5 long enough title"}), use_resolver=False))
    assert (a.action, a.id) == ("click", 15)
