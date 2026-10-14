# Roadmap

A private timeline for the long-range plan.

Live: https://dong-xuyong.github.io/roadmap/

Data lives in Dong-Xuyong/progress-sync, file `roadmap.json`. This public page does not contain the plan. It loads and saves that file with the shared GitHub token (`dong-gh-sync` in localStorage), the same way the other apps do.

The page auto-loads on open, on focus, and every 60 seconds. Edits save a few seconds after you stop, using the file sha, and retry once if another device saved in between.

With no token, the page stays empty until you connect sync.
