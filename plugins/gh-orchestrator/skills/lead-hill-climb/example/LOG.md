# Checkout time to interactive: experiment log

Generated from `ledger/`: edit the ledger, not this file.

## Revisions to the criteria

- **Rev 2** (2026-11-05, @owner): TTI is scored at p75 of all runs, not the median. Why: The median hid the slow third of runs, where most abandoned checkouts are. Old and new numbers for E0–E3 are in R2.

## Corrections to reported figures

- **2026-11-07**, E3 TTI p75: 1,850 ms → 1,890 ms. Why: The first run hit a warm CDN cache; the eval runs cold, so it was run again. (log/E3.md)
- **2026-11-04**, E0 JavaScript shipped: 498 KB → 512 KB. Why: The first count left out the lazy-loaded address chunk, which the checkout route always loads. (log/E0.md)

## 2026-11-12: E7 Replace the date library (parked)

- **Tried:** The date library is 30 KB for one format call.
- TTI p75 1,840 ms → 1,828 ms, n 180 (within the noise band)
- JS shipped 401 KB → 371 KB, n 1
- **Decision:** Parked: JS −30 KB but TTI −12 ms, inside the band. Worth it once JS becomes the limit.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E7.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e7-dates) · [commit](https://github.com/example/shop/commit/2be8c41)

## 2026-11-11: E6 Islands: hydrate only the form (rejected)

- **Tried:** Most of the page is static; hydrate the form and the cart only.
- TTI p75 1,840 ms → 1,610 ms [1,570–1,655], n 180
- JS shipped 401 KB → 330 KB, n 1
- Completed 96.1 % → 93.8 % [91.4–95.7], n 500, simulated
- **Decision:** Rejected: TTI −230 ms, but completion fell to 93.8 %, under the 95 % floor: the address autocomplete no longer hydrates. Retried as E9.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E6.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e6-islands) · [commit](https://github.com/example/shop/commit/77fe013)

## 2026-11-08: E12 Holdout check after E5 (kept)

- **Tried:** Score the frozen holdout pages once at this milestone.
- TTI p75 1,905 ms [1,850–1,965], n 120 on holdout
- **Decision:** Holdout scored once: 1905 ms, 65 ms behind dev, as expected from heavier forms.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E12.md) · [commit](https://github.com/example/shop/commit/31dd0e4)

## 2026-11-08: E5 Defer analytics until idle (kept)

- **Tried:** Three analytics tags run before the form is usable.
- TTI p75 1,890 ms → 1,840 ms [1,795–1,888], n 180 (within the noise band)
- Completed 96 % → 96.1 %, n 500, simulated (within the noise band)
- **Decision:** Kept: TTI −50 ms (within the band alone, but every run moved the same way, sign test p < 0.01) and the tags still fire.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E5.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e5-defer-tags) · [commit](https://github.com/example/shop/commit/a0c6b98) · [merge](https://github.com/example/shop/commit/31dd0e4)

## 2026-11-06: E4 Preload the two web fonts (rejected)

- **Tried:** Fonts block the first paint of the address form.
- TTI p75 1,890 ms → 1,872 ms [1,825–1,920], n 180 (within the noise band)
- **Decision:** Rejected: −18 ms is inside the 60 ms band. Fonts were already cached on most runs.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E4.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e4-preload-fonts) · [commit](https://github.com/example/shop/commit/5512fe0)

## 2026-11-06: E3 Stream the server render (kept)

- **Tried:** The page waits for the cart and the shipping quote before sending a byte; stream the shell first.
- TTI p75 2,050 ms → 1,890 ms [1,845–1,940], n 180
- Completed 96.3 % → 96 %, n 500, simulated (within the noise band)
- **Decision:** Kept: TTI −160 ms; the waterfall is in R1. Two review rounds found a leaked DB connection on aborted streams, fixed with a regression test.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E3.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e3-streaming) · [commit](https://github.com/example/shop/commit/e8b4d22) · [merge](https://github.com/example/shop/commit/7c90aa5)

## 2026-11-04: E2 Brotli at the edge (kept)

- **Tried:** The CDN serves gzip; Brotli should cut transfer by ~15 %.
- TTI p75 2,130 ms → 2,050 ms [2,000–2,105], n 180
- Completed 96.4 % → 96.3 %, n 500, simulated (within the noise band)
- **Decision:** Kept: TTI −80 ms, just past the band; transfer −17 %.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E2.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e2-brotli) · [commit](https://github.com/example/shop/commit/c3e9a10) · [merge](https://github.com/example/shop/commit/0d2f7c1)

## 2026-11-04: E1 Code-split the payment widget (kept)

- **Tried:** The payment widget is 110 KB and only needed after the address step.
- TTI p75 2,410 ms → 2,130 ms [2,080–2,190], n 180
- JS shipped 512 KB → 401 KB, n 1
- Completed 96.2 % → 96.4 %, n 500, simulated (within the noise band)
- **Decision:** Kept: TTI −280 ms, well past the 60 ms band; JS −111 KB; completion unchanged.
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E1.md) · [branch](https://github.com/example/shop/tree/climb/42-checkout-tti/e1-split-payment) · [commit](https://github.com/example/shop/commit/9ad01e3) · [merge](https://github.com/example/shop/commit/b71e004)

## 2026-11-03: E0 Baseline: today's checkout (kept)

- **Tried:** Measure the current build on the frozen dev pages before changing anything.
- TTI p75 2,410 ms [2,350–2,470], n 180
- JS shipped 512 KB, n 1
- Completed 96.2 % [94.4–97.6], n 500, simulated
- **Decision:** Baseline. Noise band for TTI is ±60 ms at 30 runs a page (R2).
- [log](https://github.com/example/shop/blob/climb/42-checkout-tti/experiments/42-checkout-tti/log/E0.md) · [commit](https://github.com/example/shop/commit/4f1c2ab)
