# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json* ./
# `npm ci` when a lockfile is present, otherwise a plain install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
