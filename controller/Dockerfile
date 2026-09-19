FROM node:22-slim AS builder
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
RUN --mount=type=cache,target=/root/.npm npm ci -w controller -w @watchwarden/types

# Build the types package
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/types/src/ ./packages/types/src/
RUN npm run -w @watchwarden/types build

# Build the controller
COPY controller/tsconfig.json ./controller/
COPY controller/src/ ./controller/src/
RUN npm run -w controller build

# Prune dev dependencies for production
RUN npm prune --omit=dev -w controller

# Production image
FROM node:22-slim
RUN groupadd -r warden && useradd -r -g warden warden
WORKDIR /app

# Copy hoisted node_modules (contains all deps + @watchwarden/types symlink)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=warden:warden /app/controller/dist ./dist
COPY --from=builder /app/controller/package.json ./
COPY --chown=warden:warden controller/src/db/migrations ./src/db/migrations
RUN chown -R warden:warden /app
USER warden
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
