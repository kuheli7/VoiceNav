from app.resolver import resolve
from app.schemas import Element

SHOP = [
    Element(id=1, role="textbox", label="Search"),
    Element(id=2, role="link", label="boAt Rockerz 450 Bluetooth Headphones", price=1499),
    Element(id=3, role="link", label="Sony WH-CH520 Wireless Headphones", price=3990),
    Element(id=4, role="link", label="JBL Tune 510BT On-Ear Headphones", price=2999),
    Element(id=5, role="button", label="Next page"),
]


def test_cheapest():
    a = resolve("open the cheapest headphones", SHOP)
    assert (a.action, a.id, a.source) == ("click", 2, "resolver")


def test_most_expensive():
    assert resolve("click the most expensive one", SHOP).id == 3


def test_ordinals_count_products_not_page_chrome():
    assert resolve("open the second result", SHOP).id == 3
    assert resolve("open the first one", SHOP).id == 2
    assert resolve("select the last one", SHOP).id == 4
    assert resolve("click the 3rd result", SHOP).id == 4


def test_out_of_range_ordinal_says_so():
    a = resolve("open the tenth result", SHOP)
    assert a.action == "none" and "3 " in a.message


def test_no_prices_on_page():
    a = resolve("open the cheapest one", [Element(id=1, role="link", label="Home")])
    assert a.action == "none" and "prices" in a.message


def test_ordinals_fall_back_to_long_links_without_prices():
    page = [
        Element(id=1, role="link", label="Home"),
        Element(id=2, role="link", label="How the city plans to fix its roads"),
        Element(id=3, role="link", label="Local team wins the regional final"),
    ]
    assert resolve("open the second story", page).id == 3


def test_marked_results_beat_the_guess():
    # a product card holds several links (image, title, ratings, brand); only the marked main link counts as "a result"
    page = [
        Element(id=1, role="link", label="Visit the boAt Store", price=1499),
        Element(id=2, role="link", label="boAt Rockerz 450 Bluetooth Headphones", price=1499, result=True),
        Element(id=3, role="link", label="4.2 out of 5 stars, 1,234 ratings", price=1499),
        Element(id=4, role="link", label="Sony WH-CH520 Wireless Headphones", price=3990, result=True),
        Element(id=5, role="link", label="JBL Tune 510BT On-Ear Headphones", price=2999, result=True),
    ]
    assert resolve("open the second result", page).id == 4
    assert resolve("open the first one", page).id == 2
    assert resolve("select the last one", page).id == 5
    assert resolve("open the cheapest one", page).id == 2
    assert resolve("open the most expensive one", page).id == 4
    a = resolve("open the fourth result", page)
    assert a.action == "none" and "3 " in a.message


def test_results_are_counted_in_page_order_including_ones_below_the_fold():
    # ids follow screen order, but off-screen cards are appended later; rank is their order on the page
    page = [
        Element(id=1, role="link", label="First product on the page title", price=100, result=True, rank=0),
        Element(id=7, role="link", label="Third product on the page title", price=300, result=True, rank=2),
        Element(id=6, role="link", label="Second product on the page title", price=200, result=True, rank=1),
    ]
    assert resolve("open the second result", page).id == 6
    assert resolve("open the last one", page).id == 7


def results(*scrolled_past_and_visible):
    """Result cards in page order. Each arg is (title, price, rank): rank 0 = first one on screen, negative = scrolled past."""
    return [
        Element(id=10 + i, role="link", label=title, price=price, result=True, rank=rank, onscreen=0 <= rank <= 1)
        for i, (title, price, rank) in enumerate(scrolled_past_and_visible)
    ]


def test_positions_count_from_the_first_result_on_screen():
    # the user scrolled past two products: "the first one" is the first they can SEE, not the first on the page
    page = results(("Product A title long enough", 100, -2), ("Product B title long enough", 200, -1),
                   ("Product C title long enough", 300, 0), ("Product D title long enough", 400, 1),
                   ("Product E title long enough", 500, 2))
    assert resolve("open the first one", page).id == 12      # C
    assert resolve("view the second item", page).id == 13    # D
    assert resolve("I want to see the third product", page).id == 14  # E


def test_last_means_the_last_one_on_screen():
    page = results(("Product A title long enough", 100, 0), ("Product B title long enough", 200, 1),
                   ("Product C title long enough", 300, 2))
    assert resolve("open the last one", page).id == 11  # B is the last visible; C is below the fold


def test_prices_look_at_the_whole_page():
    page = results(("Product A title long enough", 900, -1), ("Product B title long enough", 100, 0), ("Product C title long enough", 50, 1))
    assert resolve("open the cheapest one", page).id == 12
    scrolled_past = results(("Cheap one long title here", 10, -1), ("Dear one long title here", 500, 0), ("Mid one long title here", 200, 1))
    assert resolve("open the cheapest one", scrolled_past).id == 10  # cheapest overall, even though it's above the screen


