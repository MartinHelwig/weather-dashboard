# SPDX-FileCopyrightText: 2026 Martin Helwig
#
# SPDX-License-Identifier: MIT

FROM busybox:1.38.0-musl

RUN mkdir -p /home/www-data

USER www-data

WORKDIR /home/www-data

COPY www www
COPY tools/entrypoint.sh /

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/"]

ENTRYPOINT ["/entrypoint.sh"]
