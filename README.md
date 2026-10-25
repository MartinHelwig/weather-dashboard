<!--
SPDX-FileCopyrightText: 2026 Martin Helwig

SPDX-License-Identifier: MIT
-->

# <img src="/www/images/favicon-48x48.png?raw=true" alt="" align="left"> Weather Dashboard

![GitHub release (with filter)](https://img.shields.io/github/v/release/MartinHelwig/weather-dashboard?color=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Maintenance](https://img.shields.io/maintenance/yes/2026?label=Maintained)
[![REUSE](https://img.shields.io/badge/REUSE-conform%20process-blue)](https://reuse.software/)
[![Dependabot](https://badgen.net/badge/Dependabot/enabled/green?icon=dependabot)](https://dependabot.com/)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/MartinHelwig/weather-dashboard/badge)](https://securityscorecards.dev/viewer/?uri=github.com/MartinHelwig/weather-dashboard)

This is a simple dashboard for displaying the weather for a city of your choice
in full-screen mode.

## Docker Deployment

This project is distributed as a pre-built, minimal Docker image. The static HTML pages are served using the lightweight web server (`httpd`) built into **BusyBox**, running securely under the unprivileged system user `www-data`.

### Run the Container

For security reasons, the web server inside the container runs as a non-root user and listens on port `8080`. You can easily map this to your desired host port (e.g., port `80`) when starting the container.

```bash
docker run -d -p 80:8080 --name weather-dashboard --restart unless-stopped ghcr.io/MartinHelwig/weather-dashboard:latest
```

Once started, the site will be accessible at `http://localhost`.

---

## Licensing & Open Source Compliance (REUSE)

This repository is fully **[REUSE-compliant](https://reuse.software)**. All licenses are declared in a machine-readable format both within the source code headers and at the file level:

However, the pre-built Docker image includes third-party software components from the base image:

- **BusyBox** (v1.38.0) - Licensed under [GNU GPLv2](https://gnu.org). Unmodified source code is available at [busybox.net](https://busybox.net).
- **musl libc** - Licensed under the [MIT License](https://musl-libc.org).
