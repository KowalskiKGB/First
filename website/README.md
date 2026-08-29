# First static website

Hand-written HTML, CSS, and JavaScript for the First project site. The canonical project URL is
<https://first.rocketxsistemas.com.br> and the source repository is
<https://github.com/KowalskiKGB/First>.

This folder has no build step or separately copied assets. The application itself is deployed
with the root `docker-compose.yml`; local application previews add `docker-compose.local.yml`.

No APK, exercise images, or exercise GIFs are part of the static-site deployment. Exercise media
requires a separate license and remains disabled and absent by default.

`site.js` reads public stars, forks, issues, and releases from `KowalskiKGB/First` on GitHub. The
page still works when the unauthenticated API is unavailable.
