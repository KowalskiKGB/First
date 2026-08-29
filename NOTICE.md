# Third-party notices

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

This independent version, **First**, has been modified since 29 August 2026. Its corresponding
source is available at <https://github.com/KowalskiKGB/First>. Exercise images and animations are
not committed to that public repository because they require separate rights from their copyright
holder. Self-hosted and locally built copies may obtain them separately as described below.

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Body diagram geometry

The muscle outlines the body maps are drawn from (`frontend/src/lib/body-paths.js`) are derived
from [**MuscleMap**](https://github.com/melihcolpan/MuscleMap) by Melih Colpan, used under the
**MIT License** and reproduced below. MuscleMap ships its path data as Swift source rather than
`.svg` files; the paths were converted to a JSON module, its sub-group shapes were dropped, and
nothing else about the artwork was changed.

```
MIT License

Copyright (c) 2026 Melih Colpan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Exercise data & media

The exercise catalogue contains 1,324 localized pt-BR names and instruction sets. Exercise data
and instructions (English in `frontend/src/lib/exercises-data.js`, translations in
`frontend/src/instr/`, regenerated via `scripts/build-instructions.mjs`) are derived from
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset) and are
provided under that dataset's MIT license; they are not covered by openGym's AGPL license. The
pt-BR instructions originate from the [`tutods` contribution at commit
`93475e2982117339d2cbf88eb900ad2ceb8d97d6`](https://github.com/tutods/exercises-dataset/commit/93475e2982117339d2cbf88eb900ad2ceb8d97d6).

The dataset's visual media is separate and is not covered by that MIT grant. First's public Git
repository does not distribute the media binaries. Its production Compose service downloads 1,324
JPG files and 1,324 GIF files from the fixed upstream commit
[`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`](https://github.com/hasaneyldrm/exercises-dataset/commit/7455efae41b330c265e7cd4b78dfa848e7ce5ebd)
into the private `first-media` Docker volume. Local Android builds instead copy an operator-supplied,
Git-ignored `media/` directory into the APK for offline access. The user interface displays
**© Gym visual** alongside the visual demonstrations.

These implementation and attribution details do not grant a media license. Anyone who downloads,
uses, builds with, or redistributes the visual files must review the upstream terms and obtain any
permission required from the relevant copyright holder.
