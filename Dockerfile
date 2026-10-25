# SPDX-FileCopyrightText: 2026 Martin Helwig
#
# SPDX-License-Identifier: MIT

FROM nginx/nginx-unprivileged:alpine

WORKDIR /usr/share/nginx/html

COPY www/ .

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