def test_questions_are_counted_as_questions_not_links():
    page = [
        Element(id=1, role="link", label="Learn Python - Full Course for Beginners"),
        Element(id=2, role="link", label="The Python Tutorial - Python 3 documentation"),
        Element(id=3, role="question", label="How long does it take to learn Python?"),
        Element(id=4, role="question", label="Can I learn Python in 3 months?"),
        Element(id=5, role="button", label="What is the best way to learn Python?"),
    ]
    assert resolve("click the second question", page).id == 4
    assert resolve("I want to open the first question", page).id == 3
    assert resolve("expand the third question", page).id == 5      # a label ending in ? counts even if the role isn't "question"
    assert resolve("click the first result", page).id == 1          # "result" still means the results


def test_no_questions_on_screen_says_so():
    a = resolve("click the second question", [Element(id=1, role="link", label="A long enough link title")])
    assert a.action == "none" and "question" in a.message


def test_other_nouns_count_their_own_kind():
    page = [
        Element(id=1, role="button", label="Search"), Element(id=2, role="link", label="Home page of the site"),
        Element(id=3, role="button", label="Sign in"), Element(id=4, role="tab", label="Reviews"), Element(id=5, role="tab", label="Specs"),
    ]
    assert resolve("click the second button", page).id == 3
    assert resolve("open the second tab", page).id == 5


def test_conversational_phrasing_is_understood():
    page = results(("Product A title long enough", 100, 0), ("Product B title long enough", 200, 1), ("Product C title long enough", 300, 2))
    for said in ["I just want to view the second item", "can you please open the second one", "I'd like to see the second product",
                 "let me look at the second result", "see more about the second one", "take me to the second result"]:
        assert resolve(said, page).id == 11, said
    assert resolve("I'd like to see the cheapest item", page).id == 10


def test_vague_request_asks_which_one():
    page = results(("Product A title long enough", 100, 0), ("Product B title long enough", 200, 1))
    for said in ["view the item", "I just want to view the item", "open this product"]:
        a = resolve(said, page)
        assert a.action == "none" and a.show_numbers and "Which one" in a.message, said


def test_vague_request_with_a_single_result_just_opens_it():
    assert resolve("open the item", results(("Only product title long enough", 100, 0))).id == 10


def test_action_buttons_are_never_a_result():
    page = [
        Element(id=1, role="link", label="Fresh Mini Orange 1 kg", price=120),
        Element(id=2, role="button", label="Add to cart, Fresh Mini Orange 1 kg", price=120),
        Element(id=3, role="link", label="Organic Bananas 6 pcs", price=60),
        Element(id=4, role="button", label="Add to cart, Organic Bananas 6 pcs", price=60),
    ]
    assert resolve("open the second result", page).id == 3
    assert resolve("open the cheapest one", page).id == 3
    assert resolve("click the most expensive one", page).id == 1


def test_non_click_commands_are_left_alone():
    assert resolve("search for the cheapest headphones", SHOP) is None
    assert resolve("scroll down", SHOP) is None
    assert resolve("add to cart", SHOP) is None


def test_position_words_inside_a_name_are_not_positions():
    page = results(("Product A title long enough", 100, 0), ("Product B title long enough", 200, 1))
    for said in ["open the first aid kit", "view the 4th of July sale", "open the second water filter", "see the last airbender",
                 "open the galaxy tab", "view the best of lofi mix"]:
        assert resolve(said, page) is None, said


def test_second_cheapest_means_second_cheapest():
    page = results(("Product A title long enough", 300, 0), ("Product B title long enough", 100, 1), ("Product C title long enough", 200, 2))
    assert resolve("open the cheapest one", page).id == 11
    assert resolve("open the second cheapest one", page).id == 12
    assert resolve("view the second most expensive result", page).id == 12
    assert resolve("open the third cheapest", page).id == 10


def test_trailing_politeness_and_extra_nouns_do_not_break_positions():
    page = results(("Product A title long enough", 100, 0), ("Product B title long enough", 200, 1), ("Product C title long enough", 300, 2))
    for said, want in [("can you open the first one please", 10), ("go to the second product page", 11), ("take me to the third search result", 12),
                       ("open the second result now", 11), ("show me the first item for me", 10), ("view the second product page please", 11)]:
        assert resolve(said, page).id == want, said


def test_price_comparison_sees_results_far_down_the_page():
    # a long results page: the most expensive item is result 120, well past what a prompt could hold
    many = [(f"Product number {i} with a long title", 100 + i, i) for i in range(150)]
    many[120] = ("The really expensive one with a long title", 99999, 120)
    page = results(*many)
    assert resolve("view the most expensive result", page).message.startswith("The really expensive one")
    assert resolve("open the cheapest one", page).message.startswith("Product number 0")
