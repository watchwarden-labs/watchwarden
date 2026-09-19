FROM node:22-alpine AS builder
WORKDIR /app

# Workspace manifests + lockfile.
# Every workspace listed in the root package.json must be present (even the
# ones this image never builds) or npm's workspace resolution crashes with
# "Cannot read properties of null (reading 'edgesOut')". The lockfile makes
# the install reproducible instead of re-resolving from the registry on every
# build, which is how a fresh upstream release broke image builds without any
# change in this repo.
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/sdk/package.json ./packages/sdk/
COPY controller/package.json ./controller/
COPY ui/package.json ./ui/
RUN --mount=type=cache,target=/root/.npm npm ci -w ui -w @watchwarden/types

# Build the types package
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src/ ./packages/types/src/
RUN npm run -w @watchwarden/types build

# Build the UI
COPY ui/ ./ui/
RUN npm run -w ui build

# Production image
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY --from=builder /app/ui/dist /usr/share/nginx/html
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080 || exit 1
CMD ["nginx", "-g", "daemon off;"]
