# Live test: sites most used in India

Run with `node tests/live-india.mjs` on 2026-10-05. Typed commands through the test hook (no microphone), no login, form submissions blocked, nothing bought, sent or signed in.

| Site | Result | Notes |
|---|---|---|
| google | 3/3 (scroll n/a) | search home (bot check likely on search) |
| youtube | 5/5 (scroll n/a) | video home |
| instagram | 3/3 (scroll n/a) | login wall expected |
| whatsapp | 3/3 (scroll n/a) | QR login page |
| facebook | 3/3 (scroll n/a) | login page |
| amazon | 8/8 | shop home |
| flipkart | 7/8 | missed: a login popup covers the page; "Use Email-ID" (a clickable text, not a link or button) was not numbered |
| wikipedia | 6/6 | article |
| toi | 6/6 | news home |
| ndtv | 6/6 | news home |
| irctc | 6/6 | booking form (no login) |
| myntra | 7/8 (8/8 on 3 reruns) | one timing miss on "open the second result" in the full run; passed 3 of 3 when rerun alone |
| zomato | 6/6 | food home |
| imdb | 3/3 (scroll n/a) | movies home |

**72 of 74 checks passed** across 14 sites.

`scroll n/a`: the page had nothing to scroll for a logged-out, fresh browser (empty feed, login wall, or an app-download landing), so the scroll checks were skipped, not passed.

Two Indian sites could not show their real content to this automated browser at first (a blank page until the test stopped blocking background requests); none showed a CAPTCHA, and nothing was done to get past one.
